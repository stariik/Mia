import type { ClientTool } from "../types";

/**
 * Music control tools — fired from the mobile via Android media-button
 * broadcast (`AudioManager.dispatchMediaKeyEvent`). Any app that owns the
 * audio focus (Spotify, YouTube Music, podcasts, etc.) responds. No per-app
 * integration needed.
 *
 * All tools are zero-argument; the model just picks the right one.
 */

export const pauseMusic: ClientTool = {
  name: "pause_music",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "pause_music",
      description:
        "Pause whatever is currently playing on the phone. Trigger phrases (Georgian): 'გააჩერე', 'შეაჩერე', 'პაუზა', 'დააპაუზე', 'შეწყვიტე მუსიკა'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
};

export const resumeMusic: ClientTool = {
  name: "resume_music",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "resume_music",
      description:
        "Resume paused music. Trigger phrases (Georgian): 'გააგრძელე', 'ჩართე', 'გადააქცე', 'მუსიკა ისევ ჩართე'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
};

export const toggleMusic: ClientTool = {
  name: "toggle_music",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "toggle_music",
      description:
        "Fallback when the user asks to PLAY a specific song or album (e.g. 'ჩამირთე ბიტლზის სიმღერა'). This assistant cannot search a music library — calling this just sends a play/pause key to whichever music app is foreground. After calling, briefly tell the user in Georgian that you can only resume what was already playing.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
};

export const skipNext: ClientTool = {
  name: "skip_next",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "skip_next",
      description:
        "Skip to the next track. Trigger phrases (Georgian): 'შემდეგი', 'შემდეგი სიმღერა', 'გადადი შემდეგზე', 'სკიპი'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
};

export const skipPrevious: ClientTool = {
  name: "skip_previous",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "skip_previous",
      description:
        "Go to the previous track. Trigger phrases (Georgian): 'წინა', 'წინა სიმღერა', 'წინაზე გადადი', 'უკან'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
};

export const restartTrack: ClientTool = {
  name: "restart_track",
  execution: "client",
  definition: {
    type: "function",
    function: {
      name: "restart_track",
      description:
        "Restart the current track from the beginning. Trigger phrases (Georgian): 'თავიდან', 'თავიდან დაიწყე', 'ხელახლა დაიწყე', 'ხელახლა დაუკარი'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
};
