// Остров с горой: сетка высот, по ней и рисуется рельеф, и ходит/лазает герой.
import * as THREE from 'three';
import { makeNoise2D, makeRng, fbm, smoothstep, clamp } from './noise.js';

export const WORLD = 384;            // размер острова, м
export const N = 256;                // клеток по стороне
export const CELL = WORLD / N;       // 1.5 м
export const HALF = WORLD / 2;
export const PEAK = 150;             // примерная высота вершины, м
export const WALKABLE_NY = 0.72;     // круче ~44° — уже стена, по ней только лезть

export class Terrain {
  constructor(seed) {
    this.seed = seed;
    const nA = makeNoise2D(seed), nB = makeNoise2D(seed + 11), nC = makeNoise2D(seed + 23);
    const S = N + 1;
    this.h = new Float32Array(S * S);
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        this.h[j * S + i] = rawHeight(x, z, nA, nB, nC);
      }
    }
    // самая высокая точка — вершина
    let best = -1e9, bi = 0;
    for (let k = 0; k < this.h.length; k++) if (this.h[k] > best) { best = this.h[k]; bi = k; }
    this.summit = new THREE.Vector3(-HALF + (bi % S) * CELL, best, -HALF + Math.floor(bi / S) * CELL);
  }

  vertex(i, j) {
    const S = N + 1;
    i = clamp(i, 0, N); j = clamp(j, 0, N);
    return this.h[j * S + i];
  }

  // Высота земли — точно как у нарисованных треугольников.
  heightAt(x, z) {
    const gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return -10;
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const h00 = this.vertex(i, j), h10 = this.vertex(i + 1, j);
    const h01 = this.vertex(i, j + 1), h11 = this.vertex(i + 1, j + 1);
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  // Сглаженная нормаль (по соседним точкам) — для «можно ли тут стоять» и для лазания.
  normalAt(x, z, out = new THREE.Vector3(), d = CELL) {
    const hx = this.heightAt(x + d, z) - this.heightAt(x - d, z);
    const hz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
    return out.set(-hx, 2 * d, -hz).normalize();
  }

  isWalkable(x, z) {
    return this.normalAt(x, z, _n).y > WALKABLE_NY;
  }

  buildMesh() {
    const S = N + 1;
    const pos = new Float32Array(S * S * 3);
    const col = new Float32Array(S * S * 3);
    const rng = makeRng(this.seed + 5);
    const c = new THREE.Color();
    const sand = new THREE.Color('#d8c48f'), wetSand = new THREE.Color('#b9a46e');
    const grass = new THREE.Color('#63a04a'), forest = new THREE.Color('#4a8238');
    const alpine = new THREE.Color('#93a064'), rock = new THREE.Color('#857a6d');
    const rockHi = new THREE.Color('#8f8f94'), snow = new THREE.Color('#f1f4f8');
    const n = new THREE.Vector3();
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const k = j * S + i;
        const x = -HALF + i * CELL, z = -HALF + j * CELL, y = this.h[k];
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        this.normalAt(x, z, n);
        const steep = n.y < WALKABLE_NY + 0.04;
        if (y < 0.6) c.copy(wetSand);
        else if (y < 2.2) c.copy(sand).lerp(grass, smoothstep(1.4, 2.2, y));
        else if (steep) c.copy(rock).lerp(rockHi, smoothstep(40, 120, y));
        else if (y < 45) c.copy(grass).lerp(forest, smoothstep(6, 30, y));
        else if (y < 105) c.copy(forest).lerp(alpine, smoothstep(45, 80, y));
        else c.copy(alpine).lerp(snow, smoothstep(105, 118, y));
        if (y > 122 && !steep) c.copy(snow);
        const v = 0.93 + rng() * 0.1;
        col[k * 3] = c.r * v; col[k * 3 + 1] = c.g * v; col[k * 3 + 2] = c.b * v;
      }
    }
    // те же треугольники, что в heightAt: диагональ из (i+1,j) в (i,j+1)
    const idx = new Uint32Array(N * N * 6);
    let p = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * S + i, b = a + 1, d = a + S, e = d + 1;
        idx[p++] = a; idx[p++] = d; idx[p++] = b;
        idx[p++] = b; idx[p++] = d; idx[p++] = e;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';
    return mesh;
  }
}

const _n = new THREE.Vector3();

// Форма острова: низина с пляжем, в середине гора из уступов (полка — стена — полка…).
function rawHeight(x, z, nA, nB, nC) {
  const cx = 0, cz = -12;
  const dx = x - cx, dz = z - cz;
  const ang = Math.atan2(dz, dx);
  let r = Math.hypot(dx, dz);
  r *= 1 + 0.2 * fbm(nA, Math.cos(ang) * 1.3 + 7.1, Math.sin(ang) * 1.3 + 3.7, 3)
         + 0.07 * fbm(nB, x / 40, z / 40, 3);
  const R = 128;
  const mount = Math.pow(Math.max(0, 1 - r / R), 1.25);

  const ri = Math.hypot(x, z) / HALF + 0.08 * fbm(nB, x / 50 + 3, z / 50, 3);
  const island = 1 - smoothstep(0.62, 0.93, ri);
  let h = -8 + island * (9.5 + 4.5 * fbm(nC, x / 45, z / 45, 4));

  let m = mount * PEAK;
  const base = 9;
  if (m > base) {
    const stepH = 13 + 4.5 * nB(x / 70 + 11, z / 70);
    const off = 5 * fbm(nA, x / 35 + 20, z / 35, 2);
    const t = (m - base + off) / stepH;
    const k = Math.floor(t), f = t - k;
    // 72% ширины ступени — пологая полка (18% высоты), остальное — крутая стена
    const g = f < 0.72 ? f * (0.18 / 0.72) : 0.18 + ((f - 0.72) / 0.28) * 0.82;
    m = Math.max(base, base + (k + g) * stepH - off);
  }
  // плоская площадка на вершине — чтобы было где постоять с флагом
  h += Math.min(Math.max(0, m), PEAK - 9);
  h += 0.5 * nC(x / 5.5, z / 5.5) + 0.25 * nA(x / 2.3, z / 2.3);
  return h;
}
