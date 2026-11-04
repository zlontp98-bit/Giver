// Хват и лазание по любой крутой скале (по «формуле мира»): повиснуть, лезть вверх/вниз/вбок,
// перелезть через верх, встать на уступ внизу, спуститься с края, поймать стену в падении, оттолкнуться.
// Методы подмешиваются в Player (см. player.js) — this здесь всегда герой.
import * as THREE from 'three';
import { CLIMB_UP, CLIMB_DOWN, CLIMB_SIDE, WALL_OFF, COST, WALKABLE } from './tuning.js';

const STEEP = 0.72;            // |n.y| меньше — по этому можно лезть (не пол и не потолок)
const CH = 0.9;                // центр тела над ступнями

export class ClimbMethods {
  // где можно схватиться: стена перед героем, край обрыва под ногами или скала рядом в падении
  grabSpot() {
    const s = this.state, p = this.pos, P = this.P;
    if (s === 'climb' || s === 'mantle' || s === 'zip' || this.hook || this.dead) return null;
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    if (s === 'air' || s === 'rope') {
      // в падении — ближайшая крутая скала (куда бы ни смотрел)
      for (const h of [1.2, 0.6, 1.7]) {
        const d = P.f(p.x, p.y + h, p.z);
        if (d > 1.15) continue;
        const n = P.normal(p.x, p.y + h, p.z, new THREE.Vector3());
        if (Math.abs(n.y) < STEEP) return { n, center: new THREE.Vector3(p.x, p.y + CH, p.z) };
      }
      return null;
    }
    // стена прямо перед героем
    for (const h of [1.25, 0.7, 1.7]) for (const d of [0.45, 0.8, 1.15]) {
      const x = p.x + fx * d, y = p.y + h, z = p.z + fz * d;
      if (P.f(x, y, z) >= 0.3) continue;
      const n = P.normal(x, y, z, new THREE.Vector3());
      if (Math.abs(n.y) < STEEP) return { n, center: new THREE.Vector3(p.x, p.y + CH + 0.3, p.z) };
    }
    // край обрыва впереди: земля пропадает — спуститься и повиснуть на стене под краем
    if (P.ground(p.x + fx * 1.1, p.y, p.z + fz * 1.1, 0.3, 2.2)) return null;
    for (let d = 1.3; d >= -0.3; d -= 0.2) {
      const x = p.x + fx * d, y = p.y - 1.3, z = p.z + fz * d;
      if (P.f(x, y, z) >= 0.35) continue;
      const n = P.normal(x, y, z, new THREE.Vector3());
      if (Math.abs(n.y) < STEEP) return { n, center: new THREE.Vector3(x + n.x * WALL_OFF, y + 0.2, z + n.z * WALL_OFF), down: true };
    }
    return null;
  }

  tryGrab() {
    const s = this.grabSpot();
    if (!s) { if (this.state === 'ground') this.ev.message('Подойди вплотную к скале или к краю'); return; }
    if (this.stamina < 4) { this.ev.message('Нет сил держаться — отдохни'); return; }
    if (this.state === 'air') { this.spend(COST.grab); if (this.ev.caught) this.ev.caught(); }
    // верёвка (если была) остаётся — это страховка
    this.climb = { n: s.n.clone() };
    const c = this.stick(s.center, s.n);
    const to = c.clone().setY(c.y - CH);
    this.facing = Math.atan2(-this.climb.n.x, -this.climb.n.z);
    if (this.state === 'ground') this.startMantle(to, s.down ? 0.5 : 0.22, 'climb', s.down ? 0.2 : 0.15);
    else { this.pos.copy(to); this.vel.set(0, 0, 0); this.state = 'climb'; }
    this.onBox = null;
  }

  // прижать центр тела к скале на нужном расстоянии; обновить нормаль
  stick(center, n) {
    const P = this.P;
    for (let i = 0; i < 3; i++) {
      const d = P.f(center.x, center.y, center.z);
      P.normal(center.x, center.y, center.z, n);
      center.addScaledVector(n, WALL_OFF - d);
    }
    return center;
  }

  updateClimb(dt, input) {
    const c = this.climb, n = c.n, P = this.P;
    // направления по стене: вбок (горизонтально) и вверх по скале
    const rx = n.z, rz = -n.x, rl = Math.hypot(rx, rz) || 1;
    _r.set(rx / rl, 0, rz / rl);
    _u.crossVectors(n, _r).normalize();
    const R = this.right, sgn = R.x * _r.x + R.z * _r.z >= 0 ? 1 : -1;
    const mx = Math.abs(input.mx) > 0.15 ? input.mx : 0, my = Math.abs(input.my) > 0.15 ? input.my : 0;
    const moving = mx !== 0 || my !== 0;
    const over = n.y < -0.2;                           // нависание — тяжелее
    // шипы на ботинках: на треть меньше сил и нависание не тяжелее стены
    const sp = this.gear && this.gear.spikes;
    this.spend((moving ? COST.climb * (over && !sp ? 1.6 : 1) : COST.hang) * (sp ? 0.66 : 1) * dt);
    if (moving) this.climbPhase += dt * 7;
    const center = _c.copy(this.pos); center.y += 0.9;
    const old = _o.copy(center), oldN = _n.copy(n);
    center.addScaledVector(_r, sgn * mx * CLIMB_SIDE * dt).addScaledVector(_u, my * (my > 0 ? CLIMB_UP : CLIMB_DOWN) * dt);
    // стена кончилась (обогнули угол слишком резко) — не пускаем
    if (P.f(center.x, center.y, center.z) > 1.3) { center.copy(old); }
    this.stick(center, n);
    // упёрлись в потолок или ушли на пол — откат
    if (n.y < -(this.gear && this.gear.spikes ? 0.9 : STEEP)) { center.copy(old); n.copy(oldN); }   // с шипами — и под крутым нависанием
    // руками дотянулись до верха: впереди над руками пусто, а за краем — земля → перелезть
    if (my > 0.3) {
      const hx = center.x - n.x * 0.55, hy = center.y + 1.05, hz = center.z - n.z * 0.55;
      if (P.f(hx, hy, hz) > 0.45) {
        const g = P.ground(center.x - n.x * 1.0, center.y + 1.1, center.z - n.z * 1.0, 0.6, 2.4);
        if (g && (g.ny >= WALKABLE || g.box)) { this.climbOut(center.x - n.x * 1.0, g.y, center.z - n.z * 1.0); return; }
      }
      if (n.y > STEEP) {
        const g = P.ground(center.x, center.y, center.z, 0.8, 1.2);
        if (g && g.ny >= WALKABLE) { this.climbOut(center.x - n.x * 0.6, g.y, center.z - n.z * 0.6); return; }
      }
    }
    this.pos.set(center.x, center.y - 0.9, center.z);
    // ногами на уступ или землю — стоим
    if (my < 0 || n.y > STEEP) {
      const g = P.ground(this.pos.x, this.pos.y, this.pos.z, 0.15, 0.25);
      if (g && (g.ny >= WALKABLE || g.box)) {
        this.climb = null;
        this.pos.y = g.y;
        this.onBox = g.box;
        this.state = 'ground';
        this.vel.set(0, 0, 0);
        this.peakY = g.y;
        this.squash = 0.3;
        return;
      }
    }
    this.facing = Math.atan2(-n.x, -n.z);
    if (this.rope) this.ropePayOut();
    if (input.hook) this.fireHook();
    if (input.grab) this.letGo(0.6, 0);
    else if (input.jump) { this.spend(COST.jump); this.letGo(4.2, 3.2); }
    else if (this.stamina <= 0) { this.letGo(0.4, 0); this.ev.message('Силы кончились — руки разжались!'); }
  }

  climbOut(x, y, z) {
    this.climb = null;
    this.startMantle(_c.set(x, y, z), 0.45, 'ground', 0.7);
  }

  // отпустить скалу: оттолкнуться от неё
  letGo(push, up) {
    const n = this.climb ? this.climb.n : _n.set(-Math.sin(this.facing), 0, -Math.cos(this.facing));
    this.climb = null;
    this.vel.set(n.x * push, up, n.z * push);
    this.state = 'air';
  }
}

const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _c = new THREE.Vector3(), _o = new THREE.Vector3(), _n = new THREE.Vector3();
