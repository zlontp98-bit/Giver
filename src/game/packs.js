// Рюкзак на месте гибели: сорвался — всё из рюкзака (не снаряжение) остаётся лежать там, где ты упал.
// Вернулся — «Действие» → забрал (сколько влезет; остальное лежит дальше). Рюкзаков может быть несколько
// (умер ещё раз, не дойдя) — каждый своя сущность, сохраняется целиком; больше MAX — самый старый пропадает.
// Над рюкзаком — тонкий столб света, чтобы его было видно издалека и из глубины.
import * as THREE from 'three';

export const MAX_PACKS = 5;

export class Packs {
  constructor(scene, ents, inv, physics, state) {
    this.scene = scene; this.ents = ents; this.inv = inv; this.P = physics; this.state = state;
    this.safe = null;                     // последняя точка, где герой стоял на опоре (если внизу нет земли)
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    this.mats = { body: lam(0xd9a640), flap: lam(0xa8742a), roll: lam(0x4f8a5b) };
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending });
    this.geo = {
      body: new THREE.BoxGeometry(0.55, 0.62, 0.34).translate(0, 0.31, 0),
      flap: new THREE.BoxGeometry(0.58, 0.18, 0.37).translate(0, 0.58, 0.01),
      roll: new THREE.CylinderGeometry(0.11, 0.11, 0.62, 10).rotateZ(Math.PI / 2).translate(0, 0.74, 0),
      beam: new THREE.CylinderGeometry(0.16, 0.16, 36, 6, 1, true).translate(0, 18.6, 0),
    };
  }

  // сорвался: выложить вещи в рюкзак на земле под местом гибели. Вернёт сущность или null (рюкзак был пуст)
  // minY — ниже рюкзак не кладём (демоверсия: в туман глубины не попасть) — тогда вещи остаются при герое
  drop(pos, minY = -1e9) {
    const items = {};
    for (const [id, n] of Object.entries(this.inv.inv)) if (n > 0) items[id] = n;
    if (!Object.keys(items).length) return null;
    const g = this.P.ground(pos.x, pos.y + 0.5, pos.z, 1.5, 420);
    if ((g ? g.y : pos.y) < minY) return null;
    const p = g ? new THREE.Vector3(pos.x, g.y, pos.z) : (this.safe ? this.safe.clone() : pos.clone());
    for (const k of Object.keys(this.inv.inv)) delete this.inv.inv[k];
    const old = this.list().sort((a, b) => a.n - b.n);
    while (old.length >= MAX_PACKS) this.ents.remove(old.shift());
    const n = (this.state.packSeq = (this.state.packSeq || 0) + 1);
    return this.ents.add({ id: `pack:${n}`, kind: 'pack', pos: p, items, n, dynamic: true }, this.view());
  }

  // забрать: сколько влезет; что не влезло — остаётся в рюкзаке на земле
  take(e) {
    const got = {}, items = { ...e.items };
    for (const [id, n] of Object.entries(items)) {
      const k = this.inv.add(id, n);
      if (k) got[id] = k;
      items[id] = n - k;
      if (!items[id]) delete items[id];
    }
    const left = Object.keys(items).length;
    if (!left) this.ents.remove(e);
    else this.ents.set(e, { items });
    return { got, left };
  }

  list() { return this.ents.byKind('pack'); }

  // ближайший рюкзак (для подсказки на экране)
  nearest(p) {
    let best = null, bd = 1e9;
    for (const e of this.list()) { const d = e.pos.distanceTo(p); if (d < bd) { bd = d; best = e; } }
    return best;
  }

  view() {
    const self = this;
    return {
      sync(e) {
        if (this.group) return;
        const G = (this.group = new THREE.Group()), bag = new THREE.Group();
        for (const k of ['body', 'flap', 'roll']) {
          const m = new THREE.Mesh(self.geo[k], self.mats[k]);
          m.castShadow = true;
          bag.add(m);
        }
        bag.rotation.set(0.25, (e.n * 2.4) % 6.28, 0.12);        // лежит чуть набок, как упал
        G.add(bag);
        const beam = new THREE.Mesh(self.geo.beam, self.beamMat);
        beam.renderOrder = 5;
        G.add(beam);
        G.position.copy(e.pos);
        self.scene.add(G);
      },
      dispose() { if (this.group) self.scene.remove(this.group); this.group = null; },
    };
  }
}
