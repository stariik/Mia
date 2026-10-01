// Mia palette — taken from the app logo: a violet → pink → coral gradient
// "M" on deep navy. The interface itself is almost monochrome: navy ground,
// three steps of cool ink for text, hairlines for structure. Pink is the one
// accent and only marks something live (listening, a send that is ready, the
// selected option). Violet and coral belong to the orb and the wordmark.

export const colors = {
  // Ground: one flat navy, so fades and masks can match it exactly.
  bg: '#0f1020',
  bgDeep: '#0a0b16',

  // Raised planes (sheets, the composer, the drawer). Solid, never glass.
  surface: 'rgba(26,27,44,0.55)',
  surfaceHigh: 'rgba(34,35,58,0.72)',
  surfaceElev: 'rgba(44,46,72,0.82)',
  surfaceSolid: '#1a1b2c', // the logo navy
  sheet: '#131427',

  // Hairlines
  stroke: 'rgba(255,255,255,0.08)',
  strokeStrong: 'rgba(255,255,255,0.16)',
  strokeBrand: 'rgba(255,77,139,0.32)',
  strokeBrandSoft: 'rgba(255,77,139,0.16)',

  // Brand — pink is the signature accent (the logo's "i" dot + mid-gradient).
  primary: '#ff4d8b',
  primaryGlow: 'rgba(255,77,139,0.24)',
  primaryOn: '#ffffff',
  primarySoft: '#ffd9e6',

  secondary: '#6d3bf5',
  secondaryGlow: 'rgba(109,59,245,0.28)',
  secondarySoft: '#d9c9ff',

  // Brand gradient stops — the wordmark and the orb only.
  gradientStart: '#6d3bf5',
  gradientMid: '#ff4d8b',
  gradientEnd: '#ff6b3d',

  // Ink, three steps. All pass WCAG AA on bgDeep: text 17.3:1, textMuted
  // 7.9:1, textFaint 5.0:1 (captions and hints only — never body copy).
  // `outline` (3.7:1) is for hairline glyphs and decoration, never text.
  text: '#eef0ff',
  textMuted: '#9aa3c8',
  textFaint: '#7680a6',
  outline: '#5e6a90',
  outlineVariant: '#2b3050',

  // Semantic
  success: '#74e0a0',
  warning: '#ffd28a',
  danger: '#ff7c8a',
  dangerSoft: '#ffd2d7',
  dangerBg: 'rgba(255,124,138,0.14)',
  dangerStroke: 'rgba(255,124,138,0.42)',

  scrim: 'rgba(4,5,12,0.62)',
};

export const brandGradient = [
  colors.gradientStart,
  colors.gradientMid,
  colors.gradientEnd,
] as const;

/** `colors.bgDeep` at an alpha — for fades that must melt into the ground. */
export function bgAlpha(a: number): string {
  return `rgba(10,11,22,${a})`;
}

export type ColorToken = keyof typeof colors;
