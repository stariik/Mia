// Production-quality launcher icon for Mia. Generates the orb entirely from
// SVG gradients — no source screenshot. Pixel-perfect at every density.
//
// Design choices:
//   • Sphere, not hollow ring — full color mass reads at 48px (mdpi)
//   • Cyan → violet → magenta radial — matches brandGradient in the app
//   • Specular highlight upper-left → reads as "lit from above" (universal cue)
//   • Outer bloom — kept tight so the orb stays crisp; bleeds aurora color
//     into the navy background without softening the silhouette
//   • Deep navy background (#02020a) — same as bgDeep in theme
//
// Usage:
//   npm install --no-save sharp
//   node scripts/generate-icon-pro.mjs

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const PLAYSTORE_OUT = path.join(ROOT, 'playstore-icon-512.png');

const BG = { r: 0x02, g: 0x02, b: 0x0a, alpha: 1 };
const BG_HEX = '#02020a';

const FG_SIZES = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
};

const LEGACY_SIZES = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

/**
 * Build the orb SVG. `size` is the canvas (and viewBox) size in px.
 * `orbScale` is the orb's radius as a fraction of the canvas radius —
 *   adaptive foreground uses ~0.58 to stay in safe zone, legacy/store use ~0.84.
 * `transparentBg` controls whether the navy background fills the canvas
 *   (false for adaptive foreground, true otherwise).
 */
function orbSvg({ size, orbScale, transparentBg }) {
  const cx = size / 2;
  const cy = size / 2;
  const orbR = (size / 2) * orbScale;
  const bloomR = orbR * 1.18;
  // Specular highlight placement, top-left convention
  const specCx = cx - orbR * 0.32;
  const specCy = cy - orbR * 0.34;
  const specR = orbR * 0.48;

  // Linear-ish radial: cyan rim, violet body, magenta lower-right.
  // The "darker outer ring" at 100% gives the sphere depth instead of looking flat.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bloom" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="rgba(0,240,255,0.0)" />
      <stop offset="55%"  stop-color="rgba(0,240,255,0.35)" />
      <stop offset="80%"  stop-color="rgba(123,108,255,0.18)" />
      <stop offset="100%" stop-color="rgba(207,92,255,0.0)" />
    </radialGradient>
    <radialGradient id="orb" cx="32%" cy="30%" r="72%">
      <stop offset="0%"   stop-color="#dafcff" />
      <stop offset="14%"  stop-color="#00f0ff" />
      <stop offset="46%"  stop-color="#6b56ff" />
      <stop offset="76%"  stop-color="#c64dff" />
      <stop offset="100%" stop-color="#2a0a4f" />
    </radialGradient>
    <radialGradient id="spec" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="rgba(255,255,255,0.78)" />
      <stop offset="50%"  stop-color="rgba(255,255,255,0.18)" />
      <stop offset="100%" stop-color="rgba(255,255,255,0.0)" />
    </radialGradient>
  </defs>

  ${transparentBg ? '' : `<rect width="${size}" height="${size}" fill="${BG_HEX}" />`}

  <!-- Aurora bloom around the orb -->
  <circle cx="${cx}" cy="${cy}" r="${bloomR}" fill="url(#bloom)" />

  <!-- Main sphere -->
  <circle cx="${cx}" cy="${cy}" r="${orbR}" fill="url(#orb)" />

  <!-- Specular highlight (upper-left, lit-from-above cue) -->
  <ellipse cx="${specCx}" cy="${specCy}" rx="${specR}" ry="${specR * 0.85}" fill="url(#spec)" />
</svg>`;
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function renderSvg(svg, size) {
  return sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  console.log('Generating Mia production icon...');

  for (const [density, fgSize] of Object.entries(FG_SIZES)) {
    const dir = path.join(RES, `mipmap-${density}`);
    await ensureDir(dir);

    // Adaptive icon foreground (transparent bg, orb in safe zone).
    const fgSvg = orbSvg({ size: fgSize, orbScale: 0.58, transparentBg: true });
    const fg = await renderSvg(fgSvg, fgSize);
    await fs.writeFile(path.join(dir, 'ic_launcher_foreground.png'), fg);

    // Legacy icons (full-bleed on navy bg for old launchers).
    const legacySize = LEGACY_SIZES[density];
    const legacySvg = orbSvg({
      size: legacySize,
      orbScale: 0.84,
      transparentBg: false,
    });
    const legacy = await renderSvg(legacySvg, legacySize);
    await fs.writeFile(path.join(dir, 'ic_launcher.png'), legacy);
    await fs.writeFile(path.join(dir, 'ic_launcher_round.png'), legacy);

    console.log(`✓ mipmap-${density}`);
  }

  // Adaptive icon XMLs.
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
  const v26Dir = path.join(RES, 'mipmap-anydpi-v26');
  await ensureDir(v26Dir);
  await fs.writeFile(path.join(v26Dir, 'ic_launcher.xml'), adaptiveXml);
  await fs.writeFile(path.join(v26Dir, 'ic_launcher_round.xml'), adaptiveXml);
  console.log('✓ mipmap-anydpi-v26 (adaptive icon XMLs)');

  // Background color.
  const colorXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BG_HEX}</color>
</resources>
`;
  const valuesDir = path.join(RES, 'values');
  await ensureDir(valuesDir);
  await fs.writeFile(
    path.join(valuesDir, 'ic_launcher_colors.xml'),
    colorXml,
  );
  console.log('✓ values/ic_launcher_colors.xml');

  // Play Store 512×512 listing icon — premium quality, slightly larger orb.
  const psSvg = orbSvg({ size: 512, orbScale: 0.88, transparentBg: false });
  const ps = await renderSvg(psSvg, 512);
  await fs.writeFile(PLAYSTORE_OUT, ps);
  console.log(`✓ ${PLAYSTORE_OUT}`);

  console.log('\nDone. Rebuild the app:');
  console.log('  cd android && .\\gradlew.bat app:installDebug -PreactNativeDevServerPort=8081');
}

main().catch((err) => {
  console.error('Generation failed:', err);
  process.exit(1);
});
