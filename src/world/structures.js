// Постройки — отдельно от природы (SDF): у каждой своя модель и свои столкновения (коробки в world/physics.js),
// а данные — сущность kind: 'structure' (сохраняется целиком). Сюда же пойдут мосты и лестницы.
// Размещение проверяет опору: платформа — у крутой скалы (крепится к стене) или на земле; укрытие — только
// на ровной земле и не в скале.
import * as THREE from 'three';

export const STRUCTURES = {
  platform: { name: 'Платформа', size: [2.4, 0.2, 2.0], color: '#9a6b3f' },
  shelter: { name: 'Укрытие', size: [2.6, 1.8, 2.4], color: '#7c8a5a' },
};

export class Structures {
  constructor(scene, W, physics, ents) {
    this.scene = scene; this.W = W; this.P = physics; this.ents = ents;
    this.seq = 0;
  }

  // можно ли поставить: { ok, why } — pos — середина низа постройки, rot — поворот вокруг вертикали
  canPlace(type, pos, rot) {
    const T = STRUCTURES[type], W = this.W;
    if (!T) return { ok: false, why: 'нет такой постройки' };
    const [sx, sy, sz] = T.size, c = Math.cos(rot), s = Math.sin(rot);
    // внутри не должно быть скалы
    // (край может немного уходить в стену — так платформа и крепится)
    for (const [a, b] of [[0, 0], [-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) {
      const x = pos.x + (a * sx) * c + (b * sz) * s, z = pos.z - (a * sx) * s + (b * sz) * c;
      if (W.f(x, pos.y + sy * 0.5 + 0.05, z) < -0.15) return { ok: false, why: 'мешает скала' };
    }
    if (W.f(pos.x, pos.y + 1.0, pos.z) < 0.4) return { ok: false, why: 'над платформой нет места' };
    if (type === 'shelter') {
      // ровная опора под всеми углами
      for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
        const x = pos.x + (a * sx) * c + (b * sz) * s, z = pos.z - (a * sx) * s + (b * sz) * c;
        const g = this.P.ground(x, pos.y, z, 0.4, 0.6);
        if (!g || g.ny < 0.8) return { ok: false, why: 'нужна ровная земля' };
      }
      return { ok: true };
    }
    // платформа: держится, если хоть один край упирается в скалу (стена) или под ней земля
    const edges = [[0, -0.55], [0, 0.55], [-0.55, 0], [0.55, 0]];
    for (const [a, b] of edges) {
      const x = pos.x + (a * sx) * c + (b * sz) * s, z = pos.z - (a * sx) * s + (b * sz) * c;
      if (W.f(x, pos.y + 0.1, z) < 0.35) return { ok: true, anchor: 'wall' };
    }
    const g = this.P.ground(pos.x, pos.y, pos.z, 0.2, 0.4);
    if (g) return { ok: true, anchor: 'ground' };
    return { ok: false, why: 'не на что опереться — поставь у скалы' };
  }

  place(type, pos, rot = 0, extra = {}) {
    const chk = this.canPlace(type, pos, rot);
    if (!chk.ok) return { ok: false, why: chk.why };
    const id = `structure:${Date.now().toString(36)}${(this.seq++).toString(36)}`;
    const e = this.ents.add({ id, kind: 'structure', type, pos: pos.clone(), rot, dynamic: true, ...extra }, this.view());
    return { ok: true, e };
  }

  remove(e) { this.ents.remove(e); }
  list(type) { return this.ents.byKind('structure').filter((e) => !type || e.type === type); }
  count(type) { return this.list(type).length; }

  // вид постройки: модель + столкновение; создаётся и для построек из сохранения.
  // Платформа — настил из досок с упорами (коробка-столкновение); укрытие — навес из ткани на жердях
  // (сквозь него можно пройти, столкновения нет — это временный лагерь).
  view() {
    const self = this;
    return {
      sync(e) {
        if (this.group) return;
        const T = STRUCTURES[e.type], [sx, sy, sz] = T.size;
        const G = (this.group = buildModel(e.type, T));
        G.position.copy(e.pos);
        G.rotation.y = e.rot;
        self.scene.add(G);
        if (e.type === 'platform') {
          this.col = { box: true, c: new THREE.Vector3(e.pos.x, e.pos.y + sy / 2, e.pos.z), hx: sx / 2, hy: sy / 2, hz: sz / 2, rot: e.rot, cos: Math.cos(e.rot), sin: Math.sin(e.rot) };
          self.P.addCollider(this.col);
        }
      },
      dispose() {
        if (this.group) self.scene.remove(this.group);
        if (this.col) self.P.removeCollider(this.col);
        this.group = null; this.col = null;
      },
    };
  }

  // полупрозрачный «призрак» для выбора места (зелёный — можно, красный — нельзя)
  ghost(type) {
    const T = STRUCTURES[type], [sx, sy, sz] = T.size;
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz).translate(0, sy / 2, 0), new THREE.MeshBasicMaterial({ color: 0x6ee07a, transparent: true, opacity: 0.35, depthWrite: false }));
    m.renderOrder = 6;
    return m;
  }
}

const MATS = {};
const mat = (c) => (MATS[c] || (MATS[c] = new THREE.MeshLambertMaterial({ color: c })));
function part(G, geo, c, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat(c));
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = true; m.receiveShadow = true;
  G.add(m);
  return m;
}
function buildModel(type, T) {
  const G = new THREE.Group(), [sx, sy, sz] = T.size;
  if (type === 'platform') {
    // доски поперёк (вдоль стены), две балки снизу, два упора в стену (задний край — −z)
    const n = 5, w = sz / n;
    for (let i = 0; i < n; i++) part(G, new THREE.BoxGeometry(sx, sy * 0.8, w * 0.88), i % 2 ? 0x9a6b3f : 0x8c6038, 0, sy * 0.6, -sz / 2 + w * (i + 0.5));
    for (const x of [-sx * 0.36, sx * 0.36]) {
      part(G, new THREE.BoxGeometry(0.12, 0.12, sz), 0x5e4027, x, 0.06, 0);
      part(G, new THREE.BoxGeometry(0.1, 0.1, 1.5), 0x5e4027, x, -0.45, -sz / 2 + 0.55, -0.72);
    }
  } else {
    // навес: две жерди, конёк, два ската ткани, подстилка
    const h = sy, half = sx / 2;
    for (const z of [-sz / 2 + 0.1, sz / 2 - 0.1]) {
      part(G, new THREE.CylinderGeometry(0.05, 0.05, h * 1.15, 6), 0x6b4a2c, -half * 0.55, h / 2, z, 0, 0, -0.55);
      part(G, new THREE.CylinderGeometry(0.05, 0.05, h * 1.15, 6), 0x6b4a2c, half * 0.55, h / 2, z, 0, 0, 0.55);
    }
    part(G, new THREE.CylinderGeometry(0.05, 0.05, sz, 6), 0x6b4a2c, 0, h, 0, Math.PI / 2);
    const slope = Math.hypot(half, h);
    for (const s of [-1, 1]) part(G, new THREE.BoxGeometry(slope, 0.04, sz * 0.96), s < 0 ? 0x7c8a5a : 0x6f7d50, (s * half) / 2, h / 2, 0, 0, 0, s * Math.atan2(h, half));
    part(G, new THREE.BoxGeometry(sx * 0.7, 0.05, sz * 0.8), 0xa0634a, 0, 0.03, 0);
  }
  return G;
}
