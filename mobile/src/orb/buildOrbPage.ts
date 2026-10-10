// Assembles the orb's self-contained HTML page (no network, no libraries).
//
// Script order matters:
//   1. rnLog + error reporting
//   2. TTS engine   — Mia's voice; must survive any rendering failure
//   3. window API   — the native contract (setOrbState, setHover, …)
//   4. renderer     — WebGL, or the Canvas2D fallback
//   5. dev tools    — only when the caller passes them (dev builds / preview)
//
// Dev tools are passed in as a string rather than imported here, so release
// bundles never contain them (MiaOrb requires them behind __DEV__).

import { mergeConfig, STATE_KEYS, type OrbConfigOverrides } from './config';
import { ORB_COMPOSITE_FRAG, ORB_INTERIOR_FRAG, ORB_VERT } from './glsl';
import { ORB_API_JS } from './page/api';
import { ORB_RENDERER_JS } from './page/renderer';
import { TTS_ENGINE_JS } from './page/ttsEngine';

export type BuildOrbPageOpts = {
  config?: OrbConfigOverrides;
  /** Floating-overlay entrance/exit (spring in, pop out via setOrbVisible). */
  floatIn?: boolean;
  /** Dev-only in-page tools (synthetic voice, perf reports). */
  devTools?: string | null;
  /** Force the Canvas2D fallback (dev/testing). */
  forceFallback?: boolean;
};

type Rgb = [number, number, number];

/** Must match the shader's uPal[] order. */
export const PAL_KEYS = ['violet', 'pink', 'coral', 'pinkSoft', 'violetSoft', 'white', 'navy'] as const;

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** HSV with hue in turns (0..1). */
function rgbToHsv([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [h / 6, max > 0 ? d / max : 0, max];
}

/** Chartreuse (90°): the side of the wheel a palette cross-fade never crosses. */
export const AVOID_HUE = 0.25;

/**
 * The translator cross-fade, per role: [h0, s0, v0, h1, s1, v1], with h1
 * unwrapped so a straight lerp goes round the hue wheel the way that misses
 * AVOID_HUE. A plain RGB blend from the pink/coral theme to the teal palette
 * passes through grey and beige; this way the orb sweeps through violet and
 * blue instead.
 */
export function tintPath(from: readonly string[], to: readonly string[]): number[] {
  return from.flatMap((hex, i) => {
    const a = rgbToHsv(hexToRgb(hex));
    const b = rgbToHsv(hexToRgb(to[i]));
    // A grey has no hue of its own: it takes the other end's.
    if (a[1] < 0.02) a[0] = b[0];
    if (b[1] < 0.02) b[0] = a[0];
    const up = (b[0] - a[0] + 1) % 1;
    const upCrosses = (AVOID_HUE - a[0] + 1) % 1 < up;
    const h1 = upCrosses ? a[0] - (1 - up) : a[0] + up;
    return [a[0], a[1], a[2], h1, b[1], b[2]];
  });
}

/** Page-side JSON. `<` is escaped so no string can close the <script>. */
function pageConfig(opts: BuildOrbPageOpts): string {
  const cfg = mergeConfig(opts.config);
  const pal = cfg.palette;
  const order = PAL_KEYS.map((k) => pal[k]);
  const tp = cfg.translatorPalette;
  const tintOrder = PAL_KEYS.map((k) => tp[k]);
  const palRgb = Object.fromEntries(
    Object.entries(pal).map(([k, v]) => [k, hexToRgb(v)]),
  );
  const json = JSON.stringify({
    stateKeys: STATE_KEYS,
    states: cfg.states,
    springs: cfg.springs,
    radius: cfg.radius,
    breathPeriod: cfg.breathPeriod,
    audio: cfg.audio,
    voice: cfg.voice,
    interaction: cfg.interaction,
    knot: cfg.knot,
    choreography: cfg.choreography,
    pacing: cfg.pacing,
    reducedMotion: cfg.reducedMotion,
    quality: cfg.quality,
    pal: order.flatMap(hexToRgb),
    palKeys: PAL_KEYS,
    palRgb,
    palTint: tintOrder.flatMap(hexToRgb),
    tintHsv: tintPath(order, tintOrder),
    tintMs: cfg.tintMs,
    vert: ORB_VERT,
    fragInterior: ORB_INTERIOR_FRAG,
    fragComposite: ORB_COMPOSITE_FRAG,
    floatIn: !!opts.floatIn,
    dev: !!opts.devTools,
  });
  return json.replace(/</g, '\\u003c');
}

export function buildOrbPage(opts: BuildOrbPageOpts = {}): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; width: 100%; background: transparent; overflow: hidden; }
  body { -webkit-tap-highlight-color: transparent; touch-action: none; pointer-events: none; -webkit-user-select: none; user-select: none; }
  #orb-container { position: absolute; inset: 0; }
  canvas { display: block; width: 100%; height: 100%; }
  body.float-in #orb-container {
    opacity: 0;
    transform: translateY(24px) scale(0.72);
    transform-origin: 50% 55%;
    transition: transform 460ms cubic-bezier(0.3, 1.35, 0.5, 1), opacity 260ms ease-out;
    will-change: transform, opacity;
  }
  body.float-in #orb-container.visible { opacity: 1; transform: translateY(0) scale(1); }
  body.float-in #orb-container.exiting { animation: orbExit 300ms cubic-bezier(0.4, 0, 0.7, 0.2) forwards; }
  @keyframes orbExit {
    0%   { opacity: 1; transform: translateY(0) scale(1); }
    28%  { opacity: 1; transform: translateY(-6px) scale(1.06); }
    100% { opacity: 0; transform: translateY(10px) scale(0.3); }
  }
</style>
</head>
<body>
<div id="orb-container"></div>
<script>
  function rnLog(kind, payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ kind: kind, payload: payload }));
      }
    } catch (_) {}
  }
  window.addEventListener('error', function (e) {
    rnLog('error', String(e.message || e.error || e));
  });
  window.addEventListener('unhandledrejection', function (e) {
    rnLog('error', 'unhandledrejection: ' + String(e.reason));
  });
  window.__orbCfg = ${pageConfig(opts)};
  window.__orbForceFallback = ${opts.forceFallback ? 'true' : 'false'};
</script>
<script>${TTS_ENGINE_JS}</script>
<script>${ORB_API_JS}</script>
<script>${ORB_RENDERER_JS}</script>
${opts.devTools ? `<script>${opts.devTools}</script>` : ''}
</body>
</html>`;
}
