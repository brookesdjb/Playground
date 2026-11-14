// Headless screenshots of dev.html through Chromium's software WebGPU (SwiftShader).
//   node tools/shoot.cjs [poses=1,2,3,4,5,6] [level=2] [width=1280] [height=720] [out=shots/pose]
//   poses can also be cameras: "[x,y,z,lookX,lookY,lookZ];[...]"
// Rendering is on the CPU, so it is slow and says nothing about real frame times.
const { chromium } = require('playwright');
const path = require('path');
const [poses = '1,2,3,4,5,6', lv = '2', w = '1280', h = '720', out = 'shots/pose'] = process.argv.slice(2);
(async () => {
  const t0 = Date.now(), T = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
  require('fs').mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const b = await chromium.launch({ channel: process.env.SHELL_ONLY ? undefined : 'chromium', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', ...(process.env.LOG ? ['--enable-logging=stderr', '--v=0'] : [])] });
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  p.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 600)));
  p.on('pageerror', (e) => { console.log('[pageerror]', e.message); process.exit(1); });
  await p.addInitScript((lv) => { try { localStorage.fungal = lv; localStorage.abyssal = lv; } catch {} }, lv);
  await p.goto('file://' + path.resolve(__dirname, '..', 'dev.html') + '#off' + (process.env.HASH || ''));
  let last = '';
  for (;;) {
    const s = await p.evaluate(() => [document.body.className, document.getElementById('s').textContent]);
    if (s[1] !== last) { console.log(T(), s.join(' | ')); last = s[1]; }
    if (s[0] === 'm' || s[0].includes('e')) { if (s[0].includes('e')) { await b.close(); process.exit(1); } break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  await p.evaluate((px) => { __dev.go(); __dev.res(px); }, +w * +h);
  console.log('stats', JSON.stringify(await p.evaluate(() => __dev.stats())));
  let nc = 0;
  // viewpoints 1-6, or cameras as [x,y,z,lookX,lookY,lookZ] separated by ';'
  for (const k of poses.includes('[') ? poses.split(';') : poses.split(',')) {
    await p.evaluate((k) => (k.startsWith('[') ? __dev.cam(JSON.parse(k)) : __dev.pose(+k - 1)), k);
    // a few frames so the camera's look smoothing and the canvas transition settle
    const file = `${out}${k.startsWith('[') ? 'cam' + (++nc) : k}.png`;
    const url = await p.evaluate(() => __dev.grab());
    require('fs').writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(T(), 'shot', file, JSON.stringify(await p.evaluate(() => __dev.info())));
  }
  await b.close();
})();
