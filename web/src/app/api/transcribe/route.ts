import openai from "@/lib/openai";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return Response.json({ error: "Audio file is required" }, { status: 400 });
    }

    // Whisper doesn't support Georgian (ka) as forced language,
    // so we let it auto-detect.
    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: audioFile,
    });

    return Response.json({
      text: transcription.text,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Transcription failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
