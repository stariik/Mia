import { guard } from "@/lib/apiGuard";

const CAMB_API_KEY = process.env.CAMB_API_KEY!;
const CAMB_BASE = "https://client.camb.ai/apis";

// Step 2: Poll task status — returns status + runId
export async function GET(request: Request) {
  const g = guard(request);
  if ("error" in g) return g.error;
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return Response.json({ error: "taskId is required" }, { status: 400 });
    }

    const res = await fetch(`${CAMB_BASE}/tts/${taskId}`, {
      headers: { "x-api-key": CAMB_API_KEY },
    });

    if (!res.ok) {
      return Response.json({ error: "Poll failed" }, { status: 500 });
    }

    const data = await res.json();
    return Response.json({ status: data.status, runId: data.run_id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Poll failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
