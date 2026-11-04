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

  // вид постройки: модель + столкновение; создаётся и для построек из сохранения
  view() {
    const self = this;
    return {
      sync(e) {
        if (this.mesh) return;
        const T = STRUCTURES[e.type], [sx, sy, sz] = T.size;
        const g = new THREE.BoxGeometry(sx, sy, sz);
        g.translate(0, sy / 2, 0);
        this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: T.color }));
        this.mesh.position.copy(e.pos);
        this.mesh.rotation.y = e.rot;
        this.mesh.castShadow = this.mesh.receiveShadow = true;
        self.scene.add(this.mesh);
        this.col = { box: true, c: new THREE.Vector3(e.pos.x, e.pos.y + sy / 2, e.pos.z), hx: sx / 2, hy: sy / 2, hz: sz / 2, rot: e.rot, cos: Math.cos(e.rot), sin: Math.sin(e.rot) };
        self.P.addCollider(this.col);
      },
      dispose() {
        if (this.mesh) { self.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
        if (this.col) self.P.removeCollider(this.col);
      },
    };
  }
}
