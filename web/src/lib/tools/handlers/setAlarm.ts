import type { ClientTool } from "../types";

export const setAlarm: ClientTool = {
  name: "set_alarm",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "set_alarm",
      description:
        "Schedule an alarm at a specific wall-clock time, one-shot or repeating on weekdays. Use when the user says things like 'დამიყენე მაღვიძარა დილის შვიდზე', 'ხვალ რვის ნახევარზე გამომაღვიძე', 'ყოველ დილით შვიდზე გამაღვიძე', 'set an alarm for 6:45'. If no time was given ('მაღვიძარა მინდა', 'I want to set an alarm'), do NOT call this — ask what time first. The client computes the actual timestamp from hour/minute/day_offset, so do not pass epoch values.",
      parameters: {
        type: "object",
        properties: {
          hour: {
            type: "integer",
            minimum: 0,
            maximum: 23,
            description:
              "Hour in 24h format. Convert Georgian AM/PM hints: 'დილის 7' → 7, 'საღამოს 7' → 19, 'ღამის 2' → 2, 'შუადღის 12' → 12. Georgian names the COMING hour: 'რვის ნახევარი' = 7:30 (hour 7), 'შვიდის ათი წუთი' = 6:10 (hour 6), 'რვას აკლია ათი' = 7:50 (hour 7). Plain 'შვიდზე' / 'შვიდ საათზე' = 7:00.",
          },
          minute: {
            type: "integer",
            minimum: 0,
            maximum: 59,
            description:
              "Minute component (0-59). 'X-ის ნახევარი' → 30, 'X-ის Y წუთი' → Y, 'X-ს აკლია Y' → 60-Y. Default 0 if user didn't specify.",
          },
          day_offset: {
            type: "integer",
            minimum: 0,
            maximum: 7,
            description:
              "One-shot alarms only: days from today. 0 = today (auto-rolls to tomorrow if the time has already passed). 1 = tomorrow ('ხვალ'). 2 = day after tomorrow ('ზეგ'). For a named weekday ('ორშაბათს') count from today's weekday in the context. Default 0. Ignored when 'days' is set.",
          },
          days: {
            type: "array",
            items: { type: "integer", minimum: 0, maximum: 6 },
            description:
              "Only for a REPEATING alarm: weekdays it rings on, 0=კვირა (Sun), 1=ორშაბათი, 2=სამშაბათი, 3=ოთხშაბათი, 4=ხუთშაბათი, 5=პარასკევი, 6=შაბათი. 'ყოველდღე' / 'ყოველ დილით' / 'every day' → [0,1,2,3,4,5,6]; 'სამუშაო დღეებში' / 'weekdays' → [1,2,3,4,5]; 'შაბათ-კვირას' / 'weekends' → [0,6]; 'ორშაბათობით' / 'ყოველ ორშაბათს' → [1]. A single 'ორშაბათს' (this Monday) is one-shot: use day_offset, not days.",
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
