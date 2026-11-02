// Скриншоты игры в разных местах мира: node tools/shots.cjs [low|medium|high] [имя] → tools/out/s-*.png
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const q = process.argv[2] || 'low', only = process.argv[3];
(async () => {
  const OUT = path.resolve(__dirname, 'out');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 853, height: 384 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.__noAdapt = true; });
  await page.goto('file://' + path.resolve(__dirname, '../dist/giver.html'));
  await page.waitForFunction(() => window.__giver, null, { timeout: 90000 });
  await page.evaluate((q) => window.__giver.setQuality(q), q);
  await page.click('#go');
  await page.waitForTimeout(500);
  // места: [x, y, z] героя, куда смотреть (yaw камеры), наклон камеры
  const spots = await page.evaluate(() => {
    const { L, W } = window.__giver, at = (th, r, y) => [Math.sin(th) * r, y, Math.cos(th) * r];
    const R = (th, y) => W.pitR(Math.cos(th), Math.sin(th), y);
    return {
      village: [[L.settle.x + 6, 1, L.settle.z + 8], Math.PI + 0.5, 0.25],
      lookout: [[L.lookout.b[0], 1, L.lookout.b[2] - 2], Math.PI, 0.18],
      forest: [[L.aX - 20, -24, L.aZ + 10], Math.PI + 0.9, 0.2],
      waterfall: [[L.poolA.x - 16, -22, L.poolA.z + 8], -0.6, 0.15],
      ledges: [at(1.5, R(1.5, -55) - 3, -54), 1.5 + Math.PI + 0.4, 0.2],
      mine: [[L.mine[1][0], L.mine[1][1], L.mine[1][2]], Math.atan2(L.mine[0][0] - L.mine[2][0], L.mine[0][2] - L.mine[2][2]), 0.1],
      hall: [[L.hall.pos[0], L.hall.floor, L.hall.pos[2]], 0.5, 0.15],
      camp: [[L.campD.center[0] + 6, -119, L.campD.center[2] + 6], L.campD.th, 0.25],
      bottom: [[L.lake.x - 30, -203, L.lake.z - 26], Math.PI + 0.7, 0.05],
      gate: [[L.gate.inner[0] + (L.gate.inner[0] - L.gate.outer[0]) * 0.4, -203, L.gate.inner[2] + (L.gate.inner[2] - L.gate.outer[2]) * 0.4], Math.atan2(L.gate.inner[0] - L.gate.outer[0], L.gate.inner[2] - L.gate.outer[2]), 0.12],
    };
  });
  for (const [name, [p, yaw, pitch]] of Object.entries(spots)) {
    if (only && only !== name) continue;
    await page.evaluate(([p, yaw, pitch]) => {
      const g = window.__giver, P = g.player;
      g.game.running = false;
      P.spawn(new P.pos.constructor(p[0], p[1], p[2]));
      g.cam.yaw = yaw; g.cam.pitch = pitch;
      document.body.classList.add('playing');
    }, [p, yaw, pitch]);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(OUT, `s-${name}-${q}.png`) });
    const info = await page.evaluate(() => { const g = window.__giver, r = g.gfx.renderer.info.render; return { y: +g.player.pos.y.toFixed(1), state: g.player.state, tris: r.triangles, calls: r.calls }; });
    console.log(name, JSON.stringify(info));
  }
  console.log(errs.join('\n') || 'без ошибок');
  await browser.close();
})();
