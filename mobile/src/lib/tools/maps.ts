import { Linking } from 'react-native';

// Voice directions: open_directions only QUEUES the Maps link; the turn opens
// it after Mia has finished speaking (see runAssistantTurn). Opening first
// would background the app and cut her reply off mid-sentence.

export type TravelMode = 'driving' | 'walking' | 'bicycling' | 'transit';
const MODES: TravelMode[] = ['driving', 'walking', 'bicycling', 'transit'];

/** Google Maps URL — opens the Maps app when installed (browser otherwise) and
 *  starts turn-by-turn navigation; transit has no navigation, so it previews. */
export function directionsUrl(destination: string, mode?: string): string {
  const travelmode = MODES.includes(mode as TravelMode) ? mode : 'driving';
  return (
    'https://www.google.com/maps/dir/?api=1' +
    `&destination=${encodeURIComponent(destination.trim())}` +
    `&travelmode=${travelmode}&dir_action=navigate`
  );
}

let queued: string | null = null;

export function queueDirections(destination: string, mode?: string) {
  queued = destination.trim() ? directionsUrl(destination, mode) : null;
}

export function clearQueuedApp() {
  queued = null;
}

/** Opens the queued app, if any. True = the user was handed off to Maps, so
 *  the voice session should end instead of listening over navigation. */
export async function openQueuedApp(): Promise<boolean> {
  const url = queued;
  queued = null;
  if (!url) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch (err) {
    console.error('Opening Maps failed', err);
    return false;
  }
}
