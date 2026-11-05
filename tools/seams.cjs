// Щели в мире (node tools/seams.cjs): рисуем только скалы (белым, фон — пурпурный, без дымки) с разных точек
// и для каждого пурпурного пикселя пускаем луч по «формуле мира». Если луч упирается в скалу, обращённую к
// камере, а на картинке там пусто — это щель между кусками или дыра в грубой копии. Пиксели щелей
// отмечаются красным в tools/out/seam-*.png.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
(async () => {
  const OUT = path.resolve(__dirname, 'out');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { window.__noAdapt = true; window.__giverFull = true; });
  await page.goto('file://' + path.resolve(__dirname, '../dist-full/giver.html'));
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
  await page.click('#go');
  await page.waitForTimeout(500);
  const spots = await page.evaluate(() => {
    const { L, W } = window.__giver, at = (th, r, y) => [Math.sin(th) * r, y, Math.cos(th) * r];
    // [положение камеры, куда смотреть]
    return {
      village: [[0, 4, L.settle.z + 20], [0, -60, 0]],
      lookout: [[0, 3, -(L.Rn - 6)], [0, -120, 60]],
      forest: [[L.aX, -18, L.aZ], [120, -60, 40]],
      ledges: [at(1.45, 150, -55), [0, -120, 0]],
      across: [at(0.0, 120, -90), [0, -150, -150]],
      camp: [at(-1.45, 120, -112), [100, -150, 50]],
      bottom: [[0, -195, 0], [0, -120, -170]],
      upward: [[20, -200, 20], [0, 0, 0]],
      boundary: [[-60.5, -100, 60.5], [60, -110, -60]],
    };
  });
  const res = {};
  for (const [name, [p, look]] of Object.entries(spots)) {
    res[name] = await page.evaluate(async ([name, p, look, process_env_double]) => {
      const g = window.__giver, gfx = g.gfx, W = g.W, THREE_V = g.player.pos.constructor;
      const R = gfx.renderer, scene = gfx.scene, cam = gfx.camera;
      g.game.running = false;
      // герой рядом, чтобы обновлялись куски и мелочь (подробный/грубый)
      cam.position.set(...p); cam.lookAt(...look); cam.updateMatrixWorld();
      // подробность кусков — как в игре для этой точки камеры
      const terrainUpdate = window.__giver.terrain && window.__giver.terrain.update;
      if (terrainUpdate) terrainUpdate(cam.position);
      const hidden = [];
      scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && !gfx.rockMeshes.includes(o) && o.visible) { o.visible = false; hidden.push(o); } });
      const fog = scene.fog, bg = scene.background.clone();
      scene.fog = null; scene.background.set('#ff00ff');
      const T = g.THREE;
      scene.overrideMaterial = new T.MeshBasicMaterial({ color: '#ffffff', side: process_env_double ? T.DoubleSide : T.FrontSide });
      const w = 320, h = 180;
      const rt = new T.WebGLRenderTarget(w, h);
      R.setRenderTarget(rt); R.render(scene, cam); R.setRenderTarget(null);
      const px = new Uint8Array(w * h * 4);
      R.readRenderTargetPixels(rt, 0, 0, w, h, px);
      scene.overrideMaterial = null; scene.fog = fog; scene.background.copy(bg);
      for (const o of hidden) o.visible = true;
      let gaps = 0, empty = 0;
      const dir = new THREE_V(), gapPix = [];
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        if (!(px[i] > 200 && px[i + 1] < 60 && px[i + 2] > 200)) continue;
        empty++;
        dir.set((x + 0.5) / w * 2 - 1, (y + 0.5) / h * 2 - 1, 0.5).unproject(cam).sub(cam.position).normalize();
        const maxT = Math.min(cam.far, 700);
        const t = W.raycast(cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z, maxT);
        if (t < 0) continue;
        const q = cam.position.clone().addScaledVector(dir, t);
        if (Math.hypot(q.x, q.z) > 495 || q.y < -228) continue;           // за краем запечённого мира
        const n = W.normal(q.x, q.y, q.z, new THREE_V());
        if (-n.dot(dir) < 0.35) continue;                                 // скользящий луч у силуэта — не щель
        gaps++;
        gapPix.push([x, y, +t.toFixed(0)]);
      }
      return { empty, gaps, sample: gapPix.slice(0, 6), w, h, px: gaps ? Array.from(px) : null, gapPix };
    }, [name, p, look, !!process.env.DOUBLE]);
    // картинка с отмеченными щелями
    const r = res[name];
    if (r.gaps) {
      // картинка PPM (без лишних библиотек): снизу вверх → сверху вниз, щели красным
      const rgb = Buffer.alloc(r.w * r.h * 3);
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const sI = ((r.h - 1 - y) * r.w + x) * 4, d = (y * r.w + x) * 3; rgb[d] = r.px[sI]; rgb[d + 1] = r.px[sI + 1]; rgb[d + 2] = r.px[sI + 2]; }
      for (const [x, y] of r.gapPix) { const d = ((r.h - 1 - y) * r.w + x) * 3; rgb[d] = 255; rgb[d + 1] = 0; rgb[d + 2] = 0; }
      fs.writeFileSync(path.join(OUT, `seam-${name}.ppm`), Buffer.concat([Buffer.from(`P6 ${r.w} ${r.h} 255\n`), rgb]));
    }
    delete r.px; delete r.gapPix;
    console.log(name.padEnd(9), `пусто ${r.empty}, щелей ${r.gaps}`, r.gaps ? JSON.stringify(r.sample) : '');
  }
  console.log(errs.join('\n') || 'без ошибок на странице');
  await browser.close();
})();
