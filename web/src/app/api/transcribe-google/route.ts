export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "GOOGLE_CLOUD_API_KEY is not set" },
      { status: 500 }
    );
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return Response.json({ error: "Audio file is required" }, { status: 400 });
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString("base64");

    const sttRes = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            encoding: "WEBM_OPUS",
            sampleRateHertz: 48000,
            languageCode: "ka-GE",
            enableAutomaticPunctuation: true,
            model: "default",
          },
          audio: { content: base64Audio },
        }),
      }
    );

    if (!sttRes.ok) {
      const errBody = await sttRes.text();
      return Response.json(
        { error: `Google STT failed: ${errBody}` },
        { status: sttRes.status }
      );
    }

    const data = (await sttRes.json()) as {
      results?: Array<{ alternatives: Array<{ transcript: string }> }>;
    };

    const text =
      data.results?.map((r) => r.alternatives[0]?.transcript ?? "").join(" ").trim() ?? "";

    return Response.json({ text });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Transcription failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
