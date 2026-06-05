// WebSocket proxy that bridges the mobile app to OpenAI's Realtime API in
// transcription-only mode. Holds the OPENAI_API_KEY server-side so the mobile
// app never embeds it.
//
// Protocol with mobile client:
//   client → server (binary)  : PCM16 mono 24kHz audio chunks
//   client → server (text)    : { type: "commit" }      → flush input buffer
//                              { type: "clear" }        → discard buffered audio
//   server → client (text)    : { type: "delta", text } → partial transcript
//                              { type: "final", text }  → completed utterance
//                              { type: "error", message }
//
// Run:
//   npm install ws
//   npm install -D @types/ws concurrently tsx
//   then `npm run dev:all` (see package.json scripts).

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";

// Next.js auto-loads .env.local for its routes; this standalone server must
// load it explicitly.
dotenv.config({ path: ".env.local" });

// No prompt at all. gpt-4o-transcribe (Whisper-derivative) treats `prompt`
// as "previously said text" and continues from it — meaning when audio is
// unclear, it just echoes the prompt back as the transcript. Verified by
// users: setting prompt="ქართულენოვანი საუბარი." produced that exact text
// back regardless of what was actually said.

const PORT = Number(process.env.WS_PORT ?? 3001);
const OPENAI_KEY = process.env.OPENAI_API_KEY;
// GA Realtime API — no `OpenAI-Beta` header. Transcription is selected via
// the `intent=transcription` query param and configured per-session below.
const OPENAI_REALTIME_URL =
  "wss://api.openai.com/v1/realtime?intent=transcription";

if (!OPENAI_KEY) {
  console.error("[ws] OPENAI_API_KEY missing in env — refusing to start.");
  process.exit(1);
}

const server = http.createServer();
const wss = new WebSocketServer({ server, path: "/transcribe" });

wss.on("connection", (clientWs, req) => {
  console.log("[ws] client connected from", req.socket.remoteAddress);

  // Open the upstream connection to OpenAI Realtime (GA shape — no Beta header).
  const upstream = new WebSocket(OPENAI_REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
  });

  const safeSendClient = (obj: unknown) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(obj));
    }
  };

  const safeSendUpstream = (obj: unknown) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(JSON.stringify(obj));
    }
  };

  upstream.on("open", () => {
    console.log("[ws] upstream OpenAI open");
    // GA session.update — `transcription_session.update` is not a valid event
    // type. Configure transcription mode via the session payload. Disable
    // server VAD; mobile decides turn end via local silence detection and
    // sends an explicit commit.
    safeSendUpstream({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: {
              model: "gpt-4o-transcribe",
              // Language hint without a word-list prompt. Without it the
              // auto-detect can pick Japanese (Georgian vowels are close).
              // `ka` is the ISO-639-1 code for Georgian.
              language: "ka",
            },
            // Server VAD: OpenAI commits the buffer automatically whenever it
            // detects 600ms of silence. Each commit produces a transcript
            // turn — so a single utterance with natural micro-pauses streams
            // back as several quick deltas/finals instead of one big batch
            // after the user stops. `create_response: false` means VAD only
            // triggers transcription, not response generation.
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 600,
              create_response: false,
            },
          },
        },
      },
    });
  });

  let firstDeltaLogged = false;
  let firstCompletedLogged = false;

  upstream.on("message", (raw) => {
    let evt: Record<string, unknown> & { type?: string };
    try {
      evt = JSON.parse(raw.toString());
    } catch {
      return;
    }
    console.log("[ws-v2] upstream evt:", evt.type);

    const t = evt.type ?? "";
    if (t.endsWith("transcription.delta") || t.endsWith("transcript.delta")) {
      if (!firstDeltaLogged) {
        console.log("[ws] first delta payload:", JSON.stringify(evt));
        firstDeltaLogged = true;
      }
      // GA may put the text in any of: delta, text, content. Try in order.
      const text =
        (evt.delta as string) ??
        (evt.text as string) ??
        (evt.content as string) ??
        "";
      if (text) safeSendClient({ type: "delta", text });
    } else if (
      t.endsWith("transcription.completed") ||
      t.endsWith("transcript.completed") ||
      t.endsWith("transcript.done")
    ) {
      if (!firstCompletedLogged) {
        console.log("[ws] first completed payload:", JSON.stringify(evt));
        firstCompletedLogged = true;
      }
      const text =
        (evt.transcript as string) ??
        (evt.text as string) ??
        (evt.content as string) ??
        "";
      if (text) safeSendClient({ type: "final", text });
    } else if (t === "error") {
      console.warn("[ws] upstream error", (evt.error as { message?: string })?.message);
      safeSendClient({
        type: "error",
        message: (evt.error as { message?: string })?.message ?? "upstream error",
      });
    }
  });

  upstream.on("close", (code, reason) => {
    console.log("[ws] upstream closed", code, reason.toString());
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  upstream.on("error", (err) => {
    console.warn("[ws] upstream error event:", err.message);
    safeSendClient({ type: "error", message: err.message });
  });

  clientWs.on("message", (raw, isBinary) => {
    if (upstream.readyState !== WebSocket.OPEN) return;

    if (isBinary) {
      // Audio chunk — forward to OpenAI as base64.
      const buf = raw as Buffer;
      const audio = buf.toString("base64");
      safeSendUpstream({ type: "input_audio_buffer.append", audio });
      return;
    }

    // Text control message.
    try {
      const msg = JSON.parse(raw.toString()) as { type?: string };
      if (msg.type === "commit") {
        safeSendUpstream({ type: "input_audio_buffer.commit" });
      } else if (msg.type === "clear") {
        safeSendUpstream({ type: "input_audio_buffer.clear" });
      }
    } catch {
      // ignore malformed
    }
  });

  clientWs.on("close", () => {
    console.log("[ws] client closed");
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  });

  clientWs.on("error", (err) => {
    console.warn("[ws] client error:", err.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[ws] transcription proxy listening on ws://0.0.0.0:${PORT}/transcribe`);
});
