/// <reference types="node" />
// Dev-only: writes a standalone MiaOrb preview page for judging the animation
// on a desktop browser (and for headless screenshots). Not part of the app.
//
//   ../web/node_modules/.bin/tsx scripts/orb-preview.ts [out.html]
//
// Open it with URL params to pin a look, e.g.
//   orb-preview.html?state=listening&sim=mic&mode=procedural&t=2.5
// Params: state (idle|listening|thinking|speaking|error), sim (mic|tts),
// mode (speech|procedural), t (seconds to warp before showing), reduced=1,
// fallback=1, size (css px), tier (quality tier index), touch=x,y, hud=0,
// bar=0, seq=idle:2,thinking:0.6 (state changes mid-warp).

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildOrbPage } from '../src/orb/buildOrbPage';
import { ORB_DEV_TOOLS_JS } from '../src/orb/page/devTools';

const out = resolve(process.argv[2] ?? 'orb-preview.html');

// Runs after the dev tools. Shims the RN bridge so perf reports show in a HUD,
// lays the orb out on the app's navy, and wires mouse → touch + a control bar.
const HARNESS_JS = `
(function () {
  var q = new URLSearchParams(location.search);
  var size = +(q.get('size') || 380);
  document.body.style.background = '#0f1020';
  var c = document.getElementById('orb-container');
  c.style.inset = 'auto';
  c.style.width = size + 'px';
  c.style.height = size + 'px';
  c.style.left = '50%';
  c.style.top = '50%';
  c.style.transform = 'translate(-50%, -50%)';
  c.style.pointerEvents = 'auto';
  window.dispatchEvent(new Event('resize'));

  var hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;left:12px;top:10px;font:12px ui-monospace,monospace;color:#9aa3c8;pointer-events:none';
  document.body.appendChild(hud);
  if (q.get('hud') === '0') hud.style.display = 'none';
  window.ReactNativeWebView = {
    postMessage: function (s) {
      try {
        var m = JSON.parse(s);
        if (m.kind === 'perf') hud.textContent = JSON.stringify(m.payload);
        else if (m.kind === 'error' || m.kind === 'fallback') console.error('[orb]', m.kind, m.payload);
      } catch (_) {}
    }
  };

  function rel(e) {
    var r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
  }
  c.addEventListener('pointerdown', function (e) { var p = rel(e); orb.touch(p[0], p[1], 0); });
  window.addEventListener('pointermove', function (e) { if (__orbIn.touch.down) { var p = rel(e); orb.touch(p[0], p[1], 1); } });
  window.addEventListener('pointerup', function () { orb.touch(0, 0, 2); });

  var bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:14px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;pointer-events:auto';
  document.body.appendChild(bar);
  function btn(label, fn) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#1a1b2c;color:#eef0ff;border:1px solid #2b3050;border-radius:14px;padding:6px 12px;font:13px system-ui;cursor:pointer';
    b.onclick = fn;
    bar.appendChild(b);
  }
  ['idle', 'listening', 'thinking', 'speaking', 'error'].forEach(function (s) {
    btn(s, function () { orb.state(s); });
  });
  btn('🎙 user voice', function () { orb.state('listening'); __orbDev.sim('mic', 'speech', false); });
  btn('🔊 Mia voice', function () { orb.state('speaking'); __orbDev.sim('tts', 'speech', true); });
  btn('sim off', function () { __orbDev.sim(null); });
  btn('reduced', function () { orb.setReducedMotion(!__orbIn.reduced); });
  if (q.get('bar') === '0') bar.style.display = 'none';

  if (q.get('tier')) __orbIn.lockTier(+q.get('tier'));
  // A pinned time means a still: stop the live loop so nothing runs past it.
  if (q.get('t') || q.get('seq')) orb.setActive(false);
  if (q.get('state')) orb.state(q.get('state'));
  if (q.get('reduced') === '1') orb.setReducedMotion(true);
  if (q.get('sim')) __orbDev.sim(q.get('sim'), q.get('mode') || 'procedural', false);
  if (q.get('touch')) {
    var tp = q.get('touch').split(',');
    orb.touch(+tp[0], +tp[1], 0);
  }
  if (q.get('t')) __orbDev.warp(+q.get('t'));
  // seq=idle:2,thinking:0.6 — switch states mid-warp to inspect transitions.
  if (q.get('seq')) {
    q.get('seq').split(',').forEach(function (part) {
      var kv = part.split(':');
      orb.state(kv[0]);
      __orbDev.warp(+kv[1]);
    });
  }
})();
`;

const html = buildOrbPage({
  devTools: ORB_DEV_TOOLS_JS + '\n' + HARNESS_JS,
  forceFallback: process.argv.includes('--fallback'),
});
writeFileSync(out, html);
console.log(out);
