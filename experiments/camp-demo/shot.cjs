const { chromium } = require('playwright');
(async () => {
  const dir = process.argv[2];
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 })).newPage();
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text().slice(0, 400)); });
  await page.goto('file://' + dir + '/camp.html#shot');
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 120000 });
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.waitForTimeout(1500);
  const shots = [[1, true, true, 'a-camp'], [2, true, true, 'b-wide'], [3, true, true, 'c-close'], [1, false, false, 'd-before']];
  for (const [v, fx, tx, name] of shots) {
    await page.evaluate(([v, fx, tx]) => { const d = window.__demo; d.setFx(fx); d.setTextures(tx); d.view(v); d.controls.autoRotate = false; d.render(); d.render(); }, [v, fx, tx]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${name}.png` });
    console.log('shot', name);
  }
  await browser.close();
})();
