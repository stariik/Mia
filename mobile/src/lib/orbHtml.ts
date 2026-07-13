// Faithful port of the reactbits Orb (https://www.reactbits.dev/backgrounds/orb)
// rendered inside a transparent WebView. The only adaptation is that mouse
// hover is replaced by an externally-driven amplitude — React Native calls
// `window.setHover(0..1)` via injectJavaScript on every audio tick.
//
// Rendered with raw WebGL (no external library). The fullscreen-shader setup
// is inlined so the orb renders fully offline — earlier versions imported OGL
// from esm.sh at runtime, which left the orb blank whenever the device/WebView
// had no network.

export type OrbHtmlOpts = {
  hue?: number;
  hoverIntensity?: number;
  rotateOnHover?: boolean;
  forceHoverState?: boolean;
  backgroundColor?: string;
  /**
   * Floating-overlay mode. Feathers the orb's alpha to 0 outside its circle so
   * the square WebView leaves NO faint residual when composited over other apps
   * — only the orb itself shows. Off (false) keeps the full soft bloom, which is
   * what the in-app orb wants since it sits on a dark backdrop.
   */
  edgeFade?: boolean;
  /**
   * Entrance/exit animation. When true the orb starts hidden and springs up
   * (scale + fade) on load, and `window.setOrbVisible(false)` plays the reverse
   * before the host removes the view. Used by the floating "Hey Mia" overlay so
   * it appears with a satisfying pop instead of snapping in. The in-app orb
   * leaves this off (it's always present on its own backdrop).
   */
  floatIn?: boolean;
};

const VERT = `
precision highp float;
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform float iTime;
uniform vec3 iResolution;
uniform float hue;
uniform float hover;
uniform float rot;
uniform float hoverIntensity;
uniform vec3 backgroundColor;
// 1.0 = overlay mode: feather alpha to 0 outside the orb circle (see main()).
uniform float edgeFade;
// Assistant-state weights, crossfaded on the JS side:
// x = idle, y = listening, z = thinking, w = speaking.
uniform vec4 stateW;
varying vec2 vUv;

vec3 rgb2yiq(vec3 c) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  return vec3(y, i, q);
}

vec3 yiq2rgb(vec3 c) {
  float r = c.x + 0.956 * c.y + 0.621 * c.z;
  float g = c.x - 0.272 * c.y - 0.647 * c.z;
  float b = c.x - 1.106 * c.y + 1.703 * c.z;
  return vec3(r, g, b);
}

vec3 adjustHue(vec3 color, float hueDeg) {
  float hueRad = hueDeg * 3.14159265 / 180.0;
  vec3 yiq = rgb2yiq(color);
  float cosA = cos(hueRad);
  float sinA = sin(hueRad);
  float i = yiq.y * cosA - yiq.z * sinA;
  float q = yiq.y * sinA + yiq.z * cosA;
  yiq.y = i;
  yiq.z = q;
  return yiq2rgb(yiq);
}

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3(
    p3.x + p3.y,
    p3.x + p3.z,
    p3.y + p3.z
  ) * p3.zyx);
}

float snoise3(vec3 p) {
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - K2);
  vec3 d2 = d0 - (i2 - K1);
  vec3 d3 = d0 - 0.5;
  vec4 h = max(0.6 - vec4(
    dot(d0, d0),
    dot(d1, d1),
    dot(d2, d2),
    dot(d3, d3)
  ), 0.0);
  vec4 n = h * h * h * h * vec4(
    dot(d0, hash33(i)),
    dot(d1, hash33(i + i1)),
    dot(d2, hash33(i + i2)),
    dot(d3, hash33(i + 1.0))
  );
  return dot(vec4(31.316), n);
}

vec4 extractAlpha(vec3 colorIn) {
  float a = max(max(colorIn.r, colorIn.g), colorIn.b);
  return vec4(colorIn.rgb / (a + 1e-5), a);
}

// Logo palette: violet → pink → coral (matches the brand gradient).
const vec3 baseColor1 = vec3(0.427451, 0.231373, 0.960784); // violet #6d3bf5
const vec3 baseColor2 = vec3(1.000000, 0.301961, 0.545098); // pink   #ff4d8b
const vec3 baseColor3 = vec3(1.000000, 0.419608, 0.239216); // coral  #ff6b3d
const float innerRadius = 0.6;
const float noiseScale = 0.65;

float light1(float intensity, float attenuation, float dist) {
  return intensity / (1.0 + dist * attenuation);
}
float light2(float intensity, float attenuation, float dist) {
  return intensity / (1.0 + dist * dist * attenuation);
}

vec4 draw(vec2 uv) {
  // Per-state hue: listening leans pink, thinking leans violet, speaking
  // leans warm coral. Idle keeps the base palette.
  float stHue = hue + stateW.y * 8.0 - stateW.z * 30.0 + stateW.w * 12.0;
  vec3 color1 = adjustHue(baseColor1, stHue);
  vec3 color2 = adjustHue(baseColor2, stHue);
  vec3 color3 = adjustHue(baseColor3, stHue);

  float ang = atan(uv.y, uv.x);
  float len = length(uv);
  float invLen = len > 0.0 ? 1.0 / len : 0.0;

  float bgLuminance = dot(backgroundColor, vec3(0.299, 0.587, 0.114));

  // Thinking churns the surface noise faster — the orb visibly "computes".
  float nt = iTime * (0.5 + stateW.z * 0.5 + stateW.w * 0.12);
  float n0 = snoise3(vec3(uv * noiseScale, nt)) * 0.5 + 0.5;
  float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
  float d0 = distance(uv, (r0 * invLen) * uv);
  float v0 = light1(1.0, 10.0, d0);

  v0 *= smoothstep(r0 * 1.05, r0, len);
  float innerFade = smoothstep(r0 * 0.8, r0 * 0.95, len);
  v0 *= mix(innerFade, 1.0, bgLuminance * 0.7);
  float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;

  // Primary orbiting light — accelerates while thinking.
  float orbitSpeed = 1.0 + stateW.z * 2.4 + stateW.w * 0.5;
  float a = iTime * -orbitSpeed;
  vec2 pos = vec2(cos(a), sin(a)) * r0;
  float d = distance(uv, pos);
  float v1 = light2(1.5, 5.0, d);
  v1 *= light1(1.0, 50.0, d0);

  // Second, counter-orbiting light — fades in while listening/thinking so
  // the orb reads as "engaged" (two points of attention chasing each other).
  float secondAmt = stateW.y * 0.7 + stateW.z * 0.9;
  float a2 = iTime * 1.35 * orbitSpeed + 2.1;
  vec2 pos2 = vec2(cos(a2), sin(a2)) * r0;
  float d2 = distance(uv, pos2);
  float v1b = light2(1.2, 6.0, d2) * light1(1.0, 50.0, d0);
  v1 += v1b * secondAmt;

  float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
  float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);

  vec3 colBase = mix(color1, color2, cl);
  float fadeAmount = mix(1.0, 0.1, bgLuminance);

  // Center bloom — while listening the core glows with the live mic level,
  // so the user SEES Mia hearing them. A touch of it while speaking too.
  float coreAmt = stateW.y * (0.22 + hover * 0.85) + stateW.w * hover * 0.22;
  float core = light2(1.0, 9.0, len) * coreAmt;

  vec3 darkCol = mix(color3, colBase, v0);
  darkCol = (darkCol + v1) * v2 * v3;
  darkCol += colBase * core;
  darkCol = clamp(darkCol, 0.0, 1.0);

  vec3 lightCol = (colBase + v1) * mix(1.0, v2 * v3, fadeAmount);
  lightCol = mix(backgroundColor, lightCol, v0);
  lightCol += colBase * core;
  lightCol = clamp(lightCol, 0.0, 1.0);

  vec3 finalCol = mix(darkCol, lightCol, bgLuminance);

  return extractAlpha(finalCol);
}

vec4 mainImage(vec2 fragCoord) {
  vec2 center = iResolution.xy * 0.5;
  float size = min(iResolution.x, iResolution.y);
  vec2 uv = (fragCoord - center) / size * 2.0;

  float angle = rot;
  float s = sin(angle);
  float c = cos(angle);
  uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

  uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
  uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);

  return draw(uv);
}

void main() {
  vec2 fragCoord = vUv * iResolution.xy;
  vec4 col = mainImage(fragCoord);
  float a = col.a;
  if (edgeFade > 0.5) {
    // Fade the orb's outer bloom to FULLY transparent well INSIDE the canvas,
    // so no alpha reaches the square edge — that edge residual (strongest at the
    // four edge midpoints, radius 1.0) is what reads as a box. Mask is 1.0
    // within radius 0.75 and ramps smoothly to 0.0 by 0.95, so it's gone before
    // any edge. The orb's core/body (< 0.75) is untouched; only the outer bloom
    // fades. Multiplied into BOTH the premultiplied color and the alpha output.
    vec2 c = iResolution.xy * 0.5;
    float sz = min(iResolution.x, iResolution.y);
    float rNorm = length((fragCoord - c) / sz * 2.0);
    a *= smoothstep(0.95, 0.75, rNorm);
  }
  gl_FragColor = vec4(col.rgb * a, a);
}
`;

export function buildOrbHtml({
  hue = 0,
  hoverIntensity = 0.2,
  rotateOnHover = true,
  forceHoverState = false,
  backgroundColor = '#000000',
  edgeFade = false,
  floatIn = false,
}: OrbHtmlOpts = {}): string {
  const cfg = JSON.stringify({
    hue,
    hoverIntensity,
    rotateOnHover,
    forceHoverState,
    backgroundColor,
    edgeFade,
    floatIn,
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; width: 100%; background: transparent; overflow: hidden; }
  body { -webkit-tap-highlight-color: transparent; touch-action: none; pointer-events: none; -webkit-user-select: none; user-select: none; }
  #orb-container { position: absolute; inset: 0; }
  /* Float-in mode: spring up on entrance, reverse on exit. The square WebView
     keeps its layout size, so the WebGL canvas resolution is untouched — only
     the composited result is scaled/faded. */
  body.float-in #orb-container {
    opacity: 0;
    transform: translateY(28px) scale(0.7);
    transform-origin: 50% 60%;
    /* Solid, confident rise into place — gentle settle, no cheap bounce. */
    transition: transform 440ms cubic-bezier(0.34, 1.4, 0.5, 1), opacity 280ms ease-out;
    will-change: transform, opacity;
  }
  body.float-in #orb-container.visible { opacity: 1; transform: translateY(0) scale(1); }
  /* Exit: a quick pop-up then collapse-and-fade — a satisfying Siri-style close. */
  body.float-in #orb-container.exiting {
    animation: orbExit 320ms cubic-bezier(0.4, 0, 0.7, 0.2) forwards;
  }
  @keyframes orbExit {
    0%   { opacity: 1; transform: translateY(0) scale(1); }
    26%  { opacity: 1; transform: translateY(-7px) scale(1.07); }
    100% { opacity: 0; transform: translateY(12px) scale(0.3); }
  }
  canvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="orb-container"></div>
<script>
  function rnLog(kind, payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ kind: kind, payload: payload }));
      }
    } catch (_) {}
  }
  window.addEventListener('error', function (e) {
    rnLog('error', String(e.message || e.error || e));
  });
  window.addEventListener('unhandledrejection', function (e) {
    rnLog('error', 'unhandledrejection: ' + String(e.reason));
  });
</script>
<script>
  (function () {
  try {
    var cfg = ${cfg};
    var hue = cfg.hue;
    var hoverIntensity = cfg.hoverIntensity;
    var rotateOnHover = cfg.rotateOnHover;
    var forceHoverState = cfg.forceHoverState;
    var backgroundColor = cfg.backgroundColor;
    var edgeFade = cfg.edgeFade ? 1.0 : 0.0;
    var floatIn = !!cfg.floatIn;

    function hslToRgb(h, s, l) {
      var r, g, b;
      if (s === 0) {
        r = g = b = l;
      } else {
        var hue2rgb = function (p, q, t) {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
      }
      return [r, g, b];
    }

    function hexToVec3(color) {
      if (color.charAt(0) === '#') {
        return [
          parseInt(color.slice(1, 3), 16) / 255,
          parseInt(color.slice(3, 5), 16) / 255,
          parseInt(color.slice(5, 7), 16) / 255
        ];
      }
      var rgbMatch = color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      if (rgbMatch) {
        return [parseInt(rgbMatch[1]) / 255, parseInt(rgbMatch[2]) / 255, parseInt(rgbMatch[3]) / 255];
      }
      var hslMatch = color.match(/hsla?\\((\\d+),\\s*(\\d+)%,\\s*(\\d+)%/);
      if (hslMatch) {
        var h = parseInt(hslMatch[1]) / 360;
        var s = parseInt(hslMatch[2]) / 100;
        var l = parseInt(hslMatch[3]) / 100;
        return hslToRgb(h, s, l);
      }
      return [0, 0, 0];
    }

    var container = document.getElementById('orb-container');
    var canvas = document.createElement('canvas');
    container.appendChild(canvas);

    // Entrance/exit animation hook (overlay only — see floatIn). The host calls
    // window.setOrbVisible(false) and waits out the CSS transition before
    // removing the WebView, so the orb pops away instead of vanishing.
    if (floatIn) document.body.classList.add('float-in');
    window.setOrbVisible = function (v) {
      if (v) {
        container.classList.remove('exiting');
        container.classList.add('visible');
      } else {
        container.classList.add('exiting');
      }
    };

    // Same context attributes OGL's Renderer used: transparent canvas,
    // straight (non-premultiplied) alpha so it composites over the RN view.
    var glAttrs = {
      alpha: true, depth: true, stencil: false, antialias: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'default'
    };
    var gl = canvas.getContext('webgl2', glAttrs) || canvas.getContext('webgl', glAttrs);
    if (!gl) { rnLog('error', 'WebGL unavailable'); return; }

    function compileShader(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('shader compile: ' + gl.getShaderInfoLog(sh));
      }
      return sh;
    }
    var program = gl.createProgram();
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, ${JSON.stringify(VERT)}));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, ${JSON.stringify(FRAG)}));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('program link: ' + gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

    // Fullscreen triangle — identical vertices to OGL's Triangle geometry.
    var posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    var uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 2, 0, 0, 2]), gl.STATIC_DRAW);
    var uvLoc = gl.getAttribLocation(program, 'uv');
    if (uvLoc !== -1) {
      gl.enableVertexAttribArray(uvLoc);
      gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
    }

    var U = {
      iTime: gl.getUniformLocation(program, 'iTime'),
      iResolution: gl.getUniformLocation(program, 'iResolution'),
      hue: gl.getUniformLocation(program, 'hue'),
      hover: gl.getUniformLocation(program, 'hover'),
      rot: gl.getUniformLocation(program, 'rot'),
      hoverIntensity: gl.getUniformLocation(program, 'hoverIntensity'),
      backgroundColor: gl.getUniformLocation(program, 'backgroundColor'),
      edgeFade: gl.getUniformLocation(program, 'edgeFade'),
      stateW: gl.getUniformLocation(program, 'stateW')
    };

    var dpr = window.devicePixelRatio || 1;
    var viewW = 1, viewH = 1;
    function resize() {
      var width = container.clientWidth || 1;
      var height = container.clientHeight || 1;
      viewW = Math.max(1, Math.floor(width * dpr));
      viewH = Math.max(1, Math.floor(height * dpr));
      canvas.width = viewW;
      canvas.height = viewH;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      gl.viewport(0, 0, viewW, viewH);
    }
    window.addEventListener('resize', resize);
    resize();

    // Lerped hover value driving the shader (was program.uniforms.hover.value).
    var hoverValue = 0;

    var targetHover = 0;
    var lastTime = 0;
    var currentRot = 0;
    var rotationSpeed = 0.3;

    // Smoothstep for the rotation ramp — replaces the original hard
    // effectiveHover > 0.5 threshold so rotation eases in/out instead of
    // popping on at full speed.
    function smoothstep(e0, e1, x) {
      var t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    }

    // Replaces the mouse hover handlers from the original component. RN
    // injects window.setHover(amp) on every audio tick. Skipped while TTS is
    // playing inside this WebView — see playTTSAudio below.
    var ttsPlaying = false;
    window.setHover = function (v) {
      if (ttsPlaying) return;
      if (typeof v !== 'number' || isNaN(v)) return;
      if (v < 0) v = 0; else if (v > 1) v = 1;
      targetHover = v;
    };

    // ─── Assistant state → visual personality ─────────────────────────────
    // RN pushes window.setOrbState on every state change; weights crossfade
    // toward the target each frame (~350ms) so transitions glide rather than
    // snap. Indices: 0 idle, 1 listening, 2 thinking, 3 speaking.
    var STATE_IDX = { idle: 0, listening: 1, thinking: 2, speaking: 3 };
    var stateW = [1, 0, 0, 0];
    var stateTarget = [1, 0, 0, 0];
    var listenPulseStart = -1e9;

    window.setOrbState = function (name) {
      var idx = STATE_IDX[name];
      if (idx == null) return;
      var changed = stateTarget[idx] !== 1;
      for (var i = 0; i < 4; i++) stateTarget[i] = i === idx ? 1 : 0;
      // Acknowledgment pulse on entering listening: a brief bloom that says
      // "I heard you" the instant recording starts.
      if (idx === 1 && changed) listenPulseStart = performance.now();
    };

    // ─── TTS playback + real-time analyser ────────────────────────────────
    // RN sends a base64-encoded TTS file; we play it inside the WebView and
    // drive targetHover from a Web Audio AnalyserNode. The orb's "speaking"
    // animation is therefore a true reflection of the audio waveform.
    var audioCtx = null;
    var analyser = null;
    var analyserBuf = null;
    var currentAudio = null;
    var currentBlobUrl = null;
    var analyserRaf = null;

    function base64ToBlob(b64, mime) {
      var bin = atob(b64);
      var len = bin.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }

    function revokeBlob() {
      if (currentBlobUrl) {
        try { URL.revokeObjectURL(currentBlobUrl); } catch (_) {}
        currentBlobUrl = null;
      }
    }

    function stopAnalysis() {
      if (analyserRaf) {
        cancelAnimationFrame(analyserRaf);
        analyserRaf = null;
      }
      ttsPlaying = false;
      targetHover = 0;
    }

    window.playTTSAudio = function (opts) {
      try {
        var base64 = opts && opts.base64;
        var mime = (opts && opts.mime) || 'audio/mpeg';
        if (!base64) {
          rnLog('tts-error', 'no base64 payload');
          return;
        }
        // Stop any previous playback.
        if (currentAudio) {
          try { currentAudio.pause(); } catch (_) {}
          currentAudio.src = '';
          currentAudio = null;
        }
        revokeBlob();
        stopAnalysis();

        if (!audioCtx) {
          var Ctor = window.AudioContext || window.webkitAudioContext;
          if (!Ctor) {
            rnLog('tts-error', 'AudioContext unsupported');
            return;
          }
          audioCtx = new Ctor();
        }
        var blob = base64ToBlob(base64, mime);
        currentBlobUrl = URL.createObjectURL(blob);

        var a = new Audio();
        a.preload = 'auto';
        a.src = currentBlobUrl;

        a.addEventListener('ended', function () {
          stopAnalysis();
          revokeBlob();
          currentAudio = null;
          rnLog('tts-ended', null);
        });
        a.addEventListener('error', function () {
          stopAnalysis();
          revokeBlob();
          currentAudio = null;
          var msg = a.error ? 'audio error code ' + a.error.code : 'audio error';
          rnLog('tts-error', msg);
        });

        var source = audioCtx.createMediaElementSource(a);
        if (!analyser) {
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 1024;
          // Higher smoothing — the orb should flow with speech rather than
          // chatter on every syllable boundary. Combined with the attack/
          // release shaping in tick() this gives a noticeably smoother feel
          // without losing responsiveness on volume swells.
          analyser.smoothingTimeConstant = 0.55;
          analyserBuf = new Uint8Array(analyser.fftSize);
        }
        source.connect(analyser);
        analyser.connect(audioCtx.destination);

        currentAudio = a;
        ttsPlaying = true;

        function tick() {
          analyserRaf = requestAnimationFrame(tick);
          analyser.getByteTimeDomainData(analyserBuf);
          var sumSq = 0;
          for (var i = 0; i < analyserBuf.length; i++) {
            var v = (analyserBuf[i] - 128) / 128;
            sumSq += v * v;
          }
          var rms = Math.sqrt(sumSq / analyserBuf.length);
          // RMS for speech sits ~0.05–0.30; scale up so the orb breathes
          // visibly without saturating on shouted vowels.
          var amp = rms * 3.6;
          if (amp > 1) amp = 1;
          // Attack / release shaping: rise quickly enough to capture syllable
          // peaks, fall slowly so the orb glides through inter-syllable gaps
          // instead of snapping closed. Without this the motion looks twitchy
          // even with a high analyser smoothing constant.
          if (amp > targetHover) {
            targetHover += (amp - targetHover) * 0.50;
          } else {
            targetHover += (amp - targetHover) * 0.10;
          }
        }
        tick();

        // The context is suspended between clips (stopTTSAudio) and at
        // creation (autoplay policy). resume() is async — starting the
        // <audio> before it completes routes the first ~300ms into a dead
        // context, eating the head of every clip. Resume first, then play.
        function startPlayback() {
          var pp = a.play();
          if (pp && typeof pp.then === 'function') {
            pp.catch(function (e) {
              stopAnalysis();
              revokeBlob();
              currentAudio = null;
              rnLog('tts-error', 'play rejected: ' + (e && e.message ? e.message : String(e)));
            });
          }
        }
        if (audioCtx.state === 'suspended') {
          audioCtx.resume().then(startPlayback, startPlayback);
        } else {
          startPlayback();
        }
      } catch (err) {
        stopAnalysis();
        revokeBlob();
        rnLog('tts-error', 'playTTSAudio: ' + (err && err.message ? err.message : String(err)));
      }
    };

    window.stopTTSAudio = function () {
      try {
        if (currentAudio) {
          currentAudio.pause();
          currentAudio.src = '';
          currentAudio = null;
        }
      } catch (_) {}
      revokeBlob();
      stopAnalysis();
      // Release the output audio route so a subsequent mic recording starts
      // clean. A running AudioContext keeps the loudspeaker route active, which
      // on some devices bleeds a constant level into the mic and stalls silence
      // detection. playTTSAudio resumes it for the next clip.
      try {
        if (audioCtx && audioCtx.state === 'running') audioCtx.suspend();
      } catch (_) {}
    };

    function update(t) {
      requestAnimationFrame(update);
      var dt = (t - lastTime) * 0.001;
      lastTime = t;
      // First frame / tab-resume protection: a giant dt would teleport the
      // rotation and snap the state crossfade.
      if (dt < 0) dt = 0;
      if (dt > 0.05) dt = 0.05;

      // Crossfade state weights toward the target (~350ms feel).
      var k = 1 - Math.exp(-dt * 9);
      for (var i = 0; i < 4; i++) {
        stateW[i] += (stateTarget[i] - stateW[i]) * k;
      }

      var effectiveHover = forceHoverState ? 1 : targetHover;

      // Thinking churn — nothing external drives the orb while Mia waits for
      // the model, so synthesize a layered organic pulse. Two incommensurate
      // sines avoid a metronome feel.
      var think = stateW[2];
      if (think > 0.02 && !ttsPlaying) {
        var tp =
          0.18 +
          0.09 * Math.sin(t * 0.0026) +
          0.05 * Math.sin(t * 0.0057 + 1.3);
        var thv = tp * think;
        if (thv > effectiveHover) effectiveHover = thv;
      }

      // "I heard you" pulse — exponential decay over ~600ms from the moment
      // listening starts.
      var lp = Math.exp(-(t - listenPulseStart) / 240) * 0.55;
      if (lp > 0.01 && lp > effectiveHover) effectiveHover = lp;

      // Idle breath — when nothing's actively driving the orb, gently rise
      // and fall so it never looks frozen. Amplitude is small enough to read
      // as ambience, not animation.
      if (!ttsPlaying && !forceHoverState && targetHover < 0.04) {
        var breath = 0.022 + 0.014 * Math.sin(t * 0.0009);
        if (breath > effectiveHover) effectiveHover = breath;
      }

      // Smooth lerp during TTS keeps motion flowing while still tracking
      // loudness changes within a few frames.
      var lerp = ttsPlaying ? 0.22 : 0.1;
      hoverValue += (effectiveHover - hoverValue) * lerp;

      // Base rotation per state — idle drifts, listening turns gently,
      // thinking spins with intent, speaking rolls warmly. Voice amplitude
      // adds its kick on top (original behavior).
      var baseRot =
        0.05 * stateW[0] +
        0.12 * stateW[1] +
        0.55 * stateW[2] +
        0.2 * stateW[3];
      var rotKick = rotateOnHover ? smoothstep(0.15, 0.55, hoverValue) : 0;
      currentRot += dt * (baseRot + rotationSpeed * rotKick);

      var bg = hexToVec3(backgroundColor);
      gl.uniform1f(U.iTime, t * 0.001);
      gl.uniform3f(U.iResolution, viewW, viewH, viewW / viewH);
      gl.uniform1f(U.hue, hue);
      gl.uniform1f(U.hover, hoverValue);
      gl.uniform1f(U.rot, currentRot);
      gl.uniform1f(U.hoverIntensity, hoverIntensity);
      gl.uniform3f(U.backgroundColor, bg[0], bg[1], bg[2]);
      gl.uniform1f(U.edgeFade, edgeFade);
      gl.uniform4f(U.stateW, stateW[0], stateW[1], stateW[2], stateW[3]);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    requestAnimationFrame(update);

    // Trigger the float-in once the hidden initial state has painted (two
    // frames), otherwise the browser coalesces it into no transition.
    if (floatIn) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (window.setOrbVisible) window.setOrbVisible(true);
        });
      });
    }

    rnLog('ready', {
      w: container.clientWidth,
      h: container.clientHeight,
      gl: (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) ? 2 : 1
    });
  } catch (err) {
    rnLog('error', 'init: ' + String(err && err.message || err));
  }
  })();
</script>
</body>
</html>`;
}
