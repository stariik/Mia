import type { ClientTool } from "../types";

// Long-term personal memory. Facts live on the phone (profileStore) and are
// sent with every turn as userContext.profile, listed in the system prompt
// with their ids — so the model can update or forget a specific one.

export const rememberFact: ClientTool = {
  name: "remember_fact",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "remember_fact",
      description:
        "Save a lasting personal fact about the user so you remember it in future conversations: name, age, where they live, family, job, likes/dislikes (e.g. 'დავითი მქვია', 'ბათუმში ვცხოვრობ', 'ყავა არ მიყვარს'). Do NOT save temporary things (today's plans, questions, moods). If it updates a fact already listed in the context (e.g. moved to another city), pass that fact's id as replaces_id.",
      parameters: {
        type: "object",
        properties: {
          fact: {
            type: "string",
            description:
              "The fact as one short Georgian sentence about the user, e.g. 'მომხმარებელს დავითი ჰქვია'.",
          },
          replaces_id: {
            type: "string",
            description: "Id of the existing fact this one replaces.",
          },
        },
        required: ["fact"],
        additionalProperties: false,
      },
    },
  },
};

export const forgetFact: ClientTool = {
  name: "forget_fact",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "forget_fact",
      description:
        "Forget a saved personal fact when the user asks (e.g. 'დაივიწყე ეს', 'წაშალე, სად ვცხოვრობ'). Pass the fact's id from the context. To forget everything set all=true.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Id of the fact to forget." },
          all: { type: "boolean", description: "Forget every saved fact." },
        },
        additionalProperties: false,
      },
    },
  },
};
