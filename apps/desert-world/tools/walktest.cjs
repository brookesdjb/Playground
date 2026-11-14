// Checks walking physics in dev.html without drawing: landing, walking, jumping, solid stems, bouncy caps.
//   node tools/walktest.cjs   (stems are cactus and tree trunks here)
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  p.on('pageerror', (e) => { console.log('[pageerror]', e.message); process.exit(1); });
  await p.addInitScript(() => { try { localStorage.desert = 2; } catch {} });
  await p.goto('file://' + path.resolve(__dirname, '..', 'dev.html') + '#off');
  await p.waitForFunction(() => document.body.className === 'm' || document.body.className.includes('e'), null, { timeout: 300000, polling: 500 });
  const r = await p.evaluate(() => {
    const out = {}, d = __dev.walkData();
    __dev.go(); __dev.pose(0);
    out.land = __dev.sim(2);
    out.walk = __dev.sim(3, { f: 1 });
    __dev.sim(0.05, { jump: 1 }); out.jump = __dev.sim(1.2);
    // drop onto the biggest cap (if this world has caps)
    if (d.caps.length) {
    let best = 0; for (let i = 0; i < d.caps.length; i += 4) if (d.caps[i + 3] > d.caps[best + 3]) best = i;
    const c = d.caps.slice(best, best + 4);
    __dev.cam([c[0], c[1] + 6, c[2], c[0] + 5, c[1] + 6, c[2]]); out.cap = c.map((v) => +v.toFixed(1)); out.bounce = __dev.sim(3); out.settle = __dev.sim(4); __dev.sim(0.05, { jump: 1 }); out.capJump = __dev.sim(0.6, { jump: 1 });
    }
    // walk into a stem from 4 m away, aimed at its centre
    const st = d.stems.slice(0, 7), y0 = st[1] + 2.5;
    __dev.cam([st[0] + st[3] + 4, y0, st[2], st[0], y0, st[2]]); __dev.sim(1);
    out.stemR = +st[3].toFixed(2); out.stemWalk = __dev.sim(3, { f: 1 });
    out.stemGap = +(Math.hypot(out.stemWalk.x - st[0], out.stemWalk.z - st[2]) - st[3]).toFixed(2);
    out.counts = { stems: d.nStems, caps: d.nCaps };
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
