// The orb page's renderer: physics, choreography, audio envelopes and drawing.
//
// One requestAnimationFrame loop does everything — state hand-offs, springs,
// mic/TTS band envelopes, syllable ripples, the thought-knot, tilt and press
// physics — then draws with WebGL in two passes (a reduced-resolution interior
// volume, then a full-resolution composite), or a Canvas2D fallback when WebGL
// is missing or the shaders fail. No allocations per frame: every buffer below
// is created once.
//
// Frame pacing: the loop steps physics every frame but only draws at 60 fps
// while something is moving, 30 fps when the orb is calm, and never above 60
// on high-refresh screens.
//
// Reads window.__orbCfg (serialized ORB_CONFIG + shaders) and window.__orbIn
// (inputs written by api.ts). Reads Mia's voice through window.__miaTts.

export const ORB_RENDERER_JS = `
(function () {
  try {
    var C = window.__orbCfg;
    var I = window.__orbIn;
    var KEYS = C.stateKeys;
    var NK = KEYS.length;
    var TAU = Math.PI * 2;

    var container = document.getElementById('orb-container');
    var canvas = document.createElement('canvas');
    container.appendChild(canvas);

    // ── Physics primitives ──────────────────────────────────────────────────
    // Damped spring in designer units (freq Hz, damping ratio). Integrated with
    // semi-implicit Euler in ≤ 1/120 s substeps so stiff springs stay stable.
    var SP = new Float32Array(2);
    function springStep(x, v, target, freq, damping, dt) {
      var w = TAU * freq;
      var k = w * w;
      var c = 2 * damping * w;
      var n = Math.ceil(dt * 120);
      var h = dt / n;
      for (var i = 0; i < n; i++) {
        v += (k * (target - x) - c * v) * h;
        x += v * h;
      }
      SP[0] = x;
      SP[1] = v;
    }
    function Spring(cfg, x0) {
      return { x: x0 || 0, v: 0, f: cfg.freq, d: cfg.damping };
    }
    function retune(s, cfg) {
      s.f = cfg.freq;
      s.d = cfg.damping;
    }
    function stepSpring(s, target, dt) {
      springStep(s.x, s.v, target, s.f, s.d, dt);
      s.x = SP[0];
      s.v = SP[1];
      return s.x;
    }
    // Envelope follower: fast attack, soft release.
    function env(cur, target, attackS, releaseS, dt) {
      var tau = target > cur ? attackS : releaseS;
      return cur + (target - cur) * (1 - Math.exp(-dt / tau));
    }
    function wrap(v, period) {
      v = v % period;
      return v < 0 ? v + period : v;
    }
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    function easeInOutCubic(x) {
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }

    var A = C.audio;
    var V = C.voice;
    var IX = C.interaction;
    var RM = C.reducedMotion;
    var K = C.knot;
    var CH = C.choreography;
    var PC = C.pacing;

    // ── State look: one spring per parameter ────────────────────────────────
    var look = {};
    for (var ki = 0; ki < NK; ki++) {
      var key = KEYS[ki];
      look[key] = Spring(C.springs[key], C.states.idle[key]);
    }

    var coreSwell = Spring(V.coreSpring);
    var twist = Spring(V.twistSpring);
    var pull = Spring(V.pullSpring);
    var tiltX = Spring(IX.tiltSpring);
    var tiltY = Spring(IX.tiltSpring);
    var press = Spring(IX.pressSpring);

    // Envelopes [level, low, mid, high] for each voice.
    var micEnv = new Float32Array(4);
    var ttsEnv = new Float32Array(4);
    var ttsRaw = new Float32Array(4);
    var ttsPrev = new Float32Array(4);
    var ttsGain = new Float32Array([1, 1, 1, 1]);
    var ttsPeak = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    var userW = 0, miaW = 0, talking = false;
    var lastOnsetT = -1e9;

    // Syllable ripples: [radius, strength, direction, age] × 4.
    var rip = new Float32Array(16);
    var ripNext = 0;
    function spawnRipple(dir, strength) {
      var o = ripNext * 4;
      ripNext = (ripNext + 1) % 4;
      rip[o] = dir > 0 ? Math.max(0.12, look.core.x * 0.8) : 1.02;
      rip[o + 1] = strength;
      rip[o + 2] = dir;
      rip[o + 3] = 0;
    }
    var touchRip = new Float32Array(4); // x, y, radius, strength
    var touchSeen = 0;

    // Phases (all wrapped so precision never degrades over a long session).
    var layer = new Float32Array(8);   // 7 slice phases + warp (mod 256)
    var angles = new Float32Array(4);  // medium turn, stream, twinkle, sparkle drift
    var breathPhase = 0, rayPhase = 0;

    // Orientation tilt (best effort; Android WebView fires it without a prompt).
    var ori = { has: false, bx: 0, by: 0, x: 0, y: 0 };
    window.addEventListener('deviceorientation', function (e) {
      if (e.beta == null || e.gamma == null) return;
      ori.x = e.gamma;
      ori.y = e.beta;
      if (!ori.has) { ori.bx = ori.x; ori.by = ori.y; ori.has = true; }
    });

    var mq = null;
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (_) {}
    function reduced() { return I.reduced || !!(mq && mq.matches); }

    // ── TTS band analysis (reads the engine's AnalyserNode) ─────────────────
    var freqBuf = null, timeBuf = null;
    var bandBins = null, bandRate = 0, bandSize = 0;
    function prepBands(an, rate) {
      // The analyser's default byte range (-100..-30 dB) clips speech; widen it.
      // This only scales getByte*Data — the audio itself is untouched.
      if (an.maxDecibels !== -12) { an.minDecibels = -92; an.maxDecibels = -12; }
      if (freqBuf && freqBuf.length === an.frequencyBinCount && bandRate === rate && bandSize === an.fftSize) return;
      freqBuf = new Uint8Array(an.frequencyBinCount);
      timeBuf = new Uint8Array(an.fftSize);
      bandRate = rate;
      bandSize = an.fftSize;
      var hz = rate / an.fftSize;
      var b = A.bands;
      bandBins = new Int32Array([
        Math.max(1, Math.round(b.low[0] / hz)), Math.max(2, Math.round(b.low[1] / hz)),
        Math.round(b.mid[0] / hz), Math.round(b.mid[1] / hz),
        Math.round(b.high[0] / hz), Math.min(an.frequencyBinCount - 1, Math.round(b.high[1] / hz))
      ]);
    }
    function bandAvg(lo, hi) {
      var s = 0;
      for (var i = lo; i < hi; i++) s += freqBuf[i];
      return hi > lo ? s / ((hi - lo) * 255) : 0;
    }
    // Fills ttsRaw [level, low, mid, high] from an analyser. Returns the
    // spectral flux (positive band change) for onset detection.
    function readAnalyser(an, rate, dt) {
      prepBands(an, rate);
      an.getByteFrequencyData(freqBuf);
      an.getByteTimeDomainData(timeBuf);
      var sum = 0;
      for (var i = 0; i < timeBuf.length; i++) {
        var v = (timeBuf[i] - 128) / 128;
        sum += v * v;
      }
      ttsRaw[0] = clamp01(Math.sqrt(sum / timeBuf.length) * 3.6);
      ttsRaw[1] = bandAvg(bandBins[0], bandBins[1]);
      ttsRaw[2] = bandAvg(bandBins[2], bandBins[3]);
      ttsRaw[3] = bandAvg(bandBins[4], bandBins[5]);
      var flux = 0;
      for (var b = 1; b < 4; b++) {
        // Byte spectra sit on a dB scale: map the speech range to 0..1, then a
        // gentle AGC on the recent PEAK (not the current value — that would
        // flatten speech), so quiet and loud voices both reach full motion.
        var x = clamp01((ttsRaw[b] - 0.28) / 0.5);
        ttsPeak[b] = Math.max(x, ttsPeak[b] * Math.exp(-dt / 2.5));
        var want = Math.min(2.0, Math.max(0.5, 0.85 / Math.max(ttsPeak[b], 0.2)));
        ttsGain[b] += (want - ttsGain[b]) * (1 - Math.exp(-dt / 1.2));
        x = clamp01(x * ttsGain[b]);
        var d = x - ttsPrev[b];
        if (d > 0) flux += d;
        ttsPrev[b] = x;
        ttsRaw[b] = x;
      }
      return flux;
    }

    // ── The thought (thinking) ──────────────────────────────────────────────
    // A (3, q) torus knot drawn out of the core like a pen stroke, spun up with
    // momentum, carrying pulses of light; on the way out it either releases
    // outward into Mia's voice or dissolves back into the core.
    var kAlpha = Spring(K.springs.alphaIn, 0);
    var kRadius = Spring(K.springs.radius, K.birthRadius);
    var kIncline = Spring(K.springs.incline, K.birthIncline);
    var kSpin = Spring(K.springs.spin, 0);
    var kSpinAngle = 0, kRoll = 0, kBreathPh = 0, kDriftT = 0, thinkingFor = 0;
    var trace = 2, traceT = 0, tracing = false;
    var pulseOn = 0, releaseFlash = 0;
    var pulseU = new Float32Array([0.0, 0.37, 0.71]);
    var exitMode = 'dissolve';
    var absorbT = 1e9;
    var KP = new Float32Array(3); // scratch: one knot point in view space

    // Listening → thinking: the words are drawn into the core (quick rise,
    // soft decay) before the thought is traced out of it.
    function absorbCurve(t) {
      if (t < 0 || t > 6) return 0;
      if (t < CH.absorbRiseS) {
        var x = t / CH.absorbRiseS;
        return 1 - (1 - x) * (1 - x);
      }
      return Math.exp(-(t - CH.absorbRiseS) / CH.absorbDecayS);
    }

    // View-space position of the point a fraction u along the knot (matches
    // drawThought() in the composite shader).
    function knotPoint(u) {
      var t = u * TAU;
      var az = 3 * t + kSpinAngle;
      var a = K.q * t + kRoll;
      var R = U.knot[0], tr = U.knot[1];
      var rho = R + tr * Math.cos(a);
      var px = rho * Math.cos(az), py = rho * Math.sin(az), pz = tr * Math.sin(a);
      var cI = Math.cos(U.knotF[0]), sI = Math.sin(U.knotF[0]);
      var yv = py * cI + pz * sI, zv = -py * sI + pz * cI;
      var cp = Math.cos(U.knotF[1]), sp = Math.sin(U.knotF[1]);
      KP[0] = cp * px - sp * yv + U.shape[2] * zv;
      KP[1] = sp * px + cp * yv + U.shape[3] * zv;
      KP[2] = zv;
    }

    // ── State hand-offs ─────────────────────────────────────────────────────
    // A drop to idle shorter than the grace period is noise between two real
    // states (e.g. listening → transcribing → thinking): hold the current
    // state through it so the hand-off happens once, directly.
    var committed = 'idle', idleSince = -1;
    function commitState() {
      var want = I.state;
      if (want === committed) { idleSince = -1; return; }
      if (want === 'idle') {
        if (idleSince < 0) idleSince = simT;
        if (simT - idleSince < CH.idleGraceS) return;
      }
      idleSince = -1;
      var from = committed;
      committed = want;
      handOff(from, want);
    }
    function handOff(from, to) {
      if (to === 'thinking') {
        retune(kAlpha, K.springs.alphaIn);
        retune(kRadius, K.springs.radius);
        if (kAlpha.x < 0.06) {
          pulseOn = 0;
          if (reduced()) {
            // Reduced motion: no comet, no growth — the thought simply fades in.
            retune(kAlpha, K.springs.alphaOut);
            kRadius.x = K.radius; kRadius.v = 0;
            kIncline.x = K.incline; kIncline.v = 0;
            tracing = false;
            trace = 2;
          } else {
            // Nothing of the thought is on screen: draw it fresh, out of the core.
            kRadius.x = K.birthRadius; kRadius.v = 0;
            kIncline.x = K.birthIncline; kIncline.v = 0;
            tracing = true;
            traceT = -(from === 'listening' ? K.traceDelayAfterListening : K.traceDelay);
            trace = 0;
          }
        }
        if (from === 'listening') absorbT = 0;
      } else if (from === 'thinking') {
        if (to === 'speaking') {
          // The thought becomes speech: it opens outward and lets go.
          exitMode = 'release';
          retune(kAlpha, K.springs.alphaRelease);
          retune(kRadius, K.springs.radiusOut);
          releaseFlash = 1;
          if (!reduced()) spawnRipple(1, V.rippleStrength);
        } else {
          exitMode = 'dissolve';
          retune(kAlpha, K.springs.alphaOut);
          retune(kRadius, K.springs.radiusOut);
        }
      }
    }

    // ── Step: advance all physics by dt (also used by dev warp) ────────────
    var U = {
      shape: new Float32Array(4), layer0: new Float32Array(4), layer1: new Float32Array(4),
      angles: angles, look: new Float32Array(4), look2: new Float32Array(4),
      voice: new Float32Array(4), voice2: new Float32Array(4), rip: new Float32Array(16),
      touch: touchRip, fx: new Float32Array(4), knot: new Float32Array(4),
      knotF: new Float32Array(4), knotB: new Float32Array(4), pulse: new Float32Array(6),
      pl: new Float32Array(16)
    };
    var simT = 0;

    function step(dt) {
      simT += dt;
      commitState();
      var rm = reduced();
      var target = C.states[committed] || C.states.idle;
      for (var i = 0; i < NK; i++) {
        var k = KEYS[i];
        stepSpring(look[k], target[k], dt);
      }
      if (I.simTick) I.simTick(dt);

      // Mic: envelopes on the RN-side analysis; stale feed decays to silence.
      var now = performance.now();
      var micLive = committed === 'listening' && now - I.micT < (I.micHold || A.micStaleMs);
      var atk = A.attackMs / 1000, rel = A.releaseMs / 1000;
      for (var b = 0; b < 4; b++) {
        var mt = micLive ? I.mic[b] : 0;
        micEnv[b] = env(micEnv[b], mt, atk, b === 3 ? A.highReleaseMs / 1000 : rel, dt);
      }
      if (!talking && micEnv[0] > A.voiceOn) talking = true;
      else if (talking && micEnv[0] < A.voiceOff) talking = false;
      userW = env(userW, micLive && talking ? 1 : 0, 0.09, 0.45, dt);

      // Mia's voice: the TTS engine's analyser (or the dev simulator's).
      var an = null, rate = 0, flux = 0, playing = false;
      if (I.simAnalyser && I.simChannel === 'tts') {
        an = I.simAnalyser; rate = I.simRate; playing = true;
      } else if (window.__miaTts && window.__miaTts.playing()) {
        an = window.__miaTts.analyser();
        var ctx = window.__miaTts.context();
        rate = ctx ? ctx.sampleRate : 48000;
        playing = !!an;
      }
      if (an) flux = readAnalyser(an, rate, dt);
      else if (I.simBands && I.simChannel === 'tts') {
        playing = true;
        for (b = 0; b < 4; b++) {
          var dv = I.simBands[b] - ttsRaw[b];
          if (b > 0 && dv > 0) flux += dv;
          ttsRaw[b] = I.simBands[b];
        }
      }
      for (b = 0; b < 4; b++) {
        ttsEnv[b] = env(ttsEnv[b], playing ? ttsRaw[b] : 0, atk, b === 3 ? A.highReleaseMs / 1000 : rel, dt);
      }
      miaW = env(miaW, playing ? 1 : 0, 0.12, 0.6, dt);

      // Dev mic simulation through an analyser feeds the mic path.
      if (I.simAnalyser && I.simChannel === 'mic') {
        var f2 = readAnalyser(I.simAnalyser, I.simRate, dt);
        window.orb.mic(ttsRaw[0], ttsRaw[1], ttsRaw[2], ttsRaw[3], f2 > A.onsetThreshold ? f2 : 0);
      }

      // Syllable onsets → ripples (inward for the user, outward for Mia).
      var voiceAmt = rm ? RM.voice : 1;
      // Physics clock, not wall clock: deterministic under dev warp.
      var simMs = simT * 1000;
      var gapOk = simMs - lastOnsetT > A.onsetMinGapMs;
      if (I.micOnset > 0) {
        if (gapOk && micLive && !rm) {
          spawnRipple(-1, V.rippleStrength * Math.min(1, 0.45 + I.micOnset * 2));
          lastOnsetT = simMs;
        }
        I.micOnset = 0;
      } else if (playing && flux > A.onsetThreshold && gapOk && !rm) {
        spawnRipple(1, V.rippleStrength * Math.min(1, 0.4 + flux * 1.5));
        lastOnsetT = simMs;
      }
      for (i = 0; i < 4; i++) {
        var o = i * 4;
        if (rip[o + 1] <= 0.002) { rip[o + 1] = 0; continue; }
        rip[o + 3] += dt;
        rip[o] += rip[o + 2] * V.rippleSpeed * dt;
        rip[o + 1] *= Math.exp(-dt * 1.9);
        if (rip[o] < -0.05 || rip[o] > 1.25) rip[o + 1] = 0;
      }

      // Combined voice drive: whichever voice is active, weighted.
      var uw = userW * voiceAmt, mw = miaW * voiceAmt;
      var low = micEnv[1] * uw + ttsEnv[1] * mw;
      var mid = micEnv[2] * uw + ttsEnv[2] * mw;
      var high = micEnv[3] * uw + ttsEnv[3] * mw;
      var loud = micEnv[0] * uw + ttsEnv[0] * mw;
      stepSpring(coreSwell, low * V.coreSwell, dt);
      stepSpring(twist, (mid - 0.25) * V.twist * (uw + mw), dt);
      stepSpring(pull, uw * V.pull * (0.35 + 0.65 * micEnv[0]) - mw * V.push * (0.3 + 0.7 * ttsEnv[0]), dt);

      // Tilt: finger position while pressed, plus the phone's own tilt.
      var t = I.touch;
      var tx = 0, ty = 0;
      if (!rm) {
        if (t.down) { tx = t.x * IX.touchTilt; ty = t.y * IX.touchTilt; }
        if (ori.has) {
          var kb0 = 1 - Math.exp(-dt / IX.orientationBaselineS);
          ori.bx += (ori.x - ori.bx) * kb0;
          ori.by += (ori.y - ori.by) * kb0;
          var rg = IX.orientationRangeDeg;
          tx += Math.max(-1, Math.min(1, (ori.x - ori.bx) / rg)) * IX.orientationTilt;
          ty += Math.max(-1, Math.min(1, (ori.y - ori.by) / rg)) * IX.orientationTilt;
        }
      }
      stepSpring(tiltX, tx, dt);
      stepSpring(tiltY, ty, dt);
      stepSpring(press, t.down ? -IX.pressDip * (rm ? 0.4 : 1) : 0, dt);
      if (t.n !== touchSeen) {
        touchSeen = t.n;
        if (!rm) {
          touchRip[0] = t.x * 0.9; touchRip[1] = t.y * 0.9; touchRip[2] = 0; touchRip[3] = 1;
        }
      }
      if (touchRip[3] > 0.002) {
        touchRip[2] += dt * 1.5;
        touchRip[3] *= Math.exp(-dt * 2.4);
      } else touchRip[3] = 0;

      // ── The thought ──
      var thinking = committed === 'thinking';
      var slow = rm ? RM.flow : 1;
      kDriftT += dt;
      kBreathPh = wrap(kBreathPh + dt * TAU / K.breathPeriod, TAU);
      var kb = Math.sin(kBreathPh) * (rm ? 0.4 : 1);
      // Deliberation deepens: tighter, a touch faster, brighter pulses.
      thinkingFor = thinking ? thinkingFor + dt : 0;
      var fx = clamp01((thinkingFor - K.focusAfterS) / (K.focusFullS - K.focusAfterS));
      var focus = fx * fx * (3 - 2 * fx);
      if (tracing) {
        traceT += dt;
        var tp = traceT / K.traceS;
        trace = tp <= 0 ? 0 : tp >= 1 ? 2 : easeInOutCubic(tp);
        if (tp >= 1) tracing = false;
      }
      var radiusT, inclineT, spinT;
      if (thinking) {
        radiusT = K.radius * (1 + 0.025 * kb);
        inclineT = K.incline + K.inclineDrift * Math.sin(kDriftT * 0.23);
        spinT = K.spin * (1 - 0.18 * kb) * (1 + K.focusSpin * focus);
      } else if (exitMode === 'release') {
        radiusT = K.releaseRadius;
        inclineT = K.releaseIncline;
        spinT = kAlpha.x > 0.03 ? K.spin * 1.4 : 0;
      } else {
        radiusT = K.birthRadius;
        inclineT = K.birthIncline;
        spinT = 0;
      }
      stepSpring(kAlpha, thinking ? 1 : 0, dt);
      if (!thinking && kAlpha.x < 0.002) { kAlpha.x = 0; kAlpha.v = 0; }
      stepSpring(kRadius, radiusT, dt);
      stepSpring(kIncline, inclineT, dt);
      stepSpring(kSpin, spinT * slow, dt);
      kSpinAngle = wrap(kSpinAngle + dt * kSpin.x, TAU * 3);
      kRoll = wrap(kRoll + dt * K.roll * slow, TAU);
      // Pulses start once the thought is fully drawn.
      pulseOn = env(pulseOn, thinking && !tracing ? 1 : 0, 0.6, 0.25, dt);
      releaseFlash *= Math.exp(-dt / 0.3);
      for (i = 0; i < 3; i++) pulseU[i] = wrap(pulseU[i] + dt * K.pulses[i] * slow, 1);
      absorbT += dt;
      var absorb = absorbCurve(absorbT) * (rm ? 0.4 : 1);

      // Clocks.
      var flowK = (rm ? RM.flow : 1) * (1 + mid * V.flowBoost + loud * 0.3);
      var flow = look.flow.x * flowK;
      for (i = 0; i < 7; i++) {
        layer[i] = wrap(layer[i] + dt * flow * (1 - 0.08 * i), 256);
      }
      layer[7] = wrap(layer[7] + dt * flow * 0.55, 256);
      angles[0] = wrap(angles[0] + dt * kSpin.x * K.mediumDrag, TAU);
      angles[1] = wrap(angles[1] + dt * V.streamSpeed * (mw - uw) * (rm ? 0.3 : 1), TAU);
      angles[2] = wrap(angles[2] + dt * (2.0 + high * 7) * (rm ? 0.4 : 1), TAU);
      angles[3] = wrap(angles[3] + dt * (0.012 + flow * 0.12), 1000);
      rayPhase = wrap(rayPhase + dt * (mw * (0.7 + ttsEnv[0] * 1.6) - uw * (0.5 + micEnv[0] * 1.2)) * (rm ? 0.3 : 1), 256);
      breathPhase = wrap(breathPhase + dt * TAU / C.breathPeriod, TAU);

      // Pack uniforms.
      var breath = look.breath.x * Math.sin(breathPhase) * (rm ? RM.breath : 1);
      U.shape[0] = C.radius * (1 + breath + press.x);
      U.shape[2] = tiltX.x;
      U.shape[3] = tiltY.x;
      U.layer0[0] = layer[0]; U.layer0[1] = layer[1]; U.layer0[2] = layer[2]; U.layer0[3] = layer[3];
      U.layer1[0] = layer[4]; U.layer1[1] = layer[5]; U.layer1[2] = layer[6]; U.layer1[3] = layer[7];
      U.look[0] = look.energy.x * (1 + loud * V.energyGain * 0.5) * (1 - CH.absorbDim * absorb);
      U.look[1] = look.warmth.x + mw * 0.08;
      U.look[2] = Math.max(0, look.vortex.x);
      U.look[3] = clamp01(look.dim.x);
      U.look2[0] = look.sparkle.x;
      U.look2[1] = look.lean.x + pull.x + absorb * CH.absorbLean;
      U.look2[2] = look.core.x * (1 - CH.absorbCore * absorb);
      U.look2[3] = look.warp.x;
      U.voice[0] = coreSwell.x;
      U.voice[1] = twist.x;
      U.voice[2] = high * V.sparkle;
      U.voice[3] = loud;
      U.voice2[0] = uw;
      U.voice2[1] = mw;
      U.voice2[2] = uw * (0.35 + 0.65 * micEnv[0]) * 0.6;
      U.voice2[3] = rayPhase;
      for (i = 0; i < 4; i++) {
        U.rip[i * 4] = rip[i * 4];
        U.rip[i * 4 + 1] = rip[i * 4 + 1];
        U.rip[i * 4 + 2] = rip[i * 4 + 2];
        U.rip[i * 4 + 3] = 0;
      }
      U.fx[0] = 1 + CH.absorbGlow * absorb;
      U.fx[1] = K.light;
      U.knot[0] = kRadius.x;
      U.knot[1] = K.tube * (1 - 0.12 * kb) * (1 - K.focusTighten * focus) * (exitMode === 'release' && !thinking ? 0.7 : 1);
      U.knot[2] = clamp01(kAlpha.x);
      U.knot[3] = trace;
      U.knotF[0] = kIncline.x;
      U.knotF[1] = K.precess * Math.sin(kDriftT * 0.13) + tiltX.x * 1.2;
      U.knotF[2] = kSpinAngle;
      U.knotF[3] = kRoll;
      U.knotB[0] = 1 - 0.08 * kb;
      U.knotB[1] = (1 + 0.1 * kb) * (1 + 1.4 * releaseFlash);
      U.knotB[2] = K.q;
      U.knotB[3] = 0;
      // Pulses (knot position, signed intensity) and the light they carry.
      for (i = 0; i < 3; i++) {
        var pi = pulseOn * U.knot[2] * (0.75 + 0.25 * Math.sin(kDriftT * (0.7 + 0.3 * i) + i * 2.1)) * (1 + 0.4 * focus) * (1 + 2 * releaseFlash);
        U.pulse[i * 2] = pulseU[i];
        U.pulse[i * 2 + 1] = K.pulses[i] < 0 ? -pi : pi;
        if (pi > 0.002) {
          knotPoint(pulseU[i]);
          U.pl[i * 4] = KP[0]; U.pl[i * 4 + 1] = KP[1]; U.pl[i * 4 + 2] = KP[2];
        }
        U.pl[i * 4 + 3] = pi * K.pulseLight * K.light;
      }
      // The trace head carries its own light while the thought is drawn.
      var headOn = tracing && trace > 0 && trace < 1 ? U.knot[2] : 0;
      if (headOn > 0) {
        knotPoint(trace);
        U.pl[12] = KP[0]; U.pl[13] = KP[1]; U.pl[14] = KP[2];
      }
      U.pl[15] = headOn * 1.6 * K.light;
    }
    I.step = step;
    // Live envelope readout (dev HUD / tests): [mic l,lo,mid,hi, tts l,lo,mid,hi, userW, miaW].
    I.levels = function () {
      return [micEnv[0], micEnv[1], micEnv[2], micEnv[3], ttsEnv[0], ttsEnv[1], ttsEnv[2], ttsEnv[3], userW, miaW];
    };

    // How much is moving right now — decides 60 vs 30 fps.
    function activity() {
      var a = userW + miaW + kAlpha.x + (tracing ? 1 : 0) + absorbCurve(absorbT) +
        touchRip[3] + Math.abs(press.x) * 30 + Math.abs(tiltX.v) + Math.abs(tiltY.v);
      if (I.touch.down) a += 1;
      for (var i = 0; i < 4; i++) a += rip[i * 4 + 1];
      for (var k = 0; k < NK; k++) a += Math.abs(look[KEYS[k]].v) * 3;
      return a;
    }

    // ── Sizing and adaptive quality ─────────────────────────────────────────
    var Q = C.quality;
    var tier = Math.max(0, Math.min(Q.tiers.length - 1, Q.startTier));
    var cssW = 1, cssH = 1, pxW = 1, pxH = 1;
    function resize() {
      cssW = container.clientWidth || 1;
      cssH = container.clientHeight || 1;
      var dpr = Math.min(window.devicePixelRatio || 1, Q.tiers[tier].dpr);
      pxW = Math.max(1, Math.round(cssW * dpr));
      pxH = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
    }
    window.addEventListener('resize', resize);

    // Judged on drawn frames while active: slower than the target for a while
    // → step down; back on target for a while → recover (never above start).
    var drawEma = 16.7, slowFor = 0, fastFor = 0, locked = false;
    function adapt(drawMs, targetMs, dt) {
      if (locked) return;
      drawEma += (drawMs - drawEma) * 0.1;
      if (drawEma > targetMs * Q.slowFactor) { slowFor += dt; fastFor = 0; }
      else { fastFor += dt; slowFor = Math.max(0, slowFor - dt * 0.5); }
      if (slowFor > Q.downAfterS && tier < Q.tiers.length - 1) {
        tier++; slowFor = 0; fastFor = 0; drawEma = targetMs; resize();
      } else if (fastFor > Q.upAfterS && tier > Q.startTier) {
        tier--; fastFor = 0; resize();
      }
    }

    // ── WebGL ───────────────────────────────────────────────────────────────
    var gl = null, progI = null, progC = null, locI = null, locC = null;
    var noiseTex = null, target = null;
    var glAttrs = {
      alpha: true, depth: false, stencil: false, antialias: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false,
      powerPreference: 'default'
    };

    // Seeded so every device bakes the identical noise field.
    function bakeNoise() {
      var N = 256, seed = 1337;
      var r = new Uint8Array(N * N);
      for (var i = 0; i < N * N; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        r[i] = seed >>> 24;
      }
      var px = new Uint8Array(N * N * 4);
      for (var y = 0; y < N; y++) {
        for (var x = 0; x < N; x++) {
          var o = (y * N + x) * 4;
          px[o] = r[y * N + x];
          px[o + 1] = r[((y + 17) & 255) * N + ((x + 37) & 255)];
          px[o + 2] = 0;
          px[o + 3] = 255;
        }
      }
      gl.activeTexture(gl.TEXTURE0);
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      return tex;
    }

    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('shader: ' + gl.getShaderInfoLog(sh));
      }
      return sh;
    }
    function link(fragSrc) {
      var p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, C.vert));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error('link: ' + gl.getProgramInfoLog(p));
      }
      return p;
    }
    function locate(p) {
      function u(n) { return gl.getUniformLocation(p, n); }
      return {
        res: u('uRes'), shape: u('uShape'), layer0: u('uLayer0'), layer1: u('uLayer1'),
        angles: u('uAngles'), look: u('uLook'), look2: u('uLook2'), voice: u('uVoice'),
        voice2: u('uVoice2'), rip: u('uRip[0]') || u('uRip'), touch: u('uTouch'),
        fx: u('uFx'), knot: u('uKnot'), knotF: u('uKnotF'), knotB: u('uKnotB'),
        pulse: u('uPulse[0]') || u('uPulse'), pl: u('uPL[0]') || u('uPL'),
        slices: u('uSlices'), pal: u('uPal[0]') || u('uPal'),
        noise: u('uNoise'), interior: u('uInterior')
      };
    }

    function initGL() {
      progI = link(C.fragInterior);
      progC = link(C.fragComposite);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      noiseTex = bakeNoise();
      locI = locate(progI);
      locC = locate(progC);
      var pal = new Float32Array(C.pal);
      gl.useProgram(progI);
      gl.uniform1i(locI.noise, 0);
      gl.uniform3fv(locI.pal, pal);
      gl.useProgram(progC);
      gl.uniform1i(locC.noise, 0);
      gl.uniform1i(locC.interior, 1);
      gl.uniform3fv(locC.pal, pal);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      target = null;
    }

    // The interior renders into this (RGBA8, sqrt-encoded colour + transmittance).
    function ensureTarget() {
      var s = Q.tiers[tier].inner;
      var w = Math.max(16, Math.round(pxW * s));
      var h = Math.max(16, Math.round(pxH * s));
      if (target && target.w === w && target.h === h) return true;
      if (target) {
        gl.deleteFramebuffer(target.fb);
        gl.deleteTexture(target.tex);
        target = null;
      }
      gl.activeTexture(gl.TEXTURE1);
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) {
        gl.deleteFramebuffer(fb);
        gl.deleteTexture(tex);
        return false;
      }
      target = { tex: tex, fb: fb, w: w, h: h };
      return true;
    }

    var contextLost = false;
    var useFallback = !!window.__orbForceFallback;
    if (!useFallback) {
      try {
        gl = canvas.getContext('webgl', glAttrs) || canvas.getContext('experimental-webgl', glAttrs);
        if (!gl) throw new Error('WebGL unavailable');
        initGL();
      } catch (e) {
        rnLog('fallback', String((e && e.message) || e));
        swapToFallback();
      }
    }
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      contextLost = true;
    });
    canvas.addEventListener('webglcontextrestored', function () {
      try {
        initGL();
        contextLost = false;
        resize();
      } catch (e) {
        rnLog('fallback', 'restore: ' + String((e && e.message) || e));
        swapToFallback();
      }
    });

    function setCommon(L) {
      gl.uniform4fv(L.shape, U.shape);
      gl.uniform4fv(L.layer0, U.layer0);
      gl.uniform4fv(L.layer1, U.layer1);
      gl.uniform4fv(L.angles, U.angles);
      gl.uniform4fv(L.look, U.look);
      gl.uniform4fv(L.look2, U.look2);
      gl.uniform4fv(L.voice, U.voice);
      gl.uniform4fv(L.voice2, U.voice2);
      gl.uniform4fv(L.rip, U.rip);
      gl.uniform4fv(L.touch, U.touch);
      gl.uniform4fv(L.fx, U.fx);
      gl.uniform4fv(L.knot, U.knot);
      gl.uniform4fv(L.knotF, U.knotF);
      gl.uniform4fv(L.knotB, U.knotB);
      gl.uniform2fv(L.pulse, U.pulse);
      gl.uniform4fv(L.pl, U.pl);
    }

    function drawGL() {
      if (contextLost) return;
      if (!ensureTarget()) {
        rnLog('fallback', 'interior render target unavailable');
        swapToFallback();
        drawFallback();
        return;
      }
      var halfMin = 0.5 * Math.min(pxW, pxH);
      U.shape[1] = 1.4 / (halfMin * U.shape[0]);

      // Pass 1: the soft interior, at reduced resolution.
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      gl.viewport(0, 0, target.w, target.h);
      gl.useProgram(progI);
      gl.uniform2f(locI.res, target.w, target.h);
      gl.uniform1f(locI.slices, Q.tiers[tier].slices);
      setCommon(locI);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Pass 2: glass, the thought and sparkles, crisp at full resolution.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, pxW, pxH);
      gl.useProgram(progC);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, target.tex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(locC.res, pxW, pxH);
      setCommon(locC);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ── Canvas2D fallback: the same physics, painted with gradients ─────────
    var c2 = null;
    function rgba(rgb, a) {
      return 'rgba(' + Math.round(rgb[0] * 255) + ',' + Math.round(rgb[1] * 255) + ',' + Math.round(rgb[2] * 255) + ',' + a + ')';
    }
    var P = C.palRgb;
    function swapToFallback() {
      // A canvas that ever had a WebGL context can't give a 2D one: replace it.
      var fresh = document.createElement('canvas');
      container.replaceChild(fresh, canvas);
      canvas = fresh;
      gl = null;
      useFallback = true;
      resize();
    }
    function drawFallback() {
      if (!c2 || c2.canvas !== canvas) c2 = canvas.getContext('2d');
      if (!c2) return;
      var w = pxW, h = pxH, cx = w / 2, cy = h / 2;
      var R = 0.5 * Math.min(w, h) * U.shape[0];
      var e = U.look[0], dim = U.look[3];
      c2.clearRect(0, 0, w, h);
      c2.save();
      c2.beginPath();
      c2.arc(cx, cy, R, 0, TAU);
      c2.clip();
      var g = c2.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, rgba(P.violet, 0.5));
      g.addColorStop(1, rgba(P.navy, 0.92));
      c2.fillStyle = g;
      c2.fillRect(0, 0, w, h);
      c2.globalCompositeOperation = 'screen';
      var tx = U.shape[2] * R, ty = -U.shape[3] * R;
      // Two slow currents orbiting at different depths (parallax with tilt).
      var a1 = layer[0] * 2.1, a2 = -layer[3] * 1.7 + angles[0];
      var blobs = [
        [Math.cos(a1) * 0.32, Math.sin(a1 * 1.3) * 0.28, 0.62, P.violet, 0.45, 1],
        [Math.cos(a2) * 0.26, Math.sin(a2) * 0.3, 0.5, P.pink, 0.28, -0.6]
      ];
      for (var i = 0; i < blobs.length; i++) {
        var b = blobs[i];
        var bx = cx + b[0] * R + tx * b[5], by = cy + b[1] * R + ty * b[5];
        var bg = c2.createRadialGradient(bx, by, 0, bx, by, b[2] * R);
        bg.addColorStop(0, rgba(b[3], b[4] * e * (1 - 0.5 * dim)));
        bg.addColorStop(1, rgba(b[3], 0));
        c2.fillStyle = bg;
        c2.fillRect(0, 0, w, h);
      }
      var cr = R * U.look2[2] * (1 + U.voice[0]) * 1.6;
      var cg = c2.createRadialGradient(cx, cy, 0, cx, cy, cr);
      cg.addColorStop(0, rgba(P.coral, 0.75 * e * (1 - 0.5 * dim)));
      cg.addColorStop(0.45, rgba(P.pink, 0.32 * e * (1 - 0.5 * dim)));
      cg.addColorStop(1, rgba(P.pink, 0));
      c2.fillStyle = cg;
      c2.fillRect(0, 0, w, h);
      if (U.knot[2] > 0.01) {
        c2.save();
        c2.translate(cx, cy);
        c2.scale(1, Math.cos(U.knotF[0]));
        c2.strokeStyle = rgba(P.pink, 0.5 * U.knot[2]);
        c2.lineWidth = Math.max(1, R * 0.03);
        c2.beginPath();
        c2.arc(0, 0, R * U.knot[0], 0, TAU);
        c2.stroke();
        c2.restore();
      }
      c2.globalCompositeOperation = 'source-over';
      var rim = c2.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
      rim.addColorStop(0, rgba(P.violetSoft, 0));
      rim.addColorStop(1, rgba(P.violetSoft, 0.28));
      c2.fillStyle = rim;
      c2.fillRect(0, 0, w, h);
      var sx = cx - R * 0.38 + tx * 0.6, sy = cy - R * 0.42 + ty * 0.6;
      var sg = c2.createRadialGradient(sx, sy, 0, sx, sy, R * 0.22);
      sg.addColorStop(0, rgba(P.white, 0.5));
      sg.addColorStop(1, rgba(P.white, 0));
      c2.fillStyle = sg;
      c2.fillRect(0, 0, w, h);
      c2.restore();
    }

    function draw() {
      if (useFallback) drawFallback();
      else drawGL();
    }

    // ── Loop ────────────────────────────────────────────────────────────────
    var running = false, lastT = 0, lastDraw = 0, paceAcc = 0;
    var calm = false, calmFor = 0;
    var perfT = 0, perfDraws = 0, perfMs = 0;
    function frame(t) {
      if (!I.active || document.hidden) { running = false; return; }
      requestAnimationFrame(frame);
      var frameMs = lastT ? t - lastT : 16.7;
      lastT = t;
      var dt = Math.min(Math.max(frameMs / 1000, 0), 0.05);
      step(dt);

      // Pace: full rate while moving, half when calm; never above activeFps.
      if (activity() > PC.activityOn) { calm = false; calmFor = 0; }
      else { calmFor += dt; if (calmFor > PC.calmAfterS) calm = true; }
      var targetMs = 1000 / (calm ? PC.calmFps : PC.activeFps);
      paceAcc += frameMs;
      if (paceAcc < targetMs - 2) return;
      paceAcc -= targetMs;
      if (paceAcc > targetMs) paceAcc = 0;

      var drawMs = lastDraw ? t - lastDraw : targetMs;
      lastDraw = t;
      draw();
      if (!useFallback && !calm) adapt(drawMs, targetMs, dt);

      if (C.dev) {
        perfDraws++;
        perfMs += drawMs;
        if (t - perfT > 1000) {
          var tierCfg = Q.tiers[tier];
          rnLog('perf', {
            fps: Math.round((perfDraws * 1000) / (t - perfT)),
            ms: +(perfMs / perfDraws).toFixed(1),
            tier: tier, dpr: tierCfg.dpr, slices: tierCfg.slices, inner: tierCfg.inner,
            px: pxW + 'x' + pxH,
            ipx: target ? target.w + 'x' + target.h : '-',
            calm: calm, fallback: useFallback
          });
          perfT = t; perfDraws = 0; perfMs = 0;
        }
      }
    }
    function wake() {
      if (running || !I.active || document.hidden) return;
      running = true;
      lastT = 0;
      lastDraw = 0;
      paceAcc = 1e3; // draw the first frame immediately
      requestAnimationFrame(frame);
    }
    I.wake = wake;
    I.draw = draw;
    // Pin a quality tier (dev/testing): disables adaptation.
    I.lockTier = function (n) {
      tier = Math.max(0, Math.min(Q.tiers.length - 1, n | 0));
      locked = true;
      resize();
    };

    resize();
    wake();

    rnLog('ready', { w: cssW, h: cssH, gl: !useFallback });
  } catch (err) {
    rnLog('error', 'renderer init: ' + String((err && err.message) || err));
  }
})();
`;
