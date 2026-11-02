// Запекание мира (запускается из build.mjs, на GitHub и у разработчика):
//   «формула мира» (src/world/sdf.js + level1.js) → треугольники кусками 64 м (surface nets, клетка 2 м),
//   внешняя земля — сеткой высот (6 м). В каждую вершину заранее записываются:
//     цвет (камень/трава/тропа/мох… по месту и наклону), солнце (наклон × тень от скал),
//     небо (сколько неба видно × затенение в углах), свечение (лампы в шахте, кристаллы, светящиеся растения).
//   Плюс расстановка растений и камней (каждому — своя освещённость).
// Телефон потом только показывает готовое — ничего тяжёлого при запуске.
// Результат — src/world/baked.gen.js (в git не кладётся). Повторно не печётся, если исходники не менялись.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SdfWorld } from '../src/world/sdf.js';
import { buildLevel1, LEVEL_SEED } from '../src/world/level1.js';
import { scatterRules, bakedLights } from '../src/world/scatter.js';
import { makeRng, clamp, smoothstep } from '../src/core/noise.js';

const OUT = 'src/world/baked.gen.js';
const SOURCES = ['src/world/sdf.js', 'src/world/level1.js', 'src/world/scatter.js', 'src/core/noise.js', 'tools/bake-world.mjs'];
export const SUN = norm([-0.42, 0.78, -0.46]);      // откуда светит солнце (северо-запад, высоко) — то же в render/gfx.js

const CELL = 2.5, CH = 48, X0 = -300, Y0 = -230, Z0 = -420, NX = 5, NY = 3, NZ = 6;   // куски 120 м
const SN_RMAX = 260;                                  // дальше — сетка высот
// на севере (посёлок) подробная сетка заходит дальше — до 320 м, чтобы вся площадь была ровной и чёткой
function snR(x, z) {
  const d = Math.abs(Math.atan2(Math.sin(Math.atan2(x, z) - Math.PI), Math.cos(Math.atan2(x, z) - Math.PI)));
  return SN_RMAX + 60 * smoothstep(0.45, 0.25, d);
}
const HF_STEP = 6, HF_TILE = 32, HF_R1 = 500;

export async function bakeWorld({ force = false, fast = false } = {}) {
  const hash = createHash('sha1');
  for (const f of SOURCES) hash.update(readFileSync(f));
  hash.update(fast ? 'fast' : 'full');
  const key = hash.digest('hex').slice(0, 16);
  if (!force && existsSync(OUT) && readFileSync(OUT, 'utf8').slice(0, 200).includes(key)) return { cached: true, key };

  const t0 = Date.now();
  const W = new SdfWorld(LEVEL_SEED);
  const L = buildLevel1(W);
  const ctx = makeCtx(W, L, fast);
  const meshes = [];
  let tris = 0, verts = 0;
  let lo = 0;
  for (let ci = 0; ci < NX; ci++) for (let cj = 0; cj < NY; cj++) for (let ck = 0; ck < NZ; ck++) {
    const m = surfaceNets(W, ci, cj, ck);
    if (!m) continue;
    shade(ctx, m);
    meshes.push(m);
    tris += m.idx.length / 3; verts += m.pos.length / 3;
    // грубая копия для дали: клетка 5 м, 4 раза меньше треугольников
    const g = surfaceNets(W, ci, cj, ck, { cell: CELL * 2, ch: CH / 2, pad: 1, sink: 0.35 });
    if (g) { shade(ctx, g); meshes.push(g); lo += g.idx.length / 3; }
  }
  const tSN = Date.now();
  for (const m of heightTiles(W, ctx)) { meshes.push(m); tris += m.idx.length / 3; verts += m.pos.length / 3; }
  const props = scatter(W, L, ctx);
  for (const [kind, list] of Object.entries(ctx.emitters)) (props[kind] || (props[kind] = [])).push(...list);
  const blob = pack(meshes, props);
  const src = `// создаётся tools/bake-world.mjs — не править руками. key=${key}\n` +
    `export const BAKE = ${JSON.stringify(blob.meta)};\nexport const BAKE_DATA = "${blob.b64}";\n`;
  writeFileSync(OUT, src);
  const info = { key, chunks: meshes.length, tris, lo, verts, props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.length / 6])),
    mb: (blob.bytes / 1048576).toFixed(2), sec: ((Date.now() - t0) / 1000).toFixed(1), snSec: ((tSN - t0) / 1000).toFixed(1) };
  return info;
}

// ——— surface nets для одного куска ———
// lod: { cell, ch, pad, sink } — для грубой копии: клетка 5 м, кольцо перекрытия в 1 клетку, утоплена в скалу
function surfaceNets(W, ci, cj, ck, lod = { cell: CELL, ch: CH, pad: 0, sink: 0 }) {
  const CELL = lod.cell, CH = lod.ch, PAD = lod.pad;
  const ox = X0 + ci * CH * CELL, oy = Y0 + cj * CH * CELL, oz = Z0 + ck * CH * CELL;
  // грубая проверка: если везде далеко от поверхности — пропускаем кусок
  let nPos = 0, nNeg = 0, minAbs = 1e9;
  const step = (CH * CELL) / 12;
  for (let a = 0; a <= 12; a++) for (let b = 0; b <= 12; b++) for (let c = 0; c <= 12; c++) {
    const v = W.f(ox + a * step, oy + b * step, oz + c * step);
    if (v > 0) nPos++; else nNeg++;
    minAbs = Math.min(minAbs, Math.abs(v));
  }
  if ((nPos === 0 || nNeg === 0) && minAbs > step * 1.2) return null;
  // значения в углах клеток: индексы −1−PAD..CH+PAD
  const B = 1 + PAD, S = CH + 2 * B, F = new Float32Array(S * S * S);
  const I = (i, j, k) => ((i + B) * S + (j + B)) * S + (k + B);
  for (let i = -B; i <= CH + PAD; i++) for (let j = -B; j <= CH + PAD; j++) for (let k = -B; k <= CH + PAD; k++) {
    F[I(i, j, k)] = W.f(ox + i * CELL, oy + j * CELL, oz + k * CELL);
  }
  // вершина в каждой клетке со сменой знака (клетки −B..CH+PAD−1)
  const C = CH + 2 * B - 1, vid = new Int32Array(C * C * C).fill(-1);
  const VI = (i, j, k) => ((i + B) * C + (j + B)) * C + (k + B);
  const P = [];
  const EDGES = [[0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1], [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0],
    [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1], [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]];
  const g = { x: 0, y: 0, z: 0 };
  for (let i = -B; i < CH + PAD; i++) for (let j = -B; j < CH + PAD; j++) for (let k = -B; k < CH + PAD; k++) {
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const e of EDGES) {
      const a = F[I(i + e[0], j + e[1], k + e[2])], b = F[I(i + e[3], j + e[4], k + e[5])];
      if ((a > 0) === (b > 0)) continue;
      const t = a / (a - b);
      sx += e[0] + (e[3] - e[0]) * t; sy += e[1] + (e[4] - e[1]) * t; sz += e[2] + (e[5] - e[2]) * t; n++;
    }
    if (!n) continue;
    let x = ox + (i + sx / n) * CELL, y = oy + (j + sy / n) * CELL, z = oz + (k + sz / n) * CELL;
    // подтянуть точку на настоящую поверхность (не дальше полуклетки)
    const fv = W.f(x, y, z);
    W.normal(x, y, z, g, 0.3);
    const m = clamp(fv, -CELL * 0.6, CELL * 0.6) + lod.sink;
    x -= g.x * m; y -= g.y * m; z -= g.z * m;
    vid[VI(i, j, k)] = P.length / 3;
    P.push(x, y, z);
  }
  if (!P.length) return null;
  // четырёхугольники на рёбрах со сменой знака (ребро принадлежит куску, если его начало в 0..CH−1)
  const idx = [];
  // ax — ось ребра (0 x, 1 y, 2 z); airFirst — воздух в начале ребра (значит лицо смотрит в −ось)
  const quad = (a, b, c, d, ax, airFirst) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // пропускаем то, что дальше SN_RMAX (там сетка высот)
    // (только у поверхности: пещеры и тоннели глубоко в скале за SN_RMAX — оставляем)
    const mx = (P[a * 3] + P[c * 3]) / 2, my = (P[a * 3 + 1] + P[c * 3 + 1]) / 2, mz = (P[a * 3 + 2] + P[c * 3 + 2]) / 2;
    if (my > -40 && Math.hypot(mx, mz) > snR(mx, mz)) return;
    // ориентация: нормаль треугольника должна смотреть в сторону воздуха вдоль ребра
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const cr = ax === 0 ? uy * vz - uz * vy : ax === 1 ? uz * vx - ux * vz : ux * vy - uy * vx;
    if ((cr > 0) === airFirst) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
  };
  for (let i = -PAD; i < CH + PAD; i++) for (let j = -PAD; j < CH + PAD; j++) for (let k = -PAD; k < CH + PAD; k++) {
    const f0 = F[I(i, j, k)] > 0;
    // ребро по x
    if ((F[I(i + 1, j, k)] > 0) !== f0) quad(vid[VI(i, j - 1, k - 1)], vid[VI(i, j, k - 1)], vid[VI(i, j, k)], vid[VI(i, j - 1, k)], 0, f0);
    // ребро по y
    if ((F[I(i, j + 1, k)] > 0) !== f0) quad(vid[VI(i - 1, j, k - 1)], vid[VI(i - 1, j, k)], vid[VI(i, j, k)], vid[VI(i, j, k - 1)], 1, f0);
    // ребро по z
    if ((F[I(i, j, k + 1)] > 0) !== f0) quad(vid[VI(i - 1, j - 1, k)], vid[VI(i, j - 1, k)], vid[VI(i, j, k)], vid[VI(i - 1, j, k)], 2, f0);
  }
  if (!idx.length) return null;
  // оставить только нужные вершины
  const remap = new Int32Array(P.length / 3).fill(-1), pos = [];
  for (let t = 0; t < idx.length; t++) {
    const v = idx[t];
    if (remap[v] < 0) { remap[v] = pos.length / 3; pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); }
    idx[t] = remap[v];
  }
  return { kind: PAD ? 'lo' : 'sn', o: [ox, oy, oz], pos, idx };
}

// ——— свет и цвет вершин ———
function makeCtx(W, L, fast) {
  const { lights, emitters } = bakedLights(W, L);
  return { W, L, fast, lights, emitters, n: { x: 0, y: 0, z: 0 } };
}

function shade(ctx, m) {
  const { W } = ctx, P = m.pos, n = P.length / 3;
  m.nor = new Float32Array(n * 3); m.col = new Float32Array(n * 3); m.lit = new Float32Array(n * 2); m.glow = new Float32Array(n * 3);
  const g = ctx.n;
  for (let v = 0; v < n; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    W.normal(x, y, z, g, 0.3);
    m.nor[v * 3] = g.x; m.nor[v * 3 + 1] = g.y; m.nor[v * 3 + 2] = g.z;
    const [cr, cg, cb] = albedo(ctx, x, y, z, g.x, g.y, g.z);
    m.col[v * 3] = cr; m.col[v * 3 + 1] = cg; m.col[v * 3 + 2] = cb;
    const lit = lighting(ctx, x, y, z, g.x, g.y, g.z);
    m.lit[v * 2] = lit[0]; m.lit[v * 2 + 1] = lit[1];
    const gl = glowAt(ctx, x, y, z, g.x, g.y, g.z);
    m.glow[v * 3] = gl[0]; m.glow[v * 3 + 1] = gl[1]; m.glow[v * 3 + 2] = gl[2];
  }
}

// солнце (наклон × мягкая тень) и небо (затенение в углах × сколько неба видно)
function lighting(ctx, x, y, z, nx, ny, nz) {
  const { W, fast } = ctx;
  // затенение в углах и щелях
  let occ = 0, w = 1;
  for (const h of [0.5, 1.2, 2.2, 3.6, 5.5]) { occ += Math.max(0, h - W.f(x + nx * h, y + ny * h, z + nz * h)) * w / h; w *= 0.6; }
  const ao = clamp(1 - 0.55 * occ, 0, 1);
  const ndl = nx * SUN[0] + ny * SUN[1] + nz * SUN[2];
  let sun = Math.max(0, ndl);
  if (sun > 0 && !fast) sun *= softTrace(W, x + nx * 0.6, y + ny * 0.6, z + nz * 0.6, SUN[0], SUN[1], SUN[2], 260, 7);
  // небо: луч вверх (с наклоном по нормали)
  let sky = 1;
  if (!fast) {
    let dx = nx, dy = ny + 1.4, dz = nz;
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    sky = 0.3 + 0.7 * softTrace(W, x + nx * 0.6, y + ny * 0.6, z + nz * 0.6, dx, dy, dz, 140, 3);
  }
  return [sun, ao * sky];
}

// мягкая тень по формуле расстояния: 0 — закрыто, 1 — открыто
function softTrace(W, ox, oy, oz, dx, dy, dz, maxT, k) {
  let res = 1, t = 0.4;
  for (let i = 0; i < 56 && t < maxT; i++) {
    const y = oy + dy * t;
    if (y > 46) break;                                   // выше всего мира
    const h = W.f(ox + dx * t, y, oz + dz * t);
    if (h < 0.02) return 0;
    res = Math.min(res, (k * h) / t);
    t += clamp(h, 0.35, 24);
  }
  return clamp(res, 0, 1);
}

function glowAt(ctx, x, y, z, nx, ny, nz) {
  const out = [0, 0, 0];
  for (const L of ctx.lights) {
    const dx = L.x - x, dy = L.y - y, dz = L.z - z, d = Math.hypot(dx, dy, dz);
    if (d > L.r) continue;
    const ndl = (nx * dx + ny * dy + nz * dz) / (d || 1);
    if (ndl <= 0) continue;
    const fall = Math.pow(1 - d / L.r, 2) * (0.35 + 0.65 * ndl) * L.i;
    const vis = ctx.fast ? 1 : softTrace(ctx.W, x + nx * 0.4, y + ny * 0.4, z + nz * 0.4, dx / d, dy / d, dz / d, d - 0.6, 6);
    out[0] += L.c[0] * fall * vis; out[1] += L.c[1] * fall * vis; out[2] += L.c[2] * fall * vis;
  }
  // светящиеся пятна мха глубоко внизу
  if (y < -150 && ny > 0.5) {
    const p = ctx.W.n2(x / 9 + 30, z / 9), q = smoothstep(0.35, 0.7, p) * smoothstep(-150, -195, y);
    out[0] += 0.05 * q; out[1] += 0.55 * q; out[2] += 0.5 * q;
  }
  return out;
}

// ——— цвет поверхности ———
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const PAL = {
  grass: hex('#5a9a3b'), grass2: hex('#7bb24a'), grassDry: hex('#a39f50'), dirt: hex('#8c6a46'), path: hex('#a57f55'),
  sand1: hex('#c79b70'), sand2: hex('#9a714d'), grey1: hex('#9ba1a7'), grey2: hex('#6e7783'), dark1: hex('#5d6984'), dark2: hex('#414a63'),
  moss1: hex('#5e9540'), moss2: hex('#457f4b'), moss3: hex('#2e6e69'), mine1: hex('#7a5f47'), mine2: hex('#56412f'),
  wet: hex('#46685a'), floor: hex('#46646a'), bed: hex('#7a6c55'), campGround: hex('#8d9160'),
};

function albedo(ctx, x, y, z, nx, ny, nz) {
  const { W, L } = ctx;
  const r = Math.hypot(x, z), wallR = W.wallR(x, z, y);
  const n1 = W.n2(x / 11 + 3, z / 11 - 7 + y / 9), n2 = W.n2b(x / 37, z / 37 + y / 23);
  const steep = 1 - smoothstep(0.55, 0.82, ny);
  // камень: песчаник наверху → серый → тёмный внизу, с полосами пород
  const band = 0.5 + 0.5 * Math.sin(y * 0.33 + 3.2 * W.n2(x / 70, z / 70) + 2.2 * n2);     // слои породы — волнистые, не кольцами
  let rock;
  if (y > -60) rock = mix(PAL.sand1, PAL.sand2, band * 0.45 + 0.25 * n1 + 0.15);
  else if (y > -135) rock = mix(mix(PAL.sand2, PAL.grey1, smoothstep(-60, -85, y)), PAL.grey2, band * 0.4 + 0.25 * n1 + 0.1);
  else rock = mix(mix(PAL.grey2, PAL.dark1, smoothstep(-135, -165, y)), PAL.dark2, band * 0.4 + 0.25 * n1 + 0.1);
  // земля: трава наверху, мох на полках, тёмно-бирюзовый мох глубже
  let ground;
  if (y > -6 && r > wallR - 3) {
    ground = mix(PAL.grass, PAL.grass2, 0.5 + 0.5 * n1);
    ground = mix(ground, PAL.grassDry, smoothstep(0.3, 0.75, n2) * 0.6);
    // тропы и площадь посёлка
    const ds = Math.hypot(x - L.settle.x, z - L.settle.z);
    const dp = Math.abs(x - L.settle.x) < 3.2 && z > L.settle.z && z < -(L.Rn - 2) ? 0 : 99;
    const pathT = Math.max(smoothstep(24, 14, ds), smoothstep(3.6, 1.8, Math.min(dp, 99)));
    ground = mix(ground, PAL.path, pathT * (0.75 + 0.25 * n1));
  } else if (y > -45) ground = mix(PAL.moss1, PAL.grass2, 0.5 + 0.5 * n1);
  else if (y > -135) ground = mix(PAL.moss1, PAL.moss2, smoothstep(-45, -110, y) * 0.8 + 0.2 * n1);
  else ground = mix(PAL.moss2, PAL.moss3, smoothstep(-135, -180, y));
  if (x < -90 && y < -112 && y > -126) ground = mix(ground, PAL.campGround, 0.75);     // сухая трава на плато лагеря
  if (y < -197) ground = mix(PAL.floor, PAL.moss3, 0.35 + 0.35 * n1);
  let c = mix(ground, rock, steep);
  // внутри скалы (тоннели шахты, пещеры)
  if (r > wallR + 0.5 && y < -60) c = mix(PAL.mine1, PAL.mine2, ny > 0.6 ? 0.8 : 0.3 + 0.3 * n1);
  // мокрый камень и русла у водопадов
  const wet = wetness(L, x, y, z);
  if (wet > 0) c = mix(c, PAL.wet, wet * 0.7);
  // мелкие пятна, чтобы не было «пластика»
  const v = 0.9 + 0.12 * W.n2(x / 3.1, z / 3.1 + y / 2.7);
  return [c[0] * v, c[1] * v, c[2] * v];
}

function wetness(L, x, y, z) {
  let w = 0;
  const p = L.poolA;
  w = Math.max(w, smoothstep(14, 6, Math.hypot(x - p.x, z - p.z)) * smoothstep(-30, -22, y));
  // струя первого водопада — вдоль стены над заводью
  if (y > -24 && y < 2) w = Math.max(w, smoothstep(9, 3, Math.hypot(x - L.rimFall[0], z - L.rimFall[2])));
  // русло ручья на террасе
  for (const s of L.streamA) w = Math.max(w, smoothstep(7, 2.5, Math.hypot(x - s[0], z - s[2])) * smoothstep(-40, -30, y) * (y < -20 ? 1 : 0));
  // берег озера на дне
  const lk = L.lake;
  if (y < -195) w = Math.max(w, smoothstep(1.35, 0.95, Math.hypot((x - lk.x) / lk.rx, (z - lk.z) / lk.rz)));
  return w;
}

// ——— внешняя земля: сетка высот ———
function heightTiles(W, ctx) {
  const tiles = [];
  const ntile = Math.ceil((2 * HF_R1) / (HF_STEP * HF_TILE));
  const base = -ntile * HF_STEP * HF_TILE / 2;
  for (let ti = 0; ti < ntile; ti++) for (let tk = 0; tk < ntile; tk++) {
    const ox = base + ti * HF_STEP * HF_TILE, oz = base + tk * HF_STEP * HF_TILE;
    const N1 = HF_TILE + 1, vmap = new Int32Array(N1 * N1).fill(-1);
    const pos = [], idx = [], nor = [], col = [], lit = [], glow = [];
    const vert = (a, b) => {
      const key = a * N1 + b;
      if (vmap[key] >= 0) return vmap[key];
      const x = ox + a * HF_STEP, z = oz + b * HF_STEP, r = Math.hypot(x, z);
      const h = W.terrainH(x, z) - (r < snR(x, z) + 8 ? 0.18 : 0);
      const e = 1.5, hx = W.terrainH(x + e, z) - W.terrainH(x - e, z), hz = W.terrainH(x, z + e) - W.terrainH(x, z - e);
      let nx = -hx, ny = 2 * e, nz = -hz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      vmap[key] = pos.length / 3;
      pos.push(x, h, z); nor.push(nx, ny, nz);
      const c = albedo(ctx, x, h, z, nx, ny, nz);
      col.push(c[0], c[1], c[2]);
      lit.push(Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]), 1);
      glow.push(0, 0, 0);
      return vmap[key];
    };
    for (let a = 0; a < HF_TILE; a++) for (let b = 0; b < HF_TILE; b++) {
      const cx = ox + (a + 0.5) * HF_STEP, cz = oz + (b + 0.5) * HF_STEP, r = Math.hypot(cx, cz);
      if (r < snR(cx, cz) - 8 || r > HF_R1) continue;
      const v00 = vert(a, b), v10 = vert(a + 1, b), v11 = vert(a + 1, b + 1), v01 = vert(a, b + 1);
      idx.push(v00, v01, v11, v00, v11, v10);
    }
    if (!idx.length) continue;
    tiles.push({ kind: 'hf', o: [ox, 0, oz], pos, idx, nor: new Float32Array(nor), col: new Float32Array(col), lit: new Float32Array(lit), glow: new Float32Array(glow) });
  }
  return tiles;
}

// ——— растения и камни ———
function scatter(W, L, ctx) {
  const out = {};
  const g = { x: 0, y: 0, z: 0 };
  for (const rule of scatterRules(W, L)) {
    const rng = makeRng(rule.seed);
    const list = out[rule.kind] || (out[rule.kind] = []);
    let placed = 0;
    for (let tries = 0; tries < rule.count * 6 && placed < rule.count; tries++) {
      const [x, z] = rule.pick(rng);
      const t = W.raycast(x, rule.yTop, z, 0, -1, 0, rule.yTop - rule.yBot);
      if (t < 0) continue;
      const y = rule.yTop - t;
      W.normal(x, y, z, g, 0.3);
      if (g.y < rule.minNy) continue;
      if (rule.ok && !rule.ok(x, y, z, rng)) continue;
      const s = rule.s0 + rng() * (rule.s1 - rule.s0);
      const lit = ctx.fast ? 1 : 0.35 + 0.65 * softTrace(W, x, y + 1.2, z, SUN[0], SUN[1], SUN[2], 240, 6);
      list.push(x, y - 0.08, z, rng() * Math.PI * 2, s, lit);
      placed++;
    }
  }
  return out;
}

// ——— упаковка: целые числа (положение в см от угла куска, нормали и цвета в байтах) ———
function pack(meshes, props) {
  const chunks = [], parts = [];
  let off = 0;
  const put = (arr) => { const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(new Uint8Array(pad)); off += pad; } const o = off; parts.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)); off += arr.byteLength; return o; };
  for (const m of meshes) {
    const n = m.pos.length / 3;
    const pos = new Int16Array(n * 3), nor = new Int8Array(n * 3), col = new Uint8Array(n * 3), lit = new Uint8Array(n * 2), glow = new Uint8Array(n * 3);
    const idx = n > 65535 ? new Uint32Array(m.idx) : new Uint16Array(m.idx);
    for (let v = 0; v < n; v++) {
      for (let a = 0; a < 3; a++) {
        pos[v * 3 + a] = Math.round((m.pos[v * 3 + a] - m.o[a]) * 100);
        nor[v * 3 + a] = Math.round(clamp(m.nor[v * 3 + a], -1, 1) * 127);
        col[v * 3 + a] = Math.round(clamp(m.col[v * 3 + a], 0, 1) * 255);
        glow[v * 3 + a] = Math.round(clamp(m.glow[v * 3 + a], 0, 1) * 255);
      }
      lit[v * 2] = Math.round(clamp(m.lit[v * 2], 0, 1) * 255);
      lit[v * 2 + 1] = Math.round(clamp(m.lit[v * 2 + 1], 0, 1) * 255);
    }
    // в куске 64 м = 6400 см; угол куска сдвигаем на середину, чтобы влезло в int16 с запасом
    chunks.push({ k: m.kind, o: m.o, n, t: m.idx.length, i32: idx instanceof Uint32Array ? 1 : 0,
      pos: put(pos), nor: put(nor), col: put(col), lit: put(lit), glow: put(glow), idx: put(idx) });
  }
  const pmeta = {};
  for (const [kind, list] of Object.entries(props)) pmeta[kind] = { n: list.length / 6, off: put(new Float32Array(list)) };
  const all = new Uint8Array(off);
  let p = 0;
  for (const part of parts) { all.set(part, p); p += part.length; }
  return { meta: { v: 1, chunks, props: pmeta }, b64: Buffer.from(all).toString('base64'), bytes: off };
}

function norm(v) { const l = Math.hypot(...v); return v.map((a) => a / l); }

// запуск напрямую: node tools/bake-world.mjs [--force] [--fast]
if (process.argv[1] && process.argv[1].endsWith('bake-world.mjs')) {
  const info = await bakeWorld({ force: process.argv.includes('--force'), fast: process.argv.includes('--fast') });
  console.log('мир:', JSON.stringify(info));
}
