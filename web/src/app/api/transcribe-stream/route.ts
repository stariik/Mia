import openai from "@/lib/openai";
import { guard } from "@/lib/apiGuard";

const PROMPT =
  "ეს არის ქართულენოვანი საუბარი ქართულ ხმოვან ასისტენტთან, სახელად Mia. " +
  "მომხმარებელი საუბრობს ქართულად და შეიძლება ჰკითხოს ამინდი, დრო, თარიღი, " +
  "ან დაიყენოს ტაიმერი ან მაღვიძარა. " +
  "ქალაქები: თბილისი, ბათუმი, ქუთაისი, რუსთავი, გორი, ფოთი, ზუგდიდი, ახალციხე, თელავი, მცხეთა, ბორჯომი, გუდაური, ბაკურიანი. " +
  "დროის სიტყვები: საათი, წუთი, წამი, დილა, საღამო, ღამე, შუადღე, დღეს, ხვალ, ზეგ, ნახევარი. " +
  "ამინდის სიტყვები: ამინდი, ცივა, ცხელა, წვიმა, თოვლი, ქარი, მზიანი, ღრუბლიანი, გრადუსი. " +
  "მაგალითები: რა ამინდია თბილისში, რომელი საათია, დამიყენე ტაიმერი ხუთ წუთზე, ხვალ დილის შვიდ საათზე დამიყენე მაღვიძარა.";

type TranscriptEvent =
  | { type: "transcript.text.delta"; delta: string }
  | { type: "transcript.text.done"; text: string };

export async function POST(request: Request) {
  const g = guard(request);
  if ("error" in g) return g.error;
  let body: { audioBase64?: string; mime?: string };
  try {
    body = (await request.json()) as { audioBase64?: string; mime?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.audioBase64) {
    return Response.json({ error: "audioBase64 is required" }, { status: 400 });
  }

  const buffer = Buffer.from(body.audioBase64, "base64");
  const mime = body.mime ?? "audio/mp4";
  const file = new File([buffer], "rec.m4a", { type: mime });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      const done = () => {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      };
      try {
        const transcription = await openai.audio.transcriptions.create({
          model: "gpt-4o-transcribe",
          file,
          prompt: PROMPT,
          stream: true,
        });
        let finalText = "";
        for await (const event of transcription as AsyncIterable<TranscriptEvent>) {
          if (event.type === "transcript.text.delta" && event.delta) {
            send({ delta: event.delta });
            finalText += event.delta;
          } else if (event.type === "transcript.text.done" && event.text) {
            finalText = event.text;
          }
        }
        send({ text: finalText });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Transcription failed";
        send({ error: msg });
      } finally {
        done();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
