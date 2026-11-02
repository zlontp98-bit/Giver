// Скриншоты для отчёта: герой в разных местах первого яруса, игра идёт (камера, вода, огонь живые).
// node tools/gallery.cjs [low|medium|high] → tools/out/gal-*.png (экран телефона 853×384, чёткость ×2)
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const q = process.argv[2] || 'medium', only = process.argv[3];
(async () => {
  const OUT = path.resolve(__dirname, 'out');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 853, height: 384 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.__noAdapt = true; });
  await page.goto('file://' + path.resolve(__dirname, '../dist/giver.html'));
  await page.waitForFunction(() => window.__giver && window.__giver.player, null, { timeout: 120000 });
  await page.evaluate((q) => window.__giver.setQuality(q), q);
  await page.click('#go');
  await page.waitForTimeout(800);
  // [имя, как поставить героя (выполняется в странице), подождать мс]
  const shots = [
    ['1-village', () => { const g = window.__giver; g.cam.yaw = 0.35; g.cam.pitch = 0.22; }],
    ['2-lookout', () => { const g = window.__giver, L = g.L, P = g.player; P.spawn(new P.pos.constructor(L.lookout.b[0] + 1.2, 1, L.lookout.b[2] - 3)); P.facing = 0; g.cam.yaw = Math.PI - 0.15; g.cam.pitch = 0.12; }],
    ['3-path', () => { const g = window.__giver, L = g.L, W = g.W, P = g.player, l = L.ledges.path, u = 0.55, th = l.th0 + l.span * u, y = l.y0 + (l.y1 - l.y0) * u, r = W.pitR(Math.cos(th), Math.sin(th), y) - 2; P.spawn(new P.pos.constructor(Math.sin(th) * r, y + 1, Math.cos(th) * r)); g.cam.yaw = th + 1.9; g.cam.pitch = 0.2; }],
    ['4-waterfall', () => { const g = window.__giver, L = g.L, P = g.player, c = g.props.camps.find((c) => c.name === 'лагерь у водопада'), dx = L.poolA.x - c.pos.x, dz = L.poolA.z - c.pos.z; P.spawn(c.pos.clone().add(new P.pos.constructor(dx * 0.2 - 2, 1, dz * 0.2 + 3))); g.cam.yaw = Math.atan2(-dx, -dz) - 0.55; g.cam.pitch = 0.16; }],
    ['5-climb', () => { const g = window.__giver, W = g.W, P = g.player, th = 1.98, y = -60, r = W.pitR(Math.cos(th), Math.sin(th), y) - 0.6; P.spawn(new P.pos.constructor(0, -60, 0)); P.pos.set(Math.sin(th) * r, y, Math.cos(th) * r); P.state = 'air'; P.vel.set(0, 0, 0); P.peakY = y; P.facing = th; P.tryGrab(); g.cam.yaw = th + Math.PI - 1.35; g.cam.pitch = 0.3; }, 1500],
    ['6-ledges', () => { const g = window.__giver, L = g.L, W = g.W, P = g.player, l = L.ledges.b[2], u = 0.45, th = l.th0 + l.span * u, y = l.y0 + (l.y1 - l.y0) * u, r = W.pitR(Math.cos(th), Math.sin(th), y) - 2.6; P.spawn(new P.pos.constructor(Math.sin(th) * r, y + 1, Math.cos(th) * r)); g.cam.yaw = th + Math.PI / 2 + 0.5; g.cam.pitch = 0.1; }],
    ['7-mine', () => { window.__waitLong = true; const g = window.__giver, L = g.L, P = g.player, a = L.mine[1], b = L.mine[2]; P.spawn(new P.pos.constructor(a[0], a[1] + 1, a[2])); g.cam.yaw = Math.atan2(a[0] - b[0], a[2] - b[2]); g.cam.pitch = 0.1; }],
    ['8-hall', () => { const g = window.__giver, L = g.L, P = g.player, h = L.hall; P.spawn(new P.pos.constructor(h.pos[0] - 4, h.floor + 1, h.pos[2] + 3)); g.cam.yaw = -2.2; g.cam.pitch = 0.18; }],
    ['9-camp', () => { const g = window.__giver, L = g.L, P = g.player, c = L.campD.center, th = L.campD.th; P.spawn(new P.pos.constructor(c[0] + Math.sin(th) * 4, -118, c[2] + Math.cos(th) * 4)); g.cam.yaw = th + 0.35; g.cam.pitch = 0.22; }],
    ['10-bottom', () => { const g = window.__giver, L = g.L, P = g.player; P.spawn(new P.pos.constructor(L.lake.x - 34, -200, L.lake.z - 18)); g.cam.yaw = Math.PI + 1.0; g.cam.pitch = 0.08; }],
  ];
  for (const [name, setup, wait] of shots) {
    if (only && !name.includes(only)) continue;
    await page.evaluate(`(${setup.toString()})()`);
    await page.waitForTimeout(wait || 2600);
    if (/mine|hall/.test(name)) await page.waitForTimeout(6000);    // дымка в шахте темнеет постепенно
    await page.screenshot({ path: path.join(OUT, `gal-${name}.png`) });
    const info = await page.evaluate(() => { const g = window.__giver, r = g.gfx.renderer.info.render; return { y: +g.player.pos.y.toFixed(1), state: g.player.state, area: g.game.area }; });
    console.log(name, JSON.stringify(info));
  }
  console.log(errs.join('\n') || 'без ошибок');
  await browser.close();
})();
