import { PermissionsAndroid, Platform } from 'react-native';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';

type AndroidPermission = (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS];
type Rationale = {
  title: string;
  message: string;
  buttonPositive: string;
  buttonNegative: string;
};

// Permissions we've already *requested* this session. Re-requesting a
// previously-denied permission is auto-denied by Android WITHOUT showing any
// dialog — but the invisible GrantPermissionsActivity still steals window
// focus for ~150ms. Code paths that retry on AppState 'active' (like
// refreshLocation) then loop forever: request → focus loss → resume →
// 'active' → request… which broke keyboard focus app-wide (keyboard opened
// and instantly closed, cursor never blinked). So: background/automatic
// callers get ONE request per session, ever.
const requestedThisSession = new Set<string>();

// Android runs one permission request at a time: a second request while a
// dialog is up is rejected instantly with empty results, which RN reports as
// a denial. On first launch the notification and location prompts both fire
// from App's mount effect, so location was "denied" without the user ever
// seeing it. Queue the requests instead.
let requestQueue: Promise<unknown> = Promise.resolve();
function requestSerially(
  permission: AndroidPermission,
  rationale: Rationale,
): Promise<string> {
  const next = requestQueue.then(() =>
    PermissionsAndroid.request(permission, rationale),
  );
  requestQueue = next.catch(() => {});
  return next;
}

async function ensurePermission(
  permission: AndroidPermission,
  rationale: Rationale,
  opts: { requestPolicy: 'always' | 'once-per-session' },
): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  // check() never spawns the system activity — always safe.
  if (await PermissionsAndroid.check(permission)) return true;
  if (
    opts.requestPolicy === 'once-per-session' &&
    requestedThisSession.has(permission)
  ) {
    return false;
  }
  requestedThisSession.add(permission);
  const granted = await requestSerially(permission, rationale);
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export async function ensureMicrophonePermission(): Promise<boolean> {
  // Mic is only requested from a direct user action (tapping the orb), so a
  // repeat prompt is fine — it can't loop.
  if (Platform.OS === 'ios') {
    if ((await getRecordingPermissionsAsync()).granted) return true;
    return (await requestRecordingPermissionsAsync()).granted;
  }
  return ensurePermission(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'მიკროფონის წვდომა',
      message: 'Mia-ს ხმით ასაუბრებად გვჭირდება მიკროფონი.',
      buttonPositive: 'დათანხმება',
      buttonNegative: 'უარი',
    },
    { requestPolicy: 'always' },
  );
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android' && (Platform.Version as number) < 33) {
    return true;
  }
  return ensurePermission(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    {
      title: 'შეტყობინებები',
      message: 'ტაიმერისა და მაღვიძარას ამცნობად ჭირდება ნებართვა.',
      buttonPositive: 'დათანხმება',
      buttonNegative: 'უარი',
    },
    { requestPolicy: 'once-per-session' },
  );
}

export async function ensureLocationPermission(
  opts: { userInitiated?: boolean } = {},
): Promise<boolean> {
  return ensurePermission(
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    {
      title: 'მდებარეობის წვდომა',
      message: 'ამინდის ინფორმაციისთვის Mia-ს ჭირდება თქვენი ქალაქი.',
      buttonPositive: 'დათანხმება',
      buttonNegative: 'უარი',
    },
    // An explicit tap on "refresh" in settings may re-prompt; the automatic
    // refresh on app-foreground must never re-request.
    { requestPolicy: opts.userInitiated ? 'always' : 'once-per-session' },
  );
}

// Voice SMS. `canPrompt` is false when no Activity is in front (wake-word
// session with the app closed) — a system dialog can't show there, so only
// check. Once per session: a denied voice request must not re-prompt in a loop.
export async function ensureContactsPermission(canPrompt: boolean) {
  const p = PermissionsAndroid.PERMISSIONS.READ_CONTACTS;
  if (!canPrompt) return PermissionsAndroid.check(p);
  return ensurePermission(
    p,
    {
      title: 'კონტაქტების წვდომა',
      message: 'SMS-ის ადრესატის საპოვნელად Mia-ს სჭირდება კონტაქტები.',
      buttonPositive: 'დათანხმება',
      buttonNegative: 'უარი',
    },
    { requestPolicy: 'once-per-session' },
  );
}

export async function ensureSendSmsPermission(canPrompt: boolean) {
  const p = PermissionsAndroid.PERMISSIONS.SEND_SMS;
  if (!canPrompt) return PermissionsAndroid.check(p);
  return ensurePermission(
    p,
    {
      title: 'SMS-ის გაგზავნა',
      message: 'რომ Mia-მ შენი სახელით SMS გაგზავნოს, საჭიროა ნებართვა.',
      buttonPositive: 'დათანხმება',
      buttonNegative: 'უარი',
    },
    { requestPolicy: 'once-per-session' },
  );
}
