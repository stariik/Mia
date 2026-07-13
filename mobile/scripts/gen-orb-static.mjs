// Render one idle frame of the real WebGL orb (src/lib/orbHtml.ts) and save
// it as assets/orb-static.png — used on screens that can't host a WebView
// (AuthScreen: WebViews fight the soft keyboard on Android).
// Run from the `mobile/` dir:  node scripts/gen-orb-static.mjs
//
// Pipeline: esbuild bundles the TS module → headless Edge renders the exact
// same HTML the app's WebView runs → screenshot with transparent background
// → sharp verifies + writes the asset.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const require = createRequire(import.meta.url);

const TMP = '.tmp';
const OUT = 'assets/orb-static.png';
const SIZE = 512;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const run = async () => {
  fs.mkdirSync(TMP, { recursive: true });

  // 1. TS → CJS so plain node can require it (no RN imports inside).
  execSync(
    `npx esbuild src/lib/orbHtml.ts --bundle --platform=node --format=cjs --outfile=${TMP}/orbHtml.cjs`,
    { stdio: 'inherit' },
  );
  const { buildOrbHtml } = require(path.resolve(`${TMP}/orbHtml.cjs`));

  // Same props AIAssistantOrb passes on the auth screen (its defaults).
  const html = buildOrbHtml({ hue: 0, hoverIntensity: 2, backgroundColor: '#000000' });
  const htmlPath = path.resolve(`${TMP}/orb.html`);
  fs.writeFileSync(htmlPath, html);

  // 2. Headless Edge screenshot. --virtual-time-budget advances rAF so the
  //    orb reaches its settled idle frame; transparent default background
  //    keeps everything outside the ring transparent.
  const shot = path.resolve(`${TMP}/orb-shot.png`);
  const flags = [
    '--headless=new',
    `--screenshot=${shot}`,
    `--window-size=${SIZE},${SIZE}`,
    '--virtual-time-budget=2500',
    '--default-background-color=00000000',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
    '--no-first-run',
  ];
  execSync(`"${EDGE}" ${flags.join(' ')} "file:///${htmlPath.replace(/\\/g, '/')}"`, {
    stdio: 'inherit',
  });

  // 3. Verify the render isn't blank (GL failure → fully transparent image).
  const stats = await sharp(shot).stats();
  const maxAlpha = stats.channels[3]?.max ?? 0;
  if (maxAlpha < 32) {
    throw new Error('Screenshot looks blank — WebGL likely failed in headless Edge.');
  }

  await sharp(shot).png().toFile(OUT);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`Wrote ${OUT} (${SIZE}x${SIZE}, maxAlpha=${maxAlpha}).`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
