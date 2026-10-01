// Loaded lazily: a build that predates expo-clipboard's native module should
// fail to copy, not crash at launch.
export async function copyText(text: string): Promise<boolean> {
  try {
    const Clipboard: typeof import('expo-clipboard') = require('expo-clipboard');
    await Clipboard.setStringAsync(text);
    return true;
  } catch (e) {
    console.warn('[Clipboard] copy failed', e);
    return false;
  }
}
