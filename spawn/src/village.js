// Стартовое поселение на краю разлома: домики, навес с верстаком, костёр, ящики, бочки, поленница,
// инструменты, фонари, ограда вдоль края, каменная дорожка к смотровой площадке.
// Всё деревянное/каменное сливается в несколько больших мешей по материалам (мало вызовов рисования).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundBase, groundH, rimPoint, rimR, C } from './terrain.js';
import { boulderGeometry, instanced } from './nature.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ——— план поселения (фронт поселения смотрит на север, −z, где разлом) ———
export const SPAWN = V(0.5, 0, 66);
export const OVERLOOK = V(0, 0, 5.5);
export const PATH = [[0.5, 70], [1.2, 60], [-0.8, 49], [0.8, 38], [0.2, 27], [-0.2, 17], [0, 9]];
export const HOUSES = [
  { x: -15.5, z: 52, rot: Math.PI / 2, w: 8, d: 6, h: 3.0, porch: true, banners: true },
  { x: 16.5, z: 57, rot: -Math.PI / 2, w: 6.4, d: 5.4, h: 2.7, porch: true },
  { x: -21, z: 31, rot: Math.PI / 2 - 0.5, w: 5, d: 4.4, h: 2.5 },
];
export const CANOPY = { x: 12.5, z: 35, rot: -0.35 };
export const FIRE = V(-4.2, 0, 40.5);
export const LANTERNS = [[2.6, 61], [-2.6, 49.5], [2.6, 37], [-2.3, 25], [2.2, 15], [-3.6, 7.2], [3.6, 7.2], [-10.2, 50.5], [12, 55]];

function distToPath(x, z) {
  let best = 1e9;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
export function flatZones() {
  const z = HOUSES.map((h) => ({ x: h.x, z: h.z, r: Math.max(h.w, h.d) * 0.75 + 1.5 }));
  z.push({ x: CANOPY.x, z: CANOPY.z, r: 4.5 }, { x: FIRE.x, z: FIRE.z, r: 5 }, { x: OVERLOOK.x, z: OVERLOOK.z, r: 5 });
  for (const f of z) f.h = groundBase(f.x, f.z);
  return z;
}
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function dirtAt(x, z) {
  let d = sm(3.2, 1.2, distToPath(x, z)) * 0.85;
  for (const h of HOUSES) d = Math.max(d, sm(Math.max(h.w, h.d) * 0.7 + 2, Math.max(h.w, h.d) * 0.5, Math.hypot(x - h.x, z - h.z)) * 0.7);
  d = Math.max(d, sm(5, 2.5, Math.hypot(x - FIRE.x, z - FIRE.z)) * 0.9, sm(4.5, 2, Math.hypot(x - CANOPY.x, z - CANOPY.z)) * 0.7);
  d = Math.max(d, sm(5.5, 3.5, Math.hypot(x - OVERLOOK.x, z - OVERLOOK.z)) * 0.6);
  return d;
}
// можно ли ставить траву/дерево (не на дорожке, не в доме)
export function freeAt(x, z, pad = 0) {
  if (distToPath(x, z) < 2.2 + pad) return false;
  for (const h of HOUSES) if (Math.hypot(x - h.x, z - h.z) < Math.max(h.w, h.d) * 0.75 + 1.2 + pad) return false;
  if (Math.hypot(x - FIRE.x, z - FIRE.z) < 3.6 + pad || Math.hypot(x - CANOPY.x, z - CANOPY.z) < 4 + pad) return false;
  if (Math.hypot(x - OVERLOOK.x, z - OVERLOOK.z) < 5 + pad) return false;
  return true;
}

// ——— геометрия с «мировыми» UV (текстура одного размера на любом ящике) ———
function box(w, h, d, s = 1.6) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / s, uv.getY(i) * dims[f][1] / s); }
  return g;
}
function cyl(rt, rb, h, seg = 10, s = 1.6, r = 1.0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (Math.PI * 2 * r * rb) / s, uv.getY(i) * h / s);
  return g;
}

class Builder {
  constructor() { this.b = {}; this.M = new THREE.Matrix4(); }
  at(x, y, z, rot = 0) { this.M.compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rot), V(1, 1, 1)); return this; }
  add(kind, g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    g = g.index ? g.toNonIndexed() : g;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1)));
    g.applyMatrix4(this.M);
    (this.b[kind] ||= []).push(g);
  }
  finish(scene, mats) {
    const out = [];
    for (const [k, list] of Object.entries(this.b)) {
      const g = mergeGeometries(list);
      const m = new THREE.Mesh(g, mats[k]);
      m.castShadow = k !== 'glow'; m.receiveShadow = true;
      scene.add(m); out.push(m);
    }
    return out;
  }
}

function house(B, H) {
  const y = groundH(H.x, H.z);
  B.at(H.x, y, H.z, H.rot);
  const { w, d, h } = H, base = 0.45, rh = w * 0.4;
  B.add('stone', box(w + 0.6, 0.9, d + 0.6, 1.2), 0, base - 0.45);
  B.add('planks', box(w, h, d), 0, base + h / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add('timber', box(0.3, h + 0.15, 0.3), sx * w / 2, base + h / 2, sz * d / 2);
  for (const sz of [-1, 1]) B.add('timber', box(w + 0.4, 0.24, 0.32), 0, base + h, sz * d / 2);
  for (const sx of [-1, 1]) B.add('timber', box(0.32, 0.24, d + 0.3), sx * w / 2, base + h, 0);
  // фронтоны (треугольники над стенами спереди и сзади)
  const tri = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rh)]);
  for (const sz of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(tri, { depth: 0.16, bevelEnabled: false });
    g.scale(1, 1, 1); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.6, uv.getY(i) / 1.6);
    B.add('planks', g, 0, base + h + 0.1, sz * d / 2 - 0.08);
  }
  // крыша: два ската с выносом
  const half = w / 2 + 0.75, ang = Math.atan2(rh, w / 2), L = half / Math.cos(ang);
  for (const sx of [-1, 1]) {
    B.add('roof', box(L, 0.18, d + 1.3, 1.4), sx * (half / 2 - 0.02), base + h + 0.1 + rh - (half / 2) * Math.tan(ang) + 0.12, 0, 0, 0, -sx * ang);
  }
  B.add('timber', box(0.3, 0.3, d + 1.4), 0, base + h + rh + 0.2, 0);
  // дверь и окна (окна светятся тёплым)
  B.add('door', box(1.15, 2.05, 0.12), -w * 0.18, base + 1.02, d / 2 + 0.04);
  B.add('timber', box(1.45, 0.16, 0.18), -w * 0.18, base + 2.12, d / 2 + 0.06);
  const win = (x, z, ry) => {
    B.add('glow', box(0.8, 0.72, 0.06), x, base + 1.55, z, 0, ry);
    for (const [ox, oy, ww, hh] of [[0, 0.42, 1.0, 0.12], [0, -0.42, 1.0, 0.12], [0.45, 0, 0.12, 0.8], [-0.45, 0, 0.12, 0.8], [0, 0, 0.06, 0.74]]) {
      const dx = Math.cos(ry) * ox, dz = -Math.sin(ry) * ox;
      B.add('timber', box(ww, hh, 0.1), x + dx, base + 1.55 + oy, z + dz, 0, ry);
    }
  };
  win(w * 0.22, d / 2 + 0.06, 0);
  win(w / 2 + 0.06, 0, Math.PI / 2);
  win(-w / 2 - 0.06, -d * 0.1, Math.PI / 2);
  // труба
  B.add('stone', box(0.85, rh + 2.2, 0.85, 1.2), w * 0.28, base + h + (rh + 2.2) / 2 - 0.6, -d * 0.22);
  if (H.porch) {
    B.add('planks', box(w + 0.2, 0.18, 2.4), 0, base + 0.05, d / 2 + 1.2);
    for (const sx of [-1, 1]) B.add('timber', box(0.24, 2.6, 0.24), sx * (w / 2 - 0.1), base + 1.3, d / 2 + 2.25);
    B.add('timber', box(w + 0.2, 0.2, 0.26), 0, base + 2.55, d / 2 + 2.25);
    B.add('roof', box(w + 0.8, 0.14, 2.9, 1.4), 0, base + 2.85, d / 2 + 1.25, 0.2);
    B.add('timber', box(w, 0.1, 0.1), 0, base + 0.9, d / 2 + 2.25);           // перила
  }
  return { y, base };
}

function lantern(B, x, z, y) {
  B.at(x, y, z, 0);
  B.add('timber', box(0.2, 2.7, 0.2), 0, 1.35, 0);
  B.add('timber', box(0.75, 0.12, 0.12), 0.3, 2.62, 0);
  B.add('metal', box(0.42, 0.06, 0.42), 0.62, 2.3, 0);
  B.add('metal', box(0.32, 0.06, 0.32), 0.62, 1.84, 0);
  B.add('metal', box(0.04, 0.5, 0.04), 0.62, 2.55, 0);
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) B.add('metal', box(0.04, 0.44, 0.04), 0.62 + a * 0.15, 2.07, b * 0.15);
  B.add('glow', box(0.24, 0.36, 0.24), 0.62, 2.07, 0);
  return V(x + 0.62, y + 2.07, z);
}

function crate(B, x, z, s = 0.9, rot = 0, y = null) {
  y = y ?? groundH(x, z);
  B.at(x, y, z, rot);
  B.add('crate', box(s, s, s, 1.0), 0, s / 2, 0);
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) B.add('timber', box(0.08, s + 0.02, 0.08), a * s / 2, s / 2, b * s / 2);
  return y + s;
}
function barrel(B, x, z) {
  const y = groundH(x, z);
  B.at(x, y, z, x * 3);
  B.add('crate', cyl(0.4, 0.36, 1.05, 14, 1.0, 1), 0, 0.53, 0);
  for (const hh of [0.18, 0.86]) B.add('metal', cyl(0.415, 0.415, 0.07, 14), 0, hh, 0);
}
function logs(B, x, z, rot, n = 1, len = 2.2, r = 0.22) {
  const y = groundH(x, z);
  B.at(x, y, z, rot);
  for (let i = 0; i < n; i++) B.add('bark', cyl(r, r, len, 9, 1.2, r), 0, r, 0, 0, 0, Math.PI / 2);
}

// символ на знамёнах — свой: ромб-капля, указывающая вниз, и три полосы спуска
function bannerTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
  const c = cv.getContext('2d');
  const gr = c.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#2b3566'); gr.addColorStop(1, '#1b2147');
  c.fillStyle = gr; c.fillRect(0, 0, 128, 256);
  c.fillStyle = '#c8a24a'; c.fillRect(0, 0, 128, 10); c.fillRect(0, 232, 128, 6);
  c.strokeStyle = '#e8d9b0'; c.lineWidth = 7; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(64, 50); c.lineTo(98, 112); c.lineTo(64, 190); c.lineTo(30, 112); c.closePath(); c.stroke();
  c.lineWidth = 5;
  for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(48 + i * 2, 100 + i * 22); c.lineTo(80 - i * 2, 100 + i * 22); c.stroke(); }
  // хвост знамени — вырез «ласточкин хвост»
  c.globalCompositeOperation = 'destination-out';
  c.beginPath(); c.moveTo(0, 256); c.lineTo(64, 222); c.lineTo(128, 256); c.closePath(); c.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildVillage(scene, gfx, T) {
  const mats = {
    planks: new THREE.MeshLambertMaterial({ map: T.planks, color: '#dca46c', emissive: '#3a2010' }),
    crate: new THREE.MeshLambertMaterial({ map: T.planks, color: '#d29a60', emissive: '#301a0c' }),
    door: new THREE.MeshLambertMaterial({ map: T.planks, color: '#8e5a36', emissive: '#1e0f06' }),
    timber: new THREE.MeshLambertMaterial({ map: T.planks, color: '#8a5a38', emissive: '#22120a' }),
    bark: new THREE.MeshLambertMaterial({ map: T.planks, color: '#946a46', emissive: '#22120a' }),
    roof: new THREE.MeshLambertMaterial({ map: T.roof, color: '#a07258', emissive: '#24140c' }),
    stone: new THREE.MeshLambertMaterial({ map: T.rock, color: '#b9b1a6' }),
    metal: new THREE.MeshLambertMaterial({ color: '#3b3634' }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb04a').multiplyScalar(1.6) }),
    cloth: new THREE.MeshLambertMaterial({ color: '#cdb48a' }),
  };
  const B = new Builder();
  const lights = [];
  for (const H of HOUSES) house(B, H);
  for (const [x, z] of LANTERNS) lights.push(lantern(B, x, z, groundH(x, z)));

  // навес с верстаком
  {
    const { x, z, rot } = CANOPY, y = groundH(x, z);
    B.at(x, y, z, rot);
    for (const [a, b, hh] of [[-2.3, -1.7, 2.9], [2.3, -1.7, 2.9], [-2.3, 1.7, 2.4], [2.3, 1.7, 2.4]]) B.add('timber', box(0.24, hh, 0.24), a, hh / 2, b);
    B.add('timber', box(5, 0.2, 0.26), 0, 2.85, -1.7); B.add('timber', box(5, 0.2, 0.26), 0, 2.35, 1.7);
    B.add('roof', box(5.7, 0.14, 4.4, 1.4), 0, 2.75, 0, Math.atan2(0.5, 3.4));
    // верстак
    B.add('planks', box(2.4, 0.14, 1.1), 0, 0.95, -0.6);
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) B.add('timber', box(0.12, 0.9, 0.12), a * 1.05, 0.45, -0.6 + b * 0.42);
    B.add('timber', box(2.2, 0.08, 0.9), 0, 0.3, -0.6);
    // на верстаке: молот, пила (полоска), моток верёвки, доска
    B.add('timber', cyl(0.03, 0.03, 0.55, 6), -0.6, 1.05, -0.45, 0, 0, Math.PI / 2);
    B.add('metal', box(0.12, 0.12, 0.24), -0.87, 1.07, -0.45);
    B.add('metal', box(0.6, 0.02, 0.16), 0.35, 1.03, -0.75, 0, 0.3);
    B.add('cloth', new THREE.TorusGeometry(0.2, 0.06, 6, 16), 0.75, 1.07, -0.35, Math.PI / 2);
    B.add('crate', box(1.4, 0.06, 0.3), -0.1, 1.05, -0.95, 0, 0.1);
    // инструменты у стойки: топор, кирка, лопата
    const lean = 0.25;
    B.add('timber', cyl(0.035, 0.035, 1.2, 6), 2.55, 0.6, -1.4, lean, 0, 0);
    B.add('metal', box(0.06, 0.2, 0.3), 2.55, 1.15, -1.25, lean);
    B.add('timber', cyl(0.035, 0.035, 1.25, 6), 2.55, 0.62, -0.9, lean, 0, 0);
    B.add('metal', box(0.06, 0.08, 0.7), 2.55, 1.2, -0.76, lean);
    B.add('timber', cyl(0.03, 0.03, 1.3, 6), 2.55, 0.65, -0.4, lean, 0, 0);
    B.add('metal', box(0.24, 0.32, 0.03), 2.55, 0.08, -0.55, lean);
  }
  // ящики, бочки, мешки, поленница
  crate(B, 15.8, 33.2, 0.9, 0.3); crate(B, 16.6, 34.4, 0.75, 0.9); crate(B, 15.9, 33.3, 0.6, 0.1, groundH(15.8, 33.2) + 0.9);
  crate(B, -10.8, 55.2, 0.85, 0.2); crate(B, -10.4, 56.3, 0.7, 0.7);
  crate(B, 12.6, 53.2, 0.8, -0.3); barrel(B, 13.4, 52.1); barrel(B, 12.2, 51.6);
  barrel(B, -10.6, 47.6); barrel(B, -11.2, 46.7);
  crate(B, -17.2, 30.2, 0.8, 0.5); crate(B, -1.8, 9.5, 0.7, 0.4);
  // поленница у главного дома
  {
    const x = -15.5, z = 46.6, y = groundH(x, z);
    B.at(x, y, z, 0);
    for (let row = 0; row < 3; row++) for (let i = 0; i < 6 - row; i++) B.add('bark', cyl(0.19, 0.19, 1.3, 8, 1.2, 0.19), -1.2 + i * 0.4 + row * 0.2, 0.2 + row * 0.34, 0, Math.PI / 2, 0, 0);
    B.add('timber', box(0.12, 1.3, 0.12), -1.55, 0.65, 0); B.add('timber', box(0.12, 1.3, 0.12), 1.15, 0.65, 0);
  }
  // мешки
  {
    B.at(14.6, groundH(14.6, 37.5), 37.5, 0);
    for (const [x, z, s] of [[0, 0, 1], [0.55, 0.2, 0.85], [0.25, -0.5, 0.9]]) { const g = new THREE.IcosahedronGeometry(0.4 * s, 2); g.scale(1, 0.75, 0.85); B.add('cloth', g, x, 0.28 * s, z); }
  }
  // скамейки-брёвна у костра и на смотровой
  for (const [a, r] of [[0.3, 2.6], [2.2, 2.8], [4.1, 2.7]]) logs(B, FIRE.x + Math.sin(a) * r, FIRE.z + Math.cos(a) * r, a + Math.PI / 2, 1, 1.9, 0.24);
  logs(B, -2.4, 9.2, 0.25, 1, 2.0, 0.24);

  // ограда вдоль края: столбики и две жерди; у смотровой — разрыв справа (там позже начнётся спуск)
  {
    const posts = [];
    for (let th = -0.46; th <= 0.46; th += 0.0105) {
      if (Math.abs(th) < 0.085) { posts.push(null); continue; }      // мыс смотровой — открыт, там бордюр из камней
      const p = rimPoint(th, 2.1);
      posts.push(V(p.x, groundH(p.x, p.z), p.z));
    }
    B.at(0, 0, 0, 0);
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i]; if (!p) continue;
      B.add('timber', box(0.17, 1.2, 0.17), p.x, p.y + 0.5, p.z, 0, i * 0.37);
      const q = posts[i + 1]; if (!q) continue;
      const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz), ry = Math.atan2(-dz, dx);
      const dy = q.y - p.y, rz = Math.atan2(dy, len);
      for (const hh of [0.55, 0.98]) B.add('timber', box(len + 0.1, 0.09, 0.08), (p.x + q.x) / 2, (p.y + q.y) / 2 + hh, (p.z + q.z) / 2, 0, ry, rz);
    }
  }
  const meshes = B.finish(scene, mats);

  // знамёна на крыльце главного дома
  {
    const H = HOUSES[0], tex = bannerTexture(), y = groundH(H.x, H.z);
    const m = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.85, 1.7, 1, 4);
      const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getY(i) * 2.2) * 0.05);
      const b = new THREE.Mesh(g, m);
      const lx = sx * (H.w / 2 - 0.65), lz = H.d / 2 + 2.12;
      b.position.set(H.x + Math.cos(H.rot) * lx + Math.sin(H.rot) * lz, y + 0.45 + 1.62, H.z - Math.sin(H.rot) * lx + Math.cos(H.rot) * lz);
      b.rotation.y = H.rot;
      b.castShadow = true;
      scene.add(b);
    }
  }

  // каменная дорожка и площадка на смотровой — плоские камни
  {
    const stones = [];
    const flat = boulderGeometry(3, 0.22, false, 1);
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < PATH.length - 1; i++) {
      const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1], L = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s < L; s += 0.95) {
        const t = s / L, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        for (const off of [-0.65, 0.65]) {
          const px = x + off * (bz - az) / L + (rnd() - 0.5) * 0.3, pz = z - off * (bx - ax) / L + (rnd() - 0.5) * 0.3;
          stones.push({ x: px, y: groundH(px, pz) - 0.02, z: pz, s: 0.34 + rnd() * 0.1, r: rnd() * 6, sy: 0.7 });
        }
      }
    }
    for (let i = 0; i < 120; i++) {
      const a = i * 2.39996, r = Math.sqrt(i / 120) * 4.3;
      const x = OVERLOOK.x + Math.sin(a) * r, z = OVERLOOK.z + Math.cos(a) * r;
      stones.push({ x, y: groundH(x, z) - 0.02, z, s: 0.3 + rnd() * 0.08, r: rnd() * 6, sy: 0.7 });
    }
    instanced(scene, flat, new THREE.MeshLambertMaterial({ vertexColors: true, color: '#fff4e4' }), stones, { shadow: false, tint: 0.1 });
    // бордюр из камней по краю мыса (справа — разрыв: там позже начнётся первый спуск)
    const curb = [];
    for (let th = -0.09; th <= 0.09; th += 0.0062) {
      if (th > 0.03 && th < 0.058) continue;
      const p = rimPoint(th, 1.5 + rnd() * 0.4);
      curb.push({ x: p.x, y: groundH(p.x, p.z) - 0.12, z: p.z, s: 0.28 + rnd() * 0.2, r: rnd() * 6 });
    }
    instanced(scene, boulderGeometry(7, 0.9, true, 2), new THREE.MeshLambertMaterial({ vertexColors: true }), curb, { tint: 0.12 });
  }
  return { meshes, lights, mats };
}
