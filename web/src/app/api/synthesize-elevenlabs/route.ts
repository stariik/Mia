// POST /api/synthesize-elevenlabs
// Body: { text: string, voiceId?: string }
// Returns: audio/mpeg, streamed directly from ElevenLabs.
//
// Uses Flash v2.5 (eleven_flash_v2_5) for ~75ms model latency. Voice ID and
// model come from env so the mobile client just sends text.

const DEFAULT_MODEL = "eleven_flash_v2_5";

export async function POST(request: Request) {
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

    // Stream endpoint: returns audio bytes immediately as the model generates.
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_128`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
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
