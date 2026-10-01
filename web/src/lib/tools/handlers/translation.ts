import type { ClientTool } from "../types";

// Opens the phone's translator mode after Mia's reply (see
// mobile/src/lib/translator). Common phrasings ("translate to English",
// "თარგმნე ინგლისურად") are caught on the phone before they reach the model;
// this covers everything else. Language codes must match the mobile Lang type
// in mobile/src/lib/translateLanguages.ts.

const LANGS = ["en", "ka", "ru", "de", "fr", "es"];

export const startTranslation: ClientTool = {
  name: "start_translation",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "start_translation",
      description:
        "Open the live interpreter: the phone listens, translates every sentence and reads it aloud until the user says 'stop translating'. Use when the user wants to translate a conversation or wants you to be their interpreter (e.g. 'მათარგმნინე რუსულად', 'იყავი ჩემი თარჯიმანი', 'help me talk to this waiter in French'). Not for a single word or phrase — translate those yourself in your reply. The interpreter opens after your short reply.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            enum: LANGS,
            description: "Language to translate INTO. Omit to keep the user's last choice.",
          },
          from: {
            type: "string",
            enum: LANGS,
            description: "Language the user will speak. Omit unless the user named it.",
          },
        },
        additionalProperties: false,
      },
    },
  },
};
