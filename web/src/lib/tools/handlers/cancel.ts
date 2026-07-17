import type { ClientTool } from "../types";

// Cancel/turn-off tools. The client executes them against its local timer/alarm
// store (web/mobile own that state, not the server). The user's active timers
// and alarms — with their ids — are injected into the chat context, so the
// model targets a specific one by id, disambiguates when several match, or
// tells the user there's nothing to cancel.

export const cancelTimer: ClientTool = {
  name: "cancel_timer",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "cancel_timer",
      description:
        "Cancel/stop/turn off a running timer. Use when the user asks to cancel a timer (e.g. 'გააუქმე ტაიმერი', 'გააჩერე ტაიმერი', 'აღარ მინდა ტაიმერი'). The active timers with their ids are listed in the context; pass the id of the one to cancel. To cancel every timer set all=true. Do NOT call this if no timers are active — tell the user there are none.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Id of the timer to cancel, taken from the active-timers context. Omit only when all=true or exactly one timer is active.",
          },
          all: {
            type: "boolean",
            description: "Cancel every active timer.",
          },
        },
        additionalProperties: false,
      },
    },
  },
};

export const cancelAlarm: ClientTool = {
  name: "cancel_alarm",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "cancel_alarm",
      description:
        "Cancel/turn off a scheduled alarm. Use when the user asks to cancel or turn off an alarm (e.g. 'გააუქმე მაღვიძარა', 'გამორთე მაღვიძარა', 'აღარ მინდა ის მაღვიძარა'). The active alarms with their ids and times are listed in the context; pass the id of the one to cancel. To cancel every alarm set all=true. Do NOT call this if no alarms are active — tell the user there are none.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Id of the alarm to cancel, taken from the active-alarms context. Omit only when all=true or exactly one alarm is active.",
          },
          all: {
            type: "boolean",
            description: "Cancel every active alarm.",
          },
        },
        additionalProperties: false,
      },
    },
  },
};
