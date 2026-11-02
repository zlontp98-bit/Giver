// Крюк: выбор кольца по направлению камеры, полёт крюка, спуск по верёвке, поездка по тросу.
// Методы подмешиваются в Player (см. player.js) — this здесь всегда герой.
import * as THREE from 'three';
import { G, HANG, ROPE_MIN, ROPE_MAX, ROPE_DOWN, ROPE_UP, HOOK_RANGE, ZIP_RANGE, COST } from './tuning.js';

export class HookMethods {
  // ——— крюк: кольцо для спуска или трос ———
  pickTarget(camDir) {
    if (this.state === 'climb' || this.state === 'mantle' || this.rope || this.zip || this.hook || this.dead) { this.target = null; return null; }
    const chest = _c.copy(this.pos).setY(this.pos.y + 1.3);
    let best = null, bestScore = 1e9;
    for (const a of this.D.anchors) {
      const d = _d.subVectors(a.pos, chest), dist = d.length();
      if (dist > (a.kind === 'zip' ? ZIP_RANGE : HOOK_RANGE) || dist < 0.3 || d.y > 3) continue;
      const score = (1 - d.dot(camDir) / dist) * 10 + dist * 0.4;
      if (score < bestScore && this.A.clearLine(chest, a.pos)) { bestScore = score; best = a; }
    }
    this.target = best;
    return best;
  }

  fireHook() {
    if (this.rope || this.zip) { this.letGoRope(false); return; }
    if (this.hook || this.state === 'mantle' || this.state === 'climb') return;
    if (!this.target) { this.ev.message('Рядом нет кольца — подойди к светящемуся кольцу'); return; }
    const dist = _c.copy(this.pos).setY(this.pos.y + 1.5).distanceTo(this.target.pos);
    this.hook = { anchor: this.target, t: 0, dur: Math.max(0.1, dist / 60) };
  }

  attach() {
    const a = this.hook.anchor;
    this.hook = null;
    this.onBox = null;
    if (a.kind === 'zip') {
      const z = a.zip;
      const s = Math.min(0.9, Math.max(0, _d.subVectors(a.pos, z.a).dot(z.dir) / z.len));
      this.zip = { z, s, v: 2 };
      const h = _d.copy(z.a).addScaledVector(z.dir, s * z.len);
      this.startMantle(h.setY(h.y - HANG), 0.3, 'zip', 0);
      return;
    }
    const hands = _c.copy(this.pos).setY(this.pos.y + HANG);
    this.rope = { anchor: a, len: Math.min(ROPE_MAX, Math.max(ROPE_MIN, hands.distanceTo(a.pos))) };
    if (this.state === 'ground') {
      // шагнуть с края и повиснуть прямо под кольцом
      this.rope.len = 1.1;
      this.startMantle(_d.copy(a.pos).setY(a.pos.y - HANG - 1.1), 0.5, 'rope', 0.3);
    } else this.state = 'rope';
  }

  letGoRope(boost) {
    this.rope = null; this.zip = null;
    this.state = 'air';
    if (boost) { this.vel.y = Math.max(this.vel.y, 0) + 4.5; this.spend(COST.jump); }
    this.flingSpeed = Math.hypot(this.vel.x, this.vel.z);
  }

  updateRope(dt, input) {
    const p = this.pos, Rp = this.rope, A = Rp.anchor.pos;
    // джойстик вниз — травить верёвку (спускаться), вверх — подтягиваться (тратит силы)
    if (input.my < -0.2) Rp.len = Math.min(ROPE_MAX, Rp.len + ROPE_DOWN * Math.min(1, -input.my * 1.3) * dt);
    else if (input.my > 0.2 && this.stamina > 0) { Rp.len = Math.max(ROPE_MIN, Rp.len - ROPE_UP * input.my * dt); this.spend(COST.ropeUp * dt); }
    this.vel.y -= G * dt;
    this.vel.addScaledVector(this.right, input.mx * 7 * dt);       // раскачка
    this.vel.multiplyScalar(1 - Math.min(1, 0.8 * dt));
    p.addScaledVector(this.vel, dt);
    const q = _q.copy(p).setY(p.y + HANG);
    const d = _d.subVectors(q, A), dist = d.length();
    if (dist > Rp.len) {
      d.multiplyScalar(1 / dist);
      q.copy(A).addScaledVector(d, Rp.len);
      p.set(q.x, q.y - HANG, q.z);
      const vr = this.vel.dot(d);
      if (vr > 0) this.vel.addScaledVector(d, -vr);
    }
    this.collide();
    // встали на что-то внизу — отцепились
    const sup = this.supportAt(_q.set(p.x, Math.max(this.prevY, p.y), p.z), 0.05);
    if (sup && sup.y >= p.y - 0.02) {
      p.y = sup.y;
      if (this.vel.y < 0) this.vel.y = 0;
      if (A.y - p.y > 3.5) {
        this.rope = null;
        this.state = 'ground';
        this.onBox = sup.box;
        this.vel.set(0, 0, 0);
        this.peakY = p.y;
        this.squash = 0.4;
        return;
      }
    }
    this.spend(COST.rope * dt);
    this.facing = Math.atan2(p.x, p.z);
    if (input.grab && this.grabSpot()) this.tryGrab();
    else if (input.hook) this.letGoRope(false);
    else if (input.jump) this.letGoRope(true);
    else if (this.stamina <= 0) { this.letGoRope(false); this.ev.message('Силы кончились — руки разжались!'); }
  }

  // ——— трос через бездну ———
  updateZip(dt, input) {
    const Z = this.zip, z = Z.z;
    Z.v += (G * -z.dir.y * 0.9 - Z.v * 0.06) * dt;
    if ((1 - Z.s) * z.len < 10) Z.v = Math.max(3, Z.v - 14 * dt);     // тормоз перед концом
    Z.v = Math.min(15, Math.max(1.5, Z.v));
    Z.s = Math.min(1, Z.s + (Z.v * dt) / z.len);
    const h = _q.copy(z.a).addScaledVector(z.dir, Z.s * z.len);
    this.pos.set(h.x, h.y - HANG, h.z);
    this.vel.copy(z.dir).multiplyScalar(Z.v);
    this.facing = Math.atan2(z.dir.x, z.dir.z);
    this.spend(COST.rope * dt);
    if (Z.s >= 0.995) { this.zip = null; this.state = 'air'; this.vel.multiplyScalar(0.3); this.vel.y = 0; return; }
    if (input.hook || input.grab) this.letGoRope(false);
    else if (input.jump) this.letGoRope(true);
  }
}

const _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Vector3();
