const CAMB_API_KEY = process.env.CAMB_API_KEY!;
const CAMB_BASE = "https://client.camb.ai/apis";

// Default: Zach (DJ) voice, Georgian language
const DEFAULT_VOICE_ID = 147328;
const GEORGIAN_LANG_ID = 90;

export async function POST(request: Request) {
  try {
    const { text, voiceId = DEFAULT_VOICE_ID } = await request.json();

    if (!text) {
      return Response.json({ error: "Text is required" }, { status: 400 });
    }

    // Step 1: Submit TTS task
    const createRes = await fetch(`${CAMB_BASE}/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CAMB_API_KEY,
      },
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        language: GEORGIAN_LANG_ID,
        gender: 1,
        age: 25,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      return Response.json(
        { error: `Camb.ai submit failed: ${err}` },
        { status: 500 }
      );
    }

    const { task_id } = await createRes.json();

    // Step 2: Poll for completion
    let status = "PENDING";
    let runId: number | null = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 30;

    while (status === "PENDING" && attempts < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1500));
      attempts++;

      const pollRes = await fetch(`${CAMB_BASE}/tts/${task_id}`, {
        headers: { "x-api-key": CAMB_API_KEY },
      });
      const pollData = await pollRes.json();
      status = pollData.status;
      runId = pollData.run_id;
    }

    if (status !== "SUCCESS" || !runId) {
      return Response.json(
        { error: `Camb.ai TTS failed: status=${status}` },
        { status: 500 }
      );
    }

    // Step 3: Download audio
    const audioRes = await fetch(`${CAMB_BASE}/tts-result/${runId}`, {
      headers: { "x-api-key": CAMB_API_KEY },
    });

    if (!audioRes.ok) {
      return Response.json(
        { error: "Failed to download Camb.ai audio" },
        { status: 500 }
      );
    }

    const audioBuffer = await audioRes.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Camb.ai TTS failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
