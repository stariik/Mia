// On Android, `fontFamily` matches the TTF filename stem (not the PostScript name).
// Filenames under assets/fonts/:
//   MarkGEO-Regular.ttf
//   MarkGEO-Bold.ttf
//   MarkGEO-CAPS.ttf       (all-caps variant — designed for uppercase labels)
//   SpaceGrotesk-Medium.ttf, SpaceGrotesk-Bold.ttf  (kept as fallback)
//   Manrope-Regular.ttf, Manrope-SemiBold.ttf      (kept as fallback)
//
// MarkGEO is now the project's primary font — it has proper Georgian glyphs.
// Latin renders fine in it too, so the same family covers brand titles.

import type { TextStyle } from 'react-native';

export const fonts = {
  displayBold: 'MarkGEO-Bold',
  headlineMedium: 'MarkGEO-Bold',
  body: 'MarkGEO-Regular',
  bodyBold: 'MarkGEO-Bold',
  caps: 'MarkGEO-CAPS',
};

export const typography: Record<string, TextStyle> = {
  display: {
    fontFamily: fonts.displayBold,
    fontSize: 48,
    lineHeight: 53,
    letterSpacing: -0.96,
  },
  headline: {
    fontFamily: fonts.headlineMedium,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.32,
  },
  title: {
    fontFamily: fonts.headlineMedium,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  bodyLg: {
    fontFamily: fonts.body,
    fontSize: 18,
    lineHeight: 29,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 24,
  },
  bodySmall: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
  labelSm: {
    fontFamily: fonts.caps,
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: 0.6,
    // MarkGEO-CAPS already renders all-caps glyphs; no textTransform needed.
  },
  mono: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.4,
  },
};
