// DEV ONLY — never imported by release code. MiaOrb requires this behind
// __DEV__, and the preview script imports it directly.
//
// Lets the orb be judged without talking:
//   __orbDev.sim(channel, mode, audible)
//     channel: 'mic' (the user's voice) | 'tts' (Mia's voice) | null (off)
//     mode:    'speech'      — a WebAudio synthetic voice (glottal sawtooth →
//                              formant band-passes → syllable envelopes) run
//                              through a real AnalyserNode, so the orb reacts
//                              to a genuine FFT; audible if asked
//              'procedural' — deterministic band envelopes stepped by the
//                              physics clock (headless screenshots)
//   __orbDev.warp(seconds) — advance physics deterministically, then draw.

export const ORB_DEV_MARKER = '__ORB_DEV_TOOLS__';

export const ORB_DEV_TOOLS_JS = `
(function () {
  try {
    var I = window.__orbIn;
    var MARK = '${ORB_DEV_MARKER}';
    var seed = 20261001;
    function rnd() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    function lerp(a, b, t) { return a + (b - a) * t; }

    // ── Procedural syllables (deterministic) ────────────────────────────────
    var P = { t: 0, dur: 0, gap: 0, left: 0, low: 0, mid: 0, high: 0, inSyl: false, pause: 0 };
    var bands = [0, 0, 0, 0];
    function nextSyllable() {
      if (P.left <= 0) {
        P.left = 3 + Math.floor(rnd() * 7);
        P.pause = 0.35 + rnd() * 0.5;
      }
      P.left--;
      P.dur = 0.11 + rnd() * 0.17;
      P.gap = P.left === 0 ? P.pause : 0.03 + rnd() * 0.07;
      P.low = lerp(0.45, 0.95, rnd());
      P.mid = lerp(0.35, 0.85, rnd());
      P.high = lerp(0.1, 0.35, rnd());
      P.t = 0;
      P.inSyl = true;
    }
    function procTick(dt) {
      P.t += dt;
      var onset = 0;
      if (P.inSyl && P.t > P.dur) { P.inSyl = false; P.t = 0; }
      else if (!P.inSyl && P.t > P.gap) { nextSyllable(); onset = 0.5 + rnd() * 0.4; }
      var e = 0;
      if (P.inSyl) {
        var a = Math.min(1, P.t / 0.03);
        var r = Math.min(1, (P.dur - P.t) / 0.06);
        e = Math.max(0, Math.min(a, r));
        e *= 0.85 + 0.15 * Math.sin(P.t * 37);
      }
      var burst = P.inSyl && P.t < 0.045 ? 0.55 : 0;
      bands[0] = e * 0.85;
      bands[1] = e * P.low;
      bands[2] = e * P.mid;
      bands[3] = Math.max(e * P.high, burst);
      return onset;
    }

    // ── Synthetic speech through Web Audio ──────────────────────────────────
    var S = { ctx: null, an: null, out: null, voice: null, noise: null, formants: [], timer: 0, next: 0 };
    var VOWELS = [[730, 1090, 2440], [270, 2290, 3010], [530, 1840, 2480], [570, 840, 2410], [300, 870, 2240], [660, 1720, 2410]];
    function speechStart(audible, channel) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      var ctx = S.ctx || (S.ctx = new Ctor());
      if (ctx.state === 'suspended') ctx.resume();
      var an = ctx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.55;
      var vGain = ctx.createGain(); vGain.gain.value = 0;
      var nGain = ctx.createGain(); nGain.gain.value = 0;
      var osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = channel === 'tts' ? 190 : 125;
      S.formants = [];
      for (var i = 0; i < 3; i++) {
        var f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 7 + i * 3;
        f.frequency.value = VOWELS[0][i];
        osc.connect(f);
        f.connect(vGain);
        S.formants.push(f);
      }
      var len = ctx.sampleRate;
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var j = 0; j < len; j++) d[j] = rnd() * 2 - 1;
      var noise = ctx.createBufferSource();
      noise.buffer = buf; noise.loop = true;
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200;
      noise.connect(hp); hp.connect(nGain);
      vGain.connect(an); nGain.connect(an);
      var out = ctx.createGain(); out.gain.value = audible ? 0.5 : 0;
      an.connect(out); out.connect(ctx.destination);
      osc.start(); noise.start();
      S.an = an; S.out = out; S.voice = vGain; S.noise = nGain; S.osc = osc; S.src = noise;
      S.next = ctx.currentTime + 0.1;
      S.timer = setInterval(schedule, 60);
      I.simAnalyser = an;
      I.simRate = ctx.sampleRate;
      return true;
    }
    function schedule() {
      var ctx = S.ctx;
      while (S.next < ctx.currentTime + 0.3) {
        var t = S.next;
        var n = 3 + Math.floor(rnd() * 7);
        for (var s = 0; s < n; s++) {
          var dur = 0.11 + rnd() * 0.17;
          var v = VOWELS[Math.floor(rnd() * VOWELS.length)];
          for (var i = 0; i < 3; i++) S.formants[i].frequency.setTargetAtTime(v[i], t, 0.02);
          S.osc.frequency.setTargetAtTime(S.osc.frequency.value * (0.9 + rnd() * 0.2), t, 0.05);
          S.noise.gain.setValueAtTime(0, t);
          S.noise.gain.linearRampToValueAtTime(0.35, t + 0.012);
          S.noise.gain.linearRampToValueAtTime(0, t + 0.05);
          S.voice.gain.setValueAtTime(0, t + 0.02);
          S.voice.gain.linearRampToValueAtTime(0.9, t + 0.05);
          S.voice.gain.setValueAtTime(0.9, t + dur - 0.05);
          S.voice.gain.linearRampToValueAtTime(0, t + dur);
          t += dur + 0.03 + rnd() * 0.07;
        }
        S.next = t + 0.35 + rnd() * 0.5;
      }
    }
    function speechStop() {
      if (S.timer) clearInterval(S.timer);
      S.timer = 0;
      try { S.osc && S.osc.stop(); S.src && S.src.stop(); } catch (_) {}
      try { S.out && S.out.disconnect(); } catch (_) {}
      S.an = null;
      I.simAnalyser = null;
    }

    var mode = null;
    I.simTick = function (dt) {
      if (mode !== 'procedural' || !I.simChannel) return;
      var onset = procTick(dt);
      if (I.simChannel === 'mic') window.orb.mic(bands[0], bands[1], bands[2], bands[3], onset);
      else I.simBands = bands;
    };

    window.__orbDev = {
      marker: MARK,
      sim: function (channel, m, audible) {
        speechStop();
        I.simBands = null;
        I.simChannel = channel || null;
        mode = channel ? (m || 'speech') : null;
        if (mode === 'speech' && !speechStart(!!audible, channel)) mode = 'procedural';
      },
      warp: function (seconds) {
        var n = Math.round(seconds * 60);
        for (var i = 0; i < n; i++) I.step(1 / 60);
        if (I.draw) I.draw();
      }
    };
  } catch (err) {
    rnLog('error', 'dev tools: ' + String((err && err.message) || err));
  }
})();
`;
