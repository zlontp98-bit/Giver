// Что сколько стоит: прячем группы по очереди. node spawn/tools/breakdown.cjs low overlook
const { chromium } = require('playwright');
(async () => {
  const q = process.argv[2] || 'low', view = process.argv[3] || 'overlook';
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6 });
  await page.goto('file://' + require('path').resolve(__dirname, '../../dist/spawn.html'));
  await page.waitForFunction(() => window.__spawn, null, { timeout: 120000 });
  const out = await page.evaluate(async ([q, view]) => {
    const S = window.__spawn, gfx = S.gfx, scene = gfx.scene; S.setQuality(q); S.setView(view);
    await new Promise((r) => setTimeout(r, 2000));
    const gl = gfx.renderer.getContext(), px = new Uint8Array(4);
    const time = (N) => { let t = 0; for (let i = 0; i < N; i++) { const t0 = performance.now(); gfx.render(1 / 30); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); t += performance.now() - t0; } return Math.round(t / N); };
    time(2);
    const res = { base: time(4) };
    const groups = {
      transparent: (o) => o.material && !Array.isArray(o.material) && o.material.transparent && !o.isSprite,
      sprites: (o) => o.isSprite,
      points: (o) => o.isPoints,
      instanced: (o) => o.isInstancedMesh,
      rock: (o) => gfx.rockMeshes.includes(o),
      sky: (o) => o === gfx.sky,
      other: (o) => o.isMesh && !o.isInstancedMesh && !gfx.rockMeshes.includes(o) && o !== gfx.sky && !(o.material && o.material.transparent),
    };
    for (const [k, f] of Object.entries(groups)) {
      const hid = []; scene.traverse((o) => { if (f(o) && o.visible) { o.visible = false; hid.push(o); } });
      time(1); res[k] = time(3); hid.forEach((o) => { o.visible = true; });
    }
    // по одному InstancedMesh
    const ims = []; scene.traverse((o) => { if (o.isInstancedMesh) ims.push(o); });
    res.inst = ims.map((o) => { o.visible = false; time(1); const t = time(2); o.visible = true; return `${o.count}x${o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3}:${t}`; }).join(' ');
    return res;
  }, [q, view]);
  console.log(q, view, JSON.stringify(out));
  await browser.close();
})();
