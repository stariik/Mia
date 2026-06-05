// Generate Android launcher icons from assets/logo.png.
// Run from the `mobile/` dir:  node scripts/gen-icons.mjs
//
// Pipeline: trim the white margin → square it on navy → crop a hair to kill any
// white edge ring → round the corners so the white corner gaps become navy
// (the white "ia" letters in the center are untouched). Then emit legacy icons
// (full-bleed navy square) and adaptive foregrounds (wordmark centred in the
// safe zone on a transparent canvas; the navy comes from ic_launcher_background).
import sharp from 'sharp';
import fs from 'node:fs';

const SRC = 'assets/logo.png';
const RES = 'android/app/src/main/res';
const navy = { r: 10, g: 11, b: 22, alpha: 1 }; // #0a0b16

const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FG = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const run = async () => {
  // 1. Trim the white border (trim uses the top-left pixel colour = white).
  const trimmed = await sharp(SRC).trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const side = Math.max(meta.width, meta.height);

  // 2. Square it (navy padding if the trim wasn't perfectly square).
  let square = await sharp(trimmed)
    .resize(side, side, { fit: 'contain', background: navy })
    .png()
    .toBuffer();

  // 3. Crop ~1.5% inward to remove any thin anti-aliased white ring, rescale.
  const inset = Math.round(side * 0.015);
  square = await sharp(square)
    .extract({ left: inset, top: inset, width: side - 2 * inset, height: side - 2 * inset })
    .resize(side, side)
    .png()
    .toBuffer();

  // 4. Round the corners → corner gaps become transparent (radius a touch
  //    larger than the logo's own rounding so all white corner pixels are cut).
  const r = Math.round(side * 0.24);
  const mask = Buffer.from(
    `<svg width="${side}" height="${side}"><rect width="${side}" height="${side}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );
  const rounded = await sharp(square)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer(); // transparent corners, navy square + wordmark

  // Legacy = full navy square (corners flattened to navy; launcher re-rounds).
  const base = await sharp(rounded).flatten({ background: navy }).png().toBuffer();

  // Play Store listing icon: 512x512, full-bleed, no transparency.
  await sharp(base).resize(512, 512).png().toFile('assets/playstore-icon.png');

  for (const [dens, size] of Object.entries(LEGACY)) {
    const dir = `${RES}/mipmap-${dens}`;
    const png = await sharp(base).resize(size, size).png().toBuffer();
    fs.writeFileSync(`${dir}/ic_launcher.png`, png);
    fs.writeFileSync(`${dir}/ic_launcher_round.png`, png);
  }

  // Adaptive foreground = wordmark scaled into the safe zone, transparent rest.
  for (const [dens, fsize] of Object.entries(FG)) {
    const inner = Math.round(fsize * 0.72);
    const innerImg = await sharp(rounded).resize(inner, inner).png().toBuffer();
    const fg = await sharp({
      create: { width: fsize, height: fsize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: innerImg, gravity: 'center' }])
      .png()
      .toBuffer();
    fs.writeFileSync(`${RES}/mipmap-${dens}/ic_launcher_foreground.png`, fg);
  }

  console.log(`Icons generated from a ${meta.width}x${meta.height} source (square ${side}px).`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
