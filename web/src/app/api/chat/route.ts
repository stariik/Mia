import { randomUUID } from "node:crypto";
import type { Content, Part } from "@google/genai";
import { gemini, CHAT_MODEL, LOW_THINKING } from "@/lib/gemini";
import { guard } from "@/lib/apiGuard";
import { clientIp } from "@/lib/ipLocation";
import { actionLine } from "@/lib/chatMemory";
import {
  buildSystemInstruction,
  resolveTimeZone,
  type ChatUserContext,
} from "@/lib/chatSystem";
import {
  getToolDefinitions,
  findTool,
  isServerTool,
} from "@/lib/tools/registry";
import type { ToolContext, ClientToolCall } from "@/lib/tools/types";

type ChatRequestMessage = { role: "user" | "assistant"; content: string };

type ChatRequestBody = {
  message: string;
  history: ChatRequestMessage[];
  // Mobile sends a flat shape ({ city, lat, lon, timezone }); the older nested
  // { coords } shape is still accepted for backward-compatibility.
  userContext?: ChatUserContext;
};

const MAX_TOOL_ROUNDS = 3;
// Music commands run silently: Mia must not talk over the music she just paused
// or resumed, so a round made only of these ends the turn with no reply.
const SILENT_TOOLS = new Set(["pause_music", "resume_music"]);

export async function POST(request: Request) {
  const g = guard(request);
  if ("error" in g) return g.error;
  try {
    const { message, history, userContext } =
      (await request.json()) as ChatRequestBody;

    if (!message) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    // Accept both the flat {lat,lon} the mobile app sends and the legacy
    // nested {coords}. Without this, "weather here" never resolves on mobile.
    const userCoords =
      userContext?.coords ??
      (typeof userContext?.lat === "number" &&
      typeof userContext?.lon === "number"
        ? { lat: userContext.lat, lon: userContext.lon }
        : undefined);
    const toolCtx: ToolContext = {
      userCoords,
      userCity:
        typeof userContext?.city === "string"
          ? userContext.city.trim().slice(0, 80) || undefined
          : undefined,
      clientIp: clientIp(request),
      timezone: resolveTimeZone(userContext?.timezone),
    };

    const systemInstruction = buildSystemInstruction(userContext);
    const contents: Content[] = [
      // Gemini rejects empty parts, so skip blank turns.
      ...history
        .filter((m) => m.content)
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      { role: "user", parts: [{ text: message }] },
    ];

    const encoder = new TextEncoder();
    const toolDefs = getToolDefinitions();

    const readable = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        const done = () =>
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));

        try {
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const stream = await gemini().models.generateContentStream({
              // Strongest flash model: Georgian quality beats the last few
              // hundred ms of time-to-first-token. Override with GEMINI_MODEL.
              model: CHAT_MODEL,
              contents,
              config: {
                systemInstruction,
                temperature: 0.7,
                // Gemini's thinking tokens count against this cap, and with the
                // profile in context thinking alone runs 200–300 tokens: at 200
                // the reply after a tool call came back empty. Brevity is the
                // system prompt's job; this only bounds a runaway.
                maxOutputTokens: 1024,
                thinkingConfig: LOW_THINKING,
                ...(toolDefs.length > 0 && {
                  tools: [{ functionDeclarations: toolDefs }],
                }),
              },
            });

            // Every part of this round, kept verbatim for the history.
            const parts: Part[] = [];
            for await (const chunk of stream) {
              const chunkParts = chunk.candidates?.[0]?.content?.parts ?? [];
              for (const part of chunkParts) {
                if (part.text && !part.thought) send({ content: part.text });
              }
              parts.push(...chunkParts);
            }

            const calls = parts.flatMap((p) =>
              p.functionCall ? [p.functionCall] : []
            );
            // No tool calls → we're done
            if (calls.length === 0) break;

            // Echo the model turn untouched: its parts carry thought
            // signatures, and Gemini rejects the next round without them.
            contents.push({ role: "model", parts });

            const clientCalls: ClientToolCall[] = [];
            const responses: Part[] = [];
            const actions: string[] = [];

            // Execute tools
            for (const call of calls) {
              const name = call.name ?? "";
              const args = call.args ?? {};
              const tool = findTool(name);
              let result: Record<string, unknown>;

              if (!tool) {
                result = { error: `unknown tool: ${name}` };
              } else if (isServerTool(tool)) {
                try {
                  result = await tool.handler(args, toolCtx);
                } catch (err) {
                  result = {
                    error: err instanceof Error ? err.message : "tool failed",
                  };
                }
              } else {
                // Client tool: frontend executes. Tell the model it was scheduled.
                clientCalls.push({ id: call.id ?? randomUUID(), name, args });
                result = { scheduled: true };
              }

              responses.push({
                functionResponse: { id: call.id, name, response: result },
              });
              actions.push(actionLine(name, args, result));
            }
            contents.push({ role: "user", parts: responses });

            if (clientCalls.length > 0) {
              send({ toolCalls: clientCalls });
            }
            // The client stores these so later turns know what was done.
            send({ actions });
            if (calls.every((c) => SILENT_TOOLS.has(c.name ?? ""))) break;
            // loop continues: ask the model to produce a natural-language reply
          }

          done();
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Stream failed";
          send({ error: msg });
          done();
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Chat request failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
