// Демоверсия (node tools/demo.cjs): бот проходит маршрут демо так, как игрок.
//  1. посёлок → смотровая → короткий путь: с края на уступ, прыжки по камням (паркур);
//  2. кольцо над провалом: прицел, «Крюк», шаг вниз, раскачка, «Прыжок» — на дальний уступ у водопада;
//  3. ниша за струёй: «Действие» — находка; спуск по стене руками на террасу;
//  4. дерево и камни → кирка прямо в рюкзаке → завал в пещере за водопадом → компас;
//  5. граница демо: ушёл ниже 42 м — очнулся у лагеря, вещи при себе; в демо нет шахты, руды, верстаков, скальника;
//  6. обычный путь (тропа по стене) тоже ведёт на террасу; после перезапуска всё на месте.
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
    const g = window.__giver, P = g.player, W = g.W, L = g.L, cam = g.cam, V = P.pos.constructor, D = L.demo, F = D.falls, r = [];
    const ok = (c, m) => r.push((c ? '✓ ' : '✗ ') + m);
    g.game.running = false;
    let t = 0, hurt = 0;
    const oh = P.hurt.bind(P); P.hurt = (d, w) => { hurt += Math.min(d, 1000); oh(d, w); };
    const blank = () => ({ mx: 0, my: 0, run: false, jump: false, hook: false, grab: false, camDX: 0, camDY: 0, looking: false });
    const step = (i) => { g.step(i || blank()); t += 1 / 60; };
    const R = (th, y) => W.pitR(Math.cos(th), Math.sin(th), y);
    const hd = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const fmt = (p) => p.toArray().map((q) => q.toFixed(1)).join(',');
    const camDir = () => new V(-Math.sin(cam.yaw) * Math.cos(cam.pitch), -Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch));
    const steer = (to, run, my = 1) => { const dx = to.x - P.pos.x, dz = to.z - P.pos.z; cam.yaw = Math.atan2(-dx, -dz); const i = blank(); i.my = my; i.run = !!run; return i; };
    const lp = (l, u, ins = 1.5) => { const th = l.th0 + l.span * u, y = l.y0 + (l.y1 - l.y0) * u; const rr = R(th, y) - ins; return new V(Math.sin(th) * rr, y, Math.cos(th) * rr); };
    const walkTo = (to, tol = 0.7, maxT = 40, run = false) => {
      const t0 = t;
      while (hd(P.pos, to) > tol && t - t0 < maxT && !P.dead) {
        const i = steer(to, run, hd(P.pos, to) < 1.5 ? 0.5 : 1); step(i);
        while (P.state === 'air' && !P.dead) step(steer(to, run));
      }
      for (let k = 0; k < 6; k++) step();
      return hd(P.pos, to) <= tol + 0.3;
    };
    // 1. посёлок → смотровая → край над первым уступом
    P.spawn(new V(...L.spawn));
    walkTo(new V(0, 0, L.settle.z + 40)); walkTo(new V(0, 0, -(L.Rn + 9)));
    const s = F.steps;
    const rim = lp(s[0], 0.55, -2.2);                                   // на краю над первым уступом
    walkTo(new V(rim.x, 0, rim.z), 0.8);
    walkTo(lp(s[0], 0.55, 1.6), 0.9);                                    // шаг вниз с края
    const onStep0 = Math.abs(P.pos.y - s[0].y0) < 1.5;
    walkTo(lp(s[0], 0.12, 1.6), 0.7);
    ok(onStep0 && !P.dead, `с края на первый уступ: y ${P.pos.y.toFixed(1)}`);
    // прыжки: разбег к следующему камню, у края — «Прыжок»
    let jumps = 0;
    for (let k = 1; k < s.length; k++) {
      const to = lp(s[k], 0.5, 1.6), from = P.pos.clone();
      let jumped = false;
      for (let q = 0; q < 300 && !P.dead; q++) {
        const i = steer(to, true);
        const f = new V(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
        const ahead = g.physics.ground(P.pos.x + f.x * 0.55, P.pos.y + 0.5, P.pos.z + f.z * 0.55, 0.6, 1.0);
        if (!jumped && P.state === 'ground' && !ahead) { i.jump = true; jumped = true; }
        step(i);
        if (jumped && P.state === 'ground') break;
      }
      walkTo(to, 0.8, 6);
      const onIt = Math.abs(P.pos.y - s[k].y0) < 0.8 && hd(P.pos, to) < 2.5;
      if (onIt) jumps++;
      else { ok(false, `прыжок на камень ${k}: не допрыгнул (${fmt(P.pos)}, ждали ${fmt(to)}) от ${fmt(from)}`); break; }
    }
    ok(jumps === s.length - 1 && hurt === 0, `паркур: ${jumps} прыжка по камням, урон ${hurt}`);
    // 2. кольцо: у восточного края последнего камня навести прицел, зацепиться, шагнуть и раскачаться
    const ring = P.anchors.find((a) => a.kind === 'ring');
    walkTo(lp(s[s.length - 1], 0.15, 1.6), 0.6);
    const dir = ring.pos.clone().sub(P.pos.clone().setY(P.pos.y + 1.4)).normalize();
    cam.yaw = Math.atan2(-dir.x, -dir.z); cam.pitch = Math.max(-0.5, Math.min(1.2, -Math.asin(dir.y) + 0.3));
    for (let k = 0; k < 3; k++) step();
    const tg = P.pickTarget(camDir());
    { const i = blank(); i.hook = true; step(i); for (let k = 0; k < 60 && P.hook; k++) step(); }
    ok(tg === ring && P.rope, `кольцо над провалом: прицел ${tg === ring ? 'на кольце' : tg ? tg.kind : 'нет'}, ${P.rope ? 'зацепился' : 'нет верёвки'} (${P.state})`);
    const farTo = lp(F.far, 0.55, 1.6), farIn = lp(F.far, 0.2, 1.4);
    const east = new V(farTo.x - P.pos.x, 0, farTo.z - P.pos.z).normalize();
    let swingT = 0, released = false, landed = false, maxV = 0;
    for (let q = 0; q < 60 * 12 && !P.dead; q++) {
      let i;
      if (P.state === 'ground' && !released) i = steer(farTo, true);           // шагнуть с края
      else {
        // камера смотрит на стену — «вправо» = на восток; качаемся: толкаем, когда летим к дальнему уступу
        cam.yaw = Math.atan2(-east.z, east.x);
        i = blank();
        const vE = P.vel.x * east.x + P.vel.z * east.z;
        maxV = Math.max(maxV, Math.hypot(P.vel.x, P.vel.z));
        if (P.state === 'rope') {
          swingT += 1 / 60;
          i.mx = vE > -0.3 ? 1 : 0;
          // над дальним уступом — соскочить
          const over = g.physics.ground(P.pos.x + east.x * 0.6, P.pos.y + 0.2, P.pos.z + east.z * 0.6, 0.4, 3.6);
          if (over && Math.abs(over.y - F.far.y0) < 1 && vE > 0) { i.jump = true; released = true; }
        }
      }
      step(i);
      if (released && P.state === 'ground') { landed = true; break; }
    }
    walkTo(farIn, 0.8, 6);
    ok(landed && Math.abs(P.pos.y - F.far.y0) < 1 && !P.dead, `раскачка: ${swingT.toFixed(1)} с на верёвке, скорость до ${maxV.toFixed(1)} м/с, ${landed ? 'соскочил' : 'не соскочил'} — ${P.state} y ${P.pos.y.toFixed(1)} (уступ ${F.far.y0})`);
    // 3. ниша за струёй: находка
    const charm = g.ents.get('find:charm');
    walkTo(charm.pos, 1.3, 10);
    const near = P.interact && P.interact.item === charm;
    g.act();
    ok(near && charm.taken, `ниша за струёй: ${near ? '«Действие» — ' + charm.name : 'кнопки нет'} (${g.game.shards}/${g.game.shardsTotal})`);
    // спуск по стене руками на террасу: к краю уступа, «Хват» — под край, вниз
    walkTo(lp(F.far, 0.5, 1.6), 0.7, 6);
    {
      const th = Math.atan2(P.pos.x, P.pos.z), outw = new V(-Math.sin(th), 0, -Math.cos(th));
      cam.yaw = Math.atan2(-outw.x, -outw.z);
      let k0 = 0;
      for (; k0 < 240 && P.state === 'ground' && !(P.canGrab && k0 > 20); k0++) { const i = blank(); i.my = 0.35; step(i); }
      const dbg = `шагов ${k0}, ${P.state}, canGrab ${P.canGrab}, от стены ${(R(th, P.pos.y) - Math.hypot(P.pos.x, P.pos.z)).toFixed(1)} м, facing ${P.facing.toFixed(2)} нужно ${Math.atan2(outw.x, outw.z).toFixed(2)}`;
      const i = blank(); i.grab = true; step(i);
      while (P.state === 'mantle') step();
      const st0 = P.stamina, y0 = P.pos.y, climbing = P.state === 'climb';
      for (let k = 0; k < 60 * 25 && P.state === 'climb'; k++) { const i2 = blank(); i2.my = -1; cam.yaw = Math.atan2(P.climb.n.x, P.climb.n.z); step(i2); }
      for (let k = 0; k < 200 && P.state !== 'ground'; k++) step();
      ok(climbing && P.state === 'ground' && P.pos.y < (L.demo.rift ? -15 : -18) && !P.dead, (climbing ? '' : dbg + ' | ') + `спуск по стене: с ${y0.toFixed(1)} до ${P.pos.y.toFixed(1)}, силы ${st0.toFixed(0)} → ${P.stamina.toFixed(0)}, урон всего ${hurt}`);
    }
    // 4. дерево, камни → кирка в рюкзаке → завал → компас
    const actAt = (e) => {
      for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [0.9, 0.9], [-0.9, -0.9]]) {
        P.spawn(e.pos.clone().add(new V(dx, 1, dz)));
        for (let k = 0; k < 40; k++) step();
        if (P.interact && P.interact.item === e) { const l = P.interact.label; g.act(); return l; }
      }
      return null;
    };
    const res = (type) => g.ents.byKind('res').filter((e) => e.type === type && !e.taken);
    for (const e of res('wood').slice(0, 2)) actAt(e);
    for (const e of res('stone').slice(0, 2)) actAt(e);
    const rub = g.ents.get('rubble:falls');
    const lr0 = actAt(rub);
    g.openBag();
    const pickBtn = document.querySelector('#bagCraft [data-r="pickaxe"]');
    const canMake = pickBtn && !pickBtn.disabled;
    pickBtn && pickBtn.click();
    document.getElementById('bagClose').onclick();
    g.game.running = false;
    ok(lr0 === 'завал: нужна кирка' && canMake && g.state.gear.pickaxe, `в рюкзаке: дерево и камни → кирка (${canMake ? 'сделал' : 'нельзя'}); у завала было «${lr0}»`);
    const lr1 = actAt(rub);
    const comp = g.ents.get('find:compass');
    // пройти пешком от заводи через проход (где был завал) к компасу
    {
      const rp = rub.pos.clone(), th = Math.atan2(rp.x, rp.z), rr = Math.hypot(rp.x, rp.z);
      const before = new V(Math.sin(th) * (rr - 4), rp.y + 1, Math.cos(th) * (rr - 4));
      P.spawn(before);
      for (const p of [rp, comp.pos]) walkTo(p, 1.0, 15);
    }
    const nearC = P.interact && P.interact.item === comp;
    const dbgC = `герой ${fmt(P.pos)} ${P.state}, компас ${fmt(comp.pos)}, завал ${fmt(rub.pos)}`;
    g.act();
    ok(rub.cleared && nearC && comp.taken, (comp.taken ? '' : dbgC + ' | ') + `кирка разбила завал («${lr1}»), дошёл до компаса: ${comp.taken ? 'открыл' : 'нет'} (${g.game.shards}/${g.game.shardsTotal})`);
    // 5. граница демо: вниз по полке к уступам — ниже 42 м туман, очнулся у лагеря с вещами
    const invBefore = JSON.stringify(g.state.inv);
    const ab = L.ledges.ab;
    P.spawn(lp(ab, 0.35, 1.5).add(new V(0, 1, 0)));
    let woke = false;
    for (let k = 0; k < 60 * 30 && !woke; k++) { step(steer(lp(ab, 0.02, 1.5), true)); if (P.pos.y > -30) woke = true; }
    ok(woke && !P.dead && JSON.stringify(g.state.inv) === invBefore, `граница глубины: очнулся у «${g.game.campName}» (${fmt(P.pos)}), вещи при себе`);
    const kinds = { ore: g.ents.byKind('res').filter((e) => e.type === 'ore').length, station: g.ents.byKind('station').length, beast: !!g.creature, zips: P.anchors.filter((a) => a.kind === 'zip').length, rings: P.anchors.filter((a) => a.kind === 'ring').length, finds: g.game.shardsTotal };
    ok(!kinds.ore && !kinds.station && !kinds.beast && kinds.zips === 1 && kinds.rings === 1 && kinds.finds === 2, `в демо только верх: ${JSON.stringify(kinds)}`);
    // 6. обычный путь: тропа по стене со смотровой на террасу
    P.spawn(new V(0, 0, -(L.Rn + 9)));
    const pl = L.ledges.path;
    walkTo(new V(Math.sin(Math.PI - 0.06) * (R(Math.PI - 0.06, 0) + 2.5), 0, Math.cos(Math.PI - 0.06) * (R(Math.PI - 0.06, 0) + 2.5)));
    for (let k = 1; k <= 14; k++) walkTo(lp(pl, 0.12 + (0.84 * k) / 14, 1.4), 0.9, 15);
    ok(P.pos.y < pl.y1 + 2 && !P.dead, `обычный путь — тропа по стене: внизу на y ${P.pos.y.toFixed(1)} (конец тропы ${pl.y1.toFixed(1)})`);
    g.savePlayer(true);
    return { r, t };
  });
  await page.reload();
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
  const back = await page.evaluate(() => { const g = window.__giver; return { shards: g.game.shards, pick: !!g.state.gear.pickaxe, rubble: g.ents.get('rubble:falls').cleared }; });
  out.r.push((back.shards === 2 && back.pick && back.rubble ? '✓ ' : '✗ ') + `после перезапуска: находок ${back.shards}, кирка ${back.pick}, завал ${back.rubble ? 'разобран' : 'на месте'}`);
  console.log(out.r.join('\n'));
  console.log(`игрового времени: ${out.t.toFixed(0)} с`);
  console.log(errs.join('\n') || 'без ошибок на странице');
  await browser.close();
})();
