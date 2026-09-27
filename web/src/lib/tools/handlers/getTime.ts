import { DEFAULT_TZ } from "@/lib/chatSystem";
import type { ServerTool } from "../types";

export const getTime: ServerTool = {
  name: "get_time",
  execution: "server",
  definition: {
    type: "function",
    function: {
      name: "get_time",
      description:
        "Get the current time and date in the user's timezone (Tbilisi when unknown). Call this whenever the user asks what time it is, what day of the week, today's date, or anything that depends on the current moment.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  async handler(_args, ctx) {
    const TZ = ctx.timezone ?? DEFAULT_TZ;
    const now = new Date();

    const enParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
      hour12: false,
    }).formatToParts(now);

    const pick = (t: string) =>
      enParts.find((p) => p.type === t)?.value ?? "";

    const weekdayKa = new Intl.DateTimeFormat("ka-GE", {
      weekday: "long",
      timeZone: TZ,
    }).format(now);

    const monthKa = new Intl.DateTimeFormat("ka-GE", {
      month: "long",
      timeZone: TZ,
    }).format(now);

    return {
      hour_24: parseInt(pick("hour"), 10),
      minute: parseInt(pick("minute"), 10),
      second: parseInt(pick("second"), 10),
      weekday_en: pick("weekday"),
      weekday_ka: weekdayKa,
      day: parseInt(pick("day"), 10),
      month_ka: monthKa,
      month_number: parseInt(pick("month"), 10),
      year: parseInt(pick("year"), 10),
      iso_utc: now.toISOString(),
      timezone: TZ,
    };
  },
};
