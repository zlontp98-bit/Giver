// Пример «новых возможностей»: вечерний лагерь на уступе горы.
// Модели — Kenney Nature Kit (CC0), текстуры — Poly Haven (CC0), эффекты — postprocessing + N8AO.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { Terrain, N, CELL, HALF } from '../../../src/terrain.js';
import { makeRng, smoothstep } from '../../../src/noise.js';
import { makeHero } from './hero.js';
import { Campfire, Fireflies } from './fire.js';
import ASSETS from './assets.gen.js';

const SEED = 20261101;
const W = () => window.innerWidth, H = () => window.innerHeight;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.__DPR || 1.5));
renderer.setSize(W(), H());
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
// вечер: тёплая дымка у горизонта, голубое небо наверху
const HORIZON = new THREE.Color('#f3c9a2'), TOP = new THREE.Color('#5f97cf');
scene.fog = new THREE.FogExp2(new THREE.Color('#e9c4a4'), 0.0062);
const camera = new THREE.PerspectiveCamera(52, W() / H(), 0.1, 2500);
const SUN_DIR = new THREE.Vector3(-0.78, 0.2, 0.6).normalize();

const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  uniforms: { top: { value: TOP }, horizon: { value: HORIZON }, sunDir: { value: SUN_DIR }, sunCol: { value: new THREE.Color('#ffd7a0') } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 top, horizon, sunDir, sunCol; varying vec3 vDir;
    void main(){ vec3 d = normalize(vDir);
      vec3 col = mix(horizon, top, pow(smoothstep(-0.02, 0.7, d.y), 0.8));
      float s = max(dot(d, sunDir), 0.0);
      col += sunCol * (pow(s, 1200.0) * 9.0 + pow(s, 60.0) * 0.6 + pow(s, 6.0) * 0.18);
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
}));
scene.add(sky);

scene.add(new THREE.HemisphereLight('#a9c8f0', '#8a6040', 1.0));
const sun = new THREE.DirectionalLight('#ffbf80', 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

// ——— гора с местом под лагерь ———
const terrain = new Terrain(SEED);
const camp = findCamp(terrain);
flatten(terrain, camp, 4.5, 7.5);
const away = new THREE.Vector3(camp.x - terrain.summit.x, 0, camp.z - terrain.summit.z).normalize(); // к морю
const side = new THREE.Vector3(away.z, 0, -away.x);

const tex = loadTextures();
const ground = new THREE.Mesh(terrainGeometry(terrain), terrainMaterial(tex));
ground.receiveShadow = true; ground.castShadow = true;
scene.add(ground);
const sea = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), waterMaterial());
sea.rotation.x = -Math.PI / 2; sea.position.y = 0.05;
scene.add(sea);

// ——— герой у костра ———
const hero = makeHero();
const firePos = camp.clone().addScaledVector(away, 1.2);
firePos.y = terrain.heightAt(firePos.x, firePos.z);
const heroPos = firePos.clone().addScaledVector(side, -2.0).addScaledVector(away, -0.4);
heroPos.y = terrain.heightAt(heroPos.x, heroPos.z);
hero.root.position.copy(heroPos).add(new THREE.Vector3(0, -0.24, 0));
hero.root.lookAt(firePos.x, hero.root.position.y, firePos.z);
hero.legL.rotation.x = hero.legR.rotation.x = -1.42;     // сидит, ноги к огню
hero.legL.rotation.z = 0.12; hero.legR.rotation.z = -0.12;
hero.armL.rotation.set(-1.15, 0, -0.25); hero.armR.rotation.set(-1.15, 0, 0.25);  // греет руки
scene.add(hero.root);

const fire = new Campfire(scene, firePos);
const flies = new Fireflies(scene, camp);

const ready = loadModels().then(placeModels);

// ——— эффекты ———
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
composer.addPass(new RenderPass(scene, camera));
const ao = new N8AOPostPass(scene, camera, W(), H());
Object.assign(ao.configuration, { aoRadius: 1.4, distanceFalloff: 0.8, intensity: 2.6, halfRes: true, gammaCorrection: false });
composer.addPass(ao);
const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.9, luminanceSmoothing: 0.2, intensity: 0.8, radius: 0.6 });
composer.addPass(new EffectPass(camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), new VignetteEffect({ darkness: 0.42, offset: 0.32 })));
composer.addPass(new EffectPass(camera, new SMAAEffect()));

const state = { fx: true, textures: true };
function setFx(on) {
  state.fx = on;
  renderer.toneMapping = on ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
}
function setTextures(on) {
  state.textures = on;
  ground.material.userData.uTex.value = on ? 1 : 0;
}
setFx(true);

// ——— камера ———
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.copy(firePos).add(new THREE.Vector3(0, 0.8, 0));
controls.minDistance = 3; controls.maxDistance = 70;
controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotate = true; controls.autoRotateSpeed = 0.35;
function view(n) {
  const t = firePos.clone().add(new THREE.Vector3(0, 0.8, 0));
  const k = camera.aspect < 1 ? 1.9 : 1;   // телефон вертикально — отходим дальше, чтобы лагерь влез
  const off = new THREE.Vector3();
  if (n === 1) off.addScaledVector(away, 5.2).addScaledVector(side, -3.6).add(new THREE.Vector3(0, 1.9, 0));
  else if (n === 2) off.addScaledVector(away, 22).addScaledVector(side, -14).add(new THREE.Vector3(0, 9, 0));
  else off.addScaledVector(away, 2.2).addScaledVector(side, 1.6).add(new THREE.Vector3(0, 0.6, 0));
  camera.position.copy(t).addScaledVector(off, k);
  controls.target.copy(t);
  controls.update();
}
view(1);

sun.target.position.copy(camp);
sun.position.copy(camp).addScaledVector(SUN_DIR, 180);

const clock = new THREE.Clock();
let time = 0;
function render(dt) {
  time += dt;
  const scale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  fire.update(time, scale);
  flies.update(time, scale);
  sea.material.uniforms.uTime.value = time;
  hero.head.rotation.z = Math.sin(time * 1.3) * 0.05;
  hero.body.position.y = Math.sin(time * 2.0) * 0.01;
  sky.position.copy(camera.position);
  if (state.fx) composer.render(dt); else renderer.render(scene, camera);
}
// если телефон не тянет (кадр дольше 45 мс) — сначала меньше пикселей, потом без мягких теней
let slow = 0, level = 0;
function adapt(raw) {
  slow = raw > 0.045 ? slow + raw : Math.max(0, slow - raw * 0.5);
  if (slow < 2.5 || level >= 2) return;
  slow = 0; level++;
  if (level === 1) { renderer.setPixelRatio(1); renderer.setSize(W(), H()); composer.setSize(W(), H()); }
  else ao.enabled = false;
}
function loop() {
  requestAnimationFrame(loop);
  const raw = clock.getDelta();
  if (state.fx) adapt(raw);
  const dt = Math.min(0.05, raw);
  controls.update();
  render(dt);
}
window.addEventListener('resize', () => {
  camera.aspect = W() / H(); camera.updateProjectionMatrix();
  renderer.setSize(W(), H()); composer.setSize(W(), H());
});
window.__demo = { view, setFx, setTextures, ready, controls, render: () => render(0.016), state };
ready.then(() => { document.body.classList.add('ready'); if (!location.hash.includes('shot')) loop(); });

// ——— кнопки ———
const altEl = document.getElementById('alt');
if (altEl) altEl.textContent = `уступ ${Math.round(camp.y)} м над морем`;
if (matchMedia('(prefers-reduced-motion: reduce)').matches) controls.autoRotate = false;
const bFx = document.getElementById('bFx'), bTex = document.getElementById('bTex'), bView = document.getElementById('bView');
if (bFx) bFx.onclick = () => { setFx(!state.fx); bFx.setAttribute('aria-pressed', String(state.fx)); };
if (bTex) bTex.onclick = () => { setTextures(!state.textures); bTex.setAttribute('aria-pressed', String(state.textures)); };
let v = 1;
if (bView) bView.onclick = () => { v = v % 3 + 1; view(v); };

// ================= помощники =================

function findCamp(t) {
  const rng = makeRng(SEED + 41);
  const s = t.summit;
  let best = null, bestScore = -1e9;
  for (let k = 0; k < 30000; k++) {
    const a = rng() * Math.PI * 2, r = 30 + rng() * 90;
    const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r, y = t.heightAt(x, z);
    if (y < 36 || y > 58) continue;
    if (t.normalAt(x, z).y < 0.9) continue;
    let flat = 0;
    for (let i = 0; i < 16; i++) {
      const aa = (i / 16) * Math.PI * 2;
      for (const rr of [2, 3.5]) {
        const px = x + Math.cos(aa) * rr, pz = z + Math.sin(aa) * rr;
        if (t.normalAt(px, pz).y > 0.86 && Math.abs(t.heightAt(px, pz) - y) < 1.0) flat++;
      }
    }
    // лучше на юго-западе: оттуда видно море и закат
    const dir = Math.atan2(x - s.x, z - s.z);
    const want = Math.atan2(SUN_DIR.x, SUN_DIR.z) * 0.5;
    let da = dir - want; da = Math.atan2(Math.sin(da), Math.cos(da));
    const score = flat * 3 - Math.abs(da) * 12 - Math.abs(y - 46) * 0.2;
    if (score > bestScore) { bestScore = score; best = new THREE.Vector3(x, y, z); }
  }
  return best;
}

function flatten(t, c, r0, r1) {
  const S = N + 1;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL;
    const d = Math.hypot(x - c.x, z - c.z);
    if (d > r1) continue;
    const w = 1 - smoothstep(r0, r1, d);
    const k = j * S + i;
    t.h[k] = t.h[k] + (c.y - t.h[k]) * w;
  }
}

function loadTextures() {
  const L = new THREE.TextureLoader();
  const get = (n, srgb) => {
    const tx = L.load(ASSETS[n + '.jpg']);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tx.anisotropy = 4;
    return tx;
  };
  return {
    rock: get('cliff_side_diff', true), rockN: get('cliff_side_nor'),
    grass: get('grass_ground_diff', true), grassN: get('grass_ground_nor'),
    sand: get('coast_sand_01_diff', true), sandN: get('coast_sand_01_nor'),
    snow: get('snow_02_diff', true), snowN: get('snow_02_nor'),
  };
}

function terrainGeometry(t) {
  const S = N + 1;
  const pos = new Float32Array(S * S * 3), col = new Float32Array(S * S * 3);
  const c = new THREE.Color();
  const P = {
    wet: new THREE.Color('#c9ad80'), sand: new THREE.Color('#efd8a6'), grass: new THREE.Color('#93cc5c'),
    forest: new THREE.Color('#5ea24a'), alpine: new THREE.Color('#a8b46c'), snow: new THREE.Color('#f5f8fb'),
  };
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const k = j * S + i, x = -HALF + i * CELL, z = -HALF + j * CELL, y = t.h[k];
    pos.set([x, y, z], k * 3);
    if (y < 0.5) c.copy(P.wet);
    else if (y < 2.6) c.copy(P.sand).lerp(P.grass, smoothstep(1.7, 2.6, y));
    else if (y < 45) c.copy(P.grass).lerp(P.forest, smoothstep(6, 32, y));
    else if (y < 108) c.copy(P.forest).lerp(P.alpine, smoothstep(48, 85, y));
    else c.copy(P.alpine).lerp(P.snow, smoothstep(108, 120, y));
    col.set([c.r, c.g, c.b], k * 3);
  }
  const idx = new Uint32Array(N * N * 6);
  let p = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * S + i, b = a + 1, d = a + S, e = d + 1;
    idx.set([a, d, b, b, d, e], p); p += 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

// Рельеф: наши мультяшные цвета + настоящие текстуры (камень проецируется с трёх сторон, чтобы не тянулся на стенах).
function terrainMaterial(T) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uTex = { value: 1 };
  m.userData.uTex = uTex;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tRock: { value: T.rock }, tRockN: { value: T.rockN }, tGrass: { value: T.grass }, tGrassN: { value: T.grassN },
      tSand: { value: T.sand }, tSandN: { value: T.sandN }, tSnow: { value: T.snow }, tSnowN: { value: T.snowN }, uTex,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec3 vWN;
        uniform sampler2D tRock, tRockN, tGrass, tGrassN, tSand, tSandN, tSnow, tSnowN; uniform float uTex;
        float gvHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gvNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(gvHash(i), gvHash(i + vec2(1.0, 0.0)), u.x), mix(gvHash(i + vec2(0.0, 1.0)), gvHash(i + vec2(1.0, 1.0)), u.x), u.y); }
        vec3 gvBlend(vec3 n){ vec3 b = pow(abs(n), vec3(4.0)); return b / (b.x + b.y + b.z); }
        vec3 triColor(sampler2D t, vec3 p, vec3 n, float s){ vec3 b = gvBlend(n);
          return texture2D(t, p.zy * s).rgb * b.x + texture2D(t, p.xz * s).rgb * b.y + texture2D(t, p.xy * s).rgb * b.z; }
        vec3 triNormal(sampler2D t, vec3 p, vec3 n, float s){ vec3 b = gvBlend(n);
          vec3 tx = texture2D(t, p.zy * s).xyz * 2.0 - 1.0, ty = texture2D(t, p.xz * s).xyz * 2.0 - 1.0, tz = texture2D(t, p.xy * s).xyz * 2.0 - 1.0;
          tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x); ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y); tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
          return normalize(tx.zyx * b.x + ty.xzy * b.y + tz.xyz * b.z); }
        float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
        float gSteep, gSand, gSnow;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 wn = normalize(vWN);
          gSteep = 1.0 - smoothstep(0.58, 0.8, wn.y);
          gSand = 1.0 - smoothstep(1.8, 2.8, vWP.y);
          gSnow = smoothstep(110.0, 122.0, vWP.y);
          float n1 = gvNoise(vWP.xz * 0.22), n2 = gvNoise(vWP.xz * 1.1 + 7.0);
          float detail = n1 * 0.6 + n2 * 0.4;
          vec3 ground = diffuseColor.rgb * (0.85 + 0.3 * detail);
          float spots = smoothstep(0.35, 0.75, gvNoise(vWP.xz * 0.06 + 11.0)) * (1.0 - gSand) * (1.0 - gSnow);
          ground = mix(ground, ground * vec3(1.15, 1.06, 0.72), spots * 0.55);
          if (uTex > 0.5) {
            float lg = lum(texture2D(tGrass, vWP.xz * 0.25).rgb), ls = lum(texture2D(tSand, vWP.xz * 0.3).rgb), lw = lum(texture2D(tSnow, vWP.xz * 0.2).rgb);
            float lt = mix(mix(lg * 2.0, ls * 1.9, gSand), lw * 1.15, gSnow);
            ground *= mix(1.0, clamp(lt, 0.55, 1.45), 0.75);
          }
          // скалы: слоистый песчаник
          float warp = gvNoise(vWP.xz * 0.045) * 9.0;
          float band = smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(vWP.y * 1.5 + warp));
          vec3 rock = mix(vec3(0.72, 0.36, 0.17), vec3(0.5, 0.24, 0.11), band);
          if (uTex > 0.5) {
            vec3 rt = triColor(tRock, vWP, wn, 0.16);
            rock = mix(rock, rt * vec3(1.15, 1.0, 0.9), 0.6) * (0.75 + 0.5 * lum(rt) * 1.6);
          }
          float hi = smoothstep(62.0, 108.0, vWP.y);
          rock = mix(rock, vec3(lum(rock)) * vec3(1.0, 0.98, 0.96), hi * 0.8);
          rock = mix(rock, vec3(0.9, 0.92, 0.95), smoothstep(124.0, 140.0, vWP.y) * 0.6);
          float foam = smoothstep(0.35, 0.0, abs(vWP.y - 0.15));
          ground = mix(ground, vec3(1.0), foam * 0.7);
          diffuseColor.rgb = mix(ground, rock, gSteep);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uTex > 0.5) {
          vec3 wn = normalize(vWN);
          vec3 nr = triNormal(tRockN, vWP, wn, 0.16);
          vec3 ng = triNormal(tGrassN, vWP, wn, 0.25);
          vec3 ns = triNormal(tSandN, vWP, wn, 0.3);
          vec3 nw = triNormal(tSnowN, vWP, wn, 0.2);
          vec3 nGround = normalize(mix(mix(ng, ns, gSand), nw, gSnow));
          vec3 nW = normalize(mix(mix(wn, nGround, 0.6), nr, gSteep));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`);
  };
  return m;
}

function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSun: { value: SUN_DIR }, uDeep: { value: new THREE.Color('#2f7fb0') },
      uSky: { value: new THREE.Color('#9fc4e0') }, uSunCol: { value: new THREE.Color('#ffd09a') },
    }]),
    vertexShader: `varying vec3 vWP;
      #include <fog_pars_vertex>
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uSun, uDeep, uSky, uSunCol; varying vec3 vWP;
      #include <common>
      #include <fog_pars_fragment>
      float wv(vec2 p){ return sin(p.x * 0.21 + uTime * 0.9) * 0.5 + sin(p.y * 0.17 - uTime * 0.7) * 0.5
          + sin((p.x + p.y) * 0.53 + uTime * 1.7) * 0.25 + sin((p.x - p.y) * 0.91 - uTime * 2.1) * 0.15 + sin(p.x * 2.3 + p.y * 1.7 + uTime * 3.1) * 0.06; }
      void main(){ vec2 p = vWP.xz; float e = 0.35;
        vec3 n = normalize(vec3(wv(p - vec2(e, 0.0)) - wv(p + vec2(e, 0.0)), 2.0 * e * 3.0, wv(p - vec2(0.0, e)) - wv(p + vec2(0.0, e))));
        vec3 V = normalize(cameraPosition - vWP);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        vec3 col = mix(uDeep, uSky, clamp(fres * 0.9 + 0.08, 0.0, 1.0));
        vec3 R = reflect(-V, n);
        col += uSunCol * (pow(max(dot(R, uSun), 0.0), 220.0) * 5.0 + pow(max(dot(R, uSun), 0.0), 18.0) * 0.12);
        gl_FragColor = vec4(col, 0.93);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// Цвета Kenney слишком пастельные и бирюзовые — перекрашиваем под нашу палитру.
const PALETTE = {
  wood: '#a8754a', woodDark: '#6e4529', stone: '#9c968e', leafsFall: '#e09a4a', grass: '#5f9e3a',
  colorPurple: '#9b6fd6', colorRed: '#d9482f', colorYellow: '#f2c230', woodBark: '#7a4f2e', woodInner: '#d8b07a',
  woodBarkDark: '#5a3a22', dirt: '#9b8f80', leafsGreen: '#4f9a3e', leafsDark: '#2f6e3a',
};

function b64ToBuf(url) {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

async function loadModels() {
  const loader = new GLTFLoader();
  const names = Object.keys(ASSETS).filter((n) => n.endsWith('.glb'));
  const out = {};
  await Promise.all(names.map(async (n) => {
    const g = await loader.parseAsync(b64ToBuf(ASSETS[n]), '');
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const src = o.material;
      const c = PALETTE[src.name] ? new THREE.Color(PALETTE[src.name]) : src.color;
      o.material = new THREE.MeshLambertMaterial({ color: c, side: src.side });
      o.castShadow = true; o.receiveShadow = true;
    });
    out[n.replace('.glb', '')] = g.scene;
  }));
  return out;
}

function placeModels(M) {
  const rng = makeRng(SEED + 77);
  const tentPos = camp.clone().addScaledVector(away, -2.2).addScaledVector(side, 1.2);
  const logPos = firePos.clone().addScaledVector(side, 2.1).addScaledVector(away, 0.2);
  const stackPos = camp.clone().addScaledVector(away, -2.0).addScaledVector(side, -2.6);
  const canoePos = camp.clone().addScaledVector(away, 2.6).addScaledVector(side, 3.4);
  const keepOut = [[tentPos, 2.8], [firePos, 1.5], [heroPos, 1.3], [logPos, 1.6], [stackPos, 1.4], [canoePos, 2.0]];
  const up = new THREE.Vector3(0, 1, 0);
  const put = (name, pos, scale, rotY = 0) => {
    const o = M[name].clone();
    o.position.copy(pos); o.scale.setScalar(scale); o.rotation.y = rotY;
    scene.add(o);
    return o;
  };
  const at = (v) => { v.y = terrain.heightAt(v.x, v.z); return v; };
  const faceAway = Math.atan2(away.x, away.z);

  // лагерь
  put('campfire_stones', firePos, 2.8);
  put('campfire_logs', firePos, 2.6, 0.6);
  put('tent_detailedOpen', at(tentPos), 4.2, faceAway + 0.35);
  put('log', at(logPos), 3.4, faceAway);
  put('log_stack', at(stackPos), 3.0, faceAway + 1.2);
  put('pot_small', at(firePos.clone().addScaledVector(side, 1.0).addScaledVector(away, -0.9)), 1.3);
  put('mushroom_red', at(camp.clone().addScaledVector(away, -3.6).addScaledVector(side, 3.4)), 2.5);
  put('canoe', at(canoePos), 3.0, faceAway + 1.9);

  // много одинаковых — одним вызовом рисования на каждую часть модели
  const many = (name, list) => {
    if (!list.length) return;
    const root = M[name];
    root.updateMatrixWorld(true);
    const tmp = new THREE.Matrix4(), q = new THREE.Quaternion();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.r);
        tmp.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s * (p.sy || 1), p.s)).multiply(o.matrixWorld);
        im.setMatrixAt(i, tmp);
      });
      im.castShadow = true; im.receiveShadow = true;
      scene.add(im);
    });
  };
  const spots = (count, tries, ok, s0, s1, near) => {
    const out = [];
    for (let k = 0; k < tries && out.length < count; k++) {
      let x, z;
      if (near) { const a = rng() * Math.PI * 2, r = near.r0 + rng() * (near.r1 - near.r0); x = camp.x + Math.cos(a) * r; z = camp.z + Math.sin(a) * r; }
      else { x = (rng() * 2 - 1) * HALF * 0.88; z = (rng() * 2 - 1) * HALF * 0.88; }
      const y = terrain.heightAt(x, z);
      if (!ok(x, y, z)) continue;
      if (Math.hypot(x - camp.x, z - camp.z) < (near ? near.keep : 12)) continue;
      if (keepOut.some(([q, rr]) => Math.hypot(x - q.x, z - q.z) < rr)) continue;
      out.push({ x, y: y - 0.05, z, s: s0 + rng() * (s1 - s0), r: rng() * Math.PI * 2 });
    }
    return out;
  };
  const flat = (x, z, k = 0.88) => terrain.normalAt(x, z).y > k;

  const palms = spots(130, 30000, (x, y, z) => y > 1.9 && y < 8 && flat(x, z), 5, 7.5);
  many('tree_palmDetailedTall', palms.filter((_, i) => i % 2 === 0));
  many('tree_palmTall', palms.filter((_, i) => i % 2 === 1));
  const leafy = spots(240, 30000, (x, y, z) => y > 6 && y < 52 && flat(x, z), 4, 6.5);
  many('tree_oak', leafy.filter((_, i) => i % 3 === 0));
  many('tree_default', leafy.filter((_, i) => i % 3 === 1));
  many('tree_fat', leafy.filter((_, i) => i % 3 === 2));
  const pines = spots(220, 30000, (x, y, z) => y > 45 && y < 106 && flat(x, z), 4, 6.5);
  many('tree_pineRoundA', pines.filter((_, i) => i % 2 === 0));
  many('tree_pineTallA_detailed', pines.filter((_, i) => i % 2 === 1));
  const rocks = spots(140, 20000, (x, y, z) => y > 1.5 && flat(x, z, 0.8), 2.5, 6);
  many('rock_largeA', rocks.filter((_, i) => i % 3 === 0));
  many('rock_largeC', rocks.filter((_, i) => i % 3 === 1));
  many('rock_tallA', rocks.filter((_, i) => i % 3 === 2));
  // трава, цветы и кусты — гуще всего у лагеря
  const nearCamp = { r0: 2.0, r1: 26, keep: 1.2 };
  const grassOk = (x, y, z) => y > 3 && y < 100 && flat(x, z, 0.82);
  many('grass', spots(520, 6000, grassOk, 1.2, 1.9, nearCamp));
  many('grass_large', spots(140, 4000, grassOk, 1.2, 1.8, nearCamp));
  many('plant_bush', spots(40, 3000, grassOk, 2.0, 2.8, nearCamp));
  many('flower_yellowA', spots(60, 3000, grassOk, 1.4, 1.9, nearCamp));
  many('flower_redA', spots(45, 3000, grassOk, 1.4, 1.9, nearCamp));
  many('flower_purpleA', spots(45, 3000, grassOk, 1.4, 1.9, nearCamp));
  many('rock_smallA', spots(30, 3000, grassOk, 1.6, 2.4, nearCamp));
  many('grass', spots(1500, 30000, grassOk, 1.6, 2.4));
}
