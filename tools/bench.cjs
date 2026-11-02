// Проверка (node tools/bench.cjs): старое сохранение переводится в новый формат, счётчик FPS,
// «Замер» (30 с) с итогом и возвратом героя на место, прерывание «Замера» кнопкой «Назад»,
// настройки и история замеров сохраняются после перезапуска. Скриншоты — в tools/out/.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const OUT = path.resolve(__dirname, 'out');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const url = 'file://' + path.resolve(__dirname, '../dist/giver.html');
  await page.addInitScript(() => { window.__noAdapt = true; });
  await page.goto(url);
  await page.waitForFunction(() => window.__giver, null, { timeout: 60000 });
  // кладём сохранение версии 0.4 (плоское) и перезапускаем — игра должна перевести его в новый формат
  await page.evaluate(() => localStorage.setItem('giver_v1', JSON.stringify({ quality: 'high', quality2: 'medium', best: 200, bestStars: 20, best2: 300.5, bestShards2: 40 })));
  await page.reload();
  await page.waitForFunction(() => window.__giver, null, { timeout: 60000 });
  const check = (name, ok, extra = '') => console.log(`${ok ? 'OK ' : 'ОШИБКА'} ${name}${extra ? ' — ' + extra : ''}`);
  const s0 = await page.evaluate(() => window.__giver.save.data);
  check('перевод сохранения 0.4', s0.v === 2 && s0.settings.quality === 'medium' && s0.records.abyss.time === 300.5 && s0.records.abyss.shards === 40 && s0.records.mountain.stars === 20, JSON.stringify(s0));
  check('рекорд на старте', (await page.textContent('#best')) === 'Рекорд: 5:00 · осколков 40', await page.textContent('#best'));
  check('версия на старте', /версия \S+/.test(await page.textContent('#sStart .ver')), await page.textContent('#sStart .ver'));
  check('качество из сохранения', (await page.evaluate(() => window.__giver.gfx.quality)) === 'medium');
  await page.click('#sStart [data-quality] button[data-q="low"]');      // как игрок: кнопкой в меню (запоминается)
  await page.click('#go');
  await page.waitForTimeout(400);
  // включить счётчик FPS в паузе
  await page.click('#pause');
  await page.click('[data-fps] button[data-v="1"]');
  await page.click('#resume');
  await page.waitForTimeout(1500);
  const fpsTxt = await page.textContent('#fps');
  check('счётчик FPS', /^\d+ FPS · кадр \d+ мс · ЦП [\d.]+ мс$/.test(fpsTxt) && await page.isVisible('#fps'), fpsTxt);
  await page.screenshot({ path: path.join(OUT, 'fps-counter.png') });
  // «Замер»
  const before = await page.evaluate(() => window.__giver.player.pos.toArray());
  await page.click('#pause');
  await page.click('#bench');
  await page.waitForTimeout(12000);
  check('идёт замер', await page.evaluate(() => window.__giver.bench.running && document.body.classList.contains('bench')), await page.textContent('#benchLeft'));
  await page.screenshot({ path: path.join(OUT, 'bench-running.png') });
  await page.waitForFunction(() => document.getElementById('sBench').classList.contains('show'), null, { timeout: 60000 });
  const res = await page.evaluate(() => ({ fps: document.getElementById('bFps').textContent, load: document.getElementById('bLoad').textContent,
    low: document.getElementById('bLow').textContent, cpu: document.getElementById('bCpu').textContent, info: document.getElementById('bInfo').textContent,
    saved: window.__giver.save.data.bench.length, pos: window.__giver.player.pos.toArray() }));
  check('итог замера', +res.fps > 0 && res.saved === 1, JSON.stringify(res));
  check('герой вернулся на место', res.pos.every((v, i) => Math.abs(v - before[i]) < 1e-6));
  await page.screenshot({ path: path.join(OUT, 'bench-result.png') });
  await page.click('#benchOk');
  check('после замера — пауза', await page.isVisible('#sPause'));
  // прервать замер кнопкой «Назад»
  await page.click('#bench');
  await page.waitForTimeout(3000);
  const back = await page.evaluate(() => window.__onBack());
  await page.waitForTimeout(300);
  check('«Назад» прерывает замер', back && !(await page.evaluate(() => window.__giver.bench.running)) && await page.isVisible('#sPause') &&
    (await page.evaluate(() => window.__giver.save.data.bench.length)) === 1);
  await page.click('#resume');
  await page.waitForTimeout(500);
  check('игра продолжается', await page.evaluate(() => window.__giver.game.running));
  // перезапуск: настройки и история на месте
  await page.reload();
  await page.waitForFunction(() => window.__giver, null, { timeout: 60000 });
  const s1 = await page.evaluate(() => window.__giver.save.data);
  check('после перезапуска', s1.settings.quality === 'low' && s1.settings.showFps === true && s1.bench.length === 1 && s1.records.abyss.time === 300.5, JSON.stringify(s1.settings));
  console.log(errs.join('\n') || 'без ошибок на странице');
  await browser.close();
})();
