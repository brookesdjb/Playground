// Training pairs from one of the worlds: the same camera and moment rendered at the input resolution (default 1280x720)
// and as a 2x2-supersampled target at twice that (rendered at 4x the pixels, averaged down to 2560x1440).
//
//   cd ../fungal-world && npm run build:dev      (and the same for ../desert-world)
//   node capture.cjs --world ../fungal-world --n 300 --out data/fungal
//   node capture.cjs --world ../desert-world --n 300 --out data/desert
// Options: --low 1280x720  --level 0 (High; the detail level the scene is built at)  --seed 1  --headed
//
// On a Mac this drives the system Chrome (WebGPU on the real GPU). Writes <out>/low/NNNN.png, <out>/high/NNNN.png and
// <out>/meta.json. Cameras are random points on the world's scripted 60 s path, turned a little, at random times
// (so animation differs). The film grain is switched off (#nograin): it is random per pixel and can't be learned.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const world = path.resolve(arg('world', '../fungal-world')), N = +arg('n', 300), out = path.resolve(arg('out', 'data/' + path.basename(world)));
const [lw, lh] = arg('low', '1280x720').split('x').map(Number), level = arg('level', '0');
let seed = +arg('seed', 1);
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

(async () => {
  for (const d of ['low', 'high']) fs.mkdirSync(path.join(out, d), { recursive: true });
  const opts = { args: ['--enable-unsafe-webgpu', ...(process.env.CHROME_ARGS || '').split(' ').filter(Boolean)], headless: !process.argv.includes('--headed') };
  let b;
  try { b = await chromium.launch({ ...opts, channel: 'chrome' }); } catch { b = await chromium.launch(opts); }
  // the viewport is 4x the input size so that the target can be rendered 2x2 supersampled; the input is rendered at
  // a quarter of it (the renderer scales its internal resolution, see res() in dev.js)
  const p = await b.newPage({ viewport: { width: lw * 4, height: lh * 4 }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => { console.log('[pageerror]', e.message); process.exit(1); });
  await p.addInitScript((lv) => { try { for (const k of ['fungal', 'desert', 'abyssal']) localStorage[k] = lv; } catch {} }, level);
  await p.goto('file://' + path.join(world, 'dev.html') + '#off,nograin');
  await p.waitForFunction(() => document.body.className === 'm' || document.body.className.includes('e'), null, { timeout: 600000, polling: 500 });
  if (await p.evaluate(() => document.body.className.includes('e'))) { console.log('failed to start:', await p.evaluate(() => document.getElementById('s').textContent)); process.exit(1); }
  await p.evaluate(() => __dev.go());
  const meta = [];
  const save = async (file, px, w, h) => {
    const url = await p.evaluate(async ([px, w, h]) => {
      __dev.res(px);
      const src = await __dev.grab();
      if (!w) return src;
      const img = new Image(); img.src = src; await img.decode(); // average the supersampled frame down
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/png');
    }, [px, w, h]);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  };
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const cam = { t: rnd() * 60, yaw: (rnd() - 0.5) * 1.4, pitch: (rnd() - 0.5) * 0.5, time: rnd() * 120 };
    await p.evaluate((c) => { __dev.flyTo(c.t, c.yaw, c.pitch); __dev.time(c.time); }, cam);
    const name = String(i).padStart(4, '0') + '.png';
    await save(path.join(out, 'low', name), lw * lh);
    await save(path.join(out, 'high', name), lw * lh * 16, lw * 2, lh * 2);
    meta.push({ name, ...cam });
    if (i % 10 === 9 || i === N - 1) console.log(`${i + 1}/${N}  ${((Date.now() - t0) / 1000 / (i + 1)).toFixed(1)} s per pair`);
  }
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ world: path.basename(world), low: [lw, lh], level, pairs: meta }, null, 1));
  await b.close();
})();
