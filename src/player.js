// Герой в Бездне: ходит по плато и уступам, лазает по стене руками («Хват», тратит силы),
// спускается по верёвке с кольца, катится по тросу через бездну, прыгает и падает (высоко — больно).
import * as THREE from 'three';
import { RIM_Y, BOTTOM_Y, PR, PH } from './abyss.js';
import { makeHero } from './hero.js';

const G = 22, WALK = 4.6, RUN = 7.0, JUMP = 7.0;
const SAFE_FALL = 6, DEADLY_FALL = 32;
const CLIMB_UP = 1.5, CLIMB_DOWN = 2.1, CLIMB_SIDE = 1.7, WALL_OFF = 0.42;
const HANG = 1.9;                                   // руки над ногами, когда висим
const ROPE_MIN = 1.0, ROPE_MAX = 75, ROPE_DOWN = 5, ROPE_UP = 2.2;
export const HOOK_RANGE = 14;
const ZIP_RANGE = 7;
export const COST = { run: 8, jump: 3, climb: 6.5, hang: 2.2, grab: 10, rope: 1.2, ropeUp: 7, regen: 22 };

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
    this.hero = makeHero();
    // герой не отбрасывает «настоящую» тень (тени обновляются не каждый кадр) — под ним свой кружок
    this.hero.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    scene.add(this.hero.root);
    // фонарик на шапке: чем глубже, тем ярче
    this.lamp = new THREE.PointLight('#ffd29a', 0, 16, 1.4);
    this.lamp.position.set(0, 1.75, 0.3);
    this.hero.root.add(this.lamp);
    // верёвка и крюк
    const rg = new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1, true);
    rg.translate(0, 0.5, 0);
    rg.rotateX(Math.PI / 2);
    this.ropeMesh = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: '#c98a4b' }));
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

  // ——— хват: повиснуть на стене ———
  grabSpot() {
    const s = this.state, p = this.pos;
    if (s === 'climb' || s === 'mantle' || s === 'zip' || this.hook) return null;
    const r = Math.hypot(p.x, p.z), th = Math.atan2(p.x, p.z);
    if (p.y > RIM_Y - 0.5) {
      // с плато — перелезть через край и повиснуть
      const rw = this.A.wallR(th, RIM_Y);
      return s === 'ground' && r < rw + 1.4 ? { th, y: RIM_Y - 1.8 } : null;
    }
    const gap = this.A.wallR(th, p.y + 0.9) - r;
    if (gap > (s === 'ground' ? 1.3 : 1.0)) return null;
    return { th, y: s === 'ground' ? p.y + 0.35 : p.y };
  }

  tryGrab() {
    const s = this.grabSpot();
    if (!s) { if (this.state === 'ground') this.ev.message('Подойди вплотную к стене или к краю'); return; }
    if (this.stamina < 4) { this.ev.message('Нет сил держаться — отдохни'); return; }
    if (this.state === 'air') { this.spend(COST.grab); if (this.ev.caught) this.ev.caught(); }
    if (this.rope) this.rope = null;
    this.climb = { th: s.th, y: s.y };
    const to = this.climbPos(this.climb, new THREE.Vector3());
    this.facing = s.th;
    if (this.state === 'ground') this.startMantle(to, this.pos.y > RIM_Y - 0.5 ? 0.5 : 0.22, 'climb', 0.25);
    else { this.pos.copy(to); this.vel.set(0, 0, 0); this.state = 'climb'; }
    this.onBox = null;
  }

  climbPos(c, out) {
    const r = this.A.wallR(c.th, Math.min(RIM_Y - 0.2, c.y + 0.9)) - WALL_OFF;
    return out.set(Math.sin(c.th) * r, c.y, Math.cos(c.th) * r);
  }

  updateClimb(dt, input) {
    const c = this.climb, A = this.A;
    // «вправо» — по камере: смотрим, в какую сторону растёт угол
    const R = this.right;
    const sgn = R.x * Math.cos(c.th) - R.z * Math.sin(c.th) >= 0 ? 1 : -1;
    const mx = Math.abs(input.mx) > 0.15 ? input.mx : 0, my = Math.abs(input.my) > 0.15 ? input.my : 0;
    const moving = mx !== 0 || my !== 0;
    this.spend((moving ? COST.climb : COST.hang) * dt);
    if (moving) this.climbPhase += dt * 7;
    // 1) вбок
    const rr = A.wallR(c.th, c.y + 0.9);
    let th = c.th + (sgn * mx * CLIMB_SIDE * dt) / rr;
    if (mx !== 0) {
      for (const L of A.ledges) {
        if (c.y >= L.y || c.y + PH <= L.y - L.thick) continue;
        if (A.ledgeU(L, th) < 0 || A.ledgeU(L, c.th) >= 0) continue;
        // упёрлись в бок полки: если она почти под ногами — шагнуть на неё
        if (c.y > L.y - 1.2) { this.climbOut(th, L.y, A.wallR(th, L.y) - 1.0); return; }
        th = c.th;
        break;
      }
    }
    // 2) вверх-вниз
    let y = c.y + my * (my > 0 ? CLIMB_UP : CLIMB_DOWN) * dt;
    if (y + 1.8 > RIM_Y) {
      if (my > 0.3) { this.climbOut(th, RIM_Y, A.wallR(th, RIM_Y) + 0.9); return; }
      y = Math.min(c.y, RIM_Y - 1.8);
    }
    for (const L of A.ledges) {
      if (A.ledgeU(L, th) < 0) continue;
      const bottom = L.y - L.thick;
      if (my > 0 && c.y + PH <= bottom + 0.02 && y + PH > bottom) y = bottom - PH;    // головой в полку
    }
    c.th = th;
    const prev = c.y;
    c.y = y;
    this.climbPos(c, this.pos);
    // ногами на полку, доску или дно — стоим
    if (my < 0) {
      const sup = this.supportAt(_q.copy(this.pos).setY(prev), 0.02);
      if (sup && sup.y >= y) {
        this.climb = null;
        this.pos.y = sup.y;
        this.onBox = sup.box;
        this.state = 'ground';
        this.vel.set(0, 0, 0);
        this.peakY = sup.y;
        this.squash = 0.3;
        return;
      }
    }
    this.facing = th;
    if (input.grab) this.letGo(0.6, 0);
    else if (input.jump) { this.spend(COST.jump); this.letGo(4.2, 3.2); }
    else if (this.stamina <= 0) { this.letGo(0.4, 0); this.ev.message('Силы кончились — руки разжались!'); }
  }

  climbOut(th, y, r) {
    this.climb = null;
    this.startMantle(_q.set(Math.sin(th) * r, y, Math.cos(th) * r), 0.45, 'ground', 0.7);
    this.facing = th;
  }

  // отпустить стену: оттолкнуться к середине шахты
  letGo(push, up) {
    const th = this.climb ? this.climb.th : Math.atan2(this.pos.x, this.pos.z);
    this.climb = null;
    this.vel.set(-Math.sin(th) * push, up, -Math.cos(th) * push);
    this.state = 'air';
  }

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

  // куда смотреть камере (null — пусть крутит игрок)
  cameraYaw() {
    if (this.state === 'climb' || this.state === 'rope' || (this.state === 'mantle' && this.mantle.then !== 'ground')) {
      const p = this.state === 'mantle' ? this.mantle.to : this.pos;
      return Math.atan2(p.x, p.z) + Math.PI;
    }
    if (this.state === 'zip' && this.zip) return Math.atan2(-this.zip.z.dir.x, -this.zip.z.dir.z);
    return null;
  }
  cameraPitch() {
    if (this.state === 'climb') return 0.5;
    if (this.state === 'rope') return 0.65;
    if (this.state === 'zip') return 0.3;
    return null;
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
    const st = this.state === 'mantle' ? this.mantle.then : this.state;
    if (st === 'ground' && this.state !== 'mantle') {
      this.walkPhase += dt * hs * 2.3;
      const amp = Math.min(1, hs / 3) * (hs > 5.5 ? 1.0 : 0.75);
      const s = Math.sin(this.walkPhase) * amp;
      pose(H.legL, s, 0); pose(H.legR, -s, 0);
      pose(H.armL, -s * 0.9, -0.35); pose(H.armR, s * 0.9, 0.35);
      H.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.06 * amp + Math.sin(this.time * 2) * 0.01;
      H.body.rotation.x = Math.min(0.25, hs * 0.03);
    } else if (st === 'climb') {
      // руки по очереди тянутся вверх, ноги упираются
      const s = Math.sin(this.climbPhase);
      pose(H.armL, -2.5 - s * 0.45, -0.35); pose(H.armR, -2.5 + s * 0.45, 0.35);
      pose(H.legL, -0.5 + s * 0.4, 0.15); pose(H.legR, -0.5 - s * 0.4, -0.15);
      H.body.rotation.x = -0.12; H.body.position.y = 0;
    } else if (st === 'rope' || st === 'zip') {
      const sw = Math.sin(this.time * 3) * 0.2;
      pose(H.armR, -2.95, 0.15); pose(H.armL, -2.95, -0.15);
      pose(H.legL, 0.25 + sw, 0.1); pose(H.legR, -0.15 - sw, -0.1);
      H.body.rotation.x = st === 'zip' ? 0.15 : 0; H.body.position.y = 0;
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
    // верёвка: от рук до кольца (крюк летит или зацеплен)
    const hand = _c.copy(p).setY(p.y + (this.rope || this.zip ? HANG : 1.5));
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
    const sup = this.state === 'ground' ? { y: p.y } : this.supportAt(_q.copy(p).setY(p.y + 0.05), 0.1);
    if (sup && p.y - sup.y < 12) {
      const hgt = Math.max(0, p.y - sup.y);
      this.shadow.visible = true;
      this.shadow.position.set(p.x, sup.y + 0.04, p.z);
      this.shadow.scale.setScalar(Math.max(0.35, 1 - hgt * 0.05));
      this.shadow.material.opacity = Math.max(0.08, 0.26 - hgt * 0.01);
    } else this.shadow.visible = false;
  }
}

const _a = new THREE.Vector3(), _m = new THREE.Vector3();
const _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Vector3();
