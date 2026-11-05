// Проверка (node tools/flows.cjs): падение в Бездну → экран «сорвался» → «Продолжить» (в посёлке);
// «Хват» пальцем у края, спуск по стене, отпустить и поймать стену в падении; лагерь у водопада — точка
// сохранения (после падения появляешься там); ягоды возвращают силы; пауза кнопкой «Назад».
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 853, height: 384 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.__noAdapt = true; window.__giverFull = true; });
  await page.goto('file://' + path.resolve(__dirname, '../dist-full/giver.html'));
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
  await page.click('#go');
  await page.waitForTimeout(500);
  const st = () => page.evaluate(() => { const P = window.__giver.player; return { state: P.state, pos: P.pos.toArray().map((v) => +v.toFixed(1)), hp: Math.round(P.health), st: Math.round(P.stamina), dead: !!P.dead }; });
  const ok = (cond, msg) => console.log((cond ? '✓ ' : '✗ ') + msg);
  const touch = async (type, id, x, y, target = '#layer') => page.evaluate(([type, id, x, y, target]) => {
    const el = document.querySelector(target);
    el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1 }));
  }, [type, id, x, y, target]);
  const press = async (id, sel) => { await touch('pointerdown', id, 0, 0, sel); await touch('pointerup', id, 0, 0, sel); };
  // поставить героя на край обрыва (угол th), лицом к Бездне
  const toRim = (th, off) => page.evaluate(([th, off]) => {
    const g = window.__giver, P = g.player, W = g.W;
    const r = W.pitR(Math.cos(th), Math.sin(th), 0) + off;
    P.spawn(new P.pos.constructor(Math.sin(th) * r, 2, Math.cos(th) * r));
    g.cam.yaw = th;                      // камера снаружи, «вперёд» — к центру Бездны
  }, [th, off]);

  // 1. шаг в Бездну с края (юго-восток, под ним глубоко)
  await toRim(1.0, 1.0);
  await page.waitForTimeout(300);
  const before = await st();
  await touch('pointerdown', 1, 150, 300);
  await touch('pointermove', 1, 150, 240);
  await page.waitForTimeout(1500);
  await touch('pointerup', 1, 150, 240);
  const falling = await st();
  ok(falling.state === 'air' || falling.dead, `шагнул с края: ${before.pos} → ${JSON.stringify(falling)}`);
  await page.waitForTimeout(4000);
  const deadShown = await page.evaluate(() => document.getElementById('sDead').classList.contains('show'));
  ok(deadShown, 'экран «сорвался»: ' + (await page.textContent('#deadTxt')));
  await page.click('#respawn');
  await page.waitForTimeout(800);
  const back = await st();
  ok(!back.dead && back.state === 'ground' && back.pos[1] > -2, 'после «Продолжить» — в посёлке: ' + JSON.stringify(back));

  // 2. «Хват» пальцем у края: повиснуть на стене под краем, спуститься, отпустить, поймать стену в падении
  await toRim(2.0, 0.7);
  await page.waitForTimeout(1800);                  // в SwiftShader кадр медленный — дать кнопке обновиться
  ok(await page.evaluate(() => document.getElementById('bGrab').classList.contains('ready')), 'кнопка «Хват» светится у края');
  await press(2, '#bGrab');
  await page.waitForTimeout(900);
  const hang = await st();
  ok(hang.state === 'climb', 'после «Хват» висит на стене: ' + JSON.stringify(hang) + ', надпись: ' + (await page.textContent('#grabLbl')));
  await touch('pointerdown', 3, 150, 250);
  await touch('pointermove', 3, 150, 320);       // джойстик вниз
  await page.waitForTimeout(2000);
  const down = await st();
  ok(down.state === 'climb' && down.pos[1] < hang.pos[1] - 2, `2 с вниз по стене: y ${hang.pos[1]} → ${down.pos[1]}, силы ${hang.st} → ${down.st}`);
  await touch('pointerup', 3, 150, 320);
  await press(4, '#bGrab');
  await page.waitForTimeout(120);
  const fall = await st();
  ok(fall.state === 'air', 'отпустил — падает: ' + fall.state);
  await press(5, '#bGrab');
  await page.waitForTimeout(300);
  const caught = await st();
  ok(caught.state === 'climb', 'поймал стену в падении: ' + JSON.stringify(caught));
  await page.screenshot({ path: path.resolve(__dirname, 'out', 'flow-climb.png') });

  // 3. лагерь у водопада — точка сохранения: дошли до него, потом сорвались — появляемся там
  const camp = await page.evaluate(async () => {
    const g = window.__giver, P = g.player, c = g.props.camps.find((c) => c.name === 'лагерь у водопада');
    P.spawn(c.pos.clone().add(new P.pos.constructor(2.5, 1, 0)));
    await new Promise((r) => setTimeout(r, 600));
    return { name: c.name, at: c.pos.toArray().map((v) => +v.toFixed(1)), saved: g.game.campName || '' };
  });
  ok(/водопад/.test(camp.saved), 'лагерь засчитан: ' + JSON.stringify(camp));
  await page.evaluate(() => { const P = window.__giver.player; P.hurt(1000, 'abyss'); });
  await page.waitForTimeout(700);
  await page.click('#respawn');
  await page.waitForTimeout(800);
  const atCamp = await st();
  ok(atCamp.pos[1] < -15 && atCamp.pos[1] > -35, 'после падения — у лагеря на террасе: ' + JSON.stringify(atCamp));

  // 4. ягоды: собрать «Действием» в рюкзак, устал — съел из рюкзака — силы вернулись
  const berry = await page.evaluate(async () => {
    const g = window.__giver, P = g.player, V = P.pos.constructor, b = g.ents.byKind('res').find((e) => e.type === 'berry' && !e.taken);
    if (!b) return null;
    let label = null;
    for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
      P.spawn(b.pos.clone().add(new V(dx, 1, dz)));
      await new Promise((r) => setTimeout(r, 300));
      if (P.interact && P.interact.item === b) { label = P.interact.label; g.act(); break; }
    }
    const got = g.inv.count('berry');
    P.stamina = 20;
    g.openBag();
    const btn = document.querySelector('#bagGrid [data-eat="berry"]');
    btn && btn.click();
    document.getElementById('bagClose').click();
    await new Promise((r) => setTimeout(r, 200));
    return { label, got, left: g.inv.count('berry'), st: Math.round(P.stamina) };
  });
  ok(berry && berry.st > 50, 'ягоды вернули силы: ' + JSON.stringify(berry));

  // 5. пауза кнопкой «Назад»
  const back1 = await page.evaluate(() => window.__onBack());
  await page.waitForTimeout(300);
  const paused = await page.evaluate(() => document.getElementById('sPause').classList.contains('show'));
  const back2 = await page.evaluate(() => window.__onBack());
  await page.waitForTimeout(300);
  ok(paused && back1 && back2 && (await page.evaluate(() => window.__giver.game.running)), `«Назад»: пауза ${paused}, снова «Назад» — играем`);
  console.log('HUD:', await page.textContent('#altV'), '|', await page.textContent('#altT'));
  console.log(errs.join('\n') || 'без ошибок на странице');
  await browser.close();
})();
