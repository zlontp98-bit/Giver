// Бот (запуск после npm run build: node tools/bot.cjs) проходит маршрут descent.route шагами физики (без рисования).
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.addInitScript(() => { window.__noAdapt = true; });
  await page.goto('file://' + require('path').resolve(__dirname, '../dist/giver.html'));
  await page.waitForFunction(() => window.__giver, null, { timeout: 60000 });
  await page.click('#go');
  await page.waitForTimeout(300);
  const res = await page.evaluate(async () => {
    const g = window.__giver, P = g.player, D = g.descent, A = g.abyss, cam = g.cam;
    g.game.running = false;            // кадры не двигают героя — только бот
    const log = [];
    let t = 0, deaths = 0, hurtTotal = 0;
    const origHurt = P.hurt.bind(P);
    P.hurt = (d, w) => { hurtTotal += Math.min(d, 1000); log.push(`hurt ${d} ${w || ''} at y=${P.pos.y.toFixed(1)} t=${t.toFixed(1)} state=${P.state}`); origHurt(d, w); };
    const blank = () => ({ mx: 0, my: 0, run: false, jump: false, hook: false, grab: false, camDX: 0, camDY: 0, looking: false });
    const step = (inp) => { g.step(inp); t += 1 / 60; if (P.dead) throw new Error('dead'); };
    const hd = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    // идти к точке: камеру поворачиваем так, чтобы «вперёд» смотрело на цель
    const steerTo = (to, run) => { const dx = to.x - P.pos.x, dz = to.z - P.pos.z; cam.yaw = Math.atan2(-dx, -dz); const i = blank(); i.my = 1; i.run = !!run; return i; };
    async function walkTo(to, tol = 0.45, maxT = 40) {
      const t0 = t;
      while (hd(P.pos, to) > tol) {
        if (g.game.won) return;             // уже у кристалла на дне
        if (t - t0 > maxT) throw new Error(`walk timeout to ${to.x.toFixed(1)},${to.y.toFixed(1)},${to.z.toFixed(1)} at ${P.pos.x.toFixed(1)},${P.pos.y.toFixed(1)},${P.pos.z.toFixed(1)} st=${P.state}`);
        const i = P.state === 'ground' && hd(P.pos, to) < 1.2 ? (() => { const s = steerTo(to); s.my = 0.5; return s; })() : steerTo(to);
        step(i);
        if (P.state === 'air') { while (P.state === 'air') { step(steerTo(to)); if (t - t0 > maxT) throw new Error('fell during walk'); } }
      }
      // остановиться
      for (let k = 0; k < 6; k++) step(blank());
    }
    function aimAt(a) {
      const chest = P.pos.clone(); chest.y += 1.3;
      const d = a.pos.clone().sub(chest).normalize();
      return P.pickTarget(d);
    }
    async function doRappel(s) {
      const tg = aimAt(s.anchor);
      if (tg !== s.anchor) throw new Error('rappel: anchor not targeted, got ' + (tg ? tg.kind : 'null') + ' dist ' + s.anchor.pos.distanceTo(P.pos).toFixed(1));
      const i = blank(); i.hook = true; step(i);
      const t0 = t;
      while (P.state !== 'rope') { step(blank()); if (t - t0 > 3) throw new Error('rappel: never on rope, state ' + P.state); }
      while (P.state === 'rope' || P.state === 'mantle') {
        const i2 = blank(); i2.my = -1; step(i2);
        if (t - t0 > 40) throw new Error('rappel timeout y=' + P.pos.y.toFixed(1));
      }
      // упали? ждём приземления
      while (P.state === 'air') step(blank());
      log.push(`rappel landed y=${P.pos.y.toFixed(1)} target y=${s.to.y.toFixed(1)} state=${P.state}`);
    }
    async function doZip(s) {
      const tg = aimAt(s.anchor);
      if (tg !== s.anchor) throw new Error('zip: anchor not targeted, dist ' + s.anchor.pos.distanceTo(P.pos).toFixed(1));
      const i = blank(); i.hook = true; step(i);
      const t0 = t;
      while (P.state !== 'zip') { step(blank()); if (t - t0 > 3) throw new Error('zip: never on zip ' + P.state); }
      while (P.state === 'zip') { step(blank()); if (t - t0 > 30) throw new Error('zip timeout'); }
      while (P.state === 'air') step(blank());
      log.push(`zip landed y=${P.pos.y.toFixed(1)} target y=${s.to.y.toFixed(1)} t=${(t - t0).toFixed(1)}s`);
    }
    async function doClimb(s) {
      const i = blank(); i.grab = true;
      cam.yaw = Math.atan2(P.pos.x, P.pos.z) + Math.PI;
      step(i);
      const t0 = t;
      while (P.state === 'mantle') step(blank());
      if (P.state !== 'climb') throw new Error('climb: grab failed, state ' + P.state + ' gap ' + A.wallGap(P.pos).toFixed(2));
      const st0 = P.stamina;
      // вбок до нужного угла
      while (P.state === 'climb') {
        const th = P.climb.th;
        cam.yaw = th + Math.PI;
        const d = Math.atan2(Math.sin(s.theta - th), Math.cos(s.theta - th));
        const i2 = blank();
        if (Math.abs(d) > 0.004) { i2.mx = d > 0 ? -1 : 1; }   // камера смотрит на стену: «вправо» = угол уменьшается
        else i2.my = -1;
        step(i2);
        if (t - t0 > 30) throw new Error('climb timeout th=' + th.toFixed(3) + ' want ' + s.theta.toFixed(3) + ' y=' + P.pos.y.toFixed(1));
      }
      while (P.state === 'air' || P.state === 'mantle') step(blank());
      log.push(`climb landed y=${P.pos.y.toFixed(1)} target ${s.to.y.toFixed(1)} stamina ${st0.toFixed(0)}→${P.stamina.toFixed(0)} in ${(t - t0).toFixed(1)}s`);
    }
    // прыжки по камням/доскам
    async function doJumps(s) {
      const plats = s.plats;
      for (let k = 0; k < plats.length; k++) {
        const b = plats[k];
        const top = () => new THREE_V(b.c.x, b.c.y + b.hy, b.c.z);
        const t0 = t;
        // на земле: разбег к цели, прыжок, когда пора
        let jumped = false;
        while (true) {
          const c = top();
          if (P.state === 'ground' && P.onBox === b) break;
          if (t - t0 > 15) throw new Error(`jump ${k} timeout at ${P.pos.toArray().map((v) => v.toFixed(1))} plat ${c.toArray().map((v) => v.toFixed(1))} st=${P.state}`);
          if (P.state === 'ground') {
            const d = hd(P.pos, c), dy = P.pos.y - c.y;
            const i = steerTo(c, d > 2.2);
            if (d < 0.6) { i.my = 0; }
            // прыгать, если цель дальше 1.6 м и мы у края опоры (или далеко и опора кончается)
            const ahead = P.pos.clone(); const dir = c.clone().sub(P.pos).setY(0).normalize(); ahead.addScaledVector(dir, 0.55);
            const sup = P.supportAt(ahead, 0.45);
            const edge = !sup || sup.y < P.pos.y - 0.6;
            if (edge && d > 1.4 && !jumped) { i.jump = true; jumped = true; }
            step(i);
          } else if (P.state === 'air') {
            // в воздухе: рулим так, чтобы долететь к центру
            const vy = P.vel.y, h = Math.max(0.05, P.pos.y - c.y);
            const tl = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * 22 * h))) / 22;
            const want = c.clone().sub(P.pos).setY(0).multiplyScalar(1 / Math.max(0.12, tl));
            const dv = want.sub(new THREE_V(P.vel.x, 0, P.vel.z));
            const i = blank();
            if (dv.length() > 0.2) { cam.yaw = Math.atan2(-dv.x, -dv.z); i.my = Math.min(1, dv.length() / 2); }
            step(i);
          } else step(blank());
          if (P.state === 'ground' && P.onBox !== b && jumped) {
            // приземлились не туда
            log.push(`jump ${k}: landed elsewhere y=${P.pos.y.toFixed(1)} plat y=${c.y.toFixed(1)}`);
            jumped = false;
            if (P.pos.y < c.y - 0.5) throw new Error('fell below platform ' + k);
          }
        }
        for (let q = 0; q < 10; q++) step(blank());
      }
      // с последнего — на полку
      await jumpTo(s.to);
    }
    async function jumpTo(to) {
      const t0 = t; let jumped = false;
      while (!(P.state === 'ground' && Math.abs(P.pos.y - to.y) < 0.3 && hd(P.pos, to) < 3.5)) {
        if (t - t0 > 15) throw new Error('jumpTo timeout ' + P.pos.toArray().map((v) => v.toFixed(1)) + ' st ' + P.state + ' to ' + to.toArray().map((v) => v.toFixed(1)));
        if (P.state === 'ground') {
          const i = steerTo(to, true);
          const ahead = P.pos.clone(); const dir = to.clone().sub(P.pos).setY(0).normalize(); ahead.addScaledVector(dir, 0.55);
          const sup = P.supportAt(ahead, 0.45);
          if ((!sup || sup.y < P.pos.y - 0.6) && !jumped && hd(P.pos, to) > 2) { i.jump = true; jumped = true; }
          step(i);
        } else if (P.state === 'air') {
          const vy = P.vel.y, h = Math.max(0.05, P.pos.y - to.y);
          const tl = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * 22 * h))) / 22;
          const want = to.clone().sub(P.pos).setY(0).multiplyScalar(1 / Math.max(0.12, tl));
          const dv = want.sub(new THREE_V(P.vel.x, 0, P.vel.z));
          const i = blank();
          if (dv.length() > 0.2) { cam.yaw = Math.atan2(-dv.x, -dv.z); i.my = Math.min(1, dv.length() / 2); }
          step(i);
        } else step(blank());
      }
    }
    async function doDrop(s) {
      // шагнуть с края к грибу
      const c = s.pad.c.clone(); c.y += s.pad.hy;
      const t0 = t;
      while (!(P.state === 'ground' && P.onBox === s.pad)) {
        if (t - t0 > 15) throw new Error('drop timeout ' + P.state + ' y=' + P.pos.y.toFixed(1));
        if (P.state === 'ground' && P.pos.y > c.y + 2) { const i = steerTo(c); i.my = 0.6; step(i); }
        else if (P.state === 'air') {
          const vy = P.vel.y, h = Math.max(0.05, P.pos.y - c.y);
          const tl = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * 22 * h))) / 22;
          const want = c.clone().sub(P.pos).setY(0).multiplyScalar(1 / Math.max(0.12, tl));
          const dv = want.sub(new THREE_V(P.vel.x, 0, P.vel.z));
          const i = blank();
          if (dv.length() > 0.2) { cam.yaw = Math.atan2(-dv.x, -dv.z); i.my = Math.min(1, dv.length() / 2); }
          step(i);
        } else if (P.state === 'ground') { log.push('drop: landed not on pad y=' + P.pos.y.toFixed(1)); break; }
        else step(blank());
      }
      for (let q = 0; q < 90; q++) step(blank());     // пружинит
      log.push(`drop done y=${P.pos.y.toFixed(1)} state=${P.state}`);
    }
    const THREE_V = P.pos.constructor;
    let idx = 0;
    try {
      for (const s of D.route) {
        if (s.type === 'walk') await walkTo(s.to);
        else if (s.type === 'climb') await doClimb(s);
        else if (s.type === 'rappel') await doRappel(s);
        else if (s.type === 'zip') await doZip(s);
        else if (s.type === 'jumps') await doJumps(s);
        else if (s.type === 'drop') await doDrop(s);
        idx++;
        if (P.dead) throw new Error('dead');
        if (g.game.won) break;              // дошли до кристалла на дне — дальше идти некуда
      }
    } catch (e) { log.push('STOP at step ' + idx + ' (' + D.route[idx].type + '): ' + e.message); }
    return { log, idx, total: D.route.length, t: t.toFixed(1), y: P.pos.y.toFixed(1), won: g.game.won, shards: g.game.shards + '/' + g.game.shardsTotal, hp: P.health.toFixed(0), hurtTotal };
  });
  console.log(JSON.stringify(res, null, 1));
  console.log(errs.join('\n'));
  await browser.close();
})();
