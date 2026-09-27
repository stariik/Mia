// Instant, on-device handling of "Mia, pause" / "continue": no chat round trip,
// no spoken reply. Deliberately whole-utterance — every word must be the wake
// word, a command, or filler — so "რატომ გააჩერე?" or "გააგრძელე ზღაპარი"
// still reach the assistant. Anything this misses goes to the server, which
// maps it to the same pause_music / resume_music tools.

export type MusicCommand = 'pause' | 'resume';

// The wake word (and a "hey" before it) as the STT writes it. Smart-start audio
// begins just before "Mia", so words before it (song lyrics) are dropped too.
const WAKE = new Set(['მია', 'მიას', 'mia', 'мия', 'миа']);
const HEY = new Set(['ჰეი', 'hey', 'эй']);
const SEP = `[\\s,.!?;:"'„“”«»…—–-]`;
const WAKE_RE = new RegExp(`(?:^|${SEP})(?:${[...WAKE].join('|')})(?=$|${SEP})`, 'i');

/** What was said after the wake word: "la la მია, პაუზა" → "პაუზა". Smart-start
 *  audio starts just before "Mia", so this drops the wake word and any song
 *  lyrics before it. Unchanged when there is no wake word. */
export function afterWakeWord(text: string): string {
  const m = WAKE_RE.exec(text);
  const rest = m ? text.slice(m.index + m[0].length) : text;
  return rest.replace(new RegExp(`^${SEP}+`), '').trim();
}

const PAUSE = new Set([
  'გააჩერე', 'შეაჩერე', 'დააპაუზე', 'პაუზა', 'პაუზაზე',
  'გამიჩერე', 'შემიჩერე', 'დამიპაუზე', 'შეწყვიტე',
  'pause', 'пауза', 'паузу', 'останови',
  // English "pause" as Georgian speech recognition spells it.
  'პოუზ', 'პოზ', 'პოუზი',
]);
const RESUME = new Set([
  'გააგრძელე', 'განაგრძე', 'გამიგრძელე', 'continue', 'resume', 'продолжи', 'продолжай',
  'კონტინიუ', 'კანტინიუ', 'რეზიუმ',
]);
// "Turn on" is only a resume when it's clearly about music: "ისევ ჩართე",
// "ჩართე მუსიკა". Bare "ჩართე" is too vague.
const TURN_ON = new Set(['ჩართე', 'ჩამირთე', 'play', 'включи']);
const MUSIC = new Set([
  'მუსიკა', 'მუსიკას', 'სიმღერა', 'სიმღერას', 'მიუზიკ',
  'music', 'song', 'музыку', 'музыка', 'песню',
]);
const FILLER = new Set(['the', 'please', 'გთხოვ', 'ახლა', 'пожалуйста']);
const AGAIN = new Set(['ისევ', 'again', 'снова']);

export function matchMusicCommand(text: string): MusicCommand | null {
  let words = text
    .toLowerCase()
    .replace(/[.,!?;:"'„“”«»…—–-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const wake = words.findIndex((w) => WAKE.has(w));
  if (wake >= 0) words = words.slice(wake + 1);
  while (words.length && HEY.has(words[0])) words = words.slice(1);
  if (words.length === 0 || words.length > 5) return null;

  let pause = 0;
  let resume = 0;
  let turnOn = 0;
  let musicOrAgain = false;
  for (const w of words) {
    if (PAUSE.has(w)) pause++;
    else if (RESUME.has(w)) resume++;
    else if (TURN_ON.has(w)) turnOn++;
    else if (MUSIC.has(w) || AGAIN.has(w)) musicOrAgain = true;
    else if (!FILLER.has(w)) return null; // a word we don't understand
  }

  if (pause === 1 && resume + turnOn === 0) return 'pause';
  if (pause === 0 && resume === 1 && turnOn === 0) return 'resume';
  if (pause === 0 && resume === 0 && turnOn === 1 && musicOrAgain) return 'resume';
  return null;
}
