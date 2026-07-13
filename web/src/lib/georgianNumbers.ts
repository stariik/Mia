// Spell integers out in Georgian so TTS pronounces them correctly. ElevenLabs
// reads bare digits inconsistently (often as English) in a Georgian context, so
// the system prompt asks the model to write words — but it only does so "most"
// of the time. Converting at the TTS chokepoint makes it deterministic.
//
// Covers 0–9999 (years, temperatures, times, percents, durations — everything
// the assistant actually says). Georgian is vigesimal (base-20), hence twoDigit.

const UNITS = [
  'ნული', 'ერთი', 'ორი', 'სამი', 'ოთხი', 'ხუთი', 'ექვსი', 'შვიდი', 'რვა',
  'ცხრა', 'ათი', 'თერთმეტი', 'თორმეტი', 'ცამეტი', 'თოთხმეტი', 'თხუთმეტი',
  'თექვსმეტი', 'ჩვიდმეტი', 'თვრამეტი', 'ცხრამეტი',
];

// Hundreds stems (index = hundreds digit). 1 is special ("ას", not "ერთას").
const HUND = [
  '', 'ას', 'ორას', 'სამას', 'ოთხას', 'ხუთას', 'ექვსას', 'შვიდას', 'რვაას',
  'ცხრაას',
];

function twoDigit(n: number): string {
  if (n <= 19) return UNITS[n];
  if (n < 40) return n === 20 ? 'ოცი' : 'ოცდა' + UNITS[n - 20];
  if (n < 60) return n === 40 ? 'ორმოცი' : 'ორმოცდა' + UNITS[n - 40];
  if (n < 80) return n === 60 ? 'სამოცი' : 'სამოცდა' + UNITS[n - 60];
  return n === 80 ? 'ოთხმოცი' : 'ოთხმოცდა' + UNITS[n - 80];
}

function below1000(n: number): string {
  if (n < 100) return twoDigit(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  return r === 0 ? HUND[h] + 'ი' : HUND[h] + ' ' + twoDigit(r);
}

/** Spell a non-negative integer 0–9999 in Georgian. */
export function georgianInt(n: number): string {
  if (n === 0) return UNITS[0];
  if (n < 1000) return below1000(n);
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  const stem = th === 1 ? 'ათას' : below1000(th) + ' ათას';
  return r === 0 ? stem + 'ი' : stem + ' ' + below1000(r);
}

/**
 * Replace standalone digit runs (1–4 digits, optional leading minus) with
 * Georgian words so TTS speaks them correctly. Leaves digits glued to letters
 * (e.g. "gpt-4o") and 5+ digit runs (phone numbers) untouched.
 */
export function normalizeGeorgianNumbers(text: string): string {
  return text.replace(
    /(?<![\p{L}\d])(-)?(\d{1,4})(?![\d\p{L}])/gu,
    (_m, minus: string | undefined, digits: string) => {
      const w = georgianInt(parseInt(digits, 10));
      return minus ? 'მინუს ' + w : w;
    },
  );
}

// ponytail: self-check for the vigesimal logic — run with `npx tsx` on this file
// or call selfCheck() from a script. Throws on the first mismatch.
export function selfCheck(): void {
  const cases: Record<number, string> = {
    0: 'ნული', 16: 'თექვსმეტი', 25: 'ოცდახუთი', 30: 'ოცდაათი', 47: 'ორმოცდაშვიდი',
    50: 'ორმოცდაათი', 99: 'ოთხმოცდაცხრამეტი', 100: 'ასი', 256: 'ორას ორმოცდათექვსმეტი',
    2026: 'ორი ათას ოცდაექვსი',
  };
  for (const [k, v] of Object.entries(cases)) {
    const got = georgianInt(Number(k));
    if (got !== v) throw new Error(`georgianInt(${k}) = ${got}, expected ${v}`);
  }
  if (normalizeGeorgianNumbers('გრძნობა -5 გრადუსი') !== 'გრძნობა მინუს ხუთი გრადუსი') {
    throw new Error('normalize minus failed');
  }
}
