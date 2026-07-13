// Prepare assets/logo.png for react-native-bootsplash and regenerate the
// splash assets. Run from the `mobile/` dir:  node scripts/gen-bootsplash.mjs
//
// Same trim/round pipeline as gen-icons.mjs: trim the white margin → square
// on navy → inset-crop the white edge ring → round the corners. The card's
// navy (#0a0b16) matches bootsplash_background, so on the splash only the
// "Mia" wordmark reads — the card edge disappears.
import sharp from 'sharp';
import { execSync } from 'node:child_process';

const SRC = 'assets/logo.png';
const OUT = 'assets/bootsplash-logo-src.png';
const navy = { r: 10, g: 11, b: 22, alpha: 1 }; // #0a0b16

const run = async () => {
  const trimmed = await sharp(SRC).trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const side = Math.max(meta.width, meta.height);

  let square = await sharp(trimmed)
    .resize(side, side, { fit: 'contain', background: navy })
    .png()
    .toBuffer();

  const inset = Math.round(side * 0.015);
  square = await sharp(square)
    .extract({ left: inset, top: inset, width: side - 2 * inset, height: side - 2 * inset })
    .resize(side, side)
    .png()
    .toBuffer();

  const r = Math.round(side * 0.24);
  const mask = Buffer.from(
    `<svg width="${side}" height="${side}"><rect width="${side}" height="${side}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );
  const rounded = await sharp(square)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Inset the card to ~62% of the canvas: Android 12+ masks the splash icon
  // to a circle, so a full-bleed square would lose its corners and clip the
  // wide "Mia" wordmark. The transparent padding keeps everything inside the
  // circle; the card's navy matches the background so the inset is invisible.
  const inner = Math.round(side * 0.62);
  const innerImg = await sharp(rounded).resize(inner, inner).png().toBuffer();
  await sharp({
    create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: innerImg, gravity: 'center' }])
    .png()
    .toFile(OUT);

  execSync(
    `npx react-native-bootsplash generate ${OUT} --platforms=android --background=0a0b16 --logo-width=180`,
    { stdio: 'inherit' },
  );
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
