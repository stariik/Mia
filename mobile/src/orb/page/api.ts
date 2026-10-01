// The orb page's public window API. Installed in its own <script> BEFORE the
// renderer, so every entry point exists even if WebGL never comes up.
//
// New API (MiaOrb):    window.orb.{state, mic, touch, setActive, setReducedMotion}
// Native contract:     setOrbState, setHover, setOrbVisible — injected by
//                      OrbOverlayModule.kt and must keep these exact names.
//                      (The TTS functions come from ttsEngine.ts.)
//
// Everything lands in one plain input object, window.__orbIn, that the renderer
// reads each frame. Nothing here touches the GPU.

export const ORB_API_JS = `
(function () {
  try {
    var I = window.__orbIn = {
      state: 'idle',
      // Latest mic analysis: level, low, mid, high (0..1) and when it arrived.
      mic: [0, 0, 0, 0],
      micT: -1e9,
      // How long the last mic value stays valid (ms); 0 = config default.
      micHold: 0,
      // Strongest syllable onset since the renderer last consumed it.
      micOnset: 0,
      touch: { down: false, x: 0, y: 0, n: 0 },
      active: true,
      reduced: false,
      // Set by the renderer: restarts its loop after a pause.
      wake: null
    };
    var STATES = { idle: 1, listening: 1, thinking: 1, speaking: 1, error: 1 };

    function clamp01(v) {
      v = +v;
      if (!(v > 0)) return 0;
      return v > 1 ? 1 : v;
    }

    function setState(name) {
      if (STATES[name] === 1) I.state = name;
    }

    function mic(level, low, mid, high, onset) {
      pushMic(level, low, mid, high, onset, 0);
    }
    function pushMic(level, low, mid, high, onset, hold) {
      I.micHold = hold;
      I.mic[0] = clamp01(level);
      I.mic[1] = clamp01(low);
      I.mic[2] = clamp01(mid);
      I.mic[3] = clamp01(high);
      var o = clamp01(onset);
      if (o > I.micOnset) I.micOnset = o;
      I.micT = performance.now();
    }

    // Legacy single-level input (the floating overlay's setLevel). The level is
    // dBFS mapped to 0..1, so silence sits well above 0; track an ambient floor
    // and derive approximate bands from the normalized loudness and its rise.
    // These arrive via the headless JS runtime, which can lag and burst, so
    // each value is held much longer than the in-app feed's.
    var HOVER_HOLD_MS = 1500;
    var hoverFloor = 0.3;
    var hoverPrev = 0;
    function setHover(v) {
      if (window.__miaTts && window.__miaTts.playing()) return;
      if (typeof v !== 'number' || v !== v) return;
      v = clamp01(v);
      if (v < hoverFloor) hoverFloor = v;
      else hoverFloor += (v - hoverFloor) * 0.004;
      var n = clamp01((v - hoverFloor - 0.04) / 0.34);
      var rise = n - hoverPrev;
      hoverPrev = n;
      pushMic(n, n, n * 0.85, clamp01(rise * 2.5), rise > 0.12 ? clamp01(rise * 1.6) : 0, HOVER_HOLD_MS);
    }

    // x, y in -1..1 relative to the orb's centre (y up). phase 0 down, 1 move, 2 up.
    function touch(x, y, phase) {
      var t = I.touch;
      t.x = Math.max(-1, Math.min(1, +x || 0));
      t.y = Math.max(-1, Math.min(1, +y || 0));
      if (phase === 0) { t.down = true; t.n++; }
      else if (phase === 2) t.down = false;
    }

    function setActive(on) {
      I.active = !!on;
      if (I.active && I.wake) I.wake();
    }

    function setReducedMotion(on) {
      I.reduced = !!on;
    }

    window.orb = {
      state: setState,
      mic: mic,
      touch: touch,
      setActive: setActive,
      setReducedMotion: setReducedMotion
    };
    window.setOrbState = setState;
    window.setHover = setHover;

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && I.wake) I.wake();
    });

    // Entrance/exit for the floating overlay (floatIn). The host calls
    // setOrbVisible(false) and removes the view after 360 ms, so the exit must
    // finish inside that.
    var container = document.getElementById('orb-container');
    window.setOrbVisible = function (v) {
      if (!container) return;
      if (v) {
        container.classList.remove('exiting');
        container.classList.add('visible');
      } else {
        container.classList.add('exiting');
      }
    };
    // Spring in once the hidden initial state has painted (two frames), or the
    // browser coalesces it into no transition. Lives here, not in the renderer,
    // so the overlay still appears if WebGL fails.
    if (window.__orbCfg && window.__orbCfg.floatIn) {
      document.body.classList.add('float-in');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { window.setOrbVisible(true); });
      });
    }
  } catch (err) {
    rnLog('error', 'api init: ' + String((err && err.message) || err));
  }
})();
`;
