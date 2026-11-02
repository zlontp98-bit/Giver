// Точка входа: собирает игру из систем и крутит игровой цикл.
//   мир        — world/ (Бездна, маршрут, убранство, пылинки)
//   герой      — player/ (движение, лазание, крюк, вид)
//   камера     — game/camera.js
//   картинка   — render/ (рендер и качество, свет и дымка по глубине, модели, костры)
//   интерфейс  — ui/ (полоски, кнопки, управление, экраны, FPS и «Замер»)
//   сохранение — core/save.js
import * as THREE from 'three';
import { createGfx, QUALITY, QUALITY_ORDER } from './render/gfx.js';
import { Atmosphere } from './render/atmosphere.js';
import { loadModels } from './render/models.js';
import { Campfire, Fireflies } from './render/fire.js';
import { SdfWorld, PIT_DEPTH } from './world/sdf.js';
import { buildLevel1, LEVEL_SEED } from './world/level1.js';
import { buildTerrain, worldMaterial } from './world/terrain.js';
import { Props } from './world/props.js';
import { Water } from './world/water.js';
import { Physics } from './world/physics.js';
import { Motes } from './world/motes.js';
import { Player } from './player/player.js';
import { FollowCamera } from './game/camera.js';
import { Input } from './ui/input.js';
import { Hud, fmtTime } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { FpsMeter, Benchmark, gpuName } from './ui/perf.js';
import { Save } from './core/save.js';
import { ASSETS, FONTS } from './assets.gen.js';

/* global __GIVER_VERSION__ */
const VERSION = typeof __GIVER_VERSION__ !== 'undefined' ? __GIVER_VERSION__ : 'dev';
const SEED = 20261102;
const STEP = 1 / 60;
const $ = (id) => document.getElementById(id);

installFonts();
const save = new Save();
const hud = new Hud();
const gfx = createGfx();
const { scene, camera } = gfx;

// ——— мир: «формула мира» (для физики) и запечённые куски (для картинки) ———
const W = new SdfWorld(LEVEL_SEED);
const L = buildLevel1(W);
gfx.materialFactory = worldMaterial;
const terrain = buildTerrain(worldMaterial(0));
scene.add(terrain.group);
gfx.rockMeshes.push(...terrain.meshes);
const start = new THREE.Vector3(...L.spawn);
const areaName = (x, y, z) => L.areas.find((a) => a.test(x, y, z)).name;

const game = {
  running: false, paused: false, won: false, elapsed: 0, shards: 0, shardsTotal: 0, area: 'village',
  checkpoint: start.clone(), campName: 'посёлок',
};
// подсказка каждого вида — только один раз за игру
const seenHints = new Set();
function once(key, text) { if (!seenHints.has(key)) { seenHints.add(key); hud.message(text, 5, true); } }

const events = {
  message: (t) => hud.message(t),
  hint: (t) => hud.message(t, 5, true),
  hurt: (dmg) => { hud.hurt(); if (dmg >= 10 && dmg < 1000) hud.message(`Ушибся: −${dmg}`); },
  died: (why) => {
    game.running = false;
    screens.showDead(`${why === 'abyss' ? 'Сорвался в бездну.' : 'Слишком сильно ударился.'} Вернёшься: ${game.campName}.`);
  },
  berries: () => hud.message('Ягоды! Силы полные'),
  caught: () => hud.message('Успел схватиться!'),
  hooked: (state, a) => {
    if (a.kind === 'ring') once('ring', 'Кольцо! Прыгни или шагни с края — раскачаешься. «Прыжок» — соскочить с разгона');
    else if (state === 'rope') once('ropeAir', 'Висишь на верёвке: вниз — спуск, вверх — подтянуться, вбок — раскачка, «Прыжок» — соскочить');
    else once('ropeBelay', 'Крюк держит — это страховка. Шагни с края: верёвка поймает. Джойстик вниз — спуск');
  },
  rappelled: () => once('rappel', 'Спустился! Крюк сам отцепился'),
  splash: (h) => hud.message(h > 12 ? `Плюх! Вода спасла — ${Math.round(h)} м в воду` : 'Плюх!', 2.4),
  camp: (c) => {
    game.checkpoint.copy(c.pos);
    game.campName = c.name;
    if (!c.village) hud.message(`${c.name[0].toUpperCase()}${c.name.slice(1)} — сюда вернёшься, если сорвёшься`, 3);
  },
  shard: () => { game.shards++; hud.starPop(); if (game.shards === game.shardsTotal) hud.message('Все осколки собраны!', 3); },
  bottom: () => win(),
};

let props = null, physics = null, water = null, player = null, motes = null;
const atmosphere = new Atmosphere(gfx);                 // свет и дымка по глубине
const fires = [], flies = [];
const cam = new FollowCamera(camera, { solid: (x, y, z) => (physics ? physics.solid(x, y, z) : W.f(x, y, z) < 0.25) }, start);
const input = new Input($('layer'), hud);
const meter = new FpsMeter($('fps'));
const bench = new Benchmark();
const screens = new Screens({
  game, hud, input, save, version: VERSION,
  onStart: () => hud.message('Ты в посёлке на краю Бездны. Пройди к смотровой площадке — оттуда тропа вниз', 6, true),
  onRespawn: () => respawn(),
  onToCamp: () => respawn(),
  onQuality: (q) => setQuality(q, true),
  onShowFps: (on) => setShowFps(on, true),
  onBench: () => startBench(),
  onBenchAbort: () => endBench(false),
  benchRunning: () => bench.running,
});

loadModels().then((models) => {
  props = new Props(scene, L, W, models, gfx);
  // вода: в заводи и в озере можно брести по грудь, падение в воду не ранит
  physics = new Physics(W, props.colliders, [
    { x: L.poolA.x, z: L.poolA.z, rx: 7.5, rz: 6.5, y: -22.2 },
    { x: L.lake.x, z: L.lake.z, rx: L.lake.rx - 2, rz: L.lake.rz - 2, y: L.lake.y },
  ]);
  water = new Water(scene, L, W);
  player = new Player(scene, physics, props, events);
  player.anchors = props.anchors;
  // прогресс: найденные сундуки и прочитанные записки (сохраняются между запусками)
  const prog = save.data.progress || (save.data.progress = { finds: [], notes: [] });
  prog.finds = prog.finds || []; prog.notes = prog.notes || [];
  for (const f of props.finds) if (prog.finds.includes(f.id)) props.takeFind(f);
  for (const n of props.notes) if (prog.notes.includes(n.id)) n.read = true;
  game.shardsTotal = props.finds.length;
  game.shards = props.finds.filter((f) => f.taken).length;
  player.hints = makeHints();
  player.spawn(start);
  player.facing = Math.PI;                                  // лицом к Бездне (на юг)
  cam.yaw = 0;
  props.camps.forEach((c, i) => { c.index = i; });
  for (const f of props.fires) fires.push(new Campfire(scene, f, { light: false }));
  for (const c of props.camps) if (!c.village) flies.push(new Fireflies(scene, c.pos, 14, 7));
  motes = new Motes(scene);
  hud.setupTrack(-PIT_DEPTH, props.camps.filter((c) => !c.village), areaName);
  setQuality(save.settings.quality || 'low', false);
  setShowFps(!!save.settings.showFps, false);
  camera.position.set(start.x, start.y + 4, start.z - 9);
  document.body.classList.add('ready');
  requestAnimationFrame(frame);
  window.__giver = { game, player, W, L, props, physics, water, cam, input, gfx, save, bench, version: VERSION, setQuality, step: (inp) => stepOnce(inp), act: () => player.interact && doAct(player.interact) };
});

// подсказки по пути (каждая — один раз)
function makeHints() {
  const v = (p) => new THREE.Vector3(p[0], p[1], p[2]);
  return [
    { pos: v(L.lookout.a), r: 8, text: 'Смотровая площадка. Справа от неё — тропа вниз, в Бездну' },
    { pos: v([L.aX - 40, -24, L.aZ - 10]), r: 14, text: 'Лесная окраина. Подойди к краю или к скале и жми «Хват» — можно лезть по любой крутой скале' },
    { pos: v(L.gate.inner), r: 12, text: 'Проход на второй ярус завален. Он откроется в следующих версиях' },
    { pos: v(L.mine[0]), r: 10, text: 'Заброшенная шахта. Внутри темно — фонарик на шапке зажжётся сам' },
  ].map((h) => ({ ...h, shown: false }));
}
window.addEventListener('resize', () => gfx.resize());

function respawn() {
  player.spawn(game.checkpoint);
  hud.message(`Ты снова: ${game.campName}`);
}

function setQuality(key, remember) {
  if (!QUALITY[key]) key = 'low';
  gfx.setQuality(key);
  screens.showQuality(key);
  if (remember) { save.settings.quality = key; save.write(); slowTime = 0; }
}

function setShowFps(on, remember) {
  meter.setVisible(on);
  screens.showFpsSetting(on);
  if (remember) { save.settings.showFps = on; save.write(); }
}

// дошёл до дна первого яруса — запомнить время (игра продолжается: можно гулять по дну)
function reachBottom() {
  game.reachedBottom = true;
  const rec = save.records.layer1, isRecord = !rec || game.elapsed < rec.time;
  if (isRecord) { save.records.layer1 = { time: game.elapsed }; save.write(); }
  hud.message(`Дно первого яруса за ${fmtTime(game.elapsed)}${isRecord ? ' — рекорд!' : ` (рекорд ${fmtTime(rec.time)}).`} Проход ниже пока закрыт решёткой.`, 6);
}

// «Действие»: прочитать записку или открыть сундук
function doAct(it) {
  const prog = save.data.progress;
  if (it.kind === 'note') {
    const n = it.item;
    if (!n.read) { n.read = true; if (!prog.notes.includes(n.id)) prog.notes.push(n.id); save.write(); }
    const read = props.notes.filter((q) => q.read).length;
    $('noteTitle').textContent = n.title;
    $('noteTxt').textContent = n.text;
    $('noteCount').textContent = `Записки экспедиции: ${read} из ${props.notes.length}`;
    game.running = false;
    input.reset();
    hud.screen('sNote', true);
  } else if (it.kind === 'find' && !it.item.taken) {
    const f = it.item;
    props.takeFind(f);
    if (!prog.finds.includes(f.id)) prog.finds.push(f.id);
    save.write();
    game.shards = props.finds.filter((q) => q.taken).length;
    hud.starPop();
    hud.message(game.shards === game.shardsTotal ? `${f.name}! Все тайники первого яруса найдены!` : `Находка: ${f.name} (${game.shards} из ${game.shardsTotal})`, 3.5);
  }
}
$('noteClose').onclick = () => { hud.screen('sNote', false); if (!game.paused && !game.won && !player.dead) game.running = true; };

function win() {
  if (game.won) return;
  game.won = true;
  game.running = false;
  const rec = save.records.abyss;
  const isRecord = !rec || game.elapsed < rec.time;
  save.records.abyss = { time: isRecord ? game.elapsed : rec.time, shards: Math.max(rec ? rec.shards || 0 : 0, game.shards) };
  save.write();
  screens.showWin(game.elapsed, game.shards, game.shardsTotal, isRecord ? 'Новый рекорд!' : `Рекорд: ${fmtTime(save.records.abyss.time)}`);
}

// ——— «Замер» скорости: облёт по маршруту без ограничения кадров ———
function startBench() {
  bench.start(L.bench.map((p) => new THREE.Vector3(p[0], p[1], p[2])), player, cam);
}
function endBench(completed) {
  const r = bench.finish(player, cam);
  if (!completed || !r) { screens.showBench(null, save.data.bench); return; }
  const q = QUALITY[gfx.quality], c = gfx.renderer.domElement, d = new Date(), dpr = window.devicePixelRatio || 1;
  const two = (n) => String(n).padStart(2, '0');
  Object.assign(r, {
    quality: gfx.quality, qualityName: q.name, cap: q.fps, gpu: gpuName(gfx.renderer),
    canvas: `${c.width}×${c.height}`,
    screen: `${Math.round(window.innerWidth * dpr)}×${Math.round(window.innerHeight * dpr)}`,
    cores: navigator.hardwareConcurrency || 0, version: VERSION,
    date: `${two(d.getDate())}.${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`,
  });
  save.addBench(r);
  screens.showBench(r, save.data.bench);
}

// ——— цикл ———
let acc = 0, last = performance.now(), clock = 0, courseTime = 0, slowTime = 0, slowCheck = 0;
const camDir = new THREE.Vector3();
const NO_BUTTONS = { jump: false, hook: false, grab: false, act: false };

function stepOnce(inp) {
  courseTime += STEP;
  player.carry();
  player.update(STEP, inp, cam.yaw);
}

function frame(now) {
  requestAnimationFrame(frame);
  // экономия: не рисуем чаще, чем нужно (экраны бывают 90–120 Гц — телефон бы грелся зря);
  // во время «Замера» — без ограничения, чтобы узнать запас скорости
  const fps = bench.running ? 1e4 : game.running ? gfx.fps : 15;
  if (now - last < 1000 / fps - 2) return;
  const t0 = performance.now();
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.1, raw);
  clock += dt;
  const inp = input.read();
  if (bench.running) {
    bench.step(raw, player, cam);
  } else if (game.running) {
    game.elapsed += dt;
    cam.look(inp);
    camera.getWorldDirection(camDir);
    player.pickTarget(camDir);
    acc += dt;
    let first = true;
    while (acc >= STEP) {
      stepOnce(first ? inp : { ...inp, ...NO_BUTTONS });
      first = false;
      acc -= STEP;
    }
    if (inp.act && player.interact) doAct(player.interact);
    adaptQuality(raw);
    const area = L.areas.find((a) => a.test(player.pos.x, player.pos.y, player.pos.z));
    if (area.id !== game.area) { game.area = area.id; hud.message(`${area.name} · глубина ${Math.max(0, Math.round(-player.pos.y))} м`, 3); }
    if (!game.reachedBottom && player.state === 'ground' && player.pos.y < -PIT_DEPTH + 8) reachBottom();
  }
  if (!player) return;
  player.animate(dt);
  const scale = gfx.pixelScale();
  props.update(clock, camera.position);
  terrain.update(camera.position);
  water.update(clock, scale);
  fires.forEach((f) => f.update(clock, scale));
  flies.forEach((f) => f.update(clock, scale));
  const p = player.pos, inCave = p.y < -60 && Math.hypot(p.x, p.z) > W.wallR(p.x, p.z, p.y) + 2;
  atmosphere.update(dt, clock, player, props.fires, inCave);
  motes.update(clock, player.pos, atmosphere.glow, Math.min(1, Math.max(0, (-player.pos.y - 25) / 60)), scale);
  cam.update(dt, inp, player, game.running);
  gfx.follow(player.pos);
  hud.update(dt, player, game, camera);
  gfx.render(dt);
  const cpu = performance.now() - t0;
  meter.frame(raw, cpu);
  if (bench.running) {
    bench.record(raw, cpu);
    screens.benchProgress(bench.secondsLeft);
    if (bench.done) endBench(true);
  }
}

// если телефон не тянет — сами снижаем качество (один раз за уровень)
function adaptQuality(raw) {
  if (window.__noAdapt) return;
  slowCheck += raw;
  const limit = 1.6 / gfx.fps;                    // кадр заметно дольше положенного — тормозит
  slowTime = raw > limit ? slowTime + raw : Math.max(0, slowTime - raw * 0.5);
  if (slowCheck < 4 || slowTime < 3) return;
  const i = QUALITY_ORDER.indexOf(gfx.quality);
  if (i <= 0) return;
  setQuality(QUALITY_ORDER[i - 1], true);
  hud.message(`Графика: ${QUALITY[QUALITY_ORDER[i - 1]].name.toLowerCase()} — чтобы не тормозило`, 3);
  slowTime = 0;
}

function installFonts() {
  const css = FONTS.map((f) => `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:normal;font-display:swap;src:url(${ASSETS[f.file]}) format("woff2");unicode-range:${f.range};}`).join('');
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
}
