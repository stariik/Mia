import { PermissionsAndroid, Platform } from 'react-native';

export async function ensureMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'მიკროფონის წვდომა',
      message: 'Mia-ს ხმით ასაუბრებად გვჭირდება მიკროფონი.',
      buttonPositive: 'დათანხმება',
      buttonNegative: 'უარი',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if ((Platform.Version as number) < 33) return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    {
      title: 'შეტყობინებები',
      message: 'ტაიმერისა და მაღვიძარას ამცნობად ჭირდება ნებართვა.',
      buttonPositive: 'დათანხმება',
      buttonNegative: 'უარი',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    {
      title: 'მდებარეობის წვდომა',
      message: 'ამინდის ინფორმაციისთვის Mia-ს ჭირდება თქვენი ქალაქი.',
      buttonPositive: 'დათანხმება',
      buttonNegative: 'უარი',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}
