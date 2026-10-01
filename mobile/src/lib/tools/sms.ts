import { AppState, NativeModules } from 'react-native';

import {
  ensureContactsPermission,
  ensureSendSmsPermission,
} from '@/hooks/usePermissions';

// Voice SMS: prepare_sms → Mia reads it back → "კი" → confirm_sms sends.
// The phone composes the spoken reply (the model can't see contact lookups —
// client tools only return {scheduled:true}), and the pending SMS is resent as
// context so the model can handle yes / no / "ნინო ბერიძე". Phone numbers
// never leave the device.

export type Contact = { name: string; number: string };

type SmsNative = {
  getContacts(): Promise<Contact[]>;
  send(number: string, text: string): Promise<void>;
  openComposer(number: string, text: string): Promise<void>;
};

const Native = (NativeModules.SmsModule || null) as SmsNative | null;

const PENDING_TTL_MS = 2 * 60_000;
const MAX_OPTIONS = 3;

type Pending = { text: string; expiresAt: number } & (
  | { kind: 'ready'; to: Contact }
  | { kind: 'choose'; options: Contact[] }
);

let pending: Pending | null = null;

const livePending = () =>
  pending && pending.expiresAt > Date.now() ? pending : (pending = null);

/** What the model sees next turn — names and text only, no numbers. */
export function getPendingSmsContext() {
  const p = livePending();
  if (!p) return undefined;
  return p.kind === 'ready'
    ? { text: p.text, to: p.to.name }
    : { text: p.text, options: p.options.map((o) => o.name) };
}

// The user speaks Georgian, but contacts are saved in Georgian, Latin ("Baco",
// "Batso" — Georgian-keyboard letters or spelled out) or Cyrillic ("Бацо").
// Every script is folded into one lossy sound key where letters people spell
// interchangeably collapse: ც/წ/c/ts/ц → c, ხ/ჰ/x/kh/h/х → x, ქ/კ/ყ/q → k, …
// Uppercase marks the sounds that need two Latin letters (S=sh, C=ch, Z=zh, D=dz).
const GEO_KEY: Record<string, string> = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i',
  კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'Z', რ: 'r', ს: 's',
  ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'g', ყ: 'k', შ: 'S', ჩ: 'C', ც: 'c',
  ძ: 'D', წ: 'c', ჭ: 'C', ხ: 'x', ჯ: 'j', ჰ: 'x',
};
const CYR_KEY: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'Z', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'p', х: 'x', ц: 'c', ч: 'C', ш: 'S', щ: 'S',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'iu', я: 'ia', і: 'i', є: 'e', ґ: 'g',
};
const LAT_DIGRAPH: Record<string, string> = {
  dzh: 'j', dj: 'j', dz: 'D', sh: 'S', ch: 'C', zh: 'Z', kh: 'x', gh: 'g',
  ts: 'c', tz: 'c', th: 't', ph: 'p',
};
// w and y mean წ and ყ on the Georgian keyboard but v and i in "Will", "Yana",
// so they get both readings.
const LAT_KEY: Record<string, string[]> = {
  f: ['p'], q: ['k'], h: ['x'], w: ['c', 'v'], y: ['i', 'k'],
};
const MAX_KEYS = 4;

/** Sound keys for a name in any script — usually one, more for w/y. */
function nameKeys(s: string): string[] {
  const text = s
    .toLowerCase()
    .replace(/и([яю])/g, '$1') // Хатия = ხატია, not "xatiia"
    .replace(/дж/g, 'j')
    .replace(/дз/g, 'D')
    .replace(/dzh|dj|dz|sh|ch|zh|kh|gh|ts|tz|th|ph/g, (d) => LAT_DIGRAPH[d]);
  let keys = [''];
  for (const ch of text) {
    const opts =
      GEO_KEY[ch] !== undefined ? [GEO_KEY[ch]]
      : CYR_KEY[ch] !== undefined ? [CYR_KEY[ch]]
      : LAT_KEY[ch] ?? (/[a-zA-Z0-9]/.test(ch) ? [ch] : /\s/.test(ch) ? [' '] : []);
    if (opts.length === 0) continue;
    keys =
      keys.length * opts.length > MAX_KEYS
        ? keys.map((k) => k + opts[0])
        : keys.flatMap((k) => opts.map((o) => k + o));
  }
  return [...new Set(keys.map((k) => k.replace(/\s+/g, ' ').trim()))].filter(Boolean);
}

/** Levenshtein distance (keys are ASCII, so code units are letters). */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return row[b.length];
}

/** Letters a name may be off by — none for short ones, they'd match anything. */
const allowedTypos = (q: string) => (q.length <= 3 ? 0 : q.length <= 6 ? 1 : 2);

/** Best-matching contacts for a spoken name: exact > a word matches > substring
 *  > a letter or two off (misheard, or saved as "Bacco"). Mia reads a single
 *  hit back and lists several, so a near miss is only ever a suggestion.
 *  One entry per contact name (first number wins). */
export function matchContacts(query: string, contacts: Contact[]): Contact[] {
  const qs = nameKeys(query);
  if (qs.length === 0) return [];
  const scoreKey = (n: string, q: string) => {
    if (n === q) return 3;
    if (n.split(' ').includes(q) || n.startsWith(q + ' ')) return 2;
    if (n.includes(q)) return 1;
    const d = Math.min(...[n, ...n.split(' ')].map((w) => editDistance(w, q)));
    return d <= allowedTypos(q) ? 1 - d / 10 : 0;
  };
  const score = (name: string) =>
    Math.max(0, ...nameKeys(name).flatMap((n) => qs.map((q) => scoreKey(n, q))));
  let best = 0;
  const byName = new Map<string, Contact>();
  for (const c of contacts) {
    const s = score(c.name);
    if (s === 0 || s < best) continue;
    if (s > best) {
      best = s;
      byName.clear();
    }
    if (!byName.has(c.name)) byName.set(c.name, c);
  }
  return [...byName.values()];
}

const canPrompt = () => AppState.currentState === 'active';
const NO_PERMISSION_HEADLESS = 'ამისთვის გახსენი აპი და მიეცი ნებართვა.';

/** Returns the line Mia should speak. */
export async function prepareSms(to: string, text: string): Promise<string> {
  const body = text.trim();
  const who = to.trim();
  if (!who || !body) return 'ვის და რა მივწერო?';

  // A dictated number is used as-is.
  if (/^\+?[\d\s-]{5,}$/.test(who)) {
    const number = who.replace(/[\s-]/g, '');
    pending = {
      kind: 'ready',
      to: { name: number, number },
      text: body,
      expiresAt: Date.now() + PENDING_TTL_MS,
    };
    return readBack(number, body);
  }

  if (!Native) return 'SMS-ის გაგზავნა ამ მოწყობილობაზე არ შემიძლია.';
  if (!(await ensureContactsPermission(canPrompt()))) {
    return canPrompt()
      ? 'კონტაქტების ნებართვის გარეშე ადრესატს ვერ ვიპოვი.'
      : NO_PERMISSION_HEADLESS;
  }

  const matches = matchContacts(who, await Native.getContacts());
  const expiresAt = Date.now() + PENDING_TTL_MS;
  if (matches.length === 0) {
    pending = null;
    return `„${who}“ კონტაქტებში ვერ ვიპოვე.`;
  }
  if (matches.length === 1) {
    pending = { kind: 'ready', to: matches[0], text: body, expiresAt };
    return readBack(matches[0].name, body);
  }
  const options = matches.slice(0, MAX_OPTIONS);
  pending = { kind: 'choose', options, text: body, expiresAt };
  const names = options.map((o) => o.name);
  return `რამდენიმე კონტაქტი მოიძებნა: ${names.slice(0, -1).join(', ')} თუ ${
    names[names.length - 1]
  }?`;
}

const readBack = (name: string, text: string) =>
  `მიმღები: ${name}. ტექსტი: „${text}“. გავაგზავნო?`;

export async function confirmSms(): Promise<string> {
  const p = livePending();
  if (!p || p.kind !== 'ready') return 'გასაგზავნი შეტყობინება არ მაქვს.';
  if (!Native) return 'SMS-ის გაგზავნა ამ მოწყობილობაზე არ შემიძლია.';
  pending = null;
  if (await ensureSendSmsPermission(canPrompt())) {
    try {
      await Native.send(p.to.number, p.text);
      return 'გავაგზავნე.';
    } catch (err) {
      console.error('SMS send failed', err);
      return 'გაგზავნა ვერ მოხერხდა.';
    }
  }
  // No SEND_SMS (denied, or stripped from the manifest if Play refuses it):
  // hand off to the Messages app. Can't start an Activity from the background.
  if (!canPrompt()) return NO_PERMISSION_HEADLESS;
  await Native.openComposer(p.to.number, p.text);
  return 'გავხსენი შეტყობინებები — დააჭირე გაგზავნას.';
}

export function cancelSms(): string {
  pending = null;
  return 'კარგი, არ გავაგზავნე.';
}
