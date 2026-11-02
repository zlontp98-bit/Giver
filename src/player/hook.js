// Крюк: зацепиться за любую скалу (луч по «формуле мира») или за особую точку — кольцо; верёвка как маятник
// (вниз — травить, вверх — подтягиваться, вбок — раскачка, «Прыжок» — соскочить с разгоном); поездка по тросу.
// Зацепился стоя или вися на стене — это страховка: верёвка выдаётся, пока идёшь или лезешь, и поймает,
// если сорвёшься. Методы подмешиваются в Player (см. player.js) — this здесь всегда герой.
import * as THREE from 'three';
import { G, HANG, ROPE_MIN, ROPE_MAX, ROPE_DOWN, ROPE_UP, HOOK_RANGE, RING_RANGE, ZIP_RANGE, AIM_UP, COST } from './tuning.js';

export class HookMethods {
  // куда смотрит прицел: центр камеры, чуть приподнятый (иначе вверх не прицелиться — камера сзади и сверху)
  aimDir(camDir, out) {
    const h = Math.hypot(camDir.x, camDir.z) || 1e-6;
    const pitch = Math.min(1.35, Math.max(-1.2, Math.asin(Math.max(-1, Math.min(1, camDir.y))) + AIM_UP));
    return out.set((camDir.x / h) * Math.cos(pitch), Math.sin(pitch), (camDir.z / h) * Math.cos(pitch));
  }

  // цель крюка: кольцо рядом с прицелом (их видно издалека) или скала, в которую упирается прицел
  pickTarget(camDir) {
    if (!this.freeTarget) { this.freeTarget = { kind: 'rock', free: true, pos: new THREE.Vector3(), n: new THREE.Vector3() }; this.aimPoint = new THREE.Vector3(); }
    if (this.state === 'mantle' || this.state === 'zip' || this.rope || this.hook || this.dead) { this.target = null; this.aimOn = false; return null; }
    this.aimOn = true;
    const chest = _c.copy(this.pos).setY(this.pos.y + 1.4);
    const aim = this.aimDir(camDir, _a);
    let best = null, bestScore = 1e9;
    for (const a of this.anchors) {
      const d = _d.subVectors(a.pos, chest), dist = d.length();
      if (dist > (a.kind === 'zip' ? ZIP_RANGE : RING_RANGE) || dist < 0.5) continue;
      const cos = d.dot(aim) / dist;
      if (cos < (a.kind === 'zip' ? 0.5 : 0.94)) continue;            // кольцо — если прицел рядом (~20°)
      const score = (1 - cos) * 40 + dist * 0.03;
      if (score < bestScore && this.P.clearLine(chest, a.pos)) { bestScore = score; best = a; }
    }
    if (best) { this.target = best; return best; }
    const hit = this.P.raycast(_q.copy(chest).addScaledVector(aim, 0.35), aim, HOOK_RANGE, 0.55);   // «толстый» луч — легче попасть
    if (hit && hit.point.y > this.pos.y - 2.5) {
      const T = this.freeTarget;
      T.pos.copy(hit.point).addScaledVector(hit.normal, 0.06);
      T.n.copy(hit.normal);
      this.target = T;
      return T;
    }
    this.aimPoint.copy(chest).addScaledVector(aim, HOOK_RANGE);
    this.target = null;
    return null;
  }

  fireHook() {
    if (this.rope || this.zip) { this.letGoRope(false); return; }     // второе нажатие — отцепиться
    if (this.hook || this.state === 'mantle' || this.dead) return;
    const t = this.target;
    if (!t) { this.ev.message(`Наведи прицел на скалу — крюк долетает на ${HOOK_RANGE} м`); return; }
    const anchor = t.free ? { kind: 'rock', pos: t.pos.clone(), n: t.n.clone() } : t;
    const dist = _c.copy(this.pos).setY(this.pos.y + 1.5).distanceTo(anchor.pos);
    this.hook = { anchor, t: 0, dur: Math.max(0.12, dist / 45) };
  }

  attach() {
    const a = this.hook.anchor;
    this.hook = null;
    if (a.kind === 'zip') {
      if (this.state === 'climb') this.climb = null;
      const z = a.zip;
      const s = Math.min(0.9, Math.max(0, _d.subVectors(a.pos, z.a).dot(z.dir) / z.len));
      this.zip = { z, s, v: 2 };
      const h = _d.copy(z.a).addScaledVector(z.dir, s * z.len);
      this.onBox = null;
      this.startMantle(h.setY(h.y - HANG), 0.3, 'zip', 0);
      return;
    }
    const hands = _c.copy(this.pos).setY(this.pos.y + HANG);
    const dist = hands.distanceTo(a.pos);
    if (dist > ROPE_MAX) { this.ev.message('Слишком далеко — верёвки не хватит'); return; }
    this.rope = { anchor: a, len: Math.max(ROPE_MIN, dist) };
    if (this.state === 'air') this.state = 'rope';                  // в полёте — сразу повис
    if (this.ev.hooked) this.ev.hooked(this.state, a);
  }

  letGoRope(boost) {
    this.rope = null; this.zip = null;
    if (this.state === 'rope' || this.state === 'zip') {
      this.state = 'air';
      if (boost) { this.vel.y = Math.max(this.vel.y, 0) + 4.5; this.spend(COST.jump); }
      this.flingSpeed = Math.hypot(this.vel.x, this.vel.z);
      this.peakY = this.pos.y;
    }
  }

  // страховка: стоим или лезем с верёвкой — она выдаётся сама (длина = расстояние до крюка)
  ropePayOut() {
    const Rp = this.rope;
    if (!Rp) return;
    const d = _c.copy(this.pos).setY(this.pos.y + HANG).distanceTo(Rp.anchor.pos);
    if (d > ROPE_MAX + 1) { this.rope = null; this.ev.message('Верёвка кончилась — крюк отцепился'); return; }
    Rp.len = Math.min(ROPE_MAX, Math.max(ROPE_MIN, d));
  }

  // в падении с верёвкой: натянулась — повис (маятник)
  ropeCatch() {
    const Rp = this.rope;
    if (!Rp) return false;
    const q = _q.copy(this.pos).setY(this.pos.y + HANG);
    const d = _d.subVectors(q, Rp.anchor.pos), dist = d.length();
    if (dist <= Rp.len) return false;
    this.state = 'rope';
    this.constrainRope();
    // рывок верёвки гасит падение: высоту отсчитываем заново
    this.peakY = this.pos.y;
    return true;
  }

  // держать героя на сфере радиуса len вокруг крюка, убрать скорость «от крюка»
  constrainRope() {
    const p = this.pos, Rp = this.rope, A = Rp.anchor.pos;
    const q = _q.copy(p).setY(p.y + HANG);
    const d = _d.subVectors(q, A), dist = d.length();
    if (dist <= Rp.len || dist < 1e-6) return;
    d.multiplyScalar(1 / dist);
    q.copy(A).addScaledVector(d, Rp.len);
    p.set(q.x, q.y - HANG, q.z);
    const vr = this.vel.dot(d);
    if (vr > 0) this.vel.addScaledVector(d, -vr);
  }

  updateRope(dt, input) {
    const p = this.pos, Rp = this.rope, A = Rp.anchor.pos;
    // джойстик вниз — травить верёвку (спускаться), вверх — подтягиваться (тратит силы)
    if (input.my < -0.2) Rp.len = Math.min(ROPE_MAX, Rp.len + ROPE_DOWN * Math.min(1, -input.my * 1.3) * dt);
    else if (input.my > 0.2 && this.stamina > 0) { Rp.len = Math.max(ROPE_MIN, Rp.len - ROPE_UP * input.my * dt); this.spend(COST.ropeUp * dt); }
    this.vel.y -= G * dt;
    // раскачка: джойстик вбок толкает вдоль стороны камеры (сильнее, когда верёвка длинная)
    this.vel.addScaledVector(this.right, input.mx * (6 + Math.min(6, Rp.len * 0.15)) * dt);
    this.vel.multiplyScalar(1 - Math.min(1, 0.3 * dt));
    p.addScaledVector(this.vel, dt);
    this.constrainRope();
    this.collide();
    // встали на опору: долго спускались — отцепились; крюк рядом — остаёмся со страховкой
    const sup = this.supportAt(_q.set(p.x, Math.max(this.prevY, p.y), p.z), 0.05);
    if (sup && sup.y >= p.y - 0.02 && this.vel.y <= 0.5) {
      p.y = sup.y;
      this.state = 'ground';
      this.onBox = sup.box;
      this.vel.set(0, 0, 0);
      this.peakY = p.y;
      this.squash = 0.4;
      if (A.y - p.y > 3.5) { this.rope = null; if (this.ev.rappelled) this.ev.rappelled(); }
      return;
    }
    this.spend(COST.rope * dt);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.6) this.turnTo(Math.atan2(this.vel.x, this.vel.z), dt, 4);
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
    h.y -= z.sag * 4 * Z.s * (1 - Z.s);                              // трос провисает посередине
    this.pos.set(h.x, h.y - HANG, h.z);
    this.vel.copy(z.dir).multiplyScalar(Z.v);
    this.facing = Math.atan2(z.dir.x, z.dir.z);
    this.spend(COST.rope * dt);
    if (Z.s >= 0.995) { this.zip = null; this.state = 'air'; this.vel.multiplyScalar(0.3); this.vel.y = 0; this.peakY = this.pos.y; return; }
    if (input.hook || input.grab) this.letGoRope(false);
    else if (input.jump) this.letGoRope(true);
  }
}

const _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Vector3(), _a = new THREE.Vector3();
