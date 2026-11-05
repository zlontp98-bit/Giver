// Giver — первая локация «Высотное поселение», этап 1: только окружение.
// Камера-наблюдатель: прогулка от домиков к смотровой площадке, свободный осмотр, полёт.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGfx, SUN_DIR, QUALITY, QUALITY_ORDER } from '../../src/gfx.js';
import { loadModels, loadTexture, instance, place } from '../../src/models.js';
import { Campfire, Fireflies, flicker } from '../../src/fire.js';
import { makeHero } from '../../src/hero.js';
import { makeRng } from '../../src/noise.js';
import { SPAWN_ASSETS } from './assets.gen.js';
import { patchFog, skyMaterial, SUN, puffTexture } from './sky.js';
import * as T from './terrain.js';
import { Waters, crystals, beam } from './water.js';
import { pineGeometry, roundTreeGeometry, bushGeometry, boulderGeometry, grassGeometry, windMaterial, windUniform, instanced, instancedCells } from './nature.js';
import * as Vg from './village.js';

patchFog();
const gfx = createGfx();
const { scene, camera, renderer, sun, hemi } = gfx;
SUN_DIR.copy(SUN);
gfx.sky.material = skyMaterial();
scene.fog = new THREE.FogExp2('#a8b0d8', 0.0009);
scene.background = new THREE.Color('#9aa6d0');
sun.color.set('#ffd6a8'); sun.intensity = 3.0;
hemi.color.set('#c4ccff'); hemi.groundColor.set('#6e5a4c'); hemi.intensity = 1.25;
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34 });
camera.far = 2400; camera.updateProjectionMatrix();

const texture = (name, srgb) => {
  const t = new THREE.TextureLoader().load(SPAWN_ASSETS[name]);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4;
  return t;
};
const TX = { planks: texture('planks_diff.jpg', true), roof: texture('roof_diff.jpg', true), rock: loadTexture('cliff_side_diff.jpg', true) };

// ——— земля и разлом ———
T.setFlatZones(Vg.flatZones());
const rockMeshes = [];
const addRock = (g, shadow = true) => { const m = new THREE.Mesh(g); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); rockMeshes.push(m); return m; };
for (const g of T.buildPlateau(Vg.dirtAt)) addRock(g, false);
for (const g of T.buildWalls(48)) addRock(g);   // 48 кусков — невидимые не рисуются
for (const m of T.MESAS) addRock(T.buildMesa(m), Math.hypot(m.x, m.z) < 120);
const M = (i) => T.MESAS[i];
const archA = T.mesaEdge(M(2), M(3).x, M(3).z, 2).setY(M(2).top - 30), archB = T.mesaEdge(M(3), M(2).x, M(2).z, 2).setY(M(3).top - 26);
addRock(T.buildArch(archA, archB, 13, 4.2));
addRock(T.buildArch(T.mesaEdge(M(6), M(4).x, M(4).z, 3).setY(M(6).top - 34), T.mesaEdge(M(4), M(6).x, M(6).z, 3).setY(M(4).top - 22), 18, 5.5));
gfx.rockMeshes = rockMeshes;

// ——— поселение ———
const village = Vg.buildVillage(scene, gfx, TX);

// ——— растения и камни ———
const rng = makeRng(99);
const lambertVC = new THREE.MeshLambertMaterial({ vertexColors: true });
const pineNear = [], pineFar = [], round = [], bushes = [], boulders = [], grass = [], flowers = [[], [], []];
const inCore = (x, z) => Math.hypot(x / 44, (z - 42) / 40) < 1;
// деревья поселения (поставлены руками)
for (const [x, z, s] of [[-30, 44, 1.1], [26, 70, 1.0], [27, 43, 0.9], [-8, 77, 1.2], [-27, 62, 1.0], [8, 47, 0.8]]) round.push({ x, y: T.groundH(x, z) - 0.1, z, s, r: x });
for (const [x, z, s] of [[-34, 58, 1.3], [33, 27, 1.2], [-31, 20, 1.1], [22, 18, 1.0], [37, 52, 1.4], [-6, 82, 1.3], [-40, 70, 1.5], [12, 80, 1.35]]) pineNear.push({ x, y: T.groundH(x, z) - 0.1, z, s, r: z });
// лес вокруг: рядом — подробные ёлки, вдали — простые
for (let i = 0; i < 9000 && pineFar.length < 1100; i++) {
  const x = -320 + rng() * 640, z = -580 + rng() * 820;
  const rd = T.rimDist(x, z);
  if (rd < 4 || rd > 150) continue;
  if (inCore(x, z) || !Vg.freeAt(x, z, 3) || T.streamDist(x, z) < 4) continue;
  const dens = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(x * 0.05) * Math.cos(z * 0.043));
  if (rng() > dens) continue;
  const near = Math.hypot(x, z - 40) < 115;
  const p = { x, y: T.groundH(x, z) - 0.2, z, s: 0.9 + rng() * 0.8, r: rng() * 6 };
  if (near) { if (rng() < 0.22) round.push({ ...p, s: p.s * 0.9 }); else pineNear.push(p); } else pineFar.push(p);
}
// на вершинах столовых гор
for (const m of T.MESAS) {
  if (m.pillar) continue;
  for (let i = 0; i < m.trees; i++) {
    const a = rng() * 6.283, r = Math.sqrt(rng()) * m.r * 0.78;
    pineFar.push({ x: m.x + Math.sin(a) * r, y: m.top + 0.2, z: m.z + Math.cos(a) * r, s: 0.8 + rng() * 0.9, r: rng() * 6 });
  }
}
// трава, цветы, кусты, валуны вокруг поселения
for (let i = 0; i < 60000 && grass.length < 5200; i++) {
  const x = -70 + rng() * 140, z = -2 + rng() * 98;
  if (T.rimDist(x, z) < 1.5 || !Vg.freeAt(x, z, -0.6) || T.streamDist(x, z) < 1.9) continue;
  const far = Math.hypot(x, z - 40) / 75;
  if (rng() < far * 0.8) continue;
  grass.push({ x, y: T.groundH(x, z) - 0.05, z, s: 0.8 + rng() * 0.7, r: rng() * 6 });
  if (rng() < 0.06) flowers[Math.floor(rng() * 3)].push({ x: x + 0.3, y: T.groundH(x, z), z: z + 0.2, s: 0.9 + rng() * 0.6, r: rng() * 6 });
}
for (let i = 0; i < 4000 && bushes.length < 90; i++) {
  const x = -75 + rng() * 150, z = 0 + rng() * 100;
  if (T.rimDist(x, z) < 2 || !Vg.freeAt(x, z, 1) || T.streamDist(x, z) < 2.5) continue;
  bushes.push({ x, y: T.groundH(x, z) - 0.1, z, s: 0.7 + rng() * 0.9, r: rng() * 6 });
}
for (let i = 0; i < 3000 && boulders.length < 70; i++) {
  const th = -0.9 + rng() * 1.8, inset = 1 + rng() * 9;
  const p = T.rimPoint(th, inset);
  if (!Vg.freeAt(p.x, p.z, 0.5) || T.rimDist(p.x, p.z) < 0.5) continue;
  boulders.push({ x: p.x, y: T.groundH(p.x, p.z) - 0.25, z: p.z, s: 0.5 + rng() * rng() * 2.4, r: rng() * 6 });
}
const grassMat = windMaterial();
gfx.grass.push(...instancedCells(scene, grassGeometry(), grassMat, grass, 35, { shadow: false, tint: 0.15 }));
instancedCells(scene, pineGeometry(true), lambertVC, pineNear, 40);
instancedCells(scene, pineGeometry(false), lambertVC, pineFar, 90, { shadow: false });
instancedCells(scene, roundTreeGeometry(), lambertVC, round, 40);
instanced(scene, bushGeometry(), windMaterial({ side: THREE.FrontSide }), bushes, { shadow: false });
const bGeo = [boulderGeometry(1), boulderGeometry(5, 1.2), boulderGeometry(9, 0.8)];
bGeo.forEach((g, k) => instanced(scene, g, lambertVC, boulders.filter((_, i) => i % 3 === k)));

// ——— вода, туман, кристаллы, руины, мосты ———
const waters = new Waters(scene);
for (const m of T.MESAS) if (m.fall !== undefined) {
  const p = T.mesaEdge(m, m.x + Math.sin(m.fall) * 50, m.z + Math.cos(m.fall) * 50, 0.6);
  waters.waterfall(p.setY(m.top - 0.3), new THREE.Vector3(Math.sin(m.fall), 0, Math.cos(m.fall)), 2.6, 160, 6);
}
for (const [th, w, h] of [[Math.PI - 0.18, 9, 260], [1.78, 6, 220], [-1.35, 5, 200], [-2.45, 7, 240]]) {
  const p = T.rimPoint(th, 0.2), out = new THREE.Vector3(-Math.sin(th), 0, -Math.cos(th));
  waters.waterfall(new THREE.Vector3(p.x, T.groundH(p.x, p.z) - 0.6, p.z), out, w, h, w * 1.8);
}
waters.mist(3, 18);

const crystalSpots = [];
for (const m of T.MESAS) if (m.crystals) {
  for (let k = 0; k < 3; k++) { const p = T.mesaEdge(m, m.x + Math.sin(k * 2.1) * 50, m.z + Math.cos(k * 2.1) * 50, 2.2); crystalSpots.push({ x: p.x, y: m.top + 0.3, z: p.z, n: 6, s: 1.1 }); }
}
// у руин и на колоннах
crystalSpots.push({ x: M(5).x + 10, y: M(5).top + 0.4, z: M(5).z + 6, n: 8, s: 1.6 }, { x: M(11).x, y: M(11).top + 0.4, z: M(11).z, n: 5, s: 0.9 }, { x: M(13).x, y: M(13).top + 0.3, z: M(13).z, n: 6, s: 1.2 });
const cr = crystals(scene, crystalSpots);
const beamMat = beam(scene, 46, -372);

// руины на дальней столовой горе: арки из камня (своё: высокий проход и обломки)
{
  const m = M(5), parts = [];
  const add = (g, x, y, z, ry = 0) => { g = g.index ? g.toNonIndexed() : g; g.rotateY(ry); g.translate(x, y, z); parts.push(g); };
  const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  for (let i = 0; i < 5; i++) {
    const x = m.x - 12 + i * 6, z = m.z - 8, broken = i === 3;
    add(bx(1.6, broken ? 6 : 11, 1.6), x, m.top + (broken ? 3 : 5.5), z);
    if (i < 4 && i !== 2 && i !== 3) {
      const arch = new THREE.TorusGeometry(3, 0.7, 6, 14, Math.PI);
      add(arch, x + 3, m.top + 11, z);
    }
  }
  add(bx(26, 1.2, 2.2), m.x - 3, m.top + 14.2, m.z - 8);
  add(bx(4, 18, 4), m.x + 14, m.top + 9, m.z - 2);      // башня
  add(bx(5, 1, 5), m.x + 14, m.top + 18.4, m.z - 2);
  add(bx(2.5, 1.2, 1.4), m.x - 6, m.top + 0.4, m.z - 4, 0.6);
  add(bx(1.8, 0.9, 1.2), m.x + 4, m.top + 0.3, m.z - 3, 1.2);
  for (const g of parts) if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const ruins = new THREE.Mesh(mergeGeometries(parts.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; })),
    new THREE.MeshLambertMaterial({ map: TX.rock, color: '#a7a2b8' }));
  scene.add(ruins);
}

// подвесные мосты (доски по провисающей дуге + две верёвки) и деревянные леса на стене справа
const planksList = [], ropes = [];
function bridge(a, b, sag) {
  const L = a.distanceTo(b), n = Math.ceil(L / 0.55);
  const dir = b.clone().sub(a); dir.y = 0; dir.normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x), ry = Math.atan2(dir.x, dir.z);
  const pt = (t) => a.clone().lerp(b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0));
  for (let i = 0; i <= n; i++) { const p = pt(i / n); planksList.push({ x: p.x, y: p.y, z: p.z, s: 1, r: ry + (i % 3 - 1) * 0.03 }); }
  for (const s of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 24; i++) pts.push(pt(i / 24).addScaledVector(side, s * 0.75).add(new THREE.Vector3(0, 0.95 - 0.15 * Math.sin(Math.PI * i / 24), 0)));
    ropes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.05, 4, false));
  }
}
bridge(T.mesaEdge(M(2), M(3).x, M(3).z, 1.5), T.mesaEdge(M(3), M(2).x, M(2).z, 1.5), 7);
bridge(T.mesaEdge(M(1), M(3).x, M(3).z, 1.5), T.mesaEdge(M(3), M(1).x, M(1).z, 1.5), 9);
bridge(T.mesaEdge(M(0), M(11).x, M(11).z, 1.5).setY(M(0).top + 0.2), new THREE.Vector3(M(11).x, M(11).top + 0.5, M(11).z), 6);
{
  const plankGeo = new THREE.BoxGeometry(1.5, 0.08, 0.42);
  instanced(scene, plankGeo, village.mats.crate, planksList, { shadow: false, tint: 0.2 });
  scene.add(new THREE.Mesh(mergeGeometries(ropes), new THREE.MeshLambertMaterial({ color: '#6b5640' })));
  // леса на правой стене: столбы, три площадки, лестница
  const parts = [], th = 0.36, R = T.rimR(th), dir = new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
  const at = (inward, side, y) => new THREE.Vector3(T.C.x + dir.x * (R - inward) + dir.z * side, y, T.C.z + dir.z * (R - inward) - dir.x * side);
  const y0 = T.groundH(at(0, 0, 0).x, at(0, 0, 0).z), ry = Math.atan2(dir.x, dir.z);
  const add = (w, h, d, p, rot = ry) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateY(rot); g.translate(p.x, p.y, p.z); parts.push(g); };
  for (const side of [-2, 2]) for (const inward of [1.2, 3.6]) add(0.25, 24, 0.25, at(inward, side, y0 - 11));
  for (const [k, y] of [[0, -5], [1, -11], [2, -17]]) {
    add(4.8, 0.16, 3.2, at(2.4, 0, y0 + y));
    add(4.8, 0.1, 0.1, at(4.0, 0, y0 + y + 0.9));
  }
  for (let i = 0; i < 16; i++) add(0.9, 0.07, 0.07, at(3.9, 1.6, y0 - 4.6 - i * 0.78));
  add(0.08, 13, 0.08, at(3.9, 1.15, y0 - 11)); add(0.08, 13, 0.08, at(3.9, 2.05, y0 - 11));
  const scaff = new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed())), village.mats.timber);
  scaff.castShadow = true; scaff.receiveShadow = true;
  scene.add(scaff);
}

// ——— костёр, фонари, светлячки ———
const fireBase = new THREE.Vector3(Vg.FIRE.x, T.groundH(Vg.FIRE.x, Vg.FIRE.z), Vg.FIRE.z);
const fire = new Campfire(scene, fireBase, { light: true });
fire.light.distance = 20;
const flies = new Fireflies(scene, fireBase, 22, 10);
const fireGlow = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,170,80,0.9)'); g.addColorStop(0.4, 'rgba(255,130,50,0.35)'); g.addColorStop(1, 'rgba(255,120,40,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  m.position.copy(fireBase).y += 0.08; m.renderOrder = 3; scene.add(m);
  return m;
})();
const puff = puffTexture();
const halos = village.lights.map((p) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: '#ffae55', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.position.copy(p); s.scale.set(1.5, 1.5, 1); scene.add(s); return s;
});
let models = null;
loadModels().then((Mo) => {
  models = Mo;
  place(scene, Mo.campfire_stones, fireBase, 2.6);
  place(scene, Mo.campfire_logs, fireBase, 2.4, 0.6);
  for (const [k, name] of ['flower_purpleA', 'flower_yellowA', 'flower_redA'].entries()) {
    for (const im of instance(scene, Mo[name], flowers[k], { shadow: false })) { im.userData.total = im.count; gfx.grass.push(im); }
  }
  gfx.setQuality(gfx.quality);
});
// герой на смотровой — для масштаба (управление — на этапе 2)
const hero = makeHero();
hero.root.position.set(2.6, T.groundH(2.6, 6.8), 6.8);
hero.root.rotation.y = Math.PI;
scene.add(hero.root);

// ——— камера ———
const cam = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, fly: false, tour: null };
const EYE = 1.65;
function setView(name) {
  cam.tour = null;
  const V = {
    start: [Vg.SPAWN.x, null, Vg.SPAWN.z, 0, -0.04],
    overlook: [Vg.OVERLOOK.x - 0.4, null, Vg.OVERLOOK.z - 1.2, 0.1, -0.24],
    down: [Vg.OVERLOOK.x - 0.6, null, Vg.OVERLOOK.z - 3.4, -0.5, -0.72],
    village: [-26, 9, 16, -2.41, -0.18],
    above: [95, 70, 70, 0.33, -0.3],
  }[name];
  cam.pos.set(V[0], V[1] ?? T.groundH(V[0], V[2]) + EYE, V[2]);
  cam.yaw = V[3]; cam.pitch = V[4];
  cam.fly = V[1] !== null;
  ui.fly.classList.toggle('on', cam.fly);
}
// прогулка: от дома по дорожке к краю, на краю камера медленно опускает взгляд
function startTour() {
  const pts = Vg.PATH.slice(1).map(([x, z]) => new THREE.Vector3(x, T.groundH(x, z) + EYE, z));
  pts.unshift(new THREE.Vector3(Vg.SPAWN.x, T.groundH(Vg.SPAWN.x, Vg.SPAWN.z) + EYE, Vg.SPAWN.z));
  pts.push(new THREE.Vector3(Vg.OVERLOOK.x - 0.3, T.groundH(0, 4) + EYE, 3.8));
  cam.tour = { curve: new THREE.CatmullRomCurve3(pts), t: 0, dur: 24 };
  cam.fly = false; ui.fly.classList.remove('on');
}
function updateTour(dt) {
  const tr = cam.tour; tr.t += dt;
  const walk = Math.min(1, tr.t / tr.dur), e = walk < 0.5 ? 2 * walk * walk : 1 - Math.pow(-2 * walk + 2, 2) / 2;
  const p = tr.curve.getPointAt(e);
  cam.pos.copy(p); cam.pos.y += Math.sin(tr.t * 7.5) * 0.025 * (walk < 1 ? 1 : 0);
  const ahead = tr.curve.getPointAt(Math.min(1, e + 0.04));
  let yaw = Math.atan2(-(ahead.x - p.x), -(ahead.z - p.z));
  if (walk > 0.96 || !isFinite(yaw)) yaw = 0;
  const after = Math.max(0, tr.t - tr.dur);
  const lookDown = Math.min(1, after / 6);
  cam.yaw = lerpAngle(cam.yaw, yaw + Math.sin(after * 0.25) * 0.45 * lookDown, Math.min(1, dt * 2.5));
  cam.pitch += ((-0.05 - 0.4 * Math.sin(Math.min(Math.PI / 2, after * 0.35)) * lookDown) - cam.pitch) * Math.min(1, dt * 2);
  if (after > 22) cam.tour = null;
}
const lerpAngle = (a, b, t) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

// ——— управление: слева джойстик, справа — взгляд; на ПК WASD + мышь ———
const ui = {
  fly: document.getElementById('bFly'), q: document.getElementById('bQ'), fps: document.getElementById('fps'),
  joy: document.getElementById('joy'), knob: document.getElementById('knob'), title: document.getElementById('title'),
};
const inp = { joy: null, look: null, mx: 0, my: 0, keys: new Set() };
const layer = document.getElementById('layer');
layer.addEventListener('pointerdown', (e) => {
  cam.tour = null;
  if (e.clientX < window.innerWidth * 0.42 && !inp.joy) {
    inp.joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
    ui.joy.style.display = 'block'; ui.joy.style.left = e.clientX + 'px'; ui.joy.style.top = e.clientY + 'px';
  } else if (!inp.look) inp.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
window.addEventListener('pointermove', (e) => {
  if (inp.joy && e.pointerId === inp.joy.id) {
    let dx = e.clientX - inp.joy.x0, dy = e.clientY - inp.joy.y0; const l = Math.hypot(dx, dy), R = 55;
    if (l > R) { dx *= R / l; dy *= R / l; }
    inp.mx = dx / R; inp.my = -dy / R;
    ui.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  } else if (inp.look && e.pointerId === inp.look.id) {
    const k = e.pointerType === 'touch' ? 0.006 : 0.004;
    cam.yaw -= (e.clientX - inp.look.x) * k; cam.pitch -= (e.clientY - inp.look.y) * k;
    cam.pitch = Math.max(-1.4, Math.min(1.2, cam.pitch));
    inp.look.x = e.clientX; inp.look.y = e.clientY;
  }
});
const release = (e) => {
  if (inp.joy && e.pointerId === inp.joy.id) { inp.joy = null; inp.mx = inp.my = 0; ui.joy.style.display = 'none'; ui.knob.style.transform = ''; }
  if (inp.look && e.pointerId === inp.look.id) inp.look = null;
};
window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
window.addEventListener('keydown', (e) => { inp.keys.add(e.code); if (/^(Key[WASDQE]|Arrow|Space)/.test(e.code)) cam.tour = null; if (e.code === 'KeyF') toggleFly(); });
window.addEventListener('keyup', (e) => inp.keys.delete(e.code));
function toggleFly() { cam.fly = !cam.fly; cam.tour = null; ui.fly.classList.toggle('on', cam.fly); if (!cam.fly) setView('overlook'); }
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
document.getElementById('bTour').addEventListener('click', startTour);
ui.fly.addEventListener('click', toggleFly);
ui.q.addEventListener('click', () => { const i = (QUALITY_ORDER.indexOf(gfx.quality) + 1) % 3; setQuality(QUALITY_ORDER[i]); });
function setQuality(k) {
  // на «Низкой» у костра нет настоящей лампы (она дорогая для всех материалов) — только светлое пятно на земле
  fire.light.visible = k !== 'low';
  fireGlow.visible = k === 'low';
  gfx.setQuality(k);
  ui.q.textContent = QUALITY[k].name;
  try { localStorage.setItem('giver_spawn_q', k); } catch (e) { /* без сохранения */ }
}

function move(dt) {
  const K = inp.keys;
  let mx = inp.mx + (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
  let my = inp.my + (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0);
  const sp = (cam.fly ? 22 : 4.5) * (K.has('ShiftLeft') ? 2.2 : 1);
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  const nx = cam.pos.x + (fx * my + rx * mx) * sp * dt, nz = cam.pos.z + (fz * my + rz * mx) * sp * dt;
  if (cam.fly) {
    cam.pos.x = nx; cam.pos.z = nz;
    cam.pos.y += my * Math.sin(cam.pitch) * sp * dt + ((K.has('Space') || K.has('KeyE') ? 1 : 0) - (K.has('KeyQ') ? 1 : 0)) * sp * dt;
  } else {
    if (T.rimDist(nx, nz) > 0.6) { cam.pos.x = nx; cam.pos.z = nz; }       // за край не шагнуть
    cam.pos.y = T.groundH(cam.pos.x, cam.pos.z) + EYE;
  }
}

// ——— цикл ———
let last = performance.now(), acc = 0, clock = 0, frames = 0, fpsT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  if (acc < 1 / gfx.fps - 0.002) return;          // не чаще, чем позволяет качество (телефон меньше греется)
  const fdt = Math.min(0.1, acc); acc = 0;
  clock += fdt;
  if (cam.tour) updateTour(fdt); else move(fdt);
  camera.position.copy(cam.pos);
  camera.rotation.set(cam.pitch, cam.yaw, 0, 'YXZ');
  gfx.follow(cam.pos);
  windUniform.value = clock;
  waters.update(clock);
  gfx.sky.material.uniforms.uTime.value = clock;
  beamMat.uniforms.uTime.value = clock;
  cr.mat.emissiveIntensity = 1.0 + 0.25 * Math.sin(clock * 1.6);
  const sc = gfx.pixelScale();
  fire.update(clock, sc); flies.update(clock, sc);
  const fl = flicker(clock) / 26;
  village.mats.glow.color.setRGB(1.6 * fl, 1.05 * fl, 0.45 * fl);
  halos.forEach((h, i) => { h.material.opacity = 0.42 + 0.1 * Math.sin(clock * 9 + i * 2); });
  gfx.render(fdt);
  frames++; fpsT += fdt;
  if (fpsT > 1) { ui.fps.textContent = `${Math.round(frames / fpsT)} к/с`; frames = 0; fpsT = 0; }
}
window.addEventListener('resize', () => gfx.resize());

let q0 = 'low';
try { q0 = localStorage.getItem('giver_spawn_q') || 'low'; } catch (e) { /* нет хранилища */ }
setQuality(QUALITY[q0] ? q0 : 'low');
setView('start');
startTour();
setTimeout(() => ui.title.classList.add('hide'), 4500);
requestAnimationFrame(frame);
window.__spawn = { gfx, cam, setView, setQuality, startTour, scene, T, updateTour };
document.body.classList.add('ready');
