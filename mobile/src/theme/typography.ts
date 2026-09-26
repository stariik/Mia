// On Android, `fontFamily` matches the TTF filename stem (not the PostScript name).
// iOS and Expo Go get the same names from fontFiles.ts, loaded at startup in
// App.tsx — a new font must be added there too.
// Filenames under assets/fonts/ (the ONLY families that exist in the app):
//   MarkGEO-Regular.ttf / MarkGEO-Bold.ttf / MarkGEO-CAPS.ttf
//   SpaceGrotesk-Bold.ttf   (numeric/clock displays — Latin+digits only)
//   MarckScript-Regular.ttf (the "Mia" wordmark — connected script)
//
// MarkGEO is the primary font — proper Georgian glyphs; Latin renders fine in
// it too. Every fontFamily in the app MUST come from `fonts` below: a literal
// naming a family that isn't bundled silently falls back to Roboto.

import type { TextStyle } from 'react-native';

export const fonts = {
  displayBold: 'MarkGEO-Bold',
  headlineMedium: 'MarkGEO-Bold',
  body: 'MarkGEO-Regular',
  bodyBold: 'MarkGEO-Bold',
  caps: 'MarkGEO-CAPS',
  /** Big clock/countdown numerals (Latin digits only — no Georgian glyphs). */
  numeric: 'SpaceGrotesk-Bold',
  /** The "Mia" brand wordmark only. */
  brand: 'MarckScript-Regular',
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
