// Languages the Translator can interpret between. Keep in sync with the
// server-side source of truth: web/src/lib/languages.ts.
export const TRANSLATE_LANGUAGES: Record<string, { ka: string; en: string }> = {
  ru: { ka: 'რუსული', en: 'Russian' },
  en: { ka: 'ინგლისური', en: 'English' },
  ka: { ka: 'ქართული', en: 'Georgian' },
  tr: { ka: 'თურქული', en: 'Turkish' },
  uk: { ka: 'უკრაინული', en: 'Ukrainian' },
  de: { ka: 'გერმანული', en: 'German' },
  fr: { ka: 'ფრანგული', en: 'French' },
  es: { ka: 'ესპანური', en: 'Spanish' },
  it: { ka: 'იტალიური', en: 'Italian' },
  ar: { ka: 'არაბული', en: 'Arabic' },
};

export function languageNameKa(code: string | null | undefined): string | null {
  if (!code) return null;
  return TRANSLATE_LANGUAGES[code]?.ka ?? null;
}

// BCP-47 codes for Google STT (Chirp 2). In two-way interpreter mode the client
// asks Chirp to listen for Georgian + the foreign language so either can be
// spoken and auto-detected.
const BCP47: Record<string, string> = {
  ka: 'ka-GE',
  ru: 'ru-RU',
  en: 'en-US',
  tr: 'tr-TR',
  uk: 'uk-UA',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  it: 'it-IT',
  ar: 'ar-SA',
};

export function bcp47(code: string): string {
  return BCP47[code] ?? code;
}
