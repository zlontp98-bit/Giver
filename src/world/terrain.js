// Земля и скалы из запечённых кусков (tools/bake-world.mjs → baked.gen.js).
// В каждой вершине уже есть цвет, солнце (с тенью от скал), небо (с затенением в углах) и свечение —
// поэтому шейдер простой: телефону почти нечего считать. Живые лампы (фонарик, костёр) светят как обычно.
import * as THREE from 'three';
import { BAKE, BAKE_DATA } from './baked.gen.js';
import { loadTexture } from '../render/models.js';

let BIN = null;
export function bakedBuffer() {
  if (BIN) return BIN;
  const s = atob(BAKE_DATA), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  BIN = u.buffer;
  return BIN;
}

// растения и камни, расставленные при запекании: { kind: Float32Array [x, y, z, поворот, размер, свет] }
export function bakedProps() {
  const buf = bakedBuffer(), out = {};
  for (const [kind, p] of Object.entries(BAKE.props)) out[kind] = new Float32Array(buf, p.off, p.n * 6);
  return out;
}

export function buildTerrain(material) {
  const buf = bakedBuffer();
  const group = new THREE.Group();
  const meshes = [];
  for (const c of BAKE.chunks) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Int16Array(buf, c.pos, c.n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf, c.nor, c.n * 3), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(buf, c.col, c.n * 3), 3, true));
    g.setAttribute('aLit', new THREE.BufferAttribute(new Uint8Array(buf, c.lit, c.n * 2), 2, true));
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Uint8Array(buf, c.glow, c.n * 3), 3, true));
    g.setIndex(new THREE.BufferAttribute(c.i32 ? new Uint32Array(buf, c.idx, c.t) : new Uint16Array(buf, c.idx, c.t), 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.position.set(c.o[0], c.o[1], c.o[2]);
    m.scale.setScalar(0.01);                 // положения хранятся в сантиметрах
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.receiveShadow = true;
    m.userData.kind = c.k;
    m.userData.box = new THREE.Box3(new THREE.Vector3(c.o[0], c.o[1], c.o[2]), new THREE.Vector3(c.o[0] + 120, c.o[1] + 120, c.o[2] + 120));
    if (c.k === 'lo') m.visible = false;
    group.add(m);
    meshes.push(m);
  }
  // пары «подробный / грубый» по одному месту
  const pairs = [], byO = new Map();
  for (const m of meshes) if (m.userData.kind !== 'hf') {
    const key = m.position.toArray().join(',');
    if (!byO.has(key)) byO.set(key, {});
    byO.get(key)[m.userData.kind] = m;
  }
  for (const p of byO.values()) pairs.push(p);
  const hf = meshes.filter((m) => m.userData.kind === 'hf');
  // кусок ближе ~80 м (от камеры до его коробки) — подробный, дальше — грубый (клетка 5 м вместо 2.5).
  // Порядок: скалы рисуются раньше всего остального и от ближних к дальним — меньше лишней перерисовки
  // (за ближней скалой дальняя уже не закрашивается).
  const _c = new THREE.Vector3();
  const update = (cam) => {
    for (const p of pairs) {
      const box = (p.sn || p.lo).userData.box, d = box.distanceToPoint(cam);
      const near = d < (p.sn && p.sn.visible ? 90 : 80);
      if (p.sn) p.sn.visible = near || !p.lo;
      if (p.lo) p.lo.visible = !near || !p.sn;
      const order = -1000 + Math.min(900, Math.round(box.getCenter(_c).distanceTo(cam) / 2));
      if (p.sn) p.sn.renderOrder = order;
      if (p.lo) p.lo.renderOrder = order;
    }
    for (const m of hf) m.renderOrder = -90;
  };
  return { group, meshes, update };
}

// ——— материал: запечённый свет + мелкое зерно; на «Средней» — текстуры, на «Высокой» — ещё и неровности ———
let TEX = null;
const NOISE_GLSL = `
  float gvHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gvNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(gvHash(i), gvHash(i + vec2(1.0, 0.0)), u.x), mix(gvHash(i + vec2(0.0, 1.0)), gvHash(i + vec2(1.0, 1.0)), u.x), u.y); }`;

function patchedLights() {
  let s = THREE.ShaderChunk.lights_fragment_begin;
  const a = s.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  const b = s.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )');
  if (a < 0 || b < 0) throw new Error('three.js: не нашёл блок солнца в шейдере');
  // солнце: вместо «наклон к солнцу» — запечённое (наклон × тень от скал), плюс тени от деревьев и домов
  const sun = `
#if ( NUM_DIR_LIGHTS > 0 )
	{
		float bakedSun = vLit.x;
		#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
			DirectionalLightShadow dls0 = directionalLightShadows[ 0 ];
			bakedSun *= receiveShadow ? getShadow( directionalShadowMap[ 0 ], dls0.shadowMapSize, dls0.shadowIntensity, dls0.shadowBias, dls0.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
		#endif
		reflectedLight.directDiffuse += BRDF_Lambert( material.diffuseColor ) * directionalLights[ 0 ].color * bakedSun;
	}
#endif

`;
  s = s.slice(0, a) + sun + s.slice(b);
  // небо: как обычно, но ослаблено там, где неба не видно (пещеры, щели, под нависанием)
  s = s.replace('irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );', 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * vLit.y;');
  return s;
}

// демоверсия — стилизованный вид: скалы и трава без фото-текстур (рисованная расцветка в шейдере;
// заодно это и дешевле для видеочипа телефона)
export const STYLIZED = true;
export function worldMaterial(level = 0) {
  if (STYLIZED) return rockMaterial(level);
  if (level >= 1 && !TEX) TEX = {
    rock: loadTexture('cliff_side_diff.jpg', true), rockN: loadTexture('cliff_side_nor.jpg'),
    grass: loadTexture('grass_ground_diff.jpg', true), grassN: loadTexture('grass_ground_nor.jpg'),
  };
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.defines = {};
  if (level >= 1) m.defines.TEX_COLOR = '';
  if (level >= 2) m.defines.TEX_NORMAL = '';
  m.customProgramCacheKey = () => 'giverWorld' + level;
  m.onBeforeCompile = (sh) => {
    if (TEX) Object.assign(sh.uniforms, { tRock: { value: TEX.rock }, tRockN: { value: TEX.rockN }, tGrass: { value: TEX.grass }, tGrassN: { value: TEX.grassN } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aLit; attribute vec3 aGlow;
        varying vec2 vLit; varying vec3 vGlow; varying vec3 vWP; varying vec3 vWN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLit = aLit; vGlow = aGlow;
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vLit; varying vec3 vGlow; varying vec3 vWP; varying vec3 vWN;
        ${NOISE_GLSL}
        #ifdef TEX_COLOR
          uniform sampler2D tRock, tRockN, tGrass, tGrassN;
          vec3 gvBlend(vec3 n){ vec3 b = pow(abs(n), vec3(4.0)); return b / (b.x + b.y + b.z); }
          float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
          vec3 triColor(sampler2D t, vec3 p, vec3 n, float s){ vec3 b = gvBlend(n);
            return texture2D(t, p.zy * s).rgb * b.x + texture2D(t, p.xz * s).rgb * b.y + texture2D(t, p.xy * s).rgb * b.z; }
          vec3 triNormal(sampler2D t, vec3 p, vec3 n, float s){ vec3 b = gvBlend(n);
            vec3 tx = texture2D(t, p.zy * s).xyz * 2.0 - 1.0, ty = texture2D(t, p.xz * s).xyz * 2.0 - 1.0, tz = texture2D(t, p.xy * s).xyz * 2.0 - 1.0;
            tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x); ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y); tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
            return normalize(tx.zyx * b.x + ty.xzy * b.y + tz.xyz * b.z); }
          // Скала почти всегда — стена: для неё хватает двух боковых проекций (zy и xy) вместо трёх, а там, где
          // скалы нет (ровная трава), её не читаем вовсе — и наоборот. Вид тот же, выборок текстур в 2–4 раза меньше.
          float rockLum(vec3 p, vec3 n, float s){
            vec2 b = pow(abs(n.xz), vec2(4.0)); b /= max(1e-4, b.x + b.y);
            return lum(texture2D(tRock, p.zy * s).rgb) * b.x + lum(texture2D(tRock, p.xy * s).rgb) * b.y; }
          vec3 sideNormal(sampler2D t, vec3 p, vec3 n, float s){
            vec2 b = pow(abs(n.xz), vec2(4.0)); b /= max(1e-4, b.x + b.y);
            vec3 tx = texture2D(t, p.zy * s).xyz * 2.0 - 1.0, tz = texture2D(t, p.xy * s).xyz * 2.0 - 1.0;
            tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x); tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
            return normalize(tx.zyx * b.x + tz.xyz * b.y); }
          vec3 topNormal(sampler2D t, vec3 p, vec3 n, float s){
            vec3 ty = texture2D(t, p.xz * s).xyz * 2.0 - 1.0;
            return normalize(vec3(ty.x + n.x, abs(ty.z) * n.y, ty.y + n.z)); }
        #endif
        float gSteep;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 wn = normalize(vWN);
          gSteep = 1.0 - smoothstep(0.55, 0.8, wn.y);
          float detail = gvNoise(vWP.xz * 1.3 + vWP.y * 0.8) * 0.6 + gvNoise(vec2(vWP.x - vWP.z, vWP.y) * 0.45) * 0.4;
          diffuseColor.rgb *= 0.86 + 0.28 * detail;
          #ifdef TEX_COLOR
            float kg = 1.0, kr = 1.0;
            if (gSteep < 0.98) kg = mix(1.0, clamp(lum(texture2D(tGrass, vWP.xz * 0.25).rgb) * 2.0, 0.6, 1.4), 0.7);
            if (gSteep > 0.02) kr = 0.6 + 1.0 * rockLum(vWP, wn, 0.14);
            diffuseColor.rgb *= mix(kg, kr, gSteep);
          #else
            // рисованная расцветка без текстур (стиль Giver): трава — тёплые и прохладные пятна; скала — слои
            // породы разного цвета с тёмными швами, мох на верхних гранях; чем глубже — тем холоднее
            float big = vNz.x, mid = vNz.y;
            vec3 gTint = mix(vec3(1.12, 1.07, 0.78), vec3(0.80, 1.0, 0.95), smoothstep(0.3, 0.7, big)) * (0.9 + 0.2 * mid);
            vec3 rTint = vec3(1.0);
            if (gSteep > 0.02) {
              float st = vWP.y * 0.15 + (gvNoise(vWP.xz * 0.035) - 0.5) * 2.4;
              float id = floor(st), fr = fract(st), h = gvHash(vec2(id, 3.7));
              rTint = h < 0.4 ? vec3(1.10, 0.97, 0.80) : h < 0.75 ? vec3(0.88, 0.90, 0.97) : vec3(1.06, 0.86, 0.76);
              rTint *= 0.80 + 0.20 * smoothstep(0.0, 0.07, fr) * smoothstep(1.0, 0.93, fr);     // швы между слоями
              rTint *= 0.9 + 0.2 * gvNoise(vec2((vWP.x + vWP.z) * 0.5, vWP.y * 0.04));           // подтёки
              float moss = smoothstep(0.22, 0.5, wn.y) * smoothstep(0.3, 0.6, mid);
              rTint *= mix(vec3(1.0), vec3(0.72, 1.12, 0.58), moss);
            }
            diffuseColor.rgb *= mix(gTint, rTint, gSteep);
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.76, 0.84, 1.06), smoothstep(-6.0, -150.0, vWP.y));
          #endif
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vGlow * 1.3;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef TEX_NORMAL
        {
          vec3 wn = normalize(vWN);
          vec3 ng = wn, nr = wn;
          if (gSteep < 0.98) ng = mix(wn, topNormal(tGrassN, vWP, wn, 0.25), 0.6);
          if (gSteep > 0.02) nr = sideNormal(tRockN, vWP, wn, 0.14);
          vec3 nW = normalize(mix(ng, nr, gSteep));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }
        #endif`)
      .replace('#include <lights_fragment_begin>', patchedLights());
  };
  return m;
}


// ——— стилизованный камень (демо-разлом) ———
// Текстура «граней и трещин» строится при запуске (256×256, повторяется): ячейки Вороного — каждая глыба со
// своим наклоном (rg — наклон нормали), своим оттенком (b) и трещинами по краям (a). Накладывается с трёх
// сторон (как обычно для скал), и солнце считается по этим граням в каждой точке — камень выглядит колотым,
// а не глиняным. Запечённая тень от скал остаётся (её берём из запечённого света вершины).
let FACET = null;
function facetTexture(size = 256, cells = 6) {
  if (FACET) return FACET;
  let seed = 9187;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 0) % 1000003) / 1000003; };
  const P = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    P.push({ x: (i + 0.12 + 0.76 * rnd()) / cells, y: (j + 0.12 + 0.76 * rnd()) / cells, a: rnd() * 2 - 1, b: rnd() * 2 - 1, id: rnd() });
  }
  const H = new Float32Array(size * size), ID = new Float32Array(size * size), CR = new Float32Array(size * size);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = (px + 0.5) / size, v = (py + 0.5) / size, ci = Math.floor(u * cells), cj = Math.floor(v * cells);
    let f1 = 9, f2 = 9, best = null, bdx = 0, bdy = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells, q = P[jj * cells + ii];
      const qx = q.x + Math.floor((ci + di) / cells), qy = q.y + Math.floor((cj + dj) / cells);   // соседи через край плитки
      const dx = u - qx, dy = v - qy, d = Math.hypot(dx, dy) * cells;
      if (d < f1) { f2 = f1; f1 = d; best = q; bdx = dx; bdy = dy; } else if (d < f2) f2 = d;
    }
    const edge = f2 - f1;
    const crack = Math.min(1, Math.max(0, edge / 0.06));
    const k = py * size + px;
    // наклонная плоскость в ячейке + желобок трещины
    H[k] = (best.a * bdx + best.b * bdy) * cells * 0.42 - (1 - crack * crack) * 0.18;
    ID[k] = best.id; CR[k] = crack;
  }
  const data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const k = py * size + px, xl = py * size + ((px + size - 1) % size), xr = py * size + ((px + 1) % size);
    const yd = ((py + size - 1) % size) * size + px, yu = ((py + 1) % size) * size + px;
    const gx = (H[xr] - H[xl]) * size * 0.06, gy = (H[yu] - H[yd]) * size * 0.06;
    data[k * 4] = Math.max(0, Math.min(255, 128 - gx * 127));
    data[k * 4 + 1] = Math.max(0, Math.min(255, 128 - gy * 127));
    data[k * 4 + 2] = Math.round(ID[k] * 255);
    data[k * 4 + 3] = Math.round(CR[k] * 255);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  FACET = t;
  return t;
}

function rockMaterial(level) {
  const tex = facetTexture();
  // с двух сторон: если на изломе скалы треугольник при запекании лёг «изнанкой» — он всё равно виден (иначе
  // в стене дырочка и сквозь неё небо). Свет считаем по нормали формулы мира — сторона треугольника не важна.
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.defines = level >= 2 ? { ROCK_RIM: '' } : {};
  m.customProgramCacheKey = () => 'giverRock' + level;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tFacet = { value: tex };
    // крупные пятна и оттенки глыб меняются медленно — считаем их в вершинах (их в десятки раз меньше,
    // чем точек на экране); в точке — только грани и трещины из текстуры
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aLit; attribute vec3 aGlow;
        varying vec2 vLit; varying vec3 vGlow; varying vec3 vWP; varying vec3 vWN; varying vec3 vNz;
        ${NOISE_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLit = aLit; vGlow = aGlow;
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);
        vNz = vec3(gvNoise(vWP.xz * 0.03 + 7.0), gvNoise(vWP.xz * 0.13 + vWP.y * 0.05), gvNoise(vec2((vWP.x + vWP.z) * 0.06, vWP.y * 0.04)));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vLit; varying vec3 vGlow; varying vec3 vWP; varying vec3 vWN; varying vec3 vNz;
        uniform sampler2D tFacet;
        vec3 gvPert; float gvCell; float gvCrack; float gSteep;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 wn = normalize(vWN);
          gSteep = 1.0 - smoothstep(0.55, 0.8, wn.y);
          vec3 bw = pow(abs(wn), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
          // на стенах грани вытянуты по вертикали (как столбчатые трещины), сверху — обычные
          vec4 tx = texture2D(tFacet, vec2(vWP.z * 0.028, vWP.y * 0.012)), tz = texture2D(tFacet, vec2(vWP.x * 0.028, vWP.y * 0.012));
          vec4 ty = bw.y > 0.02 ? texture2D(tFacet, vWP.xz * 0.05) : vec4(0.5, 0.5, 0.5, 1.0);
          float slab = vNz.z;                                                                       // крупные глыбы — свой оттенок
          vec2 nx = tx.rg * 2.0 - 1.0, ny2 = ty.rg * 2.0 - 1.0, nz = tz.rg * 2.0 - 1.0;
          gvPert = vec3(0.0, nx.y, nx.x) * bw.x + vec3(ny2.x, 0.0, ny2.y) * bw.y + vec3(nz.x, nz.y, 0.0) * bw.z;
          gvCell = tx.b * bw.x + ty.b * bw.y + tz.b * bw.z;
          gvCrack = tx.a * bw.x + ty.a * bw.y + tz.a * bw.z;
          float big = vNz.x, mid = vNz.y;
          // трава/мох на ровном: тёплые и прохладные пятна
          vec3 gTint = mix(vec3(1.08, 1.04, 0.80), vec3(0.80, 0.98, 0.94), smoothstep(0.3, 0.7, big)) * (0.9 + 0.2 * mid);

          // камень: каждая глыба своя (светлее/темнее, теплее/холоднее), трещины тёмные, мох сверху
          vec3 rTint = mix(vec3(0.88), vec3(1.1), gvCell) * mix(vec3(0.84, 0.86, 0.9), vec3(1.12, 1.06, 0.98), slab);
          rTint *= mix(vec3(1.05, 0.98, 0.91), vec3(0.93, 0.97, 1.05), step(0.5, fract(gvCell * 7.0)));
          rTint *= 0.74 + 0.26 * gvCrack;
          float moss = smoothstep(0.3, 0.7, wn.y + gvPert.y * 0.5) * smoothstep(0.25, 0.6, mid);
          rTint *= mix(vec3(1.0), vec3(0.58, 0.9, 0.5), moss);
          diffuseColor.rgb *= mix(gTint, rTint, gSteep);
          // чем глубже — тем холоднее и темнее
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.74, 0.98), smoothstep(-6.0, -130.0, vWP.y));
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 wn = normalize(vWN);
          vec3 nW = normalize(wn + gvPert * mix(0.06, 0.95, gSteep));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vGlow * 1.3;
        #ifdef ROCK_RIM
          // светлый край на солнечной стороне (силуэты скал чётче)
          float rim = pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 4.0);
          totalEmissiveRadiance += vec3(1.0, 0.82, 0.6) * rim * 0.22 * vLit.x * diffuseColor.rgb;
        #endif`)
      .replace('#include <lights_fragment_begin>', rockLights());
  };
  return m;
}

// солнце по граням: запечённая тень от скал (свет вершины / наклон вершины) × наклон грани к солнцу
function rockLights() {
  let s = THREE.ShaderChunk.lights_fragment_begin;
  const a = s.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  const b = s.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )');
  if (a < 0 || b < 0) throw new Error('three.js: не нашёл блок солнца в шейдере');
  const sun = `
#if ( NUM_DIR_LIGHTS > 0 )
	{
		vec3 sunDir = directionalLights[ 0 ].direction;
		vec3 vN = normalize( ( viewMatrix * vec4( normalize( vWN ), 0.0 ) ).xyz );
		float shade = clamp( vLit.x / max( dot( vN, sunDir ), 0.15 ), 0.0, 1.0 );
		float sunL = shade * max( dot( normal, sunDir ), 0.0 );
		#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
			DirectionalLightShadow dls0 = directionalLightShadows[ 0 ];
			sunL *= receiveShadow ? getShadow( directionalShadowMap[ 0 ], dls0.shadowMapSize, dls0.shadowIntensity, dls0.shadowBias, dls0.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
		#endif
		reflectedLight.directDiffuse += BRDF_Lambert( material.diffuseColor ) * directionalLights[ 0 ].color * sunL;
	}
#endif

`;
  s = s.slice(0, a) + sun + s.slice(b);
  s = s.replace('irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );', 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * vLit.y;');
  return s;
}
