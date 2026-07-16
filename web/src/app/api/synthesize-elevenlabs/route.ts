// POST /api/synthesize-elevenlabs        -> audio/mpeg, STREAMED as generated
// POST /api/synthesize-elevenlabs?complete=1 -> audio/mpeg, complete file
//
// Two shapes because two consumers need different things:
//
//  - default (streamed): the orb's WebView plays it through MediaSource and
//    starts on the first byte. v3 emits its first byte ~1.4s in and the rest at
//    ~2x realtime, so playback starts ~1.4s earlier and never underruns.
//
//  - ?complete=1: the headless/native backend and the WebView's fallback path
//    hand a finished file to a plain player. Those need the Xing/Info duration
//    frame, which ElevenLabs' /stream endpoint omits — without it a player has
//    to estimate length from the bitrate, guesses short, and clips the final
//    syllable. MediaSource doesn't care (we call endOfStream(), so the exact
//    length is known), which is why the streamed shape is safe for it.
//
// Voice ID and model come from env so the mobile client just sends text.

import { normalizeGeorgianNumbers } from "@/lib/georgianNumbers";
import { guard } from "@/lib/apiGuard";

// eleven_v3 is the only ElevenLabs model that actually speaks Georgian —
// flash/turbo v2.5 cover ~32 languages and Georgian is not one of them, so they
// only approximate the script and a native speaker hears it as broken. v3 costs
// ~2.2-3.3s per sentence vs flash's ~0.3s; that is the price of the language.
// Do not swap this for a faster model on latency grounds without a Georgian
// speaker confirming the output is acceptable — that trade was tried and
// rejected.
const DEFAULT_MODEL = "eleven_v3";

// 64 kbps @ 44.1 kHz: half the bytes of mp3_44100_128 with no audible loss for
// speech, so first-audio arrives sooner. Override via env if you ever need
// higher fidelity (e.g. mp3_44100_128) or smaller still (mp3_22050_32).
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_64";

// The orb's WebView renders inline HTML, so its origin is `null` and any fetch
// to this API is cross-origin. `*` is safe here: the route is JWT-guarded and
// we never read cookies, so this grants a browser nothing that curl with the
// same token couldn't already do.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
} as const;

// The Authorization header makes the fetch non-simple, so the WebView sends a
// preflight before every synth. Without this handler each one 405s.
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS, "Access-Control-Max-Age": "86400" },
  });
}

export async function POST(request: Request) {
  const g = guard(request);
  if ("error" in g) return g.error;
  try {
    const wantComplete =
      new URL(request.url).searchParams.get("complete") === "1";
    const { text, voiceId } = (await request.json()) as {
      text?: string;
      voiceId?: string;
    };

    if (!text || !text.trim()) {
      return Response.json({ error: "Text is required" }, { status: 400 });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const envVoice = process.env.ELEVENLABS_VOICE_ID;
    const model = process.env.ELEVENLABS_MODEL || DEFAULT_MODEL;
    const outputFormat =
      process.env.ELEVENLABS_OUTPUT_FORMAT || DEFAULT_OUTPUT_FORMAT;
    const voice = voiceId || envVoice;

    if (!apiKey) {
      return Response.json(
        { error: "ELEVENLABS_API_KEY not configured" },
        { status: 500 }
      );
    }
    if (!voice) {
      return Response.json(
        { error: "ELEVENLABS_VOICE_ID not configured" },
        { status: 500 }
      );
    }

    // /stream emits bytes as the model generates (first byte ~1.4s vs ~2.7s for
    // the whole file) but omits the Xing/Info duration frame. See the header
    // comment: only MediaSource can use the streamed shape safely.
    const url = wantComplete
      ? `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${outputFormat}`
      : `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=${outputFormat}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        // Spell digits as Georgian words so they're pronounced correctly.
        text: normalizeGeorgianNumbers(text),
        model_id: model,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          // speaker_boost adds latency for a marginal similarity gain — off for
          // faster first-audio on a voice assistant.
          use_speaker_boost: false,
        },
      }),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      return Response.json(
        { error: `ElevenLabs failed (${res.status}): ${errText.slice(0, 200)}` },
        {
          status: res.status >= 400 && res.status < 500 ? res.status : 502,
          headers: CORS,
        }
      );
    }

    return new Response(res.body, {
      headers: {
        ...CORS,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        // Nothing downstream may buffer this: the whole point is that the first
        // bytes reach the player while the model is still generating.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "ElevenLabs request failed";
    return Response.json({ error: message }, { status: 500, headers: CORS });
  }
}
