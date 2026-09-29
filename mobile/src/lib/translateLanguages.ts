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

// ── Translator direction ────────────────────────────────────────────────────
// The Translator always pairs Georgian with one foreign language, and the user
// picks which side is spoken ("from") and which is produced ("to").

export type Lang = 'ka' | 'ru' | 'en' | 'de' | 'fr' | 'es';
export type ForeignLang = Exclude<Lang, 'ka'>;
export type Direction = { from: Lang; to: Lang };

// Order shown in the language picker.
export const FOREIGN_LANGS: ForeignLang[] = ['ru', 'en', 'de', 'fr', 'es'];
export const DEFAULT_DIRECTION: Direction = { from: 'ka', to: 'ru' };

function isForeign(x: unknown): x is ForeignLang {
  return (FOREIGN_LANGS as unknown[]).includes(x);
}

export function swapDirection(d: Direction): Direction {
  return { from: d.to, to: d.from };
}

export function foreignOf(d: Direction): ForeignLang {
  const f = d.from === 'ka' ? d.to : d.from;
  return isForeign(f) ? f : 'ru';
}

// Change the foreign language, keeping Georgian on whichever side it was.
export function withForeign(d: Direction, lang: ForeignLang): Direction {
  return d.from === 'ka' ? { from: 'ka', to: lang } : { from: lang, to: 'ka' };
}

// Coerce anything (e.g. a stale persisted value) into a valid direction.
export function sanitizeDirection(x: unknown): Direction {
  const d = x as Partial<Direction> | null | undefined;
  if (d && d.from === 'ka' && isForeign(d.to)) return { from: 'ka', to: d.to };
  if (d && d.to === 'ka' && isForeign(d.from)) return { from: d.from, to: 'ka' };
  return DEFAULT_DIRECTION;
}

// Adverbial form for prompts: "ისაუბრე რუსულად", "დაწერე ქართულად…".
const ADVERB_KA: Record<Lang, string> = {
  ka: 'ქართულად',
  ru: 'რუსულად',
  en: 'ინგლისურად',
  de: 'გერმანულად',
  fr: 'ფრანგულად',
  es: 'ესპანურად',
};

export function languageNameKaAdverb(code: Lang): string {
  return ADVERB_KA[code];
}
