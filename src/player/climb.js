// Хват и лазание: повиснуть на стене, лезть вверх/вниз/вбок, встать на полку, перелезть через край, отпустить.
// Методы подмешиваются в Player (см. player.js) — this здесь всегда герой.
import * as THREE from 'three';
import { RIM_Y, PH } from '../world/abyss.js';
import { CLIMB_UP, CLIMB_DOWN, CLIMB_SIDE, WALL_OFF, COST } from './tuning.js';

export class ClimbMethods {
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
}

const _q = new THREE.Vector3();
