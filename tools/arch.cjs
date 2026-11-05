// Проверка архитектуры (node tools/arch.cjs):
// 1) старое сохранение 0.5-a3 (progress) переводится в состояние игры и сущности;
// 2) постройка — своя геометрия и столкновения: платформа у стены держит героя, сохраняется после
//    перезапуска, после разборки столкновение исчезает (герой падает);
// 3) столкновения и крюк не зависят от подробности кусков: опора под ногами одна и та же при любой LOD.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.__noAdapt = true; window.__giverFull = true; });
  const url = 'file://' + path.resolve(__dirname, '../dist-full/giver.html');
  const out = [];
  const ok = (c, m) => out.push((c ? '✓ ' : '✗ ') + m);
  await page.goto(url);
  await page.evaluate(() => localStorage.setItem('giver_v1', JSON.stringify({ v: 2, settings: { quality: 'low' }, records: {}, progress: { finds: ['compass'], notes: ['n1', 'n3'] }, bench: [] })));
  await page.goto(url);
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
  const mig = await page.evaluate(() => { const g = window.__giver; return { find: g.ents.get('find:compass').taken, n1: g.ents.get('note:n1').read, n3: g.ents.get('note:n3').read, n2: g.ents.get('note:n2').read, shards: g.game.shards, v: g.state.v }; });
  ok(mig.find && mig.n1 && mig.n3 && !mig.n2 && mig.shards === 1, 'перевод сохранения 0.5-a3: ' + JSON.stringify(mig));
  await page.click('#go');
  const st = await page.evaluate(() => {
    const g = window.__giver, P = g.player, W = g.W, V = P.pos.constructor, r = [];
    g.game.running = false;
    const blank = () => ({ mx: 0, my: 0, jump: false, hook: false, grab: false });
    // платформа у стены на высоте −70 (под ней пропасть)
    const th = 2.2, y = -70, R = W.pitR(Math.cos(th), Math.sin(th), y);
    let pos = null;
    // центр платформы — в 1.0 м от скалы (по лучу от центра Бездны к стене)
    for (let d = -6; d < 12; d += 0.1) { const q = new V(Math.sin(th) * (R - d), y, Math.cos(th) * (R - d)); if (W.f(q.x, y + 0.1, q.z) > 1.0) { pos = q; break; } }
    const bad = g.structures.canPlace('platform', new V(0, -100, 0), 0);
    r.push(['в воздухе посреди Бездны платформу ставить нельзя', !bad.ok, bad.why]);
    const res = g.structures.place('platform', pos, th);
    r.push(['платформа у стены поставлена', res.ok, res.ok ? res.e.id : res.why]);
    if (!res.ok) return { r, id: null, pos: [pos.x, pos.y, pos.z] };
    // встать на неё сверху
    P.spawn(new V(0, -60, 0)); P.pos.set(pos.x, pos.y + 1.5, pos.z); P.state = 'air'; P.vel.set(0, 0, 0); P.peakY = P.pos.y;
    for (let k = 0; k < 120; k++) g.step(blank());
    r.push(['герой стоит на платформе', P.state === 'ground' && Math.abs(P.pos.y - (pos.y + 0.2)) < 0.15, `${P.state} y=${P.pos.y.toFixed(2)} верх ${(pos.y + 0.2).toFixed(2)}`]);
    g.save.write();
    return { r, id: res.e.id, pos: [pos.x, pos.y, pos.z] };
  });
  for (const [m, c, d] of st.r) ok(c, `${m}: ${d}`);
  if (!st.id) { console.log(out.join('\n')); await browser.close(); process.exit(1); }
  await page.reload();
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 90000 });
  await page.click('#go');
  const st2 = await page.evaluate(([id, p]) => {
    const g = window.__giver, P = g.player, V = P.pos.constructor, r = [];
    g.game.running = false;
    const e = g.ents.get(id);
    r.push(['после перезапуска платформа на месте', !!e && e.pos.distanceTo(new V(...p)) < 0.01, e ? e.type : 'нет']);
    const blank = () => ({ mx: 0, my: 0, jump: false, hook: false, grab: false });
    P.spawn(new V(0, -60, 0)); P.pos.set(p[0], p[1] + 1.5, p[2]); P.state = 'air'; P.vel.set(0, 0, 0); P.peakY = P.pos.y;
    for (let k = 0; k < 120; k++) g.step(blank());
    r.push(['и снова держит', P.state === 'ground', P.state]);
    g.structures.remove(e);
    for (let k = 0; k < 30; k++) g.step(blank());
    r.push(['разобрали — столкновение исчезло, герой падает', P.state === 'air' && P.pos.y < p[1], `${P.state} y=${P.pos.y.toFixed(1)}`]);
    r.push(['из сохранения тоже убрана', !g.state.entities[id], '']);
    // опора не зависит от подробности кусков
    const gp = [];
    for (const q of [[0, 0, -262], [g.L.aX, -20, g.L.aZ], [0, -200, 0]]) gp.push(g.physics.ground(q[0], q[1] + 30, q[2], 0, 80));
    g.terrain.update(new V(0, 3000, 0));            // всё — грубые копии
    const gp2 = [[0, 0, -262], [g.L.aX, -20, g.L.aZ], [0, -200, 0]].map((q) => g.physics.ground(q[0], q[1] + 30, q[2], 0, 80));
    r.push(['опора одинакова при подробных и грубых кусках (столкновения — по формуле мира)', gp.every((a, i) => a && gp2[i] && a.y === gp2[i].y), gp.map((a) => a && a.y.toFixed(2)).join(' ')]);
    return r;
  }, [st.id, st.pos]);
  for (const [m, c, d] of st2) ok(c, `${m}${d ? ': ' + d : ''}`);
  console.log(out.join('\n'));
  console.log(errs.join('\n') || 'без ошибок на странице');
  await browser.close();
})();
