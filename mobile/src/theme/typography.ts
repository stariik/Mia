// On Android, `fontFamily` matches the TTF filename stem (not the PostScript
// name). iOS and Expo Go get the same names from fontFiles.ts, loaded at
// startup in App.tsx — a new font must be added there too, and copied into
// android/app/src/main/assets/fonts.
//
// FiraGO is the one text family: a humanist sans drawn for Georgian
// (Mkhedruli), Latin and Cyrillic alike, so a Georgian reply, an English
// quote and a Russian translation sit on the same line with matching colour
// and x-height. Bundled subset: Latin, Cyrillic, Georgian, punctuation.
// Every fontFamily in the app MUST come from `fonts` below: a literal naming a
// family that isn't bundled silently falls back to Roboto.

import type { TextStyle } from 'react-native';

export const fonts = {
  body: 'FiraGO-Regular',
  medium: 'FiraGO-Medium',
  bodyBold: 'FiraGO-SemiBold',
  /** Kept for screens that ask for a display weight by name. */
  displayBold: 'FiraGO-SemiBold',
  headlineMedium: 'FiraGO-Medium',
  /** The "Mia" brand wordmark only. */
  brand: 'MarckScript-Regular',
};

// Georgian has tall ascenders AND deep descenders on most letters (ბ, ფ, ყ,
// ჰ…), so every size gets ~1.5× leading — tighter clips or crowds them.
//
// The scale (size / line):
//   display 30/40 · title 20/28 · reading 17/27 · body 15/23 · caption 13/19
//   · micro 12/16
export const typography = {
  display: {
    fontFamily: fonts.medium,
    fontSize: 30,
    lineHeight: 40,
    letterSpacing: -0.4,
  },
  title: {
    fontFamily: fonts.medium,
    fontSize: 20,
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  /** Mia's replies and translations — the text people actually read. */
  reading: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 27,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 23,
  },
  bodyMedium: {
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 23,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
  },
  /** Small labels above groups. Sentence case — Georgian has no caps. */
  label: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.3,
  },
  /** Tabular figures for times and countdowns. */
  numeric: {
    fontFamily: fonts.body,
    fontVariant: ['tabular-nums'],
  },
  // ── Legacy names (the auth flow) ─────────────────────────────────────────
  bodyLg: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 27,
  },
  bodySmall: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
  },
} satisfies Record<string, TextStyle>;
