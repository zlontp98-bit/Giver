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
// заодно это и дешевле для видеочипа телефона); уровень только 0 или 2 (неровности — потом)
export const STYLIZED = true;
export function worldMaterial(level = 0) {
  if (STYLIZED) level = 0;
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
            float big = gvNoise(vWP.xz * 0.03 + 7.0), mid = gvNoise(vWP.xz * 0.13 + vWP.y * 0.05);
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
