// POST /api/synthesize-elevenlabs
// Body: { text: string, voiceId?: string }
// Returns: audio/mpeg — a complete MP3 with duration metadata (see the URL below
// for why this is not the streaming endpoint).
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

export async function POST(request: Request) {
  const g = guard(request);
  if ("error" in g) return g.error;
  try {
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

    // NOT the /stream endpoint, deliberately. Streamed MP3s carry no Xing/Info
    // frame, so they have no duration metadata and a player must estimate length
    // from the bitrate. The orb's WebView <audio> guesses short and fires 'ended'
    // before the final frames play, clipping the last syllable of every sentence
    // (Android's native MediaPlayer doesn't, which is why only the orb clipped).
    // Streaming also bought nothing here: the client awaits the complete file
    // before playing, and measured on Georgian this endpoint is no slower.
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${outputFormat}`;
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
        { status: res.status >= 400 && res.status < 500 ? res.status : 502 }
      );
    }

    return new Response(res.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "ElevenLabs request failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
