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

// Contacts are often saved in Latin ("Nino", "Deda") while the user speaks
// Georgian, so both sides are folded to Latin before comparing.
// ponytail: plain letter map; Latin spelling variants (x/kh, c/ts) won't match.
const GEO_TO_LAT: Record<string, string> = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i',
  კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh', რ: 'r', ს: 's',
  ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'q', შ: 'sh', ჩ: 'ch', ც: 'ts',
  ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h',
};

const fold = (s: string) =>
  [...s.toLowerCase()]
    .map((ch) => GEO_TO_LAT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();

/** Best-matching contacts for a spoken name: exact > a word matches > substring.
 *  One entry per contact name (first number wins). */
export function matchContacts(query: string, contacts: Contact[]): Contact[] {
  const q = fold(query);
  if (!q) return [];
  const score = (name: string) => {
    const n = fold(name);
    if (n === q) return 3;
    if (n.split(' ').includes(q) || n.startsWith(q + ' ')) return 2;
    return n.includes(q) ? 1 : 0;
  };
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
