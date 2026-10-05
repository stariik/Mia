// MiaOrb tuning — every speed, intensity, spring and envelope lives here.
//
// Colours come straight from the theme and are LOCKED: the shader only mixes
// these, scales their brightness and blends them. It never rotates hue.
// The one sanctioned exception is translator mode: `translatorPalette` is a
// complete second palette (same seven roles) the page cross-fades the palette
// uniforms to (see `tint`). At tint 0 the page uploads exactly `palette`,
// untouched.
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
  /** How strongly the medium swirls around the thought (thinking), 0..1. */
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

  /**
   * Translator mode — "night water": the same glass and motion, lit from a
   * second palette (colorhunt.co/palette/321e4843637e65dcd5d9fff4) whose four
   * swatches run dark → light the way the roles do: plum #321e48 is the glass
   * depth, turquoise #65dcd5 the heart, mint #d9fff4 the sparkles, pulses and
   * warm rim. The roles between are those swatches made to read as light:
   * the ink is #321e48 lifted to a glowing plum, and the silk sits between
   * slate #43637e and the turquoise — plum straight into turquoise would
   * pass through grey where they mix. Specular white leans mint; the cool
   * rim is a lavender cut from the plum.
   */
  translatorPalette: {
    violet: '#5e3a9c',
    pink: '#3fb0b8',
    coral: '#65dcd5',
    pinkSoft: '#d9fff4',
    violetSoft: '#cdbde6',
    white: '#effffa',
    navy: '#321e48',
  },

  /** Palette cross-fade into / out of translator mode (ms, smoothstep). The
   *  hue travels the cool way round (see buildOrbPage), so it never greys. */
  tintMs: 500,

  /** Sphere radius as a fraction of half the canvas (room for the edge AA). */
  radius: 0.86,

  states: {
    idle: { energy: 0.86, flow: 0.07, warmth: 0.42, vortex: 0, sparkle: 0.1, lean: 0, dim: 0, core: 0.3, warp: 0.55, breath: 0.015 },
    listening: { energy: 1.0, flow: 0.12, warmth: 0.48, vortex: 0, sparkle: 0.3, lean: 0.14, dim: 0, core: 0.31, warp: 0.65, breath: 0.01 },
    // Focused: the medium dims and cools so the thought itself is the light.
    thinking: { energy: 0.74, flow: 0.06, warmth: 0.3, vortex: 1, sparkle: 0.05, lean: 0.04, dim: 0, core: 0.2, warp: 0.36, breath: 0.006 },
    speaking: { energy: 1.0, flow: 0.13, warmth: 0.56, vortex: 0, sparkle: 0.24, lean: 0, dim: 0, core: 0.29, warp: 0.68, breath: 0.006 },
    error: { energy: 0.6, flow: 0.025, warmth: 0.22, vortex: 0, sparkle: 0.02, lean: 0, dim: 1, core: 0.26, warp: 0.4, breath: 0.008 },
  } satisfies Record<OrbState, StateLook>,

  /** Per-parameter springs: brightness leads, the swirl lags — overlap. */
  springs: {
    energy: { freq: 1.2, damping: 1 },
    flow: { freq: 0.5, damping: 1 },
    warmth: { freq: 0.6, damping: 1 },
    vortex: { freq: 0.4, damping: 1 },
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

  /**
   * The thought (thinking): one continuous (3, q) torus knot — a single strand
   * winding 3 times around its orbit and q times around its own tube. q must
   * not be a multiple of 3 (else it splits into separate loops). Low q reads
   * as loose crossing rings; ~10 reads as one braided rope of light.
   */
  knot: {
    q: 10,
    /** Orbit and tube radius, strand width (sphere units). */
    radius: 0.56,
    tube: 0.055,
    /** Orbit plane tilt toward the viewer (rad), its slow drift, and precession. */
    incline: 1.0,
    inclineDrift: 0.08,
    precess: 0.16,
    /** Cruise spin (rad/s) and the strands' roll around the tube (rad/s). */
    spin: 0.5,
    roll: 0.7,
    /** How much the medium is dragged along by the spin. */
    mediumDrag: 0.32,
    /** "Deliberation" breath: the knot tightens and releases (s). */
    breathPeriod: 3.6,
    /** Drawn out of the core like a pen stroke (s), after a short delay —
     *  longer when coming from listening, so the words are absorbed first. */
    traceS: 1.35,
    traceDelay: 0.08,
    traceDelayAfterListening: 0.26,
    /** Born at (and dissolves into) the core; released outward into speech. */
    birthRadius: 0.1,
    birthIncline: 0.35,
    releaseRadius: 0.95,
    releaseIncline: 0.45,
    /** Thought pulses travelling along the strand: speeds in knot-lengths/s
     *  (negative runs backwards, so pulses meet and flare). */
    pulses: [0.105, 0.16, -0.074],
    /** How brightly the thought lights the ink around it. */
    light: 0.55,
    pulseLight: 1.3,
    /** The longer Mia thinks, the more focused the thought gets (s → full). */
    focusAfterS: 1.5,
    focusFullS: 6,
    focusSpin: 0.35,
    focusTighten: 0.25,
    springs: {
      alphaIn: { freq: 2.0, damping: 1 },
      alphaOut: { freq: 1.2, damping: 1 },
      alphaRelease: { freq: 0.9, damping: 1 },
      radius: { freq: 0.85, damping: 0.6 },
      radiusOut: { freq: 1.0, damping: 1 },
      incline: { freq: 0.55, damping: 0.8 },
      spin: { freq: 0.3, damping: 1 },
    },
  },

  /** Hand-offs between states. */
  choreography: {
    /** A state change to idle shorter than this is treated as noise (s). */
    idleGraceS: 0.25,
    /** Listening → thinking: the words are drawn into the core first. */
    absorbRiseS: 0.14,
    absorbDecayS: 0.5,
    absorbLean: 0.3,
    absorbCore: 0.3,
    absorbGlow: 2.0,
    /** The medium dims as its light is drawn into the core. */
    absorbDim: 0.25,
  },

  /** Frame pacing: full rate only while something is actually moving. */
  pacing: {
    activeFps: 60,
    calmFps: 30,
    /** Seconds of stillness before dropping to calmFps. */
    calmAfterS: 0.8,
    /** Activity level that counts as "moving". */
    activityOn: 0.05,
  },

  reducedMotion: {
    flow: 0.3,
    voice: 0.35,
    ripples: false,
    tilt: false,
    breath: 0.35,
  },

  quality: {
    /**
     * Adaptive tiers, best first. `dpr` caps devicePixelRatio for the crisp
     * pass (glass, the thought, sparkles); the soft interior volume renders at
     * `inner` × that resolution and is upsampled — most of the look for a
     * fraction of the cost.
     */
    tiers: [
      { dpr: 2.0, slices: 7, inner: 0.6 },
      { dpr: 1.75, slices: 6, inner: 0.62 },
      { dpr: 1.5, slices: 6, inner: 0.6 },
      { dpr: 1.5, slices: 5, inner: 0.5 },
      { dpr: 1.25, slices: 5, inner: 0.5 },
      { dpr: 1.0, slices: 4, inner: 0.5 },
    ],
    startTier: 1,
    /** Drawn frames slower than target × this, for `downAfterS` → step down. */
    slowFactor: 1.2,
    downAfterS: 1.2,
    /** On target for `upAfterS` → recover a tier (never above startTier). */
    upAfterS: 6,
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
