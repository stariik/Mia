import openai from "@/lib/openai";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return Response.json({ error: "Audio file is required" }, { status: 400 });
    }

    // Whisper doesn't support Georgian (ka) as forced language.
    // The prompt biases the model toward Georgian + the vocabulary our assistant
    // handles (weather, time, timer, alarm, city names).
    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: audioFile,
      prompt:
        "ეს არის ქართულენოვანი საუბარი ქართულ ხმოვან ასისტენტთან, სახელად Mia. " +
        "მომხმარებელი საუბრობს ქართულად და შეიძლება ჰკითხოს ამინდი, დრო, თარიღი, " +
        "ან დაიყენოს ტაიმერი ან მაღვიძარა. " +
        "ქალაქები: თბილისი, ბათუმი, ქუთაისი, რუსთავი, გორი, ფოთი, ზუგდიდი, ახალციხე, თელავი, მცხეთა, ბორჯომი, გუდაური, ბაკურიანი. " +
        "დროის სიტყვები: საათი, წუთი, წამი, დილა, საღამო, ღამე, შუადღე, დღეს, ხვალ, ზეგ, ნახევარი. " +
        "ამინდის სიტყვები: ამინდი, ცივა, ცხელა, წვიმა, თოვლი, ქარი, მზიანი, ღრუბლიანი, გრადუსი. " +
        "მაგალითები: რა ამინდია თბილისში, რომელი საათია, დამიყენე ტაიმერი ხუთ წუთზე, ხვალ დილის შვიდ საათზე დამიყენე მაღვიძარა.",
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
