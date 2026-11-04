// Установка построек из рюкзака: «поставить» в рюкзаке → перед героем «призрак» (зелёный — можно, красный —
// нельзя и почему), «Действие» — поставить, кнопка рюкзака — отмена. Где ставится:
//   • висишь на стене — платформа прямо под ногами, у стены (отпустил «Хват» — стоишь и отдыхаешь);
//   • стоишь — платформа впереди: на земле или козырьком над краем обрыва (держится за край);
//   • укрытие — впереди, на ровной земле.
// Лимиты: платформ — 4, укрытие — одно. Опору проверяет Structures.canPlace (скала внутри, место сверху, опора).
import * as THREE from 'three';
import { STRUCTURES } from '../world/structures.js';

export const LIMITS = { platform: 4, shelter: 1 };

export class Builder {
  constructor(scene, structures, physics) {
    this.scene = scene; this.S = structures; this.P = physics;
    this.mode = null;                     // { type, ghost, pos, rot, check }
  }

  get active() { return !!this.mode; }

  start(type) {
    this.cancel();
    const ghost = this.S.ghost(type);
    this.scene.add(ghost);
    this.mode = { type, ghost, pos: new THREE.Vector3(), rot: 0, check: { ok: false, why: '' } };
  }

  cancel() {
    if (!this.mode) return;
    this.scene.remove(this.mode.ghost);
    this.mode.ghost.geometry.dispose();
    this.mode = null;
  }

  // где встанет постройка при таком положении героя
  spot(hero, out) {
    const M = this.mode, T = STRUCTURES[M.type], [, , sz] = T.size, p = hero.pos;
    if (M.type === 'platform' && hero.state === 'climb' && hero.climb) {
      const n = hero.climb.n;
      const h = Math.hypot(n.x, n.z) || 1;
      M.rot = Math.atan2(n.x / h, n.z / h);
      // центр — так, чтобы задний край чуть заходил в стену; верх — чуть ниже ног
      return out.set(p.x + (n.x / h) * (sz / 2 - 0.5), p.y - 0.3, p.z + (n.z / h) * (sz / 2 - 0.5));
    }
    const fx = Math.sin(hero.facing), fz = Math.cos(hero.facing);
    M.rot = hero.facing;
    const d = M.type === 'shelter' ? 2.6 : sz / 2 + 0.55;
    out.set(p.x + fx * d, p.y, p.z + fz * d);
    const g = this.P.ground(out.x, p.y + 0.6, out.z, 0.2, 1.4);
    if (g && g.y > p.y - 1.2) out.y = g.y;                    // земля впереди — ставим на неё
    else out.y = p.y - 0.2;                                   // впереди обрыв — козырьком над краем
    return out;
  }

  // каждый кадр: двигать призрак, проверять место; count(type) — сколько уже стоит
  update(hero, count) {
    const M = this.mode;
    if (!M) return;
    this.spot(hero, M.pos);
    if (count(M.type) >= LIMITS[M.type]) M.check = { ok: false, why: M.type === 'shelter' ? 'укрытие уже стоит — разбери старое' : `больше ${LIMITS.platform} платформ нельзя` };
    else if (hero.state !== 'ground' && hero.state !== 'climb') M.check = { ok: false, why: 'сначала встань или повисни на стене' };
    else if (M.type === 'shelter' && hero.state !== 'ground') M.check = { ok: false, why: 'укрытие — только на земле' };
    else M.check = this.S.canPlace(M.type, M.pos, M.rot);
    M.ghost.position.copy(M.pos);
    M.ghost.rotation.y = M.rot;
    M.ghost.material.color.set(M.check.ok ? 0x6ee07a : 0xff6a5a);
  }

  // поставить: вернёт сущность или null
  place() {
    const M = this.mode;
    if (!M || !M.check.ok) return null;
    const r = this.S.place(M.type, M.pos, M.rot, { reach: 1 });
    if (!r.ok) { M.check = { ok: false, why: r.why }; return null; }
    this.cancel();
    return r.e;
  }
}
