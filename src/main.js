// Точка входа: Бездна, маршрут вниз, убранство, герой, камера, игровой цикл, экраны и качество графики.
import * as THREE from 'three';
import { createGfx, terrainMaterial, QUALITY, QUALITY_ORDER } from './gfx.js';
import { Abyss, BOTTOM_Y, LAYERS, layerAt, layerMix } from './abyss.js';
import { Descent } from './descent.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Hud, fmtTime } from './hud.js';
import { loadModels } from './models.js';
import { Campfire, Fireflies, flicker } from './fire.js';
import { Motes } from './motes.js';
import { ASSETS, FONTS } from './assets.gen.js';

const SEED = 20261102;
const SAVE_KEY = 'giver_v1';
const STEP = 1 / 60;
const $ = (id) => document.getElementById(id);

installFonts();
const save = loadSave();
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
    $('deadTxt').textContent = `${why === 'abyss' ? 'Сорвался в бездну.' : 'Слишком сильно ударился.'} Вернёшься: ${game.campName}.`;
    setTimeout(() => hud.screen('sDead', true), 700);
    document.body.classList.remove('playing');
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
// свет: общий от ближайшего костра (или от кристалла на дне) и мягкая подсветка стен изнутри шахты
const localLight = new THREE.PointLight('#ff8a3a', 0, 16, 1.6);
const fillLight = new THREE.PointLight('#ffffff', 1.3, 0, 0);
scene.add(localLight, fillLight);
const fires = [], flies = [];
const cam = { yaw: Math.atan2(start.x, start.z), pitch: 0.3, dist: 7.5 };
const input = new Input($('layer'), hud);

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
  setQuality(save.quality2 || 'low', false);
  camera.position.set(start.x, start.y + 4, start.z + 9);
  document.body.classList.add('ready');
  requestAnimationFrame(frame);
  window.__giver = { game, player, abyss, descent, world, cam, input, gfx, setQuality, step: (inp) => stepOnce(inp) };
});

// ——— экраны и кнопки ———
if (save.best2) $('best').textContent = `Рекорд: ${fmtTime(save.best2)} · осколков ${save.bestShards2 || 0}`;
$('go').onclick = () => {
  hud.screen('sStart', false);
  game.running = true;
  document.body.classList.add('playing');
  hud.message('Цель — дно Бездны. Иди к краю ямы: у таблички мостки вниз', 5, true);
};
$('pause').onclick = () => setPaused(true);
$('resume').onclick = () => setPaused(false);
$('restart').onclick = () => location.reload();
$('toCamp').onclick = () => { setPaused(false); respawn(); };
$('respawn').onclick = () => { hud.screen('sDead', false); respawn(); game.running = true; document.body.classList.add('playing'); };
$('again').onclick = () => location.reload();
if (window.AndroidBridge && window.AndroidBridge.exit) {
  $('exit').hidden = false;
  $('exit').onclick = () => window.AndroidBridge.exit();
}
document.querySelectorAll('[data-quality] button').forEach((b) => { b.onclick = () => setQuality(b.dataset.q, true); });
// кнопка «Назад» на Android: пауза / продолжить
window.__onBack = () => {
  if (!game.running && !game.paused) return false;
  setPaused(!game.paused);
  return true;
};
document.addEventListener('visibilitychange', () => { if (document.hidden && game.running) setPaused(true); });
window.addEventListener('resize', () => gfx.resize());

function setPaused(p) {
  if (game.won || (!game.running && !game.paused)) return;
  game.paused = p;
  game.running = !p;
  hud.screen('sPause', p);
  document.body.classList.toggle('playing', !p);
  input.reset();
}

function respawn() {
  player.spawn(game.checkpoint);
  hud.message(`Ты снова: ${game.campName}`);
}

function setQuality(key, remember) {
  if (!QUALITY[key]) key = 'low';
  gfx.setQuality(key);
  document.querySelectorAll('[data-quality] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === key)));
  if (remember) { save.quality2 = key; writeSave(); slowTime = 0; }
}

function win() {
  if (game.won) return;
  game.won = true;
  game.running = false;
  const isRecord = !save.best2 || game.elapsed < save.best2;
  if (isRecord) save.best2 = game.elapsed;
  save.bestShards2 = Math.max(save.bestShards2 || 0, game.shards);
  writeSave();
  $('wTime').textContent = fmtTime(game.elapsed);
  $('wStars').textContent = `${game.shards}/${game.shardsTotal}`;
  $('winTxt').textContent = isRecord ? 'Новый рекорд!' : `Рекорд: ${fmtTime(save.best2)}`;
  document.body.classList.remove('playing');
  setTimeout(() => hud.screen('sWin', true), 1200);
}

// ——— цикл ———
let acc = 0, last = performance.now(), clock = 0, courseTime = 0, slowTime = 0, slowCheck = 0;
const target = new THREE.Vector3(), camPos = new THREE.Vector3(), camDir = new THREE.Vector3();
const NO_BUTTONS = { jump: false, hook: false, grab: false };
const fogCol = new THREE.Color(), tmpCol = new THREE.Color(), glowCol = new THREE.Color(), lerp = (a, b, t) => a + (b - a) * t;

function stepOnce(inp) {
  courseTime += STEP;
  descent.update(courseTime, STEP);
  player.carry();
  player.update(STEP, inp, cam.yaw);
}

function frame(now) {
  requestAnimationFrame(frame);
  // экономия: не рисуем чаще, чем нужно (экраны бывают 90–120 Гц — телефон бы грелся зря)
  const fps = game.running ? gfx.fps : 15;
  if (now - last < 1000 / fps - 2) return;
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.1, raw);
  clock += dt;
  const inp = input.read();
  if (game.running) {
    game.elapsed += dt;
    cam.yaw -= inp.camDX * 0.006;
    cam.pitch = Math.max(-0.55, Math.min(1.25, cam.pitch + inp.camDY * 0.005));
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
  updateMood();
  motes.update(clock, player.pos, glowCol, Math.min(1, Math.max(0, (-player.pos.y - 25) / 60)), scale);
  updateCamera(dt, inp);
  gfx.follow(player.pos);
  hud.update(dt, player, game, camera);
  gfx.render(dt);
}

// чем глубже — тем гуще дымка, темнее свет и ярче фонарик
function updateMood() {
  const m = layerMix(player.pos.y), t = m.t;
  fogCol.set(m.a.fog).lerp(tmpCol.set(m.b.fog), t);
  scene.fog.color.copy(fogCol);
  scene.background.copy(fogCol);
  scene.fog.density = lerp(m.a.fogD, m.b.fogD, t);
  const light = lerp(m.a.light, m.b.light, t);
  gfx.hemi.intensity = 1.5 * light;
  gfx.sun.intensity = 2.7 * Math.pow(light, 1.5);
  player.lamp.intensity = Math.max(0, 1 - light) * 9;
  fillLight.color.set(m.a.fill).lerp(tmpCol.set(m.b.fill), t);
  fillLight.intensity = 1.2 + (1 - light) * 0.9;
  fillLight.position.set(0, player.pos.y + 8, 0);
  // ближайший костёр или кристалл на дне
  let best = null, bd = 40;
  for (const f of fires) { const d = f.base.distanceTo(player.pos); if (d < bd) { bd = d; best = f; } }
  const dg = world.goalPos.distanceTo(player.pos);
  if (dg < 60 && (!best || dg < bd)) {
    localLight.position.copy(world.goalPos);
    localLight.color.set('#b86bff'); localLight.distance = 45; localLight.decay = 1.4;
    localLight.intensity = 38 + Math.sin(clock * 1.7) * 6;
  } else if (best) {
    localLight.position.copy(best.base).y += 0.9;
    localLight.color.set('#ff8a3a'); localLight.distance = 16; localLight.decay = 1.6;
    localLight.intensity = flicker(clock);
  } else localLight.intensity = 0;
  glowCol.set(m.a.glow).lerp(tmpCol.set(m.b.glow), t);
  if (glowCol.r + glowCol.g + glowCol.b < 0.1) glowCol.set('#e8f0c8');
}

function updateCamera(dt, inp) {
  // на стене, верёвке и тросе камера сама заходит за спину (если игрок не крутит её сам)
  const wantYaw = player.cameraYaw(), wantPitch = player.cameraPitch();
  if (!inp.looking && game.running) {
    if (wantYaw !== null) {
      const d = Math.atan2(Math.sin(wantYaw - cam.yaw), Math.cos(wantYaw - cam.yaw));
      cam.yaw += d * Math.min(1, dt * 2.2);
    }
    if (wantPitch !== null) cam.pitch += (wantPitch - cam.pitch) * Math.min(1, dt * 1.5);
  }
  target.copy(player.pos);
  target.y += 1.5;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  let dist = cam.dist;
  // не заглядывать сквозь скалу
  for (let i = 1; i <= 14; i++) {
    const d = (cam.dist * i) / 14;
    if (abyss.solid(target.x + Math.sin(cam.yaw) * cp * d, target.y + sp * d, target.z + Math.cos(cam.yaw) * cp * d)) { dist = Math.max(1.1, d - 0.7); break; }
  }
  camPos.set(target.x + Math.sin(cam.yaw) * cp * dist, target.y + sp * dist, target.z + Math.cos(cam.yaw) * cp * dist);
  camera.position.lerp(camPos, Math.min(1, dt * 10));
  camera.lookAt(target);
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

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
}
function writeSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* нет места — не страшно */ }
}
