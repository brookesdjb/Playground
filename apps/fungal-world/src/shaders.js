// ============================================================================
// WGSL sources
// Forked from Abyssal Garden by Maksymilian Dendura (MIT): https://github.com/Noniv/abyssal-garden
// ============================================================================

const W_NOISE = /*wgsl*/`
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn h31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn h33(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn vn(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3f(1., 0., 0.)), u.x), mix(h31(i + vec3f(0., 1., 0.)), h31(i + vec3f(1., 1., 0.)), u.x), u.y),
             mix(mix(h31(i + vec3f(0., 0., 1.)), h31(i + vec3f(1., 0., 1.)), u.x), mix(h31(i + vec3f(0., 1., 1.)), h31(i + vec3f(1., 1., 1.)), u.x), u.y), u.z);
}
fn fbm(p: vec3f, n: i32) -> f32 {
  var a = .5; var s = 0.; var q = p;
  for (var i = 0; i < n; i++) { s += a * vn(q); q = q * 2.03 + vec3f(17.1, 31.7, 5.3); a *= .5; }
  return s / (1. - 2. * a);
}
fn wor(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let r = o + h33(i + o) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
`;

// ---------------------------------------------------------------- terrain density (compute)
const W_DENS = W_NOISE + /*wgsl*/`
struct U { n: vec4u, o: vec4f, c: vec4u };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> D: array<f32>;
@group(0) @binding(2) var<storage, read> P: array<vec4f>;
fn smax(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }
fn smin(a: f32, b: f32, k: f32) -> f32 { return -smax(-a, -b, k); }
fn seg2(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
fn seg3(p: vec3f, a: vec3f, b: vec3f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
fn dens(p: vec3f) -> f32 {
  let w = vec3f(fbm(p * .04 + 11., 3), fbm(p * .04 + 47., 3), fbm(p * .04 + 83., 3)) - .5;
  let q = p + w * vec3f(15., 6., 15.);
  let g0 = -45.5 + 7. * (fbm(vec3f(q.xz * .011, 3.), 4) - .5) + 1.6 * (fbm(vec3f(q.xz * .07, 9.), 3) - .5) + 2.4 * (fbm(vec3f(q.xz * .045, 4.), 2) - .5);
  let tn = 3. * (fbm(vec3f(q.xz * .09, 2.), 3) - .5);
  var dm = -1e3; var de = 1e3;
  var k = 0u;
  for (var i = 0u; i < u.c.x; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    let yr = clamp((p.y - g0) / (b.y - g0), 0., 1.3);
    var e = seg2(q.xz, a.xy, a.zw) - b.x;
    e -= b.z * ss(.3, .92, yr) + 3. * (1. - yr) * (1. - yr) - b.w * ss(.0, .5, yr) * (1. - ss(.5, 1., yr));
    dm = smax(dm, smin(-e, b.y + tn - p.y, 3.), 2.5);
    de = min(de, e);
  }
  var clr = 0.;
  let kc = (u.c.x + u.c.y + u.c.z) * 2u;
  for (var i = 0u; i < u.c.w; i++) {
    let a = P[kc + i * 2u]; let b = P[kc + i * 2u + 1u];
    clr = max(clr, 1. - ss(0., b.y, seg2(q.xz, a.xy, a.zw) - b.x));
  }
  let rad = length(p.xz) + w.x * 14.;
  let n = fbm(vec3f(q.xz * .0125, 1.7), 4);
  let ring = ss(154., 172., rad);
  let plat = max(ss(.5, .565, n) * (1. - clr), ring);
  // the crater rim: a ring of jagged peaks around the basin
  let th = g0 + plat * mix(26. + 17. * fbm(vec3f(q.xz * .03, 5.), 2), 44. + 26. * fbm(vec3f(q.xz * .02, 8.), 3), ring);
  var d = smax(g0 + 4.5 * ss(10., 0., de) - p.y, dm, 3.);
  d = smax(d, (th - p.y) * .7, 3.);
  k = u.c.x * 2u;
  for (var i = 0u; i < u.c.y; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    var r = p + w * 3. - a.xyz;
    let cs = cos(a.w); let sn = sin(a.w);
    r = vec3f(cs * r.x + sn * r.z, r.y / b.z, -sn * r.x + cs * r.z);
    d = smax(d, b.y - length(vec2f(length(r.xy) - b.x, r.z)), 1.5);
  }
  let hg = p.y - g0;
  let rk = mix(.25, 1., ss(.5, 5., hg));
  d += rk * ((.5 - wor(p * .17 + w * 2.)) * 3.4 + (.5 - wor(p * .41 + 7.)) * 1.3 + (fbm(p * .3, 3) - .5) * 2.2);
  // porous, bubbly stone instead of layered beds
  d += rk * .9 * (.45 - wor(p * .55 + w * 1.5));
  for (var i = 0u; i < u.c.z; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    d = smin(d, seg3(p + w * 2., a.xyz, b.xyz) - a.w, 2.);
  }
  return min(d, 14.5 - p.y);
}
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= u.n.xyz)) { return; }
  var d = dens(u.o.xyz + vec3f(id) * u.o.w);
  if (id.x == 0u || id.z == 0u || id.x == u.n.x - 1u || id.z == u.n.z - 1u || id.y == u.n.y - 1u) { d = -1.; }
  D[id.x + u.n.x * (id.y + u.n.y * id.z)] = d;
}
`;

// ---------------------------------------------------------------- fullscreen helpers
const W_FS = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
`;

// rock detail texture (tileable): rg = slope, b = height, a = mottling
const W_DETAIL = W_NOISE + W_FS + /*wgsl*/`
fn hp(p: vec2f, per: f32) -> f32 { return h31(vec3f(p - per * floor(p / per), per)); }
fn tn(p: vec2f, per: f32) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(hp(i, per), hp(i + vec2f(1., 0.), per), u.x), mix(hp(i + vec2f(0., 1.), per), hp(i + vec2f(1., 1.), per), u.x), u.y);
}
fn tf(uv: vec2f, per: f32, n: i32) -> f32 { var a = .5; var s = 0.; var pr = per; for (var i = 0; i < n; i++) { s += a * tn(uv * pr + f32(i) * 7.3, pr); pr *= 2.; a *= .5; } return s / (1. - 2. * a); }
fn tw(p: vec2f, per: f32) -> vec3f {
  let i = floor(p); let f = fract(p); var d = vec2f(9.); var id = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
    let o = vec2f(f32(x), f32(y)); let c = i + o; let cw = c - per * floor(c / per);
    let hh = h33(vec3f(cw, per)); let r = o + hh.xy - f; let l = dot(r, r);
    if (l < d.x) { d.y = d.x; d.x = l; id = hh.z; } else if (l < d.y) { d.y = l; }
  } }
  return vec3f(sqrt(d), id);
}
fn H(uv: vec2f) -> f32 {
  let wq = uv + .11 * (vec2f(tf(uv, 3., 4), tf(uv + .5, 3., 4)) - .5);
  let f = tf(wq, 3., 8);
  let r1 = 1. - abs(tf(wq + 1.7, 5., 6) * 2. - 1.);
  let cr = min(abs(tf(wq + 4.1, 4., 5) * 2. - 1.) * 7., 1.);
  let cr2 = min(abs(tf(wq.yx + 2.3, 9., 4) * 2. - 1.) * 9., 1.);
  let pt = tw(wq * 29., 29.);
  let pit = (1. - ss(.0, .34, pt.x)) * step(.62, pt.z);
  return f * .50 + r1 * r1 * .24 + cr * cr2 * .26 - pit * .07;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / 1024.; let e = 1. / 1024.;
  let h = H(uv);
  let gx = H(uv + vec2f(e, 0.)) - H(uv - vec2f(e, 0.)); let gy = H(uv + vec2f(0., e)) - H(uv - vec2f(0., e));
  let s = clamp(vec2f(gx, gy) * 1024. * .5 * .075, vec2f(-1.), vec2f(1.));
  return vec4f(-s * .5 + .5, h, tf(uv + 3.7, 3., 5));
}
`;

// blit / mip / bloom chain
const W_BLIT = W_FS + /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
fn uvOf(fc: vec4f, k: f32) -> vec2f { return fc.xy * k / vec2f(textureDimensions(t)); }
@fragment fn fsMip(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureSampleLevel(t, s, uvOf(fc, 2.), 0.); }
fn kar(c: vec3f) -> vec4f { let w = 1. / (1. + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }
@fragment fn fsDown0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  let a = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.).rgb, vec3f(24.)));
  let b = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.).rgb, vec3f(24.)));
  let c = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.).rgb, vec3f(24.)));
  let d = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.).rgb, vec3f(24.)));
  let m = a + b + c + d;
  return vec4f(m.rgb / m.a, 1.);
}
@fragment fn fsDown(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
@fragment fn fsUp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, .5); let e = .75 / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
`;

// animated water texture: r = caustic, ba = surface slope
const W_WATER = W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> tm: vec4f;
fn caus(uv: vec2f, t: f32) -> f32 {
  let p = uv * 6.2831853;
  var i = p; var c = 0.;
  for (var n = 1; n <= 5; n++) {
    let tt = t * (1. - 3.5 / f32(n));
    i = p + vec2f(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    let s = sin(i.x + tt); let k = cos(i.y + tt);
    c += abs(s * k) / (1.25 * sqrt(s * s + k * k) + 1e-4);
  }
  c = 1.17 - pow(c / 5., 1.4);
  return pow(abs(c), 8.);
}
const WK = array<vec3f, 10>(vec3f(1., 2., 1.), vec3f(-2., 1., .9), vec3f(3., 1., .6), vec3f(1., -4., .5), vec3f(4., 3., .4),
  vec3f(-3., 5., .32), vec3f(6., -2., .28), vec3f(5., 7., .2), vec3f(-8., 3., .18), vec3f(2., 11., .14));
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / ${WATER}.; let t = tm.x;
  let c = caus(uv, t * .45 + 23.);
  let wu = uv + .02 * vec2f(sin(6.2831853 * (uv.y * 2. + .1 * t)), cos(6.2831853 * (uv.x * 3. - .07 * t)));
  var s = vec2f(0.);
  for (var i = 0; i < 10; i++) {
    let k = WK[i];
    s += k.xy * k.z * cos(dot(k.xy, wu) * 6.2831853 + t * (.5 + .35 * sqrt(length(k.xy))) * select(-1., 1., (i & 1) == 0) + f32(i) * 1.7);
  }
  return vec4f(c, c, s * .06);
}
`;

// ---------------------------------------------------------------- shared scene code
// Air full of spores: a height fog, densest on the basin floor. od() is its optical depth along a ray.
const S_G = /*wgsl*/`
struct G { vp: mat4x4f, sm: mat4x4f, cam: vec4f, right: vec4f, up: vec4f, fwd: vec4f, sun: vec4f, res: vec4f, mis: vec4f };
const SUNC = vec3f(2.7, 1.75, 1.2);
const SKYZ = vec3f(.02, .025, .09);
const SKYH = vec3f(.16, .10, .27);
const HAZE = vec3f(.085, .085, .17);
const HAZS = vec3f(.70, .40, .36);
const GLA = vec3f(.18, 1., .80);
const GLB = vec3f(1., .26, .78);
const FOG0 = .0022; const FOGD = .02; const FOGH = .055; const FY = -46.;
const WIND = vec2f(.8, .6);
const PD = vec3f(-.55, .36, .75); const PA = vec3f(.3, .92, -.25);
const TAU = 6.2831853;
const LOW = ${LV > 1};
fn sat(x: f32) -> f32 { return clamp(x, 0., 1.); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(.06711056, .00583715)))); }
fn hs(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn fin(c: vec3f) -> vec4f { return vec4f(min(max(c, vec3f(0.)), vec3f(40.)), 1.); }
// glow colour of a fungus palette (matches pal() in W_FUNGI)
fn gcol(i: i32) -> vec3f {
  switch i { case 0 { return vec3f(1., .3, .62); } case 1 { return vec3f(.2, 1., .85); } case 2 { return vec3f(.85, .3, 1.); }
    case 3 { return vec3f(1., .62, .25); } case 4 { return vec3f(.6, 1., .45); } default { return vec3f(.35, .55, 1.); } }
}
fn od(ro: vec3f, rd: vec3f, d: f32) -> f32 {
  let k = FOGH * rd.y; let a = FOGD * exp(-FOGH * (ro.y - FY));
  var e = d; if (abs(k) > 1e-4) { e = (1. - exp(-k * d)) / k; }
  return a * e + FOG0 * d;
}
// light scattered by the haze toward the eye: warm toward the sun, violet elsewhere, more violet in the grotto
fn hazeC(rd: vec3f, sun: vec3f, z: f32) -> vec3f {
  let mu = max(dot(rd, sun), 0.);
  let c = mix(HAZE, HAZS, pow(mu, 8.) * .8 + mu * mu * .1);
  return mix(c, c * vec3f(1.05, .8, 1.2), z);
}
fn n2(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  let a = hs(i.x + i.y * 57.); let b = hs(i.x + 1. + i.y * 57.); let c = hs(i.x + (i.y + 1.) * 57.); let d = hs(i.x + 1. + (i.y + 1.) * 57.);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// the gas giant and its rings: rgb, coverage
fn planet(rd: vec3f, sun: vec3f) -> vec4f {
  let pd = normalize(PD); let pa = normalize(PA); let pr = .17;
  let b = dot(rd, pd); let h = b * b - 1. + pr * pr;
  var col = vec3f(0.); var cov = 0.; var tp = 1e9;
  if (h > 0.) {
    tp = b - sqrt(h); let pn = normalize(rd * tp - pd); let lat = dot(pn, pa);
    let w = sin(lat * 24. + sin(lat * 9. + 1.) * 1.7 + n2(vec2f(lat * 40., dot(pn, cross(pa, pd)) * 6.)) * 1.2) * .5 + .5;
    let base = mix(vec3f(.40, .58, .68), vec3f(.86, .74, .58), w) * mix(.82, 1.08, sin(lat * 61.) * .5 + .5);
    let l = ss(-.12, .45, dot(pn, sun));
    let rim = pow(1. - max(dot(pn, -rd), 0.), 3.);
    col = base * (l * .75 + .015) + vec3f(.3, .5, 1.) * rim * (l * .7 + .04);
    cov = ss(0., .0006, h);
  }
  let dn = dot(rd, pa);
  if (abs(dn) > 1e-4) {
    let t = dot(pd, pa) / dn;
    if (t > 0.) {
      let r = length(rd * t - pd) / pr;
      if (r > 1.25 && r < 2.4 && (t < tp || cov < .5)) {
        let band = (.55 + .45 * sin(r * 31.)) * (.6 + .4 * sin(r * 83. + 1.)) * ss(1.25, 1.36, r) * ss(2.4, 2.22, r) * (1. - .75 * ss(1.7, 1.74, r) * ss(1.86, 1.82, r));
        col = mix(col, vec3f(.72, .64, .56) * .5, band * .85); cov = max(cov, band * .85);
      }
    }
  }
  return vec4f(col, cov);
}
fn sky(rd: vec3f, sun: vec3f, z: f32) -> vec3f {
  let y = rd.y; let mu = dot(rd, sun);
  var c = mix(SKYH, SKYZ, pow(ss(-.05, .8, y), .6));
  c += vec3f(.32, .14, .10) * pow(max(mu, 0.), 3.) * (1. - ss(0., .6, y)) * .7;
  if (y > 0.) {
    let sp = rd * 230.; let id = floor(sp); let hh = hs(dot(id, vec3f(1., 57., 113.)));
    c += vec3f(.8, .85, 1.) * step(.9965, hh) * ss(.35, 0., length(fract(sp) - .5)) * ss(.12, .5, y) * hs(hh * 9.) * 1.5;
    let uv = rd.xz / (y + .12) * 1.2;
    let cl = ss(.55, .85, n2(uv * 1.3 + vec2f(3., 1.)) * .65 + n2(uv * 3.7) * .35) * ss(.0, .15, y) * (1. - ss(.25, .6, y));
    c = mix(c, mix(vec3f(.12, .08, .16), vec3f(.95, .55, .42), pow(max(mu, 0.), 2.) * .8 + .08), cl * .5);
  }
  let pl = planet(rd, sun); c = mix(c, pl.rgb + c * .2, pl.a * ss(-.02, .04, y));
  c += SUNC * (pow(max(mu, 0.), 2400.) * 60. + pow(max(mu, 0.), 120.) * .5 + pow(max(mu, 0.), 12.) * .06);
  return mix(c, hazeC(rd, sun, z), exp(-max(y, 0.) * 7.));
}
`;

const S_B = S_G + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sC: sampler;
@group(0) @binding(3) var sS: sampler_comparison;
@group(0) @binding(4) var tSh: texture_depth_2d;
@group(0) @binding(5) var tW: texture_2d<f32>;
@group(0) @binding(6) var tD: texture_2d<f32>;
@group(0) @binding(7) var tV: texture_3d<f32>;
@group(0) @binding(8) var tM: texture_2d<f32>;
fn shUV(p: vec3f) -> vec3f { let s = g.sm * vec4f(p, 1.); return vec3f(s.x * .5 + .5, .5 - s.y * .5, s.z - .0004); }
fn shadow1(p: vec3f) -> f32 { let s = shUV(p); return textureSampleCompareLevel(tSh, sS, s.xy, s.z); }
fn shadow4(p: vec3f) -> f32 {
  let s = shUV(p); let e = 1.8 / ${SHADOW}.;
  return (textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, -e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, -e), s.z)
        + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, e), s.z)) * .25;
}
fn shadow9(p: vec3f) -> f32 {
  if (LOW) { return shadow1(p); }
  let s = shUV(p); let e = 2.1 / ${SHADOW}.; var a = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { a += textureSampleCompareLevel(tSh, sS, s.xy + vec2f(f32(x), f32(y)) * e, s.z); } }
  return a / 9.;
}
// sunlight left after the haze between the sun and height y (blue goes first, so it reddens low down)
fn sunE(y: f32, z: f32) -> vec3f { return SUNC * exp(-od(vec3f(0., y, 0.), g.sun.xyz, 600.) * vec3f(.3, .45, .7)); }
// r openness, g skylight, b / a fungus glow (teal / magenta)
fn vol(p: vec3f) -> vec4f { return textureSampleLevel(tV, sC, (p - vec3f(-192., -56., -192.)) / vec3f(384., 72., 384.), 0.); }
fn glow(p: vec3f) -> vec3f {
  let v = vol(p);
  return (GLA * v.b + GLB * v.a) * .9 * (.85 + .15 * sin(g.cam.w * .6 + dot(p.xz, vec2f(.04, .03))));
}
fn amb(p: vec3f, n: vec3f, sky: f32, z: f32) -> vec3f {
  let up = n.y * .5 + .5;
  return mix(vec3f(.045, .03, .06), mix(vec3f(.15, .14, .30), vec3f(.22, .12, .28), z), up * up) * (.15 + .85 * sky) * 1.2 + vec3f(.002, .002, .004);
}
fn zone(p: vec3f) -> f32 { return mix(g.sun.w, textureSampleLevel(tM, sC, p.xz / 384. + .5, 0.).b, .2); }
fn side(p: vec3f, n: vec3f, open: f32, z: f32) -> vec3f { return hazeC(normalize(vec3f(n.x, .001, n.z)), g.sun.xyz, z) * open * (1. - abs(n.y)) * .25; }
// haze between the eye and wp; past ~190 m everything melts into the sky
fn fog(c: vec3f, wp: vec3f, z: f32) -> vec3f {
  let v = wp - g.cam.xyz; let d = length(v); let rd = v / d;
  let T = exp(-od(g.cam.xyz, rd, d));
  let ins = hazeC(rd, g.sun.xyz, z) * (.45 + .55 * vol(g.cam.xyz + rd * min(d, 150.)).g) + glow(g.cam.xyz + rd * min(d * .5, 12.)) * .4;
  let f = c * T + ins * (1. - T);
  if (d < 190.) { return f; }
  return mix(sky(rd, g.sun.xyz, z), f, ss(236., 190., d));
}
fn qrot(q: vec4f, v: vec3f) -> vec3f { return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`;

// ---------------------------------------------------------------- solid meshes (terrain, rocks, set pieces, sponges, coral)
const W_SOLID = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) on: vec3f,
  @location(4) @interpolate(flat) m: vec4f, @location(5) @interpolate(flat) q: vec4f, @location(6) ao: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  var sc = i.a.w;
  if (i.c.x < 1.5 && i.c.z > 1.5 && g.res.x > 0.) { sc *= 1. - ss(i.c.z * .7, i.c.z, distance(i.a.xyz, g.cam.xyz) / g.mis.z); }
  var w = i.a.xyz + qrot(i.b, i.p * sc);
  w.y += sin(g.cam.w * .3 + i.c.y * 40.) * i.c.w;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = qrot(i.b, i.n.xyz); o.op = i.p * i.a.w + i.c.y * 37.; o.on = i.n.xyz;
  o.m = i.c; o.q = i.b; o.ao = i.n.w;
  return o;
}
struct TP { h: f32, c: f32, n: vec3f };
fn tri(p: vec3f, n: vec3f, s: f32) -> TP {
  var w = pow(abs(n), vec3f(4.)); w /= (w.x + w.y + w.z);
  let x = textureSample(tD, sR, p.zy * s); let y = textureSample(tD, sR, p.xz * s); let z = textureSample(tD, sR, p.xy * s);
  var o: TP;
  o.h = x.b * w.x + y.b * w.y + z.b * w.z;
  o.c = x.a * w.x + y.a * w.y + z.a * w.z;
  let a = x.rg * 2. - 1.; let b = y.rg * 2. - 1.; let c = z.rg * 2. - 1.;
  o.n = vec3f(0., a.y, a.x) * w.x + vec3f(b.x, 0., b.y) * w.y + vec3f(c.x, c.y, 0.) * w.z;
  return o;
}
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mat = i32(i.m.x + .5); let sd = i.m.y; let fl_ = select(-1., 1., ff);
  let on = normalize(i.on) * fl_; let n0 = normalize(i.n) * fl_;
  let dist = length(i.wp - g.cam.xyz);
  let ts = select(1., i.m.z, mat >= 2);
  let A = tri(i.op, on, .1 * ts); let B = tri(i.op, on, .43 * ts); let C = tri(i.op, on, 1.9 * ts); let F = tri(i.op, on, 6.7 * ts); let fk = ss(10., 1.5, dist) * f32(mat <= 1);
  let big = textureSample(tD, sR, i.op.xz * .013 + i.op.y * .021).a;
  let big2 = textureSample(tD, sR, i.op.zx * .031 + i.op.y * .043 + .37).a;
  let sk = textureSample(tD, sR, vec2f((i.op.x + i.op.z) * .33, i.op.y * .035));
  let sk2 = textureSample(tD, sR, vec2f((i.op.x - i.op.z) * 1.1, i.op.y * .11));
  let gm = textureSample(tM, sC, i.wp.xz / 384. + .5);
  let w1 = textureSample(tW, sR, i.wp.xz / 11.).r; let w2 = textureSample(tW, sR, i.wp.zx / 4.3 + .3).r;
  let hgt = A.h * .5 + B.h * .35 + C.h * .15;
  var bump = 1.7; var gloss = .1; var alb = vec3f(0.); var emi = vec3f(0.); var vao = 1.; var flu = 0.;
  let flt = ss(.72, .93, n0.y);
  if (mat <= 1) {
    // porous alien stone: lilac-grey with rust and slate patches, dark pits
    let st = i.op.y * .35 + A.h * 1.6 + big * 5. + big2 * 3.;
    let bed = hs(floor(st));
    alb = mix(vec3f(.15, .13, .16), vec3f(.42, .37, .40), sat(A.c * 1.5 - .25));
    alb = mix(alb, mix(vec3f(.36, .22, .14), vec3f(.24, .24, .33), bed), ss(.42, .66, big) * .6);
    alb *= mix(.78, 1.1, bed);
    let enc = ss(.46, .6, big2 * .6 + B.c * .5) * ss(.3, .6, hgt);
    alb = mix(alb, mix(vec3f(.30, .07, .15), vec3f(.07, .25, .23), ss(.45, .6, A.c)) * (.5 + .8 * B.h), enc * .7);
    let moss = ss(-.1, .6, n0.y) * ss(.3, .52, B.c * .55 + big * .5);
    alb = mix(alb, vec3f(.05, .10, .09), moss * .75);
    alb *= (.22 + 1.3 * hgt) * mix(1., .62 + .76 * F.h, fk);
    if (mat == 0) {
      // floors: dark loam with pale mycelium mats
      let soil = mix(vec3f(.05, .035, .045), vec3f(.33, .31, .33) * (.6 + .5 * B.h), ss(.35, .75, gm.a * .7 + B.c * .5) * .75);
      alb = mix(alb, soil * (.6 + .6 * B.h), flt * .85);
      // magenta glow-moss carpets
      let mg = flt * sat(gm.r * 1.5 - .45 + (B.c - .5) * 1.6) * ss(.35, .6, A.h);
      alb = mix(alb, vec3f(.22, .03, .16) * (.4 + .9 * B.h), mg * .8);
      emi += GLB * mg * .06 * (.4 + B.h);
      // living mycelium: a glowing web through the ground (the animated network texture), thickest round the giants
      let vm = sat(gm.g * 1.4) * ss(.15, .7, n0.y);
      let vein = pow(sat(w1 * .8 + w2 * .45 - .2), 2.) * vm * ss(45., 10., dist);
      emi += mix(GLA, GLB, ss(.4, .6, gm.b)) * vein * .5 * (.7 + .3 * sin(g.cam.w * .8 - length(i.wp.xz) * .15));
      alb = mix(alb, vec3f(.45, .5, .5), vein * .25);
      alb = mix(alb, alb * vec3f(.9, .8, 1.25) + vec3f(.012, 0., .03), gm.b * .8);
    }
  } else if (mat == 2) {
    // bone: ivory with brown seams, moss in the hollows
    alb = mix(vec3f(.60, .56, .48), vec3f(.28, .22, .16), ss(.45, .65, sk.a * .6 + sk2.b * .5)) * (.75 + .3 * B.h);
    alb = mix(alb, vec3f(.06, .13, .10), ss(.55, .75, B.c * .6 + big * .4) * ss(-.2, .5, n0.y) * .7);
    gloss = .35; bump = .6; flu = .1;
  } else if (mat == 4) {
    // spore sacs: pale skins, glowing pores toward the rim
    let hue = fract(sd * 7.31);
    alb = mix(vec3f(.52, .42, .38), vec3f(.28, .38, .42), step(.5, hue));
    if (hue > .8) { alb = vec3f(.38, .20, .42); }
    alb *= (.45 + .75 * B.h) * (.7 + .3 * C.h);
    vao = i.ao * i.ao; gloss = .3; bump = 1.2; flu = .3;
    emi = mix(GLA, GLB, step(.5, fract(hue * 3.))) * ss(.55, .8, C.c) * ss(.5, 1., i.ao) * .3;
  } else {
    // coral fungus: branching fingers with glowing tips
    let hue = fract(sd * 5.73);
    alb = mix(vec3f(.85, .30, .10), vec3f(.12, .50, .55), step(.4, hue));
    if (hue > .75) { alb = vec3f(.52, .18, .72); }
    alb *= (.4 + .8 * B.h) * (.5 + .9 * i.ao * i.ao);
    emi = mix(alb * 2., vec3f(1., .9, .7), .3) * ss(.75, 1., i.ao) * .4; flu = .45; gloss = .25; bump = 1.2;
  }
  let N = normalize(qrot(i.q, normalize(on + (A.n * .85 + B.n * .65 + C.n * .45 * ss(60., 12., dist) + F.n * .5 * fk) * bump)));
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let v1 = vol(i.wp + n0 * 1.5); let v2 = vol(i.wp + n0 * 4.5);
  let ao = (sat((v1.r - .5) * 8.) * .55 + sat((v2.r - .5) * 2.7) * .45) * vao * ss(.12, .6, hgt);
  let z = zone(i.wp);
  let E = sunE(i.wp.y, z) * shadow9(i.wp + n0 * .35);
  let ndl = sat(dot(N, L));
  let gl = glow(i.wp + n0 * 1.2);
  let am = (amb(i.wp, N, v1.g, z) + side(i.wp, N, sat((v2.r - .5) * 2.7), z)) * ao + gl * (.35 + .65 * ao);
  let dl = E * ndl;
  var c = alb * (dl + am) + emi + alb * flu * dot(dl + am, vec3f(.3, .4, .3));
  let H = normalize(V + L);
  c += E * pow(sat(dot(N, H)), mix(10., 70., gloss)) * gloss * ndl * 1.5;
  c += (amb(i.wp, reflect(-V, N), v1.g, z) + gl * .5) * ao * (.06 + gloss) * .6 * pow(1. - sat(dot(N, V)), 2.5);
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- fungi (giants as one-off meshes, small ones instanced)
const W_FUNGI = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(5) e: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f,
  @location(3) @interpolate(flat) k: vec4f, @location(4) e: vec4f, @location(5) ao: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  let w = i.a.xyz + qrot(i.b, i.p * i.a.w);
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = qrot(i.b, i.n.xyz); o.ao = i.n.w;
  // one-off meshes (identity instance) carry their own hue; instances bring theirs and a glow scale
  let inst = i.c.x > .5;
  o.op = select(w, i.p * 2.2 + i.c.y * 53., inst);
  o.k = vec4f(select(i.e.y, i.c.y, inst), i.c.z, 0., 0.);
  o.e = i.e;
  return o;
}
struct P { cap: vec3f, spot: vec3f, gill: vec3f, stem: vec3f, sp: f32 };
fn pal(h: f32) -> P {
  let v = fract(h * 6.); var p: P;
  switch i32(floor(h * 6.)) {
    case 0 { p.cap = mix(vec3f(.46, .03, .10), vec3f(.60, .09, .28), v); p.spot = vec3f(.85, .9, .95); p.gill = vec3f(.85, .55, .65); p.stem = vec3f(.66, .58, .56); p.sp = 1.; }
    case 1 { p.cap = mix(vec3f(.03, .15, .17), vec3f(.06, .25, .24), v); p.spot = vec3f(.3, .9, .85); p.gill = vec3f(.5, .9, .85); p.stem = vec3f(.52, .60, .60); p.sp = .35; }
    case 2 { p.cap = mix(vec3f(.16, .04, .28), vec3f(.30, .07, .42), v); p.spot = vec3f(.95, .5, 1.); p.gill = vec3f(.8, .5, .95); p.stem = vec3f(.52, .46, .60); p.sp = .6; }
    case 3 { p.cap = mix(vec3f(.52, .24, .05), vec3f(.68, .38, .10), v); p.spot = vec3f(.95, .8, .5); p.gill = vec3f(.95, .8, .55); p.stem = vec3f(.70, .62, .48); p.sp = .25; }
    case 4 { p.cap = mix(vec3f(.52, .55, .60), vec3f(.68, .70, .64), v); p.spot = vec3f(.6, 1., .5); p.gill = vec3f(.75, .9, .7); p.stem = vec3f(.70, .72, .70); p.sp = .2; }
    default { p.cap = mix(vec3f(.04, .04, .15), vec3f(.08, .07, .23), v); p.spot = vec3f(.5, .7, 1.); p.gill = vec3f(.5, .65, 1.); p.stem = vec3f(.40, .42, .53); p.sp = .9; }
  }
  return p;
}
fn hh3(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn wor3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let r = o + hh3(i + o) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let part = i32(i.e.x * 255. + .5); let u = i.e.z; let h = i.k.x; let P = pal(h); let gs = i.k.y * i.e.w;
  let G = gcol(i32(floor(h * 6.)));
  var n = normalize(i.n); if (!ff) { n = -n; }
  let V = normalize(g.cam.xyz - i.wp); let L = g.sun.xyz;
  let tx = textureSample(tD, sR, i.op.xz * .31 + i.op.y * .07 + h * 7.);
  let tx2 = textureSample(tD, sR, vec2f((i.op.x + i.op.z) * 3.2, i.op.y * .35) + h * 3.);
  let tx3 = textureSample(tD, sR, i.op.xz * 4.1 + i.op.y * 1.3);
  let pulse = .8 + .2 * sin(g.cam.w * (.6 + fract(h * 37.) * .6) + h * 40. + i.wp.y * .15);
  var alb = vec3f(0.); var emi = vec3f(0.); var tr = 0.; var gloss = .15;
  switch part {
    case 0 { // stem: pale fibres, glowing specks low down
      alb = P.stem * (.6 + .45 * tx2.a) * (.85 + .15 * tx.b);
      emi = G * gs * .7 * ss(.72, .82, tx3.a);
      tr = .25;
    }
    case 1 { // cap top: mottled, spotted on some
      alb = P.cap * (.6 + .6 * tx.a) * mix(1.15, .8, u);
      let sp = (1. - ss(.2, .34, wor3(i.op * 1.1))) * step(hs(h * 91.7), P.sp) * ss(.06, .18, u);
      alb = mix(alb, P.spot * .8, sp);
      emi = P.spot * sp * gs * .8 * pulse + G * gs * .04;
      tr = .55; gloss = .35;
    }
    case 2 { alb = P.gill * .1; emi = G * gs * (.06 + .3 * u * u) * pulse; tr = .2; }                  // between the gills
    case 3 { alb = P.gill * (.3 + .25 * tx.a); emi = G * gs * gs * (.12 + 1.6 * u * u) * 1.3 * pulse; tr = .7; } // gills: brightest at the edge
    case 4 { alb = P.stem * (.75 + .3 * tx.a); tr = .9; emi = G * .03 * i.k.y; }                    // stem ring
    case 5 { // puffball: pale skin, glowing pores
      alb = mix(P.stem, P.cap, .35) * (.6 + .5 * tx.a);
      emi = G * (1. - ss(.08, .2, wor3(i.op * 3.))) * gs * pulse * u; tr = .5; gloss = .45;
    }
    case 6 { // bracket top: growth bands, a glowing lip
      let band = .5 + .5 * sin(u * 34. + tx.a * 3.);
      alb = mix(P.cap, mix(P.stem, P.spot, .3), band * .6) * (.55 + .5 * tx.a) * mix(.7, 1.1, u);
      emi = G * ss(.88, 1., u) * gs * 2. * pulse; gloss = .3;
    }
    default { alb = P.gill * .4; emi = G * (.3 + .7 * (1. - ss(.05, .15, wor3(i.op * 7.)))) * gs * .7 * pulse; } // bracket pores
  }
  let z = zone(i.wp);
  let E = sunE(i.wp.y, z) * shadow4(i.wp + n * .3);
  let vv = vol(i.wp + n);
  let ndl = dot(n, L);
  let gl = glow(i.wp + n);
  let aov = i.ao * (.35 + .65 * sat((vv.r - .5) * 6.));
  let am = amb(i.wp, n, vv.g, z) * aov + gl * (.4 + .6 * aov);
  var c = alb * (E * max(ndl, 0.) + am) + emi;
  // thin flesh lets light through: caps against the low sun glow at the rim
  c += alb * tr * (E * pow(sat(dot(-V, L)), 3.) * sat(.4 - ndl) * 1.5 + (amb(i.wp, -n, vv.g, z) * aov + gl) * .35);
  c += E * pow(sat(dot(n, normalize(V + L))), mix(12., 60., gloss)) * gloss * max(ndl, 0.);
  c += am * pow(1. - sat(dot(n, V)), 3.) * .25;
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- leaves (fronds, threads, glow moss, grasses)
const W_LEAF = S_B + /*wgsl*/`
override ROWS: f32 = 7.;
override FAR: f32 = 150.;
struct LI { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f };
struct LO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) col: vec3f, @location(4) @interpolate(flat) pr: vec4f,
  @location(5) @interpolate(flat) sd: vec2f, @location(6) @interpolate(flat) spc: vec3f };
fn sway(p: vec2f, h: f32, t: f32) -> vec2f {
  let a = .016 * pow(max(h, 0.), 1.25);
  let gust = .5 + .5 * sin(t * .45 - dot(p, WIND) * .07) * (.6 + .4 * sin(t * .13 + p.x * .01));
  let flut = .3 * sin(t * 2.6 + dot(p, vec2f(.7, .5)) + h * .5);
  return a * (WIND * (gust + flut) + vec2f(-WIND.y, WIND.x) * .2 * sin(t * 1.9 + p.y * .8 + h));
}
fn shape2(v: f32) -> f32 { return sin(3.14159 * sat(v)); }
fn pal(h: f32) -> vec3f {
  if (h < .3) { return vec3f(1., .62, .25); }
  if (h < .6) { return vec3f(.6, 1., .45); }
  if (h < .8) { return vec3f(.2, 1., .85); }
  return vec3f(1., .3, .8);
}
@vertex fn vs(@builtin(vertex_index) vi: u32, i: LI) -> LO {
  var o: LO;
  let u = f32(vi & 1u) * 2. - 1.; let v = sin(f32(vi >> 1u) / (ROWS - 1.) * 1.5708);
  let ty = i32(i.c.x * 255. + .5); let s1 = i.c.y; let s2 = i.c.z;
  let t = g.cam.w;
  let len = i.a.w; let hA = i.b.w;
  let cy = cos(i.b.x); let sy = sin(i.b.x); let ct = cos(i.b.y); let st = sin(i.b.y);
  let d = vec3f(st * cy, ct, st * sy); let pe = vec3f(ct * cy, -st, ct * sy); let sd = vec3f(-sy, 0., cy);
  // per type: x sparkle prob, y translucency, z iridescence, w emissive
  var col = vec3f(0.); var pr = vec4f(0.); var spc = vec3f(0.); var shp = vec2f(.75, .7); var wav = 1.; var fls = 1.;
  let hsel = hs(s1 * 13.7 + s2 * 71.3);
  switch ty {
    case 0 { col = mix(vec3f(.05, .10, .10), vec3f(.10, .06, .14), s1); pr = vec4f(.24, .9, .2, .05); spc = pal(hsel); shp = vec2f(.5, .32); wav = 1.9; }
    case 1 { col = vec3f(.10, .11, .035); pr = vec4f(0., .2, 0., 0.); shp = vec2f(.05, .1); wav = .3; fls = .3; }
    case 2 { col = mix(vec3f(.07, .13, .07), vec3f(.04, .12, .11), s1); col = mix(col, vec3f(.20, .08, .18), step(.82, s2)); pr = vec4f(.12, 1.0, .25, .03); spc = vec3f(.6, 1., .8); shp = vec2f(.45, .35); wav = 2.2; }
    case 3 { col = mix(vec3f(.02, .05, .065), vec3f(.05, .03, .08), s1); col = mix(col, vec3f(.09, .03, .09), step(.8, s2)); pr = vec4f(.2, .85, .55, .02); spc = mix(vec3f(.5, .35, 1.), vec3f(.2, 1., .7), step(.6, hsel)); shp = vec2f(.7, .6); wav = 2.4; }
    case 4 { col = mix(vec3f(.30, .15, .02), vec3f(.42, .25, .04), s1); pr = vec4f(.2, 1., .1, 0.); spc = vec3f(1., .85, .5); shp = vec2f(.5, .4); wav = 1.8; }
    case 5 { // glow moss: teal, magenta on the magenta carpets and in the grotto
      let gm = textureSampleLevel(tM, sC, i.a.xz / 384. + .5, 0.); let mg = step(.45, max(gm.r, gm.b * .8));
      col = mix(mix(vec3f(.05, .45, .38), vec3f(.30, .55, .12), step(.8, s1)), mix(vec3f(.70, .05, .42), vec3f(.45, .10, .75), step(.7, s1)), mg);
      pr = vec4f(.22, .8, 0., .55); spc = mix(vec3f(.4, 1., .8), vec3f(1., .35, .8), mg); shp = vec2f(.6, .6); fls = 2.; }
    case 6 { col = gcol(i32(s2 * 6.)) * mix(.35, .5, s1); pr = vec4f(0., .9, 0., 1.3); shp = vec2f(.3, .2); wav = .5; fls = .2; } // glowing threads
    default { col = mix(vec3f(.16, .09, .22), vec3f(.05, .17, .17), s1); pr = vec4f(.1, .9, .2, .05); spc = vec3f(.3, 1., .9); shp = vec2f(.6, .5); }
  }
  pr.x = step(hs(s1 * 91.7 + s2 * 37.1 + i.b.x), pr.x);
  let k = (i.c.w - .3) * 2.0 + sin(t * (.8 + s1) * fls + s2 * 40. + hA * .25) * .10 * fls;
  let wph = v * (3. + 5. * s2) + s1 * 30. + t * 1.1;
  let wv = sin(wph) * .12 * wav;
  let kq = k * 1.7; let ka = select(kq, .06, abs(kq) < .06);
  let sK = sin(ka * v); let cK = cos(ka * v);
  let c = i.a.xyz + len * (d * (sK / ka) + pe * ((1. - cK) / ka + wv * v));
  let sl = sK + wv + cos(wph) * .10 * wav * v * (3. + 5. * s2);
  let N = normalize(pe * cK - d * sl); let T0 = normalize(d * cK + pe * sl);
  let tw = (s1 - .5) * 2.4 * v + sin(t * .9 + s2 * 20.) * .25 * v;
  let S = sd * cos(tw) + N * sin(tw); let N2 = N * cos(tw) - sd * sin(tw);
  let shape = pow(max(sin(3.14159 * pow(v, shp.x)), 0.), shp.y);
  let shp_ = g.res.x == 0.;
  let cd = distance(i.a.xyz, g.cam.xyz); let far = FAR * g.mis.z;
  let nearK = select(1. - ss(26., 40., cd), 0., shp_);
  let farK = select((1. - ss(far * .8, far, cd)) * ss(.6, 2.2, distance(c, g.cam.xyz)) * ss(len * 1.1 + .5, len * 2.2 + 1.2, distance(i.a.xyz + d * (len * .5), g.cam.xyz)), 1., shp_);
  let ruf = sin(v * 10. + s2 * 30. + t * .6) * i.b.z * .36 * u * shape2(v) * nearK;
  var p = c + S * (u * farK * select(i.b.z * .5 * shape, select(max(i.b.z * .5, .09) * shape, 0., ty == 1), shp_));
  p += N2 * ruf;
  let sw = sway(i.a.xz, hA + (p.y - i.a.y), t);
  p.x += sw.x; p.z += sw.y;
  o.cp = g.vp * vec4f(p, 1.); o.wp = p; o.n = normalize(N2 + S * u * .55 - T0 * cos(v * 10. + s2 * 30. + t * .6) * u * .7 * nearK); o.uv = vec2f(u, v);
  o.col = col; o.pr = pr; o.sd = vec2f(s1, s2); o.spc = spc;
  return o;
}
struct GO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) col: vec3f };
@vertex fn vsGl(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> GO {
  var o: GO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.; let t = g.cam.w;
  var p = a.xyz; let sw = sway(a.xz, a.w, t); p.x += sw.x; p.z += sw.y;
  p += .1 * vec3f(sin(t * .7 + b.x * 50.), sin(t * .9 + b.x * 70.), cos(t * .8 + b.x * 90.));
  let d = length(p - g.cam.xyz);
  if (d > 120. || dot(p - g.cam.xyz, g.fwd.xyz) < -1.) { o.cp = vec4f(0., 0., 2., 1.); return o; }
  let tw = pow(.5 + .5 * sin(t * (.35 + .9 * hs(b.x)) + b.x * 100.), 4.);
  let sz = min(max(b.z, d * .0026), d * .0045);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q;
  let z = zone(p);
  let lit = .9 + .5 * shadow1(p) * sunE(p.y, z).g;
  let e = b.z / sz;
  o.col = pal(b.y) * (.12 + tw * 1.7) * lit * e * e * exp(-od(g.cam.xyz, (p - g.cam.xyz) / d, d)) * ss(.4, 1.5, d) * 17.;
  return o;
}
@fragment fn fsGl(i: GO) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  return vec4f(min(i.col * exp(-r * 7.) * (1. - ss(.7, 1., r)), vec3f(10.)), 0.);
}
@fragment fn fs(i: LO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let dist = length(i.wp - g.cam.xyz);
  var n = normalize(i.n); if (!ff) { n = -n; }
  let V = normalize(g.cam.xyz - i.wp); let L = g.sun.xyz;
  let z = zone(i.wp);
  let lt = textureSample(tD, sR, vec2f(i.uv.x * .13 + i.sd.x * 3.7, i.uv.y * .8 + i.sd.y * 5.3));
  let vv = vol(i.wp + vec3f(0., .8, 0.));
  let E = sunE(i.wp.y, z) * shadow1(i.wp + L * .3);
  let ndl = dot(n, L);
  var alb = i.col * (.72 + .28 * ss(0., .25, abs(i.uv.x))) * mix(.5, 1.12, i.uv.y) * (1. - .45 * ss(30., 8., dist) * ss(.6, 1., sin(i.uv.y * 40. - abs(i.uv.x) * 7. + i.sd.x * 40.))) * (.58 + .42 * ss(0., .13, abs(i.uv.x))) * (.5 + 1.0 * lt.b) * (.65 + .7 * lt.a);
  let ndv = sat(dot(n, V));
  let ir = .5 + .5 * cos(TAU * (vec3f(0., .33, .67) + ndv * 1.1 + i.sd.x * .22 + i.uv.y * .5 + .55));
  alb = mix(alb, alb * .5 + ir * vec3f(.15, .13, .30), i.pr.z * (1. - ndv) * .8);
  let tr = (max(-ndl, 0.) * .85 + .15) * i.pr.y;
  let trc = alb * mix(vec3f(1.), vec3f(1.5, 1.4, .75), sat(i.pr.y) * (1. - i.pr.z));
  let aov = sat((vv.r - .5) * 6.) * mix(.4, 1., i.uv.y);
  let gl = glow(i.wp + n * .6);
  let am = (amb(i.wp, n, vv.g, z) + amb(i.wp, -n, vv.g, z) * i.pr.y * .55 * vec3f(1.1, 1.15, .7) + side(i.wp, n, sat((vv.r - .5) * 4.), z) * .6) * (.3 + .7 * aov) + gl * (.5 + .5 * aov);
  var c = E * (alb * max(ndl, 0.) + trc * tr) + alb * am;
  let H = normalize(V + L);
  c += E * (pow(sat(dot(n, H)), 40.) * (.45 + ir * i.pr.z * 2.) + pow(sat(dot(n, H)), 9.) * .07) + am * ir * i.pr.z * pow(1. - ndv, 3.) * 1.5;
  c += E * trc * i.pr.y * pow(sat(dot(-V, L)), 3.) * 1.2;
  // self-glow, strongest toward the tips, slowly breathing
  c += i.col * i.pr.w * (.25 + .9 * i.uv.y * i.uv.y) * (.8 + .2 * sin(g.cam.w * 1.1 + i.sd.x * 40.));
  // sparkle: whole-leaf glints that twinkle slowly
  let tw = pow(.5 + .5 * sin(g.cam.w * (.5 + i.sd.y * 1.4) + i.sd.x * 90.), 5.);
  let m = ss(.2, .0, abs(i.uv.y - (.35 + .45 * i.sd.y))) * (1. - i.uv.x * i.uv.x);
  let lit = .35 + E.g * 1.2;
  c += i.spc * i.pr.x * (.1 + tw) * m * lit * .6;
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- flying creatures: skyfish schools and gliders
const W_ANIM = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) @interpolate(flat) sd: f32, @location(4) lt: f32 };
// moths: each wanders its own looping path round the swarm centre, faces where it flies and beats its wings
@vertex fn vsFish(i: VI) -> VO {
  var o: VO;
  let s = i.b.x; let h = vec3f(hs(s), hs(s + .37), hs(s + .71)); let f = vec3f(.31, .53, .43) * i.b.y * (.7 + .6 * h);
  let R = i.a.w; let t = g.cam.w + s * 100.;
  let P = i.a.xyz + vec3f(R * sin(t * f.x + h.y * 9.), 1.6 * sin(t * f.y + h.z * 7.) + 2. * h.x, R * sin(t * f.z * 1.3 + h.x * 5.));
  let T = normalize(vec3f(R * f.x * cos(t * f.x + h.y * 9.), 1.6 * f.y * cos(t * f.y + h.z * 7.) * .5, R * f.z * 1.3 * cos(t * f.z * 1.3 + h.x * 5.)) + vec3f(0., 1e-4, 0.));
  let S = normalize(cross(vec3f(0., 1., 0.), T + vec3f(1e-4, 0., 0.))); let Up = cross(T, S);
  let a = sin(g.cam.w * (17. + 8. * h.z) + s * 40.) * 1.1;
  var l = i.p * i.b.z * (.8 + .4 * h.z);
  let w0 = abs(l.z); l = vec3f(l.x, l.y + w0 * sin(a), l.z * cos(a));
  let w = P + T * l.x + Up * l.y + S * l.z;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = T * i.n.x + Up * i.n.y + S * i.n.z; o.op = i.p; o.sd = s;
  o.lt = shadow1(w);
  return o;
}
@fragment fn fsFish(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(i.n); if (!ff) { n = -n; }
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  // dusky wings with a glowing eye spot, a glowing body; light shines through the wings
  let gc = select(GLA, GLB, fract(i.sd * 3.7) > .6);
  let az = abs(i.op.z);
  var alb = mix(vec3f(.26, .20, .30), vec3f(.45, .32, .22), fract(i.sd * 5.1)) * (.6 + .4 * az * 4.);
  let spot = ss(.055, .03, length(vec2f(i.op.x + .01, az - .17))) + ss(.035, .02, length(vec2f(i.op.x + .1, az - .14)));
  let E = sunE(i.wp.y, z) * i.lt;
  var c = alb * (E * sat(dot(n, L)) + amb(i.wp, n, vv.g, z) * 1.3 + glow(i.wp)) + alb * E * pow(sat(dot(-V, L)), 2.) * .8;
  c += gc * (spot * 1.8 + ss(.03, .0, az) * .9);
  return fin(fog(c, i.wp, z));
}
@vertex fn vsManta(i: VI) -> VO {
  var o: VO;
  let t = g.cam.w; let R = i.a.w; let sz = i.b.z;
  let ta = t * i.b.y + i.b.x;
  let P = i.a.xyz + vec3f(R * cos(ta), 2.5 * sin(2. * ta + i.b.w), R * .75 * sin(ta));
  let T = normalize(vec3f(-R * sin(ta), 5. * cos(2. * ta + i.b.w) * 1., R * .75 * cos(ta))) * sign(i.b.y);
  var S = normalize(cross(vec3f(0., 1., 0.), T)); var Up = cross(T, S);
  let bank = -.28 * sign(i.b.y);
  let S2 = S * cos(bank) + Up * sin(bank); Up = Up * cos(bank) - S * sin(bank); S = S2;
  let u = i.n.w; let au = abs(u);
  let fl = ss(.55, .95, sin(t * .17 + i.b.w * 7.));
  let fp = t * 2.4 + i.b.w * 5.;
  let amp = .42 * pow(au, 1.6) * fl;
  var l = i.p;
  l.y += amp * sin(fp) + .04 * au * au;
  let tail = ss(-.5, -1.9, l.z) * step(au, .001);
  l.x += tail * sin(t * .8 + l.z * 2.) * .12;
  let sl = (.672 * pow(au, .6) * sin(fp) * fl + .08 * au) * sign(u);
  let ln = normalize(vec3f(i.n.x - sl * i.n.y, i.n.y + sl * i.n.x, i.n.z));
  let w = P + (S * l.x + Up * l.y + T * l.z) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = S * ln.x + Up * ln.y + T * ln.z; o.op = i.p; o.sd = i.b.w;
  o.lt = 1.;
  return o;
}
@fragment fn fsManta(i: VO) -> @location(0) vec4f {
  let dist = length(i.wp - g.cam.xyz);
  let tx = textureSample(tD, sR, i.op.xz * .9 + i.sd);
  let n = normalize(i.n + (vec3f(tx.r, 0., tx.g) - vec3f(.5, 0., .5)) * .5); let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  let top = ss(-.2, .25, normalize(i.n).y);
  let au = abs(i.op.x);
  let gill = ss(.25, .0, abs(au - .13) * 8.) * ss(.04, .12, i.op.z) * ss(.34, .26, i.op.z) * ss(.2, .8, sin(i.op.z * 110.));
  var belly = vec3f(.13, .17, .21) * (.6 + .6 * tx.b) * (1. - .7 * gill);
  belly = mix(belly, vec3f(.05, .08, .11), sat(ss(.45, .9, au + tx.a * .35) + ss(-.1, -.4, i.op.z + tx.b * .2) * .7));
  var back = vec3f(.04, .065, .10) + vec3f(.10, .16, .2) * ss(.5, .75, tx.a);
  back = mix(back, vec3f(.36, .46, .52), ss(.25, .0, abs(au - .26) * 3.5 + abs(i.op.z - .12) * 5.) * .8);
  var alb = mix(belly, back, top);
  let E = sunE(i.wp.y, z) * shadow4(i.wp + n * .3);
  let ndv = sat(dot(n, V));
  let ir = .5 + .5 * cos(TAU * (vec3f(0., .33, .67) + ndv * 1.1 + tx.a * 1.5 + .55));
  let fillN = vec3f(n.x, abs(n.y) * .55 + .25, n.z);
  var c = alb * (E * sat(dot(n, L)) * 1.3 + amb(i.wp, fillN, vv.g, z) * 1.1 + side(i.wp, n, 1., z) * .8 + glow(i.wp));
  c += ir * vec3f(.35, .16, .6) * (.07 + .22 * tx.b) * (.4 + E.g * .2) * (1. - top * .3);
  c += E * pow(sat(dot(n, normalize(V + L))), 30.) * .6;
  // wing membranes glow at the edges, a row of bioluminescent spots along the back, light through the thin wings
  c += GLA * (ss(.78, .9, tx.a) * top * 1.2 + ss(.72, .98, au) * .35) * (.8 + .2 * sin(g.cam.w * 2. + i.op.z * 6.));
  c += alb * E * pow(sat(dot(-V, L)), 3.) * ss(.3, .9, au) * 2.;
  let sky = amb(i.wp, vec3f(0., 1., 0.), vv.g, z);
  c += sky * pow(1. - ndv, 3.) * .35;
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- sky, behind everything
const W_SKY = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f };
@vertex fn vsB(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.wp = g.cam.xyz + g.fwd.xyz + g.right.xyz * (p.x * g.right.w) + g.up.xyz * (p.y * g.up.w);
  o.cp = vec4f(p, 1e-7, 1.);
  return o;
}
@fragment fn fsB(i: VO) -> @location(0) vec4f {
  let rd = normalize(i.wp - g.cam.xyz);
  return fin(sky(rd, g.sun.xyz, zone(g.cam.xyz)));
}
`;

// ---------------------------------------------------------------- god rays: sunlight scattered by the spores (half res)
const W_RAYS = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sS: sampler_comparison;
@group(0) @binding(3) var tSh: texture_depth_2d;
@group(0) @binding(4) var tW: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
@group(0) @binding(6) var tV: texture_3d<f32>;
@group(0) @binding(7) var sC: sampler;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dp = textureLoad(tDp, vec2i(fc.xy) * 2, 0);
  let uv = fc.xy * 2. * g.res.zw;
  let nd = vec2f(uv.x * 2. - 1., 1. - uv.y * 2.);
  let rv = g.fwd.xyz + g.right.xyz * (nd.x * g.right.w) + g.up.xyz * (nd.y * g.up.w);
  let rl = length(rv); let rd = rv / rl;
  // linear depth, kept below the half-float limit (open sky has a depth of ~0)
  let zl = min(g.fwd.w / max(dp, 1e-6), 3e4);
  let tm = min(zl * rl, 150.);
  let ro = g.cam.xyz; let sx = g.sun.xyz;
  let dt = tm / ${RAYN}.;
  let j = ign(fc.xy);
  var acc = vec3f(0.);
  for (var n = 0; n < ${RAYN}; n++) {
    let t = (f32(n) + j) * dt;
    let p = ro + rd * t;
    let s = g.sm * vec4f(p, 1.);
    let vis = textureSampleCompareLevel(tSh, sS, vec2f(s.x * .5 + .5, .5 - s.y * .5), s.z - .0004);
    // spore density: the height fog, in drifting clouds (the slow network texture), thinner close to rock
    let cl = textureSampleLevel(tW, sR, (p.xz + p.y * vec2f(.4, .3)) / 41., 2.5).r;
    let op = textureSampleLevel(tV, sC, (p - vec3f(-192., -56., -192.)) / vec3f(384., 72., 384.), 0.).r;
    let rho = (FOGD * exp(-FOGH * (p.y - FY)) + FOG0) * (.55 + .9 * cl) * (.5 + .5 * op);
    acc += exp(-od(ro, rd, t)) * exp(-od(p, sx, 600.) * vec3f(.3, .45, .7)) * rho * vis;
  }
  let mu = dot(rd, sx);
  let ph = .64 / pow(1.36 - 1.2 * mu, 1.5) * .3 + .2;
  return vec4f(min(acc * dt * SUNC * ph * g.mis.y, vec3f(20.)), zl);
}
`;

// ---------------------------------------------------------------- sprites: glowing spore motes and drifting dust (both additive)
const W_SPR = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) pr: vec4f, @location(2) wp: vec3f };
fn quad(i: u32) -> vec2f { return vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.; }
// a: x, start height, z, size; b: palette + seed, speed, travel (negative: falling), wobble
@vertex fn vsBub(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let sd = fract(b.x); let tr = b.z;
  let life = fract(t * b.y / abs(tr) + sd * 7.3);
  let h = life * tr;
  var p = a.xyz + vec3f(0., h, 0.);
  let wob = b.w * (.3 + abs(h) * .04);
  p.x += sin(t * 1.3 + sd * 50. + h * .4) * wob * .4 + WIND.x * abs(h) * .45;
  p.z += cos(t * 1.1 + sd * 33. + h * .35) * wob * .4 + WIND.y * abs(h) * .45;
  let d = length(p - g.cam.xyz);
  let s0 = a.w * ss(0., .08, life) * ss(1., .75, life);
  let sz = max(s0, d * .0013);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz * 2.5;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p;
  if (d > 140.) { o.cp = vec4f(0., 0., 2., 1.); }
  o.pr = vec4f(floor(b.x), s0 / sz, sd, d);
  return o;
}
@fragment fn fsBub(i: VO) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  let k = i.pr.y * i.pr.y;
  let tw = .65 + .35 * sin(g.cam.w * 3. + i.pr.z * 60.);
  let T = exp(-od(g.cam.xyz, normalize(i.wp - g.cam.xyz), i.pr.w));
  return vec4f(min(gcol(i32(i.pr.x)) * (exp(-r * 22.) * 3. + exp(-r * 5.) * .35) * (1. - ss(.6, 1., r)) * k * tw * T * ss(.3, 1.2, i.pr.w) * 1.6, vec3f(10.)), 0.);
}
@vertex fn vsSnow(@builtin(vertex_index) vi: u32, @location(0) a: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let B = 44.;
  var p = a.xyz * B + vec3f(WIND.x * t * (1.2 + a.w), -t * .08, WIND.y * t * (1.2 + a.w)) + .25 * vec3f(sin(t * .9 + a.x * 60.), sin(t * .7 + a.y * 50.), cos(t * .8 + a.z * 70.));
  p = g.cam.xyz + (fract((p - g.cam.xyz) / B + .5) - .5) * B;
  let d = length(p - g.cam.xyz);
  let sz = (.012 + .045 * a.w * a.w * a.w);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * max(sz, d * .0011);
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p;
  let fade = ss(B * .5, B * .32, d) * ss(.6, 2.5, d) * min(1., sz / (d * .0011)) * ss(12., 4., p.y);
  let tw = .6 + .4 * sin(t * (1. + a.w * 2.) + a.x * 100.);
  o.pr = vec4f(fade * tw, shadow1(p), a.w, d);
  return o;
}
@fragment fn fsSnow(i: VO) -> @location(0) vec4f {
  let r = length(i.uv);
  let m = ss(1., .2, r);
  let z = zone(i.wp);
  // dust and spores: bright toward the sun (forward scattering), faintly lit by the glow around them
  let fw = pow(max(dot(normalize(i.wp - g.cam.xyz), g.sun.xyz), 0.), 6.);
  let c = (sunE(i.wp.y, z) * i.pr.y * (.25 + 2.2 * fw) + amb(i.wp, vec3f(0., 1., 0.), 1., z) * .3 + glow(i.wp) * .8) * mix(vec3f(1.), vec3f(.85, 1., .9), i.pr.z);
  return vec4f(min(max(c * m * m * i.pr.x * exp(-.02 * i.pr.w), vec3f(0.)), vec3f(8.)), 0.);
}
`;

// depth-aware 3x3 blur of the half-res shafts (hides the sampling dither)
const W_RBLUR = W_FS + /*wgsl*/`
@group(0) @binding(0) var tR: texture_2d<f32>;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy); let mx = vec2i(textureDimensions(tR)) - 1;
  let c = textureLoad(tR, p, 0);
  var acc = vec3f(0.); var ws = 0.;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let r = textureLoad(tR, clamp(p + vec2i(x, y) , vec2i(0), mx), 0);
    let w = 1. / (.03 + abs(r.a - c.a) / c.a);
    acc += r.rgb * w; ws += w;
  } }
  return vec4f(acc / ws, c.a);
}
`;

// ---------------------------------------------------------------- final composite
const W_POST = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sC: sampler;
@group(0) @binding(2) var tS: texture_2d<f32>;
@group(0) @binding(3) var tR: texture_2d<f32>;
@group(0) @binding(4) var tB: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
fn tmap(x: vec3f) -> vec3f { return sat3((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14)); }
fn sat3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.), vec3f(1.)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2i(fc.xy);
  let uv = fc.xy * g.res.zw;
  let zf = min(g.fwd.w / max(textureLoad(tDp, px, 0), 1e-6), 3e4);
  // depth-aware upsample of the half-res shafts
  let h = fc.xy * .5 - .5; let b = floor(h); let f = h - b; let bi = vec2i(b);
  let mx = vec2i(textureDimensions(tR)) - 1;
  var acc = vec3f(0.); var ws = 0.;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let r = textureLoad(tR, clamp(bi + o, vec2i(0), mx), 0);
    let bw = mix(1. - f.x, f.x, f32(o.x)) * mix(1. - f.y, f.y, f32(o.y));
    let w = (bw + .02) / (.02 + abs(r.a - zf) / zf);
    acc += r.rgb * w; ws += w;
  }
  var c = textureLoad(tS, px, 0).rgb + acc / ws;
  let bl = textureSampleLevel(tB, sC, uv, 0.).rgb;
  c = mix(c, bl, .06) + bl * .03;
  c *= g.mis.x;
  let q = uv - .5;
  c *= 1. - dot(q, q) * .55;
  c = tmap(c);
  let l0 = dot(c, vec3f(.2126, .7152, .0722));
  let l = mix(l0, l0 * l0 * (3. - 2. * l0), .55);
  c *= l / max(l0, 1e-4);
  c = mix(c, vec3f(l), ss(.55, 1., l) * .1);
  c = mix(vec3f(l), c, .93) + vec3f(.008, .002, 0.);
  c = pow(max(c, vec3f(0.)), vec3f(1. / 2.2));
  let n = ign(fc.xy) + ign(fc.xy + 37.) - 1.;
  return vec4f(c + n / 255. * ${location.hash.includes('nograin') ? 0 : 1}., 1.); // #nograin: no dither (training data)
}
`;
