// Бот проходит первый ярус шагами физики (без рисования): node tools/bot.cjs (после npm run build).
// Маршрут: посёлок → смотровая площадка → тропа на террасу → лагерь у водопада → полки «Каменных уступов»
// (спуск по стене между ними) → шахта и зал → траверс по стене → Затерянный лагерь → «Большой спуск» → дно.
// Проверяет, что путь проходим, герой не погибает и где теряет здоровье. Итог — в консоль.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.addInitScript((dbg) => { window.__noAdapt = true; window.__giverFull = true; window.__botDebug = dbg; }, !!process.env.BOTDEBUG);
  await page.goto('file://' + path.resolve(__dirname, '../dist/giver.html'));
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
  await page.click('#go');
  await page.waitForTimeout(300);
  const only = process.argv[2] || '';
  const res = await page.evaluate(async (only) => {
    const g = window.__giver, P = g.player, L = g.L, W = g.W, cam = g.cam, V = P.pos.constructor;
    g.game.running = false;            // кадры не двигают героя — только бот
    const log = [];
    let t = 0, hurtTotal = 0, climbs = 0, minStamina = 100;
    const origHurt = P.hurt.bind(P);
    P.hurt = (d, w) => { hurtTotal += Math.min(d, 1000); log.push(`  ушибся: ${d.toFixed(0)} ${w || ''} y=${P.pos.y.toFixed(1)}`); origHurt(d, w); };
    const blank = () => ({ mx: 0, my: 0, run: false, jump: false, hook: false, grab: false, act: false, camDX: 0, camDY: 0, looking: false });
    let lastGround = null, target = null;
    const step = (inp) => {
      if (P.state === 'ground') lastGround = P.pos.clone();
      g.step(inp); t += 1 / 60; minStamina = Math.min(minStamina, P.stamina);
      if (P.dead) throw new Error(`погиб: сорвался с ${lastGround ? fmt(lastGround) : '?'} по пути к ${target ? fmt(target) : '?'}`);
    };
    const hd = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const R = (th, y) => W.pitR(Math.cos(th), Math.sin(th), y);
    const angD = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    const thOf = (p) => Math.atan2(p.x, p.z);
    const fmt = (p) => `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`;
    const v = (a) => new V(a[0], a[1], a[2]);
    const ss = (e0, e1, x) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
    // точка на полке: доля u по длине, ближе к стене (там шире всего и не свалиться)
    const lp = (l, u) => {
      const th = l.th0 + l.span * u, y = l.y0 + (l.y1 - l.y0) * u;
      const taper = 0.35 + 0.65 * ss(0, 0.12, u) * ss(1, 0.88, u);
      const r = R(th, y) - Math.min(2.2, Math.max(0.9, l.depth * taper * 0.45));
      return new V(Math.sin(th) * r, y, Math.cos(th) * r);
    };
    const steer = (to, run) => { const dx = to.x - P.pos.x, dz = to.z - P.pos.z; cam.yaw = Math.atan2(-dx, -dz); const i = blank(); i.my = 1; i.run = !!run; return i; };
    // идти к точке; застрял — шаг вбок; упал ниже, чем ждали, — ошибка
    async function walkTo(to, { tol = 0.7, maxT = 60, run = false, maxDrop = 6.5 } = {}) {
      const t0 = t, y0 = Math.min(P.pos.y, to.y);
      target = to;
      let lastD = 1e9, lastT = t, side = 1, stuck = 0;
      while (hd(P.pos, to) > tol) {
        if (t - t0 > maxT) throw new Error(`не дошёл до ${fmt(to)}, стою ${fmt(P.pos)} (${P.state})`);
        const d = hd(P.pos, to);
        if (d < lastD - 0.3) { lastD = d; lastT = t; }
        if (t - lastT > 2.5) {                           // застрял: полсекунды вбок
          if (++stuck >= 3 && d < 2.6) break;            // рядом с целью (мешает дерево или камень) — хватит
          if (stuck === 1) { const i = steer(to); i.jump = true; step(i); while (P.state === 'air') step(steer(to)); }   // ступенька — прыжок
          for (let k = 0; k < 30; k++) { const i = steer(to); i.my = 0.3; i.mx = side; step(i); }
          side = -side; lastT = t; lastD = 1e9;
        }
        const i = steer(to, run && d > 4);
        if (d < 1.5) i.my = 0.55;
        step(i);
        if (P.state === 'air') {
          while (P.state === 'air') step(steer(to));
          if (P.pos.y < y0 - maxDrop) throw new Error(`упал при ходьбе к ${fmt(to)}: теперь ${fmt(P.pos)}`);
        }
        if (P.state === 'climb') { const i2 = blank(); i2.grab = true; step(i2); while (P.state === 'air') step(blank()); }
      }
      for (let k = 0; k < 6; k++) step(blank());
      if (window.__botDebug) log.push(`    дошёл к ${fmt(to)}: ${fmt(P.pos)} θ=${thOf(P.pos).toFixed(3)}`);
    }
    async function walkPts(pts, o) { for (const p of pts) await walkTo(p, o); }
    async function ledgeWalk(l, u0, u1) {
      const n = Math.max(2, Math.ceil(Math.abs(u1 - u0) * l.span / 0.028));
      for (let k = 1; k <= n; k++) await walkTo(lp(l, u0 + ((u1 - u0) * k) / n), { tol: 0.9 });
    }
    // спуск по стене: лицом к стене схватиться, вбок до угла th, потом вниз до опоры
    async function climbDown(th, expectY, name) {
      const t0 = t, st0 = P.stamina;
      // подойти вплотную к стене (лицом к ней)
      const out = new V(Math.sin(thOf(P.pos)), 0, Math.cos(thOf(P.pos)));
      cam.yaw = Math.atan2(-out.x, -out.z);
      let lastR = Math.hypot(P.pos.x, P.pos.z);
      for (let k = 0; k < 90; k++) {
        const i = blank(); i.my = 0.5; step(i);
        const r = Math.hypot(P.pos.x, P.pos.z);
        if (k > 10 && r < lastR + 0.002) break;
        lastR = r;
      }
      const i = blank(); i.grab = true; step(i);
      while (P.state === 'mantle') step(blank());
      if (P.state !== 'climb') throw new Error(`${name}: не схватился (${P.state}) у ${fmt(P.pos)}`);
      climbs++;
      // камера смотрит на стену: «вправо» (mx > 0) — угол θ уменьшается
      let dir = angD(th, thOf(P.pos)) > 0 ? -1 : 1, best = 1e9, bestT = t, descending = false;
      while (P.state === 'climb') {
        const n = P.climb.n;
        cam.yaw = Math.atan2(n.x, n.z);
        const d = angD(th, thOf(P.pos));
        const i2 = blank();
        if (Math.abs(d) > (descending ? 0.03 : 0.004)) {
          if (Math.abs(d) < best - 0.002) { best = Math.abs(d); bestT = t; }
          if (t - bestT > 0.8) { dir = -dir; bestT = t; best = 1e9; }   // не туда — в другую сторону
          i2.mx = dir;
        } else { i2.my = -1; descending = true; }
        step(i2);
        if (window.__botDebug && Math.round(t * 60) % 6 === 0) log.push(`    ${P.state} θ=${thOf(P.pos).toFixed(3)} y=${P.pos.y.toFixed(2)} n=${P.climb ? P.climb.n.toArray().map((q) => q.toFixed(2)) : '-'} mx=${i2.mx} my=${i2.my}`);
        if (t - t0 > 40) throw new Error(`${name}: долго лезу, θ=${thOf(P.pos).toFixed(3)} нужно ${th.toFixed(3)} y=${P.pos.y.toFixed(1)}`);
      }
      while (P.state === 'air' || P.state === 'mantle') step(blank());
      log.push(`  ${name}: слез на y=${P.pos.y.toFixed(1)} (ждали ${expectY}), силы ${st0.toFixed(0)}→${P.stamina.toFixed(0)}, ${(t - t0).toFixed(1)} с`);
      if (Math.abs(P.pos.y - expectY) > 2.5) throw new Error(`${name}: оказался не там: y=${P.pos.y.toFixed(1)}`);
      // отдохнуть, если сил мало
      while (P.stamina < 70) step(blank());
    }
    const Lg = L.ledges, N = Math.PI, Rn = L.Rn;
    const at = (th, r, y) => new V(Math.sin(th) * r, y, Math.cos(th) * r);
    const camp = (name) => { const c = g.props.camps.find((c) => c.name === name); return c ? c.pos.clone() : null; };
    const stages = [
      ['посёлок → смотровая', async () => {
        await walkPts([v([L.settle.x, 0, L.settle.z + 16]), v([0, 0, L.settle.z + 40]), v([0, 0, -(Rn + 9)])]);
        await walkPts([v(L.lookout.b).add(new V(0, 0, -1.5)), v([0, 0, -(Rn + 9)])]);
        if (P.pos.y < -1) throw new Error('упал со смотровой');
      }],
      ['тропа на террасу', async () => {
        await walkTo(at(N - 0.06, R(N - 0.06, 0) + 2.5, 0));
        await walkTo(lp(Lg.path, 0.12), { maxDrop: 8 });
        await ledgeWalk(Lg.path, 0.12, 0.96);
        await walkTo(camp('лагерь у водопада') || v([L.poolA.x - 14, -24, L.poolA.z]), { tol: 1.5 });
      }],
      ['терраса → полка к уступам', async () => {
        // вдоль северной стены террасы к её восточному углу, оттуда узкий проход на полку
        await walkPts([v([70, -24, -186]), v([95, -27, -173]), v([106, -28, -162]), v([116, -29, -157])], { tol: 1.2 });
        await ledgeWalk(Lg.ab, 0.9, 0.04);
      }],
      ['Каменные уступы', async () => {
        const [b1, b2, b3] = Lg.b;
        await climbDown(b1.th0 + b1.span - 0.07, b1.y1 - 0.8, 'стена → полка 1');
        await ledgeWalk(b1, 0.88, 0.04);
        await climbDown(b2.th0 + 0.075, -69.5, 'стена → полка 2');
        await ledgeWalk(b2, 0.15, 0.96);
        await climbDown(b2.th0 + b2.span + 0.026, -76.6, 'стена → полка 3');
        await ledgeWalk(b3, 0.9, 0.04);
        await climbDown(Lg.b[2].th0 - 0.025, -92.4, 'стена → площадка шахты');
      }],
      ['Заброшенная шахта', async () => {
        const uOf = (l) => Math.min(0.96, Math.max(0.04, angD(thOf(P.pos), l.th0) / l.span));
        await ledgeWalk(Lg.mineIn, uOf(Lg.mineIn), 0.3);
        await walkPts([...L.mine.map(v), new V(L.hall.pos[0], L.hall.floor, L.hall.pos[2]), ...L.ramp.map(v), lp(Lg.mineOut, 0.4)], { tol: 1.2 });
        await walkTo(lp(Lg.mineOut, 0.05), { tol: 0.9 });
      }],
      ['траверс → Затерянный лагерь', async () => {
        await climbDown(Lg.sw[0].th0 + Lg.sw[0].span - 0.015, -122.3, 'траверс к полке');
        await ledgeWalk(Lg.sw[0], 0.95, 0.04);
        await ledgeWalk(Lg.sw[1], 0.96, 0.04);
        await ledgeWalk(Lg.sw[2], 0.96, 0.03);
        await walkTo(camp('Затерянный лагерь') || v(L.campD.center), { tol: 1.5 });
      }],
      ['Большой спуск', async () => {
        const [e1, e2, e3, e4] = Lg.e;
        await walkTo(at(-1.69, R(-1.69, -120) - 4, -120), { tol: 1.2 });
        await walkTo(lp(e1, 0.9), { maxDrop: 8 });
        await ledgeWalk(e1, 0.9, 0.04);
        await climbDown(e1.th0 - 0.022, -141.5, 'стена → полка E2');
        await ledgeWalk(e2, 0.66, 0.96);
        await climbDown(e2.th0 + e2.span + 0.024, -153.3, 'стена → полка E3');
        await ledgeWalk(e3, 0.92, 0.04);
        await climbDown(e3.th0 - 0.022, -167.4, 'стена → полка E4');
        await ledgeWalk(e4, 0.66, 0.03);
        await ledgeWalk(Lg.scree, 0.95, 0.03);
      }],
      ['дно: озеро и решётка', async () => {
        await walkTo(new V(L.lake.x - L.lake.rx - 4, -204, L.lake.z), { tol: 2, maxT: 90 });
        const gi = v(L.gate.inner);
        await walkTo(gi, { tol: 2.5, maxT: 90 });
      }],
    ];
    // ——— второй путь (node tools/bot.cjs alt): трос со смотровой, арка, тросы по столбам, трос с лагеря на дно ———
    const zipAnchors = P.anchors.filter((a) => a.kind === 'zip');
    const camDirOf = () => new V(-Math.sin(cam.yaw) * Math.cos(cam.pitch), -Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch));
    async function rideZip(i) {
      const a = zipAnchors[i], z = a.zip, back = z.dir.clone().setY(0).normalize();
      await walkTo(new V(z.a.x - back.x * 1.3, z.a.y, z.a.z - back.z * 1.3), { tol: 0.8 });
      cam.yaw = Math.atan2(-back.x, -back.z); cam.pitch = 0.1;
      step(blank());
      const tg = P.pickTarget(camDirOf());
      if (tg !== a) throw new Error(`трос «${a.name}»: прицел не на тросе (${tg ? tg.kind : 'нет'})`);
      const i2 = blank(); i2.hook = true; step(i2);
      const t0 = t;
      while (P.hook || P.state === 'mantle' || P.state === 'zip') { step(blank()); if (t - t0 > 30) throw new Error('долго еду'); }
      while (P.state === 'air') step(blank());
      log.push(`  трос «${a.name}» (${z.len.toFixed(0)} м): ${(t - t0).toFixed(1)} с, приехал y=${P.pos.y.toFixed(1)}`);
    }
    const archPts = (n) => {
      // по гребню арки от террасы к столбу 4
      const A = [L.aX + 92, -31, L.aZ + 12], p4 = L.pillars[3].pos, B = [p4[0] - 4, -38.5, p4[2] - 3], out = [];
      for (let k = 1; k <= n; k++) { const u = k / n; out.push(new V(A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u - 7 * 4 * u * (1 - u) + 4.0, A[2] + (B[2] - A[2]) * u)); }
      return out;
    };
    const altStages = [
      ['посёлок → смотровая → трос на террасу', async () => {
        await walkPts([v([L.settle.x, 0, L.settle.z + 16]), v([0, 0, L.settle.z + 40]), v([0, 0, -(Rn + 9)])]);
        await rideZip(0);
      }],
      ['терраса → арка → столб', async () => {
        await walkPts([v([70, -24, -186]), v([95, -27, -173]), v([L.aX + 88, -30, L.aZ + 6])], { tol: 1.2 });
        await walkPts(archPts(14), { tol: 1.0, maxDrop: 4 });
        await walkTo(v(L.pillars[3].pos), { tol: 2.0 });
      }],
      ['тросы по столбам → шахта', async () => {
        for (let i = 1; i <= 4; i++) await rideZip(i);
      }],
      ['Заброшенная шахта', stages[4][1]],
      ['траверс → Затерянный лагерь', stages[5][1]],
      ['трос с лагеря на дно', async () => {
        await rideZip(5);
        await walkTo(new V(L.lake.x - L.lake.rx - 4, -204, L.lake.z), { tol: 2, maxT: 120 });
      }],
    ];
    if (only === 'alt') stages.splice(0, stages.length, ...altStages);

    // начать с середины: node tools/bot.cjs <номер этапа> (герой переносится на начало этапа)
    const starts = { 4: () => lp(Lg.ab, 0.04), 5: () => lp(Lg.mineIn, 0.85), 6: () => lp(Lg.mineOut, 0.05), 7: () => v(L.campD.center).add(new V(0, 2, 0)), 8: () => lp(Lg.scree, 0.05) };
    let from = 1;
    if (only && starts[+only]) { from = +only; P.spawn(starts[from]()); for (let k = 0; k < 10; k++) step(blank()); log.push(`(начинаю с этапа ${from} у ${fmt(P.pos)})`); }
    let done = from - 1, cur = '';
    try {
      for (const [name, fn] of stages.slice(from - 1)) {
        cur = name;
        const t0 = t, h0 = hurtTotal;
        await fn();
        done++;
        const area = L.areas.find((a) => a.test(P.pos.x, P.pos.y, P.pos.z));
        log.push(`✓ ${name}: ${(t - t0).toFixed(0)} с, y=${P.pos.y.toFixed(1)}, область «${area ? area.name : ''}»${hurtTotal > h0 ? ', урон ' + (hurtTotal - h0).toFixed(0) : ''}`);
      }
    } catch (e) { log.push(`✗ ${cur}: ${e.message}`); }
    return { log, done: done + '/' + stages.length, t: t.toFixed(0) + ' с', y: P.pos.y.toFixed(1), hp: P.health.toFixed(0), hurtTotal: hurtTotal.toFixed(0), climbs, minStamina: minStamina.toFixed(0), camps: g.game.campName || '' };
  }, only);
  console.log(res.log.join('\n'));
  delete res.log;
  console.log(JSON.stringify(res));
  console.log(errs.join('\n') || 'без ошибок на странице');
  await browser.close();
})();
