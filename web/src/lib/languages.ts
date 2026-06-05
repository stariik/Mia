// Languages the Translator can interpret between. Every entry must have solid
// TTS coverage on the multilingual providers (ElevenLabs Flash v2.5 / OpenAI)
// so spoken output sounds natural. To add a language: add a code here (and
// confirm TTS support) — nothing else on the server needs to change. Keep in
// sync with the mobile copy in mobile/src/lib/translateLanguages.ts.
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
