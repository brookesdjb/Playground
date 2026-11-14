// ============================================================================
// development tools: only in dev.html (npm run build:dev), never in index.html
// ============================================================================
//   F    fly the camera along the scripted path (FLY in main.js), one minute through the whole world
//   B    the same flight as a benchmark: the resolution stays fixed, every frame is timed, the result is shown at the end
//   F, B or 1-6 during a flight stop it
{
  const LOGN = 1 << 16, logFrame = new Float32Array(LOGN), logGpu = new Float32Array(LOGN);
  let flying = false, bench = false, last = 0, nFrame = 0, nGpu = 0;
  const stop = () => { flying = bench = false; dynT = 0; };
  const report = () => {
    const st = (a, n) => { const s = Array.from(a.subarray(0, n)).sort((x, y) => x - y); let sum = 0; for (const v of s) sum += v; return { n, avg: sum / n, p99: s[min(n - 1, floor(n * 0.99))], max: s[n - 1] }; };
    const fm = (o) => `avg ${o.avg.toFixed(2)}  p99 ${o.p99.toFixed(2)}  max ${o.max.toFixed(2)} ms`;
    const f = st(logFrame, nFrame);
    info.textContent = `Fly-through ${W}x${H}, ${f.n} frames\nframe  ${fm(f)}\nGPU    ${nGpu ? fm(st(logGpu, nGpu)) : 'timestamp-query unavailable'}`;
  };
  // frame() moves the free camera and then calls render(): step in between and put the camera on the path instead
  const draw = render;
  render = () => {
    if (flying) {
      const dtr = F[LAST] - last; last = F[LAST];
      F[FLT] += min(dtr / 1000, 0.1); flyAt();
      if (bench) { if (nFrame < LOGN) logFrame[nFrame++] = dtr; if (F[GPU] > 0 && nGpu < LOGN) logGpu[nGpu++] = F[GPU]; }
      if (F[FLT] >= FLYT) { if (bench) report(); stop(); }
    }
    draw();
  };
  addEventListener('keydown', (e) => {
    if (menu || e.repeat) return;
    if (e.code === 'KeyF' || e.code === 'KeyB') {
      if (flying) stop();
      else {
        flying = true; bench = e.code === 'KeyB'; F[FLT] = 0; last = F[LAST]; nFrame = nGpu = 0;
        // a benchmark hides the stats line and holds the resolution: dynT at -Infinity keeps frame() from tuning it
        if (bench) { hud = false; info.textContent = ''; dynT = -Infinity; }
      }
    } else if (/Digit[1-6]/.test(e.code)) stop();
  });
}
// hooks for tools/shoot.cjs (headless screenshots): enter the scene, hold the resolution, jump to a viewpoint
window.__dev = {
  go: () => { ui(false); dynT = -Infinity; },
  pose: (i) => lookAt(...POSES[i]),
  cam: (a) => lookAt(...a),
  // camera on the scripted path at time t (0-60 s), turned by dyaw / dpitch radians (training-data capture)
  flyTo: (t, dyaw = 0, dpitch = 0) => { F[FLT] = t; flyAt(); F[YAW] += dyaw; F[PIT] += dpitch; },
  time: (t) => { F[TIME] = t; },
  info: () => ({ W, H, LV, pix, det }),
  // what the generator made: one-off fungus triangles, small fungus instances, leaves, motes
  stats: () => ({ fungusTris: SH.start[CELLS * CELLS + 1] * 2, smallFungi: Wd.sprops.reduce((a, c) => a + c.n, 0), smallTris: FSM.reduce((a, m, i) => a + m.ib.length / 3 * Wd.sprops[i].n, 0),
    leaves: Wd.big.n + Wd.small.n, motes: nBub, glints: nGl, terrainTris: T.ib ? T.ib.length / 3 : T.start[CELLS * CELLS] * 2 }),
  res: (px) => { pix = px; resize(); },
  walkData: () => ({ stems: Array.from(STEMS.subarray(0, 70)), caps: Array.from(CAPT.subarray(0, 40)), nStems: STEMS.length / 7, nCaps: CAPT.length / 4 }),
  // run the movement for `sec` seconds at 60 Hz with keys held ({ f, b, l, r, s, jump, fly }), without drawing
  sim: (sec, k = {}) => {
    kf = k.f | 0; kb = k.b | 0; kl = k.l | 0; kr = k.r | 0; ks = k.s | 0; if (k.fly !== undefined) F[FLM] = k.fly;
    let bounces = 0, vmax = -1e9;
    for (let i = 0; i < sec * 60; i++) { if (k.jump) F[JMP] = 1; const vy = F[VY]; move(1 / 60); if (F[VY] > 8 && vy < 0) bounces++; vmax = Math.max(vmax, F[CY]); }
    release();
    return { x: +F[CX].toFixed(2), y: +F[CY].toFixed(2), z: +F[CZ].toFixed(2), vy: +F[VY].toFixed(2), gnd: F[GND], bounces, ymax: +vmax.toFixed(2) };
  },
  // the last frame (offscreen mode) as a PNG data URL
  grab: async () => {
    render(); await Q.onSubmittedWorkDone();
    const bpr = Math.ceil(W * 4 / 256) * 256, b = device.createBuffer({ size: bpr * H, usage: BU.MAP_READ | BU.COPY_DST });
    const e = device.createCommandEncoder(); e.copyTextureToBuffer({ texture: tOff }, { buffer: b, bytesPerRow: bpr }, [W, H]); Q.submit([e.finish()]);
    await b.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(b.getMappedRange()), img = new ImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(src.subarray(y * bpr, y * bpr + W * 4), y * W * 4);
    b.unmap(); b.destroy();
    const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  },
};
