// Tiny Georgian opener/closer phrases for the hands-free wake session, plus a
// conservative goodbye detector. Kept trivial on purpose — the whole point is a
// short spoken cue, not a phrasebook.

const GREETINGS = ['გისმენ.', 'დიახ, გისმენ.', 'რით დაგეხმარო?'];
const FAREWELLS = ['კარგად!', 'ნახვამდის!', 'მოგვიანებით.'];

const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)];

export const pickGreeting = () => pick(GREETINGS);
export const pickFarewell = () => pick(FAREWELLS);

// Explicit "we're done" words — Georgian, English, Russian. Bare "კარგად"
// (ok/fine/bye — too ambiguous) is deliberately NOT here: people say it
// mid-conversation as "okay". Same for Russian "пока" ("bye" alone, but
// "yet/while" inside a sentence) — handled as a whole-utterance match below.
const GOODBYE_RE =
  /(ნახვამდის|მშვიდობით|კმარა|გაითიშე|დაასრულე|სულ ეს იყო|good\s?bye|\bbye\b|see you|that's all|до свидания|до встречи|прощай)/i;

export function isGoodbye(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^კარგად[!.…]*$/.test(t)) return false; // bare "okay" is not a goodbye
  if (/^пока[!.…]*$/i.test(t)) return true; // bare "пока" IS a goodbye
  return GOODBYE_RE.test(t);
}
