// Замер кадра (SwiftShader, экран телефона 915×412 ×2.6): node spawn/tools/perf.cjs low|medium|high [вид]
const { chromium } = require('playwright');
(async () => {
  const q = process.argv[2] || 'low', view = process.argv[3] || 'overlook';
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6 });
  await page.goto('file://' + require('path').resolve(__dirname, '../../dist/spawn.html'));
  await page.waitForFunction(() => window.__spawn, null, { timeout: 120000 });
  const out = await page.evaluate(async ([q, view]) => {
    const S = window.__spawn, gfx = S.gfx; S.setQuality(q); S.setView(view);
    await new Promise((r) => setTimeout(r, 2000));
    const gl = gfx.renderer.getContext(), px = new Uint8Array(4);
    const time = (N) => { let t = 0; for (let i = 0; i < N; i++) { gfx.shadowDirty = true; const t0 = performance.now(); gfx.render(1 / 30); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); t += performance.now() - t0; } return Math.round(t / N); };
    time(3);
    const i = gfx.renderer.info.render;
    return { ms: time(6), calls: i.calls, tris: i.triangles, dpr: gfx.renderer.getPixelRatio() };
  }, [q, view]);
  console.log(q, view, JSON.stringify(out));
  await browser.close();
})();
