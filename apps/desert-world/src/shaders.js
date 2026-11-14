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
// dune seas in the open outer basin: centre x, z, radius (world.js keeps hoodoos and most plants out of them)
const W_DSEA = /*wgsl*/`
const DSEA = array<vec3f, 6>(vec3f(-100., 62., 44.), vec3f(98., 62., 40.), vec3f(-96., -92., 42.), vec3f(102., -86., 38.), vec3f(-128., -12., 30.), vec3f(126., 8., 30.));
fn dsea(p: vec2f) -> f32 { var m = 0.; for (var i = 0; i < 6; i++) { let c = DSEA[i]; m = max(m, ss(c.z, c.z * .55, length(p - c.xy))); } return m; }
`;
const W_DENS = W_NOISE + W_DSEA + /*wgsl*/`
struct U { n: vec4u, o: vec4f, c: vec4u };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> D: array<f32>;
@group(0) @binding(2) var<storage, read> P: array<vec4f>;
fn smax(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }
fn smin(a: f32, b: f32, k: f32) -> f32 { return -smax(-a, -b, k); }
fn seg2(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
fn seg3(p: vec3f, a: vec3f, b: vec3f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
// transverse dunes across the wind: a long gentle windward slope and a short steep slip face, crests bent by noise
fn dune(p: vec2f) -> f32 {
  let pr = dot(p, vec2f(.8, .6)) * .042 + fbm(vec3f(p * .011, 1.3), 3) * 3.2;
  let ph = fract(pr); let r = select(ph / .76, (1. - ph) / .24, ph > .76);
  return r * r * (3. - 2. * r) * (.35 + 1.1 * fbm(vec3f(p * .018, 6.), 2)) * 5.;
}
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
  // dunes only on open ground: away from rock, off the plateaus and the salt flat, low along the cleared corridors
  let dmask = ss(3., 13., de) * (1. - clr * .85) * ss(30., 50., length(q.xz - vec2f(6., 84.))) * (1. - ss(140., 158., length(p.xz)));
  let rad = length(p.xz) + w.x * 14.;
  let n = fbm(vec3f(q.xz * .0125, 1.7), 4);
  let ring = ss(154., 172., rad);
  let sea = dsea(q.xz);
  let plat = max(ss(.585, .64, n) * (1. - clr) * (1. - sea), ring);
  let dh = dune(q.xz) * max(dmask, sea * ss(4., 9., de)) * (1. - plat) * (1. + sea * 1.1);
  // the crater rim: a ring of jagged peaks around the basin
  let th = g0 + plat * mix(26. + 17. * fbm(vec3f(q.xz * .03, 5.), 2), 44. + 26. * fbm(vec3f(q.xz * .02, 8.), 3), ring);
  var d = smax(g0 + dh + 4.5 * ss(10., 0., de) - p.y, dm, 3.);
  d = smax(d, (th - p.y) * .7, 3.);
  k = u.c.x * 2u;
  for (var i = 0u; i < u.c.y; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    var r = p + w * 3. - a.xyz;
    let cs = cos(a.w); let sn = sin(a.w);
    r = vec3f(cs * r.x + sn * r.z, r.y / b.z, -sn * r.x + cs * r.z);
    d = smax(d, b.y - length(vec2f(length(r.xy) - b.x, r.z)), 1.5);
  }
  let hg = p.y - g0 - dh;
  let rk = mix(.25, 1., ss(.5, 5., hg)) * (1. - .95 * max(dmask, sea) * (1. - plat) * (1. - ss(3., 9., hg)));
  // blocky jointing (stretched cells) instead of rounded lumps, plus fine noise
  d += rk * ((.5 - wor(p * vec3f(.11, .04, .11) + w * 2.)) * 1.4 + (fbm(p * vec3f(.25, .6, .25), 3) - .5) * 1.1);
  // sandstone beds: alternating hard ledges and soft recesses
  let sy = p.y * .17 + w.y * .35 + .9 * sin(p.y * .071 + 1.3) + .3 * sin(p.y * .23 + w.x * 2.);
  let sy2 = p.y * .53 + w.y * .7 + .6 * sin(p.y * .19 + 4.);
  d += rk * (1.4 + 3.2 * h31(vec3f(floor(sy), 3., 7.))) * (abs(fract(sy) - .5) - .25) + rk * 1.6 * h31(vec3f(floor(sy2), 9., 1.)) * (abs(fract(sy2) - .5) - .25);
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
const SUNC = vec3f(3.0, 2.35, 1.7);
const SKYZ = vec3f(.07, .17, .42);
const SKYH = vec3f(.55, .55, .56);
const HAZE = vec3f(.40, .37, .36);
const HAZS = vec3f(1.05, .78, .52);
const GLA = vec3f(.18, 1., .80);
const GLB = vec3f(1., .26, .78);
const FOG0 = .0032; const FOGD = .005; const FOGH = .06; const FY = -46.;
const WIND = vec2f(.8, .6);
const PD = vec3f(-.45, .42, .79); const PA = vec3f(.3, .92, -.25);
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
  return mix(c, c * vec3f(1.06, 1.05, 1.04), z);
}
fn n2(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  let a = hs(i.x + i.y * 57.); let b = hs(i.x + 1. + i.y * 57.); let c = hs(i.x + (i.y + 1.) * 57.); let d = hs(i.x + 1. + (i.y + 1.) * 57.);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// a pale daytime moon: rgb, coverage
fn planet(rd: vec3f, sun: vec3f) -> vec4f {
  let pd = normalize(PD); let pr = .028;
  let b = dot(rd, pd); let h = b * b - 1. + pr * pr;
  if (h <= 0.) { return vec4f(0.); }
  let pn = normalize(rd * (b - sqrt(h)) - pd); let u = vec2f(dot(pn, normalize(cross(pd, vec3f(0., 1., 0.)))), pn.y);
  let mar = n2(u * 6. + 3.) * .6 + n2(u * 17.) * .4;
  return vec4f(vec3f(.9, .92, 1.) * (.55 + .45 * ss(.35, .6, mar)) * (.12 + .88 * ss(-.1, .3, dot(pn, sun))) * .55, ss(0., .0001, h) * .8);
}
fn sky(rd: vec3f, sun: vec3f, z: f32) -> vec3f {
  let y = rd.y; let mu = dot(rd, sun);
  var c = mix(SKYH, SKYZ, pow(ss(-.02, .9, y), .55));
  c += vec3f(.55, .32, .16) * pow(max(mu, 0.), 4.) * (1. - ss(0., .7, y)) * .9;
  if (y > 0.) { // high wisps of cirrus, stretched along the wind
    let uv = rd.xz / (y + .15) * 1.1; var st = vec2f(dot(uv, vec2f(.8, .6)) * .5, dot(uv, vec2f(-.6, .8)) * 1.2);
    st += vec2f(n2(uv * .9 + 7.), n2(uv * .9 + 3.)) * 1.6;
    let cl = ss(.58, .92, n2(st * 1.3 + vec2f(3., 1.)) * .55 + n2(st * 3.1 + 5.) * .3 + n2(uv * 6.) * .15) * ss(.02, .2, y) * (1. - ss(.35, .8, y)) * ss(.3, .6, n2(uv * .35 + 11.));
    c = mix(c, mix(vec3f(.85, .82, .80), vec3f(1.3, .95, .7), pow(max(mu, 0.), 3.)), cl * .55);
  }
  let pl = planet(rd, sun); c = mix(c, c + pl.rgb, pl.a * ss(-.02, .04, y));
  c += SUNC * (pow(max(mu, 0.), 2400.) * 60. + pow(max(mu, 0.), 140.) * .6 + pow(max(mu, 0.), 10.) * .08);
  return mix(c, hazeC(rd, sun, z), exp(-max(y, 0.) * 9.));
}
`;

const S_B = S_G + W_DSEA + /*wgsl*/`
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
  return mix(vec3f(.30, .19, .11), mix(vec3f(.17, .27, .48), vec3f(.30, .32, .40), z), up * up) * (.2 + .8 * sky) * 1.15 + vec3f(.006, .004, .003);
}
// height of the top floor, from the ground map
fn gnd(p: vec2f) -> f32 { return textureSampleLevel(tM, sC, p / 384. + .5, 0.).g * 72. - 56.; }
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
  var bump = 1.; var gloss = .1; var alb = vec3f(0.); var emi = vec3f(0.); var vao = 1.; var flu = 0.;
  let flt = ss(.72, .93, n0.y);
  var rip = vec3f(0.); var spark = 0.; var sandK = 0.;
  // varnish streak texture: projected along x and along z, blended by which way the wall faces (stable on curved slopes)
  let vwx = textureSample(tD, sR, vec2f(i.op.x * .061, i.op.y * .011)).a * .6 + textureSample(tD, sR, vec2f(i.op.x * .143 + .37, i.op.y * .019)).a * .4;
  let vwz = textureSample(tD, sR, vec2f(i.op.z * .061 + .5, i.op.y * .011)).a * .6 + textureSample(tD, sR, vec2f(i.op.z * .143 + .81, i.op.y * .019)).a * .4;
  let nxz = i.n.x * i.n.x / max(i.n.x * i.n.x + i.n.z * i.n.z, 1e-4);
  let vt = vec4f(0., 0., 0., mix(vwx, vwz, ss(.25, .75, nxz)));
  if (mat <= 1) {
    // sandstone: beds of red, orange, cream and purple-brown, cross-bedding inside each bed, dark desert varnish
    // streaking down the steep faces
    // beds follow height; only a slow, gentle wobble, or gentle slopes turn them into contour-line swirls
    let st = i.op.y * .42 + 1.5 * sin(i.op.y * .13 + 2.) + .5 * sin(i.op.y * .31 + 1.) + big * .18;
    let bed = hs(floor(st)); let sf = fract(st);
    var sc = mix(vec3f(.58, .27, .15), vec3f(.74, .45, .25), ss(.2, .45, bed));
    sc = mix(sc, vec3f(.80, .66, .48), ss(.62, .8, bed));
    sc = mix(sc, vec3f(.44, .26, .23), ss(.88, .95, bed));
    alb = sc * (.78 + .3 * B.c) * (.95 + .06 * sin(sf * 9. + A.c * 2.));
    alb *= 1. - .35 * ss(.1, .0, sf) * (1. - abs(on.y));
    let steep = 1. - ss(.35, .75, abs(n0.y));
    let varn = ss(.5, .72, vt.a + big2 * .3) * steep;
    alb = mix(alb, vec3f(.12, .08, .07) * (.7 + .5 * C.c), varn * .7);
    bump = .5;
    alb = mix(alb, alb * vec3f(1.08, .98, .9) + vec3f(.03, .02, .01), ss(.4, .7, C.c) * .3);
    alb *= mix(1., .7 + .6 * F.h, fk);
    if (mat == 0) {
      // sand on everything that faces up: warm, a little darker and redder on the steep slip faces, wind ripples
      // across it near the eye, single grains catching the sun
      // (not on the mesa tops, which stay bare rock with a little red sand)
      let sand = max(ss(.62, .86, n0.y) * mix(.3, 1., ss(-29., -37., i.wp.y)), dsea(i.wp.xz) * ss(.2, .45, n0.y));
      var sa = mix(vec3f(.72, .46, .26), vec3f(.80, .56, .34), big * .6 + .2) * (.95 + .1 * A.c);
      sa = mix(sa, sa * vec3f(.92, .82, .74), ss(.95, .8, n0.y));
      let gv = ss(.35, .7, gm.a) * (1. - ss(.9, .97, n0.y) * .3);
      sa = mix(sa, mix(vec3f(.36, .24, .16), vec3f(.55, .40, .28), C.h) * (.6 + .6 * F.h), gv * .85);
      let rp = dot(i.wp.xz, WIND) * 8.5 + big * 22. + A.h * 3.;
      let rw = ss(28., 4., dist) * sand * (1. - gv);
      rip = vec3f(WIND.x, 0., WIND.y) * cos(rp) * .45 * rw;
      sa *= 1. - .08 * rw * (.5 + .5 * sin(rp));
      let gh = hs(dot(floor(i.wp * 45.), vec3f(1., 57., 113.)));
      spark = step(.993, gh) * ss(10., 1., dist) * sand;
      alb = mix(alb, sa, sand); sandK = sand * (1. - gv);
      // salt flat: white crust in polygons with raised, darker cracks
      let sf2 = gm.b * flt;
      if (sf2 > .01) {
        let cp = i.wp.xz * .8; let ci = floor(cp); var f1 = 9.; var f2 = 9.;
        for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
          let o = vec2f(f32(x), f32(y)); let r = o + fract(sin(vec2f(dot(ci + o, vec2f(127.1, 311.7)), dot(ci + o, vec2f(269.5, 183.3)))) * 43758.5) * .9 - fract(cp);
          let dd = dot(r, r); if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
        } }
        let ck = 1. - ss(.0, .06, sqrt(f2) - sqrt(f1));
        alb = mix(alb, mix(vec3f(.92, .90, .86) * (.85 + .15 * B.h), vec3f(.55, .50, .46), ck), sf2);
        spark = max(spark, step(.996, gh) * ss(14., 1., dist) * sf2);
      }
      // a green flush where the wildflowers grow
      alb = mix(alb, alb * vec3f(.82, .95, .7), ss(.3, .7, gm.r) * sand * .5);
    }
  } else if (mat == 2) {
    // bleached bone with brown seams
    alb = mix(vec3f(.70, .64, .53), vec3f(.36, .28, .20), ss(.45, .65, sk.a * .6 + sk2.b * .5)) * (.7 + .3 * B.h);
    gloss = .3; bump = .6; flu = .1;
  } else if (mat == 3) {
    // carved stone, worn smooth by sand: pale ochre, darker in the hollows
    alb = mix(vec3f(.78, .62, .44), vec3f(.62, .46, .32), ss(.4, .7, B.c)) * (.7 + .4 * B.h) * (1. - .3 * (1. - i.ao));
    alb = mix(alb, vec3f(.2, .14, .1), ss(.6, .78, sk.a + big2 * .3) * (1. - abs(n0.y)) * .4);
    bump = .9; gloss = .12;
  } else if (mat == 4) {
    // barrel and organ-pipe cacti: green, paler where the ribs stand out, a crown of yellow spines and flowers
    let hue = fract(sd * 7.31);
    alb = mix(vec3f(.17, .30, .14), vec3f(.26, .33, .17), hue) * (.6 + .6 * B.h) * (.55 + .45 * i.ao);
    let spn = ss(.62, .82, sk2.a) * ss(.3, .9, i.ao);
    alb = mix(alb, vec3f(.75, .55, .30), spn * .6);
    alb = mix(alb, mix(vec3f(.95, .78, .2), vec3f(.85, .25, .2), step(.5, hue)), ss(.93, .99, i.ao) * ss(.6, .9, n0.y));
    gloss = .35; bump = .9; flu = .15;
  } else {
    // dry brush: grey-brown twigs, paler toward the tips
    let hue = fract(sd * 5.73);
    alb = mix(vec3f(.30, .24, .19), vec3f(.55, .50, .44), i.ao * i.ao) * (.6 + .5 * B.h) * mix(.8, 1.1, hue);
    gloss = .1; bump = 1.;
  }
  let N = normalize(qrot(i.q, normalize(on + (A.n * .85 + B.n * .65 + C.n * .45 * ss(60., 12., dist) + F.n * .5 * fk) * bump * (1. - .85 * sandK) + rip)));
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
  c += E * spark * ndl * 6. * pow(sat(dot(N, H)), 4.);
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
fn hh3(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn wor3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let r = o + hh3(i + o) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
// parts: 0 cactus skin (e.w: 1 on a rib crest), 1 flowers and fruit, 2 bark, 3 dead wood, 4 cactus pads
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let part = i32(i.e.x * 255. + .5); let u = i.e.z; let h = i.k.x; let crest = i.e.w;
  var n = normalize(i.n); if (!ff) { n = -n; }
  let V = normalize(g.cam.xyz - i.wp); let L = g.sun.xyz; let dist = length(i.wp - g.cam.xyz);
  let tx = textureSample(tD, sR, i.op.xz * .9 + i.op.y * .13 + h * 7.);
  let tx2 = textureSample(tD, sR, vec2f((i.op.x + i.op.z) * 2.6, i.op.y * .3) + h * 3.);
  let ar = wor3(i.op * 6.5);
  var alb = vec3f(0.); var tr = 0.; var gloss = .15; var spec = 1.;
  switch part {
    case 0 { // waxy green skin, pale ribs, rows of spine clusters along the crests, darker grooves
      alb = mix(vec3f(.16, .30, .15), vec3f(.24, .36, .26), fract(h * 3.1)) * mix(.62, 1.08, crest) * (.8 + .3 * tx.a);
      alb = mix(alb, alb * vec3f(1.15, 1.05, .8), ss(.75, 1., u) * .5);
      let sp = ss(.85, 1., crest) * (1. - ss(.1, .2, ar)) * ss(25., 6., dist);
      alb = mix(alb, vec3f(.85, .78, .62), sp * .85);
      alb *= mix(.55, 1., ss(0., .12, u));
      gloss = .45; tr = .1;
    }
    case 1 { // flowers: cream, magenta or yellow
      let fh = fract(h * 3.7);
      alb = select(select(vec3f(.95, .88, .70), vec3f(.85, .22, .45), fh > .45), vec3f(.95, .75, .18), fh > .8) * (.7 + .4 * tx.a);
      tr = .7; gloss = .2;
    }
    case 2 { // living bark: grey-brown fibres with dark furrows
      alb = mix(vec3f(.30, .25, .20), vec3f(.45, .40, .33), tx2.a) * (1. - .55 * ss(.62, .75, tx2.b)) * mix(.9, 1.1, h);
      spec = .3;
    }
    case 3 { // dead wood: silver-grey, twisted grain, sun-bleached
      alb = mix(vec3f(.50, .47, .43), vec3f(.75, .72, .66), tx2.a) * (1. - .35 * ss(.6, .72, tx2.b)) * mix(.85, 1.05, h);
      gloss = .2;
    }
    default { // pads: blue-green with purple edges and rows of spine dots
      alb = mix(vec3f(.22, .36, .22), vec3f(.30, .40, .30), fract(h * 5.3)) * (.75 + .3 * tx.a);
      alb = mix(alb, vec3f(.40, .24, .36), ss(.15, .0, min(u, 1. - u)) * .5);
      alb = mix(alb, vec3f(.85, .80, .62), (1. - ss(.08, .16, ar)) * ss(20., 5., dist) * .8);
      gloss = .35; tr = .25;
    }
  }
  let z = zone(i.wp);
  let E = sunE(i.wp.y, z) * shadow4(i.wp + n * .2);
  let vv = vol(i.wp + n);
  let ndl = dot(n, L);
  let aov = i.ao * (.35 + .65 * sat((vv.r - .5) * 6.));
  let am = amb(i.wp, n, vv.g, z) * aov;
  var c = alb * (E * max(ndl, 0.) + am);
  c += alb * tr * (E * pow(sat(dot(-V, L)), 3.) * sat(.4 - ndl) * 1.5 + amb(i.wp, -n, vv.g, z) * aov * .35);
  c += E * pow(sat(dot(n, normalize(V + L))), mix(12., 60., gloss)) * gloss * max(ndl, 0.) * spec;
  c += am * pow(1. - sat(dot(n, V)), 3.) * .2;
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
    case 0 { col = mix(vec3f(.60, .48, .27), vec3f(.48, .40, .24), s1); col = mix(col, vec3f(.40, .30, .18), step(.8, s2)); pr = vec4f(0., .9, 0., 0.); shp = vec2f(.4, .3); wav = 1.2; }
    case 1 { col = vec3f(.10, .11, .035); pr = vec4f(0., .2, 0., 0.); shp = vec2f(.05, .1); wav = .3; fls = .3; }
    case 2 { col = mix(vec3f(.22, .32, .12), vec3f(.30, .36, .16), s1); pr = vec4f(0., 1., .05, 0.); shp = vec2f(.45, .35); wav = 1.5; }
    case 3 { col = mix(vec3f(.22, .34, .31), vec3f(.30, .40, .34), s1); col = mix(col, vec3f(.36, .40, .24), step(.85, s2)); pr = vec4f(0., .4, .05, 0.); shp = vec2f(.25, .9); wav = .05; fls = .15; }
    case 4 { col = mix(vec3f(.46, .39, .30), vec3f(.34, .28, .22), s1); pr = vec4f(0., .5, 0., 0.); shp = vec2f(.3, .7); wav = .1; fls = .2; }
    case 5 { // wildflowers: s1 picks the colour
      col = select(select(select(vec3f(.95, .72, .12), vec3f(.85, .25, .55), s1 > .35), vec3f(.55, .38, .85), s1 > .6), vec3f(.95, .45, .18), s1 > .85);
      pr = vec4f(0., .9, 0., 0.); shp = vec2f(.6, .6); fls = 1.5; }
    case 6 { col = mix(vec3f(.40, .45, .38), vec3f(.50, .52, .44), s1); pr = vec4f(0., .6, 0., 0.); shp = vec2f(.5, .5); wav = .5; }
    default { col = mix(vec3f(.55, .30, .18), vec3f(.62, .42, .24), s1); pr = vec4f(0., .9, 0., 0.); shp = vec2f(.4, .3); wav = 1.2; }
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
// birds: wide circles on a thermal, banked into the turn, a few wingbeats now and then between long glides
@vertex fn vsFish(i: VI) -> VO {
  var o: VO;
  let s = i.b.x; let R = i.a.w; let t = g.cam.w; let dir = sign(i.b.y);
  let ta = t * i.b.y + s * 6.3;
  let P = i.a.xyz + vec3f(R * cos(ta), 1.5 * sin(ta * .7 + s * 9.) + t * .0, R * sin(ta));
  let T = normalize(vec3f(-R * sin(ta), 1.05 * .7 * cos(ta * .7 + s * 9.) * abs(i.b.y), R * cos(ta)) * dir);
  var S = normalize(cross(vec3f(0., 1., 0.), T)); var Up = cross(T, S);
  let bank = -.4 * dir; let S2 = S * cos(bank) + Up * sin(bank); Up = Up * cos(bank) - S * sin(bank); S = S2;
  let env = ss(.55, .95, sin(t * .23 + s * 20.));
  let a = sin(t * 6.5 + s * 30.) * .75 * env + .1;
  var l = i.p * i.b.z;
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
  let az = abs(i.op.z);
  let alb = mix(vec3f(.12, .09, .07), vec3f(.30, .24, .18), ss(.2, .9, az) * .6 + ss(0., -.05, n.y) * .3);
  let E = sunE(i.wp.y, z) * i.lt;
  var c = alb * (E * sat(dot(n, L)) + amb(i.wp, n, vv.g, z) * 1.2) + alb * E * pow(sat(dot(-V, L)), 3.) * ss(.5, .95, az) * 1.5;
  return fin(fog(c, i.wp, z));
}
// tumbleweeds: roll downwind over the ground (height from the ground map), hopping, then fade and start again upwind
fn rotA(v: vec3f, ax: vec3f, a: f32) -> vec3f { return v * cos(a) + cross(ax, v) * sin(a) + ax * dot(ax, v) * (1. - cos(a)); }
@vertex fn vsTumble(i: VI) -> VO {
  var o: VO;
  let r = i.a.w; let t = g.cam.w; let sd = i.b.x; let L = i.b.z;
  let s = fract(t * i.b.y / L + sd) * L;
  let side = vec2f(-WIND.y, WIND.x);
  let c = i.a.xz + WIND * (s - L * .5) + side * sin(s * .13 + sd * 20.) * 3.;
  let gh = textureSampleLevel(tM, sC, c / 384. + .5, 0.).g * 72. - 56.;
  let fade = ss(0., .06, s / L) * ss(1., .94, s / L);
  let P = vec3f(c.x, gh + r * .85 * fade + abs(sin(s * .8 + sd * 7.)) * .45 * r, c.y);
  let ax = normalize(vec3f(WIND.y, 0., -WIND.x)); let ang = -s / r;
  let w = P + rotA(i.p * r * fade, ax, ang);
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = rotA(i.n.xyz, ax, ang); o.op = i.p; o.sd = sd;
  o.lt = shadow1(w);
  return o;
}
@fragment fn fsTumble(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(i.n); if (!ff) { n = -n; }
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  let alb = mix(vec3f(.52, .42, .28), vec3f(.66, .56, .40), fract(i.sd * 7.3)) * (.8 + .4 * hs(dot(i.op, vec3f(3., 5., 7.))));
  let E = sunE(i.wp.y, z) * i.lt;
  let c = alb * (E * (.35 + .65 * sat(dot(n, L))) + amb(i.wp, n, vv.g, z) * 1.2) + alb * E * pow(sat(dot(-V, L)), 3.) * .8;
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
  let tm = select(min(zl * rl, 150.), 0., dp < 1e-6); // open sky: no shafts (they streak)
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
// dust devils: grains spiralling up a column that wanders over the ground and leans downwind; each comes and goes.
// a: centre x, -, centre z, grain size; b: 4 x devil + seed, turn speed, height, radius
@vertex fn vsBub(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let id = floor(b.x / 4.); let sd = fract(b.x);
  let c = a.xz + vec2f(sin(t * .021 + id * 2.1) * 26. + sin(t * .05 + id) * 6., cos(t * .017 + id * 1.3) * 26.);
  let gh = gnd(c);
  let life = fract(t * .07 + sd * 3.7);
  let hh = pow(life, 1.5) * b.z;
  let rad = b.w * (.6 + hh * .13) * (1. + .3 * sin(t * .7 + id));
  let ang = t * b.y * (1.8 - life) + sd * 40.;
  var p = vec3f(c.x + cos(ang) * rad, gh + hh, c.y + sin(ang) * rad);
  p.x += WIND.x * hh * .2; p.z += WIND.y * hh * .2;
  let act = ss(-.3, .4, sin(t * .045 + id * 1.7));
  let d = length(p - g.cam.xyz);
  let s0 = a.w * (1. + hh * .06);
  let sz = max(s0, d * .0013);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz * 4.;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p;
  if (d > 200. || act < .01) { o.cp = vec4f(0., 0., 2., 1.); }
  o.pr = vec4f(act * ss(0., .05, life) * ss(1., .55, life), s0 / sz, sd, d);
  return o;
}
@fragment fn fsBub(i: VO) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  let z = zone(i.wp);
  let fw = pow(max(dot(normalize(i.wp - g.cam.xyz), g.sun.xyz), 0.), 4.);
  var c = (sunE(i.wp.y, z) * shadow1(i.wp) * (.35 + 1.5 * fw) + amb(i.wp, vec3f(0., 1., 0.), 1., z)) * vec3f(.80, .62, .44);
  let T = exp(-od(g.cam.xyz, normalize(i.wp - g.cam.xyz), i.pr.w));
  c = c * T + hazeC(normalize(i.wp - g.cam.xyz), g.sun.xyz, z) * (1. - T);
  let al = (1. - ss(.2, 1., r)) * i.pr.x * i.pr.y * i.pr.y * .3;
  return vec4f(min(c * al, vec3f(8.)), al);
}
@vertex fn vsSnow(@builtin(vertex_index) vi: u32, @location(0) a: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let B = 44.;
  var p = a.xyz * B + vec3f(WIND.x * t * (3. + 5. * a.w), 0., WIND.y * t * (3. + 5. * a.w)) + .3 * vec3f(sin(t * 2.1 + a.x * 60.), 0., cos(t * 1.8 + a.z * 70.));
  p = g.cam.xyz + (fract((p - g.cam.xyz) / B + .5) - .5) * B;
  // most grains skim the ground, a few lift higher
  p.y = gnd(p.xz) + a.y * a.y * a.y * 3.5 + .05 + .15 * sin(t * 3. + a.x * 40.) * a.y;
  let d = length(p - g.cam.xyz);
  let sz = (.012 + .045 * a.w * a.w * a.w);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * max(sz, d * .0011);
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p;
  let fade = ss(B * .5, B * .32, d) * ss(.6, 2.5, d) * min(1., sz / (d * .0011)) * (.4 + .6 * ss(-.3, .5, sin(t * .5 + dot(p.xz, WIND) * .05)));
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
  let c = (sunE(i.wp.y, z) * i.pr.y * (.15 + 1.6 * fw) + amb(i.wp, vec3f(0., 1., 0.), 1., z) * .2) * vec3f(.85, .66, .45);
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
