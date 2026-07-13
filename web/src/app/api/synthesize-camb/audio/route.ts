import { guard } from "@/lib/apiGuard";

const CAMB_API_KEY = process.env.CAMB_API_KEY!;
const CAMB_BASE = "https://client.camb.ai/apis";

// Step 3: Download audio by runId
export async function GET(request: Request) {
  const g = guard(request);
  if ("error" in g) return g.error;
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");

    if (!runId) {
      return Response.json({ error: "runId is required" }, { status: 400 });
    }

    const res = await fetch(`${CAMB_BASE}/tts-result/${runId}`, {
      headers: { "x-api-key": CAMB_API_KEY },
    });

    if (!res.ok) {
      return Response.json({ error: "Audio download failed" }, { status: 500 });
    }

    const audioBuffer = await res.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Audio download failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
