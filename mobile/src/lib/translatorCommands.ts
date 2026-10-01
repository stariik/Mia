// On-device recognition of translator voice commands: "translate to English",
// "თარგმნე ინგლისურად", "stop translating", "შეწყვიტე თარგმნა", "French" (mid
// session), "swap languages"… No chat round trip, so the mode switch is
// instant. Phrasings this misses still reach the assistant, which has the
// start_translation tool.
//
// Deliberately whole-utterance, like musicCommands: every word must be a
// command word, a language, a direction marker or filler. "Translate 'good
// morning' into French" therefore goes to the assistant (a one-off phrase),
// and inside a session a real sentence is never mistaken for a command.

import { afterWakeWord } from './musicCommands';
import type { Lang } from './translateLanguages';

export type TranslatorCommand =
  /** Enter translator mode (or, mid session, a no-op "keep going"). */
  | { kind: 'start'; from?: Lang; to?: Lang }
  | { kind: 'stop' }
  | { kind: 'swap' }
  /** Change one or both languages of a running session. */
  | { kind: 'set'; from?: Lang; to?: Lang };

const TRANSLATE = new Set([
  'translate', 'translating', 'translation', 'translator', 'interpret',
  'interpreting', 'interpreter', 'interpretation',
  'თარგმნე', 'მითარგმნე', 'გადათარგმნე', 'გადამითარგმნე', 'მათარგმნინე',
  'თარგმნა', 'თარგმნის', 'თარგმნას', 'თარგმანი', 'თარგმნო', 'ითარგმნე',
  'თარჯიმანი', 'თარჯიმანს', 'თარჯიმნის', 'თარჯიმნად', 'თარჯიმნი',
  // English as Georgian speech recognition spells it.
  'ტრანსლეიტ', 'ტრანსლეიტინგ', 'ტრანსლეიშენ', 'ტრანსლეითინგ',
  'переводи', 'переведи', 'перевод', 'перевода', 'переводчик', 'переводчика',
  'переводить',
]);

const STOP = new Set([
  'stop', 'end', 'exit', 'close', 'quit', 'leave', 'disable', 'off', 'cancel',
  'finish', 'enough',
  'შეწყვიტე', 'შეაჩერე', 'გააჩერე', 'გაჩერდი', 'დახურე', 'გამორთე', 'დაასრულე',
  'გამოდი', 'გათიშე', 'მორჩა', 'კმარა', 'სტოპ',
  'стоп', 'останови', 'хватит', 'выключи', 'закрой', 'закончи',
]);

const START = new Set([
  'start', 'begin', 'open', 'on', 'enable', 'use', 'be', 'my', 'mode', 'turn',
  'ჩართე', 'ჩამირთე', 'დაიწყე', 'გახსენი', 'იყავი', 'ჩემი', 'რეჟიმი', 'რეჟიმში',
  'включи', 'начни', 'будь', 'моим', 'режим',
]);

// Swap verbs work alone ("swap", "შეაბრუნე"); change verbs only together with
// "languages" ("switch languages") — alone they introduce a language.
const SWAP = new Set([
  'swap', 'reverse', 'flip', 'შეაბრუნე', 'გაცვალე', 'გადაცვალე', 'поменяй',
]);
const CHANGE = new Set([
  'switch', 'change', 'set', 'make', 'go', 'შეცვალე', 'გადართე', 'გადადი',
  'смени', 'переключи',
]);
const LANGUAGES_WORD = new Set([
  'language', 'languages', 'around', 'ენა', 'ენები', 'ენებს', 'языки', 'язык',
]);

const MARK_TO = new Set(['to', 'into', 'in', 'на']);
const MARK_FROM = new Set(['from', 'с', 'со']);

const FILLER = new Set([
  'the', 'a', 'an', 'please', 'can', 'could', 'would', 'you', 'i', 'want',
  'need', "let's", 'lets', 'me', 'for', 'now', 'ok', 'okay', 'it', 'and',
  'ახლა', 'გთხოვ', 'მინდა', 'რომ', 'მე', 'კარგი', 'აბა', 'და', 'თუ', 'შეიძლება',
  'пожалуйста', 'мне', 'я', 'хочу', 'и', 'теперь',
]);

type Role = 'to' | 'from' | 'neutral';

// Language words → (language, the role their own form implies). Georgian marks
// direction with case endings: -ად / -ზე "into", -იდან "from".
const LANG_WORDS = new Map<string, { lang: Lang; role: Role }>();
function addLang(lang: Lang, english: string, kaStem: string, ruStem: string) {
  LANG_WORDS.set(english, { lang, role: 'neutral' });
  for (const [suffix, role] of [
    ['ი', 'neutral'],
    ['ს', 'neutral'],
    ['ის', 'neutral'],
    ['ად', 'to'],
    ['ზე', 'to'],
    ['იდან', 'from'],
  ] as const) {
    LANG_WORDS.set(kaStem + suffix, { lang, role });
  }
  for (const ending of ['ий', 'ого', 'ом', 'ую', 'и']) {
    LANG_WORDS.set(ruStem + ending, { lang, role: 'neutral' });
  }
}
addLang('en', 'english', 'ინგლისურ', 'английск');
addLang('ka', 'georgian', 'ქართულ', 'грузинск');
addLang('ru', 'russian', 'რუსულ', 'русск');
addLang('de', 'german', 'გერმანულ', 'немецк');
addLang('fr', 'french', 'ფრანგულ', 'французск');
addLang('es', 'spanish', 'ესპანურ', 'испанск');

const MAX_WORDS = 9;

export function matchTranslatorCommand(
  text: string,
  opts: { inSession: boolean },
): TranslatorCommand | null {
  const words = afterWakeWord(text)
    .toLowerCase()
    .replace(/[.,!?;:"„“”«»…—–-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w !== 'hey' && w !== 'ჰეი');
  if (words.length === 0 || words.length > MAX_WORDS) return null;

  let translate = false;
  let stop = false;
  let swap = false;
  let change = false;
  let languagesWord = false;
  let pending: Role | null = null; // set by "to" / "from", consumed by a language
  const langs: { lang: Lang; role: Role }[] = [];

  for (const w of words) {
    const lang = LANG_WORDS.get(w);
    if (lang) {
      langs.push({
        lang: lang.lang,
        role: lang.role !== 'neutral' ? lang.role : pending ?? 'neutral',
      });
      pending = null;
      continue;
    }
    if (MARK_TO.has(w)) pending = 'to';
    else if (MARK_FROM.has(w)) pending = 'from';
    else if (TRANSLATE.has(w)) translate = true;
    else if (STOP.has(w)) stop = true;
    else if (SWAP.has(w)) swap = true;
    else if (CHANGE.has(w)) change = true;
    else if (LANGUAGES_WORD.has(w)) languagesWord = true;
    else if (!START.has(w) && !FILLER.has(w)) return null; // not a command
  }

  // Resolve which language is which: explicit roles win; an unmarked language
  // is the source when a target was named ("English to Georgian"), else the
  // target ("translate English"). Two unmarked ones read in order.
  let from: Lang | undefined;
  let to: Lang | undefined;
  if (langs.length > 2) return null;
  for (const l of langs) {
    if (l.role === 'to') to = l.lang;
    else if (l.role === 'from') from = l.lang;
  }
  const neutral = langs.filter((l) => l.role === 'neutral').map((l) => l.lang);
  if (neutral.length === 2) {
    if (from || to) return null;
    [from, to] = neutral;
  } else if (neutral.length === 1) {
    if (to && !from) from = neutral[0];
    else if (!to) to = neutral[0];
    else return null;
  }
  if (from && to && from === to) return null;
  const hasLang = from !== undefined || to !== undefined;

  // "Stop translating" needs the translate word, so a stray "stop" in a
  // conversation being interpreted is translated, not obeyed.
  if (stop) return translate && !hasLang ? { kind: 'stop' } : null;

  if (swap || (change && languagesWord)) {
    return !hasLang && (opts.inSession || translate) ? { kind: 'swap' } : null;
  }

  if (translate) {
    if (opts.inSession && hasLang) return { kind: 'set', from, to };
    return { kind: 'start', ...(from && { from }), ...(to && { to }) };
  }

  // A bare language ("French", "switch to German") only means something while
  // a session is running.
  if (opts.inSession && hasLang) return { kind: 'set', from, to };
  return null;
}
