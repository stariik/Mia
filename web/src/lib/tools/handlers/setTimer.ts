import type { ClientTool } from "../types";

export const setTimer: ClientTool = {
  name: "set_timer",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "set_timer",
      description:
        "Start a countdown timer. Use when the user asks to set a timer (e.g. 'დამიყენე ტაიმერი ხუთ წუთზე'). Convert any spoken Georgian duration into total seconds. If no duration was given ('ტაიმერი დამიყენე', 'set a timer'), do NOT call this — ask how long first.",
      parameters: {
        type: "object",
        properties: {
          duration_seconds: {
            type: "integer",
            minimum: 1,
            maximum: 86400,
            description: "Total length of the timer in seconds.",
          },
          label: {
            type: "string",
            description:
              "Optional short Georgian label describing what the timer is for (e.g. 'ჩაი', 'ვარჯიში'). Leave empty if user didn't specify.",
          },
        },
        required: ["duration_seconds"],
        additionalProperties: false,
      },
    },
  },
};
