// Герой: ходит, бегает, прыгает по доскам и платформам, стреляет крюком в кольца и подтягивается.
// Руками по стенам не лазает — вверх только крюком, прыжками, батутом или на лифте.
import * as THREE from 'three';
import { WALKABLE_NY, HALF } from './terrain.js';
import { PLAYER_R } from './course.js';
import { makeHero } from './hero.js';

const G = 22, WALK = 4.6, RUN = 7.2, JUMP = 7.2;
const SAFE_FALL = 7;
export const HOOK_RANGE = 28;
const HOOK_FLY = 70, REEL = 9, ROPE_MIN = 0.9, HANDS = 1.5;
export const COST = { run: 9, jump: 3, hook: 10, hang: 2.5, regen: 18 };

export class Player {
  constructor(scene, terrain, world, course, events) {
    this.t = terrain; this.world = world; this.course = course; this.ev = events;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.state = 'ground';
    this.facing = Math.PI;
    this.health = 100; this.stamina = 100;
    this.peakY = 0; this.restTimer = 0; this.prevY = 0;
    this.onBox = null; this.assist = null; this.mantle = null; this.flingSpeed = 0;
    this.hook = null;   // крюк летит: {anchor, t, dur}
    this.rope = null;   // висим: {anchor, len}
    this.target = null; // на какое кольцо смотрим
    this.walkPhase = 0; this.squash = 0; this.time = 0;
    this.hero = makeHero();
    // герой не отбрасывает «настоящую» тень (тени обновляются не каждый кадр) — под ним свой кружок
    this.hero.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    scene.add(this.hero.root);
    // верёвка и крюк
    const rg = new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1, true);
    rg.translate(0, 0.5, 0);
    rg.rotateX(Math.PI / 2);
    this.ropeMesh = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: '#7a5532' }));
    this.ropeMesh.visible = false;
    this.hookHead = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 8), new THREE.MeshLambertMaterial({ color: '#3d434c' }));
    this.hookHead.visible = false;
    scene.add(this.ropeMesh, this.hookHead);
    const sg = new THREE.CircleGeometry(0.42, 16);
    sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false }));
    scene.add(this.shadow);
  }

  spawn(p) {
    this.pos.copy(p);
    this.pos.y = Math.max(this.t.heightAt(p.x, p.z), p.y);
    this.pos.y = this.supportAt(this.pos, 0.5).y;
    this.vel.set(0, 0, 0);
    this.state = 'ground';
    this.health = 100; this.stamina = 100;
    this.hook = null; this.rope = null; this.assist = null; this.mantle = null; this.onBox = null;
    this.dead = false;
  }

  get hands() { return _h.copy(this.pos).setY(this.pos.y + HANDS); }

  update(dt, input, camYaw) {
    if (this.dead) return;
    this.time += dt;
    const F = _a.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const R = _b.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const move = _m.set(0, 0, 0).addScaledVector(F, input.my).addScaledVector(R, input.mx);
    const amount = Math.min(1, move.length());
    if (amount > 0.01) move.divideScalar(move.length());
    this.prevY = this.pos.y;
    const was = this.state;

    if (this.state === 'ground') this.updateGround(dt, input, move, amount);
    else if (this.state === 'air') this.updateAir(dt, input, move, amount);
    else if (this.state === 'slide') this.updateSlide(dt, input, move);
    else if (this.state === 'rope') this.updateRope(dt, input, move, amount);
    else if (this.state === 'mantle') this.updateMantle(dt);

    if (was !== this.state && (this.state === 'air' || this.state === 'slide') && (was === 'ground' || was === 'mantle')) this.peakY = this.pos.y;
    if (this.state === 'rope') this.peakY = this.pos.y;

    // крюк летит к кольцу
    if (this.hook) {
      this.hook.t += dt;
      if (this.hook.t >= this.hook.dur) this.attach();
    }
    const r = Math.hypot(this.pos.x, this.pos.z), lim = HALF - 3;
    if (r > lim) { this.pos.x *= lim / r; this.pos.z *= lim / r; }
    // силы возвращаются на земле
    this.restTimer += dt;
    if ((this.state === 'ground' || this.state === 'slide') && this.restTimer > 0.6) this.stamina = Math.min(100, this.stamina + COST.regen * dt);
    if (this.pos.y < -30) this.hurt(1000);
    this.checkPickups();
  }

  // ——— земля ———
  supportAt(p, step = 0.35) {
    const th = this.t.heightAt(p.x, p.z);
    const floor = Math.max(th, -0.9);
    const b = this.course.support(p.x, p.z, p.y, step);
    if (b && (b.top >= floor - 0.01 || floor > p.y + step)) return { y: b.top, box: b.box, steep: false };
    const steep = th > -0.9 && this.t.normalAt(p.x, p.z, _n).y < WALKABLE_NY - 0.06;
    return { y: floor, box: null, steep };
  }

  updateGround(dt, input, move, amount) {
    const t = this.t, p = this.pos;
    const deep = t.heightAt(p.x, p.z) < -0.9 && !this.onBox;
    const running = input.run && amount > 0.5 && this.stamina > 1 && !deep;
    const speed = deep ? 2.2 : running ? RUN : WALK;
    if (running) this.spend(COST.run * dt);
    const k = Math.min(1, 12 * dt);
    this.vel.x += (move.x * speed * amount - this.vel.x) * k;
    this.vel.z += (move.z * speed * amount - this.vel.z) * k;
    this.vel.y = 0;
    if (amount > 0.05) this.turnTo(Math.atan2(move.x, move.z), dt, 12);

    let nx = p.x + this.vel.x * dt, nz = p.z + this.vel.z * dt;
    // упёрлись в крутую стену — скользим вдоль неё
    if (t.heightAt(nx, nz) > p.y + 0.3 && t.normalAt(nx, nz, _n).y < WALKABLE_NY) {
      const up = _u.set(-_n.x, 0, -_n.z).normalize();
      const into = this.vel.x * up.x + this.vel.z * up.z;
      if (into > 0) { this.vel.x -= up.x * into; this.vel.z -= up.z * into; }
      nx = p.x + this.vel.x * dt; nz = p.z + this.vel.z * dt;
      if (t.heightAt(nx, nz) > p.y + 0.3 && t.normalAt(nx, nz, _n).y < WALKABLE_NY) { nx = p.x; nz = p.z; }
    }
    p.x = nx; p.z = nz;
    this.world.pushOut(p, PLAYER_R);
    this.course.pushOut(p, this.vel);
    const sup = this.supportAt(p);
    if (sup.y < p.y - 0.6) {                 // сошли с края
      this.state = 'air'; this.onBox = null;
    } else {
      p.y = sup.y;
      this.onBox = sup.box;
      if (sup.steep) this.state = 'slide';
      if (sup.box && sup.box.kind === 'pad') { this.bounce(sup.box); return; }
    }
    if (input.hook) this.fireHook();
    if (input.jump && this.state === 'ground') this.jump();
  }

  jump() {
    if (this.stamina < COST.jump) { this.ev.message('Нет сил прыгнуть — отдохни'); return; }
    this.spend(COST.jump);
    this.vel.y = JUMP;
    this.state = 'air';
    this.onBox = null;
  }

  bounce(pad) {
    this.vel.set(0, pad.bounce.vy, 0);
    this.assist = { target: pad.bounce.target.clone() };
    this.state = 'air';
    this.onBox = null;
    this.squash = 1;
    this.peakY = -1e9;          // батут не ранит: приземление на верхний уступ мягкое
    if (this.ev.bounce) this.ev.bounce();
  }

  // ——— в воздухе ———
  updateAir(dt, input, move, amount) {
    const t = this.t, p = this.pos;
    this.vel.y -= G * dt;
    if (this.assist) {
      // батут: сначала строго вверх вдоль стены, а когда поднялись выше края — летим к уступу
      // с такой скоростью, чтобы успеть долететь, пока падаем обратно до его высоты
      const a = this.assist.target;
      const dx = a.x - p.x, dz = a.z - p.z, d = Math.hypot(dx, dz) || 1;
      if (!this.assist.go && p.y > a.y + 0.8) this.assist.go = true;
      if (!this.assist.go) { this.vel.x = 0; this.vel.z = 0; }
      else {
        const vy = this.vel.y, h = Math.max(0.05, p.y - a.y);
        const tLeft = (vy + Math.sqrt(vy * vy + 2 * G * h)) / G;
        const sp = Math.min(10, (d / Math.max(0.15, tLeft)) * 1.05);
        this.vel.x = (dx / d) * sp; this.vel.z = (dz / d) * sp;
        this.flingSpeed = sp;
        if (d < 0.4) this.assist = null;
      }
    } else {
      this.vel.x += move.x * amount * 9 * dt;
      this.vel.z += move.z * amount * 9 * dt;
      const hs = Math.hypot(this.vel.x, this.vel.z), cap = Math.max(RUN, this.flingSpeed);
      if (hs > cap) { this.vel.x *= cap / hs; this.vel.z *= cap / hs; }
      this.flingSpeed = Math.max(0, this.flingSpeed - dt * 6);
    }
    if (amount > 0.05) this.turnTo(Math.atan2(move.x, move.z), dt, 6);
    const nx = p.x + this.vel.x * dt, nz = p.z + this.vel.z * dt;
    if (t.heightAt(nx, nz) > p.y + 0.3) { this.vel.x *= -0.1; this.vel.z *= -0.1; }
    else { p.x = nx; p.z = nz; }
    p.y += this.vel.y * dt;
    this.world.pushOut(p, PLAYER_R);
    this.course.pushOut(p, this.vel);
    this.peakY = Math.max(this.peakY, p.y);
    if (input.hook) this.fireHook();
    if (this.state !== 'air') return;

    if (this.vel.y <= 0) {
      // приземление: на доску (пересекли её верх за этот шаг) или на землю
      const b = this.course.support(p.x, p.z, this.prevY, 0.05);
      const th = Math.max(t.heightAt(p.x, p.z), -0.9);
      let landY = null, box = null;
      if (b && b.top >= p.y) { landY = b.top; box = b.box; }
      if (th >= p.y && (landY === null || th > landY)) { landY = th; box = null; }
      if (landY !== null) {
        p.y = landY;
        const fall = this.peakY - p.y;
        this.vel.y = 0; this.vel.x *= 0.4; this.vel.z *= 0.4;
        this.assist = null; this.flingSpeed = 0;
        this.onBox = box;
        this.squash = Math.min(1, Math.max(0, fall) / 6);
        const steep = !box && th > -0.9 && t.normalAt(p.x, p.z, _n).y < WALKABLE_NY - 0.06;
        this.state = steep ? 'slide' : 'ground';
        if (th > -0.9 || box) this.landed(fall);
        if (box && box.kind === 'pad') this.bounce(box);
      }
    }
  }

  updateSlide(dt, input, move) {
    const t = this.t, p = this.pos;
    const n = t.normalAt(p.x, p.z, _n);
    if (n.y >= WALKABLE_NY) { this.state = 'ground'; this.landed(this.peakY - p.y, 0.6); return; }
    const d = _u.set(n.x, 0, n.z).normalize();
    this.vel.x += (d.x * 16 + move.x * 2) * dt;
    this.vel.z += (d.z * 16 + move.z * 2) * dt;
    p.x += this.vel.x * dt; p.z += this.vel.z * dt;
    this.world.pushOut(p, PLAYER_R);
    const h = t.heightAt(p.x, p.z);
    if (h < p.y - 0.8) { this.state = 'air'; this.vel.y = -2; }
    else p.y = Math.max(h, -0.9);
    if (p.y <= -0.9) { this.state = 'ground'; return; }
    if (input.hook) this.fireHook();
  }

  // ——— крюк ———
  pickTarget(camDir) {
    const chest = _c.copy(this.pos).setY(this.pos.y + 1.3);
    let best = null, bestScore = 1e9, near = null, nearD = 1e9;
    for (const a of this.course.anchors) {
      const d = _d.subVectors(a.pos, chest);
      const dist = d.length();
      if (dist > HOOK_RANGE || dist < 1.2) continue;
      if (this.rope && this.rope.anchor === a) continue;
      if (!this.clearLine(chest, a.pos)) continue;
      const cosA = d.dot(camDir) / dist;
      if (dist < 16 && dist < nearD) { nearD = dist; near = a; }
      if (cosA < 0.25) continue;
      const score = (1 - cosA) * 30 + dist * 0.15;
      if (score < bestScore) { bestScore = score; best = a; }
    }
    this.target = best || near;
    return this.target;
  }

  clearLine(a, b) {
    const steps = 18, len = a.distanceTo(b);
    for (let i = 1; i < steps; i++) {
      const u = i / steps;
      if ((1 - u) * len < 1.8) break;          // у самого кольца верёвка может задеть край — не страшно
      const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u, z = a.z + (b.z - a.z) * u;
      if (this.t.heightAt(x, z) > y - 0.1) return false;
    }
    return true;
  }

  fireHook() {
    if (this.rope) { this.release(false); return; }
    if (this.hook || this.state === 'mantle') return;
    if (!this.target) { this.ev.message('Рядом нет кольца — ищи светящееся кольцо на скале'); return; }
    if (this.stamina < COST.hook) { this.ev.message('Нет сил на крюк — отдохни на земле'); return; }
    this.spend(COST.hook);
    const dist = this.hands.distanceTo(this.target.pos);
    this.hook = { anchor: this.target, t: 0, dur: dist / HOOK_FLY };
  }

  attach() {
    const a = this.hook.anchor;
    this.hook = null;
    this.rope = { anchor: a, len: this.hands.distanceTo(a.pos) };
    this.state = 'rope';
    this.onBox = null; this.assist = null;
  }

  release(boost) {
    if (!this.rope) return;
    this.rope = null;
    this.state = 'air';
    if (boost) {
      this.vel.y = Math.max(this.vel.y, 0) + 5;
      this.spend(COST.jump);
    }
    this.flingSpeed = Math.hypot(this.vel.x, this.vel.z);   // сохранить разгон от раскачки
  }

  updateRope(dt, input, move, amount) {
    const p = this.pos, A = this.rope.anchor.pos;
    this.vel.y -= G * dt;
    this.vel.addScaledVector(move, amount * 8 * dt);
    this.vel.multiplyScalar(1 - 0.2 * dt);
    p.addScaledVector(this.vel, dt);
    this.rope.len = Math.max(ROPE_MIN, this.rope.len - REEL * dt);
    const q = _q.copy(p).setY(p.y + HANDS);
    const d = _d.subVectors(q, A);
    const dist = d.length();
    if (dist > this.rope.len) {
      d.multiplyScalar(1 / dist);
      q.copy(A).addScaledVector(d, this.rope.len);
      p.set(q.x, q.y - HANDS, q.z);
      const vr = this.vel.dot(d);
      if (vr > 0) this.vel.addScaledVector(d, -vr);
    }
    // земля и стена под ногами: тащит вверх по скале
    const th = this.t.heightAt(p.x, p.z);
    if (p.y < th) { p.y = th; if (this.vel.y < 0) this.vel.y = 0; }
    this.world.pushOut(p, PLAYER_R);
    this.course.pushOut(p, this.vel);
    this.spend(COST.hang * dt);
    this.facing = Math.atan2(A.x - p.x, A.z - p.z);
    if (this.rope.anchor.landing && _q.copy(p).setY(p.y + HANDS).distanceTo(A) < 1.25) {
      // долезли до кольца — перелезаем через край на уступ
      const to = this.rope.anchor.landing.clone();
      this.rope = null;
      this.mantle = { from: p.clone(), to, t: 0, dur: 0.45 };
      this.state = 'mantle';
      this.vel.set(0, 0, 0);
      return;
    }
    if (input.hook) this.release(false);
    else if (input.jump) this.release(true);
    else if (this.stamina <= 0) { this.release(false); this.ev.message('Силы кончились — руки разжались!'); }
  }

  updateMantle(dt) {
    const m = this.mantle;
    m.t += dt;
    const u = Math.min(1, m.t / m.dur), e = u * u * (3 - 2 * u);
    this.pos.lerpVectors(m.from, m.to, e);
    this.pos.y += Math.sin(u * Math.PI) * 0.8;
    this.facing = Math.atan2(m.to.x - m.from.x, m.to.z - m.from.z);
    if (u >= 1) {
      this.pos.copy(m.to);
      this.mantle = null;
      this.state = 'ground';
      this.peakY = this.pos.y;
      this.squash = 0.4;
    }
  }

  // движущаяся платформа везёт того, кто на ней стоит
  carry() {
    if (this.state === 'ground' && this.onBox && this.onBox.dp) {
      this.pos.add(this.onBox.dp);
      if (this.onBox.dp.y < 0) this.pos.y = this.onBox.c.y + this.onBox.hy;
    }
  }

  // ——— прочее ———
  spend(v) { this.stamina = Math.max(0, this.stamina - v); this.restTimer = 0; }

  landed(fall, k = 1) {
    if (fall > SAFE_FALL) {
      const dmg = Math.round((fall - SAFE_FALL) * 6 * k);
      if (dmg > 0) this.hurt(dmg);
    }
  }

  hurt(dmg) {
    this.health = Math.max(0, this.health - dmg);
    this.ev.hurt(dmg);
    if (this.health <= 0 && !this.dead) { this.dead = true; this.rope = null; this.hook = null; this.ev.died(); }
  }

  checkPickups() {
    const p = this.pos;
    for (const s of this.course.stars) {
      if (s.taken) continue;
      if (Math.abs(s.pos.x - p.x) < 1.1 && Math.abs(s.pos.z - p.z) < 1.1 && s.pos.y - p.y > -0.6 && s.pos.y - p.y < 2.4) {
        s.taken = true; s.mesh.visible = false; this.ev.star(s);
      }
    }
    for (const b of this.world.bushes) {
      if (b.taken) continue;
      if (Math.abs(b.x - p.x) < 1.4 && Math.abs(b.z - p.z) < 1.4 && Math.abs(b.y - p.y) < 2) {
        b.taken = true; b.berries.visible = false;
        this.stamina = 100; this.health = Math.min(100, this.health + 20);
        this.ev.berries();
      }
    }
    for (const c of this.course.camps) {
      if (Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < 4.5 && Math.abs(c.pos.y - p.y) < 3) {
        if (!c.reached) { c.reached = true; this.ev.camp(c); }
        this.health = 100;
      }
    }
    for (const h of this.course.hints) {
      if (!h.shown && Math.hypot(h.pos.x - p.x, h.pos.z - p.z) < h.r && Math.abs(h.pos.y - p.y) < 3) { h.shown = true; this.ev.hint(h.text); }
    }
    const s = this.t.summit;
    if (Math.hypot(s.x - p.x, s.z - p.z) < 9 && p.y > s.y - 4 && this.state === 'ground') this.ev.summit();
  }

  turnTo(target, dt, speed) {
    let d = target - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, speed * dt);
  }

  // ——— картинка ———
  animate(dt) {
    const H = this.hero, p = this.pos;
    H.root.position.copy(p);
    H.root.rotation.y = this.facing;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.squash = Math.max(0, this.squash - dt * 4);
    const sq = this.squash * 0.18;
    H.body.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
    const f = Math.min(1, dt * 14);
    const pose = (o, x, z) => { o.rotation.x += (x - o.rotation.x) * f; o.rotation.z += (z - o.rotation.z) * f; };
    if (this.state === 'ground') {
      this.walkPhase += dt * hs * 2.3;
      const amp = Math.min(1, hs / 3) * (hs > 5.5 ? 1.0 : 0.75);
      const s = Math.sin(this.walkPhase) * amp;
      pose(H.legL, s, 0); pose(H.legR, -s, 0);
      pose(H.armL, -s * 0.9, -0.35); pose(H.armR, s * 0.9, 0.35);
      H.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.06 * amp + Math.sin(this.time * 2) * 0.01;
      H.body.rotation.x = Math.min(0.25, hs * 0.03);
    } else if (this.state === 'rope') {
      const sw = Math.sin(this.time * 3) * 0.2;
      pose(H.armR, -2.95, 0.15); pose(H.armL, -2.6, -0.25);
      pose(H.legL, 0.25 + sw, 0.1); pose(H.legR, -0.15 - sw, -0.1);
      H.body.rotation.x = 0; H.body.position.y = 0;
    } else if (this.state === 'mantle') {
      pose(H.armL, -2.4, -0.2); pose(H.armR, -2.4, 0.2);
      pose(H.legL, -0.9, 0); pose(H.legR, 0.2, 0);
    } else {
      const up = this.vel.y > 0;
      pose(H.armL, up ? -2.6 : -1.3, -0.6); pose(H.armR, up ? -2.6 : -1.3, 0.6);
      pose(H.legL, up ? -0.7 : 0.3, 0.1); pose(H.legR, up ? 0.2 : -0.3, -0.1);
      H.body.rotation.x = 0; H.body.position.y = 0;
    }
    H.head.rotation.z = Math.sin(this.time * 1.3) * 0.04;
    // верёвка: от рук до крюка (летит или зацеплен)
    const hand = _c.copy(p).setY(p.y + (this.state === 'rope' ? 1.95 : HANDS));
    let end = null;
    if (this.rope) end = this.rope.anchor.pos;
    else if (this.hook) end = _d.copy(hand).lerp(this.hook.anchor.pos, Math.min(1, this.hook.t / this.hook.dur));
    if (end) {
      this.ropeMesh.visible = true;
      this.ropeMesh.position.copy(hand);
      this.ropeMesh.lookAt(end);
      this.ropeMesh.scale.set(1, 1, Math.max(0.01, hand.distanceTo(end)));
      this.hookHead.visible = true;
      this.hookHead.position.copy(end);
    } else { this.ropeMesh.visible = false; this.hookHead.visible = false; }
    // кружок тени под ногами
    const sup = this.supportAt(_q.copy(p).setY(p.y + 0.05), 0.1);
    const hgt = Math.max(0, p.y - sup.y);
    this.shadow.position.set(p.x, Math.max(sup.y, 0) + 0.04, p.z);
    this.shadow.scale.setScalar(Math.max(0.35, 1 - hgt * 0.05));
    this.shadow.material.opacity = Math.max(0.08, 0.26 - hgt * 0.01);
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Vector3(), _n = new THREE.Vector3();
const _u = new THREE.Vector3(), _h = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Vector3();
