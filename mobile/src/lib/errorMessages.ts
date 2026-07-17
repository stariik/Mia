// Maps internal pipeline error strings (English, technical) to what a Georgian
// user should actually read. Anything unrecognized falls back to a generic
// message — raw errors never reach release users, but dev builds append the
// original string for diagnosis.

const GENERIC = 'სერვერთან კავშირი ვერ მოხერხდა';

const GEORGIAN_RE = /[Ⴀ-ჿ]/; // already-localized messages pass through

type Rule = { test: RegExp; message: string };

const RULES: Rule[] = [
  // Couldn't hear / understand the user.
  {
    test: /empty (recording|transcription)|transcription timed out|chirp 2/i,
    message: 'ვერ გავიგე — გაიმეორეთ, გთხოვთ',
  },
  // The model reply never arrived / stalled mid-stream.
  {
    test: /stream stalled|chat (stream )?failed/i,
    message: 'პასუხი ვერ მოვიდა — სცადეთ თავიდან',
  },
  // Device offline (RN fetch's canonical offline error).
  {
    test: /network request failed/i,
    message: 'ინტერნეტ კავშირი არ არის',
  },
  // Server-side guard responses.
  { test: /rate limit|429/i, message: 'ძალიან ბევრი მოთხოვნა — მოიცადეთ წუთით' },
  { test: /unauthorized|401/i, message: 'სესია ამოიწურა — გაიარეთ ავტორიზაცია' },
  { test: /daily limit/i, message: 'დღიური ლიმიტი ამოიწურა — სცადეთ ხვალ' },
  // Mic permission (thrown by usePcmRecorder / recorder start).
  {
    test: /microphone permission/i,
    message: 'მიკროფონის ნებართვა საჭიროა — ჩართეთ პარამეტრებში',
  },
  { test: /tts|synthesis|playback/i, message: 'ხმის დაკვრა ვერ მოხერხდა' },
];

export function userErrorMessage(err: string | null | undefined): string {
  if (!err) return GENERIC;
  if (GEORGIAN_RE.test(err)) return err; // already user-facing Georgian
  const rule = RULES.find((r) => r.test.test(err));
  const message = rule?.message ?? GENERIC;
  return __DEV__ ? `${message}\n(${err})` : message;
}
