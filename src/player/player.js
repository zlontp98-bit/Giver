// Герой в Бездне: состояние и движение по земле и в воздухе, падения, подборы. Лазание, крюк и
// внешний вид — в climb.js, hook.js и anim.js (их методы подмешиваются сюда же).
import * as THREE from 'three';
import { G, WALK, RUN, JUMP, SAFE_FALL, DEADLY_FALL, COST, PR, PH, WALKABLE } from './tuning.js';
import { ClimbMethods } from './climb.js';
import { HookMethods } from './hook.js';
import { AnimMethods } from './anim.js';
import { CameraHintMethods } from './camerahints.js';

export { HOOK_RANGE, COST } from './tuning.js';

const BODY = [0.55, 1.05, 1.5];             // шары тела (высота центра над ступнями)

export class Player {
  // physics — world/physics.js, props — world/props.js (лагеря, ягоды), events — сообщения игре
  constructor(scene, physics, props, events) {
    this.P = physics; this.props = props; this.ev = events;
    this.anchors = [];                       // кольца для крюка (появятся на этапе 2)
    this.hints = [];
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
    const g = this.P.ground(p.x, p.y, p.z, 3, 8);
    if (g) this.pos.y = g.y;
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
    if (this.state === 'air' && this.peakY - this.pos.y > DEADLY_FALL && !this.P.waterAt(this.pos.x, this.pos.z)) this.hurt(1000, 'abyss');
    if (this.pos.y < -260) this.hurt(1000, 'abyss');
    this.canGrab = this.grabSpot() !== null;
    this.checkPickups(dt);
  }

  // ——— опора и столкновения ———
  // опора под ногами (не выше p.y + step, не ниже p.y − drop): { y, ny, box } или null
  supportAt(p, step = 0.4, drop = 3) { return this.P.ground(p.x, p.y, p.z, step, drop); }

  collide() {
    const p = this.pos;
    for (const h of BODY) {
      _c.set(p.x, p.y + h, p.z);
      if (this.P.pushSphere(_c, PR, this.vel)) { p.x = _c.x; p.y = _c.y - h; p.z = _c.z; }
    }
    return this.P.pushProps(p, PR, PH, this.vel);
  }

  // ——— земля: разгон и торможение с небольшой инерцией ———
  updateGround(dt, input, move, amount) {
    const p = this.pos;
    const running = input.run && amount > 0.5 && this.stamina > 1 && !this.inWater;
    const speed = (running ? RUN : WALK) * (this.inWater ? 0.5 : 1);
    if (running) this.spend(COST.run * dt);
    const k = Math.min(1, (amount > 0.05 ? 9 : 13) * dt);
    this.vel.x += (move.x * speed * amount - this.vel.x) * k;
    this.vel.z += (move.z * speed * amount - this.vel.z) * k;
    this.vel.y = 0;
    if (amount > 0.05) this.turnTo(Math.atan2(move.x, move.z), dt, 12);
    p.x += this.vel.x * dt; p.z += this.vel.z * dt;
    this.collide();
    const g = this.P.ground(p.x, p.y, p.z, 0.55, 0.7);
    if (!g || (g.ny < WALKABLE && !g.box && !g.water)) { this.state = 'air'; this.onBox = null; this.inWater = false; }
    else { p.y = g.y; this.onBox = g.box; this.inWater = !!g.water; }
    if (this.rope) this.ropePayOut();
    // упёрлись в невысокий уступ (0.5–1.4 м) — перелезаем сами
    if (this.state === 'ground' && amount > 0.5 && Math.hypot(this.vel.x, this.vel.z) < speed * 0.45) this.tryVault(0.5, 1.4, 0.32);
    if (input.grab) this.tryGrab();
    else if (input.hook) this.fireHook();
    else if (input.jump && this.state === 'ground') this.jump();
  }

  // перелезть на уступ впереди: верх опоры на lo…hi м выше ног, над ним есть место; dur — сколько лезем
  tryVault(lo, hi, dur) {
    const p = this.pos, fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    for (const d of [0.55, 0.85]) {
      const x = p.x + fx * d, z = p.z + fz * d;
      const top = this.P.ground(x, p.y + hi, z, 0, hi - lo);
      if (!top || top.y < p.y + lo || (top.ny < WALKABLE && !top.box)) continue;
      // впереди на уровне пояса — стена (во что упёрлись), над верхом — свободно для тела
      if (this.P.f(p.x + fx * 0.45, p.y + Math.min(0.6, top.y - p.y - 0.2), p.z + fz * 0.45) > 0.6 && !top.box) continue;
      if (this.P.f(x, top.y + 1.0, z) < 0.42 || this.P.f(x, top.y + 1.6, z) < 0.35) continue;
      this.startMantle(_c.set(x + fx * 0.2, top.y, z + fz * 0.2), dur + 0.12 * (top.y - p.y), 'ground', 0.25);
      this.onBox = top.box;
      return true;
    }
    return false;
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
    // с верёвкой: натянулась — повисли
    if (this.rope && this.ropeCatch()) { this.collide(); return; }
    // приземление: опора, которую пересекли за этот шаг (до того, как стены вытолкнут)
    if (this.vel.y <= 0) {
      const g = this.P.ground(p.x, p.y, p.z, Math.max(0.05, this.prevY - p.y + 0.05), 0.05);
      if (g && (g.ny >= WALKABLE || g.box || g.water)) { this.land(g); return; }
    }
    this.collide();
    this.peakY = Math.max(this.peakY, p.y);
    // в прыжке дотянулись до края уступа (верх на 0.6–2.1 м выше ног) и тянемся к нему — хватаемся и влезаем
    if (amount > 0.3 && this.vel.y < 3 && this.tryVault(0.6, 2.1, 0.5)) { this.spend(COST.grab * 0.4); return; }
    if (input.grab) { this.tryGrab(); if (this.state !== 'air') return; }
    if (input.hook) this.fireHook();
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
    this.inWater = !!sup.water;
    if (sup.water) { if (fall > 3 && this.ev.splash) this.ev.splash(fall); return; }     // вода гасит любое падение
    if (sup.box && sup.box.soft) {
      // мягкое (гриб, сено) пружинит и гасит удар
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
      const s = this.supportAt(this.pos, 0.6, 0.8);
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

  checkPickups(dt) {
    const p = this.pos;
    const bushes = this.props.bushes || [];
    for (const b of bushes) {
      if (b.taken) continue;
      if (Math.abs(b.x - p.x) < 1.6 && Math.abs(b.z - p.z) < 1.6 && Math.abs(b.y - p.y) < 2) {
        b.taken = true;
        this.props.takeBerries(b);
        this.stamina = 100; this.health = Math.min(100, this.health + 25);
        this.ev.berries();
      }
    }
    for (const c of this.props.camps) {
      if (Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < 5 && Math.abs(c.pos.y - p.y) < 3) {
        if (!c.reached) { c.reached = true; this.ev.camp(c); }
        if (this.state === 'ground') this.health = Math.min(100, this.health + 20 * dt);
      }
    }
    // рядом что-то, с чем можно что-то сделать (записка, сундук, ресурс…) — кнопка «Действие» (решает main.js)
    const it = this.ents && this.state !== 'air' && this.state !== 'rope' && this.state !== 'zip' ? this.ents.nearest(p, 2.3, 2.2, this.interactTest) : null;
    this.interact = it ? { kind: it.kind, item: it, label: this.labelOf ? this.labelOf(it) : '' } : null;
    for (const h of this.hints) {
      if (!h.shown && Math.hypot(h.pos.x - p.x, h.pos.z - p.z) < h.r && Math.abs(h.pos.y - p.y) < 4) { h.shown = true; this.ev.hint(h.text); }
    }
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

const _a = new THREE.Vector3(), _m = new THREE.Vector3(), _c = new THREE.Vector3();
