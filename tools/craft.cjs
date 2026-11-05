// Ресурсы и крафт (node tools/craft.cjs): собрать дерево и камень → кирка у верстака → руда в шахте →
// слитки в печи → шипы, стальной трос, крюк-кошка → похлёбка; снаряжение действительно меняет возможности;
// рюкзак ограничен; ресурсы вырастают снова; после перезапуска рюкзак и снаряжение на месте.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 853, height: 384 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.__noAdapt = true; window.__giverFull = true; });
  const url = 'file://' + path.resolve(__dirname, '../dist-full/giver.html');
  await page.goto(url);
  await page.evaluate(() => localStorage.removeItem('giver_v1'));
  await page.goto(url);
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
  await page.click('#go');
  await page.waitForTimeout(300);
  const out = await page.evaluate(() => {
    const g = window.__giver, P = g.player, V = P.pos.constructor, inv = g.inv, st = g.state, r = [];
    const ok = (c, m) => r.push((c ? '✓ ' : '✗ ') + m);
    const blank = () => ({ mx: 0, my: 0, jump: false, hook: false, grab: false });
    g.game.running = false;
    const close = () => { for (const id of ['sCraft', 'sBag']) document.getElementById(id).classList.remove('show'); g.game.running = false; };
    // подойти к сущности и нажать «Действие»
    const actAt = (e, offs = [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [0.9, 0.9], [-0.9, -0.9]]) => {
      for (const [dx, dz] of offs) {
        P.spawn(e.pos.clone().add(new V(dx, 1, dz)));
        for (let k = 0; k < 40; k++) g.step(blank());
        g.step(blank());
        if (P.interact && P.interact.item === e) break;
      }
      const it = P.interact;
      const label = it ? it.label : '(нет кнопки)';
      if (it && it.item === e) g.act();
      close();
      return label;
    };
    const res = (type) => g.ents.byKind('res').filter((e) => e.type === type && !e.taken);
    // 1. дерево и камень
    let lbl = '';
    for (const e of res('wood').slice(0, 3)) lbl = actAt(e);
    for (const e of res('stone').slice(0, 2)) actAt(e);
    ok(inv.count('wood') === 6 && inv.count('stone') === 4, `собрал дерево ${inv.count('wood')} и камень ${inv.count('stone')} (кнопка: «${lbl}»)`);
    // завал в шахте: без кирки не пройти (идём по штреку к каморке)
    const rub = g.ents.get('rubble:mine'), room = g.L.secrets.mineRoom;
    const walkTo = (from, to, n) => {
      P.spawn(new V(...from)); for (let k = 0; k < 10; k++) g.step(blank());
      for (let k = 0; k < n; k++) { g.cam.yaw = Math.atan2(-(to[0] - P.pos.x), -(to[2] - P.pos.z)); const i = blank(); i.my = 1; g.step(i); }
      return Math.hypot(P.pos.x - to[0], P.pos.z - to[2]);
    };
    const a0 = [rub.pos.x - (room[0] - rub.pos.x) * 0.5, rub.pos.y + 0.5, rub.pos.z - (room[2] - rub.pos.z) * 0.5];
    const dBlocked = walkTo(a0, room, 420);
    const dR = [g.L.secrets.mineRoom[0] - rub.pos.x, g.L.secrets.mineRoom[2] - rub.pos.z], dl = Math.hypot(...dR);
    const rOff = [[-2 * dR[0] / dl, -2 * dR[1] / dl]];
    const lr = actAt(rub, rOff);
    ok(dBlocked > 5 && !rub.cleared && lr === 'завал: нужна кирка', `завал держит: до каморки осталось ${dBlocked.toFixed(1)} м, кнопка «${lr}»`);
    g.__rubA0 = a0;
    // 2. руда без кирки — нельзя
    const ore0 = res('ore')[0];
    const l0 = actAt(ore0);
    ok(inv.count('ore') === 0 && l0 === 'нужна кирка', `руда без кирки не добывается, кнопка «${l0}»`);
    // 3. кирка у верстака в посёлке
    const bench = g.ents.get('st:bench1');
    const lb = actAt(bench);
    g.openCraft('workbench');
    const btn = [...document.querySelectorAll('#craftList [data-r="pickaxe"]')][0];
    const enabled = btn && !btn.disabled;
    btn && btn.click(); close();
    ok(enabled && st.gear.pickaxe && inv.count('wood') === 3 && inv.count('stone') === 2, `верстак («${lb}»): кирка сделана, осталось дерево ${inv.count('wood')}, камень ${inv.count('stone')}`);
    const lr2 = actAt(rub, rOff);
    const dOpen = walkTo(g.__rubA0, room, 420);
    ok(rub.cleared && dOpen < 3, `кирка разбила завал («${lr2}»): до каморки ${dOpen.toFixed(1)} м`);
    // 4. руда в шахте (8 руды), дерево ещё
    for (const e of res('ore').filter((q) => !q.rich).slice(0, 4)) actAt(e);
    for (const e of res('wood').slice(0, 3)) actAt(e);
    ok(inv.count('ore') === 8, `в шахте добыто руды ${inv.count('ore')}`);
    // 5. слитки в печи
    g.openCraft('furnace');
    for (let k = 0; k < 4; k++) { const b = document.querySelector('#craftList [data-r="ingot"]'); if (b && !b.disabled) b.click(); }
    close();
    ok(inv.count('ingot') === 4 && inv.count('ore') === 0, `печь: слитков ${inv.count('ingot')}, руды осталось ${inv.count('ore')}, дерева ${inv.count('wood')}`);
    // 6. шипы: расход сил на стене до и после
    const climbCost = () => {
      const W = g.W, th = 2.2, y = -70, rr = W.pitR(Math.cos(th), Math.sin(th), y) - 0.6;
      P.spawn(new V(0, -60, 0)); P.pos.set(Math.sin(th) * rr, y, Math.cos(th) * rr); P.state = 'air'; P.vel.set(0, 0, 0); P.peakY = y; P.facing = th; P.stamina = 100; P.tryGrab();
      for (let k = 0; k < 20; k++) g.step(blank());
      const s0 = P.stamina;
      for (let k = 0; k < 120; k++) { const i = blank(); i.my = -0.8; g.step(i); }
      return s0 - P.stamina;
    };
    const before = climbCost();
    g.openCraft('workbench');
    document.querySelector('#craftList [data-r="spikes"]').click(); close();
    const after = climbCost();
    ok(st.gear.spikes && after < before * 0.75, `шипы: на стене за 2 с силы −${before.toFixed(1)} → −${after.toFixed(1)}`);
    // 7. стальной трос и крюк-кошка: нужно ещё 3 слитка — 6 руды + 3 дерева
    for (const e of res('ore').filter((q) => !q.rich).slice(0, 3)) actAt(e);
    for (const e of res('wood').slice(0, 2)) actAt(e);
    g.openCraft('furnace');
    for (let k = 0; k < 3; k++) { const b = document.querySelector('#craftList [data-r="ingot"]'); if (b && !b.disabled) b.click(); }
    close();
    for (const e of res('stone').slice(0, 1)) actAt(e);
    g.openCraft('workbench');
    const bc = document.querySelector('#craftList [data-r="cable"]'), bg = document.querySelector('#craftList [data-r="grapple"]');
    if (bc && !bc.disabled) bc.click();
    g.openCraft('workbench');
    const bg2 = document.querySelector('#craftList [data-r="grapple"]');
    if (bg2 && !bg2.disabled) bg2.click();
    close();
    ok(st.gear.cable && st.gear.grapple, `трос ${!!st.gear.cable}, крюк-кошка ${!!st.gear.grapple} (слитков осталось ${inv.count('ingot')})`);
    // крюк-кошка цепляет дальше 24 м: целимся в стену в ~30 м
    {
      const W = g.W, th = 1.0, y = -40;
      const rr = W.pitR(Math.cos(th), Math.sin(th), y) - 31;
      P.spawn(new V(0, -60, 0)); P.pos.set(Math.sin(th) * rr, y, Math.cos(th) * rr); P.state = 'air'; P.vel.set(0, 0, 0);
      const dir = new V(Math.sin(th), -0.3, Math.cos(th)).normalize();     // камера смотрит на стену (чуть вниз: прицел приподнят)
      const tg = P.pickTarget(dir);
      ok(tg && tg.pos.distanceTo(P.pos) > 25, `крюк-кошка: цель на ${tg ? tg.pos.distanceTo(P.pos).toFixed(0) : '—'} м (без неё — до 24)`);
      P.spawn(g.ents.get('st:bench1').pos.clone().add(new V(2, 1, 2)));
    }
    // 8. похлёбка: грибы + ягоды → печь → съесть
    for (const e of res('mushroom').slice(0, 1)) actAt(e);
    for (const e of res('berry').slice(0, 1)) actAt(e);
    g.openCraft('furnace');
    const bs = document.querySelector('#craftList [data-r="stew"]');
    if (bs && !bs.disabled) bs.click();
    close();
    P.stamina = 10; P.health = 50;
    g.openBag();
    const eatBtn = document.querySelector('#bagGrid [data-eat="stew"]');
    eatBtn && eatBtn.click(); close();
    ok(P.stamina === 100 && P.health === 80, `похлёбка: силы ${P.stamina.toFixed(0)}, здоровье ${P.health.toFixed(0)}`);
    // 9. рюкзак ограничен
    st.inv = { wood: 30, stone: 30, ore: 20 };
    const full = res('wood')[0] || g.ents.byKind('res').find((e) => e.type === 'wood');
    const lf = actAt(full);
    ok(inv.slotsUsed() === 8 && inv.count('wood') === 30, `рюкзак полон (8/8) — больше не берётся: дерево ${inv.count('wood')}`);
    st.inv = { ingot: 1, wood: 4 };
    // 10. ресурсы вырастают снова
    const taken = g.ents.byKind('res').find((e) => e.taken);
    st.time = taken.back + 1;
    for (let k = 0; k < 70; k++) g.step(blank());
    window.__giver.regrowNow && window.__giver.regrowNow();
    return { r, takenId: taken.id };
  });
  // вырос ли (regrow идёт в кадре — дадим кадрам пройти)
  await page.evaluate(() => { window.__giver.game.running = true; });
  await page.waitForTimeout(2500);
  const grown = await page.evaluate((id) => { const g = window.__giver; g.game.running = false; return !g.ents.get(id).taken; }, out.takenId);
  out.r.push((grown ? '✓ ' : '✗ ') + 'собранный ресурс вырос снова');
  await page.evaluate(() => window.__giver.save.write());
  await page.reload();
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
  const back = await page.evaluate(() => { const g = window.__giver; return { inv: g.state.inv, gear: Object.keys(g.state.gear), bag: document.getElementById('bagN').textContent, rubble: g.ents.get('rubble:mine').cleared }; });
  out.r.push((back.gear.length === 4 && back.inv.wood === 4 && back.rubble ? '✓ ' : '✗ ') + 'после перезапуска: ' + JSON.stringify(back));
  console.log(out.r.join('\n'));
  console.log(errs.join('\n') || 'без ошибок на странице');
  await browser.close();
})();
