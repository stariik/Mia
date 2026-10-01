import { buildOrbPage } from '../src/orb/buildOrbPage';
import { ORB_CONFIG } from '../src/orb/config';
import { ORB_DEV_MARKER, ORB_DEV_TOOLS_JS } from '../src/orb/page/devTools';

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
    const cfgLine = page.split('\n').find((l) => l.includes('window.__orbCfg ='))!;
    const cfg = JSON.parse(cfgLine.replace(/^\s*window\.__orbCfg = /, '').replace(/;\s*$/, ''));
    const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    const pal: string[] = [];
    for (let i = 0; i < cfg.pal.length; i += 3) {
      pal.push(`#${hex(cfg.pal[i])}${hex(cfg.pal[i + 1])}${hex(cfg.pal[i + 2])}`);
    }
    const p = ORB_CONFIG.palette;
    expect(pal).toEqual(
      [p.violet, p.pink, p.coral, p.pinkSoft, p.violetSoft, p.white, p.navy].map((c) => c.toLowerCase()),
    );
    expect(pal.slice(0, 3)).toEqual(['#6d3bf5', '#ff4d8b', '#ff6b3d']);
  });

  // Translator mode is the one sanctioned colour change: a separate, slightly
  // cooler palette the page cross-fades to on orb.setTint(1). The default
  // palette must be untouched by it.
  it('ships the translator palette separately, leaving the theme palette as is', () => {
    const cfgLine = page.split('\n').find((l) => l.includes('window.__orbCfg ='))!;
    const cfg = JSON.parse(cfgLine.replace(/^\s*window\.__orbCfg = /, '').replace(/;\s*$/, ''));
    expect(cfg.palTint).toHaveLength(cfg.pal.length);
    expect(cfg.palTint).not.toEqual(cfg.pal);
    // Glass white and navy depth are shared; only the hues move.
    expect(cfg.palTint.slice(15)).toEqual(cfg.pal.slice(15));
    expect(cfg.tintMs).toBe(500);
    expect(page).toContain('setTint: setTint');
    // Starts untinted, and nothing re-uploads until the tint moves.
    expect(page).toContain('tint: 0,');
    expect(page).toContain('if (tintX === I.tint) return;');
  });

  it('applies config overrides', () => {
    const custom = buildOrbPage({ config: { radius: 0.7 } });
    expect(custom).toContain('"radius":0.7');
  });
});
