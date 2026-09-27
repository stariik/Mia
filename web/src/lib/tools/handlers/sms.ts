import type { ClientTool } from "../types";

// Voice SMS. The phone looks up the contact, reads the message back and waits
// for a yes; it speaks every outcome itself (speaksResult), because only it
// knows whether the contact was found or the send worked. The pending SMS is
// resent each turn as userContext.pendingSms — see formatPendingSms.

export const prepareSms: ClientTool = {
  name: "prepare_sms",
  execution: "client",
  speaksResult: true,
  definition: {
    type: "function",
    function: {
      name: "prepare_sms",
      description:
        "Prepare an SMS for the user to confirm (it is NOT sent yet — the phone reads it back and asks). Use when the user asks to write/send a message or SMS to someone (e.g. 'მისწერე დედას, რომ დავაგვიანებ'). Also call it again to pick one of several matching contacts or to change the text of a pending SMS.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description:
              "Recipient as a contact name in the nominative case, exactly as the user would have saved it ('დედას' → 'დედა', 'ნინოს' → 'ნინო'), or a phone number if dictated.",
          },
          text: {
            type: "string",
            description:
              "The message text, written as the user speaking to the recipient in first person ('რომ დავაგვიანებ' → 'დავაგვიანებ'). Keep the user's meaning; no greeting or signature unless asked.",
          },
        },
        required: ["to", "text"],
        additionalProperties: false,
      },
    },
  },
};

export const confirmSms: ClientTool = {
  name: "confirm_sms",
  execution: "client",
  speaksResult: true,
  definition: {
    type: "function",
    function: {
      name: "confirm_sms",
      description:
        "Send the pending SMS. Call ONLY when an SMS is pending (listed in the context) and the user clearly says yes ('კი', 'ჰო', 'გააგზავნე').",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
};

export const cancelSms: ClientTool = {
  name: "cancel_sms",
  execution: "client",
  speaksResult: true,
  definition: {
    type: "function",
    function: {
      name: "cancel_sms",
      description:
        "Cancel the pending SMS when the user says no or changes their mind ('არა', 'გააუქმე', 'არ გაგზავნო').",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
};

const MAX_CHARS = 500;
const str = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX_CHARS) : "");

/** System block for an SMS awaiting the user's answer; null when none. */
export function formatPendingSms(p: unknown): string | null {
  if (!p || typeof p !== "object") return null;
  const { text, to, options } = p as Record<string, unknown>;
  const body = str(text);
  if (!body) return null;
  const names = Array.isArray(options) ? options.slice(0, 5).map(str).filter(Boolean) : [];
  const who = str(to);
  if (who) {
    return `SMS ელოდება დადასტურებას: მიმღები ${who}, ტექსტი „${body}“. "კი"/"ჰო" → confirm_sms; "არა" → cancel_sms; ტექსტის შეცვლა → prepare_sms ახალი ტექსტით.`;
  }
  if (names.length > 0) {
    return `SMS-ისთვის რამდენიმე კონტაქტი მოიძებნა: ${names.join(", ")}. ტექსტი „${body}“. როცა მომხმარებელი აირჩევს, გამოიძახე prepare_sms არჩეული სრული სახელით და იგივე ტექსტით.`;
  }
  return null;
}
