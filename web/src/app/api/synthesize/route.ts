import openai from "@/lib/openai";
import { guard } from "@/lib/apiGuard";

type Voice = "alloy" | "ash" | "coral" | "echo" | "fable" | "nova" | "onyx" | "sage" | "shimmer";

export async function POST(request: Request) {
  const g = guard(request);
  if ("error" in g) return g.error;
  try {
    const { text, voice = "nova", speed = 1.0 } = await request.json();

    if (!text) {
      return Response.json({ error: "Text is required" }, { status: 400 });
    }

    const response = await openai.audio.speech.create({
      model: "tts-1-hd",
      voice: voice as Voice,
      input: text,
      speed,
    });

    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "TTS request failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
