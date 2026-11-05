// Первый ярус Бездны: где что стоит. Здесь только «план» — форма (детали SDF), точки и пути.
// Модели расставляет world/props.js, воду — world/water.js, свет и цвет запекает tools/bake-world.mjs.
//
// Стороны: юг +z (θ = 0), восток +x (θ = π/2), север −z (θ = π), запад −x (θ = −π/2). θ = atan2(x, z).
// Посёлок — на северном краю. Под ним — Лесная окраина (терраса), на востоке — Каменные уступы и столбы,
// на юго-востоке — Заброшенная шахта, на западе — Затерянный лагерь на плато, на северо-западе — Большой
// спуск к озеру на дне и закрытому проходу на второй ярус.
import { PIT_DEPTH } from './sdf.js';
import { clamp, makeRng } from '../core/noise.js';

export const LEVEL_SEED = 20261103;

// opt.demo — демоверсия: играем только верх (посёлок, смотровая, уступы к водопаду, терраса, пещера, арка к столбу);
// форма мира (SDF) одна и та же, меняются только сущности и граница глубины (см. L.demo)
export function buildLevel1(W, opt = {}) {
  // демоверсия на форме «разлом» (W.rift): старое содержимое глубин не строится (терраса, шахта, лагерь, озеро…) —
  // вместо него полки-ступени стены, столбы, арка, мыс, пещеры (см. блок «разлом» ниже). Положения старых мест
  // всё равно считаются (на них ссылается остальной код), но скалой не становятся: W.add временно «немой».
  const rift = !!opt.demo && W.rift;
  const realAdd = W.add.bind(W);
  const mute = () => { if (rift) W.add = (ft) => ft; };
  const unmute = () => { W.add = realAdd; };
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
  mute();
  W.slab({
    cx: aX, cz: aZ, rx: 98, rz: 52, top: topA, k: 3,
    bottom: (x, z, T) => T - 11 - 6 * W.n2(x / 19 + 50, z / 19) - 82 * Math.pow(1 - clamp((z + Rn + 2) / 74, 0, 1), 2),
    yMin: -130, yMax: -14,
  });
  unmute();
  // тропа от смотровой площадки вниз на террасу (по стене); в разломе — на первую полку-ступень
  const pathLedge = { th0: N - 0.10, span: 0.40, y0: -1.6, y1: rift ? W.bench(N + 0.30, 0).y + 0.4 : -22.5, depth: 4.6 };
  W.ledge(pathLedge);
  // короткий путь со смотровой к водопаду (демоверсия, но форма — всегда): каменные уступы вдоль стены на восток,
  // между ними — прыжки; перед водопадом провал 7–8 м, над ним кольцо для крюка (раскачка); за провалом —
  // уступ у самой струи и ниша-тайник за ней. Угол θ = N − a (a растёт к востоку)
  const step = (aW, aE, yW, yE, depth = 3.6) => { const l = { th0: N - aE, span: aE - aW, y0: yE, y1: yW, depth, thick: 2.6 }; W.ledge(l); return l; };
  const falls = {
    // (в разломе последний камень длиннее — с разбега не перелететь)
    steps: rift
      ? [step(0.126, 0.166, -1.8, -2.6, 4.0), step(0.178, 0.204, -3.8, -3.8, 4.2), step(0.216, 0.242, -5.6, -5.6, 4.2)]
      : [step(0.126, 0.166, -1.8, -2.6, 4.0), step(0.176, 0.192, -3.7, -3.7), step(0.202, 0.218, -4.9, -4.9), step(0.228, 0.240, -6.0, -6.0, 3.8)],
    far: step(0.276, 0.297, -7.0, -7.2, 3.8),
  };
  {
    const aN = 0.304, rN = R(N - aN, -7.2);
    falls.niche = at(N - aN, rN + 2.6, -6.0);
    W.cave({ x: falls.niche[0], y: falls.niche[1], z: falls.niche[2], rx: 2.8, ry: 2.0, rz: 2.8, floor: -7.2, k: 1.2 });
  }
  // водопад с края падает в заводь на террасе, дальше ручей до края террасы и второй водопад в глубину
  mute();
  const poolA = { x: rimFall[0] - 2, y: -21.6, z: rimFall[2] + 7, water: -22.2 };
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
  // посередине (на уровне первой полки) щель перегорожена каменной перемычкой: по ней можно зайти вглубь —
  // в конце щели тайник (этап 3)
  const crevY = -57.6;
  W.crevice({ th: thC, rIn: R(thC, -60) + 1, rOut: R(thC, 0) + 38, width: 8, yTop: 10, yBot: crevY });
  W.crevice({ th: thC, rIn: R(thC, -60) + 1, rOut: R(thC, 0) + 38, width: 8, yTop: crevY - 6, yBot: -160 });
  const crevRoom = at(thC, R(thC, 0) + 30, crevY + 2.4);
  W.cave({ x: crevRoom[0], y: crevRoom[1], z: crevRoom[2], rx: 5.5, ry: 3.4, rz: 5.5, floor: crevY });
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
  // ——— тайники (этап 3) ———
  // пещера за водопадом: проход из заводи сквозь струю
  const Rwf = R(thW, -22);
  W.tunnel([at(thW, Rwf - 2.5, -23.2), at(thW + 0.01, Rwf + 6, -22.6)], { rad: 2.3, axis: 1.2 });
  const wfRoom = at(thW + 0.02, Rwf + 11, -20.4);
  W.cave({ x: wfRoom[0], y: wfRoom[1], z: wfRoom[2], rx: 6, ry: 3.4, rz: 5.5, floor: -22.6 });
  // боковой штрек из зала шахты: короткий ход в каморку артельщиков
  const mineRoom = at(0.885, Rm + 79, -94.6);
  W.tunnel([at(0.79, Rm + 66, -97), at(0.86, Rm + 75, -96.6), [mineRoom[0], -96.6, mineRoom[2]]], { rad: 2.2, axis: 1.2 });
  W.cave({ x: mineRoom[0], y: mineRoom[1], z: mineRoom[2], rx: 5, ry: 3, rz: 4.5, floor: -96.6 });

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
  lake.y = -PIT_DEPTH - 2.2;
  // островок в озере (на нём — тайник): дно поднимается пологим холмом чуть выше воды
  lake.island = { x: lake.x + 9, z: lake.z - 3, r: 7 };
  {
    const cy = -PIT_DEPTH - 1, fl0 = -PIT_DEPTH - 6, I = lake.island, m = Math.min(lake.rx, 7, lake.rz);
    W.add({
      air: true, k: 3, x0: lake.x - lake.rx, x1: lake.x + lake.rx, z0: lake.z - lake.rz, z1: lake.z + lake.rz, y0: cy - 7, y1: cy + 7,
      sd: (px, py, pz) => {
        const d = Math.hypot(px - I.x, pz - I.z) / I.r;
        const fl = fl0 + (lake.y + 0.7 - fl0) * Math.max(0, 1 - d * d) + 0.3 * W.n2(px / 3, pz / 3);
        return Math.min((1 - Math.hypot((px - lake.x) / lake.rx, (py - cy) / 7, (pz - lake.z) / lake.rz)) * m, py - fl);
      },
    });
  }
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

  unmute();
  // ——— разлом (демоверсия): полка под водопадом с заводью, пещера за струёй, столбы, арка, мыс ———
  let wfTunnel = null;
  const bridge = {};
  if (rift) wfTunnel = riftFeatures({ W, at, R, N, thW, Rw, poolA, streamA, wfRoom, pillars, bridge });

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

  // ——— тросы через провалы и кольца для крюка (этап 2) ———
  // концы тросов — на столбах высотой ~3 м: a — откуда едем (выше), b — куда (ниже); sag — провис посередине
  const groundY = (x, z, yTop, drop = 60) => { const t = W.raycast(x, yTop, z, 0, -1, 0, drop); return t < 0 ? yTop - drop : yTop - t; };
  const post = (x, z, yTop, h) => [x, groundY(x, z, yTop) + h, z];
  const zips = [];
  // край опоры по направлению (ux, uz) от точки: где земля обрывается вниз больше чем на 2.5 м
  const edgeDist = (cx, cz, ux, uz, yTop, maxD = 40) => {
    const y0 = groundY(cx, cz, yTop);
    let d = 0;
    for (let q = 0.5; q < maxD; q += 0.5) { if (groundY(cx + ux * q, cz + uz * q, yTop) < y0 - 2.5) return d; d = q; }
    return d;
  };
  // трос от точки from (на опоре) к точке to: столбы ставим у краёв, высоту поднимаем, пока висящий герой
  // не задевает скалу по пути (туловище — до 2.2 м под тросом)
  const addZip = (name, from, to, yTopA, yTopB, extra = {}) => {
    const dx = to[0] - from[0], dz = to[2] - from[2], d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d;
    const ea = edgeDist(from[0], from[2], ux, uz, yTopA), eb = edgeDist(to[0], to[2], -ux, -uz, yTopB);
    // край не нашёлся (ровное место) — ставим столб прямо в точке
    const ma = ea >= 39 ? 0 : Math.max(0, ea - 1.6), mb = eb >= 39 ? 0 : Math.max(0, eb - 2.2);
    const ax = from[0] + ux * ma, az = from[2] + uz * ma, bx = to[0] - ux * mb, bz = to[2] - uz * mb;
    const z = { name, a: post(ax, az, yTopA, 3.0), b: post(bx, bz, yTopB, 2.7), sag: extra.sag || 1.0, ...extra };
    for (let k = 0; k < 12; k++) {
      let bad = -1;
      for (let i = 2; i < 59 && bad < 0; i++) {
        const u = i / 60, x = z.a[0] + (z.b[0] - z.a[0]) * u, y = z.a[1] + (z.b[1] - z.a[1]) * u - z.sag * 4 * u * (1 - u), zz = z.a[2] + (z.b[2] - z.a[2]) * u;
        for (const h of [0.3, 1.1, 2.2]) if (W.f(x, y - h, zz) < 0.3) { bad = u; break; }
      }
      if (bad < 0) break;
      if (bad < 0.5) z.a[1] += 0.5; else z.b[1] += 0.5;
    }
    z.postA = z.a[1] - groundY(z.a[0], z.a[2], yTopA);
    z.postB = z.b[1] - groundY(z.b[0], z.b[2], yTopB);
    zips.push(z);
  };
  {
    // со смотровой площадки на Лесную окраину (столб — прямо на настиле)
    const b = lookout.b;
    zips.push({ name: 'смотровая → терраса', a: [b[0] + 1.6, 0.35 + 2.9, b[2] - 1.4], b: post(28, -176, -10, 2.7), sag: 1.2, deck: true, postA: 2.9, postB: 2.7 });
    // цепочка по столбам Каменных уступов: столб 4 → 1 → 2 → 3 → площадка шахты (обходной путь)
    const chain = [pillars[3], pillars[0], pillars[1], pillars[2]];
    for (let i = 0; i < chain.length; i++) {
      const A = chain[i], last = i === chain.length - 1;
      const to = last ? at(0.98, R(0.98, -93) - 3.2, -93) : chain[i + 1].pos;
      addZip(last ? 'столб → шахта' : 'столб → столб', A.pos, to, A.top + 12, to[1] + 12);
    }
    // с Затерянного лагеря — длинный трос на дно
    addZip('лагерь → дно', at(thD, Rd - 50, -120), at(0.3, 60, -204), -100, -190, { sag: 3 });
  }
  // кольца — особые точки: видно издалека, крюк достаёт дальше (40 м); стоят над хорошими спусками
  const rings = [];
  {
    // на скале: идём от центра Бездны к стене на высоте y, пока не упрёмся — кольцо в 0.45 м от камня
    const ringOn = (th, y) => {
      for (let r = R(th, y) - 20; r < R(th, y) + 15; r += 0.25) { const p = at(th, r, y); if (W.f(p[0], p[1], p[2]) < 0.45) return p; }
      return at(th, R(th, y), y);
    };
    rings.push({ name: 'конец полки к уступам', pos: ringOn(1.775, -45.5) });       // быстрый спуск мимо зигзага
    rings.push({ name: 'край плато лагеря', pos: ringOn(-1.70, -117.5) });           // вниз на полки Большого спуска
    rings.push({ name: 'над осыпью', pos: ringOn(-2.53, -166.5) });                  // с последней полки — к озеру
  }

  // ——— находки в тайниках и записки прошлой экспедиции (этап 3) ———
  const onGround = (x, z, yTop, drop = 30) => [x, groundY(x, z, yTop, drop), z];
  const secretPos = at(thS, Rs + 9, -120);
  const finds = [
    { id: 'compass', name: 'Старый компас', where: 'за водопадом', pos: onGround(wfRoom[0], wfRoom[2], rift ? wfRoom[1] + 1.5 : -19) },
    { id: 'map', name: 'Карта первого яруса', where: 'в глубине расщелины', pos: onGround(crevRoom[0], crevRoom[2], crevY + 3) },
    { id: 'lamp', name: 'Шахтёрская лампа', where: 'в каморке у зала шахты', pos: onGround(mineRoom[0], mineRoom[2], -93) },
    { id: 'badge', name: 'Знак экспедиции', where: 'в тайнике за лагерем', pos: onGround(secretPos[0], secretPos[2], -116) },
    { id: 'crystal', name: 'Поющий кристалл', where: 'на островке в озере', pos: onGround(lake.island.x, lake.island.z, -200) },
  ];
  const hallHouse = village.houses.find((h) => h.hall);
  const ledgePt = (l, u, inset) => { const th = l.th0 + l.span * u, y = l.y0 + (l.y1 - l.y0) * u, r = R(th, y) - inset; return [Math.sin(th) * r, y, Math.cos(th) * r]; };
  const B1n = ledgePt(bLedges[0], 0.5, 1.4), mineN = ledgePt(mineIn, 0.25, 1.6);
  const gdx = gate.outer[0] - gate.inner[0], gdz = gate.outer[2] - gate.inner[2], gl = Math.hypot(gdx, gdz);
  // ——— ресурсы (этап 4): у каждой области свои — дерево в лесу и в лагере, камень на уступах и осыпи,
  // руда только в шахте (и немного — в глубине расщелины: опасно, зато богато), грибы в лесу, светогрибы на дне
  const resources = [];
  {
    const rng = makeRng(4404);
    const okGround = (x, z, yTop, drop = 30) => {
      const y = groundY(x, z, yTop, drop);
      if (y <= yTop - drop + 0.01 || W.f(x, y + 1.2, z) < 0.6) return null;     // нет опоры или тесно
      return [x, y, z];
    };
    const push = (type, n, pick, yTop, drop, near = 0) => {
      for (let tries = 0, k = 0; k < n && tries < n * 30; tries++) {
        const [x, z] = pick();
        const p = okGround(x, z, yTop, drop);
        if (!p) continue;
        if (resources.some((r) => Math.hypot(r.pos[0] - p[0], r.pos[2] - p[2]) < 3)) continue;
        if (Math.hypot(p[0] - poolA.x, p[2] - poolA.z) < 10) continue;
        resources.push({ id: `res:${type}${resources.length}`, type, pos: p, rich: near });
        k++;
      }
    };
    const ell = (cx, cz, rx, rz) => () => { const a = rng() * Math.PI * 2, k = Math.sqrt(rng()); return [cx + Math.cos(a) * rx * k, cz + Math.sin(a) * rz * k]; };
    // дерево: лесная терраса, лес у посёлка, сухостой у лагеря
    push('wood', 14, ell(aX, aZ, 90, 46), -12, 40);
    push('wood', 5, () => { const a = N + (rng() - 0.5) * 1.2, r = Rn + 25 + rng() * 40; return [Math.sin(a) * r, Math.cos(a) * r]; }, 20, 30);
    push('wood', 5, ell(dc[0], dc[2], 34, 34), -100, 40);
    // камень: полки уступов, площадка шахты, осыпь
    for (const l of [...bLedges, abLedge]) for (const u of [0.3, 0.7]) {
      const th = l.th0 + l.span * u, y = l.y0 + (l.y1 - l.y0) * u, r = R(th, y) - 1.8;
      const p = okGround(Math.sin(th) * r, Math.cos(th) * r, y + 4, 8);
      if (p) resources.push({ id: `res:stone${resources.length}`, type: 'stone', pos: p });
    }
    for (const u of [0.2, 0.45, 0.7, 0.9]) {
      const th = scree.th0 + scree.span * u, y = scree.y0 + (scree.y1 - scree.y0) * u, r = R(th, y) - 3;
      const p = okGround(Math.sin(th) * r, Math.cos(th) * r, y + 5, 10);
      if (p) resources.push({ id: `res:stone${resources.length}`, type: 'stone', pos: p });
    }
    // руда: вдоль тоннелей шахты у стен, в зале, в каморке; две жилы — в глубине расщелины
    for (const path of [mine, ramp]) for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], dx = b[0] - a[0], dz = b[2] - a[2], d = Math.hypot(dx, dz);
      for (const t of [0.35, 0.8]) {
        const side = (i + (t > 0.5 ? 1 : 0)) % 2 ? 1 : -1;
        const x = a[0] + dx * t + (-dz / d) * 2.3 * side, z = a[2] + dz * t + (dx / d) * 2.3 * side;
        const p = okGround(x, z, a[1] + (b[1] - a[1]) * t + 2.5, 6);
        if (p) resources.push({ id: `res:ore${resources.length}`, type: 'ore', pos: p });
      }
    }
    for (const k of [0, 1, 2, 3]) {
      const a = k * 1.57 + 0.4, x = hall.pos[0] + Math.cos(a) * hall.rx * 0.7, z = hall.pos[2] + Math.sin(a) * hall.rz * 0.7;
      const p = okGround(x, z, hall.floor + 3, 6);
      if (p) resources.push({ id: `res:ore${resources.length}`, type: 'ore', pos: p });
    }
    for (const [dx, dz] of [[2.5, 1], [-2, -1.5]]) {
      const p = okGround(mineRoom[0] + dx, mineRoom[2] + dz, -94, 6);
      if (p) resources.push({ id: `res:ore${resources.length}`, type: 'ore', pos: p, rich: 1 });
    }
    for (const off of [18, 24]) {
      const p0 = at(thC, R(thC, -60) + off, crevY);
      const p = okGround(p0[0], p0[2], crevY + 3, 6);
      if (p) resources.push({ id: `res:ore${resources.length}`, type: 'ore', pos: p, rich: 1 });
    }
    // грибы: лес (обычные), дно и нижние полки (светогрибы — для похлёбки)
    push('mushroom', 8, ell(aX - 10, aZ - 10, 80, 40), -12, 40);
    push('glowshroom', 6, () => { const a = rng() * Math.PI * 2, r = 30 + rng() * 120; return [Math.sin(a) * r, Math.cos(a) * r]; }, -190, 25);
    for (const l of eLedges.slice(1, 4)) {
      const u = 0.5, th = l.th0 + l.span * u, y = l.y0 + (l.y1 - l.y0) * u, r = R(th, y) - 2;
      const p = okGround(Math.sin(th) * r, Math.cos(th) * r, y + 4, 8);
      if (p) resources.push({ id: `res:glowshroom${resources.length}`, type: 'glowshroom', pos: p });
    }
  }
  // логово скальника — на дне, на западе, подальше от озера, осыпи и конца троса; вокруг гуще светогрибы
  const beast = { home: [0, 0, 0], leash: 38 };
  {
    const a = 4.54, r = 120, x = Math.sin(a) * r, z = Math.cos(a) * r;
    beast.home = [x, groundY(x, z, -150, 80), z];
    for (let k = 0; k < 4; k++) {
      const b = k * 1.7 + 0.4, q = 6 + k * 2.2, px = x + Math.cos(b) * q, pz = z + Math.sin(b) * q;
      resources.push({ id: `res:glowden${k}`, type: 'glowshroom', pos: [px, groundY(px, pz, -150, 80), pz], rich: 1 });
    }
  }
  // завал в штреке к каморке у зала шахты — разобрать можно только киркой
  const rubble = [];
  {
    const a = at(0.79, Rm + 66, -97), b = at(0.86, Rm + 75, -96.6);
    const m = [(a[0] + b[0]) / 2, groundY((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, -95.5, 6), (a[2] + b[2]) / 2];
    rubble.push({ id: 'rubble:mine', pos: m, rot: Math.atan2(b[0] - a[0], b[2] - a[2]) });
  }
  // верстак и печь: в посёлке у Дома экспедиций; верстак ещё в зале шахты, печь — у Затерянного лагеря
  const stations = [];
  {
    const h = village.houses.find((q) => q.hall);
    stations.push({ id: 'st:bench1', type: 'workbench', pos: [h.x - 6, groundY(h.x - 6, h.z + 9, 10), h.z + 9], name: 'верстак в посёлке' });
    stations.push({ id: 'st:furnace1', type: 'furnace', pos: [h.x + 9, groundY(h.x + 9, h.z + 9.5, 10), h.z + 9.5], name: 'печь в посёлке' });
    stations.push({ id: 'st:bench2', type: 'workbench', pos: [hall.pos[0] - 5, hall.floor, hall.pos[2] - 3], name: 'верстак в шахте', model: false });
    const fx = dc[0] + Math.sin(thD) * 8, fz = dc[2] + Math.cos(thD) * 8;
    stations.push({ id: 'st:furnace2', type: 'furnace', pos: [fx, groundY(fx, fz, -100, 40), fz], name: 'печь у лагеря' });
  }

  const notes = [
    { id: 'n1', at: onGround(hallHouse.x + 4.5, hallHouse.z + 7.5, 10), title: 'Дневник проводника. День 1',
      text: 'Мы уходим вниз за светом, который горит на дне Бездны. В посёлке говорят: кто спустился, тот уже не тот, что был наверху. Посмотрим. Взяли верёвки, крюки и три недели припасов.' },
    { id: 'n2', at: onGround(lookout.a[0] + 4, lookout.a[2] - 1, 10), title: 'Табличка у смотровой',
      text: 'Через перила не лазить. Тропа вниз — по стене, правее площадки. Трос на террасу — только с крюком, и держись крепче.' },
    { id: 'n3', at: onGround(poolA.x - 10, poolA.z + 1, -10), title: 'Дневник. День 3',
      text: 'Лагерь у водопада — последнее место, где пахнет домом. Вода в заводи ледяная и чистая. Старый Мирон клянётся, что за струёй водопада кто-то прятал припасы.' },
    { id: 'n4', at: onGround(B1n[0], B1n[2], B1n[1] + 4), title: 'Нацарапано на камне',
      text: 'Полки идут зигзагом: спускайся по стене у конца каждой — нижняя всегда заходит дальше. Смелые катаются по тросам между столбами. В глубокой щели рядом — каменная перемычка, по ней можно пройти вглубь.' },
    { id: 'n5', at: onGround(mineN[0], mineN[2], mineN[1] + 4), title: 'Объявление артели',
      text: 'Шахта закрыта после обвала. Кристаллы в зале не ломать — в руках они гаснут. Выход — наклонным штреком вниз. Инструмент сдать в каморку у зала.' },
    { id: 'n6', at: onGround(hall.pos[0] - 4, hall.pos[2] + 4.5, -93), title: 'Дневник. День 9',
      text: 'В зале кристаллы светятся сами. Ночью они звенят — тихо, как ветер в печной трубе. Если петь в ответ, звон становится громче. Глупости, конечно.' },
    { id: 'n7', at: onGround(dc[0] + Math.sin(thD) * 6 + 3, dc[2] + Math.cos(thD) * 6, -112), title: 'Дневник. День 14',
      text: 'Плато пустое. Палатки стоят, будто люди отошли на минуту. В стене за лагерем — узкая щель, оттуда тянет теплом. Дальше вниз — только по полкам или по длинному тросу.' },
    { id: 'n8', at: onGround(gate.inner[0] - (gdx / gl) * 4, gate.inner[2] - (gdz / gl) * 4, -198), title: 'Последняя запись',
      text: 'Решётка заперта снизу. Значит, там кто-то есть — или был. Озеро светится по ночам, а на островке что-то блестит. Мы дождёмся, когда проход откроется.' },
  ];

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
  // ——— демоверсия: только верх яруса. Ниже границы — туман глубины (сорвался туда — очнулся у лагеря).
  // Остаются: посёлок, смотровая, тропа по стене, уступы к водопаду с кольцом, терраса с лесом, пещера за
  // водопадом (завал — нужна кирка), арка к ближнему столбу (вид в глубину). Тросы — только смотровая → терраса.
  let demo = null;
  if (opt.demo) {
    demo = { floor: rift ? -58 : -42, falls, rift, bridge: rift ? bridge : null };
    const keep = (p) => p[1] > demo.floor;
    const ringOn = (th, y) => { for (let r = R(th, y) - 20; r < R(th, y) + 15; r += 0.25) { const p = at(th, r, y); if (W.f(p[0], p[1], p[2]) < 0.45) return p; } return at(th, R(th, y), y); };
    rings.length = 0;
    if (rift) {
      // кольцо над провалом: там, откуда его видно с конца последнего камня (прицел не упирается в скалу),
      // и чтобы с него долететь до дальнего уступа
      const sl = falls.steps[falls.steps.length - 1], thE = sl.th0 + 0.002, yE = sl.y0 + 1.4;
      const eye = at(thE, R(thE, sl.y0) - 1.6, yE);
      // ближе к стене — лучше (дальний уступ узкий: раскачка должна проходить над ним), но прицел — свободен
      let best = null, bestScore = -1e9;
      for (const da of [0.012, 0.016, 0.02, 0.024]) for (const y of [-1.2, -2.0, -2.8]) for (const outw of [2.6, 3.2, 3.8, 4.6]) {
        const th = sl.th0 - da, c = at(th, R(th, y) - outw, y);
        let minF = 1e9;
        for (let i = 1; i < 20; i++) { const t = i / 20; minF = Math.min(minF, W.f(eye[0] + (c[0] - eye[0]) * t, eye[1] + (c[1] - eye[1]) * t, eye[2] + (c[2] - eye[2]) * t)); }
        const score = -outw * 2 - Math.abs(da - 0.018) * 40 + Math.min(minF, 1.2);
        if (minF > 0.85 && W.f(c[0], c[1], c[2]) > 1.2 && score > bestScore) { bestScore = score; best = c; }
      }
      rings.push({ name: 'над провалом у водопада', pos: best || at(N - 0.26, R(N - 0.26, -1.6) - 4.5, -1.6) });
    } else {
      const ringP = ringOn(N - 0.258, -0.6);
      const out = at(N - 0.258, R(N - 0.258, -0.6) - 2.6, -0.6);           // кольцо — на 2.6 м от стены, над серединой провала
      rings.push({ name: 'над провалом у водопада', pos: Math.hypot(ringP[0], ringP[2]) > Math.hypot(out[0], out[2]) ? out : ringP });
    }
    zips.length = 1;
    if (rift) {
      // трос со смотровой — на ближний столб с лесом наверху (над пустотой)
      const P1 = pillars[0], b = lookout.b, dx = b[0] - P1.pos[0], dz = b[2] - P1.pos[2], dl = Math.hypot(dx, dz);
      const tx = P1.pos[0] + (dx / dl) * P1.rad * 0.55, tz = P1.pos[2] + (dz / dl) * P1.rad * 0.55;
      zips[0] = { name: 'смотровая → столб', a: [b[0] + 1.6, 0.35 + 2.9, b[2] - 1.4], b: post(tx, tz, P1.top + 4, 2.7), sag: 1.6, deck: true, postA: 2.9, postB: 2.7 };
    }
    finds.length = 1;                                                     // компас — в пещере за водопадом (за завалом)
    finds.push({ id: 'charm', name: 'Оберег первопроходца', where: 'в нише за струёй водопада', pos: onGround(falls.niche[0], falls.niche[2], -5.5, 4) });
    for (let i = notes.length - 1; i >= 0; i--) if (!keep(notes[i].at)) notes.splice(i, 1);
    notes.push({ id: 'n9', at: onGround(...(() => { const p = at(N - 0.150, R(N - 0.150, -2.2) - 2.2, -2.2); return [p[0], p[2]]; })(), 0, 6), title: 'Метка на камне',
      text: 'Короткая дорога к водопаду. Камни шатаются, прыгать — с разбега. Над провалом мы вбили кольцо: зацепись крюком, шагни вниз и раскачайся. Кто дошёл — загляни за струю.' });
    for (let i = resources.length - 1; i >= 0; i--) if (!keep(resources[i].pos)) resources.splice(i, 1);
    if (rift) {
      // в разломе ресурсы — заново: на первой полке (дерево, камни, грибы, ягоды), наверху — что было у посёлка
      for (let i = resources.length - 1; i >= 0; i--) if (resources[i].pos[1] < -3) resources.splice(i, 1);
      const rngR = makeRng(6606);
      const onShelf = (type, n, th0, th1, rich = 0) => {
        for (let t = 0, k = 0; t < 300 && k < n; t++) {
          const th = th0 + rngR() * (th1 - th0), b = W.bench(th, 0);
          const rIn = R(th, b.y - 2.5), rOut = R(th, b.y + 2.5);
          if (rOut - rIn < 7) continue;
          // не у края полки (там она скругляется вниз — съедешь) и не под нависанием
          const r = rIn + 3.5 + rngR() * (rOut - rIn - 5.5), x = Math.sin(th) * r, z = Math.cos(th) * r, y = groundY(x, z, b.y + 4, 8);
          if (Math.abs(y - b.y) > 2 || W.f(x, y + 1.0, z) < 0.9 || W.f(x, y + 2.0, z) < 0.9 || Math.hypot(x - poolA.x, z - poolA.z) < 9) continue;
          const nrm = { x: 0, y: 0, z: 0 };
          if (W.normal(x, y + 0.2, z, nrm).y < 0.9) continue;
          if (resources.some((q) => Math.hypot(q.pos[0] - x, q.pos[2] - z) < 4)) continue;
          resources.push({ id: `res:r${type}${k}`, type, pos: [x, y, z], rich: k < rich ? 1 : 0 }); k++;
        }
      };
      onShelf('wood', 8, N - 0.25, N + 0.45, 3);
      onShelf('stone', 9, N - 0.25, N + 0.45, 2);
      onShelf('mushroom', 5, N - 0.2, N + 0.4);
      onShelf('berry', 4, N - 0.1, N + 0.4);
    }
    // камни: у подножия стены на террасе и на уступах; подготовленные — поваленные стволы и груды камней (×2)
    {
      const rng = makeRng(5505);
      let n = 0;
      for (let t = 0; t < 400 && n < (rift ? 0 : 9); t++) {
        const th = N - 0.45 + rng() * 0.9, y0 = rift ? W.bench(th, 0).y + 6 : -18, r = rift ? R(th, y0 - 8) - 1.5 - rng() * 6 : R(th, -24) - 3 - rng() * 10;
        const x = Math.sin(th) * r, z = Math.cos(th) * r;
        const y = groundY(x, z, y0, 25);
        if (y < -36 || W.f(x, y + 1.2, z) < 0.6 || Math.hypot(x - poolA.x, z - poolA.z) < 10) continue;
        if (resources.some((q) => Math.hypot(q.pos[0] - x, q.pos[2] - z) < 4)) continue;
        resources.push({ id: `res:dstone${n}`, type: 'stone', pos: [x, y, z], rich: n < 3 ? 1 : 0 }); n++;
      }
      for (const l of rift ? [] : falls.steps.slice(1, 3)) {
        const th = l.th0 + l.span * 0.5, y = l.y0, r = R(th, y) - 1.6;
        resources.push({ id: `res:dstep${resources.length}`, type: 'stone', pos: [Math.sin(th) * r, groundY(Math.sin(th) * r, Math.cos(th) * r, y + 2, 4), Math.cos(th) * r], rich: 0 });
      }
      const woods = resources.filter((q) => q.type === 'wood');
      woods.slice(0, 4).forEach((q) => { q.rich = 1; });                 // поваленные стволы — дерева вдвое
    }
    // светогрибы — в тёмной пещере за водопадом
    {
      const pts = [[wfRoom[0] + 3, wfRoom[2] + 1.5], [wfRoom[0] - 2.5, wfRoom[2] + 2], [wfRoom[0] + 1, wfRoom[2] - 3]];
      pts.forEach(([x, z], i) => resources.push({ id: `res:dglow${i}`, type: 'glowshroom', pos: [x, groundY(x, z, rift ? wfRoom[1] + 1 : -19.5, 6), z] }));
    }
    // завал в проходе за водопадом: к компасу — только с киркой (делается в рюкзаке: 3 дерева + 2 камня)
    rubble.length = 0;
    {
      const a = wfTunnel ? wfTunnel[0] : at(thW, Rwf - 2.5, -23.2), b = wfTunnel ? wfTunnel[1] : at(thW + 0.01, Rwf + 6, -22.6), u = 0.72;
      const x = a[0] + (b[0] - a[0]) * u, z = a[2] + (b[2] - a[2]) * u;
      rubble.push({ id: 'rubble:falls', pos: [x, groundY(x, z, (a[1] + b[1]) / 2 + 1.5, 4), z], rot: Math.atan2(b[0] - a[0], b[2] - a[2]) });
    }
    stations.length = 0;
    if (rift) {
      // области и облёт для «Замера» — по новому месту
      areas.length = 0;
      areas.push(
        { id: 'village', name: 'Посёлок у края', test: (x, y, z) => y > -4 && Math.hypot(x, z) > Rn - 12 },
        { id: 'rim', name: 'Край Бездны', test: (x, y) => y > -6 },
        { id: 'shelf', name: 'Первая ступень', test: (x, y) => y > -30 },
        { id: 'mist', name: 'Туман глубины', test: () => true },
      );
      const P1 = pillars[0];
      bench.length = 0;
      bench.push(spawn, [0, 2, settle.z + 30], lookout.b, at(N - 0.2, Rn - 4, -4), [poolA.x, poolA.y + 3, poolA.z],
        at(N + 0.2, R(N + 0.2, -14) - 6, -14), at(N + 0.55, R(N + 0.55, -10) - 14, -9), [P1.pos[0], P1.top + 3, P1.pos[2]],
        at(N - 0.1, Rn - 30, -36), at(N + 0.1, Rn - 40, -50), lookout.b, [0, 2, settle.z + 30]);
    }
  }

  return {
    demo,
    ledges: { path: pathLedge, ab: abLedge, b: bLedges, mineIn, mineOut, sw: swLedges, e: eLedges, scree }, zips, rings, finds, notes,
    secrets: { wfRoom, crevRoom, crevY, mineRoom, thC }, resources, stations, rubble, beast: opt.demo ? null : beast,
    W, Rn, settle, spawn, lookout, river: W.river, rimFall, poolA, streamA, lake, gate, mine, hall, ramp, pillars, village, mineLamps,
    campD: { center: dc, th: thD }, secret: { th: thS, pos: at(thS, Rs + 9, -120) }, areas, bench,
    thW, aX, aZ, topA,
  };
}

// ——— форма мира для демоверсии: «разлом» и где на нём полки пошире (у посёлка, под водопадом) ———
export function riftOptions() {
  const N = Math.PI;
  return {
    rift: true,
    benchBoost: [
      { k: 0, th: N, span: 0.62, width: 12, y: -17, noUnder: true },          // первая полка под посёлком
      { k: 0, th: N - 0.30, span: 0.16, width: 17, y: -17, noUnder: true, noLip: true },   // под водопадом — широкая (заводь)
      { k: 1, th: N + 0.1, span: 0.55, width: 11, y: -38 },                    // вторая — в тумане
    ],
  };
}

// ——— разлом: что стоит в демо на месте старой террасы и глубин ———
// Заводь на первой полке там, куда падает водопад с края; ручей к краю полки (оттуда — второй водопад в туман);
// пещера прямо за струёй; столбы в пустоте на разной высоте (одни поднимаются из тумана); каменная арка от
// высокого столба к дальней стене; мыс — огромная плита над пустотой; тёмные входы пещер и трещины в дальних стенах.
function riftFeatures({ W, at, R, N, thW, Rw, poolA, streamA, wfRoom, pillars, bridge }) {
  // 1. заводь: куда долетает вода с края (горизонтально ~2.8 м/с)
  const yb = W.bench(thW, 0).y;
  const land = 2.8 * Math.sqrt((2 * Math.max(4, -yb)) / 9.8);
  const Rwall = R(thW, yb + 2.5), Rin = R(thW, yb - 2.5);
  const rp = Math.min(Rwall - 4.5, Math.max(Rin + 6, Rw - 1.5 - land));
  const p = at(thW, rp, yb);
  Object.assign(poolA, { x: p[0], z: p[2], y: yb, water: yb - 0.55 });
  W.cave({ x: p[0], y: yb, z: p[2], rx: 6.0, ry: 2.4, rz: 5.2, floor: yb - 1.5, k: 1.4 });
  // 2. ручей к краю полки
  const e1 = at(thW - 0.01, Rin + 0.8, yb - 0.5);
  streamA.length = 0;
  streamA.push([p[0], yb - 0.4, p[2]], [(p[0] + e1[0]) / 2, yb - 0.45, (p[2] + e1[2]) / 2], e1);
  W.channel(streamA, { half: 2.2, depth: 0.7, yMin: yb - 4, yMax: yb + 3 });
  // 3. пещера за струёй
  const t0 = at(thW + 0.004, Rwall - 2.2, yb), t1 = at(thW + 0.016, Rwall + 6, yb + 0.2);
  W.tunnel([t0, t1], { rad: 2.4, axis: 1.2 });
  const room = at(thW + 0.03, Rwall + 11, yb + 1.8);
  wfRoom[0] = room[0]; wfRoom[1] = room[1]; wfRoom[2] = room[2];
  W.cave({ x: room[0], y: room[1], z: room[2], rx: 6, ry: 3.4, rz: 5.5, floor: yb + 0.2 });
  // 4. столбы в пустоте
  // останцы — на разной высоте и глубине (одни выше края полки, другие поднимаются из тумана): слоями
  // закрывают друг друга и дальнюю стену — так видно масштаб, а всё сразу — не видно
  const P = [
    { th: N - 0.43, r: 0, top: -14.5, rad: 9, lean: 0.03, dir: 0.4 },      // ближний, с лесом наверху (трос, мост)
    { th: N + 0.74, r: 120, top: -26, rad: 8, lean: 0.06, dir: 2.0 },       // тонкий, слева
    { th: 0.62, r: 92, top: -48, rad: 16, lean: 0.04, dir: 3.6 },           // большой, посередине
    { th: -0.38, r: 126, top: -18, rad: 11, lean: 0.05, dir: 5.1 },         // высокий у дальней стены, от него арка
    { th: 2.2, r: 146, top: -80, rad: 18, lean: 0.03, dir: 1.2 },           // низкий, в тумане
    { th: N - 1.05, r: 128, top: -34, rad: 9, lean: 0.07, dir: 4.2 },       // справа, за водопадом
    { th: 0.05, r: 40, top: -62, rad: 20, lean: 0.02, dir: 0.9 },           // огромный в середине, макушка в тумане
    { th: -1.15, r: 150, top: -40, rad: 10, lean: 0.05, dir: 2.7 },         // у западной стены
    { th: 1.6, r: 120, top: -30, rad: 9, lean: 0.06, dir: 5.6 },            // у восточной стены
  ];
  // ближний — у края первой полки (между ними — верёвочный мост)
  { const q = P[0], bq = W.bench(q.th, 0), Re = R(q.th, bq.y - 3); q.r = Re - q.rad - 12; }
  for (const q of P) q.pos = at(q.th, q.r, q.top);
  pillars.length = 0;
  pillars.push(...P);
  for (const q of P) W.pillar({ x: q.pos[0], z: q.pos[2], r: q.rad, top: q.top, lean: q.lean, leanDir: q.dir });
  // 5. арка от высокого столба к дальней стене
  const p4 = P[3], ta = p4.th + 0.1, wall = at(ta, R(ta, -40) + 4, -40);
  W.arch([p4.pos[0], -37, p4.pos[2]], wall, { r: 3.6, sag: 6 });
  // 6. мыс: плита над пустотой у западного конца первой полки
  const ts = N + 0.55, ys = W.bench(ts, 0).y + 1.5, Rs = R(ts, ys);
  const cS = at(ts, Rs - 10, ys), rot = Math.atan2(Math.cos(ts), Math.sin(ts));
  W.slab({
    cx: cS[0], cz: cS[2], rx: 15, rz: 7.5, rot, k: 2, edge: 2.5, yMin: ys - 40, yMax: ys + 3,
    top: (x, z) => ys + 0.5 * W.n2(x / 6, z / 6),
    bottom: (x, z, T) => { const t = Math.min(1, Math.max(0, (Math.hypot(x, z) - (Rs - 22)) / 22)); return T - 3 - 26 * t * t; },
  });
  // 7. тёмные входы пещер и трещины в дальних стенах
  for (const [th, y, rad] of [[0.12, -30, 7], [-0.95, -52, 9], [1.35, -24, 6], [0.85, -74, 10], [-2.2, -36, 8]]) {
    const w = at(th, R(th, y) + rad * 0.5, y);
    W.cave({ x: w[0], y, z: w[2], rx: rad, ry: rad * 0.8, rz: rad, floor: y - rad * 0.45 });
  }
  for (const [th, wd, yTop, yBot] of [[0.34, 7, 6, -150], [-1.15, 9, 4, -170], [1.9, 6, 2, -120]]) {
    W.crevice({ th, rIn: R(th, -40) - 2, rOut: R(th, 0) + 30, width: wd, yTop, yBot });
  }
  // 8. мост: с края первой полки на ближний останец
  {
    const q = P[0], bq = W.bench(q.th, 0), Re = R(q.th, bq.y - 3);
    const a0 = at(q.th, Re + 1.2, bq.y), aY = a0[1];
    const b0 = at(q.th, q.r + q.rad * 0.7, q.top);
    bridge.a = [a0[0], aY + 0.05, a0[2]]; bridge.b = [b0[0], q.top + 0.05, b0[2]]; bridge.sag = 1.6;
  }
  // 9. лагерь (точка сохранения) — на полке между водопадом и концом тропы, не под струёй
  {
    const th = N - 0.1, bq = W.bench(th, 0), r = R(th, bq.y + 2) - 5;
    bridge.camp = at(th, r, bq.y);
  }
  return [t0, t1];
}
