// Постройки (node tools/build.cjs): висишь на стене → платформа под ногами → отпустил «Хват» → стоишь, силы
// возвращаются; с платформы её не разобрать; козырёк над краем обрыва; в воздухе нельзя; укрытие на ровной земле
// становится лагерем (после гибели — туда), рядом заживает; лимит платформ; разобрать → снова в рюкзаке;
// после перезапуска всё на месте.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 853, height: 384 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.__noAdapt = true; });
  const url = 'file://' + path.resolve(__dirname, '../dist/giver.html');
  await page.goto(url);
  await page.evaluate(() => localStorage.removeItem('giver_v1'));
  await page.goto(url);
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
  await page.click('#go');
  await page.waitForTimeout(300);
  const out = await page.evaluate(() => {
    const g = window.__giver, P = g.player, V = P.pos.constructor, W = g.W, r = [];
    const ok = (c, m) => r.push((c ? '✓ ' : '✗ ') + m);
    const blank = () => ({ mx: 0, my: 0, jump: false, hook: false, grab: false });
    const steps = (n, f) => { for (let k = 0; k < n; k++) g.step(f ? f(k) : blank()); };
    // кадр игры без рисования: обновить «призрак» и кнопку так же, как в frame()
    const tick = () => g.buildTick();
    g.game.running = false;
    g.state.inv = { platform: 3, shelter: 1, wood: 3 };
    // 1. на стене: платформа под ногами
    const th = 2.2, y = -70, rr = W.pitR(Math.cos(th), Math.sin(th), y) - 0.6;
    P.spawn(new V(0, -60, 0)); P.pos.set(Math.sin(th) * rr, y, Math.cos(th) * rr); P.state = 'air'; P.vel.set(0, 0, 0); P.peakY = y; P.facing = th; P.tryGrab();
    steps(20);
    const climbing = P.state;
    g.startBuild('platform'); tick();
    const c1 = g.builder.mode.check;
    g.act();
    const n1 = g.structures.count('platform');
    const pl1 = g.structures.list('platform')[0];
    const dbg = pl1 ? { pl: pl1.pos.toArray().map((v) => +v.toFixed(2)), hero: P.pos.toArray().map((v) => +v.toFixed(2)), sup: g.physics.ground(P.pos.x, P.pos.y + 0.3, P.pos.z, 0.5, 1) } : null;
    const grab = blank(); grab.grab = true; g.step(grab);
    steps(60);
    const stoodY = P.pos.y;
    P.stamina = 30;
    steps(240);
    ok(climbing === 'climb' && c1.ok && n1 === 1 && P.state === 'ground' && Math.abs(stoodY - y) < 0.8 && P.stamina > 60 && g.state.inv.platform === 2,
      `на стене: ${climbing}, место ${c1.ok ? 'годится' : c1.why}, поставлена, отпустил — ${P.state} на y ${stoodY.toFixed(1)} (было ${y}), силы 30 → ${P.stamina.toFixed(0)}`);
    const onIt = g.ents.nearest(P.pos, 2.3, 2.2, (e) => e.kind === 'structure');
    ok(onIt && P.onBox && !(P.interact && P.interact.kind === 'structure'), `стоя на платформе, её не разобрать (кнопка: ${P.interact ? P.interact.label : 'нет'})`);
    // 2. в воздухе нельзя
    P.spawn(new V(0, -60, 0)); P.pos.set(0, -60, 20); P.state = 'air'; P.vel.set(0, 0, 0);
    g.startBuild('platform'); tick();
    const cAir = g.builder.mode.check;
    g.builder.cancel();
    ok(!cAir.ok, `в воздухе: «${cAir.why}»`);
    // 3. козырёк над краем: на смотровой тропе лицом к Бездне
    const L = g.L, l = L.ledges.path, u = 0.5, t2 = l.th0 + l.span * u, y2 = l.y0 + (l.y1 - l.y0) * u;
    let edge = null;
    for (let back = 0.4; back < 6 && !edge; back += 0.3) {
      const r2 = W.pitR(Math.cos(t2), Math.sin(t2), y2) - back;
      const gr = g.physics.ground(Math.sin(t2) * r2, y2 + 3, Math.cos(t2) * r2, 1, 6);
      if (gr) edge = { r2, gy: gr.y };
    }
    // идём от стены к краю полки, пока впереди не кончится земля
    const fwd = new V(-Math.sin(t2), 0, -Math.cos(t2));
    let placed = null, why = '';
    for (let d = 0; d < 8 && !placed; d += 0.25) {
      const R = edge.r2 + 0 - d;
      P.spawn(new V(Math.sin(t2) * R, edge.gy + 1, Math.cos(t2) * R));
      P.facing = Math.atan2(fwd.x, fwd.z);
      g.startBuild('platform'); tick();
      const M = g.builder.mode;
      if (M.check.ok && M.pos.y < P.pos.y - 0.1) { g.act(); placed = g.structures.list('platform').slice(-1)[0]; }
      else { why = M.check.why || 'на земле'; g.builder.cancel(); }
    }
    if (placed) {
      const f = new V(Math.sin(placed.rot), 0, Math.cos(placed.rot));
      for (let k = 0; k < 200 && !(P.onBox && k > 30); k++) { const i = blank(); g.cam.yaw = Math.atan2(-f.x, -f.z); i.my = 0.4; g.step(i); }
      steps(30);
    }
    const overAir = placed && g.physics.ground(P.pos.x, P.pos.y - 0.25, P.pos.z, 0.1, 30) === null;
    ok(placed && P.state === 'ground' && P.onBox, `козырёк над обрывом: ${placed ? 'поставлен' : 'нет (' + why + ')'}, герой вышел на него: ${P.state}${P.onBox ? ', на платформе' : ''}${overAir ? ', под ним пусто' : ''}`);
    // 4. лимит платформ
    g.state.inv.platform = 3;
    for (const [dx, dz] of [[6, 0], [12, 0]]) {
      const x = L.spawn[0] + dx, z = L.spawn[2] + 8;
      P.spawn(new V(x, 3, z)); P.facing = 0; g.startBuild('platform'); tick(); g.act();
    }
    P.spawn(new V(L.spawn[0] + 18, 3, L.spawn[2] + 8)); P.facing = 0; g.startBuild('platform'); tick();
    const cLim = g.builder.mode.check; g.builder.cancel();
    ok(g.structures.count('platform') === 4 && !cLim.ok, `платформ ${g.structures.count('platform')}, пятая: «${cLim.why}»`);
    // 5. укрытие в посёлке — лагерь; гибель — вернулся к нему
    let sh = null;
    for (const [dx, dz] of [[-8, 6], [-10, 10], [6, 14], [-14, 2], [10, 20]]) {
      P.spawn(new V(L.spawn[0] + dx, 3, L.spawn[2] + dz)); P.facing = 0.3;
      g.startBuild('shelter'); tick();
      if (g.builder.mode.check.ok) { g.act(); sh = g.structures.list('shelter')[0]; break; }
      why = g.builder.mode.check.why; g.builder.cancel();
    }
    ok(sh && g.game.campName === 'укрытие', `укрытие: ${sh ? 'поставлено' : 'нет (' + why + ')'}, лагерь «${g.game.campName}»`);
    return { r, shPos: sh ? sh.pos.toArray() : null };
  });
  if (!out.shPos) { console.log(out.r.join('\n')); console.log(errs.join('\n')); await browser.close(); return; }
  // гибель → «Продолжить» → у укрытия; рядом заживает
  const death = await page.evaluate(() => { const g = window.__giver, P = g.player; P.hurt(1000, 'fall'); return P.dead; });
  await page.waitForTimeout(900);
  await page.click('#respawn');
  await page.waitForTimeout(200);
  const resp = await page.evaluate((sp) => {
    const g = window.__giver, P = g.player; g.game.running = false;
    const d = Math.hypot(P.pos.x - sp[0], P.pos.z - sp[2]);
    P.health = 40;
    g.game.running = true;
    return d;
  }, out.shPos);
  await page.waitForTimeout(1500);
  const healed = await page.evaluate(() => { const g = window.__giver; g.game.running = false; return g.player.health; });
  out.r.push((death && resp < 2 && healed > 50 ? '✓ ' : '✗ ') + `после гибели — у укрытия (${resp.toFixed(1)} м), здоровье 40 → ${healed.toFixed(0)}`);
  // разобрать укрытие и одну платформу → в рюкзак; лагерь снова прежний
  const dis = await page.evaluate(() => {
    const g = window.__giver, P = g.player, V = P.pos.constructor;
    const blank = () => ({ mx: 0, my: 0, jump: false, hook: false, grab: false });
    const reach = (e) => {
      for (const [dx, dz] of [[2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]]) {
        P.spawn(e.pos.clone().add(new V(dx, 1, dz)));
        for (let k = 0; k < 40; k++) g.step(blank());
        if (P.interact && P.interact.item === e) return P.interact.label;
      }
      return null;
    };
    const sh = g.structures.list('shelter')[0], pl = g.structures.list('platform').slice(-1)[0];
    const l1 = reach(sh); g.act();
    const l2 = reach(pl); g.act();
    return { l1, l2, inv: { ...g.state.inv }, camp: g.game.campName, n: g.structures.count() };
  });
  out.r.push((dis.l1 === 'разобрать укрытие' && dis.inv.shelter === 1 && dis.camp !== 'укрытие' && dis.n === 3 ? '✓ ' : '✗ ') + `разобрал («${dis.l1}», «${dis.l2}»): рюкзак ${JSON.stringify(dis.inv)}, лагерь «${dis.camp}», построек ${dis.n}`);
  await page.evaluate(() => window.__giver.savePlayer(true));
  await page.reload();
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
  const back = await page.evaluate(() => ({ n: window.__giver.structures.count(), cols: window.__giver.structures.list().filter((e) => e.view && e.view.col).length }));
  out.r.push((back.n === 3 && back.cols === 3 ? '✓ ' : '✗ ') + `после перезапуска построек ${back.n}, со столкновениями ${back.cols}`);
  console.log(out.r.join('\n'));
  console.log(errs.join('\n') || 'без ошибок на странице');
  await browser.close();
})();
