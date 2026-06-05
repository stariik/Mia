import type { ClientTool } from "../types";

export const setAlarm: ClientTool = {
  name: "set_alarm",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "set_alarm",
      description:
        "Schedule an alarm at a specific wall-clock time. Use when the user says things like 'დამიყენე მაღვიძარა დილის შვიდზე' or 'ხვალ რვის ნახევარზე გამომაღვიძე'. The client computes the actual timestamp from hour/minute/day_offset, so do not pass epoch values.",
      parameters: {
        type: "object",
        properties: {
          hour: {
            type: "integer",
            minimum: 0,
            maximum: 23,
            description:
              "Hour in 24h format. Convert Georgian AM/PM hints: 'დილის 7' → 7, 'საღამოს 7' → 19, 'ღამის 2' → 2, 'შუადღის 12' → 12.",
          },
          minute: {
            type: "integer",
            minimum: 0,
            maximum: 59,
            description:
              "Minute component (0-59). 'ნახევარი' = 30. Default 0 if user didn't specify.",
          },
          day_offset: {
            type: "integer",
            minimum: 0,
            maximum: 7,
            description:
              "Days from today. 0 = today (auto-rolls to tomorrow if the time has already passed). 1 = tomorrow ('ხვალ'). 2 = day after tomorrow ('ზეგ'). Default 0.",
          },
          label: {
            type: "string",
            description:
              "Optional short Georgian label describing the alarm (e.g. 'სამსახურში', 'ვარჯიში'). Leave empty if user didn't specify.",
          },
        },
        required: ["hour"],
        additionalProperties: false,
      },
    },
  },
};
