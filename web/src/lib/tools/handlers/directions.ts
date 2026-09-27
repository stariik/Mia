import type { ClientTool } from "../types";

// Opens Google Maps navigation on the phone after Mia's reply (see
// mobile/src/lib/tools/maps.ts). No API key: it's just a Maps URL.

export const openDirections: ClientTool = {
  name: "open_directions",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "open_directions",
      description:
        "Start Google Maps navigation to a place. Use when the user wants directions or to go somewhere (e.g. 'მინდა მივიდე აბაშიძის ქუჩა 12-ზე', 'წამიყვანე აეროპორტში', 'უახლოესი აფთიაქი'). Maps opens after your short reply, from the user's current location.",
      parameters: {
        type: "object",
        properties: {
          destination: {
            type: "string",
            description:
              "Address or place as Google Maps would search it, in the user's words but in the nominative case ('აბაშიძის ქუჩაზე 12' → 'აბაშიძის ქუჩა 12'). Add the city only if the user named it. For 'home'/'work' use the address from the known facts about the user; for a place type ('აფთიაქი') pass just that.",
          },
          mode: {
            type: "string",
            enum: ["driving", "walking", "bicycling", "transit"],
            description:
              "driving by default; 'ფეხით' → walking, 'ველოსიპედით' → bicycling, 'ტრანსპორტით'/'ავტობუსით'/'მეტროთი' → transit.",
          },
        },
        required: ["destination"],
        additionalProperties: false,
      },
    },
  },
};
