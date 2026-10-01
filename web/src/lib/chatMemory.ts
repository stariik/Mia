// Memory blocks appended to the chat system prompt. Both inputs come from the
// client, so they're capped here — a bad client can't bloat every prompt.

export type ProfileFact = { id: string; text: string };

const MAX_FACTS = 50;
const MAX_FACT_CHARS = 200;
const MAX_ACTIONS = 8;
const MAX_ACTION_CHARS = 300;
const MAX_HISTORY = 20; // the phone sends the same (HISTORY_MESSAGES)
export const MAX_HISTORY_CHARS = 2000;

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.slice(0, max) : "";

export type HistoryMessage = { role: "user" | "assistant"; content: string };

/** The client's earlier turns, capped so a bad client can't bloat every call. */
export function sanitizeHistory(history: unknown): HistoryMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-MAX_HISTORY)
    .filter((m) => m?.role === "user" || m?.role === "assistant")
    .map((m) => ({ role: m.role, content: str(m.content, MAX_HISTORY_CHARS) }))
    .filter((m) => m.content);
}

/** Long-term facts about the user, with ids for update/forget. */
export function formatProfile(profile: unknown): string | null {
  if (!Array.isArray(profile)) return null;
  const lines = profile
    .slice(0, MAX_FACTS)
    .map((f) => ({ id: str(f?.id, 40), text: str(f?.text, MAX_FACT_CHARS) }))
    .filter((f) => f.id && f.text)
    .map((f) => `  - id=${f.id}: ${f.text}`);
  if (lines.length === 0) return null;
  return [
    "რაც იცი მომხმარებელზე (შენ თვითონ დაიმახსოვრე წინა საუბრებში). გამოიყენე ბუნებრივად, როცა საჭიროა — ნუ ჩამოთვლი და ყოველ პასუხში ნუ ახსენებ.",
    ...lines,
  ].join("\n");
}

/** What Mia did earlier in this conversation (tool calls + results). */
export function formatRecentActions(actions: unknown): string | null {
  if (!Array.isArray(actions)) return null;
  const lines = actions
    .slice(-MAX_ACTIONS)
    .map((a) => str(a, MAX_ACTION_CHARS))
    .filter(Boolean)
    .map((a) => `  - ${a}`);
  if (lines.length === 0) return null;
  return [
    "შენი ბოლო მოქმედებები ამ საუბარში (ძველიდან ახლისკენ). გამოიყენე მხოლოდ მოკლე გაგრძელებებისთვის — მაგ. თუ ბათუმის ამინდი ნახე და გკითხეს \"ხვალ?\", იგულისხმე ბათუმი; მაგრამ ახალი სრული კითხვა (\"როგორი ამინდია?\") ამ ჩანაწერებს არ ეყრდნობა. ეს ჩანაწერები ხმამაღლა არასდროს წაიკითხო.",
    ...lines,
  ].join("\n");
}

/** One compact log line per tool call, e.g. `get_weather {"city":"ბათუმი"} → {...}`. */
export function actionLine(
  name: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>
): string {
  return `${name} ${JSON.stringify(args)} → ${JSON.stringify(result)}`.slice(
    0,
    MAX_ACTION_CHARS
  );
}
