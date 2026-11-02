// Бездна: огромная вертикальная шахта. Стена — радиус wallR(θ, y), уступы-полки на стене, плато
// наверху вокруг устья, дно внизу. Здесь же опора под ногами и столкновения со стеной и полками.
// Угол θ: x = sin θ · r, z = cos θ · r (ось шахты — x = z = 0).
import * as THREE from 'three';
import { makeNoise3D, makeRng, smoothstep, clamp } from '../core/noise.js';

export const RIM_Y = 0;          // край бездны (плато)
export const BOTTOM_Y = -232;    // дно
export const R0 = 46;            // примерный радиус шахты
export const R_OUT = 120;        // край плато (дальше не уйти)
export const PR = 0.35, PH = 1.75;  // герой: радиус и рост

// Ярусы бездны — свои названия и цвета (не из чужих произведений)
export const LAYERS = [
  { name: 'Устье', top: 0, rock: '#bf9a74', rock2: '#8c6b4f', moss: '#76a048', ground: '#78b84f', fog: '#dfe7d6', fogD: 0.0045, light: 1.0, glow: '#000000', fill: '#ffe9cc' },
  { name: 'Корневой ярус', top: -55, rock: '#97806a', rock2: '#614d3e', moss: '#4f9147', ground: '#4c8a42', fog: '#a7bea4', fogD: 0.0072, light: 0.8, glow: '#9fe36a', fill: '#ddf3c4' },
  { name: 'Хрустальные гроты', top: -115, rock: '#7d8bab', rock2: '#4e5875', moss: '#3d9aa6', ground: '#5d84a4', fog: '#6a7ea4', fogD: 0.0098, light: 0.6, glow: '#3fd0ff', fill: '#aee0ff' },
  { name: 'Дно', top: -178, rock: '#72619a', rock2: '#41365e', moss: '#8a5cc4', ground: '#3f6074', fog: '#3a3560', fogD: 0.0115, light: 0.45, glow: '#b86bff', fill: '#cfb0ff' },
];
export function layerAt(y) {
  let k = 0;
  for (let i = 0; i < LAYERS.length; i++) if (y <= LAYERS[i].top) k = i;
  return k;
}
// плавное смешивание свойств ярусов по глубине (для цвета тумана, света и т. п.)
export function layerMix(y) {
  const k = layerAt(y);
  const next = LAYERS[k + 1];
  if (!next) return { a: LAYERS[k], b: LAYERS[k], t: 0 };
  const t = smoothstep(next.top + 14, next.top - 6, y);
  return { a: LAYERS[k], b: next, t };
}

const TAU = Math.PI * 2;
export const normA = (a) => ((a % TAU) + TAU) % TAU;

export class Abyss {
  constructor(seed) {
    this.n3 = makeNoise3D(seed + 5);
    this.n3b = makeNoise3D(seed + 9);
    this.ledges = [];
  }

  // радиус стены на угле θ и высоте y
  wallR(theta, y) {
    const d = clamp((RIM_Y - y) / (RIM_Y - BOTTOM_Y), 0, 1);
    let r = R0 * (0.9 + 0.16 * Math.sin(d * Math.PI * 1.1) + 0.12 * smoothstep(0.82, 1, d));
    const c = Math.cos(theta), s = Math.sin(theta);
    r += 5.5 * this.n3(c * 1.6, s * 1.6, y / 38);
    r += 1.5 * this.n3b(c * 6 + 10, s * 6, y / 9);
    return r;
  }

  // ——— полки ———
  addLedge(L) {
    // L: { y, th1, span, depth, thick }
    L.th1 = normA(L.th1);
    L.seed = this.ledges.length * 7.3;
    this.ledges.push(L);
    return L;
  }
  ledgeU(L, theta) {           // 0..1 вдоль полки или -1, если угол вне её
    const d = normA(theta - L.th1);
    return d <= L.span ? d / L.span : -1;
  }
  ledgeDepth(L, u) {
    const taper = 0.3 + 0.7 * smoothstep(0, 0.14, u) * smoothstep(1, 0.86, u);
    return L.depth * taper * (0.9 + 0.1 * Math.sin(u * 23 + L.seed));
  }
  ledgeInner(L, theta, u) { return this.wallR(theta, L.y) - this.ledgeDepth(L, u); }

  // ——— опора под ногами: плато, полки, дно (доски и платформы проверяет descent) ———
  support(x, z, y, step = 0.35) {
    const r = Math.hypot(x, z), th = Math.atan2(x, z);
    let best = -1e9;
    // плато наверху
    if (y >= RIM_Y - 1.5 && r >= this.wallR(th, RIM_Y) - 0.05 && r <= R_OUT + 5) best = RIM_Y + this.plateauBump(x, z, r);
    // полки
    for (const L of this.ledges) {
      if (L.y > y + step || L.y < y - 3) continue;
      const u = this.ledgeU(L, th);
      if (u < 0) continue;
      if (r >= this.ledgeInner(L, th, u) && r <= this.wallR(th, L.y) + 0.3 && L.y > best) best = L.y;
    }
    // дно
    if (y < BOTTOM_Y + 4 && r <= this.wallR(th, BOTTOM_Y)) best = Math.max(best, BOTTOM_Y + this.floorBump(x, z, r));
    return best > -1e8 && best <= y + step ? best : null;
  }
  plateauBump(x, z, r) { return smoothstep(R0 + 10, R_OUT, r) * 3 * (0.5 + 0.5 * this.n3(x / 40, z / 40, 3)); }
  floorBump(x, z, r) { return 0.35 * this.n3b(x / 6, z / 6, 1) - 0.4 * smoothstep(14, 4, r); }

  // упереться в стену и в бока полок; true — ударились головой о низ полки
  collide(p, vel) {
    const r = Math.hypot(p.x, p.z), th = Math.atan2(p.x, p.z);
    let bumped = false;
    if (p.y < RIM_Y - 0.25) {
      const rmax = this.wallR(th, Math.min(RIM_Y, p.y + 0.9)) - PR;
      if (r > rmax) { const k = rmax / r; p.x *= k; p.z *= k; }
    } else if (r > R_OUT) { const k = R_OUT / r; p.x *= k; p.z *= k; }
    for (const L of this.ledges) {
      const bottom = L.y - L.thick;
      if (p.y >= L.y - 0.35 || p.y + PH <= bottom) continue;
      const u = this.ledgeU(L, th);
      if (u < 0) continue;
      const rin = this.ledgeInner(L, th, u);
      const rr = Math.hypot(p.x, p.z);
      if (rr < rin - PR) continue;
      // снизу в полку головой
      if (vel && vel.y > 0 && p.y + PH - vel.y * 0.03 <= bottom + 0.05) { p.y = bottom - PH; vel.y = 0; bumped = true; continue; }
      const k = (rin - PR) / rr;           // вытолкнуть к центру шахты
      p.x *= k; p.z *= k;
    }
    return bumped;
  }

  // точка внутри скалы? (для камеры и для проверки, видно ли кольцо)
  solid(x, y, z) {
    if (y < BOTTOM_Y - 0.4) return true;
    const r = Math.hypot(x, z), th = Math.atan2(x, z);
    if (y < RIM_Y) { if (r > this.wallR(th, y)) return true; }
    else if (y < RIM_Y + this.plateauBump(x, z, r) && r > this.wallR(th, RIM_Y)) return true;
    for (const L of this.ledges) {
      if (y > L.y || y < L.y - L.thick) continue;
      const u = this.ledgeU(L, th);
      if (u >= 0 && r >= this.ledgeInner(L, th, u)) return true;
    }
    return false;
  }
  clearLine(a, b, skipEnd = 0.6) {
    const len = a.distanceTo(b), n = Math.max(4, Math.ceil(len / 0.8));
    for (let i = 1; i < n; i++) {
      const u = i / n;
      if ((1 - u) * len < skipEnd) break;
      if (this.solid(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u)) return false;
    }
    return true;
  }

  // где стена рядом (для «хвата»): расстояние от героя до стены по горизонтали
  wallGap(p) {
    const r = Math.hypot(p.x, p.z), th = Math.atan2(p.x, p.z);
    return this.wallR(th, Math.min(RIM_Y - 0.3, p.y + 1.0)) - r;
  }
  // нормаль стены (смотрит внутрь шахты)
  wallNormal(theta, y, out = new THREE.Vector3()) {
    const e = 0.02, h = 0.6;
    const r = this.wallR(theta, y);
    const drT = (this.wallR(theta + e, y) - this.wallR(theta - e, y)) / (2 * e) / r;   // наклон по кругу
    const drY = (this.wallR(theta, y + h) - this.wallR(theta, y - h)) / (2 * h);        // нависание
    // наружу = (sinθ, 0, cosθ), вдоль = (cosθ, 0, -sinθ); нормаль внутрь
    const ox = Math.sin(theta), oz = Math.cos(theta), tx = Math.cos(theta), tz = -Math.sin(theta);
    return out.set(-ox + drT * tx, drY, -oz + drT * tz).normalize();
  }

  // ——— геометрия ———
  buildMeshes(material) {
    const group = new THREE.Group();
    group.add(...this.wallMeshes(material), this.plateauMesh(material), this.floorMesh(material), this.horizonMesh());
    for (const L of this.ledges) group.add(this.ledgeMesh(L, material));
    group.traverse((o) => { if (o.isMesh && o.material === material) { o.receiveShadow = true; o.castShadow = true; } });
    return group;
  }

  rockColor(y, k, c) {
    const m = layerMix(y);
    const a = new THREE.Color(m.a.rock).lerp(new THREE.Color(m.a.rock2), k);
    const b = new THREE.Color(m.b.rock).lerp(new THREE.Color(m.b.rock2), k);
    return c.copy(a).lerp(b, m.t);
  }
  mossColor(y, c) {
    const m = layerMix(y);
    return c.set(m.a.moss).lerp(_tc.set(m.b.moss), m.t);
  }
  groundColor(y, c) {
    const m = layerMix(y);
    return c.copy(new THREE.Color(m.a.ground)).lerp(new THREE.Color(m.b.ground), m.t);
  }

  // стена — сетка 200 × 157 вершин; режем на куски, чтобы не рисовать то, что не видно (и в тенях тоже)
  wallMeshes(material) {
    const NT = 200, top = RIM_Y + 0.6, bot = BOTTOM_Y - 1.5, NY = Math.ceil((top - bot) / 1.5);
    const pos = [], col = [], idx = [];
    const c = new THREE.Color(), cm = new THREE.Color(), rng = makeRng(77);
    for (let j = 0; j <= NY; j++) {
      const y = top - (j / NY) * (top - bot);
      for (let i = 0; i <= NT; i++) {
        const th = (i / NT) * TAU, r = this.wallR(th, y);
        pos.push(Math.sin(th) * r, y, Math.cos(th) * r);
        const cs = Math.cos(th), sn = Math.sin(th);
        this.rockColor(y, Math.min(1, Math.max(0, 0.5 + 0.4 * this.n3(cs * 3, sn * 3, y / 14) + 0.45 * this.n3b(cs * 11 + 7, sn * 11, y / 4))), c);
        // пятна мха и лишайника (в гротах — бирюзовые, на дне — фиолетовые)
        const moss = smoothstep(0.12, 0.42, this.n3b(cs * 5 + 3, sn * 5, y / 6)) * (0.55 + 0.45 * smoothstep(-0.2, 0.3, this.n3(cs * 9, sn * 9, y / 3 + 5)));
        c.lerp(this.mossColor(y, cm), moss * 0.7);
        const v = 0.9 + rng() * 0.16;
        col.push(c.r * v, c.g * v, c.b * v);
      }
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NT; i++) {
      const a = j * (NT + 1) + i, b = a + 1, cc = a + NT + 1, d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const P = pos, N = g.attributes.normal.array, C = col;
    // шов на угле 0 = 2π: одна нормаль на обе стороны
    for (let j = 0; j <= NY; j++) {
      const v0 = j * (NT + 1), v1 = v0 + NT;
      for (let k = 0; k < 3; k++) { const m = (N[v0 * 3 + k] + N[v1 * 3 + k]) / 2; N[v0 * 3 + k] = m; N[v1 * 3 + k] = m; }
    }
    const SEC = 10, BAND = 6, out = [];
    for (let a = 0; a < SEC; a++) for (let b = 0; b < BAND; b++) {
      const i0 = Math.floor((a * NT) / SEC), i1 = Math.floor(((a + 1) * NT) / SEC);
      const j0 = Math.floor((b * NY) / BAND), j1 = Math.floor(((b + 1) * NY) / BAND);
      const w = i1 - i0 + 1, cp = [], cn = [], cc = [], ci = [];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const v = (j * (NT + 1) + i) * 3;
        cp.push(P[v], P[v + 1], P[v + 2]); cn.push(N[v], N[v + 1], N[v + 2]); cc.push(C[v], C[v + 1], C[v + 2]);
      }
      for (let j = 0; j < j1 - j0; j++) for (let i = 0; i < i1 - i0; i++) {
        const q = j * w + i;
        ci.push(q, q + 1, q + w, q + 1, q + w + 1, q + w);
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
      cg.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3));
      cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
      cg.setIndex(ci);
      cg.computeBoundingSphere();
      out.push(new THREE.Mesh(cg, material));
    }
    g.dispose();
    return out;
  }

  plateauMesh(material) {
    const NT = 200, NR = 20, pos = [], col = [], idx = [];
    const c = new THREE.Color(), g1 = new THREE.Color('#7cbc52'), g2 = new THREE.Color('#5c9a42');
    for (let k = 0; k <= NR; k++) for (let i = 0; i <= NT; i++) {
      const th = (i / NT) * TAU, r0 = this.wallR(th, RIM_Y) - 0.05;
      const r = r0 + Math.pow(k / NR, 1.6) * (R_OUT + 30 - r0);
      const x = Math.sin(th) * r, z = Math.cos(th) * r;
      pos.push(x, RIM_Y + this.plateauBump(x, z, r) - (k === 0 ? 0.6 : 0), z);
      c.copy(g1).lerp(g2, 0.5 + 0.5 * this.n3(x / 25, z / 25, 5));
      if (k <= 1) c.lerp(new THREE.Color(LAYERS[0].rock), 0.6);
      col.push(c.r, c.g, c.b);
    }
    for (let k = 0; k < NR; k++) for (let i = 0; i < NT; i++) {
      const a = k * (NT + 1) + i, b = a + 1, cc = a + NT + 1, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
    return meshFrom(pos, col, idx, material);
  }

  floorMesh(material) {
    const NT = 160, NR = 22, pos = [], col = [], idx = [];
    const c = new THREE.Color();
    for (let k = 0; k <= NR; k++) for (let i = 0; i <= NT; i++) {
      const th = (i / NT) * TAU, rw = this.wallR(th, BOTTOM_Y) + 0.8, r = (k / NR) * rw;
      const x = Math.sin(th) * r, z = Math.cos(th) * r;
      pos.push(x, BOTTOM_Y + this.floorBump(x, z, r), z);
      this.groundColor(BOTTOM_Y, c).lerp(new THREE.Color('#2e4a5a'), 0.3 + 0.3 * this.n3(x / 9, z / 9, 7));
      col.push(c.r, c.g, c.b);
    }
    for (let k = 0; k < NR; k++) for (let i = 0; i < NT; i++) {
      const a = k * (NT + 1) + i, b = a + 1, cc = a + NT + 1, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
    return meshFrom(pos, col, idx, material);
  }

  // полка: верх (трава/мох) + лицевая сторона + низ, уходящий в стену
  ledgeMesh(L, material) {
    const n = Math.max(8, Math.ceil(L.span / 0.035));
    const pos = [], col = [], idx = [];
    const cG = this.groundColor(L.y, new THREE.Color()), cR = new THREE.Color(), cR2 = new THREE.Color(), cV = new THREE.Color();
    const cDry = cG.clone().lerp(new THREE.Color('#c9b06a'), 0.45), cLush = cG.clone().multiplyScalar(0.72).lerp(this.mossColor(L.y, new THREE.Color()), 0.35);
    this.rockColor(L.y, 0.3, cR); this.rockColor(L.y, 0.85, cR2);
    // профиль сечения: от стены сверху → внутренний край → вниз → обратно в стену
    const prof = [[1.0, 0, 'g'], [0.55, 0.03, 'g'], [0.0, 0, 'g'], [-0.08, -0.35, 'r'], [0.05, -0.8, 'r'], [0.5, -1.0, 'r2'], [1.15, -1.25, 'r2']];
    const S = prof.length;
    for (let i = 0; i <= n; i++) {
      const u = i / n, th = L.th1 + u * L.span;
      const rw = this.wallR(th, L.y) + 0.7, rin = this.ledgeInner(L, th, u), dep = rw - rin;
      const bump = 0.12 * Math.sin(u * 37 + L.seed);
      for (const [f, dy, kind] of prof) {
        const r = rin + f * dep, y = L.y + dy * L.thick + (kind === 'g' ? bump * (1 - f) : 0) - (f === 1.0 && kind === 'g' ? 0.05 : 0);
        const x = Math.sin(th) * r, z = Math.cos(th) * r;
        pos.push(x, y, z);
        let c = kind === 'g' ? cG : kind === 'r' ? cR : cR2;
        if (kind === 'g') {
          // пятна: посветлее, посуше, с мхом — чтобы верх полки не был одним цветом
          const n = this.n3(x / 3.5, z / 3.5, L.seed);
          c = cV.copy(cG).lerp(n > 0 ? cDry : cLush, Math.min(1, Math.abs(n) * 1.6));
        }
        const v = 0.9 + 0.15 * Math.sin(i * 1.7 + f * 5);
        col.push(c.r * v, c.g * v, c.b * v);
      }
    }
    for (let i = 0; i < n; i++) for (let k = 0; k < S - 1; k++) {
      const a = i * S + k, b = a + 1, cc = a + S, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
    // торцы
    for (const i of [0, n]) {
      const base = i * S;
      for (let k = 1; k < S - 1; k++) i === 0 ? idx.push(base, base + k, base + k + 1) : idx.push(base, base + k + 1, base + k);
    }
    return meshFrom(pos, col, idx, material);
  }

  // далёкие холмы вокруг — видно с плато, в дымке
  horizonMesh() {
    const NT = 96, pos = [], col = [], idx = [];
    const c1 = new THREE.Color('#8fa79a'), c2 = new THREE.Color('#b9c9c2');
    for (let i = 0; i <= NT; i++) {
      const th = (i / NT) * TAU, h = 25 + 45 * (0.5 + 0.5 * this.n3(Math.cos(th) * 2, Math.sin(th) * 2, 11));
      for (const [r, y, c] of [[340, -10, c1], [380, h, c2], [430, 0, c2]]) { pos.push(Math.sin(th) * r, y, Math.cos(th) * r); col.push(c.r, c.g, c.b); }
    }
    for (let i = 0; i < NT; i++) for (let k = 0; k < 2; k++) {
      const a = i * 3 + k, b = a + 1, cc = a + 3, d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    return meshFrom(pos, col, idx, m);
  }
}

const _tc = new THREE.Color();

function meshFrom(pos, col, idx, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}
