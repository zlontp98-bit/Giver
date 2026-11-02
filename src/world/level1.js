// Первый ярус Бездны: где что стоит. Здесь только «план» — форма (детали SDF), точки и пути.
// Модели расставляет world/props.js, воду — world/water.js, свет и цвет запекает tools/bake-world.mjs.
//
// Стороны: юг +z (θ = 0), восток +x (θ = π/2), север −z (θ = π), запад −x (θ = −π/2). θ = atan2(x, z).
// Посёлок — на северном краю. Под ним — Лесная окраина (терраса), на востоке — Каменные уступы и столбы,
// на юго-востоке — Заброшенная шахта, на западе — Затерянный лагерь на плато, на северо-западе — Большой
// спуск к озеру на дне и закрытому проходу на второй ярус.
import { PIT_DEPTH } from './sdf.js';
import { clamp } from '../core/noise.js';

export const LEVEL_SEED = 20261103;

export function buildLevel1(W) {
  const at = (th, r, y) => [Math.sin(th) * r, y, Math.cos(th) * r];
  const R = (th, y) => W.pitR(Math.cos(th), Math.sin(th), y);
  const N = Math.PI;                              // север
  const Rn = R(N, 0);                             // край у посёлка

  // ——— верхний мир: посёлок, смотровая площадка, река ———
  const settle = { x: 0, z: -(Rn + 64) };
  W.flats.push({ x: settle.x, z: settle.z, r: 46, soft: 22, h: 0.8 });
  const pathEnd = -(Rn + 6);                      // тропа от посёлка к смотровой площадке — ровная
  for (let k = 0; k <= 5; k++) W.flats.push({ x: 0, z: settle.z + ((pathEnd - settle.z) * k) / 5, r: 8, soft: 10, h: 0.7 });
  const thW = N - 0.30;                           // водопад с края — восточнее посёлка
  const Rw = R(thW, 0);
  const rimFall = at(thW, Rw - 1.5, 0);
  W.river = {
    half: 4.5, depth: 2.6,
    pts: [[262, -470], [196, -384], [138, -306], [96, -248], [at(thW, Rw + 16, 0)[0], at(thW, Rw + 16, 0)[2]], [rimFall[0], rimFall[2]]],
  };

  // ——— 1. Лесная окраина: широкая терраса под посёлком ———
  const aZ = -(Rn - 38), aX = 15;
  const topA = (x, z) => -21 - 13 * clamp((z + Rn - 4) / 72, 0, 1) + 1.4 * W.n2(x / 21, z / 21) + 1.2 * Math.max(0, W.n2b(x / 13 + 3, z / 13));
  W.slab({
    cx: aX, cz: aZ, rx: 98, rz: 52, top: topA, k: 3,
    bottom: (x, z, T) => T - 11 - 6 * W.n2(x / 19 + 50, z / 19) - 82 * Math.pow(1 - clamp((z + Rn + 2) / 74, 0, 1), 2),
    yMin: -130, yMax: -14,
  });
  // тропа от смотровой площадки вниз на террасу (по стене)
  const pathLedge = { th0: N - 0.10, span: 0.40, y0: -1.6, y1: -22.5, depth: 4.6 };
  W.ledge(pathLedge);
  // водопад с края падает в заводь на террасе, дальше ручей до края террасы и второй водопад в глубину
  const poolA = { x: rimFall[0] - 2, y: -21.6, z: rimFall[2] + 7 };
  W.cave({ x: poolA.x, y: poolA.y, z: poolA.z, rx: 8.5, ry: 2.4, rz: 7.5, floor: -23.6, k: 1.5 });
  const streamA = [[poolA.x, -22.4, poolA.z + 2], [poolA.x - 6, -25.2, poolA.z + 22], [poolA.x - 14, -28.6, poolA.z + 42], [poolA.x - 19, -31.6, poolA.z + 60], [poolA.x - 21, -33.4, poolA.z + 80]];
  W.channel(streamA, { half: 3.2, depth: 1.1, yMin: -40, yMax: -16 });

  // ——— 2. Каменные уступы: восточная стена, полки и столбы ———
  // полки зигзагом: каждая следующая — на 10–12 м ниже, переход — спуск по стене у конца полки
  const abLedge = { th0: 1.75, span: 0.83, y0: -48, y1: -27.5, depth: 5.5 };   // от террасы вдоль стены (верхний конец заходит на террасу)
  W.ledge(abLedge);
  const bLedges = [
    { th0: 1.20, span: 0.60, y0: -60, y1: -53.5, depth: 4.6 },
    { th0: 1.10, span: 0.52, y0: -70.5, y1: -64, depth: 4.2 },
    { th0: 1.10, span: 0.60, y0: -84, y1: -76, depth: 4.8 },
  ];
  for (const l of bLedges) W.ledge(l);
  const pillars = [
    { th: 1.55, r: 136, top: -46, rad: 11, lean: 0.06, dir: 0.4 },
    { th: 1.28, r: 122, top: -60, rad: 9, lean: 0.04, dir: 2.0 },
    { th: 1.02, r: 132, top: -74, rad: 12, lean: 0.07, dir: 3.6 },
    { th: 1.82, r: 120, top: -38, rad: 9.5, lean: 0.05, dir: 5.1 },
    { th: -0.55, r: 118, top: -96, rad: 13, lean: 0.04, dir: 1.2 },      // столб на юго-западе
  ].map((p) => ({ ...p, pos: at(p.th, p.r, p.top) }));
  for (const p of pillars) W.pillar({ x: p.pos[0], z: p.pos[2], r: p.rad, top: p.top, lean: p.lean, leanDir: p.dir });
  // каменный мост с восточного края террасы на ближний столб
  W.arch([aX + 92, -31, aZ + 12], [pillars[3].pos[0] - 4, -38.5, pillars[3].pos[2] - 3], { r: 4.2, sag: 7 });
  // глубокая расщелина в восточной стене — от края до глубины 160 м
  const thC = 1.42;
  // (начинается за стеной — полки уступов проходят перед ней, как мостики)
  W.crevice({ th: thC, rIn: R(thC, -60) + 1, rOut: R(thC, 0) + 38, width: 8, yTop: 10, yBot: -160 });
  // ещё одна узкая щель на юге — её видно со смотровой площадки
  W.crevice({ th: 0.05, rIn: R(0.05, -40) - 4, rOut: R(0.05, 0) + 26, width: 5, yTop: 10, yBot: -95 });

  // ——— 3. Заброшенная шахта: юго-восток ———
  const mineIn = { th0: 0.55, span: 0.62, y0: -95, y1: -92, depth: 6.5, thick: 4 };        // площадка у входа
  W.ledge(mineIn);
  const thM = 0.72, Rm = R(thM, -94);
  const mine = [at(thM, Rm - 4, -94), at(thM, Rm + 16, -94.4), at(0.63, Rm + 32, -95), at(0.76, Rm + 47, -96)];
  W.tunnel(mine);
  const hall = { pos: at(0.74, Rm + 60, -94), rx: 13, ry: 6.5, rz: 11, floor: -97 };
  W.cave({ x: hall.pos[0], y: hall.pos[1], z: hall.pos[2], rx: hall.rx, ry: hall.ry, rz: hall.rz, floor: hall.floor });
  const ramp = [at(0.66, Rm + 64, -97), at(0.55, Rm + 58, -103), at(0.45, Rm + 45, -110), at(0.36, Rm + 25, -116), at(0.30, R(0.30, -119) - 4, -119)];
  W.tunnel([[hall.pos[0], hall.floor, hall.pos[2]], ...ramp]);              // из зала вниз к выходу
  const mineOut = { th0: 0.16, span: 0.28, y0: -121, y1: -119.5, depth: 7, thick: 4 };     // выход из шахты
  W.ledge(mineOut);

  // ——— 4. Затерянный лагерь: большое плато на западе ———
  const thD = -1.45, Rd = R(thD, -120);
  const dc = at(thD, Rd - 32, -120);
  W.slab({
    cx: dc[0], cz: dc[2], rx: 42, rz: 56, rot: Math.PI / 2 - thD, k: 3,
    top: (x, z) => -120 + 1.3 * W.n2(x / 17, z / 17) + 1.5 * Math.max(0, W.n2b(x / 11, z / 11 + 5)),
    bottom: (x, z, T) => {
      const r = Math.hypot(x, z);
      return T - 12 - 6 * W.n2(x / 19 + 70, z / 19) - 75 * Math.pow(clamp((r - (Rd - 62)) / 62, 0, 1), 2);
    },
    yMin: -215, yMax: -112,
  });
  // тайник в стене за лагерем: узкая щель → маленькая пещера
  const thS = -1.36, Rs = R(thS, -118);
  W.tunnel([at(thS, Rs - 7, -120), at(thS, Rs + 4, -120)], { rad: 1.5, axis: 1.0 });
  W.cave({ x: at(thS, Rs + 9, -118)[0], y: -118, z: at(thS, Rs + 9, -118)[2], rx: 7, ry: 3.6, rz: 6, floor: -120 });
  // путь от выхода из шахты вдоль юго-западной стены к лагерю
  // (между выходом из шахты и первой полкой — 7 м лазания вбок по стене)
  const swLedges = [
    { th0: -0.30, span: 0.44, y0: -126, y1: -122 },
    { th0: -0.72, span: 0.46, y0: -131, y1: -127 },
    { th0: -1.24, span: 0.56, y0: -117.4, y1: -130.8 },
  ].map((l) => ({ ...l, depth: 4.6 }));
  for (const l of swLedges) W.ledge(l);

  // ——— 5. Большой спуск: северо-западная стена к дну ———
  const eLedges = [
    { th0: -2.10, span: 0.38, y0: -132, y1: -124.5 },
    { th0: -2.35, span: 0.35, y0: -144, y1: -140 },
    { th0: -2.30, span: 0.35, y0: -157, y1: -153 },
    { th0: -2.55, span: 0.35, y0: -170, y1: -166 },
    { th0: -2.45, span: 0.35, y0: -183, y1: -179 },
    { th0: -2.70, span: 0.35, y0: -195, y1: -191 },
  ].map((l) => ({ ...l, depth: 5 }));
  for (const l of eLedges) W.ledge(l);
  const scree = { th0: -2.95, span: 0.42, y0: -203, y1: -170, depth: 7, thick: 5 };     // длинный пологий сход-осыпь
  W.ledge(scree);
  // озеро на дне под вторым водопадом
  const lake = { x: poolA.x - 22, z: poolA.z + 90, rx: 30, rz: 22 };
  W.cave({ x: lake.x, y: -PIT_DEPTH - 1, z: lake.z, rx: lake.rx, ry: 7, rz: lake.rz, floor: -PIT_DEPTH - 6, k: 3 });
  lake.y = -PIT_DEPTH - 2.2;
  // закрытый проход на второй ярус: тоннель в северную стену у дна
  const thG = N + 0.12, Rg = R(thG, -203);
  const gate = { inner: at(thG, Rg - 5, -203.5), outer: at(thG, Rg + 20, -203.5), th: thG };
  W.tunnel([gate.inner, gate.outer], { rad: 3.6, axis: 2.0 });

  // огромные валуны на дне и на террасе
  for (const b of [[-40, -206, 40, 9], [60, -205, 30, 7], [-90, -204, -60, 11], [100, -206, -20, 8], [-10, -26, -140, 6], [70, -30, -130, 5]]) {
    const [bx, by, bz, br] = b;
    W.add({ air: false, k: 2.5, x0: bx - br, x1: bx + br, z0: bz - br, z1: bz + br, y0: by - br, y1: by + br,
      sd: (x, y, z) => Math.hypot(x - bx, (y - by) * 1.3, z - bz) - br * (1 + 0.25 * W.n3(x / 6, y / 6, z / 6)) });
  }

  // ——— посёлок: дома, площадь, фонари (модели — world/props.js, свет фонарей запекается) ———
  const sx = settle.x, sz = settle.z;
  const village = {
    fire: [sx, sz + 6],
    houses: [
      { x: sx - 2, z: sz - 27, face: 0, w: 5, d: 4, floors: 2, hall: true },     // Дом экспедиций
      { x: sx - 27, z: sz - 6, face: Math.PI / 2, w: 3, d: 3, floors: 1 },
      { x: sx + 27, z: sz - 9, face: -Math.PI / 2, w: 4, d: 3, floors: 2 },
      { x: sx - 31, z: sz + 22, face: Math.PI / 2, w: 3, d: 3, floors: 1 },
      { x: sx + 31, z: sz + 20, face: -Math.PI / 2, w: 3, d: 4, floors: 1 },
    ],
    stalls: [[sx - 11, sz + 18, 0.3], [sx + 12, sz + 17, -0.3]],
    lanterns: [],
    windmill: [sx - 64, sz - 42],
    watermill: [W.river.pts[3][0] + 9, W.river.pts[3][1] + 4],
  };
  for (let z = sz + 22; z < -(Rn + 6); z += 12) village.lanterns.push([sx - 4.2, z], [sx + 4.2, z]);
  for (const a of [0.8, 2.4, 3.9, 5.5]) village.lanterns.push([sx + Math.cos(a) * 17, sz + 6 + Math.sin(a) * 17]);
  // лампы в шахте — каждые ~9 м вдоль тоннелей
  const mineLamps = [];
  for (const path of [mine, ramp]) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      for (let d = 4; d < len; d += 9) {
        const t = d / len;
        mineLamps.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + 2.6, a[2] + (b[2] - a[2]) * t]);
      }
    }
  }

  // ——— точки для игры ———
  const lookout = { a: at(N, Rn + 7, 0.25), b: at(N, Rn - 8, 0.25), th: N };
  const spawn = [settle.x + 6, 0, settle.z + 8];
  const areas = [
    { id: 'village', name: 'Посёлок у края', test: (x, y, z) => y > -4 && Math.hypot(x, z) > Rn - 12 },
    { id: 'forest', name: 'Лесная окраина', test: (x, y, z) => y > -45 && z < -60 && Math.abs(x - aX) < 120 },
    { id: 'mine', name: 'Заброшенная шахта', test: (x, y, z) => Math.hypot(x, z) > R(Math.atan2(x, z), y) - 2 && y < -85 && x > 0 },
    { id: 'ledges', name: 'Каменные уступы', test: (x, y, z) => x > 60 && y > -100 },
    { id: 'camp', name: 'Затерянный лагерь', test: (x, y, z) => x < -60 && y > -135 && y < -100 },
    { id: 'descent', name: 'Большой спуск', test: () => true },
  ];
  // облёт для «Замера»: посёлок → смотровая → терраса → уступы → шахта → лагерь → спуск → озеро
  const bench = [
    spawn, [0, 2, settle.z + 30], lookout.b, at(N - 0.05, Rn - 6, -10), at(N + 0.25, Rn - 12, -22), [aX, -26, aZ + 20],
    at(2.1, R(2.1, -36) - 6, -36), at(1.4, R(1.4, -55) - 8, -54), at(1.1, R(1.1, -80) - 10, -79), at(0.7, R(0.7, -94) - 6, -94),
    mine[1], mine[3], hall.pos, ramp[2], ramp[4], at(-0.1, R(-0.1, -124) - 4, -124), at(-0.9, R(-0.9, -129) - 4, -129), dc,
    at(-2.2, R(-2.2, -142) - 4, -142), at(-2.6, R(-2.6, -180) - 5, -180), [lake.x - 30, -200, lake.z - 20], [lake.x, -200, lake.z + 26],
  ];
  return {
    ledges: { path: pathLedge, ab: abLedge, b: bLedges, mineIn, mineOut, sw: swLedges, e: eLedges, scree },
    W, Rn, settle, spawn, lookout, river: W.river, rimFall, poolA, streamA, lake, gate, mine, hall, ramp, pillars, village, mineLamps,
    campD: { center: dc, th: thD }, secret: { th: thS, pos: at(thS, Rs + 9, -120) }, areas, bench,
    thW, aX, aZ, topA,
  };
}
