// Точка входа: гора, маршрут, природа, герой, камера, игровой цикл, экраны и качество графики.
import * as THREE from 'three';
import { createGfx, terrainMaterial, waterMaterial, QUALITY, QUALITY_ORDER } from './gfx.js';
import { Terrain, HALF } from './terrain.js';
import { Course } from './course.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Hud, fmtTime } from './hud.js';
import { loadModels } from './models.js';
import { Campfire, Fireflies } from './fire.js';
import { ASSETS, FONTS } from './assets.gen.js';

const SEED = 20261101;
const SAVE_KEY = 'giver_v1';
const STEP = 1 / 60;
const $ = (id) => document.getElementById(id);

installFonts();
const save = loadSave();
const hud = new Hud();
const gfx = createGfx();
const { scene, camera } = gfx;

// ——— мир ———
const terrain = new Terrain(SEED);
const start = findStart(terrain);
const course = new Course(terrain, start, SEED);          // заодно выравнивает площадки под лагеря
gfx.terrainMat = terrainMaterial();
scene.add(terrain.buildMesh(gfx.terrainMat));
const sea = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), waterMaterial());
sea.rotation.x = -Math.PI / 2;
sea.position.y = 0.05;
scene.add(sea);

const game = {
  running: false, paused: false, won: false, elapsed: 0, stars: 0, starsTotal: 0,
  checkpoint: start.clone(), campName: 'берег',
};
const events = {
  message: (t) => hud.message(t),
  hint: (t) => hud.message(t, 4.5, true),
  hurt: (dmg) => { hud.hurt(); if (dmg >= 10 && dmg < 1000) hud.message(`Ушибся: −${dmg}`); },
  died: () => {
    game.running = false;
    $('deadTxt').textContent = `Слишком сильно ударился. Вернёшься: ${game.campName}.`;
    setTimeout(() => hud.screen('sDead', true), 500);
    document.body.classList.remove('playing');
  },
  berries: () => hud.message('Ягоды! Силы полные'),
  camp: (c) => {
    game.checkpoint.copy(c.pos);
    game.campName = `лагерь ${c.index + 1}`;
    hud.message(`Лагерь ${c.index + 1} — сюда вернёшься, если сорвёшься`, 3);
  },
  star: () => { game.stars++; hud.starPop(); if (game.stars === game.starsTotal) hud.message('Все звёзды собраны!', 3); },
  summit: () => win(),
};

let world = null, player = null;
const fires = [], flies = [];
const cam = { yaw: Math.atan2(start.x - terrain.summit.x, start.z - terrain.summit.z), pitch: 0.18, dist: 7.5 };
const input = new Input($('layer'), hud);

loadModels().then((models) => {
  course.build(scene, models);
  world = new World(scene, terrain, models, course, SEED, gfx);
  player = new Player(scene, terrain, world, course, events);
  player.spawn(start);
  player.facing = cam.yaw + Math.PI;
  for (const c of course.camps) { fires.push(new Campfire(scene, c.fire)); flies.push(new Fireflies(scene, c.pos, 14, 7)); }
  game.starsTotal = course.stars.length;
  hud.setupTrack(terrain.summit.y, course.camps);
  setQuality(save.quality || 'medium', false);
  camera.position.set(start.x, start.y + 4, start.z + 9);
  document.body.classList.add('ready');
  requestAnimationFrame(frame);
  window.__giver = { game, player, terrain, course, world, cam, input, gfx, setQuality, step: (inp) => stepOnce(inp) };
});

// ——— экраны и кнопки ———
if (save.best) $('best').textContent = `Рекорд: ${fmtTime(save.best)} · звёзд ${save.bestStars || 0}`;
$('go').onclick = () => {
  hud.screen('sStart', false);
  game.running = true;
  document.body.classList.add('playing');
  hud.message('Иди к скале: на краю светится кольцо для крюка', 4, true);
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
  if (!QUALITY[key]) key = 'medium';
  gfx.setQuality(key);
  document.querySelectorAll('[data-quality] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === key)));
  if (remember) { save.quality = key; writeSave(); slowTime = 0; }
}

function win() {
  if (game.won) return;
  game.won = true;
  game.running = false;
  const isRecord = !save.best || game.elapsed < save.best;
  if (isRecord) save.best = game.elapsed;
  save.bestStars = Math.max(save.bestStars || 0, game.stars);
  writeSave();
  $('wTime').textContent = fmtTime(game.elapsed);
  $('wStars').textContent = `${game.stars}/${game.starsTotal}`;
  $('winTxt').textContent = isRecord ? 'Новый рекорд!' : `Рекорд: ${fmtTime(save.best)}`;
  document.body.classList.remove('playing');
  setTimeout(() => hud.screen('sWin', true), 900);
}

// ——— цикл ———
let acc = 0, last = performance.now(), clock = 0, courseTime = 0, slowTime = 0, slowCheck = 0;
const target = new THREE.Vector3(), camPos = new THREE.Vector3(), camDir = new THREE.Vector3();
const NO_BUTTONS = { jump: false, hook: false };

function stepOnce(inp) {
  courseTime += STEP;
  course.update(courseTime, STEP);
  player.carry();
  player.update(STEP, inp, cam.yaw);
}

function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.1, raw);
  clock += dt;
  const inp = input.read();
  if (game.running) {
    game.elapsed += dt;
    cam.yaw -= inp.camDX * 0.006;
    cam.pitch = Math.max(-0.55, Math.min(1.2, cam.pitch + inp.camDY * 0.005));
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
  } else if (player) {
    course.update(courseTime += dt, dt);
  }
  if (!player) return;
  player.animate(dt);
  world.update(clock);
  const scale = gfx.pixelScale();
  fires.forEach((f) => f.update(clock, scale));
  flies.forEach((f) => f.update(clock, scale));
  sea.material.uniforms.uTime.value = clock;
  updateCamera(dt);
  gfx.follow(player.pos);
  hud.update(dt, player, game, camera);
  gfx.render(dt);
}

function updateCamera(dt) {
  target.copy(player.pos);
  target.y += 1.6;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  let dist = cam.dist;
  // не заглядывать сквозь гору
  for (let i = 1; i <= 12; i++) {
    const d = (cam.dist * i) / 12;
    const x = target.x + Math.sin(cam.yaw) * cp * d, z = target.z + Math.cos(cam.yaw) * cp * d, y = target.y + sp * d;
    if (terrain.heightAt(x, z) > y - 0.35) { dist = Math.max(1.4, d - 0.6); break; }
  }
  camPos.set(target.x + Math.sin(cam.yaw) * cp * dist, target.y + sp * dist, target.z + Math.cos(cam.yaw) * cp * dist);
  const g = terrain.heightAt(camPos.x, camPos.z);
  if (camPos.y < g + 0.5) camPos.y = g + 0.5;
  if (camPos.y < 0.5) camPos.y = 0.5;
  camera.position.lerp(camPos, Math.min(1, dt * 12));
  camera.lookAt(target);
}

// если телефон не тянет — сами снижаем качество (один раз за уровень)
function adaptQuality(raw) {
  if (window.__noAdapt) return;
  slowCheck += raw;
  slowTime = raw > 0.045 ? slowTime + raw : Math.max(0, slowTime - raw * 0.5);
  if (slowCheck < 4 || slowTime < 3) return;
  const i = QUALITY_ORDER.indexOf(gfx.quality);
  if (i <= 0) return;
  setQuality(QUALITY_ORDER[i - 1], true);
  hud.message(`Графика: ${QUALITY[QUALITY_ORDER[i - 1]].name.toLowerCase()} — чтобы не тормозило`, 3);
  slowTime = 0;
}

function findStart(t) {
  let z = HALF - 4;
  for (let s = HALF - 4; s > 0; s -= 0.5) if (t.heightAt(0, s) > 1.2) { z = s - 2; break; }
  return new THREE.Vector3(0, t.heightAt(0, z), z);
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
