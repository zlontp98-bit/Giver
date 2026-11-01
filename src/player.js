// Герой: ходит, бегает, прыгает, цепляется за скалы и лезет, пока хватает сил.
import * as THREE from 'three';
import { WALKABLE_NY, HALF } from './terrain.js';

const GRAVITY = 22;
const WALK = 4.2, RUN = 7.0;
const CLIMB_SPEED = 1.7, LUNGE_SPEED = 6.5;
const SAFE_FALL = 6;           // с такой высоты падать не больно
const UP = new THREE.Vector3(0, 1, 0);

export const COST = {
  jump: 8,
  grabInAir: 6,
  lunge: 18,
  runPerSec: 11,
  climbPerSec: 6.5,
  hangPerSec: 2.5,
  regenPerSec: 15,
};

export class Player {
  constructor(scene, terrain, world, events) {
    this.t = terrain;
    this.world = world;
    this.ev = events;              // колбэки: message(text), hurt(dmg), died(), camp(c), berries(), summit()
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.state = 'ground';
    this.facing = Math.PI;
    this.health = 100;
    this.stamina = 100;
    this.peakY = 0;
    this.restTimer = 0;
    this.lunge = 0;
    this.wallPush = 0;             // сколько упираемся в стену (подсказка «✋»)
    this.walkPhase = 0;
    this.climbPhase = 0;
    this.normal = new THREE.Vector3(0, 1, 0);
    this.model = makeModel();
    scene.add(this.model.root);
    this.shadow = makeShadow();
    scene.add(this.shadow);
  }

  spawn(p) {
    this.pos.copy(p);
    this.pos.y = this.t.heightAt(p.x, p.z);
    this.vel.set(0, 0, 0);
    this.state = 'ground';
    this.health = 100;
    this.stamina = 100;
    this.lunge = 0;
    this.dead = false;
  }

  get climbing() { return this.state === 'climb'; }
  get forward() { return _f.set(Math.sin(this.facing), 0, Math.cos(this.facing)); }

  update(dt, input, camYaw) {
    if (this.dead) return;
    // направление движения от камеры
    const F = _a.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const R = _b.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const move = _m.set(0, 0, 0).addScaledVector(F, input.my).addScaledVector(R, input.mx);
    const amount = Math.min(1, move.length());
    if (amount > 0.01) move.divideScalar(move.length());

    const wasState = this.state;
    switch (this.state) {
      case 'ground': this.updateGround(dt, input, move, amount); break;
      case 'air': this.updateAir(dt, input, move, amount); break;
      case 'slide': this.updateSlide(dt, input, move); break;
      case 'climb': this.updateClimb(dt, input); break;
    }
    // высоту падения считаем с момента, как ушли с земли или со скалы
    if (wasState !== this.state && (this.state === 'air' || this.state === 'slide') &&
        (wasState === 'ground' || wasState === 'climb')) this.peakY = this.pos.y;

    // упираемся в скалу — подсказка нажать «хват»
    if ((this.state === 'ground' || this.state === 'slide') && amount > 0.3 && this.wallAhead(move)) {
      this.wallPush = Math.min(1, this.wallPush + dt * 3);
    } else {
      this.wallPush = Math.max(0, this.wallPush - dt * 2);
    }

    // не уплыть за край света
    const r = Math.hypot(this.pos.x, this.pos.z), lim = HALF - 3;
    if (r > lim) { this.pos.x *= lim / r; this.pos.z *= lim / r; }

    // силы восстанавливаются на земле, если их какое-то время не тратить
    this.restTimer += dt;
    if ((this.state === 'ground' || this.state === 'slide') && this.restTimer > 0.7) {
      this.stamina = Math.min(100, this.stamina + COST.regenPerSec * dt);
    }
    this.checkPickups();
    this.animate(dt, amount);
  }

  updateGround(dt, input, move, amount) {
    const t = this.t, p = this.pos;
    const deep = t.heightAt(p.x, p.z) < -0.9;
    const running = input.run && amount > 0.5 && this.stamina > 1 && !deep;
    const speed = deep ? 2.2 : running ? RUN : WALK;
    if (running) this.spend(COST.runPerSec * dt);
    const k = Math.min(1, 12 * dt);
    this.vel.x += (move.x * speed * amount - this.vel.x) * k;
    this.vel.z += (move.z * speed * amount - this.vel.z) * k;
    if (amount > 0.05) this.turnTo(Math.atan2(move.x, move.z), dt, 12);

    let nx = p.x + this.vel.x * dt, nz = p.z + this.vel.z * dt;
    let nh = t.heightAt(nx, nz);
    const n = t.normalAt(nx, nz, _n);
    if (n.y < WALKABLE_NY && nh > p.y + 0.05) {
      // упёрлись в скалу: скользим вдоль неё
      const up = _u.set(-n.x, 0, -n.z).normalize();
      const into = this.vel.x * up.x + this.vel.z * up.z;
      if (into > 0) { this.vel.x -= up.x * into; this.vel.z -= up.z * into; }
      nx = p.x + this.vel.x * dt; nz = p.z + this.vel.z * dt;
      nh = t.heightAt(nx, nz);
      if (t.normalAt(nx, nz, _n).y < WALKABLE_NY && nh > p.y + 0.05) { nx = p.x; nz = p.z; nh = t.heightAt(nx, nz); }
    }
    p.x = nx; p.z = nz;
    this.world.pushOut(p, 0.35);
    nh = t.heightAt(p.x, p.z);
    const floor = Math.max(nh, -0.9);
    if (floor < p.y - 0.6) {                 // шагнули с уступа
      this.state = 'air';
      this.vel.y = 0;
    } else {
      p.y = floor;
      // съезжаем, только если заметно круче порога (иначе дёргается на границе)
      if (nh > -0.9 && t.normalAt(p.x, p.z, _n).y < WALKABLE_NY - 0.06) this.state = 'slide';
    }
    if (input.grab) this.tryGrab();
    if (input.jump && this.state === 'ground') {
      if (this.stamina >= COST.jump) {
        this.spend(COST.jump);
        this.vel.y = 6.6;
        this.state = 'air';
      } else this.ev.message('Нет сил прыгнуть');
    }
  }

  updateAir(dt, input, move, amount) {
    const t = this.t, p = this.pos;
    this.vel.y -= GRAVITY * dt;
    this.vel.x += move.x * amount * 7 * dt;
    this.vel.z += move.z * amount * 7 * dt;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > RUN) { this.vel.x *= RUN / hs; this.vel.z *= RUN / hs; }
    if (amount > 0.05) this.turnTo(Math.atan2(move.x, move.z), dt, 5);

    const nx = p.x + this.vel.x * dt, nz = p.z + this.vel.z * dt;
    if (t.heightAt(nx, nz) > p.y + 0.3) {   // в полёте врезались в стену
      this.vel.x *= -0.15; this.vel.z *= -0.15;
    } else { p.x = nx; p.z = nz; }
    p.y += this.vel.y * dt;
    this.world.pushOut(p, 0.35);
    this.peakY = Math.max(this.peakY, p.y);
    if (input.grab) { this.tryGrab(); if (this.state !== 'air') return; }

    const h = Math.max(t.heightAt(p.x, p.z), -0.9);
    if (p.y <= h) {
      p.y = h;
      const fall = this.peakY - p.y;
      this.vel.y = 0;
      this.vel.x *= 0.3; this.vel.z *= 0.3;
      this.state = h > -0.9 && t.normalAt(p.x, p.z, _n).y < WALKABLE_NY - 0.06 ? 'slide' : 'ground';
      if (h > -0.9) this.landed(fall, 1);
    }
  }

  updateSlide(dt, input, move) {
    const t = this.t, p = this.pos;
    const n = t.normalAt(p.x, p.z, _n);
    if (n.y >= WALKABLE_NY) {
      this.state = 'ground';
      this.landed(this.peakY - p.y, 0.6);
      return;
    }
    if (this.peakY < p.y) this.peakY = p.y;
    const d = _u.set(n.x, 0, n.z).normalize();       // вниз по склону
    this.vel.x += (d.x * 16 + move.x * 2) * dt;
    this.vel.z += (d.z * 16 + move.z * 2) * dt;
    p.x += this.vel.x * dt; p.z += this.vel.z * dt;
    this.world.pushOut(p, 0.35);
    const h = t.heightAt(p.x, p.z);
    if (h < p.y - 0.8) { this.state = 'air'; this.vel.y = -2; }
    else p.y = Math.max(h, -0.9);
    if (p.y <= -0.9) { this.state = 'ground'; return; }
    if (input.grab) this.tryGrab();
  }

  updateClimb(dt, input) {
    const t = this.t, p = this.pos;
    const n = t.normalAt(p.x, p.z, _n);
    this.normal.copy(n);
    if (n.y > WALKABLE_NY + 0.04) {
      // выбрались наверх (или спустились на полку)
      if (input.my > 0.2) { const up = _u.set(-n.x, 0, -n.z).normalize(); p.x += up.x * 0.3; p.z += up.z * 0.3; }
      p.y = t.heightAt(p.x, p.z);
      this.state = 'ground';
      this.vel.set(0, 0, 0);
      return;
    }
    // вверх по скале и вбок вдоль неё
    const tu = _u.copy(UP).addScaledVector(n, -n.y).normalize();
    const hz = Math.hypot(n.x, n.z) || 1;
    const side = _s.set(n.z / hz, 0, -n.x / hz);
    let my = input.my, mx = input.mx;
    if (this.lunge > 0) { this.lunge -= dt; my = LUNGE_SPEED / CLIMB_SPEED; mx = 0; }
    const moving = Math.abs(my) + Math.abs(mx) > 0.1;
    this.spend((moving ? COST.climbPerSec : COST.hangPerSec) * dt);
    if (moving) this.climbPhase += dt * 7;
    p.addScaledVector(tu, my * CLIMB_SPEED * dt).addScaledVector(side, mx * CLIMB_SPEED * dt);
    p.y = t.heightAt(p.x, p.z);
    this.facing = Math.atan2(-n.x, -n.z);

    if (input.jump && this.lunge <= 0) {
      if (this.stamina >= COST.lunge) { this.spend(COST.lunge); this.lunge = 0.28; }
      else this.ev.message('Нет сил на рывок');
    }
    if (this.stamina <= 0) {
      this.letGo(n);
      this.ev.message('Силы кончились — сорвались!');
    } else if (input.grab) {
      this.letGo(n);
    }
  }

  letGo(n) {
    this.state = 'air';
    this.peakY = this.pos.y;
    this.vel.set(n.x * 2.2, 0.5, n.z * 2.2);
    this.pos.x += n.x * 0.3; this.pos.z += n.z * 0.3;
    this.lunge = 0;
  }

  // Ухватиться за скалу перед собой (или под собой, если съезжаем).
  tryGrab() {
    const t = this.t, p = this.pos;
    if (this.stamina < (this.state === 'ground' ? 4 : COST.grabInAir)) { this.ev.message('Нет сил ухватиться — отдохни'); return; }
    const here = t.normalAt(p.x, p.z, _n);
    let gx = null, gz = null;
    if (here.y < WALKABLE_NY && Math.abs(t.heightAt(p.x, p.z) - p.y) < 1.2) {
      gx = p.x; gz = p.z;
    } else {
      // ищем стену впереди на уровне груди
      const f = this.state === 'ground' || this.state === 'climb' ? this.forward : _f.set(this.vel.x, 0, this.vel.z);
      if (f.lengthSq() < 1e-4) f.set(Math.sin(this.facing), 0, Math.cos(this.facing));
      f.normalize();
      const target = p.y + 0.9;
      for (let d = 0.2; d <= 1.6; d += 0.1) {
        const x = p.x + f.x * d, z = p.z + f.z * d;
        if (t.heightAt(x, z) >= target && t.normalAt(x, z, _n).y < WALKABLE_NY) {
          // точка на скале чуть ниже — там, где будут ноги
          let lo = Math.max(0, d - 0.6), hi = d;
          for (let i = 0; i < 10; i++) {
            const mid = (lo + hi) / 2;
            if (t.heightAt(p.x + f.x * mid, p.z + f.z * mid) >= p.y + 0.3) hi = mid; else lo = mid;
          }
          gx = p.x + f.x * hi; gz = p.z + f.z * hi;
          break;
        }
      }
    }
    if (gx === null) {
      if (this.state === 'ground') this.ev.message('Тут не за что ухватиться — подойди к скале');
      return;
    }
    const n = t.normalAt(gx, gz, _n);
    if (n.y >= WALKABLE_NY) return;
    if (this.state === 'air' || this.state === 'slide') this.spend(COST.grabInAir);
    // поймались в падении — высота падения обнуляется
    p.x = gx; p.z = gz; p.y = t.heightAt(gx, gz);
    this.vel.set(0, 0, 0);
    this.state = 'climb';
    this.lunge = 0;
    this.facing = Math.atan2(-n.x, -n.z);
  }

  spend(v) {
    this.stamina = Math.max(0, this.stamina - v);
    this.restTimer = 0;
  }

  // Впереди (куда толкаем джойстик) скала выше головы?
  wallAhead(move) {
    const t = this.t, p = this.pos;
    for (const d of [0.5, 1.0]) {
      const x = p.x + move.x * d, z = p.z + move.z * d;
      if (t.heightAt(x, z) > p.y + 0.8 && t.normalAt(x, z, _n).y < WALKABLE_NY) return true;
    }
    return false;
  }

  landed(fall, k) {
    if (fall > SAFE_FALL) {
      const dmg = Math.round((fall - SAFE_FALL) * 7 * k);
      if (dmg > 0) this.hurt(dmg);
    }
  }

  hurt(dmg) {
    this.health = Math.max(0, this.health - dmg);
    this.ev.hurt(dmg);
    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      this.ev.died();
    }
  }

  checkPickups() {
    const p = this.pos;
    for (const b of this.world.bushes) {
      if (b.taken) continue;
      if (Math.abs(b.x - p.x) < 1.4 && Math.abs(b.z - p.z) < 1.4 && Math.abs(b.y - p.y) < 2) {
        b.taken = true;
        b.berries.visible = false;
        this.stamina = 100;
        this.health = Math.min(100, this.health + 20);
        this.ev.berries();
      }
    }
    for (const c of this.world.camps) {
      if (Math.hypot(c.x - p.x, c.z - p.z) < 4.5 && Math.abs(c.y - p.y) < 3) {
        if (!c.reached) { c.reached = true; this.ev.camp(c); }
        this.health = 100;
      }
    }
    const s = this.t.summit;
    if (Math.hypot(s.x - p.x, s.z - p.z) < 9 && p.y > s.y - 4 && this.state === 'ground') this.ev.summit();
  }

  turnTo(target, dt, speed) {
    let d = target - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, speed * dt);
  }

  animate(dt, amount) {
    const M = this.model, p = this.pos;
    M.root.position.copy(p);
    if (this.state === 'climb') M.root.position.addScaledVector(this.normal, 0.32);
    M.root.rotation.y = this.facing;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.state === 'ground') {
      this.walkPhase += dt * hs * 2.4;
      const s = Math.sin(this.walkPhase) * Math.min(1, hs / 3) * 0.8;
      M.legL.rotation.x = s; M.legR.rotation.x = -s;
      M.armL.rotation.x = -s * 0.8; M.armR.rotation.x = s * 0.8;
      M.armL.rotation.z = 0; M.armR.rotation.z = 0;
      M.body.rotation.x = Math.min(0.25, hs * 0.03);
    } else if (this.state === 'climb') {
      const s = Math.sin(this.climbPhase);
      M.armL.rotation.x = -2.6 + s * 0.4; M.armR.rotation.x = -2.6 - s * 0.4;
      M.armL.rotation.z = 0; M.armR.rotation.z = 0;
      M.legL.rotation.x = -0.5 - s * 0.4; M.legR.rotation.x = -0.5 + s * 0.4;
      M.body.rotation.x = 0.15;
    } else {
      M.armL.rotation.x = -1.2; M.armR.rotation.x = -1.2;
      M.armL.rotation.z = 0.5; M.armR.rotation.z = -0.5;
      M.legL.rotation.x = 0.3; M.legR.rotation.x = -0.2;
      M.body.rotation.x = 0;
    }
    // тень под ногами
    const g = this.t.heightAt(p.x, p.z);
    this.shadow.position.set(p.x, Math.max(g, 0) + 0.05, p.z);
    const hgt = Math.max(0, p.y - g);
    this.shadow.scale.setScalar(Math.max(0.4, 1 - hgt * 0.06));
    this.shadow.visible = this.state !== 'climb';
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Vector3();
const _n = new THREE.Vector3(), _u = new THREE.Vector3(), _s = new THREE.Vector3(), _f = new THREE.Vector3();

function makeModel() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const jacket = new THREE.MeshLambertMaterial({ color: '#ff7a3d', flatShading: true });
  const pants = new THREE.MeshLambertMaterial({ color: '#34465c', flatShading: true });
  const skin = new THREE.MeshLambertMaterial({ color: '#f0c49c', flatShading: true });
  const hatM = new THREE.MeshLambertMaterial({ color: '#2f6fae', flatShading: true });
  const packM = new THREE.MeshLambertMaterial({ color: '#6a5038', flatShading: true });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.45, 3, 8), jacket);
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.21, 1), skin);
  head.position.y = 1.6;
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.3, 8), hatM);
  hat.position.y = 1.82;
  const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), hatM);
  pom.position.y = 1.98;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.24), packM);
  pack.position.set(0, 1.1, -0.3);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.46, 8), new THREE.MeshLambertMaterial({ color: '#3d8a5a' }));
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, 1.42, -0.32);
  body.add(torso, head, hat, pom, pack, roll);

  const limb = (w, h, mat) => {
    const g = new THREE.BoxGeometry(w, h, w);
    g.translate(0, -h / 2, 0);
    return new THREE.Mesh(g, mat);
  };
  const legL = limb(0.15, 0.62, pants), legR = limb(0.15, 0.62, pants);
  legL.position.set(-0.13, 0.64, 0); legR.position.set(0.13, 0.64, 0);
  const armL = limb(0.12, 0.55, jacket), armR = limb(0.12, 0.55, jacket);
  armL.position.set(-0.36, 1.38, 0); armR.position.set(0.36, 1.38, 0);
  root.add(legL, legR, armL, armR);
  return { root, body, legL, legR, armL, armR };
}

function makeShadow() {
  const geo = new THREE.CircleGeometry(0.45, 16);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false });
  return new THREE.Mesh(geo, mat);
}
