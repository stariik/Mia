import { GEORGIAN_ASSISTANT_SYSTEM_PROMPT } from "@/lib/prompts";
import { formatProfile, formatRecentActions } from "@/lib/chatMemory";
import { formatPendingSms } from "@/lib/tools/handlers/sms";

// Everything appended to the static prompt each turn. Lives here, not in the
// route, so scripts/tool-probe.ts tests exactly what the route sends.

export const DEFAULT_TZ = "Asia/Tbilisi";

export type ActiveTimer = { id: string; label?: string; remainingSeconds: number };
export type ActiveAlarm = {
  id: string;
  label?: string;
  hour: number;
  minute: number;
  // Days from today of the next ring (0 = today, 1 = tomorrow).
  dayOffset?: number;
  // Recurring weekdays, 0=Sun..6=Sat. Absent = one-shot.
  days?: number[];
};

export type ChatUserContext = {
  city?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  coords?: { lat: number; lon: number };
  // The client's currently-active timers/alarms, so the model can answer
  // about them and cancel the right one by id.
  timers?: ActiveTimer[];
  alarms?: ActiveAlarm[];
  // Long-term facts about the user and this conversation's earlier tool
  // calls — see lib/chatMemory.ts.
  profile?: unknown;
  recentActions?: unknown;
  // SMS awaiting the user's yes/no — see lib/tools/handlers/sms.ts.
  pendingSms?: unknown;
};

const WEEKDAYS_KA = ["კვირა", "ორშაბათი", "სამშაბათი", "ოთხშაბათი", "ხუთშაბათი", "პარასკევი", "შაბათი"];

/** The client's IANA zone, or Tbilisi when it's missing or unknown to Intl. */
export function resolveTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/** Today's date and weekday, so "on Monday" / "tomorrow" resolve without a get_time round. */
export function formatNow(tz: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(pick("weekday"));
  return `ახლა მომხმარებელთან: ${pick("year")}-${pick("month")}-${pick("day")}, ${WEEKDAYS_KA[wd]} (weekday=${wd}), ${pick("hour")}:${pick("minute")}. მაღვიძარას day_offset ამით დაითვალე. დროის კითხვაზე მაინც get_time გამოიძახე.`;
}

function spokenRemaining(seconds: number): string {
  if (seconds < 120) return `${Math.max(0, Math.round(seconds))} წამი`;
  return `${Math.round(seconds / 60)} წუთი`;
}

/**
 * The user's active timers/alarms with their ids. Returns null when nothing is
 * active (no message injected — keeps the prompt lean).
 */
export function formatActiveState(ctx: ChatUserContext | undefined): string | null {
  const timers = Array.isArray(ctx?.timers) ? ctx.timers : [];
  const alarms = Array.isArray(ctx?.alarms) ? ctx.alarms : [];
  if (timers.length === 0 && alarms.length === 0) return null;

  const lines = [
    "მომხმარებლის ამჟამად აქტიური ტაიმერები და მაღვიძარები. გამოიყენე, როცა ამათზე გკითხავენ (მაგ. \"რამდენი დარჩა?\", \"რა მაღვიძარები მაქვს?\") ან გაუქმებისთვის (cancel_timer / cancel_alarm, id-ის მიხედვით). სხვა დროს ნუ ახსენებ. id ხმამაღლა არასდროს თქვა.",
  ];
  if (timers.length > 0) {
    lines.push("ტაიმერები:");
    for (const t of timers) {
      const label = t.label ? `, "${t.label}"` : "";
      lines.push(`  - id=${t.id}${label}, დარჩა ${spokenRemaining(Number(t.remainingSeconds))}`);
    }
  }
  if (alarms.length > 0) {
    lines.push("მაღვიძარები:");
    for (const a of alarms) {
      const hh = String(a.hour).padStart(2, "0");
      const mm = String(a.minute).padStart(2, "0");
      const label = a.label ? `, "${a.label}"` : "";
      const when =
        Array.isArray(a.days) && a.days.length > 0
          ? `, მეორდება: ${a.days.map((d) => WEEKDAYS_KA[d] ?? d).join(", ")}`
          : a.dayOffset === 0
            ? ", დღეს"
            : a.dayOffset === 1
              ? ", ხვალ"
              : typeof a.dayOffset === "number"
                ? `, ${a.dayOffset} დღეში`
                : "";
      lines.push(`  - id=${a.id}, ${hh}:${mm}${when}${label}`);
    }
  }
  return lines.join("\n");
}

export function buildSystemInstruction(ctx: ChatUserContext | undefined, now = new Date()): string {
  return [
    // Stable blocks first, per-turn ones last: Gemini caches the shared prefix.
    GEORGIAN_ASSISTANT_SYSTEM_PROMPT,
    formatProfile(ctx?.profile),
    formatNow(resolveTimeZone(ctx?.timezone), now),
    formatActiveState(ctx),
    formatRecentActions(ctx?.recentActions),
    formatPendingSms(ctx?.pendingSms),
  ]
    .filter(Boolean)
    .join("\n\n");
}
