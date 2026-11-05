// Скриншоты пробной сцены: node spawn/tools/shot.cjs [качество] [папка] [масштаб]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const q = process.argv[2] || 'low', out = process.argv[3] || '.', dsf = +(process.argv[4] || 1);
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: dsf });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[' + m.type() + ']', m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const t0 = Date.now();
  await page.goto('file://' + path.resolve(__dirname, '../../dist/spawn.html'));
  await page.waitForFunction(() => window.__spawn, null, { timeout: 120000 });
  console.log('загрузка', Date.now() - t0, 'мс');
  await page.evaluate((q) => { window.__spawn.setQuality(q); document.getElementById('title').style.display = 'none'; }, q);
  const views = (process.argv[5] || 'start,overlook,down,village,above').split(',');
  for (const v of views) {
    await page.evaluate((v) => { window.__spawn.setView(v); }, v);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${v}-${q}.png`, timeout: 120000 });
    const info = await page.evaluate(() => { const i = window.__spawn.gfx.renderer.info.render; return { calls: i.calls, tris: i.triangles }; });
    console.log(v, JSON.stringify(info));
  }
  await browser.close();
})();
