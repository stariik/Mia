// Languages the Translator can interpret between. Every entry must be covered by
// ElevenLabs eleven_v3 (the only TTS provider now) so spoken output sounds
// natural. To add a language: add a code here and confirm v3 speaks it — model
// language lists are narrower than they look; flash/turbo omit Georgian
// entirely. Nothing else on the server needs to change. Keep in sync with the
// mobile copy in mobile/src/lib/translateLanguages.ts.
export const LANGUAGES: Record<string, { ka: string; en: string }> = {
  ru: { ka: "რუსული", en: "Russian" },
  en: { ka: "ინგლისური", en: "English" },
  ka: { ka: "ქართული", en: "Georgian" },
  tr: { ka: "თურქული", en: "Turkish" },
  uk: { ka: "უკრაინული", en: "Ukrainian" },
  de: { ka: "გერმანული", en: "German" },
  fr: { ka: "ფრანგული", en: "French" },
  es: { ka: "ესპანური", en: "Spanish" },
  it: { ka: "იტალიური", en: "Italian" },
  ar: { ka: "არაბული", en: "Arabic" },
};
