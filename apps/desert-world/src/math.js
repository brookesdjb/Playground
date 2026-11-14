// ============================================================================
// math + procedural helpers (load-time only unless noted)
// Forked from Abyssal Garden by Maksymilian Dendura (MIT): https://github.com/Noniv/abyssal-garden
// ============================================================================
const { sin, cos, sqrt, min, max, abs, floor, PI, pow, atan2, hypot, exp, round } = Math;
const TAU = PI * 2;
let _seed = 20261110;
const rnd = () => {
  _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rr = (a, b) => a + (b - a) * rnd();
// each generator system starts its own random stream, so the systems stay independent
const rseed = (s) => { _seed = (20261110 + Math.imul(s, 7919)) | 0; };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

const ihash = (x, y, z) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const vnoise = (x, y, z) => {
  const ix = floor(x), iy = floor(y), iz = floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = mix(mix(ihash(ix, iy, iz), ihash(ix + 1, iy, iz), fx), mix(ihash(ix, iy + 1, iz), ihash(ix + 1, iy + 1, iz), fx), fy);
  const b = mix(mix(ihash(ix, iy, iz + 1), ihash(ix + 1, iy, iz + 1), fx), mix(ihash(ix, iy + 1, iz + 1), ihash(ix + 1, iy + 1, iz + 1), fx), fy);
  return mix(a, b, fz);
};
const fbm = (x, y, z, o = 4) => {
  let a = 0.5, s = 0;
  for (let i = 0; i < o; i++) { s += a * vnoise(x, y, z); x = x * 2.03 + 17.1; y = y * 2.03 + 31.7; z = z * 2.03 + 5.3; a *= 0.5; }
  return s / (1 - 2 * a);
};

// quaternion helpers (return plain arrays; load-time only)
const qAxis = (x, y, z, a) => { const l = hypot(x, y, z) || 1, s = sin(a / 2) / l; return [x * s, y * s, z * s, cos(a / 2)]; };
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qRand = () => { const q = [rr(-1, 1), rr(-1, 1), rr(-1, 1), rr(-1, 1)]; const l = hypot(...q) || 1; return q.map((v) => v / l); };
// shortest rotation taking +Y to n
const qFromY = (nx, ny, nz) => {
  if (ny < -0.9999) return [1, 0, 0, 0];
  const q = [nz, 0, -nx, 1 + ny]; const l = hypot(...q); return q.map((v) => v / l);
};

// world grid
const NX = 512, NY = 96, NZ = 512, VS = 0.75, OX = -192, OY = -56, OZ = -192; // y from -56 to +15.25
const CELLS = 16, CELLW = 24; // culling grid over XZ
const NCHUNK = 7; // 3 small + 3 large rock chunk meshes + pebbles

// ---------------------------------------------------------------- naive surface nets
// D: scalar field (>0 inside), dims nx,ny,nz. Returns grid-space positions + triangle indices.
function surfaceNets(D, nx, ny, nz) {
  let pos = new Float32Array(1 << 20), nv = 0;
  let idx = new Uint32Array(1 << 21), ni = 0;
  const sl = nx * ny;
  let cur = new Int32Array(sl), prev = new Int32Array(sl);
  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      let i0 = nx * (y + ny * z);
      for (let x = 0; x < nx - 1; x++, i0++) {
        const d0 = D[i0], d1 = D[i0 + 1], d2 = D[i0 + nx], d3 = D[i0 + nx + 1];
        const d4 = D[i0 + sl], d5 = D[i0 + sl + 1], d6 = D[i0 + sl + nx], d7 = D[i0 + sl + nx + 1];
        const m = (d0 > 0) | ((d1 > 0) << 1) | ((d2 > 0) << 2) | ((d3 > 0) << 3) | ((d4 > 0) << 4) | ((d5 > 0) << 5) | ((d6 > 0) << 6) | ((d7 > 0) << 7);
        if (m === 0 || m === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0, t;
        if ((d0 > 0) !== (d1 > 0)) { t = d0 / (d0 - d1); sx += t; n++; }
        if ((d2 > 0) !== (d3 > 0)) { t = d2 / (d2 - d3); sx += t; sy += 1; n++; }
        if ((d4 > 0) !== (d5 > 0)) { t = d4 / (d4 - d5); sx += t; sz += 1; n++; }
        if ((d6 > 0) !== (d7 > 0)) { t = d6 / (d6 - d7); sx += t; sy += 1; sz += 1; n++; }
        if ((d0 > 0) !== (d2 > 0)) { t = d0 / (d0 - d2); sy += t; n++; }
        if ((d1 > 0) !== (d3 > 0)) { t = d1 / (d1 - d3); sy += t; sx += 1; n++; }
        if ((d4 > 0) !== (d6 > 0)) { t = d4 / (d4 - d6); sy += t; sz += 1; n++; }
        if ((d5 > 0) !== (d7 > 0)) { t = d5 / (d5 - d7); sy += t; sx += 1; sz += 1; n++; }
        if ((d0 > 0) !== (d4 > 0)) { t = d0 / (d0 - d4); sz += t; n++; }
        if ((d1 > 0) !== (d5 > 0)) { t = d1 / (d1 - d5); sz += t; sx += 1; n++; }
        if ((d2 > 0) !== (d6 > 0)) { t = d2 / (d2 - d6); sz += t; sy += 1; n++; }
        if ((d3 > 0) !== (d7 > 0)) { t = d3 / (d3 - d7); sz += t; sx += 1; sy += 1; n++; }
        if (nv * 3 + 3 > pos.length) { const p2 = new Float32Array(pos.length * 2); p2.set(pos); pos = p2; }
        const vi = nv++;
        pos[vi * 3] = x + sx / n; pos[vi * 3 + 1] = y + sy / n; pos[vi * 3 + 2] = z + sz / n;
        const ci = x + nx * y;
        cur[ci] = vi;
        if (ni + 18 > idx.length) { const i2 = new Uint32Array(idx.length * 2); i2.set(idx); idx = i2; }
        const s0 = d0 > 0;
        let a, b, c, d;
        if ((d1 > 0) !== s0 && y > 0 && z > 0) {
          a = vi; b = cur[ci - nx]; c = prev[ci - nx]; d = prev[ci];
          if (s0) { idx[ni++] = a; idx[ni++] = b; idx[ni++] = c; idx[ni++] = a; idx[ni++] = c; idx[ni++] = d; }
          else { idx[ni++] = a; idx[ni++] = c; idx[ni++] = b; idx[ni++] = a; idx[ni++] = d; idx[ni++] = c; }
        }
        if ((d2 > 0) !== s0 && x > 0 && z > 0) {
          a = vi; b = prev[ci]; c = prev[ci - 1]; d = cur[ci - 1];
          if (s0) { idx[ni++] = a; idx[ni++] = b; idx[ni++] = c; idx[ni++] = a; idx[ni++] = c; idx[ni++] = d; }
          else { idx[ni++] = a; idx[ni++] = c; idx[ni++] = b; idx[ni++] = a; idx[ni++] = d; idx[ni++] = c; }
        }
        if ((d4 > 0) !== s0 && x > 0 && y > 0) {
          a = vi; b = cur[ci - 1]; c = cur[ci - 1 - nx]; d = cur[ci - nx];
          if (s0) { idx[ni++] = a; idx[ni++] = b; idx[ni++] = c; idx[ni++] = a; idx[ni++] = c; idx[ni++] = d; }
          else { idx[ni++] = a; idx[ni++] = c; idx[ni++] = b; idx[ni++] = a; idx[ni++] = d; idx[ni++] = c; }
        }
      }
    }
    const tmp = cur; cur = prev; prev = tmp;
  }
  return { pos: pos.subarray(0, nv * 3), idx: idx.subarray(0, ni), nv, ni };
}

// trilinear sampler factory over a scalar grid (grid coords)
const sampler3 = (D, nx, ny, nz) => (x, y, z) => {
  x = clamp(x, 0, nx - 1.001); y = clamp(y, 0, ny - 1.001); z = clamp(z, 0, nz - 1.001);
  const ix = x | 0, iy = y | 0, iz = z | 0, fx = x - ix, fy = y - iy, fz = z - iz;
  const i = ix + nx * (iy + ny * iz), sl = nx * ny;
  const a = mix(mix(D[i], D[i + 1], fx), mix(D[i + nx], D[i + nx + 1], fx), fy);
  const b = mix(mix(D[i + sl], D[i + sl + 1], fx), mix(D[i + sl + nx], D[i + sl + nx + 1], fx), fy);
  return mix(a, b, fz);
};

// ---------------------------------------------------------------- mesh builder (solid vertex format: f32x3 pos, snorm8x4 normal+aux)
class Mesh {
  constructor() { this.p = []; this.i = []; this.aux = []; }
  v(x, y, z, aux = 1) { this.p.push(x, y, z); this.aux.push(aux); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // box-section sweep along a polyline; faces get their own vertices (hard edges)
  sweep(pts, w, h, upFn, caps = true) {
    const rings = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], a = pts[max(k - 1, 0)], b = pts[min(k + 1, pts.length - 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const u0 = upFn ? upFn(p, k) : [0, 1, 0];
      let sx = u0[1] * tz - u0[2] * ty, sy = u0[2] * tx - u0[0] * tz, sz = u0[0] * ty - u0[1] * tx; const sl = hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      const ux = ty * sz - tz * sy, uy = tz * sx - tx * sz, uz = tx * sy - ty * sx;
      const ww = typeof w === 'function' ? w(k) : w, hh = typeof h === 'function' ? h(k) : h;
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([e, f]) => [p[0] + sx * e * ww / 2 + ux * f * hh / 2, p[1] + sy * e * ww / 2 + uy * f * hh / 2, p[2] + sz * e * ww / 2 + uz * f * hh / 2]);
      const r = [];
      for (let s = 0; s < 4; s++) { r.push(this.v(...c[s]), this.v(...c[(s + 1) % 4])); }
      rings.push(r);
      if (caps && (k === 0 || k === pts.length - 1)) {
        const q = c.map((cc) => this.v(...cc));
        if (k === 0) this.quad(q[0], q[1], q[2], q[3]); else this.quad(q[3], q[2], q[1], q[0]);
      }
    }
    for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < 4; s++) {
      const a = rings[k][s * 2], b = rings[k][s * 2 + 1], c = rings[k + 1][s * 2 + 1], d = rings[k + 1][s * 2];
      this.quad(a, d, c, b);
    }
  }
  // round tube along polyline with radius function
  tube(pts, rad, sides = 6, capEnd = true, auxFn = null) {
    const rings = [];
    let ux = 0.31, uy = 0.9, uz = 0.3;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], a = pts[max(k - 1, 0)], b = pts[min(k + 1, pts.length - 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let sx = uy * tz - uz * ty, sy = uz * tx - ux * tz, sz = ux * ty - uy * tx; const sl = hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      ux = ty * sz - tz * sy; uy = tz * sx - tx * sz; uz = tx * sy - ty * sx;
      const r = typeof rad === 'function' ? rad(k) : rad, ring = [];
      for (let s = 0; s < sides; s++) { const an = s / sides * TAU; ring.push(this.v(p[0] + (sx * cos(an) + ux * sin(an)) * r, p[1] + (sy * cos(an) + uy * sin(an)) * r, p[2] + (sz * cos(an) + uz * sin(an)) * r, auxFn ? auxFn(k) : min(1, 0.35 + 0.65 * k / (pts.length - 1)))); }
      rings.push(ring);
    }
    for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides; this.quad(rings[k][s], rings[k][s2], rings[k + 1][s2], rings[k + 1][s]);
    }
    if (capEnd) { const e = pts[pts.length - 1], c = this.v(e[0], e[1], e[2], auxFn ? auxFn(pts.length - 1) : 1); const r = rings[rings.length - 1]; for (let s = 0; s < sides; s++) this.tri(r[s], r[(s + 1) % sides], c); }
  }
  // returns {vb: ArrayBuffer, ib: Uint32Array}; normals area-weighted; aux -> normal.w
  build(nrmFn) {
    const n = this.p.length / 3, P = this.p, I = this.i, N = new Float32Array(n * 3);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
    }
    const vb = new ArrayBuffer(n * 16), f = new Float32Array(vb), s = new Int8Array(vb);
    for (let k = 0; k < n; k++) {
      let nx = N[k * 3], ny = N[k * 3 + 1], nz = N[k * 3 + 2];
      if (nrmFn) { const q = nrmFn(P[k * 3], P[k * 3 + 1], P[k * 3 + 2], nx, ny, nz); nx = q[0]; ny = q[1]; nz = q[2]; }
      const l = hypot(nx, ny, nz) || 1;
      f[k * 4] = P[k * 3]; f[k * 4 + 1] = P[k * 3 + 1]; f[k * 4 + 2] = P[k * 3 + 2];
      s[k * 16 + 12] = round(nx / l * 127); s[k * 16 + 13] = round(ny / l * 127); s[k * 16 + 14] = round(nz / l * 127); s[k * 16 + 15] = round(clamp(this.aux[k], -1, 1) * 127);
    }
    return { vb, ib: new Uint32Array(I), nv: n };
  }
}

// icosphere with shared vertices
function icosphere(sub, fn) {
  const m = new Mesh(), t = (1 + sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => { const l = hypot(...v); return v.map((c) => c / l); });
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < sub; s++) {
    const cache = new Map(), F2 = [];
    const mid = (a, b) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let r = cache.get(key);
      if (r === undefined) { const p = [0, 1, 2].map((k) => V[a][k] + V[b][k]); const l = hypot(...p); V.push(p.map((c) => c / l)); r = V.length - 1; cache.set(key, r); }
      return r;
    };
    for (const [a, b, c] of F) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    F = F2;
  }
  for (const v of V) { const p = fn ? fn(v[0], v[1], v[2]) : v; m.v(p[0], p[1], p[2]); }
  for (const f of F) m.tri(f[0], f[1], f[2]);
  return m;
}

// ---------------------------------------------------------------- fungus meshes
// Vertex format (20 bytes): f32x3 position, snorm8x4 normal + ambient occlusion, unorm8x4 part / hue / u / glow.
// part: 0 stem, 1 cap top, 2 cap underside, 3 gill, 4 stem ring, 5 puffball, 6 bracket top, 7 bracket underside
// u runs 0 -> 1 along the part (stem base -> top, cap centre -> rim, gill root -> edge); glow scales its light.
class SMesh {
  constructor(n = 1 << 14) { this.P = new Float32Array(n * 3); this.A = new Float32Array(n); this.E = new Uint8ClampedArray(n * 4); this.I = new Uint32Array(n * 6); this.nv = 0; this.ni = 0; }
  v(x, y, z, ao, part, hue, u, gl) {
    if (this.nv === this.A.length) {
      const n = this.nv * 2, P = new Float32Array(n * 3), A = new Float32Array(n), E = new Uint8ClampedArray(n * 4);
      P.set(this.P); A.set(this.A); E.set(this.E); this.P = P; this.A = A; this.E = E;
    }
    const k = this.nv++;
    this.P[k * 3] = x; this.P[k * 3 + 1] = y; this.P[k * 3 + 2] = z; this.A[k] = ao;
    this.E[k * 4] = part; this.E[k * 4 + 1] = hue * 255; this.E[k * 4 + 2] = u * 255; this.E[k * 4 + 3] = gl * 255;
    return k;
  }
  tri(a, b, c) {
    if (this.ni + 3 > this.I.length) { const I = new Uint32Array(this.I.length * 2); I.set(this.I); this.I = I; }
    this.I[this.ni++] = a; this.I[this.ni++] = b; this.I[this.ni++] = c;
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  // grid of (rows x cols) vertex ids -> quads; wrap closes the columns into a ring
  grid(G, wrap) {
    for (let r = 0; r < G.length - 1; r++) { const A = G[r], B = G[r + 1], n = A.length; for (let k = 0; k < (wrap ? n : n - 1); k++) { const k2 = (k + 1) % n; this.quad(A[k], B[k], B[k2], A[k2]); } }
  }
  // area-weighted normals; returns { vb, ib, nv }
  build() {
    const n = this.nv, P = this.P, I = this.I, N = new Float32Array(n * 3);
    for (let t = 0; t < this.ni; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      N[a] += nx; N[a + 1] += ny; N[a + 2] += nz; N[b] += nx; N[b + 1] += ny; N[b + 2] += nz; N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
    }
    const vb = new ArrayBuffer(n * 20), f = new Float32Array(vb), s8 = new Int8Array(vb), u8 = new Uint8Array(vb);
    for (let k = 0; k < n; k++) {
      const nx = N[k * 3], ny = N[k * 3 + 1], nz = N[k * 3 + 2], l = hypot(nx, ny, nz) || 1, o = k * 20;
      f[k * 5] = P[k * 3]; f[k * 5 + 1] = P[k * 3 + 1]; f[k * 5 + 2] = P[k * 3 + 2];
      s8[o + 12] = round(nx / l * 127); s8[o + 13] = round(ny / l * 127); s8[o + 14] = round(nz / l * 127); s8[o + 15] = round(clamp(this.A[k], -1, 1) * 127);
      u8[o + 16] = this.E[k * 4]; u8[o + 17] = this.E[k * 4 + 1]; u8[o + 18] = this.E[k * 4 + 2]; u8[o + 19] = this.E[k * 4 + 3];
    }
    return { vb, ib: this.I.slice(0, this.ni), nv: n };
  }
}
const v3 = {
  add: (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  nrm: (a) => { const l = hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
};
// two unit vectors perpendicular to unit n
const basis = (n) => { const t = v3.nrm(abs(n[1]) < 0.95 ? v3.cross(n, [0, 1, 0]) : v3.cross(n, [1, 0, 0])); return [t, v3.cross(n, t)]; };

// Cap shapes: top(s) is the height of the upper surface at radius fraction s, th(s) the flesh thickness below it.
const CAPS = [
  { top: (s) => 0.3 * (1 - pow(s, 2.2)) - 0.07 * pow(s, 6), th: (s) => 0.04 + 0.12 * pow(1 - s, 1.3), gd: 0.1 },  // 0 parasol: broad and flat
  { top: (s) => 0.58 * pow(max(1 - s * s, 0), 0.75) - 0.04 * pow(s, 8), th: (s) => 0.05 + 0.3 * pow(1 - s, 1.2), gd: 0.12 }, // 1 dome
  { top: (s) => 0.95 * pow(1 - s, 1.25) + 0.05 * (1 - s) - 0.1 * pow(s, 5), th: (s) => 0.04 + 0.5 * pow(1 - s, 1.6), gd: 0.16 }, // 2 bell / cone
  { top: (s) => -0.22 * (1 - s * s) + 0.1 * pow(s, 3), th: (s) => 0.04 + 0.08 * (1 - s), gd: 0.07 },                // 3 funnel
];
// One mushroom into SMesh M. Returns the rim (points under the cap edge) and the cap centre, for the world generator.
// o: x y z base, h height, r stem radius, R cap radius, kind (CAPS index), hue, gl gill glow, tg cap glow, sg stem glow,
//    dir stem direction (default up), bend (added along the stem, x t^2), curve (sideways S), bulb (base swelling),
//    ring (stem ring height fraction, 0 none), tilt (how far the cap follows the stem, 0 upright), q detail, seed
function shroom(M, o) {
  const q = o.q || 1, H = o.h, rs = o.r, R = o.R, C = CAPS[o.kind], sd = o.seed || 0, hue = o.hue;
  const dir = o.dir || [0, 1, 0], bend = o.bend || [0, 0, 0], side = basis(dir)[0], cv = o.curve || 0;
  const NS = max(3, round(clamp(H / (rs * 2.4), 3, 22) * q)), SD = max(5, round(clamp(rs * 18, 7, 16) * q));
  const at = (t) => v3.add(v3.add(v3.add([o.x, o.y, o.z], dir, H * t), bend, H * t * t), side, cv * H * sin(t * PI));
  // stem: rings with a frame carried along the centre line; base sunk a little into the ground
  const rings = []; let up = v3.nrm(v3.cross(dir, side));
  let top = null, tan = dir;
  for (let k = 0; k <= NS; k++) {
    const t = k / NS, p = at(max(t, 0) - (k ? 0 : 0.012 * rs / H * 10));
    tan = v3.nrm(v3.add(at(min(t + 0.02, 1)), at(max(t - 0.02, 0)), -1));
    const sx = v3.nrm(v3.cross(up, tan)); up = v3.cross(tan, sx);
    const rr = rs * (1 + (o.bulb || 0) * exp(-t * 7)) * (1 - 0.2 * t) * (1 + 0.32 * sstep(0.86, 1, t));
    const ring = [];
    for (let s = 0; s < SD; s++) {
      const a = s / SD * TAU, n = 1 + 0.09 * (fbm(cos(a) * 1.4 + sd, t * H * 0.18, sin(a) * 1.4, 2) - 0.5) * 2 + 0.025 * sin(a * 7 + t * 9);
      const ca = cos(a) * rr * n, sa = sin(a) * rr * n;
      ring.push(M.v(p[0] + sx[0] * ca + up[0] * sa, p[1] + sx[1] * ca + up[1] * sa, p[2] + sx[2] * ca + up[2] * sa, 0.3 + 0.7 * sstep(0, 0.35, t), 0, hue, t, (o.sg || 0) * (1 - t)));
    }
    rings.push(ring); top = p;
  }
  M.grid(rings, true);
  // stem ring (annulus) hanging off the stem
  if (o.ring) {
    const t = o.ring, p = at(t), rr = rs * (1 - 0.2 * t) * 1.05, G = [];
    const [ax, ay] = basis(v3.nrm(v3.add(at(t + 0.02), at(t - 0.02), -1)));
    for (const [f, dy] of [[1, 0.03], [1.55, -0.06], [2.05, -0.28], [2.25, -0.5]]) {
      const row = [];
      for (let s = 0; s < SD; s++) { const a = s / SD * TAU, w = 1 + 0.08 * sin(a * 5 + sd * 9), x = cos(a) * rr * f * w, y = sin(a) * rr * f * w; row.push(M.v(p[0] + ax[0] * x + ay[0] * y, p[1] + ax[1] * x + ay[1] * y + dy * rs * 2, p[2] + ax[2] * x + ay[2] * y, 0.8, 4, hue, f / 2.3, 0)); }
      G.push(row);
    }
    M.grid(G, true);
  }
  // cap frame: axis between the stem's last direction and straight up
  const A = v3.nrm(v3.add(tan, [0, 1, 0], (1 - (o.tilt === undefined ? 0.3 : o.tilt)) * 3)), [U, V] = basis(A);
  const s0 = min(0.5, rs * 1.25 / R), base = v3.add(top, A, -R * (C.top(s0) - C.th(s0)) + rs * 0.05);
  const SA = max(10, round(clamp(R * 9, 14, 56) * q)), NR = max(4, round(10 * q)), wv = 0.03 + 0.05 * rnd(), nw = 3 + (rnd() * 5 | 0), ph = rnd() * TAU;
  const rim = (a) => R * (1 + wv * sin(nw * a + ph) + 0.12 * (fbm(cos(a) * 1.2 + sd * 3, 7.7, sin(a) * 1.2, 2) - 0.5));
  const cp = (s, a, h) => { const r = rim(a) * s; return v3.add(v3.add(v3.add(base, U, cos(a) * r), V, sin(a) * r), A, h * R); };
  const lump = (s, a) => 0.05 * (fbm(cos(a) * s * 2.5 + sd, sin(a) * s * 2.5, sd * 5, 2) - 0.5) * s;
  // top surface: centre fan + rings out to the rim
  const tc = cp(0, 0, C.top(0)), ci = M.v(tc[0], tc[1], tc[2], 1, 1, hue, 0, o.tg || 0), T = [];
  for (let r = 1; r <= NR; r++) {
    const s = pow(r / NR, 0.85), row = [];
    for (let k = 0; k < SA; k++) { const a = k / SA * TAU, p = cp(s, a, C.top(s) + lump(s, a)); row.push(M.v(p[0], p[1], p[2], 1, 1, hue, s, o.tg || 0)); }
    T.push(row);
  }
  for (let k = 0; k < SA; k++) M.tri(ci, T[0][(k + 1) % SA], T[0][k]);
  M.grid(T, true);
  // underside: from the rim lip in to the stem
  const NU = max(3, round(5 * q)), Ug = [T[NR - 1]];
  for (let r = 0; r <= NU; r++) {
    const s = mix(1, s0, pow(r / NU, 0.8)), row = [];
    for (let k = 0; k < SA; k++) { const a = k / SA * TAU, p = cp(s * (r ? 1 : 0.995), a, C.top(s) - C.th(s) + lump(s, a)); row.push(M.v(p[0], p[1], p[2], 0.25 + 0.5 * s, 2, hue, s, (o.gl || 0) * 0.35)); }
    Ug.push(row);
  }
  M.grid(Ug, true);
  // gills: thin radial fins hanging from the underside, deepest half way out
  const NG = max(14, round(clamp(R * 22, 24, 170) * q)), GS = max(3, round(5 * q));
  for (let gI = 0; gI < NG; gI++) {
    const a = (gI + rr(-0.2, 0.2)) / NG * TAU, short = gI % 2 ? 0.45 : 0, ta = [], tb = [];
    for (let j = 0; j <= GS; j++) {
      const s = mix(mix(s0 * 1.05, 0.98, short), 0.98, j / GS), f = (s - s0) / (1 - s0), d = C.gd * pow(max(sin(PI * min(f * 1.15, 1)), 0), 0.6) * (0.7 + 0.3 * f);
      const h = C.top(s) - C.th(s) + lump(s, a) - 0.004, p0 = cp(s, a, h), p1 = cp(s, a, h - d);
      ta.push(M.v(p0[0], p0[1], p0[2], 0.35, 3, hue, s, (o.gl || 0) * 0.5)); tb.push(M.v(p1[0], p1[1], p1[2], 0.8, 3, hue, s, o.gl || 0));
    }
    M.grid([ta, tb], false);
  }
  const rimPts = [];
  for (let k = 0; k < 24; k++) { const a = (k + rnd()) / 24 * TAU; rimPts.push(cp(0.96, a, C.top(0.96) - C.th(0.96) - 0.01)); }
  return { rim: rimPts, top: cp(0, 0, C.top(0)), under: cp(0, 0, C.top(s0) - C.th(s0)), axis: A, R, base };
}
// puffball / spore sac: a lumpy, flattened sphere on a short neck; centre at x y z (bottom at y)
function puff(M, x, y, z, r, hue, gl, q = 1, sd = 0) {
  const SA = max(8, round(16 * q)), NR = max(5, round(10 * q)), G = [];
  const bot = M.v(x, y - r * 0.05, z, 0.3, 5, hue, 0, gl * 0.2);
  for (let i = 1; i < NR; i++) {
    const ph = i / NR * PI, row = [];
    for (let k = 0; k < SA; k++) {
      const a = k / SA * TAU, n = 1 + 0.14 * (fbm(cos(a) * 1.5 + sd, ph * 1.3, sin(a) * 1.5, 2) - 0.5), rr = r * sin(ph) * n * (1 + 0.12 * sin(ph));
      row.push(M.v(x + cos(a) * rr, y + r * 0.82 * (1 - cos(ph)) * n, z + sin(a) * rr, 0.35 + 0.65 * (1 - cos(ph)) / 2, 5, hue, i / NR, gl));
    }
    G.push(row);
  }
  const tp = M.v(x, y + r * 1.66, z, 1, 5, hue, 1, gl);
  for (let k = 0; k < SA; k++) M.tri(bot, G[0][k], G[0][(k + 1) % SA]);
  M.grid(G, true);
  const L = G[G.length - 1]; for (let k = 0; k < SA; k++) M.tri(tp, L[(k + 1) % SA], L[k]);
}
// bracket (shelf) fungus: tiers of half discs sticking out of a wall along `out` (horizontal unit vector)
function shelf(M, x, y, z, out, R, hue, gl, tiers = 1, q = 1, sd = 0) {
  const sideV = [-out[2], 0, out[0]], SA = max(8, round(clamp(R * 14, 10, 24) * q)), NR = max(3, round(5 * q));
  for (let t = 0; t < tiers; t++) {
    const r0 = R * (1 - 0.18 * t) * rr(0.85, 1.1), yy = y - t * R * 0.42, sh = rr(-0.25, 0.25) * R, cx = x + sideV[0] * sh, cz = z + sideV[2] * sh;
    const pt = (s, a, h) => { const w = r0 * s * (1 + 0.07 * sin(a * 9 + sd * 7 + t)), c = cos(a), sn = sin(a); return [cx + (out[0] * c + sideV[0] * sn) * w - out[0] * r0 * 0.12, yy + h, cz + (out[2] * c + sideV[2] * sn) * w - out[2] * r0 * 0.12]; };
    const G = [], B = [];
    for (let i = 0; i <= NR; i++) {
      const s = 0.05 + 0.95 * i / NR, row = [], row2 = [];
      for (let k = 0; k <= SA; k++) {
        const a = (k / SA - 0.5) * 2.9, p = pt(s, a, r0 * (0.2 * (1 - pow(s, 1.6)) + 0.03 * sin(s * 14 + a * 2))), p2 = pt(s * 0.985, a, -r0 * 0.05 * (1 - s));
        row.push(M.v(p[0], p[1], p[2], 0.5 + 0.5 * s, 6, hue, s, gl * 0.25)); row2.push(M.v(p2[0], p2[1], p2[2], 0.3 + 0.4 * s, 7, hue, s, gl));
      }
      G.push(row); B.unshift(row2);
    }
    M.grid(G, false); M.grid(B, false);
    const e0 = G[NR], e1 = B[0]; for (let k = 0; k < SA; k++) M.quad(e0[k], e0[k + 1], e1[k + 1], e1[k]);
  }
}

// ---------------------------------------------------------------- desert plants (same 20-byte vertex format as the fungi)
// part: 0 cactus skin, 1 flowers and fruit, 2 living bark, 3 bleached dead wood, 4 cactus pads
// e.w ("glow" for the fungi) carries the rib crest here: 1 on a rib, 0 in the groove between ribs
const DPART = { skin: 0, flower: 1, bark: 2, dead: 3, pad: 4 };
// a ribbed (ribs > 0) or round tube along pts, radius rad(t), with a rounded tip; the base is left open (in the ground)
function ribTube(M, pts, rad, ribs, part, hue, q, ao0 = 0.35, tip = true) {
  const SD = max(7, round(max(ribs * 2, clamp(rad(0) * 30, 7, 14)) * q)), rk = min(ribs, floor(SD / 2)), amp = ribs ? 0.1 : 0.04;
  const d0 = v3.nrm(v3.add(pts[1], pts[0], -1)); let up = basis(d0)[1], tan = d0;
  const G = [], ring = (p, r, u, ao) => {
    const sx = v3.nrm(v3.cross(up, tan)), row = []; up = v3.cross(tan, sx);
    for (let s = 0; s < SD; s++) {
      const a = s / SD * TAU, cr = 0.5 + 0.5 * cos(rk * a), rr0 = r * (1 + amp * (cr - 0.5) * 2 + (ribs ? 0 : 0.05 * sin(a * 3 + u * 7)));
      const ca = cos(a) * rr0, sa = sin(a) * rr0;
      row.push(M.v(p[0] + sx[0] * ca + up[0] * sa, p[1] + sx[1] * ca + up[1] * sa, p[2] + sx[2] * ca + up[2] * sa, ao, part, hue, u, ribs ? cr : 0.5));
    }
    G.push(row);
  };
  for (let k = 0; k < pts.length; k++) {
    const t = k / (pts.length - 1);
    tan = v3.nrm(v3.add(pts[min(k + 1, pts.length - 1)], pts[max(k - 1, 0)], -1));
    ring(pts[k], rad(t), t, mix(ao0, 1, sstep(0, 0.3, t)));
  }
  if (tip) {
    const E = pts[pts.length - 1], r1 = rad(1);
    for (let j = 1; j <= 2; j++) { const f = j / 3; ring(v3.add(E, tan, r1 * f), r1 * sqrt(1 - f * f), 1, 1); }
    const a = v3.add(E, tan, r1), ai = M.v(a[0], a[1], a[2], 1, part, hue, 1, 0.5), L = G[G.length - 1];
    for (let s = 0; s < SD; s++) M.tri(L[s], L[(s + 1) % SD], ai);
  }
  M.grid(G, true);
}
// small ellipsoid: centre c, half-axes along unit vectors ax (a), ay (b), az (c)
function blob(M, c, ax, ay, az, a, b, cc, part, hue, q = 1) {
  const SA = max(6, round(10 * q)), NR = max(3, round(6 * q)), G = [];
  const p = (th, ph) => { const x = sin(th) * cos(ph) * a, y = cos(th) * b, z = sin(th) * sin(ph) * cc; return [c[0] + ax[0] * x + ay[0] * y + az[0] * z, c[1] + ax[1] * x + ay[1] * y + az[1] * z, c[2] + ax[2] * x + ay[2] * y + az[2] * z]; };
  const t0 = p(0, 0), b0 = p(PI, 0), ti = M.v(t0[0], t0[1], t0[2], 1, part, hue, 1, 0.5), bi = M.v(b0[0], b0[1], b0[2], 0.6, part, hue, 0, 0.5);
  for (let i = 1; i < NR; i++) { const row = []; for (let k = 0; k < SA; k++) { const v = p(i / NR * PI, k / SA * TAU); row.push(M.v(v[0], v[1], v[2], 0.6 + 0.4 * (1 - i / NR), part, hue, 1 - i / NR, 0.5)); } G.push(row); }
  for (let k = 0; k < SA; k++) { M.tri(ti, G[0][(k + 1) % SA], G[0][k]); M.tri(bi, G[NR - 2][k], G[NR - 2][(k + 1) % SA]); }
  M.grid(G, true);
}
// columnar cactus with arms that turn upward; returns the trunk radius for collision
function saguaro(M, o) {
  const q = o.q || 1, H = o.h, r = o.r, hue = o.hue, lx = o.lean ? cos(o.la) * o.lean : 0, lz = o.lean ? sin(o.la) * o.lean : 0;
  const n = max(4, round(clamp(H / 0.55, 6, 22) * q)), pts = [];
  for (let k = 0; k <= n; k++) { const t = k / n; pts.push([o.x + lx * H * t * t, o.y - 0.3 + (H + 0.3) * t, o.z + lz * H * t * t]); }
  ribTube(M, pts, (t) => r * (1 + 0.12 * exp(-t * 14)) * (1 - 0.1 * t), o.ribs || 18, 0, hue, q);
  const tops = [pts[n]];
  for (let i = 0; i < (o.arms || 0); i++) {
    const t0 = rr(0.3, 0.62), a = rnd() * TAU, out = [cos(a), 0, sin(a)], c = pts[round(t0 * n)], L1 = rr(0.35, 1.1) * (r / 0.4), L2 = rr(1.2, min(3.6, H * (1 - t0) * 0.9));
    const s0 = v3.add(c, out, r * 0.5), ap = [];
    for (let j = 0; j <= 8; j++) { const s = j / 8; ap.push(v3.add(v3.add(s0, out, L1 * sin(s * PI / 2) + r * 0.3 * s), [0, 1, 0], L2 * (1 - cos(s * PI / 2)) + 0.25 * s)); }
    ribTube(M, ap, (t) => r * 0.72 * (1 - 0.08 * t), o.ribs || 18, 0, hue, q * 0.8, 0.8);
    tops.push(ap[8]);
  }
  if (o.flowers) for (const tp of tops) for (let k = 3 + rnd() * 4 | 0; k > 0; k--) {
    const a = rnd() * TAU, d = r * rr(0.2, 0.6), c = [tp[0] + cos(a) * d, tp[1] + r * 0.75, tp[2] + sin(a) * d];
    blob(M, c, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.07, 0.06, 0.07, 1, o.fh, q * 0.6);
  }
}
// branching tree: trunk forking into limbs that curve upward; returns the branch tips (with direction) for leaf rosettes.
// dead: bleached, twisting, no rosettes
function branchTree(M, o) {
  const q = o.q || 1, tips = [], part = o.dead ? 3 : 2;
  const grow = (p, d, len, r, depth) => {
    const n = max(3, round(clamp(len / 0.4, 3, 8) * q)), pts = [p]; let dd = d;
    for (let k = 1; k <= n; k++) {
      dd = v3.nrm(v3.add(v3.add(dd, [rr(-0.15, 0.15), rr(-0.05, 0.1) + (o.dead ? 0 : 0.06), rr(-0.15, 0.15)]), [0, 1, 0], o.dead ? 0.02 : 0.08));
      pts.push(v3.add(pts[k - 1], dd, len / n));
    }
    ribTube(M, pts, (t) => r * (1 - 0.3 * t) * (1 + (depth === o.depth ? 0.25 * exp(-t * 10) : 0)), 0, part, o.hue, q * 0.8, 0.5, depth === 0);
    const e = pts[n];
    if (depth === 0) { tips.push({ p: e, d: dd }); return; }
    const nb = 2 + (rnd() < (o.dead ? 0.5 : 0.35));
    for (let i = 0; i < nb; i++) {
      const a = rnd() * TAU, s = o.dead ? rr(0.5, 1.1) : rr(0.35, 0.8);
      grow(e, v3.nrm(v3.add(dd, [cos(a) * s, o.dead ? rr(-0.2, 0.4) : rr(0.1, 0.5), sin(a) * s])), len * rr(0.62, 0.85), r * 0.68, depth - 1);
    }
  };
  grow([o.x, o.y - 0.3, o.z], v3.nrm([rr(-0.08, 0.08), 1, rr(-0.08, 0.08)]), o.h * 0.42, o.r, o.depth);
  return tips;
}
// prickly pear: flat oval pads growing from the edges of other pads
function pear(M, n, hue, fh, q) {
  const pads = [{ c: [0, 0.33, 0], u: [0, 1, 0], s: 1 }];
  const make = (pd) => {
    const yaw = rnd() * TAU, ax = [cos(yaw), 0, sin(yaw)], az = v3.nrm(v3.cross(ax, pd.u)), up = v3.nrm(v3.cross(az, ax));
    blob(M, pd.c, ax, pd.u, az, 0.26 * pd.s, 0.33 * pd.s, 0.045 * pd.s, 4, hue, q);
    if (rnd() < 0.35) for (let k = 1 + rnd() * 3 | 0; k > 0; k--) { const a = rr(-1.2, 1.2), c = v3.add(v3.add(pd.c, pd.u, cos(a) * 0.33 * pd.s), ax, sin(a) * 0.26 * pd.s); blob(M, c, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.06, 0.05, 1, fh, q * 0.5); }
    return { ax, up };
  };
  for (let i = 0; i < n; i++) {
    const pd = pads[i < pads.length ? i : pads.length - 1], f = make(pd);
    if (pads.length < n) for (let k = 0; k < 2 && pads.length < n; k++) {
      const a = rr(-1, 1), u = v3.nrm(v3.add(v3.add(pd.u, f.ax, a * 0.9), [0, 1, 0], 0.2)), s = pd.s * rr(0.8, 1);
      pads.push({ c: v3.add(v3.add(pd.c, pd.u, cos(a) * 0.3 * pd.s), v3.add(f.ax, u, 0), sin(a) * 0.22 * pd.s + 0.0).map((v, j) => v + u[j] * 0.3 * s), u, s });
    }
  }
}
// the shared small desert meshes (instanced; see NSV in world.js): their hue comes from each instance
function smallDesert() {
  const q = LV > 1 ? 0.45 : LV ? 0.6 : 0.8, V = [];
  const one = (f) => { rseed(400 + V.length); const M = new SMesh(); f(M); V.push(M.build()); };
  one((M) => pear(M, 5, 0, 0.9, q));
  one((M) => pear(M, 12, 0, 0.9, q));
  one((M) => { for (let i = 0; i < 6; i++) { const a = rnd() * TAU, d = i ? rr(0.15, 0.35) : 0, h = rr(0.18, 0.38), r = rr(0.12, 0.2); saguaro(M, { x: cos(a) * d, y: 0.2, z: sin(a) * d, h, r, hue: 0, ribs: 14, q, flowers: rnd() < 0.5, fh: 0.9 }); } });
  one((M) => { for (let i = 0; i < 3; i++) { const a = rnd() * TAU, d = i ? rr(0.2, 0.4) : 0; saguaro(M, { x: cos(a) * d, y: 0, z: sin(a) * d, h: rr(0.6, 1.5), r: rr(0.09, 0.15), hue: 0, ribs: 12, q, lean: rr(0, 0.15), la: a }); } });
  one((M) => branchTree(M, { x: 0, y: 0.3, z: 0, h: 1.6, r: 0.06, depth: 3, hue: 0, q: q * 0.7 }));
  one((M) => branchTree(M, { x: 0, y: 0.3, z: 0, h: 1.4, r: 0.05, depth: 3, dead: 1, hue: 0, q: q * 0.7 }));
  return V;
}
