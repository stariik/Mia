// Mia palette — taken from the app logo: a violet → pink → coral gradient
// "M" on deep navy. Surfaces are navy glass; the brand accent is pink, with
// violet and coral as the gradient companions.

export const colors = {
  // Backdrop: deep navy (matches the logo's icon background), nearly black so
  // the orb + aurora pop.
  bg: '#0f1020',
  bgDeep: '#0a0b16',

  // Surfaces (glass uses these mixed with blur/wash)
  surface: 'rgba(26,27,44,0.55)',
  surfaceHigh: 'rgba(34,35,58,0.72)',
  surfaceElev: 'rgba(44,46,72,0.82)',
  surfaceSolid: '#1a1b2c', // opaque fallback — the logo navy

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

  // Brand gradient stops (LinearGradient for the brand mark, mic, CTAs,
  // progress fills) — violet → pink → coral, exactly the logo's "M".
  gradientStart: '#6d3bf5',
  gradientMid: '#ff4d8b',
  gradientEnd: '#ff6b3d',

  // Aurora backdrop blobs (very low alpha, drifting behind everything)
  auroraCyan: 'rgba(255,107,61,0.16)', // coral blob (key kept for compatibility)
  auroraViolet: 'rgba(125,60,245,0.22)',
  auroraDeep: 'rgba(40,20,70,0.55)',

  // Text
  text: '#eef0ff',
  textMuted: '#9aa3c8',
  outline: '#5e6a90',
  outlineVariant: '#2b3050',

  // Semantic
  success: '#74e0a0',
  warning: '#ffd28a',
  danger: '#ff7c8a',
  dangerSoft: '#ffd2d7',
  dangerBg: 'rgba(255,124,138,0.14)',
  dangerStroke: 'rgba(255,124,138,0.42)',
};

export const brandGradient = [
  colors.gradientStart,
  colors.gradientMid,
  colors.gradientEnd,
] as const;

export const motion = {
  fast: 180,
  base: 260,
  slow: 420,
  cinematic: 720,
};

export type ColorToken = keyof typeof colors;
