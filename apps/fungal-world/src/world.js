// ============================================================================
// world layout + procedural content generation (load-time only)
// The rock layout, viewpoints and camera path come from Abyssal Garden (MIT); the fungi, light and life are new.
// ============================================================================

// designed rock masses: ax, az, bx, bz, radius, top, overhang, waist
const MESAS = [
  [-37, -42, -33, -22, 9, -7, 3.5, 2], [-29, -15, -33, 5, 12, -14, 3, 2], [-36, 11, -30, 27, 9, -5, 4, 2],   // west wall of the main canyon
  [30, -45, 35, -27, 9, -9, 4, 2], [37, -20, 31, -3, 11, -16, 3, 2], [32, 5, 35, 9, 7, -8, 4, 2],          // east wall
  [19, -15, 19, -15, 4.4, -6, 2, 1.5],   // pillar with window
  [6, -88, 6, -88, 10, -34, 0, 0],       // mound under the Elder
  [0, -106, 0, -106, 8, -12, 2, 2],      // pillar under the Elder's cap
  [44, 6, 47, -8, 7, -17, 3, 1],         // ship supports
  [33, 29, 37, 12, 9, -19, -6.5, 0],     // sloped sunlit wall beside the wreck
  [74, 14, 74, 14, 8, -15, 3, 1],
  [-84, -34, -80, -12, 10, -7, 6, 2], [-78, -6, -83, 12, 12, -13, 5, 2], [-82, 18, -79, 32, 9, -8, 6, 2],   // sponge canyon west wall
  [-17, 62, -19, 78, 10, -6, 9, 3], [-21, 84, -18, 100, 11, -9, 8, 3],     // grotto overhang cliff
  [22, 67, 24, 80, 7, -11, 6, 2],        // grotto coral rock
  [-16, 122, 34, 122, 9, -27, 3, 2],     // grotto far wall
];
// vertical ring arches: cx, cy, cz, yaw, major radius, minor radius, y squash
const ARCHES = [
  [-23, -9.5, -16, 0.3, 4.2, 1.4, 1.2],
  [0, -45, -34, 1.57, 14, 2.7, 1.2],
  [-40, -45, 44, 1.57, 10, 2.2, 1.3],
];
// carved tunnels: ax, ay, az, radius, bx, by, bz
const HOLES = [
  [19, -21, -23, 2.5, 19, -21, -7],
  [9, -37, 108, 4.2, 9, -34, 136],
];
// regions kept free of random mesas: ax, az, bx, bz, radius, softness
const CLEARS = [
  [0, -45, 0, 35, 22, 10], [0, -86, 0, -86, 46, 12], [42, 24, 74, 6, 22, 10], [72, -26, 72, -26, 26, 10],
  [-60, -36, -60, 36, 13, 8], [-60, 42, -18, 46, 12, 8], [4, 58, 8, 100, 24, 10], [-34, -74, -56, -46, 11, 8],
];
const PURPLE = [6, 84];
// moth swarms (x, -, z, radius, count x 7, size, -, seed): they hover a few metres above the ground and gliders (x, y, z, R, phase, speed, size, seed)
const SCH = [[-2, -36, -10, 15, 520, 0.3, 1, 0.945], [8, -30, -70, 22, 420, 0.32, -1], [48, -30, 14, 18, 360, 0.3, 1], [-58, -30, -8, 11, 420, 0.28, -1, 0.3], [8, -36, 84, 16, 320, 0.28, 1],
  [-90, -28, -70, 25, 300, 0.3, 1], [95, -30, 70, 25, 300, 0.3, -1], [0, -22, 20, 30, 380, 0.34, -1], [-30, -30, -100, 18, 300, 0.3, 1], [16, -36, 30, 12, 300, 0.3, 1], [-48, -34, -58, 12, 300, 0.3, -1], [-45, -35, 38, 14, 320, 0.3, 1]];
// gliders soar high over the canopy and rarely beat their wings
const GLIDERS = [[0, -2, -60, 40, 0.3, 0.05, 5.6, 0.7], [-50, -4, 20, 34, 5, -0.055, 4.4, 0.55], [20, 0, -10, 52, 4.2, -0.04, 6, 0.25]];
// fungus palettes (see pal() in W_FUNGI): 0 crimson, 1 teal, 2 violet, 3 amber, 4 ghost, 5 indigo.
// PALW: how much of each palette's light goes to the magenta glow channel (the rest is teal); PALG: spore glint colour
const PALW = [1, 0, 0.95, 0.75, 0.15, 0.05], PALG = [0.9, 0.7, 0.9, 0.15, 0.45, 0.7];
const hueOf = (pal) => (pal + rr(0.12, 0.88)) / 6;
// small mushroom meshes (smallShrooms): 0-1 domes, 2 parasol, 3-4 bells, 5 funnel, 6-7 clusters, 8-9 puffballs,
// 10-11 brackets, 12 lanterns, 13 glow stalks
const NSV = 14;
const zoneP = (x, z) => sstep(44, 26, hypot(x - PURPLE[0], z - PURPLE[1]));
const MAGENTA = [[14, 6, 13], [-4, 20, 9], [6, 84, 30], [-58, 8, 10], [50, 30, 12], [8, -70, 10], [-12, -98, 9], [-36, 44, 9], [-46, -60, 9], [24, 42, 8], [-56, 26, 9], [-44, 38, 8], [-10, 44, 8], [12, 24, 8], [-50, -45, 8]];
const magAt = (x, z) => {
  let m = sstep(0.54, 0.66, fbm(x * 0.03, 7, z * 0.03, 3)) * 0.9;
  for (const p of MAGENTA) m = max(m, sstep(p[2], p[2] * 0.45, hypot(x - p[0], z - p[1])));
  return m * sstep(0.3, 0.55, fbm(x * 0.17, 1, z * 0.17, 2) + m * 0.25);
};

function primBuffer() {
  const a = [];
  for (const m of MESAS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  for (const m of ARCHES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of HOLES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of CLEARS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], 0, 0);
  return new Float32Array(a);
}

// ---------------------------------------------------------------- terrain mesh from the density grid
function buildTerrain(D) {
  const sn = surfaceNets(D, NX, NY, NZ), nv = sn.nv, gp = sn.pos;
  const smp = sampler3(D, NX, NY, NZ);
  const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
  const wp = new Float32Array(nv * 3), wn = new Float32Array(nv * 3);
  for (let k = 0; k < nv; k++) {
    const x = gp[k * 3], y = gp[k * 3 + 1], z = gp[k * 3 + 2], e = 0.8;
    let nx = smp(x - e, y, z) - smp(x + e, y, z), ny = smp(x, y - e, z) - smp(x, y + e, z), nz = smp(x, y, z - e) - smp(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const X = OX + x * VS, Y = OY + y * VS, Z = OZ + z * VS;
    wp[k * 3] = vf[k * 4] = X; wp[k * 3 + 1] = vf[k * 4 + 1] = Y; wp[k * 3 + 2] = vf[k * 4 + 2] = Z;
    wn[k * 3] = nx; wn[k * 3 + 1] = ny; wn[k * 3 + 2] = nz;
    v8[k * 16 + 12] = round(nx * 127); v8[k * 16 + 13] = round(ny * 127); v8[k * 16 + 14] = round(nz * 127); v8[k * 16 + 15] = 127;
  }
  // bucket quads into the XZ culling grid
  const nq = sn.ni / 6, key = new Uint8Array(nq), cnt = new Uint32Array(CELLS * CELLS + 1);
  const lo = new Float32Array(CELLS * CELLS).fill(1e9), hi = new Float32Array(CELLS * CELLS).fill(-1e9);
  for (let q = 0; q < nq; q++) {
    const a = sn.idx[q * 6] * 3;
    const c = clamp(floor((wp[a] - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((wp[a + 2] - OZ) / CELLW), 0, CELLS - 1);
    key[q] = c; cnt[c + 1]++;
    for (let j = 0; j < 6; j++) { const y = wp[sn.idx[q * 6 + j] * 3 + 1]; if (y < lo[c]) lo[c] = y; if (y > hi[c]) hi[c] = y; }
  }
  for (let c = 0; c < CELLS * CELLS; c++) cnt[c + 1] += cnt[c];
  const ib = new Uint32Array(sn.ni), fill = cnt.slice();
  for (let q = 0; q < nq; q++) { const o = fill[key[q]]++ * 6; for (let j = 0; j < 6; j++) ib[o + j] = sn.idx[q * 6 + j]; }
  return { vb, ib, nv, wp, wn, smp, start: cnt, lo, hi };
}

// ---------------------------------------------------------------- instance stores
function makeWorld(D, T, flyPts, POSES) {
  const gi = (x, y, z) => x + NX * (y + NY * z);
  const smp = T.smp;
  const Dw = (x, y, z) => smp((x - OX) / VS, (y - OY) / VS, (z - OZ) / VS);
  const nCells = CELLS * CELLS;
  const cellOf = (x, z) => clamp(floor((x - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((z - OZ) / CELLW), 0, CELLS - 1);
  const big = Array.from({ length: nCells }, () => []), small = Array.from({ length: nCells }, () => []);
  // Medium and Low keep every 2nd / 4th leaf (but every kelp stem), made wider; the random stream is the same
  let nth = 0;
  const leaf = (L, x, y, z, len, yaw, tilt, wid, hA, type, s1, s2, bend) => { if (type === 1 || !(nth++ % THIN)) L[cellOf(x, z)].push(x, y, z, len, yaw, tilt, type === 1 ? wid : wid * (1 + LV / 2), hA, type, s1, s2, bend); };
  const glint = (...a) => { nth++ % THIN || glints.push(...a); };
  const solids = []; // per mesh id: arrays of 12 floats
  const props = Array.from({ length: 6 }, () => Array.from({ length: nCells }, () => []));
  const solid = (mesh, x, y, z, sc, q, mat, seed, ts = 1, bob = 0) => { (mesh > 3 && mesh < 10 ? props[mesh - 4][cellOf(x, z)] : (solids[mesh] ||= [])).push(x, y, z, sc, q[0], q[1], q[2], q[3], mat, seed, ts, bob); };
  const chunks = Array.from({ length: NCHUNK }, () => Array.from({ length: nCells }, () => []));
  const glints = [];
  const rel = (i, f, r) => { const p = POSES[i]; let fx = p[3] - p[0], fz = p[5] - p[2]; const l = hypot(fx, fz); fx /= l; fz /= l; return [p[0] + fx * f - fz * r, p[2] + fz * f + fx * r]; };
  const capAbs = new Float32Array((NX / 2) * (NY / 2) * (NZ / 2));

  // --- surface queries
  const fl = [];
  const floorsAt = (x, z) => {
    const ix = clamp(round((x - OX) / VS), 1, NX - 2), iz = clamp(round((z - OZ) / VS), 1, NZ - 2);
    fl.length = 0; let ceil = 15;
    for (let gy = NY - 2; gy >= 0; gy--) {
      const d = D[gi(ix, gy, iz)], da = D[gi(ix, gy + 1, iz)];
      if (da <= 0 && d > 0) { const y = OY + (gy + d / (d - da)) * VS; fl.push(y, min(ceil, 12) - y); } else if (da > 0 && d <= 0) ceil = OY + (gy + 0.5) * VS;
    }
    return fl;
  };
  const grad = (x, y, z) => {
    const e = 0.6; let nx = Dw(x - e, y, z) - Dw(x + e, y, z), ny = Dw(x, y - e, z) - Dw(x, y + e, z), nz = Dw(x, y, z - e) - Dw(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
  };
  // march from outside along -n to the surface
  const snap = (x, y, z, n) => {
    let px = x + n[0] * 2.5, py = y + n[1] * 2.5, pz = z + n[2] * 2.5, prev = Dw(px, py, pz);
    if (prev > 0) return null;
    for (let i = 0; i < 24; i++) {
      const qx = px - n[0] * 0.25, qy = py - n[1] * 0.25, qz = pz - n[2] * 0.25, d = Dw(qx, qy, qz);
      if (d > 0) { const t = prev / (prev - d); const p = [mix(px, qx, t), mix(py, qy, t), mix(pz, qz, t)]; return p.concat(grad(p[0], p[1], p[2])); }
      px = qx; py = qy; pz = qz; prev = d;
    }
    return null;
  };
  const pickV = () => ((rnd() * T.nv) | 0) * 3;
  const tangent = (n) => { let t = abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [1, 0, 0]; const l = hypot(...t); t = t.map((v) => v / l); return [t, [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]]; };
  const nearFly = (x, y, z, r) => { for (const p of flyPts) if (hypot(x - p[0], z - p[2]) < r && y < p[1] + 3 && y > p[1] - 13) return true; return false; };
  const nearPose = (x, z, r = 3) => { for (const p of POSES) if (hypot(x - p[0], z - p[2]) < r) return true; return false; };
  // --- light bookkeeping: glow from the fungi (two colour channels) and how much sky each cap hides
  const glowA = new Float32Array(capAbs.length), glowB = new Float32Array(capAbs.length);
  // adds glow energy e at a point; warm: share that goes to the magenta channel. Returns nothing (usable in conditions)
  const splat = (x, y, z, e, warm) => {
    const ix = round((x - OX) / VS / 2), iy = round((y - OY) / VS / 2), iz = round((z - OZ) / VS / 2);
    if (ix < 1 || iy < 0 || iz < 1 || ix >= NX / 2 - 1 || iy >= NY / 2 || iz >= NZ / 2 - 1) return;
    const i = ix + NX / 2 * (iy + NY / 2 * iz); glowA[i] += e * (1 - warm); glowB[i] += e * warm;
  };
  const capShade = (cx, cy, cz, R) => {
    const hx = NX / 2, hy = NY / 2, iy = floor((cy - OY) / VS / 2), r = R / VS / 2, x0 = (cx - OX) / VS / 2, z0 = (cz - OZ) / VS / 2;
    if (iy < 0 || iy >= hy) return;
    for (let z = floor(z0 - r); z <= z0 + r; z++) for (let x = floor(x0 - r); x <= x0 + r; x++) {
      if (x < 1 || z < 1 || x >= hx - 1 || z >= NZ / 2 - 1) continue;
      const d = hypot(x - x0, z - z0) / r; if (d < 1) capAbs[x + hx * (iy + hy * z)] += 0.9 * sstep(1, 0.7, d);
    }
  };
  const motes = [], veins = [];

  // --- mushroom forests: where the giants grow
  const FOREST = [[-32, -5, 13, 0.85], [0, -86, 46, 1], [72, -26, 27, 0.9], [-60, -4, 11, 0.8], [0, -36, 12, 0.55], [-17, -8, 6, 0.8], [15, -8, 6, 0.8], [-4, 120, 20, 0.4], [-45, -63, 15, 0.9], [62, -26, 12, 0.9], [-100, 70, 30, 0.8], [100, 60, 30, 0.8], [-95, -90, 32, 0.8], [105, -85, 30, 0.7], [6, 84, 34, 0.7], [-60, 40, 18, 0.6]];
  const NOGROW = [[-5, -106.5, 8], [4.6, -109.4, 10], [14.2, -112.3, 12], [-26, -100, 6], [-20.5, -101.7, 4.5], [-14.8, -104.5, 6], [-7.5, -107.8, 7], [4, 112, 11], [0, -12, 12], [42, 22, 12], [6, 78, 12], [-58, -16, 8], [9, -66, 9], [8, -76, 8]];
  const forest = (x, z) => {
    for (const p of NOGROW) if (hypot(x - p[0], z - p[1]) < p[2]) return 0;
    let d = sstep(0.52, 0.64, fbm(x * 0.022, 4, z * 0.022, 3)) * 0.5;
    for (const p of FOREST) d = max(d, p[3] * sstep(p[2], p[2] * 0.75, hypot(x - p[0], z - p[1])));
    return d;
  };
  // palette by place: the grotto is violet and crimson, elsewhere broad patches of teal, ghost and indigo, with amber
  const palAt = (x, z) => {
    const r = rnd();
    if (zoneP(x, z) > 0.5) return r < 0.55 ? 2 : r < 0.85 ? 0 : 5;
    const h = fbm(x * 0.012, 3, z * 0.012, 2);
    return r < 0.6 ? (h < 0.47 ? 1 : h < 0.52 ? 4 : 5) : r < 0.75 ? 3 : r < 0.88 ? 2 : 0;
  };

  // --- giant mushrooms: one-off meshes, sorted into the culling grid like the terrain (list nCells: always drawn)
  const SM = new SMesh(1 << 20), gTri = Array.from({ length: nCells + 1 }, () => []), gLo = new Float32Array(nCells).fill(1e9), gHi = new Float32Array(nCells).fill(-1e9);
  const giants = [], GQ = LV > 1 ? 0.5 : LV ? 0.75 : 1;
  const addTris = (i0, x, z, ylo, yhi, always) => {
    if (always) { gTri[nCells].push(i0, SM.ni); return; }
    const c = cellOf(x, z); gTri[c].push(i0, SM.ni); gLo[c] = min(gLo[c], ylo); gHi[c] = max(gHi[c], yhi);
  };
  // camera path, viewpoints and creature orbits stay clear of caps; caps don't cut into each other or other stems
  const avoid = [];
  for (const s of SCH) for (let k = 0; k < 24; k++) { const a = k / 24 * TAU; avoid.push([s[0] + cos(a) * s[3], s[1], s[2] + sin(a) * s[3] * 0.6, 5]); }
  for (const m of GLIDERS) for (let k = 0; k < 24; k++) { const a = k / 24 * TAU; avoid.push([m[0] + cos(a) * m[3], m[1], m[2] + sin(a) * m[3] * 0.75, m[6] + 3]); }
  const capOK = (cx, cy, cz, R, ch) => {
    for (const p of flyPts) if (hypot(cx - p[0], cz - p[2]) < R + 3 && p[1] > cy - ch - 4 && p[1] < cy + ch + 3) return false;
    for (const p of avoid) if (hypot(cx - p[0], cz - p[2]) < R + p[3] && abs(p[1] - cy) < ch + p[3]) return false;
    for (const g of giants) {
      const d = hypot(cx - g.cx, cz - g.cz);
      if (d < (R + g.R) * 0.95 && abs(cy - g.cy) < (ch + g.ch) * 1.25 + 1.5) return false;
      if (hypot(cx - g.x, cz - g.z) < R + g.r && g.cy > cy - ch - 1) return false; // over another's stem
    }
    return true;
  };
  const stemOK = (x, y, z, r, cy) => {
    for (const p of flyPts) if (hypot(x - p[0], z - p[2]) < r + 3.2) return false;
    for (const g of giants) { const d = hypot(x - g.x, z - g.z); if (d < r + g.r + 1.5 || (hypot(x - g.cx, z - g.cz) < g.R + r && cy > g.cy - g.ch - 1 && y < g.cy)) return false; }
    return !nearPose(x, z, r + 2.5);
  };
  // the rim threads, falling spores and glints of one mushroom
  const dress = (g, res, threads) => {
    const pal = g.pal, warm = PALW[pal];
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; splat(g.cx + cos(a) * g.R * 0.55, res.under[1] - 1.2, g.cz + sin(a) * g.R * 0.55, g.gl * g.R * g.R * 0.02, warm); }
    capShade(g.cx, g.cy, g.cz, g.R);
    veins.push([g.x, g.z, g.R * 2 + 3]);
    if (threads) for (const p of res.rim) {
      if (rnd() > threads) continue;
      for (let j = 1 + rnd() * 3 | 0; j > 0; j--) leaf(big, p[0] + rr(-0.2, 0.2), p[1] + 0.05, p[2] + rr(-0.2, 0.2), rr(1, min(2 + g.H * 0.35, 14)), rnd() * TAU, PI - rr(0, 0.06), rr(0.025, 0.06), 0, 6, rnd(), (pal + 0.5) / 6, 0.3);
    }
    const drop = res.under[1] - g.y - 0.4;
    for (let n = round(g.R * g.R * 0.45 * (LV ? 0.5 : 1)); n > 0; n--) {
      const a = rnd() * TAU, r = sqrt(rnd()) * g.R * 0.85;
      motes.push(g.cx + cos(a) * r, res.under[1] - g.R * 0.08, g.cz + sin(a) * r, rr(0.025, 0.06), pal + rnd() * 0.99, rr(0.25, 0.6), -drop * rr(0.6, 1), rr(0.1, 0.4));
    }
    for (let n = round(g.R * g.R * 0.35); n > 0; n--) {
      const a = rnd() * TAU, r = sqrt(rnd()) * g.R * 0.9;
      glint(g.cx + cos(a) * r, res.under[1] - rr(0.3, 0.45 * drop), g.cz + sin(a) * r, 0, rnd(), PALG[pal] + rr(-0.06, 0.06), rr(0.02, 0.05), 0);
    }
  };
  // a giant on the floor below (x, z); o: h, R, r, kind, pal, sc (height scale), force, room (ignore headroom), always
  const giant = (x, z, o = {}) => {
    const f = floorsAt(x, z), c = [];
    for (let i = 0; i < f.length; i += 2) if (o.room || f[i + 1] > 10) c.push(i);
    if (!c.length) return null;
    const i = o.room ? c[0] : c[(rnd() * c.length) | 0], y = f[i];
    if (grad(x, y, z)[1] < 0.6) return null;
    const kind = o.kind ?? (zoneP(x, z) > 0.5 ? [2, 3, 1][rnd() * 3 | 0] : [0, 0, 1, 1, 2, 3][rnd() * 6 | 0]);
    let H = o.h ?? rr(9, 32) * (o.sc || 1);
    if (!o.room) H = min(H, f[i + 1] - 3);
    if (H < 5) return null;
    const R = o.R ?? H * rr(0.24, 0.42) * (kind === 2 ? 0.65 : 1), r = o.r ?? R * rr(0.08, 0.12) + 0.15, ch = R * (kind === 2 ? 0.9 : kind === 1 ? 0.55 : 0.35);
    const lean = o.lean ?? rr(0, 0.1), la = rnd() * TAU, lx = cos(la) * lean, lz = sin(la) * lean, cx = x + lx * H, cz = z + lz * H, cy = y + H;
    if (!o.room && !stemOK(x, y, z, r, cy)) return null;
    if (!capOK(cx, cy, cz, R, ch)) return null;
    const pal = o.pal ?? palAt(x, z), hue = hueOf(pal), gl = o.gl ?? rr(0.55, 1), i0 = SM.ni;
    const res = shroom(SM, { x, y: y - 0.25, z, h: H, r, R, kind, hue, gl, tg: o.tg ?? rr(0, 0.35), sg: 0.3, bend: [lx, 0, lz], curve: rr(-0.04, 0.04), bulb: rr(0.25, 0.75),
      ring: kind === 0 && rnd() < 0.6 ? rr(0.62, 0.8) : 0, tilt: rr(0.15, 0.4), q: GQ, seed: rnd() * 50 });
    addTris(i0, cx, cz, y - 1, cy + ch, o.always);
    const g = { x, y, z, cx, cy, cz, R, r, H, ch, pal, hue, gl, lx, lz, top: res.top[1] };
    giants.push(g);
    dress(g, res, H > 10 ? (o.threads ?? (zoneP(x, z) > 0.4 ? 0.6 : 0.3)) : 0);
    // brackets climbing the stem
    if (H > 14 && rnd() < 0.55) for (let n = 1 + rnd() * (H / 7) | 0; n > 0; n--) {
      const t = rr(0.12, 0.6), a = rnd() * TAU, out = [cos(a), 0, sin(a)], rad = r * (1 - 0.2 * t) * 0.95, j0 = SM.ni;
      shelf(SM, x + lx * H * t * t + out[0] * rad, y + H * t, z + lz * H * t * t + out[2] * rad, out, rr(0.4, 0.5 + r * 0.8), hueOf(rnd() < 0.5 ? 3 : 4), rr(0.4, 1), 1 + rnd() * 3 | 0, GQ * 0.7, rnd() * 9);
      addTris(j0, x, z, y, y + H, o.always);
    }
    // a ring of smaller ones round its foot
    for (let n = rnd() * 4 | 0; n > 0; n--) {
      const a = rnd() * TAU, d = rr(r * 2.2, r * 2.2 + R * 0.5), mx = x + cos(a) * d, mz = z + sin(a) * d, fy = floorsAt(mx, mz);
      if (!fy.length) continue;
      const my = fy[fy.length - 2], mh = rr(1.2, 4.5), mR = mh * rr(0.25, 0.45);
      if (abs(my - y) > 2.5 || !stemOK(mx, my, mz, 0.3, my + mh) || nearFly(mx, my, mz, mR + 2)) continue;
      const j0 = SM.ni, mk = rnd() * 4 | 0;
      shroom(SM, { x: mx, y: my - 0.1, z: mz, h: mh, r: mR * 0.12 + 0.05, R: mR, kind: mk, hue: hueOf(rnd() < 0.7 ? pal : palAt(mx, mz)), gl: rr(0.5, 1), tg: rr(0, 0.4), sg: 0.3,
        bend: [cos(a) * rr(0, 0.25), 0, sin(a) * rr(0, 0.25)], bulb: rr(0.2, 0.6), q: GQ * 0.55, seed: rnd() * 50 });
      addTris(j0, mx, mz, my - 1, my + mh + mR, o.always);
      splat(mx, my + mh * 0.7, mz, mR * mR * 0.05, PALW[pal]);
    }
    return g;
  };
  rseed(1);
  // the Elder: a colossal parasol on the mound in the southern basin, its cap above everything else
  giant(6, -88, { h: 47, R: 24, r: 3.3, kind: 0, pal: 1, gl: 1, tg: 0.2, lean: 0.015, room: 1, always: 1, threads: 0.95 });
  // hand-placed giants framing the viewpoints (from the original kelp layout): x, z, kind, scale
  for (const p of [[...rel(0, 11, -8.5), 0], [...rel(0, 16, -10.5), 1], [...rel(0, 21, -9), 0], [...rel(0, 9, 7), 2], [...rel(0, 14, 9.5), 0], [...rel(0, 19, 8), 1], [...rel(0, 26, 6), 0],
    [...rel(5, 6.5, 5.2), 2], [...rel(5, 12, 7), 3], [...rel(5, 15, -8), 0], [...rel(5, 22, -5), 2], [...rel(3, 12, -5.5), 1], [...rel(3, 16, 5.5), 0], [...rel(3, 20, -4.5), 0], [...rel(3, 25, 6), 1], [...rel(3, 13, 8), 3], [...rel(3, 30, -7), 0], [24, 62, 2], [-6, 96, 3], [20, 96, 2], [-10, 70, 1], [16, 52, 2],
    [...rel(4, 15, -9), 0, 1.2], [...rel(4, 19, -13), 1, 1.2], [...rel(4, 23, -8.5), 0, 1.2], [...rel(4, 25, -15), 3, 1.2],
    [...rel(2, 6.5, -5.5), 0, 1.3], [...rel(2, 9.5, -8), 1, 1.2], [...rel(2, 8, 6), 0, 1.3], [...rel(2, 12, 3.6), 3, 1.2], [...rel(2, 17, -2.5), 0, 1.2], [...rel(2, 21, 4), 1, 1.2], [...rel(2, 27, -9), 0, 1.2], [...rel(2, 30, 8.5), 2, 1.2], [...rel(2, 37, -3), 0, 1.1]]) {
    for (let k = 0; k < 4 && !giant(p[0], p[1], { kind: p[2], h: rr(16, 30) * (p[3] || 1) * pow(0.8, k) }); k++);
  }
  // the rest at random, densest in the forests
  rseed(2);
  const occ = new Set();
  for (let i = 0; i < 16000; i++) {
    const a = rnd() * TAU, rad = sqrt(rnd()) * 168, x = cos(a) * rad, z = sin(a) * rad, key = floor(x / 3) * 4096 + floor(z / 3);
    if (occ.has(key) || rnd() > forest(x, z) * 0.75) continue;
    if (giant(x, z, { sc: 0.5 + 0.7 * forest(x, z) })) occ.add(key);
  }
  // mid-sized mushrooms between the giants
  rseed(16);
  for (let i = 0; i < 9000; i++) {
    const a = rnd() * TAU, rad = sqrt(rnd()) * 166, x = cos(a) * rad, z = sin(a) * rad, fd = forest(x, z);
    if (rnd() > 0.15 + fd * 0.8) continue;
    const f = floorsAt(x, z); if (!f.length) continue;
    const y = f[f.length - 2], h = rr(1.5, 6) * (0.6 + fd * 0.6), R = h * rr(0.22, 0.45), r = R * 0.11 + 0.06;
    if (f[f.length - 1] < h + 2 || grad(x, y, z)[1] < 0.65 || !stemOK(x, y, z, r, y + h) || nearFly(x, y + h, z, R + 2) || !capOK(x, y + h, z, R, R * 0.4)) continue;
    const pal = palAt(x, z), i0 = SM.ni, kind = rnd() * 4 | 0;
    const bx = rr(-0.15, 0.15), bz = rr(-0.15, 0.15);
    const res = shroom(SM, { x, y: y - 0.1, z, h, r, R, kind, hue: hueOf(pal), gl: rr(0.5, 1), tg: rr(0, 0.4), sg: 0.3, bend: [bx, 0, bz], curve: rr(-0.05, 0.05), bulb: rr(0.2, 0.6), q: GQ * 0.6, seed: rnd() * 50 });
    addTris(i0, x, z, y - 1, y + h + R);
    splat(x, res.under[1] - 0.8, z, R * R * 0.05, PALW[pal]);
    giants.push({ x, y, z, cx: x + bx * h, cy: y + h, cz: z + bz * h, R, r, H: h, ch: R * 0.4, pal, lx: bx, lz: bz, top: res.top[1] });
  }
  // glowing fungus in the ground: a web around each giant's foot plus patches (ground map g channel)
  const veinG = new Float32Array(512 * 512);
  for (const v of veins) {
    const c0 = (v[0] + 192) / 0.75, r0 = (v[1] + 192) / 0.75, rad = v[2] / 0.75;
    for (let j = max(0, floor(r0 - rad)); j <= min(511, r0 + rad); j++) for (let i = max(0, floor(c0 - rad)); i <= min(511, c0 + rad); i++) {
      const d = hypot(i - c0, j - r0) / rad; if (d < 1) veinG[i + 512 * j] = max(veinG[i + 512 * j], sstep(1, 0.25, d));
    }
  }
  const packShrooms = () => {
    let n = 0; const start = new Uint32Array(nCells + 2);
    for (let c = 0; c <= nCells; c++) { start[c] = n; let k = 0; for (let j = 0; j < gTri[c].length; j += 2) k += gTri[c][j + 1] - gTri[c][j]; n += Math.ceil(k / 6); }
    start[nCells + 1] = n;
    const ib = new Uint32Array(n * 6), I = SM.I;
    for (let c = 0; c <= nCells; c++) {
      let o = start[c] * 6; const L = gTri[c];
      for (let j = 0; j < L.length; j += 2) { ib.set(I.subarray(L[j], L[j + 1]), o); o += L[j + 1] - L[j]; }
      while (o < start[c + 1] * 6) { ib[o] = ib[o - 1]; o++; } // pad with a degenerate triangle
    }
    const m = SM.build();
    return { vb: m.vb, nv: m.nv, ib, start, lo: gLo, hi: gHi };
  };

  // --- clusters of ribbon leaves on the ground
  const cluster = (x, y, z, n, type, lmin, lmax, wmin, wmax, tmax, sway) => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, r = rnd() * 0.5, L = rr(lmin, lmax);
      leaf(big, x + cos(a) * r, y - 0.15, z + sin(a) * r, L, a, rr(0.05, tmax), rr(wmin, wmax), sway, type, rnd(), rnd(), rr(0.3, 0.8));
    }
  };
  const HOT = [[0, 5, 30], [42, 30, 24], [6, 82, 34], [-58, 10, 24], [4, -88, 30], [-36, 44, 18], [-46, -60, 20]];
  const hot = (x, z) => { let h = 0.4; for (const p of HOT) h = max(h, sstep(p[2], p[2] * 0.4, hypot(x - p[0], z - p[1]))); return h; };
  rseed(3);
  for (let i = 0; i < 40000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    if (hypot(x, z) > 172 || y > -6) continue;
    const h = hot(x, z), zp = zoneP(x, z), u = rnd();
    if (nearFly(x, y, z, 4) || hypot(x + 1, z - 2) < 9 || nearPose(x, z, 8)) continue;
    if (ny > 0.75 && u < 0.10 * h) cluster(x, y, z, 8 + rnd() * 14 | 0, 2, 1.0, 3.0, 0.13, 0.26, 0.6, 2.5);
    else if (ny > 0.6 && u < 0.10 * h + 0.07 * max(zp, h * 0.4)) cluster(x, y, z, 10 + rnd() * 18 | 0, rnd() < 0.8 ? 3 : 4, 0.9, 2.6, 0.14, 0.28, 0.9, 1.5);
    else if (ny < -0.35 && u < 0.5 * max(zp, 0.2)) { // hanging fronds
      const n = 12 + rnd() * 20 | 0;
      for (let j = 0; j < n; j++) leaf(big, x + rr(-0.6, 0.6), y + 0.2, z + rr(-0.6, 0.6), rr(0.8, 3.6), rnd() * TAU, PI - rr(0, 0.3), rr(0.03, 0.07), 0, 6, rnd(), rnd(), rr(0.3, 0.5));
    } else if (ny > -0.2 && ny < 0.8 && u < 0.07) { // wall tufts
      const yaw = atan2(T.wn[k + 2], T.wn[k]), n = 5 + rnd() * 7 | 0;
      for (let j = 0; j < n; j++) leaf(big, x, y, z, rr(0.5, 1.4), yaw + rr(-0.9, 0.9), rr(0.3, 1.1), rr(0.06, 0.12), 0.5, zp > 0.4 && rnd() < 0.6 ? 3 : 7, rnd(), rnd(), rr(0.2, 0.6));
    }
  }
  // --- ground cover: dense carpets of small tufts in the magenta patches
  rseed(4);
  for (const p of MAGENTA) for (let i = p[2] * p[2] * PI * 45; i > 0; i--) {
    const a = rnd() * TAU, r = sqrt(rnd()) * p[2], x = p[0] + cos(a) * r, z = p[1] + sin(a) * r;
    if (rnd() > magAt(x, z) + 0.12 || nearPose(x, z)) continue;
    const f = floorsAt(x, z); if (!f.length) continue;
    const y = f[f.length - 2]; if (grad(x, y, z)[1] < 0.7) continue;
    const nl = 2 + (rnd() * 3 | 0), yw = rnd() * TAU;
    for (let j = 0; j < nl; j++) leaf(small, x, y - 0.03, z, rr(0.08, 0.26), yw + j * TAU / nl + rr(-0.4, 0.4), rr(0.15, 0.85), rr(0.035, 0.07), 0, 5, rnd(), rnd(), rr(0.3, 0.7));
    splat(x, y + 0.8, z, 0.05, zoneP(x, z) > 0.4 ? 1 : 0.15);
    if (rnd() < 0.3) for (let j = 0; j < 2; j++) leaf(small, x + rr(-0.2, 0.2), y - 0.04, z + rr(-0.2, 0.2), rr(0.2, 0.55), rnd() * TAU, rr(0.05, 0.6), rr(0.03, 0.06), 0, 7, rnd(), rnd(), rr(0.3, 0.8));
    if (rnd() < 0.3) glint(x, y + rr(0.08, 0.22), z, 0, rnd(), 0.82 + rnd() * 0.18, rr(0.01, 0.02), 0);
  }
  rseed(5);
  for (let i = 0; i < 620000; i++) {
    const k = pickV(), ny = T.wn[k + 1];
    if (ny < 0.72) continue;
    const x = T.wp[k] + rr(-0.45, 0.45), z = T.wp[k + 2] + rr(-0.45, 0.45), y = T.wp[k + 1];
    if (hypot(x, z) > 170 || nearPose(x, z)) continue;
    const m = magAt(x, z), zp = zoneP(x, z), u = rnd();
    if (m > 0.3 && u < m * 0.9 && !(splat(x, y + 0.8, z, 0.012, zp > 0.4 ? 1 : 0.15))) for (let j = 0; j < 4; j++) leaf(small, x + rr(-0.1, 0.1), y - 0.05, z + rr(-0.1, 0.1), rr(0.12, 0.34), rnd() * TAU, rr(0.05, 0.75), rr(0.04, 0.08), 0, 5, rnd(), rnd(), rr(0.3, 0.7));
    else if (u < m * 0.9 + 0.5 * max(zp, hot(x, z)) * sstep(0.42, 0.6, fbm(x * 0.09, 9, z * 0.09, 2))) for (let j = 0; j < 3; j++) leaf(small, x + rr(-0.1, 0.1), y - 0.05, z + rr(-0.1, 0.1), rr(0.25, 0.7), rnd() * TAU, rr(0.1, 0.8), rr(0.05, 0.1), 0, 7, rnd(), rnd(), rr(0.3, 0.8));
  }

  // --- sponges and coral (clustered on rock)
  const spots = [];
  const ZS = [[-58, 8, 30, 1], [0, 0, 30, 0.7], [6, 84, 36, 0.9], [4, -88, 22, 0.6], [44, 20, 24, 0.5]];
  const zw = (x, z) => { let h = 0.45; for (const p of ZS) h = max(h, p[3] * sstep(p[2], p[2] * 0.4, hypot(x - p[0], z - p[1]))); return h; };
  rseed(6);
  for (let i = 0; i < 13000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
    if (hypot(x, z) > 170 || y > -8 || T.wn[k + 1] < -0.15 || rnd() > zw(x, z) || nearFly(x, y, z, 3)) continue;
    const n0 = [T.wn[k], T.wn[k + 1], T.wn[k + 2]], [t1, t2] = tangent(n0), coral = T.wn[k + 1] > 0.85 || rnd() < 0.35, cnt = coral ? 2 + rnd() * 5 | 0 : 3 + rnd() * 9 | 0, sd = rnd();
    for (let j = 0; j < cnt; j++) {
      const a = rr(-1, 1) * (0.5 + cnt * 0.13), b = rr(-1, 1) * (0.5 + cnt * 0.13);
      const s = snap(x + t1[0] * a + t2[0] * b, y + t1[1] * a + t2[1] * b, z + t1[2] * a + t2[2] * b, n0);
      if (!s) continue;
      let ux = s[3], uy = s[4] + (coral ? 0.9 : 1.1), uz = s[5]; const l = hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
      const q = qMul(qFromY(ux, uy, uz), qAxis(0, 1, 0, rnd() * TAU)), sc = coral ? rr(0.5, 1.5) : rr(0.35, 0.9) * (rnd() < 0.1 ? 1.6 : 1);
      solid(coral ? 7 + (rnd() * 3 | 0) : 4 + (rnd() * 3 | 0), s[0] - ux * 0.12 * sc, s[1] - uy * 0.12 * sc, s[2] - uz * 0.12 * sc, sc, q, coral ? 5 : 4, fract(sd + rr(-0.03, 0.03)), 1, 0);
    }
    if (!coral && rnd() < 0.3) spots.push([x + n0[0], y + n0[1] + 0.5, z + n0[2]]);
  }

  // dense sponge / coral gardens: x, z, radius, count
  rseed(7);
  for (const g of [[-68, -6, 9, 260], [-66, 6, 7, 160], [16, 72, 7, 200], [-6, 74, 6, 120], [-13, -2, 6, 80], [8, -88, 8, 160], [44, 12, 7, 120], [-62, 22, 6, 140], [-47, 40, 6, 140], [-30, 47, 6, 120], [-12, 48, 5, 100], [14, 28, 6, 140], [28, 45, 6, 120], [-36, -76, 6, 130], [-49, -58, 6, 130], [-58, -38, 6, 120]]) {
    let made = 0;
    for (let i = 0; i < 400000 && made < g[3]; i++) {
      const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
      if (hypot(x - g[0], z - g[1]) > g[2] || y > -14 || T.wn[k + 1] < -0.1 || nearFly(x, y, z, 2.2)) continue;
      made++;
      const coral = T.wn[k + 1] > 0.85 || rnd() < 0.3, nx = T.wn[k], ny = T.wn[k + 1] + (coral ? 0.9 : 1.1), nz = T.wn[k + 2], l = hypot(nx, ny, nz);
      const sc = coral ? rr(0.5, 1.4) : rr(0.35, 0.9) * (rnd() < 0.15 ? 1.7 : 1);
      solid(coral ? 7 + (rnd() * 3 | 0) : 4 + (rnd() * 3 | 0), x - nx / l * 0.1 * sc, y - ny / l * 0.1 * sc, z - nz / l * 0.1 * sc, sc, qMul(qFromY(nx / l, ny / l, nz / l), qAxis(0, 1, 0, rnd() * TAU)), coral ? 5 : 4, rnd(), 1, 0);
    }
  }
  // --- small mushrooms, puffballs, brackets and lanterns: instances of the shared meshes from smallShrooms()
  // instance: x y z, scale, quaternion, 1 (hue from the instance), hue, glow scale, 0
  const sprops = Array.from({ length: NSV }, () => Array.from({ length: nCells }, () => []));
  const sm = (v, x, y, z, sc, q, hue, gl) => sprops[v][cellOf(x, z)].push(x, y, z, sc, q[0], q[1], q[2], q[3], 1, hue, gl, 0);
  const FAM = { grotto: [3, 4, 12, 13, 6, 3, 12], forest: [0, 1, 2, 6, 7, 5, 8, 0, 6], open: [8, 9, 0, 6, 13, 1] };
  rseed(15);
  for (let i = 0; i < 30000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], n0 = [T.wn[k], T.wn[k + 1], T.wn[k + 2]];
    if (hypot(x, z) > 168 || y > -4 || nearFly(x, y, z, 2.4) || nearPose(x, z, 2.5)) continue;
    const zp = zoneP(x, z), fd = forest(x, z);
    if (rnd() > 0.14 + 0.55 * fd + 0.45 * zp + 0.25 * hot(x, z)) continue;
    if (n0[1] > 0.6) { // a cluster on the floor
      const fam = zp > 0.5 ? FAM.grotto : fd > 0.3 ? FAM.forest : FAM.open, v0 = fam[rnd() * fam.length | 0], pal = palAt(x, z), h0 = hueOf(pal);
      const n = v0 === 6 || v0 === 7 ? 1 + rnd() * 2 | 0 : 2 + rnd() * 7 | 0, [t1, t2] = tangent(n0), spread = 0.35 + n * 0.12;
      for (let j = 0; j < n; j++) {
        const a = rr(-1, 1) * spread, b = rr(-1, 1) * spread;
        const s = snap(x + t1[0] * a + t2[0] * b, y + t1[1] * a + t2[1] * b, z + t1[2] * a + t2[2] * b, n0);
        if (!s) continue;
        const up = v3.nrm([s[3] * 0.35, 1, s[5] * 0.35]), sc = rr(0.2, 0.5) * (j ? 1 : 1.5) * (v0 > 7 ? 0.8 : 1);
        const v = rnd() < 0.7 ? v0 : fam[rnd() * fam.length | 0];
        sm(v, s[0], s[1] - 0.03 * sc, s[2], sc, qMul(qFromY(up[0], up[1], up[2]), qAxis(0, 1, 0, rnd() * TAU)), h0 + rr(-0.015, 0.015), v === 12 || v === 13 ? rr(0.9, 1.4) : rr(0.5, 1.1));
        splat(s[0], s[1] + 0.6, s[2], sc * (v === 12 || v === 13 ? 0.12 : 0.04), PALW[pal]);
      }
    } else if (n0[1] > -0.35 && n0[1] < 0.55 && rnd() < 0.7) { // brackets on walls
      const o = v3.nrm([n0[0], 0, n0[2]]), pal = rnd() < 0.6 ? 3 : palAt(x, z), sc = rr(0.3, 1.1);
      sm(10 + (rnd() * 2 | 0), x - o[0] * 0.06, y, z - o[2] * 0.06, sc, qAxis(0, 1, 0, atan2(-o[2], o[0])), hueOf(pal), rr(0.5, 1.1));
      splat(x + o[0], y, z + o[2], sc * 0.05, PALW[pal]);
    } else if (n0[1] < -0.35 && zp + fd > 0.3) { // lanterns hanging from overhangs
      const sc = rr(0.3, 0.7), pal = palAt(x, z);
      sm(12, x, y + 0.05, z, sc, qMul(qAxis(1, 0, 0, PI), qAxis(0, 1, 0, rnd() * TAU)), hueOf(pal), rr(1, 1.5));
      splat(x, y - 0.8, z, sc * 0.15, PALW[pal]);
    }
  }

  // --- rocks: floating boulder clusters + scattered ground rocks
  const BOULD = [[-11, -11, -105, 14, 5], [-56, -19, -18, 18, 6], [-62, -14, -82, 22, 7], [24, -15, -24, 22, 7], [-18, -12, 4, 14, 6], [30, -14, 30, 16, 6], [62, -10, -58, 22, 8], [-30, -13, -84, 16, 7], [-58, -14, 0, 14, 6], [19, -13, 98, 18, 6], [62, -9, 34, 14, 6]];
  rseed(8);
  for (let i = 0; i < 9; i++) { const a = rnd() * TAU, r = rr(60, 150); BOULD.push([cos(a) * r, rr(-20, -9), sin(a) * r, 10 + rnd() * 12 | 0, rr(5, 9)]); }
  if (0) for (const b of BOULD) for (let i = 0; i < b[3] / 2; i++) { // floating rocks: off, they made the world feel underwater
    const sc = rnd() < 0.12 ? rr(1.8, 3.2) : rr(0.35, 1.5);
    const x = b[0] + rr(-1, 1) * b[4], y = b[1] + rr(-1, 1) * b[4] * 0.6, z = b[2] + rr(-1, 1) * b[4];
    if (Dw(x, y, z) > -sc) continue;
    const bob = rr(0.12, 0.4), sd = rnd();
    solid(rnd() * 4 | 0, x, min(y, -2 - sc), z, sc, qRand(), 1, sd, 1, bob);
    if (sc > 1.1) for (let j = 0; j < 7; j++) solid(rnd() * 4 | 0, x + rr(-1.6, 1.6) * sc, min(y, -2 - sc) + rr(-1.4, 1) * sc, z + rr(-1.6, 1.6) * sc, rr(0.1, 0.35), qRand(), 1, sd, 1, bob);
  }
  rseed(9);
  for (let i = 0; i < 2600; i++) {
    const k = pickV(); if (T.wn[k + 1] < 0.7 || hypot(T.wp[k], T.wp[k + 2]) > 170 || nearFly(T.wp[k], T.wp[k + 1], T.wp[k + 2], 6)) continue;
    const sc = rr(0.25, 1.3) * (rnd() < 0.1 ? 2 : 1);
    solid(rnd() * 4 | 0, T.wp[k], T.wp[k + 1] + sc * 0.2, T.wp[k + 2], sc, qRand(), 1, rnd(), 1, 0);
  }

  rseed(10);
  for (let i = 0; i < 60000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    if (hypot(x, z) > 172 || y > -3 || (ny > 0.8 && rnd() < 0.6) || nearFly(x, y, z, 3.5)) continue;
    const sc = (0.35 + 2.1 * pow(rnd(), 2.6)) * (ny > 0.8 ? 0.5 : 1), q = qRand();
    chunks[(sc > 1.15 ? 3 : 0) + (rnd() * 3 | 0)][cellOf(x, z)].push(x - T.wn[k] * sc * 0.3, y - ny * sc * 0.3, z - T.wn[k + 2] * sc * 0.3, sc, q[0], q[1], q[2], q[3], 1, rnd(), sc > 1.15 ? 0 : 96, 0);
  }
  rseed(11);
  for (let i = 0; i < 170000; i++) { // pebbles and rubble on the sea floor
    const k = pickV(), x = T.wp[k] + rr(-0.4, 0.4), z = T.wp[k + 2] + rr(-0.4, 0.4), y = T.wp[k + 1];
    if (T.wn[k + 1] < 0.8 || hypot(x, z) > 170 || nearFly(x, y, z, 1.3)) continue;
    const sc = 0.05 + 0.3 * pow(rnd(), 2), q = qRand();
    nth++ % THIN || chunks[6][cellOf(x, z)].push(x, y - sc * 0.25, z, sc, q[0], q[1], q[2], q[3], 1, rnd(), 44, 0);
  }
  // --- set pieces
  const gy = (x, z) => { const f = floorsAt(x, z); return f.length ? f[f.length - 2] : -45; };
  // fossil ribcage of something enormous: spine half-buried along the view from viewpoint 1, ribs arching over it,
  // skull at the far end. Tapered capsules (ax ay az ra bx by bz rb) and carved spheres, meshed in meshRibs()
  const ribs = { caps: [], cut: [] };
  {
    const dv = v3.nrm([-0.05, 0, -1]), sv = [-dv[2], 0, dv[0]], L = 22, NSP = 14, sp = [];
    for (let i = 0; i <= NSP; i++) { const t = i / NSP, x = 0.5 + dv[0] * L * t, z = -1 + dv[2] * L * t; sp.push([x, gy(x, z) + 0.15 + 0.35 * sin(t * PI), z]); }
    for (let i = 0; i < NSP; i++) { const a = sp[i], b = sp[i + 1], m = v3.add(a, v3.add(b, a, -1), 0.5); ribs.caps.push([...a, 0.62, ...m, 0.42], [...m, 0.42, ...b, 0.62]); }
    for (let i = 1; i < NSP - 1; i++) {
      const Rr = 6.4 * pow(sin(PI * (i + 0.5) / NSP), 0.7) * rr(0.92, 1.05), c = v3.add(sp[i], [0, 1, 0], Rr);
      for (const sg of [-1, 1]) {
        if ((i === 4 && sg < 0) || (i === 9 && sg > 0)) continue; // two broken ribs
        const top = sg < 0 && i === 7 ? 0.55 : 0.9, pts = [];
        for (let j = 0; j <= 9; j++) { const ph = j / 9 * top * PI; pts.push(v3.add(v3.add(v3.add(c, [0, 1, 0], -Rr * cos(ph)), sv, sg * Rr * sin(ph) * 0.88), dv, Rr * 0.16 * sin(ph))); }
        for (let j = 0; j < 9; j++) ribs.caps.push([...pts[j], 0.48 * (1 - 0.55 * j / 9) * (0.6 + Rr / 16), ...pts[j + 1], 0.48 * (1 - 0.55 * (j + 1) / 9) * (0.6 + Rr / 16)]);
      }
    }
    const E = v3.add(sp[NSP], dv, 1.8), sy = gy(E[0] + dv[0] * 2, E[2] + dv[2] * 2) + 1.7, S = [E[0], sy, E[2]];
    ribs.caps.push([...v3.add(S, dv, -0.6), 2.0, ...v3.add(v3.add(S, dv, 3.6), [0, 1, 0], -0.25), 1.15]);  // skull
    ribs.caps.push([...v3.add(S, [0, 1, 0], 0.6), 1.6, ...v3.add(S, dv, 1.6), 1.5]);                         // brow
    ribs.caps.push([...v3.add(v3.add(S, dv, 0.4), [0, 1, 0], -1.3), 0.75, ...v3.add(v3.add(S, dv, 4.2), [0, 1, 0], -1.9), 0.5]); // jaw
    for (const sg of [-1, 1]) ribs.cut.push([...v3.add(v3.add(v3.add(S, dv, 1.9), sv, sg * 1.25), [0, 1, 0], 0.75), 0.75]);  // eye sockets
    ribs.cut.push([...v3.add(v3.add(S, dv, 3.9), [0, 1, 0], 0.1), 0.5]);                                       // nasal opening
    solid(10, 0, 0, 0, 1, [0, 0, 0, 1], 2, 0.3, 1, 0);
    // moss and glow inside the ribs
    for (let i = 2; i < NSP - 1; i += 2) splat(sp[i][0], sp[i][1] + 2.5, sp[i][2], 0.5, i % 4 ? 0.1 : 0.9);
  }
  // a fallen giant: it grew on the ledge above the eastern canyon and toppled; its cap rests on the canyon floor
  {
    const B = [44, gy(44, 0) + 0.3, 0], E0 = [68, 0, 12], E = [E0[0], gy(E0[0], E0[2]) + 6.5, E0[2]], dv = v3.nrm(v3.add(E, B, -1)), H = hypot(E[0] - B[0], E[1] - B[1], E[2] - B[2]);
    const i0 = SM.ni, res = shroom(SM, { x: B[0], y: B[1], z: B[2], h: H, r: 1.9, R: 9.5, kind: 1, hue: hueOf(3), gl: 0.75, tg: 0.1, sg: 0.5, dir: dv, bend: [0, -0.06, 0], tilt: 1.15, q: GQ, seed: 7 }); // tilt > 1: the cap tips down onto its rim
    addTris(i0, E[0], E[2], 0, 0, 1);
    for (let k = 0; k < 6; k++) splat(E[0] + rr(-4, 4), E[1] + rr(-3, 3), E[2] + rr(-4, 4), 1.2, PALW[3]);
    for (let k = 0; k < 9; k++) { // brackets along the trunk
      const t = rr(0.1, 0.85), p = v3.add(v3.add(B, dv, H * t), [0, 1, 0], -0.06 * H * t * t), a = rr(0.3, PI - 0.3), out = v3.nrm([dv[2] * cos(a), sin(a) * 0.4, -dv[0] * cos(a)]);
      const j0 = SM.ni; shelf(SM, p[0] + out[0] * 1.6, p[1] + 0.6, p[2] + out[2] * 1.6, v3.nrm([out[0], 0, out[2]]), rr(0.5, 1.1), hueOf(rnd() < 0.5 ? 4 : 2), 1, 1 + rnd() * 3 | 0, GQ * 0.7, k);
      addTris(j0, 0, 0, 0, 0, 1);
    }
    for (const p of res.rim) if (rnd() < 0.5) glint(p[0], p[1], p[2], 0, rnd(), PALG[3], 0.04, 0);
  }
  // barrel sponges in front of viewpoint 4, small sponges around the fluke base
  rseed(12);
  for (const b of [[7, 3.2, 1.3, 4], [8.4, 4.6, 1.0, 6], [9.6, 2.6, 1.5, 4], [11, 5, 1.1, 5], [8, -3.6, 1.2, 4], [12.5, 2, 1.2, 6], [9, 3.9, 0.8, 4]]) { const p = rel(3, b[0], b[1]), c = POSES[3]; let ux = (c[0] - p[0]) * 0.07, uz = (c[2] - p[1]) * 0.07; const l = hypot(ux, 1, uz); solid(b[3], p[0], gy(p[0], p[1]) - 0.1, p[1], b[2], qFromY(ux / l, 1 / l, uz / l), 4, rnd(), 1, 0); }
  for (let i = 0; i < 9; i++) { const a = rnd() * TAU; const x = -5 + cos(a) * rr(1.2, 2.6), z = -4 + sin(a) * rr(1.5, 4); solid(6, x, gy(x, z) + 0.05, z, rr(0.4, 0.9), qAxis(0, 1, 0, rnd() * 6), 4, rnd(), 1, 0); }

  // --- spore motes: glowing specks rising from vents in the ground (the giants add theirs, falling, in dress())
  // a: x, start height, z, size; b: palette + seed, speed, travel (negative: falling), wobble
  const VENTS = [[4, -3], [4.5, -3.5], [2, -1], [5.5, -7], [3, -9], [6, -90], [8, -84], [4, -93], [-9, 3], [40, 20], [-56, 12], [10, 80], [-2, 30], [0, -30], [12, 2], [46, 30], [-20, -103], [-52, -12], [4, 70], [9, -74], [14, 26], [26, 40], [-45, -64], [-55, -40], [-58, 22], [-40, 40], [-14, 45], [-1, -9], [-7, -6]];
  rseed(13);
  for (const s of spots) if (rnd() < 0.28) VENTS.push([s[0], s[2], s[1]]);
  if (0) for (const v of VENTS) { // rising motes: off, they read as bubbles
    const y0 = v.length > 2 ? v[2] : gy(v[0], v[1]), pal = zoneP(v[0], v[1]) > 0.4 ? 2 : rnd() < 0.7 ? 1 : 4, n = 70 + rnd() * 60 | 0;
    splat(v[0], y0 + 2, v[1], 1.5, PALW[pal]);
    for (let i = 0; i < n; i++) motes.push(v[0] + rr(-0.4, 0.4), y0, v[1] + rr(-0.4, 0.4), rnd() < 0.2 ? rr(0.06, 0.12) : rr(0.025, 0.06), pal + rnd() * 0.99, rr(0.5, 1.4), rr(8, 26), rr(0.1, 0.3));
  }

  // --- pack leaves (36 bytes: 8 floats + 4 unorm8), sorted by culling cell
  const pack = (L, step = 1, wm = 1) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += Math.ceil(L[c].length / 12 / step); }
    start[nCells] = n;
    const buf = new ArrayBuffer(n * 36), f = new Float32Array(buf), u8 = new Uint8Array(buf), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12 * step, k++) {
      for (let j = 0; j < 8; j++) f[k * 9 + j] = a[i + j];
      f[k * 9 + 6] *= wm;
      u8[k * 36 + 32] = a[i + 8]; u8[k * 36 + 33] = a[i + 9] * 255; u8[k * 36 + 34] = a[i + 10] * 255; u8[k * 36 + 35] = a[i + 11] * 255;
      const y = a[i + 1], l = a[i + 3]; if (y - l < lo[c]) lo[c] = y - l; if (y + l > hi[c]) hi[c] = y + l;
    } }
    return { buf, n, start, lo, hi };
  };

  // --- half-res volume: r = openness, g = skylight, b / a = glow from the fungi (teal / magenta)
  const hx = NX / 2, hy = NY / 2, hz = NZ / 2, volD = new Uint8Array(hx * hy * hz * 4), open = new Float32Array(hx * hy * hz);
  let Lp = new Float32Array(hx * hz).fill(1), Ln = new Float32Array(hx * hz), tmp = new Float32Array(hx * hz);
  for (let y = hy - 1; y >= 0; y--) {
    for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) { const i = x + hx * z; tmp[i] = (Lp[x > 0 ? i - 1 : i] + 2 * Lp[i] + Lp[x < hx - 1 ? i + 1 : i]) * 0.25; }
    for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) {
      const i = x + hx * z, b = (tmp[z > 0 ? i - hx : i] + 2 * tmp[i] + tmp[z < hz - 1 ? i + hx : i]) * 0.25;
      const g0 = gi(x * 2, y * 2, z * 2);
      const d = (D[g0] + D[g0 + 1] + D[g0 + NX] + D[g0 + NX + 1] + D[g0 + NX * NY] + D[g0 + NX * NY + 1] + D[g0 + NX * NY + NX] + D[g0 + NX * NY + NX + 1]) * 0.125;
      const o = x + hx * (y + hy * z);
      open[o] = clamp(0.5 - d / 1.5, 0, 1);
      Ln[i] = b * open[o] * (1 - min(capAbs[o], 0.92));
      volD[o * 4] = clamp(0.5 - d / 12, 0, 1) * 255; volD[o * 4 + 1] = min(1, b) * 255;
    }
    const t = Lp; Lp = Ln; Ln = t;
  }
  // glow spreads through open air (box blurs of radius 3 along each axis, four times: ~6 m soft falloff), not rock
  {
    const run = new Float32Array(max(hx, hy, hz)), AX = [[hx, 1, hy, hx, hz, hx * hy], [hy, hx, hx, 1, hz, hx * hy], [hz, hx * hy, hx, 1, hy, hx]];
    for (const G of [glowA, glowB]) for (let it = 0; it < 4; it++) for (const [n, st, n1, s1, n2, s2] of AX) for (let b2 = 0; b2 < n2; b2++) for (let b1 = 0; b1 < n1; b1++) {
      const o0 = b1 * s1 + b2 * s2; let s = 0;
      for (let k = 0; k < n; k++) run[k] = G[o0 + k * st];
      for (let k = 0; k <= 3 && k < n; k++) s += run[k];
      for (let k = 0; k < n; k++) { G[o0 + k * st] = s / 7 * (0.25 + 0.75 * open[o0 + k * st]); if (k + 4 < n) s += run[k + 4]; if (k - 3 >= 0) s -= run[k - 3]; }
    }
    for (let o = 0; o < open.length; o++) { volD[o * 4 + 2] = (1 - exp(-glowA[o] * 9)) * 255; volD[o * 4 + 3] = (1 - exp(-glowB[o] * 9)) * 255; }
  }

  // --- ground map: r magenta cover, g glowing fungus in the ground, b violet grotto, a pale mycelium mats
  const gm = new Uint8Array(512 * 512 * 4);
  for (let j = 0; j < 512; j++) for (let i = 0; i < 512; i++) {
    const x = (i + 0.5) / 512 * 384 - 192, z = (j + 0.5) / 512 * 384 - 192, o = (i + 512 * j) * 4;
    gm[o] = magAt(x, z) * 255; gm[o + 2] = zoneP(x, z) * 255; gm[o + 3] = sstep(0.42, 0.6, fbm(x * 0.04, 3, z * 0.04, 3)) * 255;
    gm[o + 1] = max(veinG[i + 512 * j] * 0.9, sstep(0.5, 0.68, fbm(x * 0.025, 5, z * 0.025, 3)) * 0.55) * 255;
  }

  // --- flying schools + gliders
  const fish = [];
  rseed(14);
  for (const s of SCH) { const ss = s[7] === undefined ? rnd() : s[7], y = gy(s[0], s[2]) + 2.5, R = s[3] * 0.45; for (let i = s[4] / 7 | 0; i > 0; i--) fish.push(s[0], y, s[2], R, rnd(), rr(0.6, 1.4), s[5] * 1.6, ss); }
  const mantas = [];
  for (const m of GLIDERS) mantas.push(...m);

  // --- drifting particles
  const snow = new Float32Array(9000 * 4);
  for (let i = 0; i < snow.length; i++) snow[i] = rnd();

  const sol = { data: [], ranges: [] }; let si = 0;
  for (let m = 0; m < 12; m++) { const a = solids[m] || []; sol.ranges.push([si, a.length / 12]); si += a.length / 12; for (let i = 0; i < a.length; i++) sol.data.push(a[i]); }
  const packC = (L) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += L[c].length / 12; }
    start[nCells] = n;
    const data = new Float32Array(n * 12), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12) { for (let j = 0; j < 12; j++) data[k++] = a[i + j]; lo[c] = min(lo[c], a[i + 1] - 3); hi[c] = max(hi[c], a[i + 1] + 3); } }
    return { data, n, start, lo, hi };
  };
  return { gy, glints: new Float32Array(glints), chunks: chunks.map(packC), props: props.map(packC), big: pack(big), bigF: pack(big, 2, 1.5), small: pack(small), solids: { data: new Float32Array(sol.data), ranges: sol.ranges }, bubbles: new Float32Array(motes), volD, gm, shrooms: packShrooms(), sprops: sprops.map(packC), ribs,
    // for walking: stems (x, y, z, r, height, lean x, lean z) and caps (centre x, top, centre z, radius)
    stems: new Float32Array(giants.flatMap((g) => [g.x, g.y, g.z, g.r, g.H, g.lx || 0, g.lz || 0])), caps: new Float32Array(giants.flatMap((g) => g.top ? [g.cx, g.top, g.cz, g.R] : [])), fish: new Float32Array(fish), mantas: new Float32Array(mantas), snow };
}
const fract = (x) => x - floor(x);

// ---------------------------------------------------------------- procedural meshes
function meshChunk(sd, sub = 2, det = sub > 2) {
  if (LV > 1 && sub > 1) sub--; // Low: a quarter of the triangles
  rseed(100 + sd);
  const pl = []; for (let i = 0; i < 4; i++) { const q = qRand(); pl.push([q[0], q[1], q[2], rr(0.8, 0.98)]); const l = hypot(q[0], q[1], q[2]) || 1; pl[i][0] /= l; pl[i][1] /= l; pl[i][2] /= l; }
  return icosphere(sub, (x, y, z) => {
    let r = 1 + (fbm(x * 1.6 + sd, y * 1.6, z * 1.6, 2) - 0.5) * 0.9 + (det ? (fbm(x * 4 + sd, y * 4, z * 4, 2) - 0.5) * 0.25 : 0);
    let px = x * r, py = y * r * 0.8, pz = z * r;
    for (const p of pl) { const d = px * p[0] + py * p[1] + pz * p[2] - p[3]; if (d > 0) { px -= p[0] * d; py -= p[1] * d; pz -= p[2] * d; } }
    return [px, py, pz];
  });
}
function meshLathe(prof, seg, lump, ribs = 0) {
  const m = new Mesh(), rings = [];
  for (const [r, h, ao] of prof) { const ring = []; for (let s = 0; s < seg; s++) { const a = s / seg * TAU, rl = r * (1 + lump * (fbm(cos(a) * 1.5 + h * 2, h * 3, sin(a) * 1.5, 2) - 0.5) + 0.07 * cos(ribs * a + h * 1.5)); ring.push(m.v(cos(a) * rl, h, sin(a) * rl, ao)); } rings.push(ring); }
  for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < seg; s++) { const s2 = (s + 1) % seg; m.quad(rings[k][s], rings[k + 1][s], rings[k + 1][s2], rings[k][s2]); }
  return m;
}
function meshCoral(fan, lo = LV > 1) {
  rseed(200 + fan);
  const m = new Mesh();
  const nrm = (v) => { const l = hypot(...v) || 1; return v.map((c) => c / l); };
  const br = (p, d, r, len, depth) => {
    const pts = [p]; let q = p;
    for (let i = 0; i < 3; i++) { d = nrm([d[0] + rr(-0.3, 0.3), d[1] + rr(-0.1, 0.3), d[2] + (fan ? rr(-0.05, 0.05) : rr(-0.3, 0.3))]); q = [q[0] + d[0] * len / 3, q[1] + d[1] * len / 3, q[2] + d[2] * len / 3]; pts.push(q); }
    if (!depth) pts.push([q[0] + d[0] * r * 1.6, q[1] + d[1] * r * 1.6, q[2] + d[2] * r * 1.6]);
    if (lo) m.tube(depth ? [pts[0], pts[3]] : [pts[0], pts[3], pts[4]], (k) => (k > 1 ? r * 0.36 : r * (1 - 0.22 * k)) * 1.25, 3, true, (k) => clamp(1 - (depth + 1 - k) / 5, 0, 1));
    else m.tube(pts, (k) => k > 3 ? r * 0.36 : r * (1 - 0.22 * k / 3), fan ? 5 : 6, true, (k) => clamp(1 - (depth + 1 - k / 3) / 5, 0, 1));
    if (depth > 0) { const n = 2 + (rnd() < 0.5); for (let i = 0; i < n; i++) br(q, nrm([d[0] + rr(-0.8, 0.8), d[1] + rr(-0.1, 0.5), d[2] + (fan ? rr(-0.08, 0.08) : rr(-0.8, 0.8))]), r * 0.78, len * 0.8, depth - 1); }
  };
  const n0 = fan ? 1 : 2 + (rnd() * 2 | 0);
  for (let i = 0; i < n0; i++) br([rr(-0.08, 0.08), 0, rr(-0.08, 0.08)], nrm([rr(-0.5, 0.5), 1, fan ? 0 : rr(-0.5, 0.5)]), fan ? 0.06 : 0.08, fan ? 0.5 : 0.45, 3);
  return m;
}
function meshTubes() {
  rseed(210);
  const m = new Mesh();
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU, r0 = rr(0, 0.28), h = rr(0.45, 1.1), rad = rr(0.07, 0.12), lean = rr(0.05, 0.3), pts = [];
    for (let k = 0; k <= 4; k++) pts.push([cos(a) * (r0 + lean * k / 4 * h), h * k / 4, sin(a) * (r0 + lean * k / 4 * h)]);
    m.tube(pts, (k) => rad * (0.8 + 0.25 * k / 4), 12, false, (k) => 0.35 + 0.65 * k / 4);
    // rim + dark throat
    const e = pts[4], n = m.p.length / 3, c = m.v(e[0], e[1] - rad * 1.2, e[2], 0.05);
    for (let s2 = 0; s2 < 12; s2++) m.tri(n - 12 + s2, n - 12 + (s2 + 1) % 12, c);
  }
  return m;
}
// fossil ribcage: tapered capsules smoothly joined, minus carved spheres -> surface nets, in world coordinates.
// Each capsule only touches the voxels near it, so the cost follows the bones, not the box around them.
function meshRibs(rb) {
  const vs = LV > 1 ? 0.22 : 0.15, k = 0.5;
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (const c of rb.caps) for (const o of [0, 4]) { x0 = min(x0, c[o] - c[o + 3]); x1 = max(x1, c[o] + c[o + 3]); y0 = min(y0, c[o + 1] - c[o + 3]); y1 = max(y1, c[o + 1] + c[o + 3]); z0 = min(z0, c[o + 2] - c[o + 3]); z1 = max(z1, c[o + 2] + c[o + 3]); }
  x0 -= 1.5; y0 -= 1.5; z0 -= 1.5;
  const nx = Math.ceil((x1 + 1.5 - x0) / vs), ny = Math.ceil((y1 + 1.5 - y0) / vs), nz = Math.ceil((z1 + 1.5 - z0) / vs), D = new Float32Array(nx * ny * nz).fill(9);
  const each = (b0, b1, f) => {
    const i0 = max(1, floor((b0[0] - x0) / vs)), i1 = min(nx - 2, Math.ceil((b1[0] - x0) / vs)), j0 = max(1, floor((b0[1] - y0) / vs)), j1 = min(ny - 2, Math.ceil((b1[1] - y0) / vs)), l0 = max(1, floor((b0[2] - z0) / vs)), l1 = min(nz - 2, Math.ceil((b1[2] - z0) / vs));
    for (let l = l0; l <= l1; l++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(i + nx * (j + ny * l), x0 + i * vs, y0 + j * vs, z0 + l * vs);
  };
  for (const c of rb.caps) {
    const m = max(c[3], c[7]) + k + 0.3, bax = c[4] - c[0], bay = c[5] - c[1], baz = c[6] - c[2], bb = bax * bax + bay * bay + baz * baz || 1e-6;
    each([min(c[0], c[4]) - m, min(c[1], c[5]) - m, min(c[2], c[6]) - m], [max(c[0], c[4]) + m, max(c[1], c[5]) + m, max(c[2], c[6]) + m], (i, x, y, z) => {
      const pax = x - c[0], pay = y - c[1], paz = z - c[2], h = clamp((pax * bax + pay * bay + paz * baz) / bb, 0, 1);
      const e = hypot(pax - bax * h, pay - bay * h, paz - baz * h) - mix(c[3], c[7], h), d = D[i], hh = max(k - abs(d - e), 0) / k;
      D[i] = min(d, e) - hh * hh * k * 0.25;
    });
  }
  for (const c of rb.cut) each([c[0] - c[3] - 0.4, c[1] - c[3] - 0.4, c[2] - c[3] - 0.4], [c[0] + c[3] + 0.4, c[1] + c[3] + 0.4, c[2] + c[3] + 0.4], (i, x, y, z) => {
    const e = c[3] - hypot(x - c[0], y - c[1], z - c[2]), d = D[i], hh = max(0.3 - abs(d - e), 0) / 0.3; D[i] = max(d, e) + hh * hh * 0.3 * 0.25;
  });
  // weathering: pits and grooves near the surface only
  for (let i = 0; i < D.length; i++) if (D[i] < 0.6 && D[i] > -0.6) { const x = i % nx, y = (i / nx | 0) % ny, z = i / (nx * ny) | 0; D[i] += 0.07 * (fbm(x * vs * 1.3, y * vs * 1.3, z * vs * 1.3, 2) - 0.5) + 0.03 * sin(y * vs * 9 + fbm(x * vs * 0.5, 0, z * vs * 0.5, 2) * 6); }
  for (let i = 0; i < D.length; i++) D[i] = -D[i];
  const sn = surfaceNets(D, nx, ny, nz), smp = sampler3(D, nx, ny, nz);
  const vb = new ArrayBuffer(sn.nv * 16), f = new Float32Array(vb), s = new Int8Array(vb);
  for (let q = 0; q < sn.nv; q++) {
    const x = sn.pos[q * 3], y = sn.pos[q * 3 + 1], z = sn.pos[q * 3 + 2], e = 0.7;
    const ax = smp(x - e, y, z) - smp(x + e, y, z), ay = smp(x, y - e, z) - smp(x, y + e, z), az = smp(x, y, z - e) - smp(x, y, z + e), l = hypot(ax, ay, az) || 1;
    f[q * 4] = x0 + x * vs; f[q * 4 + 1] = y0 + y * vs; f[q * 4 + 2] = z0 + z * vs;
    s[q * 16 + 12] = round(ax / l * 127); s[q * 16 + 13] = round(ay / l * 127); s[q * 16 + 14] = round(az / l * 127); s[q * 16 + 15] = 127;
  }
  return { vb, ib: new Uint32Array(sn.idx), nv: sn.nv };
}
// the shared small fungus meshes (see NSV), about 1 m across; their hue and glow come from each instance
function smallShrooms() {
  const q = LV > 1 ? 0.35 : LV ? 0.45 : 0.6, V = [];
  const one = (f) => { rseed(300 + V.length); const M = new SMesh(); f(M); V.push(M.build()); };
  const S = (M, o) => shroom(M, Object.assign({ x: 0, y: 0, z: 0, hue: 0, gl: 0.9, tg: 0.25, sg: 0.25, bulb: 0.4, q, seed: rnd() * 40 }, o));
  one((M) => S(M, { h: 1.3, r: 0.14, R: 0.7, kind: 1 }));
  one((M) => S(M, { h: 0.75, r: 0.18, R: 0.95, kind: 1, bulb: 0.8 }));
  one((M) => S(M, { h: 2.2, r: 0.08, R: 1, kind: 0, ring: 0.72, curve: 0.04 }));
  one((M) => S(M, { h: 1.6, r: 0.09, R: 0.5, kind: 2, curve: 0.05 }));
  one((M) => S(M, { h: 2.6, r: 0.07, R: 0.4, kind: 2, bend: [0.15, 0, 0], tg: 0.5 }));
  one((M) => S(M, { h: 1.1, r: 0.11, R: 0.85, kind: 3 }));
  one((M) => { for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + rr(-0.3, 0.3), d = i ? rr(0.15, 0.35) : 0, l = i ? rr(0.15, 0.4) : 0; S(M, { x: cos(a) * d, z: sin(a) * d, h: rr(0.6, 1.5) * (i ? 0.8 : 1.2), r: 0.06, R: rr(0.22, 0.4), kind: rnd() < 0.5 ? 1 : 2, bend: [cos(a) * l, 0, sin(a) * l], q: q * 0.7 }); } });
  one((M) => { for (let i = 0; i < 3; i++) { const a = i / 3 * TAU, d = 0.25; S(M, { x: cos(a) * d, z: sin(a) * d, h: rr(1.2, 2.4), r: 0.06, R: rr(0.45, 0.7), kind: 0, bend: [cos(a) * 0.3, 0, sin(a) * 0.3], q: q * 0.8 }); } });
  one((M) => puff(M, 0, 0, 0, 0.6, 0, 0.6, q, 1));
  one((M) => { puff(M, 0, 0, 0, 0.5, 0, 0.6, q * 0.8, 2); puff(M, 0.55, 0, 0.2, 0.32, 0, 0.6, q * 0.7, 3); puff(M, -0.2, 0, 0.5, 0.25, 0, 0.6, q * 0.7, 4); });
  one((M) => shelf(M, 0, 0, 0, [1, 0, 0], 1, 0, 0.8, 3, q, 1));
  one((M) => shelf(M, 0, 0, 0, [1, 0, 0], 1.3, 0, 0.8, 1, q, 2));
  one((M) => S(M, { h: 1.9, r: 0.035, R: 0.22, kind: 2, gl: 1, tg: 1, sg: 0.6, curve: 0.08 }));
  one((M) => { for (let i = 0; i < 9; i++) { const a = rnd() * TAU, d = sqrt(rnd()) * 0.35; S(M, { x: cos(a) * d, z: sin(a) * d, h: rr(0.4, 1.3), r: 0.025, R: rr(0.05, 0.09), kind: 2, gl: 1, tg: 1, sg: 0.8, bend: [cos(a) * 0.2, 0, sin(a) * 0.2], q: q * 0.5 }); } });
  return V;
}
function meshManta() {
  const m = new Mesh(), NU = 72, M = 22, rings = [];
  for (let j = 0; j <= NU; j++) {
    const u = j / NU * 2 - 1, au = abs(u);
    let zl = 0.52 - 0.74 * pow(au, 1.35) + 0.07 * exp(-pow((au - 0.13) / 0.05, 2)) - 0.05 * exp(-pow(au / 0.05, 2)) - 0.08 * pow(au, 5);
    const zt = -0.5 + 0.3 * pow(au, 0.8) + 0.02 - 0.08 * pow(au, 5);
    if (zl < zt + 0.004) zl = zt + 0.004;
    const th = 0.08 * pow(1 - au, 1.15) + 0.004 + 0.12 * exp(-pow(u / 0.2, 2)), ring = [];
    for (let k = 0; k < M; k++) { const a = k / M * TAU; ring.push(m.v(u, th * sin(a) * (0.62 + 0.38 * cos(a)), mix(zt, zl, 0.5 + 0.5 * cos(a)), u)); }
    rings.push(ring);
  }
  for (let j = 0; j < NU; j++) for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; m.quad(rings[j][k], rings[j + 1][k], rings[j + 1][k2], rings[j][k2]); }
  const tail = []; for (let i = 0; i <= 8; i++) tail.push([0, 0, -0.42 - i * 0.19]);
  const n0 = m.p.length / 3;
  m.tube(tail, (k) => 0.016 * (1 - k / 9), 4, true);
  for (let k = n0; k < m.aux.length; k++) m.aux[k] = 0;
  for (const sx of [-1, 1]) { // cephalic fins
    const n1 = m.p.length / 3;
    m.tube([[sx * 0.12, -0.02, 0.48], [sx * 0.135, -0.05, 0.6], [sx * 0.115, -0.09, 0.69], [sx * 0.085, -0.125, 0.74]], (k) => 0.045 * (1 - k / 4.4), 6, true);
    for (let k = n1; k < m.aux.length; k++) m.aux[k] = sx * 0.1;
  }
  return m;
}
// moth: a slim body along +x and two pairs of wings in the xz plane; aux = how far out along the wing (0 on the body)
function meshMoth() {
  const m = new Mesh();
  m.tube([[0.14, 0, 0], [0.05, 0.01, 0], [-0.08, 0, 0], [-0.2, -0.01, 0]], (k) => [0.018, 0.03, 0.026, 0.012][k], 5, true, () => 0);
  for (const sz of [-1, 1]) {
    const a = m.v(0.06, 0.01, 0, 0), b = m.v(0.1, 0.01, sz * 0.22, sz), c = m.v(-0.04, 0.01, sz * 0.3, sz), d = m.v(-0.05, 0.01, sz * 0.04, sz * 0.15);
    const e = m.v(-0.14, 0.01, sz * 0.2, sz * 0.7);
    if (sz > 0) { m.quad(a, b, c, d); m.tri(d, c, e); } else { m.quad(a, d, c, b); m.tri(d, e, c); }
  }
  return m;
}
