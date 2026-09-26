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
  const granted = await PermissionsAndroid.request(permission, rationale);
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
