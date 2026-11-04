// Сохранение и смерть (node tools/survive.cjs): вещи остаются в рюкзаке на месте гибели (снаряжение — с героем),
// подсказка, где рюкзак; второй рюкзак при второй гибели; после перезапуска — рюкзаки, место героя, силы, лагеря,
// время на месте; рюкзак забирается «Действием» (полный рюкзак — часть остаётся); гибель в полёте над Бездной —
// рюкзак падает на землю; «Заново» — новая игра (рекорды и настройки остаются).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 853, height: 384 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.__noAdapt = true; window.__giverFull = true; });
  const url = 'file://' + path.resolve(__dirname, '../dist/giver.html');
  const r = [];
  const ok = (c, m) => r.push((c ? '✓ ' : '✗ ') + m);
  // помощники внутри страницы: упасть с высоты h над точкой (x, z)
  const helpers = () => {
    const g = window.__giver, P = g.player, V = P.pos.constructor;
    const blank = () => ({ mx: 0, my: 0, jump: false, hook: false, grab: false });
    const fall = (x, z, h) => {
      const gy = g.physics.ground(x, 50, z, 1, 400).y;
      P.spawn(new V(x, gy + 1, z));
      P.pos.y = gy + h; P.state = 'air'; P.vel.set(0, 0, 0); P.peakY = P.pos.y;
      for (let k = 0; k < 600 && !P.dead; k++) g.step(blank());
      return gy;
    };
    return { g, P, V, blank, fall };
  };

  const boot = async () => {
    await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
    const go = await page.textContent('#go');
    await page.click('#go');
    await page.waitForTimeout(300);
    await page.evaluate((src) => { window.__giver.game.running = false; window.__h = src; }, helpers.toString());
    return go;
  };
  await page.goto(url);
  await page.evaluate(() => localStorage.removeItem('giver_v1'));
  await page.goto(url);
  const go0 = await boot();
  ok(go0 === 'Играть', `новая игра — кнопка «${go0}»`);


  // 1. гибель с вещами
  const one = await page.evaluate(() => {
    const { g, P, fall } = eval(`(${window.__h})()`);
    g.state.gear.pickaxe = true;
    g.state.inv = { wood: 5, ore: 3, berry: 4 };
    const L = g.L, x = L.aX - 20, z = L.aZ - 6;                  // терраса Лесной окраины
    const gy = fall(x, z, 45);
    const pk = g.packs.list();
    return { dead: P.dead, inv: { ...g.state.inv }, gear: Object.keys(g.state.gear), packs: pk.map((e) => ({ items: e.items, y: +e.pos.y.toFixed(1) })), gy: +gy.toFixed(1) };
  });
  ok(one.dead && !Object.keys(one.inv).length && one.packs.length === 1 && one.packs[0].items.wood === 5 && Math.abs(one.packs[0].y - one.gy) < 1 && one.gear.includes('pickaxe'),
    `гибель: рюкзак пуст, вещи на земле ${JSON.stringify(one.packs)} (земля ${one.gy}), снаряжение с героем: ${one.gear}`);
  await page.waitForTimeout(900);
  const deadTxt = await page.textContent('#deadTxt');
  ok(/рюкзаке/.test(deadTxt), `экран гибели: «${deadTxt}»`);
  await page.click('#respawn');
  await page.waitForTimeout(500);
  const hint = await page.evaluate(() => { const g = window.__giver; g.game.running = false; return { show: !document.getElementById('packChip').classList.contains('hide'), txt: document.getElementById('packD').textContent, pos: g.player.pos.toArray().map((v) => +v.toFixed(1)) }; });
  ok(hint.show && /рюкзак \d+ м/.test(hint.txt), `после гибели — в лагере ${JSON.stringify(hint.pos)}, подсказка «${hint.txt}»`);

  // 2. вторая гибель, не дойдя до первого рюкзака
  const two = await page.evaluate(() => {
    const { g, P, fall } = eval(`(${window.__h})()`);
    g.state.inv = { stone: 6 };
    const L = g.L;
    fall(L.aX - 40, L.aZ - 16, 40);
    return { dead: P.dead, packs: g.packs.list().map((e) => e.items) };
  });
  ok(two.dead && two.packs.length === 2, `вторая гибель — второй рюкзак: ${JSON.stringify(two.packs)}`);
  await page.waitForTimeout(900);
  await page.click('#respawn');
  await page.waitForTimeout(300);

  // 3. место героя, силы, лагерь сохраняются; перезапуск
  const before = await page.evaluate(() => {
    const { g, P, V, blank } = eval(`(${window.__h})()`);
    g.game.running = false;
    const L = g.L, x = L.aX - 30, z = L.aZ - 2, gy = g.physics.ground(x, 50, z, 1, 400).y;
    P.spawn(new V(x, gy + 1, z));
    for (let k = 0; k < 30; k++) g.step(blank());
    P.health = 64; P.stamina = 41;
    g.game.running = true;
    return { pos: P.pos.toArray(), camp: g.game.campName, elapsed: g.game.elapsed };
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__giver.game.running = false; window.__giver.savePlayer(true); });
  await page.reload();
  const go1 = await boot();
  const after = await page.evaluate(() => {
    const g = window.__giver, P = g.player;
    return { pos: P.pos.toArray(), hp: P.health, st: P.stamina, camp: g.game.campName, elapsed: g.game.elapsed, packs: g.packs.list().length, chip: !document.getElementById('packChip').classList.contains('hide') };
  });
  const dist = Math.hypot(...after.pos.map((v, i) => v - before.pos[i]));
  ok(go1 === 'Продолжить' && dist < 0.6 && after.hp >= 64 && after.hp < 70 && after.st >= 41 && after.st < 60 && after.camp === before.camp && after.elapsed >= before.elapsed && after.packs === 2,
    `после перезапуска: кнопка «${go1}», место ±${dist.toFixed(2)} м, здоровье ${after.hp}, силы ${after.st}, лагерь «${after.camp}», время ${after.elapsed.toFixed(1)} с, рюкзаков ${after.packs}`);

  // 4. забрать рюкзаки: первый целиком, второй в полный рюкзак — часть остаётся
  const take = await page.evaluate(() => {
    const { g, P, V, blank } = eval(`(${window.__h})()`);
    const reach = (e) => {
      for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
        P.spawn(e.pos.clone().add(new V(dx, 1, dz)));
        for (let k = 0; k < 40; k++) g.step(blank());
        if (P.interact && P.interact.item === e) return P.interact.label;
      }
      return null;
    };
    const [a, b] = g.packs.list().sort((p, q) => p.n - q.n);
    const la = reach(a); g.act();
    const first = { label: la, inv: { ...g.state.inv }, left: g.packs.list().length };
    g.state.inv = { wood: 30, ore: 30, berry: 15, mushroom: 1 };     // 8 ячеек, место — только под грибы
    reach(b); g.act();
    const bLeft = g.packs.list().find((e) => e.id === b.id);
    return { first, second: { inv: { ...g.state.inv }, still: bLeft ? bLeft.items : null } };
  });
  ok(take.first.label === 'забрать рюкзак' && take.first.inv.wood === 5 && take.first.inv.ore === 3 && take.first.inv.berry === 4 && take.first.left === 1,
    `забрал первый рюкзак («${take.first.label}»): ${JSON.stringify(take.first.inv)}, осталось рюкзаков ${take.first.left}`);
  ok(take.second.still && take.second.still.stone === 6, `рюкзак полон — второй остался лежать: ${JSON.stringify(take.second.still)}`);

  // 5. гибель в полёте над Бездной — рюкзак на земле внизу, а не в воздухе
  const air = await page.evaluate(() => {
    const { g, P, V, blank } = eval(`(${window.__h})()`);
    g.state.inv = { ingot: 2 };
    P.spawn(new V(0, -60, 0)); P.pos.set(0, -40, 30); P.state = 'air'; P.vel.set(0, 0, 0); P.peakY = -40;
    for (let k = 0; k < 900 && !P.dead; k++) g.step(blank());
    const pk = g.packs.list().find((e) => e.items.ingot);
    return { dead: P.dead, y: pk ? +pk.pos.y.toFixed(1) : null, ground: pk ? +g.physics.ground(pk.pos.x, pk.pos.y + 1, pk.pos.z, 1.5, 5).y.toFixed(1) : null };
  });
  ok(air.dead && air.y !== null && air.y < -150 && Math.abs(air.y - air.ground) < 0.3, `гибель в полёте: рюкзак на земле, y ${air.y} (опора ${air.ground})`);
  await page.waitForTimeout(900);
  await page.click('#respawn');
  await page.waitForTimeout(300);

  // 6. «Заново»: новая игра — рюкзаков, вещей, снаряжения нет, герой в посёлке; настройки и рекорды на месте
  await page.evaluate(() => { const g = window.__giver; g.save.settings.quality = 'medium'; g.save.records.layer1 = { time: 500 }; g.save.write(); });
  await page.click('#pause');
  await page.click('#restart');
  const confirmShown = await page.isVisible('#sConfirm');
  await page.click('#confirmNo');
  const backToPause = await page.isVisible('#sPause');
  await page.click('#restart');
  await Promise.all([page.waitForNavigation(), page.click('#confirmYes')]);
  const go2 = await boot();
  const fresh = await page.evaluate(() => { const g = window.__giver; return { packs: g.packs.list().length, inv: Object.keys(g.state.inv).length, gear: Object.keys(g.state.gear).length, y: +g.player.pos.y.toFixed(1), q: g.save.settings.quality, rec: g.save.records.layer1 && g.save.records.layer1.time }; });
  ok(confirmShown && backToPause && go2 === 'Играть' && fresh.packs === 0 && !fresh.inv && !fresh.gear && fresh.y > -2 && fresh.q === 'medium' && fresh.rec === 500,
    `«Заново» (спросил, «Нет» — назад в паузу): ${JSON.stringify(fresh)}, кнопка «${go2}»`);

  console.log(r.join('\n'));
  console.log(errs.join('\n') || 'без ошибок на странице');
  await browser.close();
})();
