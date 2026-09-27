import { randomUUID } from "node:crypto";
import type { Content, Part } from "@google/genai";
import { gemini, CHAT_MODEL, LOW_THINKING } from "@/lib/gemini";
import { guard } from "@/lib/apiGuard";
import { GEORGIAN_ASSISTANT_SYSTEM_PROMPT } from "@/lib/prompts";
import {
  actionLine,
  formatProfile,
  formatRecentActions,
} from "@/lib/chatMemory";
import {
  getToolDefinitions,
  findTool,
  isServerTool,
  isClientTool,
} from "@/lib/tools/registry";
import { formatPendingSms } from "@/lib/tools/handlers/sms";
import type { ToolContext, ClientToolCall } from "@/lib/tools/types";

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
    // Long-term facts about the user and this conversation's earlier tool
    // calls — see lib/chatMemory.ts.
    profile?: unknown;
    recentActions?: unknown;
    // SMS awaiting the user's yes/no — see lib/tools/handlers/sms.ts.
    pendingSms?: unknown;
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

    const systemInstruction = [
      GEORGIAN_ASSISTANT_SYSTEM_PROMPT,
      formatActiveState(userContext),
      formatProfile(userContext?.profile),
      formatRecentActions(userContext?.recentActions),
      formatPendingSms(userContext?.pendingSms),
    ]
      .filter(Boolean)
      .join("\n\n");
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
                // Voice replies are 1–2 short sentences. Georgian is token-heavy,
                // so 200 fits a normal reply without truncating mid-sentence (a
                // cut-off sentence would clip TTS), while still bounding rambles.
                // The real brevity lever is the system prompt; this is the guard.
                maxOutputTokens: 200,
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
            // The phone speaks these outcomes itself (e.g. SMS) — a model
            // reply here would be a second, guessed answer.
            if (
              clientCalls.some((c) => {
                const t = findTool(c.name);
                return t && isClientTool(t) && t.speaksResult;
              })
            ) {
              break;
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
