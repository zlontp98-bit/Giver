// «Формула мира»: для любой точки (x, y, z) — примерное расстояние до скалы (SDF).
// f > 0 — воздух, f < 0 — камень. Из неё при сборке строятся куски мира (tools/bake-world.mjs),
// а в игре по ней же считаются опора под ногами, столкновения, лазание, прицел крюка и камера.
//
// Мир = основа (холмистая земля наверху + Бездна неровной формы с дном) + детали: плато, уступы,
// столбы, нависающие скалы (камень) и пещеры, тоннели, расщелины, русла (воздух). Детали лежат в
// сетке 32×32 м, поэтому в каждой точке считаются только ближние.
//
// Файл без three.js — его использует и сборка (Node), и игра.
import { makeNoise2D, makeNoise3D, clamp, smoothstep } from '../core/noise.js';

export const PIT_DEPTH = 205;            // глубина первого яруса (дно ~ −205 м)
const GRID = 32, GRID_OFF = 1024;        // сетка деталей: клетка 32 м

export function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
export function smax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }
const TAU = Math.PI * 2;
export const normA = (a) => ((a % TAU) + TAU) % TAU;

// opt.rift — форма «разлом» (демоверсия): не круглая шахта, а вытянутая с запада на восток трещина с заливами
// и мысами; стена идёт ступенями — полками на разной высоте (слои пород наклонены, ширина полок меняется,
// под полками бывают нависания), с рёбрами-контрфорсами и глыбами с плоскими гранями. Чем ниже — тем уже.
// Всё, что зависит только от угла, посчитано заранее таблицами — формула не дороже прежней.
const RIFT_N = 1024;
const BENCH_Y = [-16, -40, -68, -102, -145];            // средняя высота полок-ступеней
export class SdfWorld {
  constructor(seed, opt = {}) {
    this.seed = seed;
    this.n2 = makeNoise2D(seed + 1);
    this.n2b = makeNoise2D(seed + 2);
    this.n3 = makeNoise3D(seed + 3);
    this.n3b = makeNoise3D(seed + 4);
    this.features = [];
    this.grid = new Map();
    this.flats = [];          // ровные места на земле: { x, z, r, soft, h }
    this.river = null;        // русло реки наверху: { pts: [[x, z], …], half, depth }
    this.rift = !!opt.rift;
    this.pitMax = this.rift ? 300 : 262;     // дальше от центра Бездны нет
    if (this.rift) this.buildRift(opt.benchBoost || []);
  }

  // ——— таблицы разлома по углу ———
  // benchBoost: [{ th, width, k, extra }] — где полка должна быть шире (у посёлка, под водопадом)
  buildRift(boost) {
    const N = RIFT_N, n2 = this.n2, nb = this.n2b;
    const per = (th, f, ox, oz, fn = n2) => fn(Math.cos(th) * f + ox, Math.sin(th) * f + oz);   // шум по кругу (без шва)
    this.R0 = new Float32Array(N + 1);
    this.LIP = new Float32Array(N + 1);
    this.BY = BENCH_Y.map(() => new Float32Array(N + 1));
    this.BD = BENCH_Y.map(() => new Float32Array(N + 1));
    this.BU = BENCH_Y.map(() => new Float32Array(N + 1));
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TAU, s = Math.sin(th), c = Math.cos(th);
      const north = Math.exp(-((c + 1) * (c + 1) + s * s) / 0.5);
      // контур: вытянут с запада на восток, большие заливы и мысы
      let R = 168 + 58 * s * s + 26 * per(th, 1.15, 3, 1) + 11 * per(th, 3.1, 7, 5, nb) + 4 * per(th, 7.3, 1, 9);
      this.R0[i] = Math.min(268, R);
      // нависающий край местами (у посёлка — меньше, у водопада — нет: там река срывается с края)
      let lip = Math.max(0, per(th, 2.4, 11, 2, nb)) * 9 * (1 - 0.6 * north);
      for (const b of boost) if (b.noLip) lip *= 1 - smoothstep(b.span, b.span * 0.4, Math.abs(Math.atan2(Math.sin(th - b.th), Math.cos(th - b.th))));
      this.LIP[i] = lip;
      for (let k = 0; k < BENCH_Y.length; k++) {
        // слои наклонены (ступени не кольцами): смещение по высоте — шум + наклон
        this.BY[k][i] = BENCH_Y[k] + (5 + k * 1.6) * per(th, 1.7, k * 3.1, 2 - k, nb) + (3 + k) * Math.sin(th * 1 + k * 1.9);
        let d = 1.5 + 15 * smoothstep(-0.35, 0.55, per(th, 2.3, k * 7.7 + 1, k * 2.3));
        let u = Math.max(0, per(th, 1.9, k * 11 + 4, 3, nb)) * (3 + k);
        for (const b of boost) {
          if (b.k !== k) continue;
          const da = Math.abs(Math.atan2(Math.sin(th - b.th), Math.cos(th - b.th)));
          const w = smoothstep(b.span, b.span * 0.4, da);
          d = d + (b.width - d) * w * (b.width > d ? 1 : 0);
          if (b.y !== undefined) this.BY[k][i] += (b.y - this.BY[k][i]) * w;
          u *= 1 - w * (b.noUnder ? 1 : 0);
        }
        this.BD[k][i] = d;
        this.BU[k][i] = u;
      }
    }
  }
  // значение таблицы по углу (с плавным переходом между соседними)
  tab(T, th) {
    const u = (normA(th) / TAU) * RIFT_N, i = Math.floor(u), f = u - i;
    return T[i] + (T[i + 1] - T[i]) * f;
  }
  // полка-ступень k у угла th: { y — верх, d — ширина }
  bench(th, k) { return { y: this.tab(this.BY[k], th), d: this.tab(this.BD[k], th) }; }

  riftR(c, s, y) {
    const th = Math.atan2(s, c);
    let R = this.tab(this.R0, th) - 0.1 * Math.max(0, -y);
    for (let k = 0; k < BENCH_Y.length; k++) {
      const yk = this.tab(this.BY[k], th);
      if (y > yk + 1.2) break;                                       // полки ниже — ещё не начались
      R -= this.tab(this.BD[k], th) * smoothstep(yk + 1.0, yk - 1.0, y);
      const u = this.tab(this.BU[k], th);
      if (u > 0.05) R += u * smoothstep(yk - 0.6, yk - 3.5, y) * smoothstep(yk - 15, yk - 7, y);   // нависание под полкой
    }
    // мысы и заливы, меняются с глубиной медленно
    R += 15 * this.n3(c * 2.0 + 5, s * 2.0, y / 140);
    // рёбра-контрфорсы (вертикальные), острые гребни
    const rib = this.n3(c * 8.5 + 1, s * 8.5, y / 70);
    R += 5.5 * (1 - 2 * Math.abs(rib));
    // глыбы с плоскими гранями: шум «ступеньками» — вертикальные грани и горизонтальные полочки
    const q = this.n3b(c * 4.6, s * 4.6 + 2, y / 17) * 2.6, fl = Math.floor(q);
    R += 4.2 * (fl + smoothstep(0.32, 0.68, q - fl)) / 2.6;
    R += 1.2 * this.n3b(c * 15, s * 15 + 4, y / 6.5);
    // нависающий край у самого верха
    R -= this.tab(this.LIP, th) * smoothstep(-15, -2.5, y);
    return R;
  }

  // ——— земля наверху ———
  terrainH(x, z) {
    const r = Math.hypot(x, z);
    let h = 2.2 * this.n2(x / 70, z / 70) + 0.9 * this.n2b(x / 23 + 7, z / 23 - 3);
    h += 26 * smoothstep(300, 470, r) * (0.55 + 0.45 * this.n2(x / 150 + 20, z / 150));
    for (const fz of this.flats) {
      const d = Math.hypot(x - fz.x, z - fz.z);
      if (d < fz.r + fz.soft) h += (fz.h - h) * smoothstep(fz.r + fz.soft, fz.r, d);
    }
    if (this.river) {
      const d = this.riverDist(x, z);
      if (d < this.river.half + 10) h -= this.river.depth * (1 - smoothstep(this.river.half, this.river.half + 10, d));
    }
    return h;
  }

  riverDist(x, z) {
    const P = this.river.pts;
    let best = 1e9;
    for (let i = 1; i < P.length; i++) {
      const ax = P[i - 1][0], az = P[i - 1][1], bx = P[i][0] - ax, bz = P[i][1] - az;
      const t = clamp(((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz), 0, 1);
      best = Math.min(best, Math.hypot(x - ax - bx * t, z - az - bz * t));
    }
    return best;
  }

  // ——— Бездна: радиус стены по направлению (c = cos θ, s = sin θ) и высоте ———
  // θ = atan2(x, z): юг (+z) — 0, восток (+x) — π/2, север (−z) — π
  pitR(c, s, y) {
    if (this.rift) return this.riftR(c, s, y);
    const dep = clamp(-y / PIT_DEPTH, 0, 1);
    let R = 194 - 26 * dep;
    R *= 1 + 0.07 * (c * c - s * s) + 0.05 * (2 * c * s);                // чуть вытянутая, не круглая
    const north = Math.exp(-((c + 1) * (c + 1) + s * s) / 0.35);      // у посёлка край ровнее
    R += (1 - 0.8 * north) * 24 * this.n3(c * 1.05 + 3, s * 1.05, y / 170);   // большие заливы
    R += 8 * this.n3b(c * 2.6 + 9, s * 2.6, y / 75);
    R += 6.5 * this.n3(c * 7 + 2, s * 7, y / 150);                     // вертикальные рёбра скал
    R += 3.0 * this.n3b(c * 18 + 5, s * 18, y / 22);                   // глыбы и выступы
    R += 1.5 * this.n3b(c * 15, s * 15 + 4, y / 8);                    // мелкие неровности и полочки
    // местами верх стены нависает над пропастью
    const lip = Math.max(0, this.n3b(c * 2.2, s * 2.2 + 11, 4.2)) * 11 * (1 - north);
    R -= lip * smoothstep(-16, -3, y);
    return R;
  }
  wallR(x, z, y) {
    const r = Math.hypot(x, z) + 1e-9;
    return this.pitR(z / r, x / r, y);
  }

  floorH(x, z) {
    return -PIT_DEPTH + 2.5 * this.n2(x / 45, z / 45) + 1.2 * this.n2b(x / 15, z / 15);
  }

  // основа без деталей
  base(x, y, z) {
    let d = y - this.terrainH(x, z);
    const r = Math.hypot(x, z) + 1e-9;
    if (r < this.pitMax) {
      const air = Math.min(this.pitR(z / r, x / r, y) - r, y - this.floorH(x, z));
      d = smax(d, air, 3.0);
    }
    return d;
  }

  // ——— детали ———
  // feature: { air: bool, k: сглаживание, x0, z0, x1, z1, y0, y1 (границы), sd(x, y, z) }
  // У камня sd < 0 внутри, у воздуха sd > 0 внутри.
  add(ft) {
    ft.k = ft.k || 2;
    const m = ft.k + 4;
    ft.y0 -= m; ft.y1 += m;
    const gx0 = Math.floor((ft.x0 - m + GRID_OFF) / GRID), gx1 = Math.floor((ft.x1 + m + GRID_OFF) / GRID);
    const gz0 = Math.floor((ft.z0 - m + GRID_OFF) / GRID), gz1 = Math.floor((ft.z1 + m + GRID_OFF) / GRID);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const key = gx * 4096 + gz;
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(ft);
      list.sort((a, b) => (a.air === b.air ? a.order - b.order : a.air ? 1 : -1));   // сначала камень, потом воздух
    }
    ft.order = this.features.length;
    this.features.push(ft);
    return ft;
  }

  f(x, y, z) {
    let d = this.base(x, y, z);
    const list = this.grid.get(Math.floor((x + GRID_OFF) / GRID) * 4096 + Math.floor((z + GRID_OFF) / GRID));
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const ft = list[i];
        if (y < ft.y0 || y > ft.y1) continue;
        const v = ft.sd(x, y, z);
        d = ft.air ? smax(d, v, ft.k) : smin(d, v, ft.k);
      }
    }
    return d;
  }

  // нормаль (наружу из камня) — по четырём точкам
  normal(x, y, z, out, e = 0.25) {
    const a = this.f(x + e, y - e, z - e), b = this.f(x - e, y - e, z + e);
    const c = this.f(x - e, y + e, z - e), d = this.f(x + e, y + e, z + e);
    let nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
    const l = Math.hypot(nx, ny, nz) || 1;
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  // луч до скалы (шагами по расстоянию); вернёт расстояние или -1
  // луч до скалы: t (или −1). hit — «толщина» луча: с 0.5 луч цепляет скалу, пройдя рядом (удобно целиться).
  // Шаг не больше 2.5 м: детали считаются только в своих коробках, и вдали от них f бывает завышено —
  // без предела луч перепрыгивал плато и столбы.
  raycast(ox, oy, oz, dx, dy, dz, maxT, minStep = 0.05, hit = 0.04) {
    let t = 0;
    for (let i = 0; i < 240 && t < maxT; i++) {
      const h = this.f(ox + dx * t, oy + dy * t, oz + dz * t);
      if (h < hit) return t;
      t += Math.min(2.5, Math.max(h * 0.9, minStep));
    }
    return -1;
  }

  // ——— строители деталей ———
  // плита-плато: контур — эллипс (с шумом), верх и низ — функции; низ уходит в стену (нависание)
  slab({ cx, cz, rx, rz, rot = 0, top, bottom, k = 4, edge = 5, yMin, yMax }) {
    const cr = Math.cos(rot), sr = Math.sin(rot), m = Math.min(rx, rz), R = Math.max(rx, rz);
    const n = this.n2b;
    return this.add({
      air: false, k, x0: cx - R, x1: cx + R, z0: cz - R, z1: cz + R, y0: yMin, y1: yMax,
      sd: (x, y, z) => {
        const lx = (x - cx) * cr + (z - cz) * sr, lz = -(x - cx) * sr + (z - cz) * cr;
        const e = (Math.hypot(lx / rx, lz / rz) - 1) * m + edge * n(x / 30 + 40, z / 30);
        const T = top(x, z);
        return Math.max(e, y - T, bottom(x, z, T) - y);
      },
    });
  }

  // полка вдоль стены Бездны: от угла th0 на span радиан, верх идёт от y0 к y1
  ledge({ th0, span, y0, y1, depth, thick = 3.2, k = 2.0 }) {
    const self = this, n = this.n2;
    th0 = normA(th0);
    // границы по сетке: пройдём по дуге
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i <= 16; i++) {
      const th = th0 + (span * i) / 16, y = y0 + ((y1 - y0) * i) / 16;
      const c = Math.cos(th), s = Math.sin(th), R = self.pitR(c, s, y);
      for (const rr of [R + 4, R - depth - 4]) { x0 = Math.min(x0, s * rr); x1 = Math.max(x1, s * rr); z0 = Math.min(z0, c * rr); z1 = Math.max(z1, c * rr); }
    }
    return this.add({
      air: false, k, x0, x1, z0, z1, y0: Math.min(y0, y1) - thick - 40, y1: Math.max(y0, y1) + 2,
      sd: (x, y, z) => {
        const r = Math.hypot(x, z) + 1e-9, th = Math.atan2(x, z);
        const d = normA(th - th0);
        let ang, u;
        if (d <= span) { u = d / span; ang = -Math.min(d, span - d) * r; } else { u = d - span < TAU - d ? 1 : 0; ang = Math.min(d - span, TAU - d) * r; }
        const top = y0 + (y1 - y0) * u + 0.3 * n(x / 9, z / 9);
        const taper = 0.35 + 0.65 * smoothstep(0, 0.12, u) * smoothstep(1, 0.88, u);
        const inner = self.pitR(z / r, x / r, top) - depth * taper;
        const e = Math.max(inner - r, ang);
        // снизу полка толще к стене (клин), но не настолько, чтобы слиться с полкой этажом ниже
        const bottom = top - thick - 0.9 * Math.max(0, r - inner) + 1.2 * n(x / 7 + 9, z / 7);
        return Math.max(e, y - top, bottom - y);
      },
    });
  }

  // каменный столб с ровной верхушкой: неровный, чуть наклонённый, книзу толще
  pillar({ x, z, r, top, bottom = -PIT_DEPTH - 10, k = 3, lean = 0.05, leanDir = 0 }) {
    if (this.rift) return this.crag({ x, z, r, top, bottom, k, lean, leanDir });
    const n = this.n3, nb = this.n3b, lx = Math.cos(leanDir) * lean, lz = Math.sin(leanDir) * lean;
    return this.add({
      air: false, k, x0: x - r * 2.2 - 12, x1: x + r * 2.2 + 12, z0: z - r * 2.2 - 12, z1: z + r * 2.2 + 12, y0: bottom, y1: top + 2,
      sd: (px, y, pz) => {
        const h = top - y, cx = x + lx * h, cz = z + lz * h;
        const d = Math.hypot(px - cx, pz - cz);
        const a = Math.atan2(px - cx, pz - cz);
        const rad = r * (1 + 0.28 * n(Math.cos(a) * 1.3, y / 16, Math.sin(a) * 1.3) + 0.1 * nb(Math.cos(a) * 3, y / 5, Math.sin(a) * 3))
          * (1 + 0.55 * smoothstep(top - 25, bottom, y));
        return Math.max(d - rad, y - top - 0.6 * n(px / 5, pz / 5, 2), bottom - y);
      },
    });
  }

  // скала-останец (для «разлома»): многогранник (5–7 граней, грани поворачиваются с высотой), ярусами —
  // уступы-«пояса» на разной высоте, книзу толще, с отколотыми гранями. Не цилиндр.
  crag({ x, z, r, top, bottom, k = 2, lean = 0.05, leanDir = 0 }) {
    const n = this.n3, nb = this.n3b, lx = Math.cos(leanDir) * lean, lz = Math.sin(leanDir) * lean;
    const sides = 5 + Math.floor(Math.abs(n(x / 50, z / 50, 1)) * 3), seg = TAU / sides, rot0 = x * 0.37 + z * 0.11;
    return this.add({
      air: false, k, x0: x - r * 2.4 - 14, x1: x + r * 2.4 + 14, z0: z - r * 2.4 - 14, z1: z + r * 2.4 + 14, y0: bottom, y1: top + 3,
      sd: (px, y, pz) => {
        const h = top - y, cx = x + lx * h, cz = z + lz * h;
        const dx = px - cx, dz = pz - cz, d = Math.hypot(dx, dz);
        const tier = Math.floor(h / 13 + 0.6 * nb(x / 9, y / 30, z / 9));                     // пояса по высоте
        const a = Math.atan2(dx, dz) - rot0 - tier * 0.45;
        const am = ((a % seg) + seg) % seg - seg / 2;
        const poly = Math.cos(seg / 2) / Math.cos(am);                                      // многоугольник
        const rad = r * (1 + 0.12 * tier * 0.25 + 0.22 * smoothstep(top - 18, bottom, y))
          * (1 + 0.16 * n(Math.cos(a) * 1.2, y / 22, Math.sin(a) * 1.2)) * (1 + 0.05 * Math.sin(tier * 2.3));
        const side = d / poly - rad;
        const cap = y - top - 0.8 * n(px / 6, pz / 6, 2);
        return Math.max(side, cap, bottom - y);
      },
    });
  }

  // природный каменный мост по дуге a → b (провисает на sag метров), толщина r
  arch(a, b, { r = 4, sag = 6, k = 3 } = {}) {
    const n = this.n3, pts = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]);
    }
    const x0 = Math.min(a[0], b[0]) - r - 4, x1 = Math.max(a[0], b[0]) + r + 4, z0 = Math.min(a[2], b[2]) - r - 4, z1 = Math.max(a[2], b[2]) + r + 4;
    return this.add({
      air: false, k, x0, x1, z0, z1, y0: Math.min(a[1], b[1]) - sag - r * 2, y1: Math.max(a[1], b[1]) + r,
      sd: (x, y, z) => {
        let best = 1e9;
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i - 1], q = pts[i], bx = q[0] - p[0], by = q[1] - p[1], bz = q[2] - p[2];
          const t = clamp(((x - p[0]) * bx + (y - p[1]) * by + (z - p[2]) * bz) / (bx * bx + by * by + bz * bz), 0, 1);
          // сечение: снизу толще, сверху почти плоско (по нему можно идти)
          const dx = x - p[0] - bx * t, dy = y - p[1] - by * t, dz = z - p[2] - bz * t;
          const d = Math.hypot(dx, dy > 0 ? dy * 2.2 : dy * 0.75, dz);
          best = Math.min(best, d);
        }
        return best - r * (1 + 0.25 * n(x / 9, y / 9, z / 9));
      },
    });
  }

  // тоннель (воздух): ломаная по точкам пола, высота свода ~4 м, пол ровный
  tunnel(pts, { rad = 3.4, axis = 1.7, k = 1.5 } = {}) {
    const fts = [], n = this.n3;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], L2 = bx * bx + by * by + bz * bz;
      fts.push(this.add({
        air: true, k, x0: Math.min(a[0], b[0]) - rad, x1: Math.max(a[0], b[0]) + rad, z0: Math.min(a[2], b[2]) - rad, z1: Math.max(a[2], b[2]) + rad,
        y0: Math.min(a[1], b[1]) - 1, y1: Math.max(a[1], b[1]) + axis + rad,
        sd: (x, y, z) => {
          const t = clamp(((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / L2, 0, 1);
          const qx = a[0] + bx * t, qy = a[1] + by * t, qz = a[2] + bz * t;
          const inside = rad * (1 + 0.18 * n(x / 4, y / 4, z / 4)) - Math.hypot(x - qx, (y - qy - axis) * 1.15, z - qz);
          return Math.min(inside, y - qy);
        },
      }));
    }
    return fts;
  }

  // пещера (воздух): эллипсоид с ровным полом
  cave({ x, y, z, rx, ry, rz, floor = null, k = 2 }) {
    const m = Math.min(rx, ry, rz), fl = floor === null ? y - ry * 0.55 : floor;
    return this.add({
      air: true, k, x0: x - rx, x1: x + rx, z0: z - rz, z1: z + rz, y0: y - ry, y1: y + ry,
      sd: (px, py, pz) => Math.min((1 - Math.hypot((px - x) / rx, (py - y) / ry, (pz - z) / rz)) * m, py - fl),
    });
  }

  // расщелина (воздух): узкая щель в стене, повёрнута на угол th (вдоль радиуса)
  crevice({ th, rIn, rOut, width, yTop, yBot, k = 2 }) {
    const c = Math.cos(th), s = Math.sin(th), n = this.n3;
    const xs = [s * rIn, s * rOut], zs = [c * rIn, c * rOut];
    const pad = width + 6;
    return this.add({
      air: true, k, x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, z0: Math.min(...zs) - pad, z1: Math.max(...zs) + pad, y0: yBot, y1: yTop,
      sd: (x, y, z) => {
        const along = x * s + z * c, across = x * c - z * s;     // вдоль радиуса и поперёк
        const w = width * 0.5 * (1 + 0.35 * n(along / 12, y / 18, 5)) * (0.55 + 0.45 * smoothstep(yBot, yBot + 40, y));
        const a1 = w - Math.abs(across + 2.5 * n(along / 20, y / 25, 9));
        const a2 = Math.min(along - rIn, rOut - along);
        return Math.min(a1, a2, yTop - y, y - yBot);
      },
    });
  }

  // русло (воздух): неглубокая канава по ломаной (x, z) на высоте dno(x, z)
  channel(pts, { half = 3.5, depth = 1.2, k = 1.5, yMin, yMax }) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
    return this.add({
      air: true, k, x0: x0 - half, x1: x1 + half, z0: z0 - half, z1: z1 + half, y0: yMin, y1: yMax,
      sd: (x, y, z) => {
        let best = 1e9, by = 0;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], bx = b[0] - a[0], bz = b[2] - a[2];
          const t = clamp(((x - a[0]) * bx + (z - a[2]) * bz) / (bx * bx + bz * bz), 0, 1);
          const d = Math.hypot(x - a[0] - bx * t, z - a[2] - bz * t);
          if (d < best) { best = d; by = a[1] + (b[1] - a[1]) * t; }
        }
        // профиль: плоское дно шириной half, края пологие
        const bottom = by - depth * (1 - smoothstep(half * 0.6, half, best));
        return Math.min(half + 1.5 - best, y - bottom);
      },
    });
  }
}
