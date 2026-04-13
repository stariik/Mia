import openai from "@/lib/openai";
import { GEORGIAN_ASSISTANT_SYSTEM_PROMPT } from "@/lib/prompts";

export async function POST(request: Request) {
  try {
    const { message, history } = await request.json();

    if (!message) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    const messages = [
      { role: "system" as const, content: GEORGIAN_ASSISTANT_SYSTEM_PROMPT },
      ...history.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      { role: "user" as const, content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      temperature: 0.7,
      max_tokens: 300,
    });

    const reply = completion.choices[0].message.content;

    return Response.json({
      reply,
      usage: completion.usage,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Chat request failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
