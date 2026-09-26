// Runtime font registration (expo-font). Android release builds also carry
// these natively in android/app/src/main/assets/fonts, but Expo Go and the
// iOS app only get them this way. Keys MUST equal the names in `fonts`
// (typography.ts) so every `fontFamily` resolves on both platforms.

export const fontFiles = {
  'MarkGEO-Regular': require('../../assets/fonts/MarkGEO-Regular.ttf'),
  'MarkGEO-Bold': require('../../assets/fonts/MarkGEO-Bold.ttf'),
  'MarkGEO-CAPS': require('../../assets/fonts/MarkGEO-CAPS.ttf'),
  'SpaceGrotesk-Bold': require('../../assets/fonts/SpaceGrotesk-Bold.ttf'),
  'MarckScript-Regular': require('../../assets/fonts/MarckScript-Regular.ttf'),
};
