import { AVOID_HUE, PAL_KEYS, buildOrbPage } from '../src/orb/buildOrbPage';
import { ORB_CONFIG } from '../src/orb/config';
import { ORB_DEV_MARKER, ORB_DEV_TOOLS_JS } from '../src/orb/page/devTools';

function pageCfg(html: string) {
  const cfgLine = html.split('\n').find((l) => l.includes('window.__orbCfg ='))!;
  return JSON.parse(cfgLine.replace(/^\s*window\.__orbCfg = /, '').replace(/;\s*$/, ''));
}

/** Flat [r, g, b, …] (0..1) → ['#rrggbb', …]. */
function toHex(flat: number[]): string[] {
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  const out: string[] = [];
  for (let i = 0; i < flat.length; i += 3) {
    out.push(`#${hex(flat[i])}${hex(flat[i + 1])}${hex(flat[i + 2])}`);
  }
  return out;
}

describe('buildOrbPage', () => {
  const page = buildOrbPage();

  it('keeps the window API that OrbOverlayModule.kt and orbAudio inject', () => {
    for (const fn of [
      'setOrbState',
      'setHover',
      'setOrbVisible',
      'playTTSAudio',
      'speakTTSStream',
      'stopTTSAudio',
    ]) {
      expect(page).toMatch(new RegExp(`window\\.${fn} = `));
    }
  });

  it('installs the voice engine before the renderer', () => {
    expect(page.indexOf('window.speakTTSStream')).toBeLessThan(page.indexOf("getContext('webgl'"));
    expect(page.indexOf('window.setOrbState')).toBeLessThan(page.indexOf("getContext('webgl'"));
  });

  it('ships no dev tools unless asked', () => {
    expect(page).not.toContain(ORB_DEV_MARKER);
    expect(page).not.toContain('__orbDev');
    expect(buildOrbPage({ devTools: ORB_DEV_TOOLS_JS })).toContain(ORB_DEV_MARKER);
  });

  it('never lets embedded config close its <script> early', () => {
    const cfgLine = page.split('\n').find((l) => l.includes('window.__orbCfg ='))!;
    expect(cfgLine).not.toMatch(/<\/script/i);
    expect(cfgLine).not.toContain('<');
  });

  it('embeds exactly the theme palette (no other hues)', () => {
    const pal = toHex(pageCfg(page).pal);
    const p = ORB_CONFIG.palette;
    expect(pal).toEqual(
      [p.violet, p.pink, p.coral, p.pinkSoft, p.violetSoft, p.white, p.navy].map((c) => c.toLowerCase()),
    );
    expect(pal.slice(0, 3)).toEqual(['#6d3bf5', '#ff4d8b', '#ff6b3d']);
  });

  // Translator mode is the one sanctioned colour change: a complete second
  // palette the page cross-fades to on orb.setTint(1). The default palette
  // must be untouched by it.
  it('ships the translator palette separately, leaving the theme palette as is', () => {
    const cfg = pageCfg(page);
    expect(cfg.palTint).toHaveLength(cfg.pal.length);
    expect(cfg.palTint).not.toEqual(cfg.pal);
    // Every role, glass depth included, has its own translator colour.
    const tp = ORB_CONFIG.translatorPalette;
    expect(toHex(cfg.palTint)).toEqual(PAL_KEYS.map((k) => tp[k].toLowerCase()));
    expect(cfg.palKeys).toEqual(PAL_KEYS);
    expect(cfg.tintMs).toBe(500);
    expect(page).toContain('setTint: setTint');
    // Starts untinted, and nothing re-uploads until the tint moves.
    expect(page).toContain('tint: 0,');
    expect(page).toContain('if (tintX === I.tint) return;');
  });

  // A straight RGB blend from the pink/coral theme to the teal translator
  // palette greys out halfway; each role instead goes round the hue wheel the
  // way that never touches yellow-green.
  it('fades every palette role the cool way round the hue wheel', () => {
    const cfg = pageCfg(page);
    const H: number[] = cfg.tintHsv;
    expect(H).toHaveLength((cfg.pal.length / 3) * 6);
    for (let i = 0; i < H.length; i += 6) {
      const lo = Math.min(H[i], H[i + 3]);
      const hi = Math.max(H[i], H[i + 3]);
      for (const turn of [-1, 0, 1]) {
        const avoid = AVOID_HUE + turn;
        expect(avoid > lo && avoid < hi).toBe(false);
      }
    }
    // The theme pink reaches teal through violet and blue: its hue goes down.
    const pink = PAL_KEYS.indexOf('pink') * 6;
    expect(H[pink + 3]).toBeLessThan(H[pink]);
  });

  it('applies config overrides', () => {
    const custom = buildOrbPage({ config: { radius: 0.7 } });
    expect(custom).toContain('"radius":0.7');
  });
});
