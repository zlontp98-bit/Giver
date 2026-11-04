// Проверка тайников и записок (node tools/secrets.cjs): к каждому сундуку герой доходит пешком от ближайшего
// места на пути (заводь, полка у расщелины, зал шахты, лагерь, берег озера) и открывает его «Действием»;
// записки читаются; вода гасит падение; после перезапуска найденное и прочитанное сохраняется.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 853, height: 384 }, deviceScaleFactor: 1 });
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
  const res = await page.evaluate(() => {
    const g = window.__giver, P = g.player, W = g.W, L = g.L, cam = g.cam, V = P.pos.constructor;
    g.game.running = false;
    const out = [];
    const ok = (c, m) => out.push((c ? '✓ ' : '✗ ') + m);
    const blank = () => ({ mx: 0, my: 0, run: false, jump: false, hook: false, grab: false, act: false, camDX: 0, camDY: 0, looking: false });
    let t = 0;
    const step = (i) => { g.step(i || blank()); t += 1 / 60; if (P.dead) throw new Error('погиб у ' + P.pos.toArray().map((v) => v.toFixed(1))); };
    const R = (th, y) => W.pitR(Math.cos(th), Math.sin(th), y);
    const at = (th, r, y) => new V(Math.sin(th) * r, y, Math.cos(th) * r);
    const hd = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const walkTo = (to, tol = 0.8, maxT = 40) => {
      const t0 = t; let lastD = 1e9, lastT = t, side = 1;
      while (hd(P.pos, to) > tol) {
        if (t - t0 > maxT) throw new Error(`не дошёл до ${to.toArray().map((v) => v.toFixed(1))}, стою ${P.pos.toArray().map((v) => v.toFixed(1))} ${P.state}`);
        const d = hd(P.pos, to);
        if (d < lastD - 0.3) { lastD = d; lastT = t; }
        if (t - lastT > 2.5) { const i0 = blank(); i0.jump = true; i0.my = 1; step(i0); for (let k = 0; k < 30; k++) { const i = blank(); i.my = 0.4; i.mx = side; step(i); } side = -side; lastT = t; lastD = 1e9; }
        cam.yaw = Math.atan2(-(to.x - P.pos.x), -(to.z - P.pos.z));
        const i = blank(); i.my = d < 1.5 ? 0.5 : 1; step(i);
        while (P.state === 'air' || P.state === 'mantle') step(blank());
      }
      for (let k = 0; k < 10; k++) step(blank());
    };
    const actOn = () => { g.act(); };
    const S = L.secrets;
    const routes = {
      compass: () => { P.spawn(new V(L.poolA.x - 9, -22, L.poolA.z)); const th = L.thW, Rw = R(th, -22); return [new V(L.poolA.x - 3, -23, L.poolA.z - 3), at(th, Rw - 2.5, -23), at(th + 0.01, Rw + 5, -22.6), new V(S.wfRoom[0], -22, S.wfRoom[2])]; },
      map: () => { const b1 = L.ledges.b[0], u = (S.thC - b1.th0) / b1.span, th = S.thC, y = b1.y0 + (b1.y1 - b1.y0) * u; P.spawn(at(th, R(th, y) - 2.5, y + 1)); return [at(th, R(th, -60) + 3, S.crevY), at(th, R(th, -60) + 12, S.crevY), at(th, R(th, -60) + 22, S.crevY), new V(S.crevRoom[0], S.crevY, S.crevRoom[2])]; },
      lamp: () => { P.spawn(new V(L.hall.pos[0], L.hall.floor + 1, L.hall.pos[2])); const Rm = Math.hypot(L.mine[0][0], L.mine[0][2]) + 4; return [at(0.79, Rm + 66, -97), at(0.86, Rm + 75, -96.6), new V(S.mineRoom[0], -96.6, S.mineRoom[2])]; },
      badge: () => { const th = L.secret.th, Rs = R(th, -118); P.spawn(at(th, Rs - 14, -118)); return [at(th, Rs - 7, -120), at(th, Rs + 4, -120), new V(L.secret.pos[0], -120, L.secret.pos[2])]; },
      crystal: () => { const I = L.lake.island; P.spawn(new V(L.lake.x - L.lake.rx - 3, -203, L.lake.z)); return [new V(L.lake.x - L.lake.rx + 6, -207, L.lake.z), new V(I.x - 3, -207, I.z), new V(I.x, -206, I.z)]; },
    };
    for (const f of g.ents.byKind('find')) {
      try {
        const pts = routes[f.id.replace('find:', '')]();
        for (let k = 0; k < 10; k++) step(blank());
        let wade = false;
        for (const p of pts) { walkTo(p, 0.9); if (P.inWater) wade = true; }
        // подойти к сундуку вплотную
        walkTo(f.pos, 1.4);
        const near = P.interact && P.interact.item === f;
        actOn();
        ok(near && f.taken, `тайник «${f.name}» (${f.where}): дошёл, ${near ? '«Действие» — открыл' : 'кнопка не появилась'}${wade ? ', брёл по воде' : ''}; находок ${g.game.shards}/${g.game.shardsTotal}`);
      } catch (e) { ok(false, `тайник «${f.name}»: ${e.message}`); }
    }
    // записки: подойти и прочитать
    let read = 0;
    for (const n of g.ents.byKind('note')) {
      for (const [dx, dz] of [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]]) {
        P.spawn(n.pos.clone().add(new V(dx, 1, dz)));
        if (P.state === 'ground' && Math.abs(P.pos.y - n.pos.y) < 1.5) break;
      }
      for (let k = 0; k < 6; k++) step(blank());
      if (P.interact && P.interact.item === n) { actOn(); if (document.getElementById('sNote').classList.contains('show')) { read++; document.getElementById('noteClose').onclick(); } }
      else out.push(`  записка ${n.id} «${n.title}»: кнопка не появилась, герой ${P.pos.toArray().map((v) => v.toFixed(1))} ${P.state}, записка ${n.pos.toArray().map((v) => v.toFixed(1))}`);
      g.game.running = false;
    }
    ok(read === g.ents.byKind('note').length, `записки прочитаны: ${read} из ${g.ents.byKind('note').length}`);
    // падение в озеро с высоты 60 м — без урона
    P.spawn(new V(L.lake.x, -140, L.lake.z)); P.pos.set(L.lake.x - 4, -145, L.lake.z); P.state = 'air'; P.peakY = -145; P.vel.set(0, 0, 0); P.health = 100;
    for (let k = 0; k < 600 && P.state === 'air'; k++) step(blank());
    ok(!P.dead && P.health === 100 && P.inWater, `прыжок в озеро с 60 м: ${P.state}, здоровье ${P.health}, в воде ${!!P.inWater}`);
    return { out, saved: localStorage.getItem('giver_v1') };
  });
  console.log(res.out.join('\n'));
  // перезапуск: найденное сохранилось?
  await page.reload();
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
  const after = await page.evaluate(() => { const g = window.__giver; return { finds: g.ents.byKind('find').filter((f) => f.taken).length, notes: g.ents.byKind('note').filter((n) => n.read).length, shards: g.game.shards + '/' + g.game.shardsTotal }; });
  console.log((after.finds === 5 && after.notes === 8 ? '✓ ' : '✗ ') + 'после перезапуска: ' + JSON.stringify(after));
  console.log(errs.join('\n') || 'без ошибок на странице');
  await browser.close();
})();
