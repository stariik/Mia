// MiaOrb shaders — "Glass & Ink", rendered in two passes.
//
//  1. INTERIOR (reduced resolution, into a texture). The soft volume: a
//     pseudo-volume marched front-to-back through the sphere's chord in a few
//     depth slices — ink (absorbing, domain-warped density), silk (luminous
//     ribbons on the noise field's mid iso-surface), a heavy core, and the
//     light the thought throws onto the ink around it. Soft by nature, so it
//     loses nothing at lower resolution — and it is most of the cost.
//  2. COMPOSITE (full resolution). Everything that must stay crisp: the glass
//     (fresnel rim, key-light specular, lens refraction), the thought-knot,
//     sparkles and voice streaks — composited at their depth using the
//     transmittance the interior pass stored in alpha.
//
// Colour is LOCKED to the palette uniforms: everything is a mix of them, scaled
// in brightness. The final tone curve scales all three channels by the same
// factor, so overexposure can never drift a hue toward yellow or white.
//
// GLSL ES 1.00 (WebGL1-safe): constant loop bounds, no derivatives, highp guarded.

export const MAX_SLICES = 7;
/** Closest-point steps per strand when drawing the thought (see drawThought). */
export const KNOT_STEPS = 2;

export const ORB_VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const COMMON = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

#define MAX_SLICES ${MAX_SLICES}
#define KNOT_STEPS ${KNOT_STEPS}
#define FOLD_SEED 0.3
#define FOLD_C 0.95533649
#define FOLD_S 0.29552021

uniform vec2 uRes;
uniform vec4 uShape;   // x sphere radius (half-canvas units), y edge AA (sphere units), zw tilt
uniform vec4 uLayer0;  // slice flow phases 0..3 (each wrapped mod 256 → seamless)
uniform vec4 uLayer1;  // slice flow phases 4..6, w warp phase (mod 256)
uniform vec4 uAngles;  // x medium rotation, y radial stream, z twinkle (mod 2π), w sparkle drift
uniform vec4 uLook;    // x energy, y warmth, z swirl, w dim
uniform vec4 uLook2;   // x sparkle, y lean (+in/toward viewer, −out), z core radius, w warp
uniform vec4 uVoice;   // x core swell, y twist, z high shimmer, w loudness
uniform vec4 uVoice2;  // x user weight, y Mia weight, z front bias, w streak phase (mod 256)
uniform vec4 uRip[4];  // x radius, y strength, z direction (+1 out, −1 in)
uniform vec4 uTouch;   // xy point (sphere units), z radius, w strength
uniform vec4 uFx;      // x core gain (absorb), y thought light
uniform vec4 uKnot;    // x orbit radius, y tube radius, z alpha, w trace (≥1 = fully drawn)
uniform vec4 uKnotF;   // x incline, y precession, z spin (mod 6π), w roll (mod 2π)
uniform vec4 uKnotB;   // x width factor, y brightness, z q (tube windings)
uniform vec2 uPulse[3];// thought pulses: knot position 0..1, signed intensity (sign = direction)
uniform vec4 uPL[4];   // pulse + trace-head lights in view space (xyz) + intensity
uniform float uSlices;
uniform vec3 uPal[7];  // violet, pink, coral, pinkSoft, violetSoft, white, navy
uniform sampler2D uNoise;

varying vec2 vUv;

const float TAU = 6.28318530718;
// Headroom of the interior texture (sqrt-encoded, so dark tones keep precision).
const float HDR = 4.0;

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

// Sphere-space coordinates of this fragment.
vec2 sphereQ(out float r) {
  vec2 frag = vUv * uRes;
  float halfMin = 0.5 * min(uRes.x, uRes.y);
  vec2 q = (frag - 0.5 * uRes) / halfMin / uShape.x;
  r = length(q);
  return q;
}

// Lens: the view ray bends toward the centre as it enters the glass, so the
// interior magnifies toward the rim like a real marble.
vec2 lensBend(vec3 n) {
  vec3 rd = refract(vec3(0.0, 0.0, -1.0), n, 0.78);
  return rd.xy / max(-rd.z, 0.25);
}
`;

export const ORB_INTERIOR_FRAG = `${COMMON}
void main() {
  float r;
  vec2 q = sphereQ(r);
  // Outside the glass nothing is ever sampled, except the few texels the
  // composite's bilinear filter touches at the rim. Skipping the rest saves
  // ~40% of this pass (the square texture's corners).
  float texel = 1.0 / (0.5 * min(uRes.x, uRes.y) * uShape.x);
  if (r > 1.0 + 3.0 * texel) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // Within that margin, evaluate AT the rim so the edge never pulls in
  // unrelated values.
  if (r > 0.995) { q *= 0.995 / r; r = 0.995; }

  float energy = uLook.x;
  float warm = uLook.y;
  float swirl = uLook.z;

  float nz = sqrt(max(1.0 - r * r, 0.0));
  vec3 n = vec3(q, nz);
  vec2 tilt = uShape.zw;
  vec2 bend = lensBend(n);

  // Shared per-pixel warp (computed once, reused by every slice).
  vec2 wq = q * 1.25;
  float wx = vnoise(vec3(wq * 1.2, uLayer1.w));
  float wy = vnoise(vec3(wq * 1.2 + vec2(19.7, 7.3), uLayer1.w + 11.0));
  vec2 warp = (vec2(wx, wy) - 0.5) * 2.0 * uLook2.w;

  float lean = uLook2.y;
  float coreR = uLook2.z * (1.0 + 0.55 * uVoice.x);
  float twist = uVoice.y;
  float stream = (uVoice2.x + uVoice2.y) * (0.35 + 0.65 * uVoice.w);

  // The thought's frame (precession + incline), for the light it casts.
  float thought = uKnot.z * uFx.y;
  mat2 kRot = rot(-uKnotF.y);
  float cI = cos(uKnotF.x), sI = sin(uKnotF.x);
  // Pulse lights only reach so far: drop the ones too distant from this
  // pixel's column to matter (lens and parallax shift it by < 0.3).
  float plOn0 = uPL[0].w * step(dot(q - uPL[0].xy, q - uPL[0].xy), 0.5);
  float plOn1 = uPL[1].w * step(dot(q - uPL[1].xy, q - uPL[1].xy), 0.5);
  float plOn2 = uPL[2].w * step(dot(q - uPL[2].xy, q - uPL[2].xy), 0.5);
  float plOn3 = uPL[3].w * step(dot(q - uPL[3].xy, q - uPL[3].xy), 0.5);

  float dz = 2.0 * nz / uSlices;
  vec3 acc = vec3(0.0);
  float T = 1.0;

  for (int i = 0; i < MAX_SLICES; i++) {
    if (float(i) >= uSlices) break;
    float fi = (float(i) + 0.5) / uSlices;          // 0 front … 1 back
    float z = nz * (1.0 - 2.0 * fi);
    vec3 pt = vec3(q + bend * (nz - z) * 0.42, z);
    pt.xy += tilt * z;                               // depth parallax
    vec3 pv = pt;                                    // undistorted view position

    // Voice ripples: a travelling shell that shoves the medium as it passes.
    float rip = 0.0;
    float pl = length(pt);
    vec3 pdir = pt / max(pl, 1e-3);
    for (int k = 0; k < 4; k++) {
      vec4 rp = uRip[k];
      if (rp.y < 0.002) continue;
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
    pt += pdir * sin(pl * 8.5 - uAngles.y) * 0.07 * stream;

    // Mid band: the currents twist, more strongly near the heart.
    pt.xy = rot(twist * (1.0 - min(pl, 1.0)) * 1.3) * pt.xy;

    // Thinking: the medium is dragged around the thought — a rigid turn plus a
    // fixed spiral shear, so it never winds itself into mush.
    pt.xy = rot(uAngles.x + swirl * 0.85 / (length(pt.xy) + 0.42)) * pt.xy;

    // Each depth layer flows on its own clock and heading (parallax by speed).
    float lp = i < 4
      ? (i == 0 ? uLayer0.x : (i == 1 ? uLayer0.y : (i == 2 ? uLayer0.z : uLayer0.w)))
      : (i == 4 ? uLayer1.x : (i == 5 ? uLayer1.y : uLayer1.z));
    vec2 sxy = rot(float(i) * 1.9) * (pt.xy * 1.15 + warp * (0.65 + 0.35 * fi));
    vec3 s = vec3(sxy, pt.z * 1.0) + vec3(lp, 0.0, lp);
    float base = vnoise(s);
    // Integer multiplier: a 256 wrap of lp stays a multiple of 256 in every
    // axis (2·256 + 256 in z), so the detail octave is seamless across wraps.
    float det = vnoise(s * 2.0 + vec3(0.0, 5.2, lp));
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

    float t = warm + 0.5 * core + 0.22 * scatter - 0.24 * fi - 0.12 * pl + (nv - 0.5) * 0.35;
    vec3 inkCol = ramp(t - 0.12) * ink * (0.1 + 0.95 * scatter);
    vec3 silkCol = ramp(t + 0.1) * silk * (0.95 + 1.5 * scatter + rip * 1.8);
    vec3 coreCol = mix(uPal[1], uPal[2], 0.55 + 0.3 * uVoice.x) * core * (2.0 + 1.6 * uVoice.x) * uFx.x;

    float front = 1.0 + uVoice2.z * (0.9 - 1.8 * fi);
    vec3 emit = (inkCol + silkCol * 1.15 + coreCol) * front;
    float dens = (ink * 1.6 + silk * 0.35 + core * 1.4) * front;

    // The thought lights the ink around its orbit, and each travelling pulse
    // carries a small lantern through the medium.
    if (thought > 0.003) {
      vec2 kxy = kRot * pv.xy;
      float yk = kxy.y * cI - pv.z * sI;
      float zk = kxy.y * sI + pv.z * cI;
      float ring = length(vec2(kxy.x, yk)) - uKnot.x;
      float kl = exp(-(ring * ring + zk * zk) * 34.0) * thought;
      vec3 lit = ramp(0.3 + 0.25 * kl) * kl * (0.25 + ink * 1.1);
      for (int k = 0; k < 4; k++) {
        float on = k == 0 ? plOn0 : (k == 1 ? plOn1 : (k == 2 ? plOn2 : plOn3));
        if (on < 0.002) continue;
        vec3 dv = pv - uPL[k].xyz;
        float e = exp(-dot(dv, dv) * 24.0) * on;
        lit += ramp(0.62) * e * (0.3 + ink * 1.4 + silk * 0.6);
      }
      emit += lit;
    }

    acc += T * emit * dz;
    T *= exp(-dens * dz * 1.25);
  }

  vec3 col = acc * energy * (1.0 + uVoice.w * 0.42);
  // Dither away 8-bit banding in the stored (sqrt-encoded) colour.
  float dith = (hash32(gl_FragCoord.xy).x - 0.5) / 255.0;
  gl_FragColor = vec4(sqrt(clamp(col / HDR, 0.0, 1.0)) + dith, T + dith);
}
`;

export const ORB_COMPOSITE_FRAG = `${COMMON}
uniform sampler2D uInterior;

// Screen-space sparkle layer: one jittered point per cell, twinkling at an
// integer multiple of the (wrapped) twinkle phase so it never pops.
float sparkleLayer(vec2 uv, float density, float seed) {
  vec2 g = uv * 13.0;
  // The drift phase wraps at 1000 → 13000 cells; mod keeps the hash identical.
  vec2 id = mod(floor(g), 13000.0);
  vec2 f = fract(g) - 0.5;
  vec3 h = hash32(id + seed);
  if (h.z > density) return 0.0;
  vec2 off = (h.xy - 0.5) * 0.62;
  float d = length(f - off);
  float tw = 0.5 + 0.5 * sin(uAngles.z * (1.0 + floor(h.x * 3.0)) + h.y * TAU);
  tw = tw * tw;
  return (smoothstep(0.075, 0.0, d) + smoothstep(0.22, 0.0, d) * 0.18) * tw;
}

// Slides a point along the knot to the strand point nearest kq: KNOT_STEPS
// damped Halley steps from azimuth (cx, sx) at knot parameter t. Returns the
// point on screen (xy), its depth (z, + toward the viewer) and its knot
// parameter (w).
vec4 strandPoint(vec2 kq, vec2 kt, float cx, float sx, float t,
                 float R, float tr, float k3, float Q, float roll, float cI, float sI) {
  // Kept small before cos/sin: phone GPUs lose precision on large angles.
  float a = mod(Q * t + roll, TAU);                // angle around the tube
  float cA = cos(a), sA = sin(a);
  for (int it = 0; it < KNOT_STEPS; it++) {
    // Position and its first two derivatives along the strand (d/d azimuth).
    float rho = R + tr * cA;
    float r1 = -tr * k3 * sA;
    float r2 = -tr * k3 * k3 * cA;
    float py = rho * sx;
    float py1 = r1 * sx + rho * cx;
    float py2 = r2 * sx + 2.0 * r1 * cx - rho * sx;
    float pz = tr * sA;
    float pz1 = tr * k3 * cA;
    float pz2 = -tr * k3 * k3 * sA;
    float zv = -py * sI + pz * cI;
    float zv1 = -py1 * sI + pz1 * cI;
    float zv2 = -py2 * sI + pz2 * cI;
    vec2 S = vec2(rho * cx, py * cI + pz * sI) + kt * zv;
    vec2 S1 = vec2(r1 * cx - rho * sx, py1 * cI + pz1 * sI) + kt * zv1;
    vec2 S2 = vec2(r2 * cx - 2.0 * r1 * sx - rho * cx, py2 * cI + pz2 * sI) + kt * zv2;
    vec2 e = kq - S;
    // Halley's denominator is |S1|² − e·S2. Where the strand turns tight
    // (the orbit's ends) e·S2 can win and flip the step uphill, so the
    // curvature term only ever damps: every step heads for the closest point.
    float den = dot(S1, S1) + abs(dot(e, S2)) + 1e-5;
    float dl = clamp(dot(e, S1) / den, -0.45, 0.45);
    // Slide along the curve: rotate (cos, sin) by dl with a short series
    // (|dl| ≤ 0.45) and the tube angle by k3·dl.
    float l2 = dl * dl;
    float cd = 1.0 - l2 * (0.5 - l2 / 24.0);
    float sd = dl * (1.0 - l2 * (1.0 / 6.0 - l2 / 120.0));
    float nx = cx * cd - sx * sd;
    sx = sx * cd + cx * sd;
    cx = nx;
    float cda = cos(k3 * dl), sda = sin(k3 * dl);
    float nA = cA * cda - sA * sda;
    sA = sA * cda + cA * sda;
    cA = nA;
    t += dl / 3.0;
  }
  // Exactly on the curve at the final azimuth.
  float rho = R + tr * cA;
  float py = rho * sx;
  float pz = tr * sA;
  float zv = -py * sI + pz * cI;                   // depth (+ toward viewer)
  return vec4(vec2(rho * cx, py * cI + pz * sI) + kt * zv, zv, t);
}

// The thought: one continuous (3, q) torus knot — a single strand winding three
// times around its orbit and q times around its own tube. At any azimuth the
// knot has exactly three points (one per winding), so it is drawn
// analytically: three strand evaluations per pixel, no curve sampling.
//
// Each strand point starts at this pixel's azimuth on the orbit plane, then
// KNOT_STEPS Halley steps (Newton with curvature) slide it along the strand to
// the closest point — a strand rising out of the plane would otherwise be
// mislocated and break into dashes. One step is not enough at the orbit's two
// ends, where the inclined ellipse turns tightest: there the step hits its
// limit and the strands broke into hooks and gaps. Each step moves the point
// exactly along the curve (by angle addition, so it costs one sin/cos, not
// two), which keeps every drawn pixel genuinely on the knot (strandPoint).
// Near those ends a second seed also searches the arm across the fold.
vec3 drawThought(vec2 q, float nz, float T, vec2 bend, vec2 tilt) {
  float R = uKnot.x;
  float tr = uKnot.y;
  float trace = uKnot.w;
  float Q = uKnotB.z;
  float k3 = Q / 3.0;
  float spin = uKnotF.z;
  float roll = uKnotF.w;
  float cI = cos(uKnotF.x), sI = sin(uKnotF.x);
  mat2 kRot = rot(-uKnotF.y);
  // Seen through the lens, like the rest of the interior.
  vec2 lq = q + bend * nz * 0.42;
  vec2 kq = kRot * lq;
  vec2 kt = kRot * tilt;
  vec2 pu = vec2(kq.x, kq.y / cI);
  float rhoPx = length(pu);

  // A faint glow along the orbit itself, so the whole thought reads at once.
  float rp = (rhoPx - R) / 0.06;
  vec3 sum = ramp(0.3) * exp(-rp * rp) * 0.1 * uKnot.z * pow(max(T, 1e-3), 0.3);

  // Strands never stray further than this from the orbit (tube, its lift out
  // of the plane, glow, parallax): skip everything else.
  float reach = tr * (1.0 + sI / max(cI, 0.2)) + 0.12 + length(tilt) * 0.8;
  if (abs(rhoPx - R) > reach) return sum;

  float az0 = atan(pu.y, pu.x);
  float ca = pu.x / max(rhoPx, 1e-4), sa = pu.y / max(rhoPx, 1e-4);
  // Near the orbit's two ends (azimuth 0 or ±π, on this pixel's branch) each
  // winding folds back on itself like a "<": a pixel there is near both arms,
  // and a seed at its own azimuth can land on either. So in the fold the
  // strand is solved from one seed on each arm (FOLD_SEED either side of the
  // end) and the two are blended by distance; outside it, from the pixel's
  // azimuth; between, both, cross-faded. Any hard pick drew a seam.
  float inFold = 1.0 - smoothstep(0.36, 0.45, abs(sa));
  float tipAz = az0 > 1.5707963 ? 3.14159265 : (az0 < -1.5707963 ? -3.14159265 : 0.0);
  float ct = tipAz == 0.0 ? 1.0 : -1.0;              // cos at the end; sin is 0
  float coreMask = smoothstep(uLook2.z * 1.7, uLook2.z * 0.5, length(lq));
  float cov[3];
  float dep[3];
  vec3 lit[3];
  for (int j = 0; j < 3; j++) {
    float t0 = (az0 - spin + TAU * float(j)) / 3.0;  // knot parameter (rad)
    vec4 cand[3];
    float wt[3];
    cand[0] = cand[1] = cand[2] = vec4(0.0);
    wt[0] = 1.0 - inFold;
    wt[1] = wt[2] = 0.0;
    if (wt[0] > 0.001) cand[0] = strandPoint(kq, kt, ca, sa, t0, R, tr, k3, Q, roll, cI, sI);
    if (inFold > 0.001) {
      float tTip = t0 + (tipAz - az0) / 3.0;         // the same pass, at the end
      cand[1] = strandPoint(kq, kt, ct * FOLD_C, -ct * FOLD_S, tTip - FOLD_SEED / 3.0, R, tr, k3, Q, roll, cI, sI);
      cand[2] = strandPoint(kq, kt, ct * FOLD_C, ct * FOLD_S, tTip + FOLD_SEED / 3.0, R, tr, k3, Q, roll, cI, sI);
      vec2 d1 = kq - cand[1].xy, d2v = kq - cand[2].xy;
      float to2 = smoothstep(-4e-4, 4e-4, dot(d1, d1) - dot(d2v, d2v));
      wt[1] = inFold * (1.0 - to2);
      wt[2] = inFold * to2;
    }
    for (int k = 0; k < 3; k++) {
      float wk = wt[k];
      if (wk < 0.001) continue;
      vec4 C = cand[k];
      float zv = C.z;                                // depth (+ toward viewer)
      float t = C.w;
      vec2 ev = kq - C.xy;
      float near = clamp(zv / (R + tr) * 0.5 + 0.5, 0.0, 1.0);
      float w = (0.011 + 0.008 * near) * uKnotB.x;   // nearer reads thicker
      float d2 = dot(ev, ev) / (w * w);
      dep[j] += zv * wk;
      if (d2 > 60.0) continue;                       // nothing of this strand here
      float core = exp(-d2);
      float glow = exp(-d2 * 0.2);

      float u = fract(t / TAU);                      // 0..1 along the strand
      // Drawn like a pen stroke from u = 0 up to the trace head.
      float vis = 1.0;
      float head = 0.0;
      if (trace < 1.0) {
        vis = 1.0 - smoothstep(trace - 0.012, trace, u);
        float du = u - trace;
        head = exp(-du * du * 2600.0) * 1.8 + exp(du * 16.0) * vis * 0.6;
      }
      // Thought pulses: a bright head with a tail behind it.
      float pulse = 0.0;
      for (int i = 0; i < 3; i++) {
        vec2 P = uPulse[i];
        float du = u - P.x;
        du -= floor(du + 0.5);
        du *= sign(P.y);
        // The tail fades in under the head rather than starting at full
        // strength, which drew a hard line across the strand.
        float tail = du < 0.0 ? exp(du * 22.0) * (1.0 - exp(-du * du * 9000.0)) : 0.0;
        pulse += (exp(-du * du * 5000.0) * 1.6 + tail * 0.55) * abs(P.y);
      }
      float behind = step(zv, 0.0) * coreMask * 0.45;  // passing behind the core
      // …which veils its pulses too, or they float free of their dimmed strand.
      pulse *= 1.0 - 1.8 * behind;
      float hot = min(pulse + head, 1.0);
      // The thought is the hero: the ink in front veils it, but only partly.
      float tAt = pow(max(T, 1e-3), 0.6 * clamp((nz - zv) / (2.0 * nz), 0.0, 1.0));
      float b = (0.5 + 0.5 * near) * uKnot.z * uKnotB.y * (1.0 - behind) * tAt;
      vec3 c = ramp(0.28 + 0.3 * near + 0.4 * hot);
      c = mix(c, uPal[3], clamp((pulse + head) * 0.3, 0.0, 0.55));

      cov[j] += core * vis * wk;
      lit[j] += c * (core * (1.0 + pulse * 1.4 + head) + glow * (0.32 + pulse * 0.4 + head * 0.35)) * vis * b * wk;
    }
  }
  // Over/under: a nearer strand hides what passes behind it — that is what
  // makes the crossings read as a knot instead of overlapping lines.
  for (int j = 0; j < 3; j++) {
    float occ = 1.0;
    for (int k = 0; k < 3; k++) {
      if (k != j && dep[k] > dep[j]) occ *= 1.0 - 0.85 * cov[k];
    }
    sum += lit[j] * occ;
  }
  return sum;
}

void main() {
  float r;
  vec2 q = sphereQ(r);
  float aa = uShape.y;
  float energy = uLook.x;
  float warm = uLook.y;
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
  vec2 bend = lensBend(n);

  vec4 inner = texture2D(uInterior, vUv);
  vec3 col = inner.rgb * inner.rgb * HDR;
  float T = clamp(inner.a, 0.0, 1.0);

  // ── The thought ──────────────────────────────────────────────────────────
  if (uKnot.z > 0.003) col += drawThought(q, nz, T, bend, tilt) * (1.0 - 0.5 * dim);

  // ── Sparkles drifting with the currents (high band shimmer) ──────────────
  float lean = uLook2.y;
  float spDensity = clamp(uLook2.x * 0.35 + uVoice.z * 0.55, 0.0, 0.9);
  if (spDensity > 0.01) {
    vec2 sp = rot(uAngles.x * 0.5) * q * (1.0 + lean * 0.3) - vec2(0.0, uAngles.w);
    float s1 = sparkleLayer(sp + tilt * 0.35, spDensity, 3.1);
    float s2 = sparkleLayer(sp * 1.37 - tilt * 0.1 + 7.7, spDensity * 0.8, 9.4) * 0.6;
    float tFront = pow(max(T, 1e-3), 0.33);
    float spk = (s1 * tFront + s2 * mix(tFront, T, 0.5)) * smoothstep(1.0, 0.78, r);
    col += mix(uPal[1], uPal[3], 0.55) * spk * (0.6 + uVoice.z * 1.6);
  }

  // ── Voice streaks: light streaming out of the core (Mia) or in (user) ────
  float rayAmt = uVoice2.y * (0.45 + uVoice.w * 1.3) + uVoice2.x * (0.2 + uVoice.w * 0.7);
  if (rayAmt > 0.01) {
    vec2 dq = q / max(r, 1e-3);
    float rn = vnoise(vec3(dq * 4.2 + 11.0, r * 2.4 - uVoice2.w));
    float rays = smoothstep(0.56, 0.96, rn) * smoothstep(0.1, 0.34, r) * smoothstep(1.0, 0.62, r);
    col += ramp(warm + 0.22 - uVoice2.x * 0.2) * rays * rayAmt * pow(max(T, 1e-3), 0.5) * 0.65;
  }

  // ── Glass ────────────────────────────────────────────────────────────────
  float fres = pow(1.0 - nz, 4.0);
  // The glass body absorbs into navy where the medium is thin.
  vec3 deep = mix(uPal[6], uPal[0], 0.16) * 0.62;
  col += deep * T;

  // Inner bounce: the core's light refocused on the lower far wall.
  float coreLight = min(uLook2.z * (1.0 + uVoice.x) * uFx.x * 2.2, 1.0);
  float bounce = smoothstep(0.35, 1.0, r) * smoothstep(0.15, -0.95, q.y) * (1.0 - fres);
  col += mix(uPal[1], uPal[2], 0.45) * bounce * coreLight * 0.35 * energy;

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
