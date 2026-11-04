// Существо (node tools/beast.cjs): скальник бродит у логова; заметил — замирает и бежит за героем; рядом —
// кусает (−18) и отбрасывает; от бегущего героя отстаёт; герой на стене — теряет интерес и уходит к логову;
// в воду не идёт; гибель от укусов — рюкзак на месте, после «Продолжить» скальник снова у логова.
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
    const g = window.__giver, P = g.player, V = P.pos.constructor, C = g.creature, r = [];
    const ok = (c, m) => r.push((c ? '✓ ' : '✗ ') + m);
    const blank = () => ({ mx: 0, my: 0, jump: false, hook: false, grab: false, run: false });
    g.game.running = false;
    const H = C.home;
    const ground = (x, z) => g.physics.ground(x, H.y + 6, z, 1, 20);
    // 1. бродит у логова, героя далеко не замечает
    P.spawn(new V(H.x + 60, H.y + 1, H.z));
    const p0 = C.pos.clone();
    let maxFrom = 0;
    for (let k = 0; k < 600; k++) { g.step(blank()); maxFrom = Math.max(maxFrom, Math.hypot(C.pos.x - H.x, C.pos.z - H.z)); }
    ok(C.state === 'idle' && C.pos.distanceTo(p0) > 1 && maxFrom < 16, `бродит у логова: ${C.state}, ушёл от логова не дальше ${maxFrom.toFixed(1)} м`);
    // 2. подойти на 10 м — заметил, замер, побежал; догнал стоящего — укусил и отбросил
    let spot = null;
    for (const a of [0, 1, 2, 3, 4, 5]) {
      const x = C.pos.x + Math.cos(a) * 9, z = C.pos.z + Math.sin(a) * 9, gr = ground(x, z);
      if (gr && Math.abs(gr.y - C.pos.y) < 2) { spot = new V(x, gr.y + 0.5, z); break; }
    }
    P.spawn(spot);
    const states = new Set();
    let hp0 = P.health, bitten = false, knock = 0;
    for (let k = 0; k < 360 && !bitten; k++) {
      g.step(blank()); states.add(C.state);
      if (P.health < hp0) { bitten = true; knock = Math.hypot(P.vel.x, P.vel.z); }
    }
    ok(states.has('alert') && states.has('chase') && bitten && hp0 - P.health === 18 && knock > 3, `заметил → ${[...states].join(' → ')}; укус −${hp0 - P.health}, отбросило ${knock.toFixed(1)} м/с`);
    // 3. убегает бегом — отстаёт и уходит к логову
    for (let k = 0; k < 60; k++) g.step(blank());
    const away = new V(P.pos.x - H.x, 0, P.pos.z - H.z).normalize();
    let lost = false, hurtRun = 0, hp1 = P.health;
    for (let k = 0; k < 900 && lost === false; k++) {
      const i = blank(); g.cam.yaw = Math.atan2(-away.x, -away.z); i.my = 1; i.run = true; P.stamina = 100;
      g.step(i); if (C.state === 'return') { lost = k; }
    }
    const runInfo = { k: lost, d: C.pos.distanceTo(P.pos).toFixed(1), st: P.state, fromHome: Math.hypot(C.pos.x - H.x, C.pos.z - H.z).toFixed(1) };
    hurtRun = hp1 - P.health;
    ok(lost !== false, `убежал бегом (отстал через ${(runInfo.k / 60).toFixed(1)} с): скальник ${C.state}, по пути укусов на −${hurtRun}, до него ${C.pos.distanceTo(P.pos).toFixed(0)} м`);
    // 4. на стене не достать: герой висит на скале, скальник гонится снизу — теряет интерес
    {
      const W = g.W, th = 2.2, y = -70, rr = W.pitR(Math.cos(th), Math.sin(th), y) - 0.6;
      P.spawn(new V(0, -60, 0)); P.pos.set(Math.sin(th) * rr, y, Math.cos(th) * rr); P.state = 'air'; P.vel.set(0, 0, 0); P.peakY = y; P.facing = th; P.tryGrab();
      const gb = g.physics.ground(P.pos.x - Math.sin(th) * 3, y, P.pos.z - Math.cos(th) * 3, 0.5, 60);
      C.pos.set(P.pos.x - Math.sin(th) * 3, gb ? gb.y : y - 3, P.pos.z - Math.cos(th) * 3); C.calm = 0; C.state = 'chase';
      let gaveUp = false, bites = P.health;
      for (let k = 0; k < 300 && !gaveUp; k++) { P.stamina = 100; g.step(blank()); if (C.state === 'return') gaveUp = true; }
      ok(P.state === 'climb' && gaveUp && P.health === bites, `герой на стене (${P.state}) — скальник снизу (${(P.pos.y - C.pos.y).toFixed(1)} м) не достал и потерял интерес: ${C.state}`);
    }
    // 5. в воду не идёт: за героем в озере — стоит на берегу
    C.reset(); C.calm = 0;
    const Lk = g.L.lake;
    C.pos.set(Lk.x - Lk.rx - 4, C.pos.y, Lk.z); C.pos.y = ground(C.pos.x, C.pos.z).y; C.state = 'chase';
    P.spawn(new V(Lk.x - Lk.rx + 8, Lk.y + 1, Lk.z));
    for (let k = 0; k < 240; k++) g.step(blank());
    ok(!g.physics.waterAt(C.pos.x, C.pos.z) && P.inWater, `герой в воде, скальник на берегу (${C.state})`);
    C.reset();
    return r;
  });
  // 6. гибель от укусов: рюкзак; после «Продолжить» скальник у логова
  const dead = await page.evaluate(() => {
    const g = window.__giver, P = g.player, V = P.pos.constructor, C = g.creature;
    g.state.inv = { glowshroom: 2 };
    P.spawn(C.pos.clone().add(new V(1, 1, 0)));
    P.health = 10; C.calm = 0; C.state = 'chase';
    const blank = () => ({ mx: 0, my: 0, jump: false, hook: false, grab: false });
    for (let k = 0; k < 300 && !P.dead; k++) g.step(blank());
    return { dead: P.dead, packs: g.packs.list().length };
  });
  await page.waitForTimeout(900);
  const txt = await page.textContent('#deadTxt');
  await page.click('#respawn');
  await page.waitForTimeout(200);
  const home = await page.evaluate(() => { const C = window.__giver.creature; return C.pos.distanceTo(C.home); });
  out.push((dead.dead && dead.packs === 1 && /Скальник/.test(txt) && home < 0.5 ? '✓ ' : '✗ ') + `загрызен: «${txt.slice(0, 40)}…», рюкзаков ${dead.packs}, скальник у логова (${home.toFixed(1)} м)`);
  console.log(out.join('\n'));
  console.log(errs.join('\n') || 'без ошибок на странице');
  await browser.close();
})();
