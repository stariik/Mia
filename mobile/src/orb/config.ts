// MiaOrb tuning — every speed, intensity, spring and envelope lives here.
//
// Colours come straight from the theme and are LOCKED: the shader only mixes
// these, scales their brightness and blends them. It never rotates hue.
//
// Springs are specified like a designer would: `freq` (Hz — how fast it moves)
// and `damping` (1 = critically damped / no overshoot, <1 = settles with a
// little overshoot, i.e. weight). Envelopes are in milliseconds.

import { colors } from '../theme/colors';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export type Spring = { freq: number; damping: number };

/** One state's "personality". Every field morphs continuously between states
 *  through its own spring (see `springs`), so transitions overlap organically. */
export type StateLook = {
  /** Overall interior light (1 = nominal). */
  energy: number;
  /** Flow speed of the ink/silk medium (noise units per second). */
  flow: number;
  /** Colour temperature bias: 0 cool violet, 1 hot coral. */
  warmth: number;
  /** Braided orbit (thinking) amount, 0..1. */
  vortex: number;
  /** Ambient sparkle density, 0..1 (audio adds on top). */
  sparkle: number;
  /** Currents gather in and lean toward the viewer (+) or push out (−). */
  lean: number;
  /** Error dimming / de-energizing, 0..1. */
  dim: number;
  /** Core radius (fraction of the sphere). */
  core: number;
  /** Domain-warp strength of the currents. */
  warp: number;
  /** Breathing scale amplitude (fraction of size). */
  breath: number;
};

export const STATE_KEYS = [
  'energy',
  'flow',
  'warmth',
  'vortex',
  'sparkle',
  'lean',
  'dim',
  'core',
  'warp',
  'breath',
] as const satisfies readonly (keyof StateLook)[];

export const ORB_CONFIG = {
  palette: {
    violet: colors.gradientStart, // #6d3bf5
    pink: colors.gradientMid, // #ff4d8b
    coral: colors.gradientEnd, // #ff6b3d
    // Soft tints already in the theme — used only for glass light (rim/spec).
    pinkSoft: colors.primarySoft, // #ffd9e6
    violetSoft: colors.secondarySoft, // #d9c9ff
    white: colors.text, // #eef0ff
    // Navy the light is absorbed into (the glass body's depth).
    navy: colors.surfaceSolid, // #1a1b2c
  },

  /** Sphere radius as a fraction of half the canvas (room for the edge AA). */
  radius: 0.86,

  states: {
    idle: { energy: 0.86, flow: 0.07, warmth: 0.42, vortex: 0, sparkle: 0.1, lean: 0, dim: 0, core: 0.3, warp: 0.55, breath: 0.015 },
    listening: { energy: 1.0, flow: 0.12, warmth: 0.48, vortex: 0, sparkle: 0.3, lean: 0.14, dim: 0, core: 0.31, warp: 0.65, breath: 0.01 },
    thinking: { energy: 0.94, flow: 0.08, warmth: 0.3, vortex: 1, sparkle: 0.2, lean: 0.05, dim: 0, core: 0.24, warp: 0.4, breath: 0.006 },
    speaking: { energy: 1.0, flow: 0.13, warmth: 0.56, vortex: 0, sparkle: 0.24, lean: 0, dim: 0, core: 0.29, warp: 0.68, breath: 0.006 },
    error: { energy: 0.6, flow: 0.025, warmth: 0.22, vortex: 0, sparkle: 0.02, lean: 0, dim: 1, core: 0.26, warp: 0.4, breath: 0.008 },
  } satisfies Record<OrbState, StateLook>,

  /** Per-parameter springs: brightness leads, the vortex lags — overlap. */
  springs: {
    energy: { freq: 1.6, damping: 0.85 },
    flow: { freq: 0.5, damping: 1 },
    warmth: { freq: 0.6, damping: 1 },
    vortex: { freq: 0.45, damping: 0.95 },
    sparkle: { freq: 1.0, damping: 1 },
    lean: { freq: 0.9, damping: 0.7 },
    dim: { freq: 0.5, damping: 1 },
    core: { freq: 0.9, damping: 0.75 },
    warp: { freq: 0.7, damping: 1 },
    breath: { freq: 0.6, damping: 1 },
  } satisfies Record<keyof StateLook, Spring>,

  /** Breathing period (seconds). */
  breathPeriod: 6.5,

  audio: {
    /** Band edges in Hz (mic side is 16 kHz, so high tops out at 7 kHz). */
    bands: { low: [80, 300], mid: [300, 2000], high: [2000, 7000] },
    /** Envelope follower: fast attack, soft release (ms). */
    attackMs: 25,
    releaseMs: 220,
    /** Sparkles get a longer tail so they shimmer instead of blink. */
    highReleaseMs: 320,
    /** Spectral-flux threshold for a syllable onset (0..1 scale). */
    onsetThreshold: 0.11,
    /** Minimum gap between syllable ripples (ms). */
    onsetMinGapMs: 120,
    /** Voice-activity gate on the normalized level (hysteresis pair). */
    voiceOn: 0.16,
    voiceOff: 0.08,
    /** If the mic feed goes quiet for this long, treat it as silence (ms). */
    micStaleMs: 260,
  },

  /** How the voice drives the interior. */
  voice: {
    /** Low band → core swell. Spring is underdamped so it has real weight. */
    coreSwell: 0.6,
    coreSpring: { freq: 2.1, damping: 0.42 },
    /** Mid band → currents twist and accelerate. */
    twist: 1.4,
    twistSpring: { freq: 1.5, damping: 0.6 },
    flowBoost: 0.55,
    /** High band → sparkle shimmer. */
    sparkle: 1.0,
    /** User voice pulls the medium in and toward the viewer. */
    pull: 0.75,
    /** Mia's voice pushes it out from the core. */
    push: 0.3,
    pullSpring: { freq: 1.2, damping: 0.65 },
    /** Brightness lift from loudness. */
    energyGain: 0.42,
    /** Syllable ripples: travel speed (sphere radii / s) and strength. */
    rippleSpeed: 1.25,
    rippleStrength: 1.0,
    /** Continuous radial streaming (in for the user, out for Mia), rad/s. */
    streamSpeed: 2.4,
  },

  interaction: {
    /** Max tilt from touch, in sphere units of parallax. */
    touchTilt: 0.22,
    tiltSpring: { freq: 1.4, damping: 0.55 },
    /** Device orientation tilt (Android WebView; best effort). */
    orientationTilt: 0.14,
    /** Degrees of phone tilt that map to full orientation tilt. */
    orientationRangeDeg: 28,
    /** Seconds for the "neutral" holding angle to adapt. */
    orientationBaselineS: 2.5,
    /** Shell dip on press (fraction of size) and its spring. */
    pressDip: 0.028,
    pressSpring: { freq: 3.2, damping: 0.38 },
  },

  reducedMotion: {
    flow: 0.3,
    voice: 0.35,
    ripples: false,
    tilt: false,
    breath: 0.35,
  },

  quality: {
    /** Adaptive tiers, best first. dpr is a cap on devicePixelRatio. */
    tiers: [
      { dpr: 2.0, slices: 6 },
      { dpr: 1.5, slices: 6 },
      { dpr: 1.5, slices: 5 },
      { dpr: 1.25, slices: 5 },
      { dpr: 1.0, slices: 4 },
      { dpr: 0.85, slices: 4 },
    ],
    startTier: 1,
    /** Frame interval EMA above this (ms) for `downAfterS` → step down. */
    downMs: 19.5,
    downAfterS: 1.2,
    /** Below this for `upAfterS` → step back up (at most `maxUpgrades`). */
    upMs: 15.5,
    upAfterS: 6,
    maxUpgrades: 2,
  },
};

export type OrbConfig = typeof ORB_CONFIG;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};
export type OrbConfigOverrides = DeepPartial<OrbConfig>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge per-instance overrides onto the defaults (arrays replace). */
export function mergeConfig(overrides?: OrbConfigOverrides): OrbConfig {
  if (!overrides) return ORB_CONFIG;
  const merge = (base: unknown, over: unknown): unknown => {
    if (!isPlainObject(base) || !isPlainObject(over)) {
      return over === undefined ? base : over;
    }
    const out: Record<string, unknown> = { ...base };
    for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
    return out;
  };
  return merge(ORB_CONFIG, overrides) as OrbConfig;
}
