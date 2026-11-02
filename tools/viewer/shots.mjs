// Снимки запечённого мира с разных точек: node tools/viewer/shots.mjs [low|medium|high] → tools/out/view-*.png
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { SdfWorld } from '../../src/world/sdf.js';
import { buildLevel1, LEVEL_SEED } from '../../src/world/level1.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const W = new SdfWorld(LEVEL_SEED), L = buildLevel1(W);
const q = process.argv[2] || 'low';
const at = (th, r, y) => [Math.sin(th) * r, y, Math.cos(th) * r];
const R = (th, y) => W.pitR(Math.cos(th), Math.sin(th), y);
const views = {
  lookout: [[0, 3.2, L.lookout.b[2] - 3], [0, -90, -30]],
  overview: [[-260, 130, -260], [0, -110, 10]],
  east: [[-20, -45, -10], [140, -70, 20]],
  forest: [[L.aX - 30, -14, L.aZ + 52], [L.aX + 10, -26, L.aZ - 10]],
  floorUp: [[L.lake.x - 40, -196, L.lake.z + 40], [L.lake.x, -60, L.lake.z - 80]],
  mine: [[L.mine[2][0], L.mine[2][1] + 1.8, L.mine[2][2]], [L.hall.pos[0], L.hall.pos[1] - 1, L.hall.pos[2]]],
  camp: [[L.campD.center[0] + 40, -110, L.campD.center[2] + 30], [L.campD.center[0], -120, L.campD.center[2]]],
  village: [[L.settle.x + 40, 14, L.settle.z - 40], [L.settle.x, 0, L.settle.z + 30]],
};
const only = process.argv[3];
(async () => {
  const OUT = path.resolve('tools/out');
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + path.resolve('dist/view.html') + '?q=' + q);
  await page.waitForFunction(() => window.__view, null, { timeout: 60000 });
  for (const [name, [p, t]] of Object.entries(views)) {
    if (only && only !== name) continue;
    await page.evaluate(([p, t]) => { window.__view.look(p[0], p[1], p[2], t[0], t[1], t[2]); window.__view.look(p[0], p[1], p[2], t[0], t[1], t[2]); }, [p, t]);
    await page.screenshot({ path: path.join(OUT, `view-${name}-${q}.png`) });
    console.log('снимок', name);
  }
  console.log(errs.join('\n') || 'без ошибок');
  await browser.close();
})();
