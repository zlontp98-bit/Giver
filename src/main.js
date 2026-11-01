// Точка входа: сцена, камера, игровой цикл, экраны.
import * as THREE from 'three';
import { Terrain } from './terrain.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Hud, fmtTime } from './hud.js';
import { makeRng } from './noise.js';

const SEED = 20261101;
const SAVE_KEY = 'giver_v1';
const $ = (id) => document.getElementById(id);

const save = loadSave();
const hud = new Hud();

const renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const SKY = new THREE.Color('#9fd3f0');
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 70, 300);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);

scene.add(new THREE.HemisphereLight('#d8ecff', '#56663a', 1.6));
const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
sun.position.set(80, 140, 60);
scene.add(sun);

const terrain = new Terrain(SEED);
scene.add(terrain.buildMesh());
const world = new World(scene, terrain, SEED);
addClouds(scene, terrain);

const game = {
  running: false, paused: false, won: false,
  elapsed: 0,
  checkpoint: world.start.clone(),
  campName: 'берег',
};

const player = new Player(scene, terrain, world, {
  message: (t) => hud.message(t),
  hurt: (dmg) => { hud.hurt(); if (dmg >= 10) hud.message(`Ушибся: −${dmg}`); },
  died: () => {
    game.running = false;
    $('deadTxt').textContent = `Слишком сильно ударился. Вернёшься: ${game.campName}.`;
    hud.screen('sDead', true);
  },
  berries: () => hud.message('🫐 Ягоды! Силы восстановлены'),
  camp: (c) => {
    game.checkpoint.set(c.x, c.y, c.z);
    game.campName = `лагерь ${c.index + 1}`;
    hud.message(`⛺ Лагерь ${c.index + 1} — сюда вернёшься, если сорвёшься`, 3);
  },
  summit: () => win(),
});
player.spawn(world.start);

// камера: вращается вокруг героя
const cam = { yaw: 0, pitch: 0.2, dist: 7 };
cam.yaw = Math.atan2(world.start.x - terrain.summit.x, world.start.z - terrain.summit.z);
player.facing = cam.yaw + Math.PI;

const input = new Input($('layer'), hud);

// ——— экраны ———
if (save.best) $('best').textContent = `Лучшее время: ${fmtTime(save.best)}`;
$('go').onclick = () => { hud.screen('sStart', false); game.running = true; };
$('pause').onclick = () => setPaused(true);
$('resume').onclick = () => setPaused(false);
$('restart').onclick = () => { location.reload(); };
$('toCamp').onclick = () => { setPaused(false); respawn(); };
$('respawn').onclick = () => { hud.screen('sDead', false); respawn(); game.running = true; };
$('again').onclick = () => location.reload();
if (window.AndroidBridge && window.AndroidBridge.exit) {
  $('exit').style.display = '';
  $('exit').onclick = () => window.AndroidBridge.exit();
}
// кнопка «Назад» на Android: пауза, повторно — продолжить
window.__onBack = () => {
  if (!game.running && !game.paused) return false;
  setPaused(!game.paused);
  return true;
};
document.addEventListener('visibilitychange', () => { if (document.hidden && game.running) setPaused(true); });

function setPaused(p) {
  if (game.won) return;
  game.paused = p;
  game.running = !p;
  hud.screen('sPause', p);
  input.reset();
}

function respawn() {
  player.spawn(game.checkpoint);
  hud.message(`Ты снова: ${game.campName}`);
}

function win() {
  if (game.won) return;
  game.won = true;
  game.running = false;
  const best = save.best ? Math.min(save.best, game.elapsed) : game.elapsed;
  const isRecord = !save.best || game.elapsed < save.best;
  save.best = best;
  writeSave();
  $('winTxt').innerHTML = `Ты поднялся на ${Math.round(terrain.summit.y)} м за <b>${fmtTime(game.elapsed)}</b>.` +
    (isRecord ? '<br>Это новый рекорд!' : `<br>Рекорд: ${fmtTime(best)}`);
  setTimeout(() => hud.screen('sWin', true), 900);
}

// ——— цикл ———
const STEP = 1 / 60;
let acc = 0, last = performance.now(), clock = 0;
const target = new THREE.Vector3(), camPos = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  const inp = input.read();
  if (game.running) {
    game.elapsed += dt;
    acc += dt;
    let first = true;
    while (acc >= STEP) {
      // нажатия кнопок — только в первом шаге кадра
      player.update(STEP, first ? inp : { ...inp, jump: false, grab: false }, cam.yaw);
      first = false;
      acc -= STEP;
    }
    cam.yaw -= inp.camDX * 0.006;
    cam.pitch = Math.max(-0.35, Math.min(1.25, cam.pitch + inp.camDY * 0.005));
    // на скале камера сама плавно заходит за спину
    if (player.climbing && !inp.looking) {
      let d = player.facing + Math.PI - cam.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      cam.yaw += d * Math.min(1, dt * 1.5);
    }
  }
  world.update(clock);
  updateCamera(dt);
  hud.update(dt, player, terrain.summit.y, game.elapsed);
  renderer.render(scene, camera);
}

function updateCamera(dt) {
  target.copy(player.pos);
  target.y += 1.5;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  let dist = cam.dist;
  // не заглядывать сквозь гору
  for (let i = 1; i <= 10; i++) {
    const d = (cam.dist * i) / 10;
    const x = target.x + Math.sin(cam.yaw) * cp * d, z = target.z + Math.cos(cam.yaw) * cp * d;
    const y = target.y + sp * d;
    if (terrain.heightAt(x, z) > y - 0.4) { dist = Math.max(1.2, d - 0.6); break; }
  }
  camPos.set(target.x + Math.sin(cam.yaw) * cp * dist, target.y + sp * dist, target.z + Math.cos(cam.yaw) * cp * dist);
  const g = terrain.heightAt(camPos.x, camPos.z);
  if (camPos.y < g + 0.5) camPos.y = g + 0.5;
  if (camPos.y < 0.4) camPos.y = 0.4;
  camera.position.lerp(camPos, Math.min(1, dt * 12));
  camera.lookAt(target);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

camera.position.set(world.start.x, world.start.y + 6, world.start.z + 8);
requestAnimationFrame(frame);

// для проверки из браузера
window.__giver = { game, player, terrain, world, cam, input, step: (inp) => player.update(STEP, inp, cam.yaw) };

function addClouds(scene, terrain) {
  const rng = makeRng(SEED + 7);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, transparent: true, opacity: 0.92 });
  const count = 26 * 5;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let k = 0;
  for (let c = 0; c < 26; c++) {
    const a = rng() * Math.PI * 2, r = 70 + rng() * 170;
    const cx = terrain.summit.x + Math.cos(a) * r, cz = terrain.summit.z + Math.sin(a) * r;
    const cy = 95 + rng() * 60;
    for (let i = 0; i < 5; i++) {
      p.set(cx + (rng() - 0.5) * 16, cy + (rng() - 0.5) * 3, cz + (rng() - 0.5) * 10);
      const sz = 4 + rng() * 5;
      s.set(sz * 1.4, sz * 0.6, sz);
      m.compose(p, q, s);
      mesh.setMatrixAt(k++, m);
    }
  }
  scene.add(mesh);
}

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
}
function writeSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* нет места — не страшно */ }
}
