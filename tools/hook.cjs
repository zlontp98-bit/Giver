// Проверка крюка (node tools/hook.cjs): прицел на скалу; страховка у края → шаг в пропасть → верёвка ловит →
// спуск до террасы → крюк отцепился; в полёте зацепиться за стену и раскачаться; на стене зацепиться и
// сорваться — верёвка ловит; кольца и тросы (если есть) — прицел и поездка.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 853, height: 384 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.__noAdapt = true; window.__giverFull = true; });
  await page.goto('file://' + path.resolve(__dirname, '../dist/giver.html'));
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
  await page.click('#go');
  await page.waitForTimeout(300);
  const res = await page.evaluate(() => {
    const g = window.__giver, P = g.player, W = g.W, L = g.L, cam = g.cam, V = P.pos.constructor;
    g.game.running = false;
    const out = [];
    const ok = (c, m) => out.push((c ? '✓ ' : '✗ ') + m);
    const blank = () => ({ mx: 0, my: 0, run: false, jump: false, hook: false, grab: false, camDX: 0, camDY: 0, looking: false });
    let t = 0;
    const step = (i) => { g.step(i || blank()); t += 1 / 60; };
    const R = (th, y) => W.pitR(Math.cos(th), Math.sin(th), y);
    const fmt = (p) => p.toArray().map((v) => v.toFixed(1)).join(',');
    // направление камеры по yaw/pitch (камера смотрит на героя)
    const camDir = () => new V(-Math.sin(cam.yaw) * Math.cos(cam.pitch), -Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch));
    const aim = () => P.pickTarget(camDir());
    const fire = () => { const i = blank(); i.hook = true; step(i); for (let k = 0; k < 60 && P.hook; k++) step(); };

    // 1. страховка у края над террасой: прицел на край, шаг в пропасть, верёвка ловит, спуск
    {
      const th = Math.PI + 0.22, r = R(th, 0) + 1.6;
      P.spawn(new V(Math.sin(th) * r, 2, Math.cos(th) * r));
      cam.yaw = th; cam.pitch = 1.15;                   // камера сзади и высоко — прицел на край под ногами
      for (let k = 0; k < 5; k++) step();
      const tg = aim();
      ok(tg && tg.free, `прицел на край: ${tg ? fmt(tg.pos) + ' (' + tg.pos.distanceTo(P.pos).toFixed(1) + ' м)' : 'нет цели'}`);
      fire();
      ok(P.rope && P.state === 'ground', `зацепился стоя — страховка: rope=${!!P.rope} ${P.state} длина ${P.rope ? P.rope.len.toFixed(1) : '-'}`);
      const y0 = P.pos.y, hp0 = P.health;
      // шаг вперёд с края
      for (let k = 0; k < 240 && P.state !== 'rope'; k++) { const i = blank(); i.my = 1; step(i); }
      ok(P.state === 'rope', `сорвался с края — повис на верёвке: ${P.state}, y ${y0.toFixed(1)} → ${P.pos.y.toFixed(1)}`);
      // спуск: джойстик вниз
      let k = 0;
      for (; k < 60 * 30 && P.state === 'rope'; k++) { const i = blank(); i.my = -1; step(i); }
      ok(P.state === 'ground' && !P.rope && P.pos.y < y0 - 15, `спустился на верёвке: y=${P.pos.y.toFixed(1)}, ${(k / 60).toFixed(1)} с, крюк ${P.rope ? 'держит' : 'отцепился'}, здоровье ${hp0}→${P.health.toFixed(0)}, силы ${P.stamina.toFixed(0)}`);
    }
    // 2. прыжок с полки и крюк в полёте за стену над головой — маятник, раскачка
    {
      const l = L.ledges.ab, u = 0.5, th = l.th0 + l.span * u, y = l.y0 + (l.y1 - l.y0) * u, r = R(th, y) - 2.5;
      P.spawn(new V(Math.sin(th) * r, y + 1, Math.cos(th) * r));
      P.stamina = 100;
      cam.yaw = th + Math.PI + 0.6; cam.pitch = -0.45;   // смотрим вдоль стены и вверх
      for (let k = 0; k < 5; k++) step();
      const tg = aim();
      ok(tg, `прицел вверх на стену: ${tg ? fmt(tg.pos) + ', выше на ' + (tg.pos.y - P.pos.y).toFixed(1) + ' м' : 'нет'}`);
      // прыгаем к пропасти и цепляемся
      cam.yaw = th; const j = blank(); j.jump = true; j.my = 1; step(j);
      for (let k = 0; k < 10; k++) { const i = blank(); i.my = 1; step(i); }
      cam.yaw = th + Math.PI + 0.6; cam.pitch = -0.45;
      const tg2 = aim();
      if (tg2) fire();
      ok(P.rope && (P.state === 'rope' || P.state === 'air'), `крюк в полёте: ${P.state}, верёвка ${P.rope ? P.rope.len.toFixed(1) + ' м' : 'нет'}`);
      let minY = P.pos.y, maxSpeed = 0;
      for (let k = 0; k < 240 && P.rope; k++) { const i = blank(); i.mx = k % 120 < 60 ? 1 : -1; step(i); minY = Math.min(minY, P.pos.y); maxSpeed = Math.max(maxSpeed, P.vel.length()); }
      ok(!P.dead && (P.state === 'rope' || P.state === 'ground'), `на верёвке и раскачка 4 с: ${P.state}, макс. скорость ${maxSpeed.toFixed(1)} м/с`);
      if (P.state === 'rope') {
        const i = blank(); i.jump = true; step(i);
        ok(P.state === 'air' && !P.rope, `«Прыжок» — соскочил: ${P.state}, скорость ${P.vel.length().toFixed(1)}`);
      } else { const i = blank(); i.hook = true; step(i); ok(!P.rope, 'встал на полку, «Крюк» — отцепился'); }
      for (let k = 0; k < 400 && P.state === 'air'; k++) step();
      ok(!P.dead, `приземлился: ${P.state} y=${P.pos.y.toFixed(1)} здоровье ${P.health.toFixed(0)}`);
    }
    // 3. на стене: зацепиться крюком (страховка), отпустить стену — верёвка ловит
    {
      const th = 2.2, y = -70, r = R(th, y) - 0.6;
      P.spawn(new V(0, -60, 0));
      P.pos.set(Math.sin(th) * r, y, Math.cos(th) * r); P.state = 'air'; P.vel.set(0, 0, 0); P.peakY = y; P.facing = th; P.stamina = 100;
      P.tryGrab();
      for (let k = 0; k < 30; k++) step();
      ok(P.state === 'climb', 'висит на стене: ' + P.state);
      cam.yaw = Math.atan2(P.climb.n.x, P.climb.n.z); cam.pitch = 0.2;
      const tg = aim();
      ok(tg, 'на стене прицел: ' + (tg ? fmt(tg.pos) : 'нет'));
      fire();
      ok(P.rope && P.state === 'climb', `на стене со страховкой: ${P.state}, верёвка ${P.rope ? P.rope.len.toFixed(1) : '-'}`);
      // слезть на 3 м вниз и отпустить
      for (let k = 0; k < 90; k++) { const i = blank(); i.my = -1; step(i); }
      const yb = P.pos.y;
      const i = blank(); i.grab = true; step(i);
      for (let k = 0; k < 180 && P.state === 'air'; k++) step();
      ok(P.state === 'rope' && !P.dead, `отпустил стену — поймала верёвка: ${P.state}, пролетел ${(yb - P.pos.y).toFixed(1)} м`);
      const i2 = blank(); i2.hook = true; step(i2);
      ok(!P.rope && P.state === 'air', '«Крюк» ещё раз — отцепился: ' + P.state);
      for (let k = 0; k < 600 && P.state !== 'ground' && !P.dead; k++) step();
    }
    // 4. тросы: встать у начала, навести, «Крюк» — проехать до конца и приземлиться
    const zips = P.anchors.filter((a) => a.kind === 'zip'), rings = P.anchors.filter((a) => a.kind === 'ring');
    out.push(`особых точек: ${rings.length}, тросов: ${zips.length}`);
    for (const a of zips) {
      const z = a.zip, back = z.dir.clone().setY(0).normalize();
      // стоим чуть позади столба (с той стороны, откуда едем)
      P.spawn(new V(z.a.x - back.x * 1.4, z.a.y + 1, z.a.z - back.z * 1.4));
      P.stamina = 100; P.health = 100;
      cam.yaw = Math.atan2(-back.x, -back.z); cam.pitch = 0.1;
      for (let k = 0; k < 3; k++) step();
      const tg = aim();
      if (tg !== a) { ok(false, `трос «${a.name}»: прицел не на тросе (${tg ? tg.kind : 'нет'}), до начала ${P.pos.distanceTo(z.a).toFixed(1)} м`); continue; }
      fire();
      let k = 0, vmax = 0;
      for (; k < 60 * 40 && (P.state === 'zip' || P.state === 'mantle'); k++) { step(); if (P.zip) vmax = Math.max(vmax, P.zip.v); }
      for (let q = 0; q < 300 && P.state === 'air'; q++) step();
      const endGround = z.b.y - (P.pos.y < z.b.y ? 0 : 0);
      ok(P.state === 'ground' && !P.dead && P.pos.distanceTo(z.b) < 6, `трос «${a.name}» ${z.len.toFixed(0)} м: ${(k / 60).toFixed(1)} с, скорость до ${vmax.toFixed(1)} м/с, конец ${P.pos.distanceTo(z.b).toFixed(1)} м от столба, здоровье ${P.health.toFixed(0)}`);
    }
    // 5. кольца: подойти, навести, зацепиться, шагнуть с края — повиснуть, спуститься
    for (const a of rings) {
      const n = W.normal(a.pos.x, a.pos.y + 0.3, a.pos.z, new V());
      const out2 = new V(-n.x, 0, -n.z).normalize();           // от скалы — в Бездну
      // встать на опору под кольцом (над краем): ищем землю вокруг на 2–4 м от скалы
      let spot = null;
      for (const d of [2.5, 3.5, 1.8, 4.5]) for (const side of [0, 1.5, -1.5, 3, -3]) {
        const sx = a.pos.x + n.x * d - n.z * side, sz = a.pos.z + n.z * d + n.x * side;
        const tt = W.raycast(sx, a.pos.y + 2, sz, 0, -1, 0, 6);
        if (tt >= 0 && !spot) spot = new V(sx, a.pos.y + 2 - tt, sz);
      }
      if (!spot) { ok(false, `кольцо «${a.name}»: нет опоры рядом`); continue; }
      P.spawn(spot); P.stamina = 100; P.health = 100;
      const d0 = spot.distanceTo(a.pos);
      // смотреть на кольцо
      const dir = a.pos.clone().sub(spot.clone().setY(spot.y + 1.4)).normalize();
      cam.yaw = Math.atan2(-dir.x, -dir.z); cam.pitch = Math.max(-0.5, Math.min(1.2, -Math.asin(dir.y) + 0.3));
      for (let k = 0; k < 3; k++) step();
      const tg = aim();
      ok(tg === a, `кольцо «${a.name}»: прицел ${tg === a ? 'на кольце' : tg ? tg.kind : 'нет'} (${d0.toFixed(1)} м)`);
      if (tg !== a) continue;
      fire();
      ok(!!P.rope, `кольцо «${a.name}»: зацепился, ${P.state}`);
      // шагнуть в Бездну: «вперёд» от скалы
      cam.yaw = Math.atan2(-n.x, -n.z);
      for (let k = 0; k < 300 && P.state !== 'rope'; k++) { const i = blank(); i.my = 1; step(i); }
      const y1 = P.pos.y;
      let k = 0;
      for (; k < 60 * 30 && P.state === 'rope'; k++) { const i = blank(); i.my = -1; step(i); }
      for (let q = 0; q < 300 && P.state === 'air'; q++) step();
      ok(!P.dead && P.state === 'ground', `кольцо «${a.name}»: спустился с ${y1.toFixed(0)} до ${P.pos.y.toFixed(0)} за ${(k / 60).toFixed(1)} с, здоровье ${P.health.toFixed(0)}`);
    }
    return out;
  });
  console.log(res.join('\n'));
  console.log(errs.join('\n') || 'без ошибок на странице');
  await browser.close();
})();
