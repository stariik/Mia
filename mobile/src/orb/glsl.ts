// MiaOrb shaders — "Glass & Ink".
//
// One fullscreen pass. The exterior is an analytic glass sphere (fresnel rim,
// one soft key-light specular, lens refraction). The interior is a pseudo-volume
// marched front-to-back through the sphere's chord in a few depth slices: ink
// (absorbing, domain-warped density), silk (luminous ribbons on the noise
// field's mid iso-surface) and a heavy core whose light scatters through it.
//
// Thin features that would alias across so few slices — the thinking braid and
// the sparkles — are drawn in screen space and composited at their depth using
// the transmittance captured while marching.
//
// Colour is LOCKED to the palette uniforms: everything is a mix of them, scaled
// in brightness. The final tone curve scales all three channels by the same
// factor, so overexposure can never drift a hue toward yellow or white.
//
// GLSL ES 1.00 (WebGL1-safe): constant loop bounds, no derivatives, highp guarded.

export const MAX_SLICES = 6;

export const ORB_VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const ORB_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

#define MAX_SLICES ${MAX_SLICES}

uniform vec2 uRes;
uniform vec4 uShape;   // x sphere radius (half-canvas units), y edge AA (sphere units), zw tilt
uniform vec4 uLayer0;  // per-slice flow phases (each wrapped mod 256 → seamless)
uniform vec4 uLayer1;  // slices 4..5 in xy, z warp phase (mod 256), w sparkle drift
uniform vec4 uAngles;  // x orbit, y braid twist, z braid pulse, w radial stream (all mod 2π)
uniform vec4 uLook;    // x energy, y warmth, z vortex, w dim
uniform vec4 uLook2;   // x sparkle, y lean (+in/toward viewer, −out), z core radius, w warp
uniform vec4 uVoice;   // x core swell, y twist, z high shimmer, w loudness
uniform vec4 uVoice2;  // x user pull weight, y Mia push weight, z front bias, w twinkle phase (mod 2π)
uniform vec4 uRip[4];  // x radius, y strength, z direction (+1 out, −1 in)
uniform vec4 uTouch;   // xy point (sphere units), z radius, w strength
uniform float uSlices;
uniform vec3 uPal[7];  // violet, pink, coral, pinkSoft, violetSoft, white, navy
uniform sampler2D uNoise;

varying vec2 vUv;

const float TAU = 6.28318530718;

// Texture-baked 3D value noise: G holds R shifted by (37,17), i.e. the next z
// layer, so one bilinear fetch yields both z neighbours. Periodic in every
// axis with period 256 — the JS side wraps all noise phases mod 256.
float vnoise(vec3 x) {
  vec3 p = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = p.xy + vec2(37.0, 17.0) * p.z + f.xy;
  vec2 rg = texture2D(uNoise, (uv + 0.5) / 256.0).xy;
  return mix(rg.x, rg.y, f.z);
}

vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, s, -s, c);
}

// The palette as a temperature ramp: violet (cool) → pink → coral (hot).
vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = mix(uPal[0], uPal[1], smoothstep(0.0, 0.56, t));
  return mix(a, uPal[2], smoothstep(0.52, 1.0, t));
}

// Screen-space sparkle layer: one jittered point per cell, twinkling at an
// integer multiple of the (wrapped) twinkle phase so it never pops.
float sparkleLayer(vec2 uv, float density, float seed) {
  vec2 g = uv * 13.0;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec3 h = hash32(id + seed);
  if (h.z > density) return 0.0;
  vec2 off = (h.xy - 0.5) * 0.62;
  float d = length(f - off);
  float tw = 0.5 + 0.5 * sin(uVoice2.w * (1.0 + floor(h.x * 3.0)) + h.y * TAU);
  tw = tw * tw;
  return (smoothstep(0.075, 0.0, d) + smoothstep(0.22, 0.0, d) * 0.18) * tw;
}

void main() {
  vec2 frag = vUv * uRes;
  float halfMin = 0.5 * min(uRes.x, uRes.y);
  vec2 p = (frag - 0.5 * uRes) / halfMin;
  float R = uShape.x;
  vec2 q = p / R;
  float r = length(q);
  float aa = uShape.y;

  float energy = uLook.x;
  float warm = uLook.y;
  float vortex = uLook.z;
  float dim = uLook.w;

  // Outside the glass: nothing but a whisper of light spilling onto whatever
  // is behind (fades to zero long before the canvas edge — no box, no ring).
  if (r > 1.0 + aa) {
    float spill = exp(-(r - 1.0) * 26.0) * smoothstep(1.14, 1.04, r) * 0.045 * energy * (1.0 - 0.6 * dim);
    vec3 sc = mix(uPal[0], uPal[1], 0.4) * spill;
    gl_FragColor = vec4(sc, spill * 0.6);
    return;
  }

  float r2 = min(dot(q, q), 1.0);
  float nz = sqrt(1.0 - r2);
  vec3 n = vec3(q, nz);
  vec2 tilt = uShape.zw;

  // Lens: the view ray bends toward the centre as it enters the glass, so the
  // interior magnifies toward the rim like a real marble.
  vec3 rd = refract(vec3(0.0, 0.0, -1.0), n, 0.78);
  vec2 bend = rd.xy / max(-rd.z, 0.25);

  // Shared per-pixel warp (computed once, reused by every slice).
  vec2 wq = q * 1.25;
  float wx = vnoise(vec3(wq * 1.2, uLayer1.z));
  float wy = vnoise(vec3(wq * 1.2 + vec2(19.7, 7.3), uLayer1.z + 11.0));
  vec2 warp = (vec2(wx, wy) - 0.5) * 2.0 * uLook2.w;

  float lean = uLook2.y;
  float coreR = uLook2.z * (1.0 + uVoice.x);
  float twist = uVoice.y;
  float stream = (uVoice2.x + uVoice2.y) * (0.35 + 0.65 * uVoice.w);

  // Thinking braid lives on a ring tilted toward the viewer. Work out where
  // this pixel sits on that ring once, so the march can capture the
  // transmittance at the ring's depth.
  const float RING_TILT = 1.02;
  vec2 ru = vec2(q.x, q.y / cos(RING_TILT));
  float rho = length(ru);
  float rth = atan(ru.y, ru.x);
  float zRing = rho * sin(rth) * sin(RING_TILT) * nz;

  float dz = 2.0 * nz / uSlices;
  vec3 acc = vec3(0.0);
  float T = 1.0;
  float Tring = 1.0;
  float Tspark = 1.0;
  float coreLight = 0.0;

  for (int i = 0; i < MAX_SLICES; i++) {
    if (float(i) >= uSlices) break;
    float fi = (float(i) + 0.5) / uSlices;          // 0 front … 1 back
    float z = nz * (1.0 - 2.0 * fi);
    vec3 pt = vec3(q + bend * (nz - z) * 0.42, z);
    pt.xy += tilt * z;                               // depth parallax

    // Voice ripples: a travelling shell that shoves the medium as it passes.
    float rip = 0.0;
    float pl = length(pt);
    vec3 pdir = pt / max(pl, 1e-3);
    for (int k = 0; k < 4; k++) {
      vec4 rp = uRip[k];
      float d = pl - rp.x;
      float w = exp(-d * d * 55.0) * rp.y;
      pt += pdir * w * 0.1 * rp.z;
      rip += w;
    }
    // Touch: a ripple from the point the finger landed.
    if (uTouch.w > 0.001) {
      vec3 tc = vec3(uTouch.xy, sqrt(max(0.0, 1.0 - dot(uTouch.xy, uTouch.xy))));
      float dt = length(pt - tc) - uTouch.z;
      float w = exp(-dt * dt * 40.0) * uTouch.w;
      pt += normalize(pt - tc + 1e-3) * w * 0.06;
      rip += w * 0.8;
    }

    // Gather toward the centre and forward (user) or bloom outward (Mia).
    pt.xy *= 1.0 + lean * 0.5 * (1.0 - 0.4 * fi);
    pt.z -= lean * 0.32;

    // Radial streaming: a wave carried inward (pull) or outward (push).
    pt += pdir * sin(pl * 8.5 - uAngles.w) * 0.07 * stream;

    // Mid band: the currents twist, more strongly near the heart.
    pt.xy = rot(twist * (1.0 - min(pl, 1.0)) * 1.3) * pt.xy;

    // Thinking: differential rotation — a fixed spiral shear spun rigidly, so
    // the medium braids into an orbit without ever winding itself into mush.
    // (uAngles.x only advances while thinking, so it is safe to apply always.)
    pt.xy = rot(uAngles.x + vortex * 0.85 / (length(pt.xy) + 0.42)) * pt.xy;

    // Each depth layer flows on its own clock and heading (parallax by speed).
    float lp = i < 4
      ? (i == 0 ? uLayer0.x : (i == 1 ? uLayer0.y : (i == 2 ? uLayer0.z : uLayer0.w)))
      : (i == 4 ? uLayer1.x : uLayer1.y);
    vec2 sxy = rot(float(i) * 1.9) * (pt.xy * 1.15 + warp * (0.65 + 0.35 * fi));
    vec3 s = vec3(sxy, pt.z * 1.0) + vec3(lp, 0.0, lp);
    float base = vnoise(s);
    float det = vnoise(s * 2.4 + vec3(0.0, 5.2, lp));
    float nv = base * 0.76 + det * 0.24;

    // Ink: soft absorbing clouds (with fine detail).
    float ink = smoothstep(0.44, 0.88, nv);
    // Silk: long ribbons on the smooth field's mid iso-surface; the detail
    // field varies their light along their length, like folds catching light.
    float sw = 0.026 + 0.016 * fi;
    float sd = (base - 0.5) / sw;
    float sd2 = (base - 0.34) / (sw * 1.6);          // fainter second sheet
    float silk = exp(-sd * sd) + exp(-sd2 * sd2) * 0.38;
    silk *= 0.3 + 0.7 * smoothstep(0.28, 0.78, det);
    silk *= smoothstep(1.0, 0.7, pl);               // ribbons fade at the glass

    vec3 cp = pt * vec3(1.0, 1.0, 1.2);
    float dc2 = dot(cp, cp);
    float core = exp(-dc2 / (coreR * coreR));
    float scatter = 1.0 / (1.0 + dc2 * 7.0);
    coreLight += core * dz;

    float t = warm + 0.5 * core + 0.22 * scatter - 0.24 * fi - 0.12 * pl + (nv - 0.5) * 0.35;
    vec3 inkCol = ramp(t - 0.12) * ink * (0.1 + 0.95 * scatter);
    vec3 silkCol = ramp(t + 0.1) * silk * (0.95 + 1.5 * scatter + rip * 1.8);
    vec3 coreCol = mix(uPal[1], uPal[2], 0.55 + 0.3 * uVoice.x) * core * 2.2;

    float front = 1.0 + uVoice2.z * (0.9 - 1.8 * fi);
    vec3 emit = (inkCol + silkCol * 1.15 + coreCol) * front;
    float dens = (ink * 1.6 + silk * 0.35 + core * 1.4) * front;

    acc += T * emit * dz;
    T *= exp(-dens * dz * 1.25);
    if (z > zRing) Tring = T;
    if (fi < 0.34) Tspark = T;
  }

  vec3 col = acc * energy * (1.0 + uVoice.w * 0.42);

  // ── Thinking braid: three strands twisting around a tilted orbit ──────────
  if (vortex > 0.01) {
    float th = rth - uAngles.x;
    float braid = 0.0;
    float pulse = pow(0.5 + 0.5 * cos(th - uAngles.z), 6.0);
    for (int k = 0; k < 3; k++) {
      float a = 3.0 * th + uAngles.y + float(k) * 2.0944;
      float rk = 0.56 + 0.07 * sin(a);
      float near = 0.5 + 0.5 * cos(a);                 // strand on the near side of the tube
      float wk = 0.011 + 0.012 * near;                 // …reads thicker and brighter
      float d = (rho - rk) / wk;
      braid += (exp(-d * d) + exp(-d * d * 0.12) * 0.22) * (0.35 + 0.65 * near);
    }
    float halo = exp(-(rho - 0.56) * (rho - 0.56) * 60.0) * 0.22;
    // Behind the core: dimmed by the core's own light it passes behind.
    float behind = step(zRing, 0.0) * smoothstep(0.45, 0.0, length(q)) * 0.6;
    vec3 bc = ramp(0.3 + 0.5 * pulse);
    col += bc * (braid * (0.7 + 1.6 * pulse) + halo) * vortex * Tring * (1.0 - behind) * energy;
  }

  // ── Sparkles drifting with the currents (high band shimmer) ──────────────
  float spDensity = clamp(uLook2.x * 0.35 + uVoice.z * 0.55, 0.0, 0.9);
  if (spDensity > 0.01) {
    vec2 sp = q * (1.0 + lean * 0.3) + warp * 0.18 - vec2(0.0, uLayer1.w);
    float s1 = sparkleLayer(sp + tilt * 0.35, spDensity, 3.1);
    float s2 = sparkleLayer(sp * 1.37 - tilt * 0.1 + 7.7, spDensity * 0.8, 9.4) * 0.6;
    float spk = (s1 * Tspark + s2 * mix(Tspark, T, 0.5)) * smoothstep(1.0, 0.78, r);
    col += mix(uPal[1], uPal[3], 0.55) * spk * (0.6 + uVoice.z * 1.6);
  }

  // ── Glass ────────────────────────────────────────────────────────────────
  float fres = pow(1.0 - nz, 4.0);
  // The glass body absorbs into navy where the medium is thin.
  vec3 deep = mix(uPal[6], uPal[0], 0.16) * 0.62;
  col += deep * T;

  // Inner bounce: the core's light refocused on the lower far wall.
  float bounce = smoothstep(0.35, 1.0, r) * smoothstep(0.15, -0.95, q.y) * (1.0 - fres);
  col += mix(uPal[1], uPal[2], 0.45) * bounce * min(coreLight * 1.4, 1.0) * 0.35 * energy;

  // Fresnel rim, tinted by the interior's temperature (light bent through).
  vec3 rimTint = mix(uPal[4], uPal[3], clamp(warm * 1.1, 0.0, 1.0));
  col += rimTint * (fres * (0.2 + 0.14 * energy) + smoothstep(0.93, 1.0, r) * 0.1) * (1.0 - 0.5 * dim);

  // Error: the light loses energy, sinking into navy-absorbed violet.
  float lum = dot(col, vec3(0.3, 0.5, 0.2));
  col = mix(col, uPal[0] * lum * 1.25, dim * 0.55) * (1.0 - 0.38 * dim);

  // Hue-locked tone curve: scale all channels by one factor.
  float m = max(col.r, max(col.g, col.b));
  col *= (1.0 - exp(-1.35 * m)) / max(m, 1e-4);

  // Key-light specular (upper left), sliding with tilt. Soft tint, not white.
  vec3 L = normalize(vec3(-0.48 + tilt.x * 0.9, 0.6 + tilt.y * 0.9, 0.64));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float ndh = max(dot(n, H), 0.0);
  float spec = pow(ndh, 420.0) * 0.55 + pow(ndh, 36.0) * 0.07;
  col += mix(uPal[5], uPal[4], 0.3) * spec * (1.0 - 0.5 * dim);

  float edge = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  float alpha = clamp(0.84 + 0.16 * (1.0 - T) + fres * 0.16 + spec, 0.0, 1.0);
  gl_FragColor = vec4(col * edge, alpha * edge);
}
`;
