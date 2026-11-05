// Что где растёт и что светится. Используется при запекании мира (tools/bake-world.mjs):
//   scatterRules — правила расстановки растений и камней по областям (каждый вид — своя модель в игре);
//   bakedLights  — источники света, которые «запекаются» в скалы (фонари, лампы шахты, кристаллы).
// Без three.js. Виды (kind) должны совпадать с таблицей моделей в world/props.js.
import { makeRng } from '../core/noise.js';

const TAU = Math.PI * 2;

export function scatterRules(W, L) {
  const rules = [];
  const nearZip = (x, z) => (L.zips || []).some((q) => Math.hypot(x - q.a[0], z - q.a[2]) < 6 || Math.hypot(x - q.b[0], z - q.b[2]) < 7);
  const settleD = (x, z) => Math.hypot(x - L.settle.x, z - L.settle.z);
  const onPath = (x, z) => Math.abs(x - L.settle.x) < 9 && z > L.settle.z && z < -(L.Rn - 10);
  const nearLookout = (x, z) => Math.hypot(x - L.lookout.b[0], z - L.lookout.b[2]) < 18;
  const nearVillage = (x, z) => {
    for (const h of L.village.houses) if (Math.hypot(x - h.x, z - h.z) < 12 + h.w * 1.2) return true;
    return Math.hypot(x - L.village.windmill[0], z - L.village.windmill[1]) < 10 || Math.hypot(x - L.village.watermill[0], z - L.village.watermill[1]) < 9;
  };
  // верхний мир: кольцо вокруг Бездны
  const ring = (rMin, rMax) => (rng) => {
    const a = rng() * TAU, rr = W.pitR(Math.cos(a), Math.sin(a), 0);
    const r = rr + rMin + Math.sqrt(rng()) * (rMax - rMin);
    return [Math.sin(a) * r, Math.cos(a) * r];
  };
  const upperOk = (gap) => (x, y, z) => settleD(x, z) > gap && !onPath(x, z) && !nearLookout(x, z) && !nearVillage(x, z) && (!W.river || W.riverDist(x, z) > 7);
  const up = { yTop: 45, yBot: -8, minNy: 0.78 };
  let seed = 100;
  const add = (kind, count, s0, s1, extra) => rules.push({ kind, count, s0, s1, seed: seed++, ...up, ...extra });

  // ——— лес наверху (гуще у края и у посёлка) ———
  add('oak', 80, 4.2, 6.2, { pick: ring(12, 190), ok: upperOk(48) });
  add('pine', 80, 4.5, 6.8, { pick: ring(12, 190), ok: upperOk(48) });
  add('pineTall', 50, 4.0, 5.6, { pick: ring(20, 200), ok: upperOk(55) });
  add('round', 45, 4.2, 6.0, { pick: ring(12, 170), ok: upperOk(48) });
  add('fat', 30, 4.4, 6.0, { pick: ring(12, 170), ok: upperOk(48) });
  add('bush', 160, 2.4, 3.6, { pick: ring(6, 150), ok: upperOk(26) });
  add('grass', 800, 1.6, 2.6, { pick: ring(3, 90), ok: upperOk(14) });
  add('flowerY', 160, 1.6, 2.2, { pick: ring(4, 110), ok: upperOk(14) });
  add('flowerR', 120, 1.6, 2.2, { pick: ring(4, 110), ok: upperOk(14) });
  add('rock', 70, 2.2, 4.5, { pick: ring(6, 220), ok: upperOk(30) });

  if (W.rift && L.demo) return rules.concat(riftRules(W, L, add, nearZip));

  // ——— 1. Лесная окраина (терраса под посёлком) ———
  const inA = (rng) => {
    const a = rng() * TAU, k = Math.sqrt(rng());
    return [L.aX + Math.cos(a) * 96 * k, L.aZ + Math.sin(a) * 50 * k];
  };
  // (x, y, z) — так зовёт запекание; ещё не у концов тросов (там приземляются)
  const streamFar = (x, y, z) => {
    if (nearZip(x, z)) return false;
    for (const s of L.streamA) if (Math.hypot(x - s[0], z - s[2]) < 6) return false;
    return Math.hypot(x - L.poolA.x, z - L.poolA.z) > 11;
  };
  const tA = { yTop: -12, yBot: -42, minNy: 0.75 };
  add('oak', 40, 3.8, 5.6, { ...tA, pick: inA, ok: streamFar });
  add('pine', 40, 4.0, 6.0, { ...tA, pick: inA, ok: streamFar });
  add('round', 30, 3.8, 5.4, { ...tA, pick: inA, ok: streamFar });
  add('bush', 60, 2.4, 3.6, { ...tA, pick: inA, ok: streamFar });
  add('berry', 14, 2.6, 3.0, { ...tA, pick: inA, ok: streamFar });
  add('grass', 800, 1.6, 2.6, { ...tA, pick: inA, ok: streamFar });
  add('fern', 140, 2.2, 3.6, { ...tA, pick: inA, ok: streamFar });
  add('flowerP', 120, 1.6, 2.2, { ...tA, pick: inA, ok: streamFar });
  add('flowerY', 60, 1.6, 2.2, { ...tA, pick: inA, ok: streamFar });
  add('mushroom', 30, 2.5, 4.5, { ...tA, pick: inA, ok: streamFar });
  add('rock', 30, 2.0, 4.0, { ...tA, pick: inA, ok: streamFar });

  // ——— 2. Каменные уступы и верхушки столбов (восток) ———
  const east = (rng) => [60 + rng() * 140, -110 + rng() * 200];
  const tB = { yTop: -24, yBot: -100, minNy: 0.8 };
  const zipFar = (x, y, z) => !nearZip(x, z);
  add('grass', 260, 1.4, 2.2, { ...tB, pick: east, ok: zipFar });
  add('bush', 30, 2.0, 3.0, { ...tB, pick: east, ok: zipFar });
  add('rock', 30, 1.6, 3.0, { ...tB, pick: east, ok: zipFar });
  add('pine', 10, 3.2, 4.4, { ...tB, ok: zipFar, pick: (rng) => { const p = L.pillars[Math.floor(rng() * L.pillars.length)]; return [p.pos[0] + (rng() - 0.5) * p.rad, p.pos[2] + (rng() - 0.5) * p.rad]; } });

  // ——— 4. Затерянный лагерь: сухое плато ———
  const inD = (rng) => {
    const a = rng() * TAU, k = Math.sqrt(rng()), c = L.campD.center;
    return [c[0] + Math.cos(a) * 44 * k, c[2] + Math.sin(a) * 52 * k];
  };
  const campFar = (x, y, z) => !nearZip(x, z) && Math.hypot(x - L.campD.center[0], z - L.campD.center[2]) > 13;
  const tD = { yTop: -108, yBot: -132, minNy: 0.78 };
  add('deadTree', 16, 3.6, 5.2, { ...tD, pick: inD, ok: campFar });
  add('grassDry', 280, 1.6, 2.6, { ...tD, pick: inD, ok: campFar });
  add('rock', 26, 2.0, 4.0, { ...tD, pick: inD, ok: campFar });
  add('bush', 14, 2.0, 3.0, { ...tD, pick: inD, ok: campFar });

  // ——— 5. Большой спуск и дно: светящиеся грибы, папоротники, кристаллы ———
  const deep = (rng) => { const a = rng() * TAU, r = Math.sqrt(rng()) * 175; return [Math.sin(a) * r, Math.cos(a) * r]; };
  const lakeFar = (x, y, z) => !nearZip(x, z) && Math.hypot((x - L.lake.x) / (L.lake.rx + 3), (z - L.lake.z) / (L.lake.rz + 3)) > 1;
  const tE = { yTop: -122, yBot: -212, minNy: 0.72 };
  add('mushGlow', 110, 3.0, 6.0, { ...tE, pick: deep, ok: lakeFar });
  add('fern', 200, 2.2, 3.6, { ...tE, pick: deep, ok: lakeFar });
  add('grassDeep', 500, 1.6, 2.6, { ...tE, pick: deep, ok: lakeFar });
  add('crystal', 70, 0.8, 2.2, { ...tE, pick: deep, ok: lakeFar });
  add('rock', 40, 2.4, 5.0, { ...tE, pick: deep, ok: lakeFar });
  return rules;
}

// ——— демо-разлом: растения на полках-ступенях стен, верхушках столбов и мысе ———
// Первая ступень у посёлка — густо (тёмная зелень, мох, папоротник, фиолетовые цветы); дальние полки — редко,
// для силуэтов; ниже — светогрибы и кристаллы (светятся сквозь туман).
function riftRules(W, L, add, nearZip) {
  const N = Math.PI, out = [];
  const keepOut = (x, z) => !nearZip(x, z) && Math.hypot(x - L.poolA.x, z - L.poolA.z) > 8;
  // точка на полке k: угол из промежутка, радиус — между краем полки и стеной над ней
  const shelf = (k, th0, th1) => (rng) => {
    const th = th0 + rng() * (th1 - th0), b = W.bench(th, k);
    const rIn = W.pitR(Math.cos(th), Math.sin(th), b.y - 2.5), rOut = W.pitR(Math.cos(th), Math.sin(th), b.y + 2.5);
    const r = rIn + 0.8 + rng() * Math.max(0, rOut - rIn - 1.6);
    return [Math.sin(th) * r, Math.cos(th) * r];
  };
  const okShelf = (x, y, z) => keepOut(x, z);
  const S0 = { yTop: 2, yBot: -34, minNy: 0.72 };
  // первая ступень у посёлка
  const near = shelf(0, N - 0.95, N + 0.95);
  add('pine', 26, 3.6, 5.2, { ...S0, pick: near, ok: okShelf });
  add('oak', 14, 3.4, 4.8, { ...S0, pick: near, ok: okShelf });
  add('bush', 50, 2.2, 3.4, { ...S0, pick: near, ok: okShelf });
  add('berry', 10, 2.6, 3.0, { ...S0, pick: near, ok: okShelf });
  add('fern', 140, 2.4, 3.8, { ...S0, pick: near, ok: okShelf });
  add('grassDeep', 420, 1.6, 2.6, { ...S0, pick: near, ok: okShelf });
  add('flowerP', 90, 1.6, 2.2, { ...S0, pick: near, ok: okShelf });
  add('mushroom', 26, 2.5, 4.2, { ...S0, pick: near, ok: okShelf });
  add('rock', 30, 2.0, 4.2, { ...S0, pick: near, ok: okShelf });
  // все полки вокруг (видны издалека): редкие ели и кусты
  for (let k = 0; k < 3; k++) {
    const all = shelf(k, 0, Math.PI * 2), y = { yTop: 4 - k * 30, yBot: -40 - k * 40, minNy: 0.74 };
    add('pine', 40 - k * 10, 3.4, 5.4, { ...y, pick: all, ok: okShelf });
    add('bush', 40, 2.0, 3.2, { ...y, pick: all, ok: okShelf });
    add('fern', 60, 2.2, 3.4, { ...y, pick: all, ok: okShelf });
  }
  // глубже — светогрибы и кристаллы (видны сквозь туман)
  for (let k = 1; k < 4; k++) {
    const all = shelf(k, 0, Math.PI * 2), y = { yTop: -24 - (k - 1) * 30, yBot: -60 - k * 40, minNy: 0.7 };
    add('mushGlow', 36, 3.0, 5.5, { ...y, pick: all, ok: okShelf });
    add('crystal', 28, 1.0, 2.4, { ...y, pick: all, ok: okShelf });
  }
  // верхушки столбов и мыс
  const tops = (rng) => { const p = L.pillars[Math.floor(rng() * L.pillars.length)]; const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * p.rad * 0.8; return [p.pos[0] + Math.cos(a) * r, p.pos[2] + Math.sin(a) * r]; };
  const T = { yTop: 2, yBot: -100, minNy: 0.8 };
  add('pine', 18, 3.4, 5.0, { ...T, pick: tops, ok: okShelf });
  add('grass', 160, 1.4, 2.2, { ...T, pick: tops, ok: okShelf });
  add('bush', 20, 2.0, 3.0, { ...T, pick: tops, ok: okShelf });
  return out;
}

// Свет, который запекается в скалы. emitters — что поставить в игре на месте света (большие кристаллы).
export function bakedLights(W, L) {
  const lights = [], emitters = { crystalBig: [] };
  const warm = [1.0, 0.62, 0.3], cyan = [0.25, 0.85, 1.0], violet = [0.72, 0.4, 1.0];
  const fire = L.village.fire;
  lights.push({ x: fire[0], y: W.terrainH(fire[0], fire[1]) + 1, z: fire[1], r: 13, i: 0.55, c: warm });
  for (const [x, z] of L.village.lanterns) lights.push({ x, y: W.terrainH(x, z) + 3.2, z, r: 7, i: 0.35, c: warm });
  if (W.rift && L.demo) return riftLights(W, L, lights, emitters, cyan, violet);
  for (const p of L.mineLamps) lights.push({ x: p[0], y: p[1], z: p[2], r: 6.5, i: 0.75, c: warm });   // пятна света, между ними темно
  // кристаллы в зале шахты и на дне — большие группы, каждая светится
  const rng = makeRng(777);
  const spots = [];
  for (let i = 0; i < 7; i++) {
    const a = rng() * TAU, h = L.hall;
    spots.push([h.pos[0] + Math.cos(a) * h.rx * 0.7, h.floor + 3, h.pos[2] + Math.sin(a) * h.rz * 0.7, cyan]);
  }
  for (let i = 0; i < 16; i++) {
    const a = rng() * TAU, r = 40 + rng() * 120;
    spots.push([Math.sin(a) * r, -150, Math.cos(a) * r, i % 3 === 0 ? violet : cyan]);
  }
  for (const [x, yTop, z, c] of spots) {
    const t = W.raycast(x, yTop, z, 0, -1, 0, 90);
    if (t < 0) continue;
    const y = yTop - t;
    lights.push({ x, y: y + 2.2, z, r: 11, i: y > -110 ? 0.55 : 0.9, c });     // в зале шахты — мягче
    emitters.crystalBig.push(x, y - 0.2, z, rng() * TAU, 1.6 + rng() * 1.2, 1);
  }
  // светлое озеро на дне
  lights.push({ x: L.lake.x, y: L.lake.y + 1.5, z: L.lake.z, r: 34, i: 0.45, c: [0.3, 0.9, 0.95] });
  return { lights, emitters };
}

// демо-разлом: светящиеся кристаллы — в пещере за водопадом, на полках ниже (фиолетовые и голубые огни
// в тумане), в тёмных входах пещер дальних стен
function riftLights(W, L, lights, emitters, cyan, violet) {
  const rng = makeRng(778), spots = [];
  const room = L.secrets.wfRoom;
  spots.push([room[0] + 2.5, room[1] + 2, room[2] - 1.5, cyan], [room[0] - 3, room[1] + 2, room[2] + 1, violet]);
  for (let k = 1; k < 4; k++) {
    for (let i = 0; i < 9; i++) {
      const th = rng() * TAU, b = W.bench(th, k);
      const rIn = W.pitR(Math.cos(th), Math.sin(th), b.y - 2.5), rOut = W.pitR(Math.cos(th), Math.sin(th), b.y + 2.5);
      if (rOut - rIn < 3) continue;
      const r = (rIn + rOut) / 2;
      spots.push([Math.sin(th) * r, b.y + 3, Math.cos(th) * r, i % 3 === 0 ? cyan : violet]);
    }
  }
  for (const [x, yTop, z, c] of spots) {
    const t = W.raycast(x, yTop, z, 0, -1, 0, 12);
    if (t < 0) continue;
    const y = yTop - t;
    lights.push({ x, y: y + 2.2, z, r: 10, i: 0.8, c });
    emitters.crystalBig.push(x, y - 0.2, z, rng() * TAU, 1.4 + rng() * 1.1, 1);
  }
  return { lights, emitters };
}
