// Столкновения и опора: скалы и земля — по «формуле мира» (SdfWorld.f), постройки и предметы — коробки
// (дома, настил, перила, ящики) и столбики (стволы, фонари). Тяжёлой физики нет — только то, что нужно герою.
import * as THREE from 'three';

const CELL = 16;
const key = (x, z) => Math.floor(x / CELL) * 8192 + Math.floor(z / CELL);

export class Physics {
  constructor(W, colliders = []) {
    this.W = W;
    this.grid = new Map();
    for (const c of colliders) this.addCollider(c);
    this._n = new THREE.Vector3();
  }

  addCollider(c) {
    const r = c.box ? Math.hypot(c.hx, c.hz) : c.r;
    const x = c.box ? c.c.x : c.x, z = c.box ? c.c.z : c.z;
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++)
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) {
        const k = gx * 8192 + gz;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(c);
      }
  }
  near(x, z) { return this.grid.get(key(x, z)) || EMPTY; }

  f(x, y, z) { return this.W.f(x, y, z); }
  normal(x, y, z, out = this._n) { return this.W.normal(x, y, z, out); }

  // точка внутри камня или постройки? (камера, прицел)
  solid(x, y, z, pad = 0.25) {
    if (this.W.f(x, y, z) < pad) return true;
    for (const c of this.near(x, z)) {
      if (c.box) {
        if (y < c.c.y - c.hy || y > c.c.y + c.hy) continue;
        const dx = x - c.c.x, dz = z - c.c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) < c.hx && Math.abs(lz) < c.hz) return true;
      } else if (c.cyl && c.r > 0.6) {
        // толстые столбы (большие кристаллы, башня мельницы) — камера не должна в них залезать
        if (y > c.y0 && y < c.y1 && Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
      }
    }
    return false;
  }

  // вытолкнуть шар (центр c, радиус r) из скал; вернёт нормаль самого сильного касания (или null)
  pushSphere(c, r, vel) {
    let hit = null;
    for (let it = 0; it < 3; it++) {
      const d = this.W.f(c.x, c.y, c.z);
      if (d >= r) break;
      const n = this.W.normal(c.x, c.y, c.z, it === 0 ? (hit = new THREE.Vector3()) : this._n);
      const push = r - d + 0.002;
      c.x += n.x * push; c.y += n.y * push; c.z += n.z * push;
      if (vel) { const vn = vel.x * n.x + vel.y * n.y + vel.z * n.z; if (vn < 0) { vel.x -= n.x * vn; vel.y -= n.y * vn; vel.z -= n.z * vn; } }
    }
    return hit;
  }

  // упереться в постройки и стволы (по горизонтали; над коробкой — это уже опора)
  pushProps(p, r, h, vel) {
    let bumped = false;
    for (const c of this.near(p.x, p.z)) {
      if (c.box) {
        const top = c.c.y + c.hy, bottom = c.c.y - c.hy;
        if (p.y >= top - 0.4 || p.y + h <= bottom) continue;
        const dx = p.x - c.c.x, dz = p.z - c.c.z;
        let lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        const ex = c.hx + r, ez = c.hz + r;
        if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
        // снизу в коробку головой
        if (vel && vel.y > 0 && p.y + h - vel.y * 0.03 <= bottom + 0.05 && Math.abs(lx) < c.hx && Math.abs(lz) < c.hz) { p.y = bottom - h; vel.y = 0; bumped = true; continue; }
        if (ex - Math.abs(lx) < ez - Math.abs(lz)) lx = Math.sign(lx || 1) * ex; else lz = Math.sign(lz || 1) * ez;
        p.x = c.c.x + lx * c.cos + lz * c.sin;
        p.z = c.c.z - lx * c.sin + lz * c.cos;
      } else if (c.cyl) {
        if (p.y > c.y1 || p.y + h < c.y0) continue;
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
        if (d < min && d > 1e-4) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; }
      }
    }
    return bumped;
  }

  // опора под ногами: ищем поверхность от y + up вниз на up + drop. Вернёт { y, ny, box } или null.
  ground(x, y, z, up = 0.5, drop = 0.6) {
    let best = null;
    const t = this.W.raycast(x, y + up, z, 0, -1, 0, up + drop, 0.03);
    if (t >= 0) {
      const gy = y + up - t, n = this.W.normal(x, gy + 0.05, z, this._n);
      best = { y: gy, ny: n.y, box: null };
    }
    for (const c of this.near(x, z)) {
      if (!c.box) continue;
      const top = c.c.y + c.hy;
      if (top > y + up || top < y - drop) continue;
      const dx = x - c.c.x, dz = z - c.c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
      if (Math.abs(lx) <= c.hx + 0.1 && Math.abs(lz) <= c.hz + 0.1 && (!best || top > best.y)) best = { y: top, ny: 1, box: c };
    }
    return best;
  }

  // луч до скалы (для крюка): { t, point, normal } или null. radius — «толстый» луч: точка — на скале под ним
  raycast(o, d, maxT, radius = 0) {
    const t = this.W.raycast(o.x, o.y, o.z, d.x, d.y, d.z, maxT, 0.05, Math.max(0.04, radius));
    if (t < 0) return null;
    const point = new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    const normal = this.W.normal(point.x, point.y, point.z, new THREE.Vector3());
    if (radius > 0) point.addScaledVector(normal, -this.W.f(point.x, point.y, point.z));
    return { t, point, normal };
  }

  clearLine(a, b, skipEnd = 0.6) {
    const len = a.distanceTo(b), n = Math.max(4, Math.ceil(len / 0.8));
    for (let i = 1; i < n; i++) {
      const u = i / n;
      if ((1 - u) * len < skipEnd) break;
      if (this.solid(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u, 0.1)) return false;
    }
    return true;
  }
}

const EMPTY = [];
