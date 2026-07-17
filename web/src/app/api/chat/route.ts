import openai from "@/lib/openai";
import { guard } from "@/lib/apiGuard";
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

type ActiveTimer = { id: string; label?: string; remainingSeconds: number };
type ActiveAlarm = { id: string; label?: string; hour: number; minute: number };

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
    // The client's currently-active timers/alarms, so the model can cancel the
    // right one by id (see cancel_timer / cancel_alarm).
    timers?: ActiveTimer[];
    alarms?: ActiveAlarm[];
  };
};

const MAX_TOOL_ROUNDS = 3;

/**
 * A Georgian system message describing the user's active timers/alarms so the
 * model can target a specific one for cancellation. Returns null when nothing
 * is active (no message injected — keeps the prompt lean).
 */
function formatActiveState(ctx: ChatRequestBody["userContext"]): string | null {
  const timers = ctx?.timers ?? [];
  const alarms = ctx?.alarms ?? [];
  if (timers.length === 0 && alarms.length === 0) return null;

  const lines = [
    "მომხმარებლის ამჟამად აქტიური ტაიმერები და მაღვიძარები. გამოიყენე მხოლოდ გასაუქმებლად (cancel_timer / cancel_alarm), id-ის მიხედვით. სხვა შემთხვევაში ნუ ახსენებ.",
  ];
  if (timers.length > 0) {
    lines.push("ტაიმერები:");
    for (const t of timers) {
      const mins = Math.max(0, Math.round(t.remainingSeconds / 60));
      const label = t.label ? `, "${t.label}"` : "";
      lines.push(`  - id=${t.id}${label}, დარჩა დაახლოებით ${mins} წუთი`);
    }
  }
  if (alarms.length > 0) {
    lines.push("მაღვიძარები:");
    for (const a of alarms) {
      const hh = String(a.hour).padStart(2, "0");
      const mm = String(a.minute).padStart(2, "0");
      const label = a.label ? `, "${a.label}"` : "";
      lines.push(`  - id=${a.id}, ${hh}:${mm}${label}`);
    }
  }
  return lines.join("\n");
}

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
    const toolCtx: ToolContext = { userCoords };

    const activeState = formatActiveState(userContext);
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: GEORGIAN_ASSISTANT_SYSTEM_PROMPT },
      ...(activeState ? [{ role: "system" as const, content: activeState }] : []),
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
              // gpt-4o has noticeably better Georgian than gpt-4.1-mini (same
              // model the translator uses). Costs ~0.5s more time-to-first-token;
              // revert to "gpt-4.1-mini" (or try "gpt-4.1") if latency bites.
              model: "gpt-4o",
              messages,
              temperature: 0.7,
              // Voice replies are 1–2 short sentences. Georgian is token-heavy,
              // so 200 fits a normal reply without truncating mid-sentence (a
              // cut-off sentence would clip TTS), while still bounding rambles.
              // The real brevity lever is the system prompt; this is the guard.
              max_tokens: 200,
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
