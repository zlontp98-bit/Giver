// Замер: сколько миллисекунд рисуется кадр в разных местах первого яруса и что сколько стоит.
// Запуск: node tools/perf.cjs low|medium|high [место]. Экран 915×412 ×2.6 (как телефон), SwiftShader —
// цифры только для сравнения между версиями (на телефоне всё в разы быстрее).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6 });
  await page.addInitScript(() => { window.__noAdapt = true; });
  await page.goto('file://' + path.resolve(__dirname, '../dist/giver.html'));
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
  await page.click('#go');
  await page.waitForTimeout(500);
  const q = process.argv[2] || 'low', only = process.argv[3];
  const out = await page.evaluate(async ([q, only]) => {
    const g = window.__giver, P = g.player, L = g.L, W = g.W, gfx = g.gfx, scene = gfx.scene, V = P.pos.constructor;
    g.game.running = false;
    g.setQuality(q);
    const R = (th, y) => W.pitR(Math.cos(th), Math.sin(th), y);
    const at = (th, d, y) => { const r = R(th, y) - d; return new V(Math.sin(th) * r, y, Math.cos(th) * r); };
    // места: [где, куда смотреть]
    const spots = {
      village: [new V(L.settle.x + 6, 1, L.settle.z + 8), 0],
      lookout: [new V(L.lookout.b[0], 1, L.lookout.b[2] - 2), Math.PI],
      forest: [new V(L.aX - 20, -24, L.aZ + 10), Math.PI + 0.9],
      ledges: [at(1.45, 2, -56), 1.45 + Math.PI / 2],
      mine: [new V(L.mine[1][0], L.mine[1][1] + 1, L.mine[1][2]), 0.7],
      camp: [new V(L.campD.center[0], -118, L.campD.center[2]), L.campD.th],
      bottom: [new V(L.lake.x - 30, -203, L.lake.z - 26), Math.PI + 0.7],
    };
    const gl = gfx.renderer.getContext(), px = new Uint8Array(4);
    const time = (N = 4) => { let tot = 0; for (let i = 0; i < N; i++) { gfx.shadowDirty = true; const t0 = performance.now(); gfx.render(1 / 30); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); tot += performance.now() - t0; } return Math.round(tot / N); };
    const res = {};
    for (const [name, [p, yaw]] of Object.entries(spots)) {
      if (only && only !== name) continue;
      P.spawn(p); g.cam.yaw = yaw; g.cam.pitch = 0.15;
      await new Promise((r) => setTimeout(r, 1200));     // кадры обновят камеру, куски и мелочь
      time(2);
      const r = { ms: time(5) };
      const info = gfx.renderer.info.render;
      r.calls = info.calls; r.tris = info.triangles;
      if (only) {
        // по очереди прячем группы и смотрим, сколько стало
        const hide = (test) => { const h = []; scene.traverse((o) => { if (o.visible && test(o)) { o.visible = false; h.push(o); } }); return () => h.forEach((o) => { o.visible = true; }); };
        for (const [k, test] of Object.entries({
          noTerrain: (o) => o.isMesh && o.geometry && o.geometry.attributes.aLit,
          noInstanced: (o) => o.isInstancedMesh,
          noPoints: (o) => o.isPoints,
          noWater: (o) => o.isMesh && o.material && o.material.type === 'ShaderMaterial' && o !== gfx.sky,
        })) { const undo = hide(test); time(1); r[k] = time(4); undo(); }
      }
      res[name] = r;
    }
    res.pixelRatio = gfx.renderer.getPixelRatio();
    return res;
  }, [q, only]);
  console.log(q, JSON.stringify(out));
  await browser.close();
})();
