// Плато и Разлом: земля вокруг (сетка с мелким шагом у поселения и крупным вдали), неровные стены разлома
// (уступы, нависания, впадины), столовые горы и колонны внутри, природные арки.
// Разлом — не цилиндр: край — вытянутый неровный овал (150 × 225 м) с мысом-смотровой у поселения,
// профиль стены везде свой (наклон, ступени-уступы, нависающие выступы, впадины).
import * as THREE from 'three';
import { makeNoise2D, makeNoise3D, fbm, smoothstep, clamp, makeRng } from '../../src/noise.js';

export const C = { x: 0, z: -210 };          // центр разлома
const A = 150, B = 225;                        // полуоси края
export const DEPTH = 330;                      // до куда рисуем стены (ниже — сплошной туман)
const n2 = makeNoise2D(7), n2b = makeNoise2D(23), n3 = makeNoise3D(11);
const TAU = Math.PI * 2;
export const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
export const thetaOf = (x, z) => Math.atan2(x - C.x, z - C.z);   // θ = 0 → к поселению (+z)

// ——— край разлома: радиус в направлении θ ———
export function rimR(th) {
  const s = Math.sin(th), c = Math.cos(th);
  const base = 1 / Math.sqrt((s * s) / (A * A) + (c * c) / (B * B));
  const d = Math.abs(angDiff(th, 0));
  const calm = smoothstep(0.12, 0.42, d);                 // у поселения край ровнее (его видно вблизи)
  const k = 1 + (0.11 * n2(c * 2.2 + 5, s * 2.2) + 0.045 * n2(c * 7, s * 7 + 3)) * (0.25 + 0.75 * calm);
  return base * k - 13 * Math.exp(-((d / 0.055) ** 2));   // мыс со смотровой площадкой
}
export const rimPoint = (th, inset = 0) => { const r = rimR(th) - inset; return { x: C.x + Math.sin(th) * r, z: C.z + Math.cos(th) * r }; };
// > 0 — на плато (на столько метров от края), < 0 — над пропастью
export function rimDist(x, z) { return Math.hypot(x - C.x, z - C.z) - rimR(thetaOf(x, z)); }

// ——— ручей: течёт с холмов через край поселения и падает в разлом водопадом ———
export const STREAM = [[-62, 150], [-56, 115], [-50, 85], [-46, 60], [-44, 38], [-41, 22], [-39, 8]];
function distToPolyline(x, z, P) {
  let best = 1e9;
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// ——— высота плато ———
let flatZones = [];       // [{x, z, r}] — площадки под домами (задаёт village.js)
export function setFlatZones(z) { flatZones = z; }
export function groundBase(x, z) {
  let h = 0.9 * fbm(n2b, x / 45, z / 45, 3) + 0.25 * n2b(x / 9 + 7, z / 9);
  // поселение и дорожка почти ровные
  const v = Math.hypot((x - 0) / 48, (z - 42) / 44);
  h *= 0.35 + 0.65 * smoothstep(0.7, 1.3, v);
  // холмы за поселением и подальше от края
  const rd = rimDist(x, z);
  h += 16 * smoothstep(85, 210, z) * (0.6 + 0.4 * fbm(n2, x / 70, z / 70, 3));
  h += 10 * smoothstep(50, 170, rd) * (0.5 + 0.5 * fbm(n2, x / 90 + 3, z / 90, 3));
  // дальние края разлома ниже нашего — со смотровой видно далеко вниз и вдаль
  h -= 26 * smoothstep(0.55, 1.5, Math.abs(thetaOf(x, z))) * (1 - smoothstep(120, 220, rd));
  // к самому краю — лёгкий подъём (бровка)
  h += 0.5 * smoothstep(6, 0, rd);
  return h;
}
export function groundH(x, z) {
  let h = groundBase(x, z);
  for (const f of flatZones) {
    const d = Math.hypot(x - f.x, z - f.z);
    h += (f.h - h) * smoothstep(f.r + 4, f.r, d);
  }
  const ds = distToPolyline(x, z, STREAM);
  h -= 1.3 * Math.exp(-((ds / 2.4) ** 2));
  return h;
}
export const streamDist = (x, z) => distToPolyline(x, z, STREAM);

// ——— цвета ———
const col = (h) => new THREE.Color(h);
const ROCK_TOP = col('#a08c76'), ROCK_MID = col('#5f7398'), ROCK_DEEP = col('#544e92');
const MOSS = col('#6f9a44'), MOSS_DEEP = col('#3f7f72'), GRASS = col('#6aa63e'), GRASS2 = col('#8bb848'), DIRT = col('#9a7a58');
function rockColor(depth, ny, wx, wy, wz, out) {
  const t1 = smoothstep(4, 70, depth), t2 = smoothstep(90, 220, depth);
  out.copy(ROCK_TOP).lerp(ROCK_MID, t1).lerp(ROCK_DEEP, t2);
  const v = 0.85 + 0.3 * (0.5 + 0.5 * n3(wx / 14, wy / 9, wz / 14));
  out.multiplyScalar(v);
  // мох на ровных местах и пятнами на верхней части стен
  const flat = smoothstep(0.55, 0.8, ny);
  const streak = smoothstep(0.25, 0.7, n3(wx / 18 + 4, wy / 30, wz / 18)) * smoothstep(60, 5, depth) * 0.6;
  const moss = Math.max(flat, streak);
  if (moss > 0) out.lerp(MOSS.clone().lerp(MOSS_DEEP, smoothstep(20, 120, depth)), moss);
  return out;
}

// ——— сетка: заполняем позиции, считаем нормали по соседям, собираем индексы ———
function gridNormals(P, cols, rows, wrap) {
  const N = new Float32Array(P.length);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3();
  const at = (i, k, v) => { if (wrap) i = (i + cols) % cols; else i = clamp(i, 0, cols - 1); k = clamp(k, 0, rows - 1); const j = (k * cols + i) * 3; return v.set(P[j], P[j + 1], P[j + 2]); };
  for (let k = 0; k < rows; k++) for (let i = 0; i < cols; i++) {
    at(i + 1, k, a); at(i - 1, k, b); at(i, k + 1, c); at(i, k - 1, d);
    a.sub(b); c.sub(d);
    n.crossVectors(a, c).normalize();
    N.set([n.x, n.y, n.z], (k * cols + i) * 3);
  }
  return N;
}

// ——— плато ———
function coords(min, max, fMin, fMax, step, maxStep) {
  const out = [];
  for (let x = fMin; x <= fMax + 1e-6; x += step) out.push(x);
  let s = step, x = fMin;
  while (x > min) { s = Math.min(maxStep, s * 1.12); x -= s; out.unshift(Math.max(min, x)); }
  s = step; x = out[out.length - 1];
  while (x < max) { s = Math.min(maxStep, s * 1.12); x += s; out.push(Math.min(max, x)); }
  return out;
}
const LIP = 1.4;   // на сколько плато заходит за край стены (бровка с травой прикрывает шов)
export function buildPlateau(dirtAt) {
  const xs = coords(-330, 330, -90, 90, 2.0, 16), zs = coords(-590, 250, -24, 150, 2.0, 16);
  const cols = xs.length, rows = zs.length;
  const P = new Float32Array(cols * rows * 3), inside = new Uint8Array(cols * rows);
  for (let k = 0; k < rows; k++) for (let i = 0; i < cols; i++) {
    let x = xs[i], z = zs[k];
    const j = k * cols + i;
    if (rimDist(x, z) < -LIP) {      // над пропастью: прижимаем к краю (ровная кромка вместо «пилы» крупной сетки)
      inside[j] = 1;
      const th = thetaOf(x, z), r = rimR(th) - LIP;
      x = C.x + Math.sin(th) * r; z = C.z + Math.cos(th) * r;
    }
    P.set([x, groundH(x, z), z], j * 3);
  }
  const N = gridNormals(P, cols, rows, false);
  for (let j = 0; j < cols * rows; j++) if (N[j * 3 + 1] < 0) { N[j * 3] *= -1; N[j * 3 + 1] *= -1; N[j * 3 + 2] *= -1; }
  const Cc = new Float32Array(P.length), c = new THREE.Color(), tmp = new THREE.Color();
  for (let j = 0; j < cols * rows; j++) {
    const x = P[j * 3], y = P[j * 3 + 1], z = P[j * 3 + 2];
    const g = 0.5 + 0.5 * fbm(n2, x / 16, z / 16, 3);
    c.copy(GRASS).lerp(GRASS2, smoothstep(0.35, 0.75, g));
    c.multiplyScalar(0.88 + 0.2 * n2b(x / 4, z / 4));
    const dirt = dirtAt ? dirtAt(x, z) : 0;
    if (dirt > 0) c.lerp(tmp.copy(DIRT).multiplyScalar(0.9 + 0.2 * g), dirt);
    const rd = rimDist(x, z);
    if (rd < 2.5) c.lerp(tmp.copy(ROCK_TOP), smoothstep(2.5, -LIP, rd) * 0.5);
    if (streamDist(x, z) < 3.2) c.lerp(tmp.set('#5d6d5a'), smoothstep(3.2, 1.5, streamDist(x, z)));
    Cc.set([c.r, c.g, c.b], j * 3);
  }
  // плитки ~110 м: позади камеры и за краем кадра не рисуются (вершины общие, у плиток — свои индексы)
  const TILE = 110, tiles = new Map();
  const put = (a, b, c) => {
    const key = Math.floor(P[a * 3] / TILE) + ',' + Math.floor(P[a * 3 + 2] / TILE);
    let t = tiles.get(key); if (!t) tiles.set(key, t = []);
    t.push(a, b, c);
  };
  for (let k = 0; k < rows - 1; k++) for (let i = 0; i < cols - 1; i++) {
    const a = k * cols + i, b = a + 1, d = a + cols, e = d + 1;
    if (!(inside[a] && inside[b] && inside[e])) put(a, d, b);
    if (!(inside[b] && inside[d] && inside[e])) put(b, d, e);
  }
  // у каждой плитки — свои компактные вершины (иначе видеокарта может пересчитывать все вершины плато на каждую плитку)
  const out = [];
  for (const idx of tiles.values()) {
    const map = new Map(), pos = [], nor = [], cc = [], ix = [];
    for (const j of idx) {
      let n = map.get(j);
      if (n === undefined) { n = map.size; map.set(j, n); pos.push(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]); nor.push(N[j * 3], N[j * 3 + 1], N[j * 3 + 2]); cc.push(Cc[j * 3], Cc[j * 3 + 1], Cc[j * 3 + 2]); }
      ix.push(n);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    g.setIndex(ix);
    g.computeBoundingSphere();
    out.push(g);
  }
  return out;
}

// ——— стена разлома: профиль o(θ, d) — на сколько метров скала выступает в пропасть на глубине d ———
function wallOffset(th, d) {
  const c = Math.cos(th), s = Math.sin(th);
  const lean = 0.11 * n2(c * 1.6, s * 1.6 + 9) - 0.02;                  // где-то стена наклонена, где-то почти отвесна
  let o = lean * d;
  o += 10 * fbm(n2b, c * 3 + d / 70, s * 3 - d / 90, 3);                 // крупные выпуклости
  // ступени — широкие уступы (не везде)
  const amp = 6 * smoothstep(0.0, 0.45, n2(c * 2.3 + 1, s * 2.3 - 4));
  const P = 27 + 9 * n2b(c * 1.7, s * 1.7);
  const f = d / P, st = Math.floor(f) + smoothstep(0.86, 1.0, f - Math.floor(f));
  o += amp * (st - f * 0.92);
  // нависающие выступы у верха
  o += 15 * smoothstep(0.5, 0.78, n2(c * 2.6 + 20, s * 2.6)) * Math.exp(-(((d - 20) / 14) ** 2));
  // впадины-пещеры
  const cd = 45 + 25 * n2b(c * 3 + 8, s * 3);
  o -= 9 * smoothstep(0.55, 0.85, n2(c * 4.2 - 7, s * 4.2 + 2)) * Math.exp(-(((d - cd) / 9) ** 2));
  // у самого верха — без выступов (чтобы край плато совпал со стеной)
  return o * smoothstep(0, 6, d);
}
export const WALL_ROWS = (() => { const K = 60, r = []; for (let k = 0; k <= K; k++) r.push(DEPTH * Math.pow(k / K, 1.8)); return r; })();
export function buildWalls(chunks = 48) {
  const cols = 432, rows = WALL_ROWS.length;
  const P = new Float32Array(cols * rows * 3), D = new Float32Array(cols * rows);
  for (let i = 0; i < cols; i++) {
    const th = (i / cols) * TAU - Math.PI;
    const R = rimR(th), sx = Math.sin(th), sz = Math.cos(th);
    const rx = C.x + sx * (R - LIP * 0.5), rz = C.z + sz * (R - LIP * 0.5);
    const y0 = groundH(rx, rz) - 0.25;
    for (let k = 0; k < rows; k++) {
      const d = WALL_ROWS[k];
      let r = R - wallOffset(th, d);
      const bx = C.x + sx * r, bz = C.z + sz * r, by = y0 - d;
      const det = smoothstep(0, 4, d) * (2.4 * n3(bx / 10, by / 8, bz / 10) + 0.9 * n3(bx / 3.5, by / 3, bz / 3.5));
      r -= det;
      const j = k * cols + i;
      P.set([C.x + sx * r, by, C.z + sz * r], j * 3);
      D[j] = d;
    }
  }
  const N = gridNormals(P, cols, rows, true);
  // направление: tangent (θ+) × вниз → к центру; gridNormals считает (i+1 - i-1) × (k+1 - k-1) — то же самое
  const Cc = new Float32Array(P.length), c = new THREE.Color();
  for (let j = 0; j < cols * rows; j++) {
    rockColor(D[j], N[j * 3 + 1], P[j * 3], P[j * 3 + 1], P[j * 3 + 2], c);
    if (D[j] < 1.2) c.lerp(GRASS, 0.6);
    Cc.set([c.r, c.g, c.b], j * 3);
  }
  const per = cols / chunks, out = [];
  for (let ch = 0; ch < chunks; ch++) {
    const i0 = ch * per, i1 = i0 + per;          // столбцы i0..i1 включительно (последний — общий с соседом)
    const w = per + 1, pos = new Float32Array(w * rows * 3), nor = new Float32Array(w * rows * 3), cc = new Float32Array(w * rows * 3);
    for (let k = 0; k < rows; k++) for (let ii = 0; ii < w; ii++) {
      const src = (k * cols + ((i0 + ii) % cols)) * 3, dst = (k * w + ii) * 3;
      for (let t = 0; t < 3; t++) { pos[dst + t] = P[src + t]; nor[dst + t] = N[src + t]; cc[dst + t] = Cc[src + t]; }
    }
    const idx = [];
    for (let k = 0; k < rows - 1; k++) for (let ii = 0; ii < w - 1; ii++) {
      const a = k * w + ii, b = a + 1, cI = a + w, d = cI + 1;
      idx.push(a, b, cI, b, d, cI);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    out.push(g);
  }
  return out;
}

// ——— столовые горы и каменные колонны внутри разлома ———
// { x, z, top, r } — центр, высота верха, радиус верха. Подобраны под вид со смотровой площадки.
export const MESAS = [
  { x: -48, z: -58, top: -22, r: 15, trees: 9, fall: 1.9 },
  { x: 38, z: -86, top: -44, r: 19, trees: 10, crystals: true },
  { x: -8, z: -146, top: -30, r: 25, trees: 16, fall: 0.7 },
  { x: 66, z: -178, top: -38, r: 14, trees: 6 },
  { x: -86, z: -196, top: -60, r: 18, trees: 8, crystals: true },
  { x: 22, z: -268, top: -4, r: 31, trees: 22, ruins: true },
  { x: -46, z: -322, top: -40, r: 22, trees: 12, fall: 0.25 },
  { x: 96, z: -296, top: -75, r: 15, trees: 5 },
  { x: -112, z: -120, top: -40, r: 12, trees: 4 },
  // далёкие скалы-шпили выше края (видны над лесом на той стороне)
  { x: -70, z: -380, top: 16, r: 16, trees: 6 },
  { x: 92, z: -360, top: 4, r: 12, trees: 4 },
  // колонны
  { x: 16, z: -38, top: -32, r: 4.5, pillar: true },
  { x: -74, z: -112, top: -45, r: 5, pillar: true },
  { x: 82, z: -122, top: -80, r: 6.5, pillar: true },
  { x: -24, z: -228, top: -95, r: 5.5, pillar: true },
  { x: 58, z: -40, top: -70, r: 5, pillar: true },
  // ещё слои вдали
  { x: -104, z: -262, top: -52, r: 14, trees: 5 },
  { x: 112, z: -232, top: -48, r: 13, trees: 4 },
  { x: -18, z: -405, top: -24, r: 18, trees: 7 },
  { x: 48, z: -118, top: -92, r: 8, pillar: true },
];
export function mesaRadius(m, d, phi, wx, wy, wz) {
  let r = m.r * (1 + (m.pillar ? 0.0018 : 0.0035) * d);
  r *= 1 + 0.13 * n2(Math.cos(phi) * 1.3 + m.x, Math.sin(phi) * 1.3 + d / 60);
  r += (m.pillar ? 0.6 : 1.6) * Math.sin(d * 0.35 + 2 * n2b(m.x, d / 20));       // слои породы
  r += (m.pillar ? 0.5 : 1.2) * n3(wx / 6, wy / 5, wz / 6);
  return Math.max(1.5, r);
}
export function buildMesa(m) {
  const S = m.pillar ? 14 : (Math.hypot(m.x, m.z) < 160 ? 28 : 20);
  const K = m.pillar ? 30 : (Math.hypot(m.x, m.z) < 160 ? 42 : 30);
  const rowsD = [];
  for (let k = 0; k <= K; k++) rowsD.push((DEPTH + 40) * Math.pow(k / K, 1.7));
  // ряды крышки: центр, середина, край (с травой)
  const cap = [{ f: 0, dy: 0.9 }, { f: 0.45, dy: 0.7 }, { f: 0.8, dy: 0.35 }];
  const rows = cap.length + rowsD.length, cols = S;
  const P = new Float32Array(cols * rows * 3), Dd = new Float32Array(cols * rows);
  for (let i = 0; i < S; i++) {
    const phi = (i / S) * TAU, cx = Math.sin(phi), cz = Math.cos(phi);
    const rTop = mesaRadius(m, 0, phi, m.x + cx * m.r, m.top, m.z + cz * m.r);
    cap.forEach((cp, k) => {
      const rr = rTop * cp.f, x = m.x + cx * rr, z = m.z + cz * rr;
      P.set([x, m.top + cp.dy * (m.pillar ? 0.4 : 1) + 0.5 * n2b(x / 5, z / 5), z], (k * cols + i) * 3);
      Dd[k * cols + i] = -1;
    });
    rowsD.forEach((d, kk) => {
      const k = kk + cap.length, wy = m.top - d;
      const r = mesaRadius(m, d, phi, m.x + cx * m.r, wy, m.z + cz * m.r);
      P.set([m.x + cx * r, wy, m.z + cz * r], (k * cols + i) * 3);
      Dd[k * cols + i] = d;
    });
  }
  const N = gridNormals(P, cols, rows, true);
  // нормали должны смотреть наружу: phi растёт против часовой (вид сверху), ряды — вниз → (tangent × down) смотрит внутрь
  for (let j = 0; j < N.length; j++) N[j] = -N[j];
  for (let i = 0; i < S; i++) { N.set([0, 1, 0], i * 3); }
  const Cc = new Float32Array(P.length), c = new THREE.Color();
  for (let j = 0; j < cols * rows; j++) {
    const d = Dd[j];
    if (d < 0) c.copy(GRASS).lerp(GRASS2, 0.5 + 0.5 * n2(P[j * 3] / 6, P[j * 3 + 2] / 6)).multiplyScalar(0.92);
    else { rockColor(d + Math.max(0, -m.top) * 0.6, N[j * 3 + 1], P[j * 3], P[j * 3 + 1], P[j * 3 + 2], c); if (d < 1.0) c.lerp(GRASS, 0.5); }
    Cc.set([c.r, c.g, c.b], j * 3);
  }
  const idx = [];
  for (let k = 0; k < rows - 1; k++) for (let i = 0; i < S; i++) {
    const a = k * cols + i, b = k * cols + ((i + 1) % S), cI = a + cols, d = b + cols;
    idx.push(a, cI, b, b, cI, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
// точка на краю верха горы в сторону (tx, tz)
export function mesaEdge(m, tx, tz, inset = 1.5) {
  const phi = Math.atan2(tx - m.x, tz - m.z);
  const r = mesaRadius(m, 0, phi, m.x + Math.sin(phi) * m.r, m.top, m.z + Math.cos(phi) * m.r) - inset;
  return new THREE.Vector3(m.x + Math.sin(phi) * r, m.top + 0.3, m.z + Math.cos(phi) * r);
}

// ——— природная арка: каменная «труба» по дуге, неровная ———
export function buildArch(a, b, rise, radius) {
  const mid = a.clone().add(b).multiplyScalar(0.5); mid.y = Math.max(a.y, b.y) + rise;
  const curve = new THREE.CatmullRomCurve3([a.clone().lerp(mid, -0.15).setY(a.y - rise * 0.6), a, mid, b, b.clone().lerp(mid, -0.15).setY(b.y - rise * 0.6)]);
  const g = new THREE.TubeGeometry(curve, 48, radius, 12, false);
  const p = g.attributes.position, nrm = g.attributes.normal, v = new THREE.Vector3(), n = new THREE.Vector3();
  const cc = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); n.fromBufferAttribute(nrm, i);
    const k = 1.4 * n3(v.x / 5, v.y / 5, v.z / 5) + 0.5 * n3(v.x / 2, v.y / 2, v.z / 2);
    v.addScaledVector(n, k);
    if (n.y > 0.4) v.y += n.y * radius * 0.25;   // сверху площе
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    rockColor(Math.max(10, -v.y + 10), g.attributes.normal.getY(i), v.x, v.y, v.z, c);
    cc.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  g.computeBoundingSphere();
  return g;
}

export const rng = makeRng(2024);
