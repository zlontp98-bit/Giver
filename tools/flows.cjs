// Проверка (node tools/flows.cjs): падение в бездну → экран «сорвался» → «Продолжить»; «Хват» пальцем у края; пауза кнопкой «Назад».
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.__noAdapt = true; });
  await page.goto('file://' + require('path').resolve(__dirname, '../dist/giver.html'));
  await page.waitForFunction(() => window.__giver, null, { timeout: 60000 });
  await page.click('#go');
  await page.waitForTimeout(500);
  const st = () => page.evaluate(() => { const P = window.__giver.player; return { state: P.state, y: +P.pos.y.toFixed(2), hp: Math.round(P.health), st: Math.round(P.stamina), dead: !!P.dead }; });
  // 1. шагнуть в бездну подальше от мостков (угол π/2)
  await page.evaluate(() => {
    const g = window.__giver, P = g.player, A = g.abyss;
    const th = Math.PI / 2, r = A.wallR(th, 0) + 0.3;
    P.spawn(new P.pos.constructor(Math.sin(th) * r, 0, Math.cos(th) * r));
    g.cam.yaw = th;                      // камера снаружи, «вперёд» — к центру
  });
  // держим джойстик вперёд пальцем (левая половина экрана)
  const touch = async (type, id, x, y, target = '#layer') => page.evaluate(([type, id, x, y, target]) => {
    const el = document.querySelector(target);
    el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1 }));
  }, [type, id, x, y, target]);
  await touch('pointerdown', 1, 150, 300);
  await touch('pointermove', 1, 150, 240);
  await page.waitForTimeout(1500);
  await touch('pointerup', 1, 150, 240);
  console.log('после шага в бездну:', await st());
  await page.waitForTimeout(4000);
  console.log('через 4 с:', await st(), 'экран:', await page.evaluate(() => document.getElementById('sDead').classList.contains('show')), await page.textContent('#deadTxt'));
  await page.click('#respawn');
  await page.waitForTimeout(800);
  console.log('после «Продолжить»:', await st());
  // 2. «Хват» у края пальцем
  await page.evaluate(() => {
    const g = window.__giver, P = g.player, A = g.abyss;
    const th = 2.0, r = A.wallR(th, 0) + 0.6;
    P.spawn(new P.pos.constructor(Math.sin(th) * r, 0, Math.cos(th) * r));
    g.cam.yaw = th;
  });
  await page.waitForTimeout(300);
  console.log('кнопка «Хват» светится:', await page.evaluate(() => document.getElementById('bGrab').classList.contains('ready')));
  await touch('pointerdown', 2, 0, 0, '#bGrab');
  await touch('pointerup', 2, 0, 0, '#bGrab');
  await page.waitForTimeout(900);
  console.log('после «Хват»:', await st(), 'надпись:', await page.textContent('#grabLbl'));
  await touch('pointerdown', 3, 150, 250);
  await touch('pointermove', 3, 150, 320);       // вниз
  await page.waitForTimeout(2000);
  console.log('2 с вниз по стене:', await st());
  await touch('pointerup', 3, 150, 320);
  await touch('pointerdown', 4, 0, 0, '#bGrab');
  await touch('pointerup', 4, 0, 0, '#bGrab');
  await page.waitForTimeout(150);
  console.log('отпустил:', await st());
  // поймаемся обратно, пока падаем у стены
  await touch('pointerdown', 5, 0, 0, '#bGrab');
  await touch('pointerup', 5, 0, 0, '#bGrab');
  await page.waitForTimeout(300);
  console.log('снова «Хват» в падении:', await st());
  await page.screenshot({ path: 'flow-climb.png' });
  // 3. пауза кнопкой «Назад»
  const back1 = await page.evaluate(() => window.__onBack());
  await page.waitForTimeout(300);
  const paused = await page.evaluate(() => document.getElementById('sPause').classList.contains('show'));
  const back2 = await page.evaluate(() => window.__onBack());
  await page.waitForTimeout(300);
  console.log('Назад:', back1, 'пауза:', paused, 'снова Назад:', back2, 'играем:', await page.evaluate(() => window.__giver.game.running));
  console.log('HUD:', await page.textContent('#altV'), '|', await page.textContent('#altT'), '|', await page.textContent('#stars'));
  console.log(errs.join('\n') || 'без ошибок');
  await browser.close();
})();
