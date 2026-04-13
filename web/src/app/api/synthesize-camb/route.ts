const CAMB_API_KEY = process.env.CAMB_API_KEY!;
const CAMB_BASE = "https://client.camb.ai/apis";

const DEFAULT_VOICE_ID = 147328;
const GEORGIAN_LANG_ID = 90;

// Step 1: Submit TTS task — returns task_id
export async function POST(request: Request) {
  try {
    const { text, voiceId = DEFAULT_VOICE_ID } = await request.json();

    if (!text) {
      return Response.json({ error: "Text is required" }, { status: 400 });
    }

    const res = await fetch(`${CAMB_BASE}/tts`, {
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

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: `Camb.ai submit failed: ${err}` }, { status: 500 });
    }

    const { task_id } = await res.json();
    return Response.json({ taskId: task_id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Camb.ai submit failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
