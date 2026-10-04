// Maps internal pipeline error strings (English, technical) to what a Georgian
// user should actually read. Anything unrecognized falls back to a generic
// message — raw errors never reach release users, but dev builds append the
// original string for diagnosis.

const GENERIC = 'სერვერთან კავშირი ვერ მოხერხდა';

const GEORGIAN_RE = /[Ⴀ-ჿ]/; // already-localized messages pass through

type Rule = { test: RegExp; message: string };

const RULES: Rule[] = [
  { test: /connection (stalled|lost|timed out)|audio stopped arriving|phone stopped responding/i,
    message: 'კავშირი შეწყდა — შეამოწმეთ ინტერნეტი და სცადეთ თავიდან' },
  { test: /no speech|no complete speech|incomplete speech|transcription took too long/i,
    message: 'საუბარი ვერ ამოვიცანი — სცადეთ თავიდან' },
  { test: /microphone (interrupted|stopped)|audio route changed|unsupported microphone/i,
    message: 'მიკროფონი გაითიშა — შეამოწმეთ ყურსასმენი და სცადეთ თავიდან' },
  { test: /listening limit reached/i,
    message: 'მოსმენის ლიმიტი ამოიწურა — სცადეთ მოგვიანებით' },
  { test: /too many attempts/i,
    message: 'ძალიან ბევრი მცდელობა — მოიცადეთ ერთი წუთი' },
  { test: /update expo go/i,
    message: 'განაახლეთ Expo Go და სცადეთ თავიდან' },
  { test: /streaming disabled/i,
    message: 'მოსმენა განახლდა — დასაწყებად კვლავ შეეხეთ ორბს' },
  { test: /speech service unavailable|unable to connect to speech/i,
    message: 'ხმის ამოცნობა მიუწვდომელია — სცადეთ მოგვიანებით' },
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
  // RN fetch's catch-all: thrown when the phone is offline, but also when the
  // server is down, DNS is wrong or its TLS certificate doesn't match. Don't
  // claim "no internet" — that sends users debugging a connection that works.
  {
    test: /network request failed/i,
    message: 'სერვერთან დაკავშირება ვერ მოხერხდა — შეამოწმეთ ინტერნეტი ან სცადეთ მოგვიანებით',
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
