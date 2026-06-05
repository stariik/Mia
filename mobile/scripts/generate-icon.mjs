// Generates all Android launcher assets + the Play Store listing icon
// from a single source PNG (the orb screenshot).
//
// Usage:
//   npm install --no-save sharp
//   node scripts/generate-icon.mjs "C:\path\to\source.png"
//
// Output:
//   android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/
//     ic_launcher.png           — legacy square (Android 7-)
//     ic_launcher_round.png     — legacy round  (Android 7-)
//     ic_launcher_foreground.png — adaptive icon foreground (Android 8+)
//   android/app/src/main/res/mipmap-anydpi-v26/
//     ic_launcher.xml + ic_launcher_round.xml — adaptive icon definitions
//   android/app/src/main/res/values/ic_launcher_colors.xml — bg color
//   playstore-icon-512.png — drag into Play Console listing

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const SRC = process.argv[2];
if (!SRC) {
  console.error('Usage: node scripts/generate-icon.mjs <source.png>');
  process.exit(1);
}

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const PLAYSTORE_OUT = path.join(ROOT, 'playstore-icon-512.png');

// Deep navy — matches src/theme/colors.ts bgDeep
const BG = { r: 0x02, g: 0x02, b: 0x0a, alpha: 1 };
const BG_HEX = '#02020a';

// Android adaptive icon canvas is 108dp. Per-density actual pixel sizes:
const FG_SIZES = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
};

// Legacy launcher icons (pre-Android-8 devices). Smaller, full-bleed.
const LEGACY_SIZES = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

async function loadCenterSquare(srcPath) {
  const srcBuf = await fs.readFile(srcPath);
  const img = sharp(srcBuf);
  const meta = await img.metadata();
  const sq = Math.min(meta.width, meta.height);
  const left = Math.floor((meta.width - sq) / 2);
  const top = Math.floor((meta.height - sq) / 2);
  return sharp(srcBuf)
    .extract({ left, top, width: sq, height: sq })
    .toBuffer();
}

/**
 * Adaptive-icon foreground: full canvas size, but orb only fills ~62% so it
 * stays inside Android's 66dp safe-zone circle (different OEMs mask differently).
 * Background of the foreground PNG is transparent — Android draws the bg color
 * underneath.
 */
async function buildForeground(srcSquare, size) {
  const orbSize = Math.round(size * 0.62);
  const orb = await sharp(srcSquare).resize(orbSize, orbSize).toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: orb,
        left: Math.round((size - orbSize) / 2),
        top: Math.round((size - orbSize) / 2),
      },
    ])
    .png()
    .toBuffer();
}

/**
 * Legacy launcher: orb on solid navy, mild inset so the orb doesn't kiss
 * the edge. Same image used for square + round legacy slots — modern launchers
 * crop circular anyway, and the orb is already round-ish.
 */
async function buildLegacy(srcSquare, size) {
  const orbSize = Math.round(size * 0.92);
  const orb = await sharp(srcSquare).resize(orbSize, orbSize).toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([
      {
        input: orb,
        left: Math.round((size - orbSize) / 2),
        top: Math.round((size - orbSize) / 2),
      },
    ])
    .png()
    .toBuffer();
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function main() {
  console.log('Source:', SRC);
  const srcSquare = await loadCenterSquare(SRC);
  console.log('Loaded source, cropped to square.');

  for (const [density, fgSize] of Object.entries(FG_SIZES)) {
    const dir = path.join(RES, `mipmap-${density}`);
    await ensureDir(dir);
    const fg = await buildForeground(srcSquare, fgSize);
    await fs.writeFile(path.join(dir, 'ic_launcher_foreground.png'), fg);

    const legacySize = LEGACY_SIZES[density];
    const legacy = await buildLegacy(srcSquare, legacySize);
    await fs.writeFile(path.join(dir, 'ic_launcher.png'), legacy);
    await fs.writeFile(path.join(dir, 'ic_launcher_round.png'), legacy);
    console.log(`✓ mipmap-${density}`);
  }

  // Adaptive icon XML (Android 8+).
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

  // Background color resource.
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

  // Play Store listing icon — 512x512, full-bleed (no safe zone needed here).
  const ps = await buildLegacy(srcSquare, 512);
  await fs.writeFile(PLAYSTORE_OUT, ps);
  console.log(`✓ ${PLAYSTORE_OUT}`);

  console.log('\nDone. Rebuild the app:');
  console.log('  cd android && .\\gradlew.bat app:installDebug -PreactNativeDevServerPort=8081');
}

main().catch((err) => {
  console.error('Generation failed:', err);
  process.exit(1);
});
