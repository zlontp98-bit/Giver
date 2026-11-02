// Герой в Бездне: состояние и движение по земле и в воздухе, падения, подборы. Лазание, крюк и
// внешний вид — в climb.js, hook.js и anim.js (их методы подмешиваются сюда же).
import * as THREE from 'three';
import { BOTTOM_Y, PR } from '../world/abyss.js';
import { G, WALK, RUN, JUMP, SAFE_FALL, DEADLY_FALL, COST } from './tuning.js';
import { ClimbMethods } from './climb.js';
import { HookMethods } from './hook.js';
import { AnimMethods } from './anim.js';
import { CameraHintMethods } from './camerahints.js';

export { HOOK_RANGE, COST } from './tuning.js';

export class Player {
  constructor(scene, abyss, descent, world, events) {
    this.A = abyss; this.D = descent; this.W = world; this.ev = events;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.state = 'ground';
    this.facing = Math.PI;
    this.health = 100; this.stamina = 100;
    this.peakY = 0; this.restTimer = 0; this.prevY = 0; this.flingSpeed = 0;
    this.onBox = null; this.mantle = null; this.climb = null; this.rope = null; this.zip = null; this.hook = null;
    this.target = null; this.canGrab = false;
    this.walkPhase = 0; this.squash = 0; this.time = 0; this.climbPhase = 0;
    this.right = new THREE.Vector3(1, 0, 0);
    this.initVisuals(scene);
  }

  spawn(p) {
    this.pos.copy(p);
    const s = this.supportAt(_q.copy(p).setY(p.y + 1.0), 1.5);
    if (s) this.pos.y = s.y;
    this.vel.set(0, 0, 0);
    this.state = 'ground';
    this.health = 100; this.stamina = 100;
    this.hook = null; this.rope = null; this.zip = null; this.climb = null; this.mantle = null; this.onBox = null;
    this.peakY = this.pos.y;
    this.dead = false;
  }

  update(dt, input, camYaw) {
    if (this.dead) return;
    this.time += dt;
    const F = _a.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const R = this.right.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const move = _m.set(0, 0, 0).addScaledVector(F, input.my).addScaledVector(R, input.mx);
    const amount = Math.min(1, move.length());
    if (amount > 0.01) move.divideScalar(move.length());
    this.prevY = this.pos.y;
    const was = this.state;

    if (this.state === 'ground') this.updateGround(dt, input, move, amount);
    else if (this.state === 'air') this.updateAir(dt, input, move, amount);
    else if (this.state === 'climb') this.updateClimb(dt, input);
    else if (this.state === 'rope') this.updateRope(dt, input);
    else if (this.state === 'zip') this.updateZip(dt, input);
    else if (this.state === 'mantle') this.updateMantle(dt);

    if (was !== 'air' && this.state === 'air') this.peakY = this.pos.y;
    if (this.hook) {
      this.hook.t += dt;
      if (this.hook.t >= this.hook.dur) this.attach();
    }
    // силы возвращаются, когда стоишь на земле
    this.restTimer += dt;
    if (this.state === 'ground' && this.restTimer > 0.5) this.stamina = Math.min(100, this.stamina + COST.regen * dt);
    if (this.state === 'air' && this.peakY - this.pos.y > DEADLY_FALL) this.hurt(1000, 'abyss');
    if (this.pos.y < BOTTOM_Y - 10) this.hurt(1000, 'abyss');
    this.canGrab = this.grabSpot() !== null;
    this.checkPickups();
  }

  // ——— опора под ногами: плато, полки, дно, доски, камни, гриб ———
  supportAt(p, step = 0.4) {
    let y = this.A.support(p.x, p.z, p.y, step), box = null;
    const b = this.D.support(p.x, p.z, p.y, step);
    if (b && (y === null || b.top >= y)) { y = b.top; box = b.box; }
    return y === null ? null : { y, box };
  }

  collide() {
    const a = this.A.collide(this.pos, this.vel);
    this.W.pushOut(this.pos, PR);
    const b = this.D.pushOut(this.pos, this.vel);
    return a || b;
  }

  // ——— земля ———
  updateGround(dt, input, move, amount) {
    const p = this.pos;
    const running = input.run && amount > 0.5 && this.stamina > 1;
    const speed = running ? RUN : WALK;
    if (running) this.spend(COST.run * dt);
    const k = Math.min(1, 12 * dt);
    this.vel.x += (move.x * speed * amount - this.vel.x) * k;
    this.vel.z += (move.z * speed * amount - this.vel.z) * k;
    this.vel.y = 0;
    if (amount > 0.05) this.turnTo(Math.atan2(move.x, move.z), dt, 12);
    p.x += this.vel.x * dt; p.z += this.vel.z * dt;
    this.collide();
    const sup = this.supportAt(p, 0.45);
    if (!sup || sup.y < p.y - 0.6) { this.state = 'air'; this.onBox = null; }
    else { p.y = sup.y; this.onBox = sup.box; }
    if (input.grab) this.tryGrab();
    else if (input.hook) this.fireHook();
    else if (input.jump && this.state === 'ground') this.jump();
  }

  jump() {
    if (this.stamina < COST.jump) { this.ev.message('Нет сил прыгнуть — отдохни'); return; }
    this.spend(COST.jump);
    this.vel.y = JUMP;
    this.state = 'air';
    this.onBox = null;
  }

  // ——— в воздухе ———
  updateAir(dt, input, move, amount) {
    const p = this.pos;
    this.vel.y = Math.max(-38, this.vel.y - G * dt);
    if (amount > 0.05) {
      this.vel.x += move.x * amount * 9 * dt;
      this.vel.z += move.z * amount * 9 * dt;
      this.turnTo(Math.atan2(move.x, move.z), dt, 6);
    } else {
      const k = 1 - Math.min(1, 1.2 * dt);            // без джойстика понемногу тормозим
      this.vel.x *= k; this.vel.z *= k;
    }
    const hs = Math.hypot(this.vel.x, this.vel.z), cap = Math.max(RUN, this.flingSpeed);
    if (hs > cap) { this.vel.x *= cap / hs; this.vel.z *= cap / hs; }
    this.flingSpeed = Math.max(0, this.flingSpeed - dt * 4);
    p.addScaledVector(this.vel, dt);
    this.collide();
    this.peakY = Math.max(this.peakY, p.y);
    if (input.grab) { this.tryGrab(); if (this.state !== 'air') return; }
    if (input.hook) this.fireHook();
    if (this.state !== 'air' || this.vel.y > 0) return;
    // приземление: опора, которую пересекли за этот шаг
    const sup = this.supportAt(_q.set(p.x, this.prevY, p.z), 0.05);
    if (sup && sup.y >= p.y) this.land(sup);
  }

  land(sup) {
    const p = this.pos;
    p.y = sup.y;
    const fall = this.peakY - p.y;
    this.vel.y = 0; this.vel.x *= 0.3; this.vel.z *= 0.3;
    this.flingSpeed = 0;
    this.onBox = sup.box;
    this.state = 'ground';
    this.squash = Math.min(1, Math.max(0, fall) / 6);
    if (sup.box && sup.box.soft) {
      // огромный гриб пружинит и гасит удар
      if (fall > 2.5) { this.vel.y = Math.min(8, fall * 0.5); this.state = 'air'; this.peakY = p.y; this.squash = 1; if (this.ev.boing) this.ev.boing(); }
      return;
    }
    if (fall > SAFE_FALL) this.hurt(Math.round((fall - SAFE_FALL) * 6), 'fall');
  }


  // ——— короткие переходы (перелезть, повиснуть) ———
  startMantle(to, dur, then, arc) {
    this.mantle = { from: this.pos.clone(), to: to.clone(), t: 0, dur, then, arc };
    this.state = 'mantle';
    this.vel.set(0, 0, 0);
  }

  updateMantle(dt) {
    const m = this.mantle;
    m.t += dt;
    const u = Math.min(1, m.t / m.dur), e = u * u * (3 - 2 * u);
    this.pos.lerpVectors(m.from, m.to, e);
    this.pos.y += Math.sin(u * Math.PI) * m.arc;
    if (m.then === 'ground') this.facing = Math.atan2(m.to.x - m.from.x, m.to.z - m.from.z);
    if (u < 1) return;
    this.pos.copy(m.to);
    this.mantle = null;
    this.state = m.then;
    if (m.then === 'ground') {
      const s = this.supportAt(_q.copy(this.pos).setY(this.pos.y + 0.3), 0.6);
      if (s) { this.pos.y = s.y; this.onBox = s.box; } else this.state = 'air';
      this.peakY = this.pos.y;
      this.squash = 0.4;
    }
  }

  // движущаяся платформа везёт того, кто на ней стоит
  carry() {
    if (this.state === 'ground' && this.onBox && this.onBox.dp) {
      this.pos.add(this.onBox.dp);
      if (this.onBox.dp.y !== 0) this.pos.y = this.onBox.c.y + this.onBox.hy;
    }
  }

  // ——— прочее ———
  spend(v) { this.stamina = Math.max(0, this.stamina - v); this.restTimer = 0; }

  hurt(dmg, why) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - dmg);
    this.ev.hurt(dmg);
    if (this.health <= 0) {
      this.dead = true;
      this.rope = null; this.hook = null; this.zip = null; this.climb = null;
      this.ev.died(why);
    }
  }

  checkPickups() {
    const p = this.pos, cy = p.y + 0.9;
    for (const s of this.D.shards) {
      if (s.taken) continue;
      if (Math.abs(s.pos.x - p.x) < 1.2 && Math.abs(s.pos.z - p.z) < 1.2 && Math.abs(s.pos.y - cy) < 1.5) {
        s.taken = true; s.mesh.visible = false; this.ev.shard(s);
      }
    }
    for (const b of this.W.bushes) {
      if (b.taken) continue;
      if (Math.abs(b.x - p.x) < 1.5 && Math.abs(b.z - p.z) < 1.5 && Math.abs(b.y - p.y) < 2) {
        b.taken = true; b.berries.visible = false;
        this.stamina = 100; this.health = Math.min(100, this.health + 25);
        this.ev.berries();
      }
    }
    for (const c of this.D.camps) {
      if (Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < 4.5 && Math.abs(c.pos.y - p.y) < 3) {
        if (!c.reached) { c.reached = true; this.ev.camp(c); }
        if (this.state === 'ground') this.health = Math.min(100, this.health + 20 * (1 / 60));
      }
    }
    for (const h of this.D.hints) {
      if (!h.shown && Math.hypot(h.pos.x - p.x, h.pos.z - p.z) < h.r && Math.abs(h.pos.y - p.y) < 3) { h.shown = true; this.ev.hint(h.text); }
    }
    if (this.state === 'ground' && p.y < BOTTOM_Y + 3 && Math.hypot(p.x, p.z) < 9) this.ev.bottom();
  }

  turnTo(target, dt, speed) {
    let d = target - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, speed * dt);
  }

}

// методы из соседних файлов — как будто они написаны прямо в классе
for (const M of [ClimbMethods, HookMethods, AnimMethods, CameraHintMethods]) {
  for (const k of Object.getOwnPropertyNames(M.prototype)) if (k !== 'constructor') Player.prototype[k] = M.prototype[k];
}

const _a = new THREE.Vector3(), _m = new THREE.Vector3(), _q = new THREE.Vector3();
