import openai from "@/lib/openai";
import { GEORGIAN_ASSISTANT_SYSTEM_PROMPT } from "@/lib/prompts";
import {
  getToolDefinitions,
  findTool,
  isServerTool,
} from "@/lib/tools/registry";
import type { ToolContext, ClientToolCall } from "@/lib/tools/types";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";

type ChatRequestMessage = { role: "user" | "assistant"; content: string };

type ChatRequestBody = {
  message: string;
  history: ChatRequestMessage[];
  // Mobile sends a flat shape ({ city, lat, lon, timezone }); the older nested
  // { coords } shape is still accepted for backward-compatibility.
  userContext?: {
    city?: string;
    lat?: number;
    lon?: number;
    timezone?: string;
    coords?: { lat: number; lon: number };
  };
};

const MAX_TOOL_ROUNDS = 3;

export async function POST(request: Request) {
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
    const toolCtx: ToolContext = { userCoords };

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: GEORGIAN_ASSISTANT_SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
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
            const stream = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages,
              temperature: 0.7,
              max_tokens: 300,
              stream: true,
              ...(toolDefs.length > 0 && {
                tools: toolDefs,
                tool_choice: "auto",
              }),
            });

            // Accumulators for this round
            let assistantText = "";
            const toolCallBuf: Record<
              number,
              {
                id: string;
                name: string;
                argsText: string;
              }
            > = {};
            let finishReason: string | null = null;

            for await (const chunk of stream) {
              const choice = chunk.choices[0];
              if (!choice) continue;

              const delta = choice.delta;
              if (delta?.content) {
                assistantText += delta.content;
                send({ content: delta.content });
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index;
                  if (!toolCallBuf[idx]) {
                    toolCallBuf[idx] = { id: "", name: "", argsText: "" };
                  }
                  if (tc.id) toolCallBuf[idx].id = tc.id;
                  if (tc.function?.name) {
                    toolCallBuf[idx].name = tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    toolCallBuf[idx].argsText += tc.function.arguments;
                  }
                }
              }

              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
              }
            }

            // No tool calls → we're done
            if (finishReason !== "tool_calls") break;

            const pending = Object.values(toolCallBuf);
            if (pending.length === 0) break;

            // Push the assistant's tool-call turn into message history
            const toolCalls: ChatCompletionMessageToolCall[] = pending.map(
              (p) => ({
                id: p.id,
                type: "function",
                function: { name: p.name, arguments: p.argsText || "{}" },
              })
            );
            messages.push({
              role: "assistant",
              content: assistantText || null,
              tool_calls: toolCalls,
            });

            const clientCalls: ClientToolCall[] = [];

            // Execute tools
            for (const p of pending) {
              const tool = findTool(p.name);
              let result: unknown;

              if (!tool) {
                result = { error: `unknown tool: ${p.name}` };
              } else {
                let args: Record<string, unknown> = {};
                try {
                  args = p.argsText ? JSON.parse(p.argsText) : {};
                } catch {
                  args = {};
                }

                if (isServerTool(tool)) {
                  try {
                    result = await tool.handler(args, toolCtx);
                  } catch (err) {
                    result = {
                      error: err instanceof Error ? err.message : "tool failed",
                    };
                  }
                } else {
                  // Client tool: frontend executes. Tell the model it was scheduled.
                  clientCalls.push({ id: p.id, name: p.name, args });
                  result = { scheduled: true };
                }
              }

              messages.push({
                role: "tool",
                tool_call_id: p.id,
                content: JSON.stringify(result),
              });
            }

            if (clientCalls.length > 0) {
              send({ toolCalls: clientCalls });
            }
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
