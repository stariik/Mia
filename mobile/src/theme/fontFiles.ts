// Runtime font registration (expo-font). Android release builds also carry
// these natively in android/app/src/main/assets/fonts, but Expo Go and the
// iOS app only get them this way. Keys MUST equal the names in `fonts`
// (typography.ts) so every `fontFamily` resolves on both platforms.

export const fontFiles = {
  'FiraGO-Regular': require('../../assets/fonts/FiraGO-Regular.ttf'),
  'FiraGO-Medium': require('../../assets/fonts/FiraGO-Medium.ttf'),
  'FiraGO-SemiBold': require('../../assets/fonts/FiraGO-SemiBold.ttf'),
  'Fredoka-SemiBold': require('../../assets/fonts/Fredoka-SemiBold.ttf'),
};
