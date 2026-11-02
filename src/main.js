// Точка входа: собирает игру из систем и крутит игровой цикл.
//   мир        — world/ (Бездна, маршрут, убранство, пылинки)
//   герой      — player/ (движение, лазание, крюк, вид)
//   камера     — game/camera.js
//   картинка   — render/ (рендер и качество, свет и дымка по глубине, модели, костры)
//   интерфейс  — ui/ (полоски, кнопки, управление, экраны, FPS и «Замер»)
//   сохранение — core/save.js
import * as THREE from 'three';
import { createGfx, terrainMaterial, QUALITY, QUALITY_ORDER } from './render/gfx.js';
import { Atmosphere } from './render/atmosphere.js';
import { loadModels } from './render/models.js';
import { Campfire, Fireflies } from './render/fire.js';
import { Abyss, BOTTOM_Y, LAYERS, layerAt } from './world/abyss.js';
import { Descent } from './world/descent.js';
import { World } from './world/decor.js';
import { Motes } from './world/motes.js';
import { Player } from './player/player.js';
import { FollowCamera } from './game/camera.js';
import { Input } from './ui/input.js';
import { Hud, fmtTime } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { FpsMeter, Benchmark, gpuName, pathFromRoute } from './ui/perf.js';
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

// ——— мир ———
const abyss = new Abyss(SEED);
const descent = new Descent(abyss, SEED);               // заодно расставляет полки
const rockMat = terrainMaterial(0);
const rock = abyss.buildMeshes(rockMat);
rock.traverse((o) => { if (o.isMesh && o.material === rockMat) gfx.rockMeshes.push(o); });
scene.add(rock);
const start = descent.start;

const game = {
  running: false, paused: false, won: false, elapsed: 0, shards: 0, shardsTotal: 0, layer: 0,
  checkpoint: start.clone(), campName: 'край Бездны',
};
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
  camp: (c) => {
    game.checkpoint.copy(c.pos);
    game.campName = `лагерь «${LAYERS[c.layer].name}»`;
    hud.message(`Лагерь — сюда вернёшься, если сорвёшься`, 3);
  },
  shard: () => { game.shards++; hud.starPop(); if (game.shards === game.shardsTotal) hud.message('Все осколки собраны!', 3); },
  bottom: () => win(),
};

let world = null, player = null, motes = null;
const atmosphere = new Atmosphere(gfx);                 // свет и дымка по глубине
const fires = [], flies = [];
const cam = new FollowCamera(camera, abyss, start);
const input = new Input($('layer'), hud);
const meter = new FpsMeter($('fps'));
const bench = new Benchmark();
const screens = new Screens({
  game, hud, input, save, version: VERSION,
  onStart: () => hud.message('Цель — дно Бездны. Иди к краю ямы: у таблички мостки вниз', 5, true),
  onRespawn: () => respawn(),
  onToCamp: () => respawn(),
  onQuality: (q) => setQuality(q, true),
  onShowFps: (on) => setShowFps(on, true),
  onBench: () => startBench(),
  onBenchAbort: () => endBench(false),
  benchRunning: () => bench.running,
});

loadModels().then((models) => {
  descent.build(scene, models);
  world = new World(scene, abyss, descent, models, SEED, gfx);
  player = new Player(scene, abyss, descent, world, events);
  player.spawn(start);
  player.facing = cam.yaw + Math.PI;
  // у костров нет своего света: один общий светит от ближайшего (меньше работы видеокарте)
  for (const c of descent.camps) { fires.push(new Campfire(scene, c.fire, { light: false })); flies.push(new Fireflies(scene, c.pos, 14, 7)); }
  if (descent.baseFire) fires.push(new Campfire(scene, descent.baseFire, { light: false }));
  motes = new Motes(scene);
  game.shardsTotal = descent.shards.length;
  hud.setupTrack(BOTTOM_Y, descent.camps);
  setQuality(save.settings.quality || 'low', false);
  setShowFps(!!save.settings.showFps, false);
  camera.position.set(start.x, start.y + 4, start.z + 9);
  document.body.classList.add('ready');
  requestAnimationFrame(frame);
  window.__giver = { game, player, abyss, descent, world, cam, input, gfx, save, bench, version: VERSION, setQuality, step: (inp) => stepOnce(inp) };
});
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
  bench.start(pathFromRoute(descent.route), player, cam);
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
const NO_BUTTONS = { jump: false, hook: false, grab: false };

function stepOnce(inp) {
  courseTime += STEP;
  descent.update(courseTime, STEP);
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
    descent.update(courseTime += dt, dt);
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
    adaptQuality(raw);
    const k = layerAt(player.pos.y);
    if (k > game.layer) { game.layer = k; hud.message(`${LAYERS[k].name} · глубина ${Math.round(-LAYERS[k].top)} м`, 3.5); }
  } else if (player) {
    descent.update(courseTime += dt, dt);
  }
  if (!player) return;
  player.animate(dt);
  world.update(clock);
  const scale = gfx.pixelScale();
  fires.forEach((f) => f.update(clock, scale));
  flies.forEach((f) => f.update(clock, scale));
  atmosphere.update(clock, player, fires, world.goalPos);
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
