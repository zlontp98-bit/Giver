// Замер: сколько миллисекунд рисуется кадр на стене (глубина 40 м) и что сколько стоит. Запуск: node tools/perf.cjs low|medium|high
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6 });
  await page.addInitScript(() => { window.__noAdapt = true; });
  await page.goto('file://' + require('path').resolve(__dirname, '../dist/giver.html'));
  await page.waitForFunction(() => window.__giver, null, { timeout: 60000 });
  await page.click('#go');
  await page.waitForTimeout(500);
  const q = process.argv[2] || 'low';
  const out = await page.evaluate(async (q) => {
    const g = window.__giver, P = g.player, D = g.descent, gfx = g.gfx, scene = gfx.scene;
    g.game.running = false;
    g.setQuality(q);
    const spot = D.route.find((s) => s.to && s.to.y < -38).to;
    P.spawn(spot);
    await new Promise((r) => setTimeout(r, 1500));
    const gl = gfx.renderer.getContext(), px = new Uint8Array(4);
    const time = (N = 4) => { let tot = 0; for (let i = 0; i < N; i++) { gfx.shadowDirty = true; const t0 = performance.now(); gfx.render(1 / 30); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); tot += performance.now() - t0; } return Math.round(tot / N); };
    time(3); const res = { base: time(6) };
    const info = gfx.renderer.info.render;
    res.calls = info.calls; res.tris = info.triangles;
    // по очереди прячем группы и смотрим, сколько стало
    const lights = []; scene.traverse((o) => { if (o.isPointLight) lights.push(o); });
    const rockGroup = gfx.rockMeshes[0].parent;
    const tests = {
      noRock: [() => { rockGroup.visible = false; }, () => { rockGroup.visible = true; }],
      noWallOnly: [() => { gfx.rockMeshes.slice(0, 60).forEach((m) => { m.visible = false; }); }, () => { gfx.rockMeshes.slice(0, 60).forEach((m) => { m.visible = true; }); }],
      noPointLights: [() => lights.forEach((l) => { l.userData.i = l.intensity; l.intensity = 0; l.visible = false; }), () => lights.forEach((l) => { l.visible = true; l.intensity = l.userData.i; })],
      noInstanced: [() => scene.traverse((o) => { if (o.isInstancedMesh) { o.userData.v = o.visible; o.visible = false; } }), () => scene.traverse((o) => { if (o.isInstancedMesh) o.visible = o.userData.v; })],
      noPoints: [() => scene.traverse((o) => { if (o.isPoints || o.isSprite) { o.userData.v = o.visible; o.visible = false; } }), () => scene.traverse((o) => { if (o.isPoints || o.isSprite) o.visible = o.userData.v; })],
      noSky: [() => { gfx.sky.visible = false; }, () => { gfx.sky.visible = true; }],
    };
    for (const [k, [a, b]] of Object.entries(tests)) { a(); time(1); res[k] = time(5); b(); } res.base2 = time(6);
    res.pixelRatio = gfx.renderer.getPixelRatio();
    return res;
  }, q);
  console.log(q, JSON.stringify(out));
  await browser.close();
})();
