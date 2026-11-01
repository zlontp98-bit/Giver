// Картинка: рендер, небо, дымка, солнце с тенями, вода, материал горы, эффекты и уровни качества.
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { loadTexture } from './models.js';

// fps — сколько кадров в секунду рисуем (меньше — телефон меньше греется), tex: 0 — гора без текстур
// (только наши цвета), 1 — текстуры цвета, 2 — плюс неровности (карты нормалей)
export const QUALITY = {
  low: { name: 'Низкая', fps: 30, dpr: 0.9, shadows: 0, fx: false, ao: false, smaa: false, grass: 0.25, tex: 0 },
  medium: { name: 'Средняя', fps: 30, dpr: 1.0, shadows: 1024, fx: false, ao: false, smaa: false, grass: 0.55, tex: 1 },
  high: { name: 'Высокая', fps: 60, dpr: 1.5, shadows: 2048, fx: true, ao: true, smaa: true, grass: 1.0, tex: 2 },
};
export const QUALITY_ORDER = ['low', 'medium', 'high'];

export const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();
const HORIZON = new THREE.Color('#f2e2cc'), TOP = new THREE.Color('#5fa4e0');
const FOG = new THREE.Color('#ead9c2');

export function createGfx() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'default', stencil: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;          // тени пересчитываем не каждый кадр (см. render)
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = FOG.clone();
  scene.fog = new THREE.FogExp2(FOG, 0.0042);
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2600);

  // небо: от тёплой дымки у горизонта к голубому, солнце со свечением
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: { top: { value: TOP }, horizon: { value: HORIZON }, sunDir: { value: SUN_DIR }, sunCol: { value: new THREE.Color('#fff1d0') } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, horizon, sunDir, sunCol; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir);
        vec3 col = mix(horizon, top, pow(smoothstep(-0.02, 0.75, d.y), 0.85));
        float s = max(dot(d, sunDir), 0.0);
        col += sunCol * (pow(s, 1400.0) * 6.0 + pow(s, 40.0) * 0.35 + pow(s, 5.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.frustumCulled = false;
  scene.add(sky);

  scene.add(new THREE.HemisphereLight('#d2e6ff', '#8b7052', 1.15));
  const sun = new THREE.DirectionalLight('#fff0d8', 2.7);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 420 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // ——— эффекты (создаются при первом включении; набор слоёв зависит от качества) ———
  // Важно: на экран рисует последний добавленный слой, поэтому лишние слои убираем, а не выключаем.
  let composer = null, renderPass = null, ao = null, mainPass = null, smaaPass = null;
  function configureComposer(q) {
    if (!composer) {
      const ext = renderer.extensions;
      const half = renderer.capabilities.isWebGL2 && (ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float'));
      composer = new EffectComposer(renderer, { frameBufferType: half ? THREE.HalfFloatType : THREE.UnsignedByteType });
      renderPass = new RenderPass(scene, camera);
      try {
        ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
        Object.assign(ao.configuration, { aoRadius: 1.6, distanceFalloff: 0.9, intensity: 2.4, halfRes: true, gammaCorrection: false });
      } catch (e) { ao = null; }
      const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.92, luminanceSmoothing: 0.2, intensity: 0.75, radius: 0.6 });
      mainPass = new EffectPass(camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), new VignetteEffect({ darkness: 0.38, offset: 0.35 }));
      smaaPass = new EffectPass(camera, new SMAAEffect());
    }
    composer.removeAllPasses();
    composer.addPass(renderPass);
    if (q.ao && ao) composer.addPass(ao);
    composer.addPass(mainPass);
    if (q.smaa) composer.addPass(smaaPass);
  }

  const gfx = {
    renderer, scene, camera, sun, sky, quality: null, grass: [], terrainMesh: null, terrainMats: null,
    shadowTick: 0, shadowDirty: true, lastSun: '',
    get fps() { return (QUALITY[gfx.quality] || QUALITY.low).fps; },
    setQuality(key) {
      const q = QUALITY[key] || QUALITY.low;
      gfx.quality = key;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.shadowMap.enabled = q.shadows > 0;
      sun.castShadow = q.shadows > 0;
      if (q.shadows > 0 && sun.shadow.mapSize.x !== q.shadows) {
        sun.shadow.mapSize.set(q.shadows, q.shadows);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      if (q.fx) {
        configureComposer(q);
        composer.setSize(window.innerWidth, window.innerHeight);
        renderer.toneMapping = THREE.NoToneMapping;
      } else {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
      }
      for (const im of gfx.grass) im.count = Math.max(1, Math.floor(im.userData.total * q.grass));
      if (gfx.terrainMesh) {
        if (!gfx.terrainMats) gfx.terrainMats = [0, 1, 2].map((lv) => terrainMaterial(lv));
        gfx.terrainMesh.material = gfx.terrainMats[q.tex];
      }
      scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
      gfx.shadowDirty = true;
    },
    resize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      if (composer) composer.setSize(window.innerWidth, window.innerHeight);
    },
    // тени считаются только вокруг героя — двигаем «солнце» за ним (шагами, чтобы тени не дрожали)
    follow(p) {
      const x = Math.round(p.x / 2) * 2, z = Math.round(p.z / 2) * 2, y = Math.round(p.y / 2) * 2;
      const key = `${x},${y},${z}`;
      if (key === gfx.lastSun) return;
      gfx.lastSun = key;
      gfx.shadowDirty = true;
      sun.target.position.set(x, y, z);
      sun.position.set(x, y, z).addScaledVector(SUN_DIR, 200);
      sun.target.updateMatrixWorld();
    },
    render(dt) {
      sky.position.copy(camera.position);
      const q = QUALITY[gfx.quality];
      // тени: когда «солнце» сдвинулось за героем и раз в 4 кадра (для качающихся досок и лифта)
      if (q.shadows && (gfx.shadowDirty || ++gfx.shadowTick % 4 === 0)) { renderer.shadowMap.needsUpdate = true; gfx.shadowDirty = false; }
      if (q.fx) composer.render(dt);
      else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
    },
    pixelScale() {
      return renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    },
  };
  return gfx;
}

// ——— материал горы: наши мультяшные цвета + настоящие текстуры (камень — с трёх сторон) ———
// level 0 — без текстур (дёшево, телефон не греется), 1 — текстуры цвета, 2 — плюс неровности.
let TEX = null;
export function terrainMaterial(level = 2) {
  if (!TEX) TEX = {
    rock: loadTexture('cliff_side_diff.jpg', true), rockN: loadTexture('cliff_side_nor.jpg'),
    grass: loadTexture('grass_ground_diff.jpg', true), grassN: loadTexture('grass_ground_nor.jpg'),
    sand: loadTexture('coast_sand_01_diff.jpg', true), sandN: loadTexture('coast_sand_01_nor.jpg'),
    snow: loadTexture('snow_02_diff.jpg', true), snowN: loadTexture('snow_02_nor.jpg'),
  };
  const T = TEX;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.defines = {};
  if (level >= 1) m.defines.TEX_COLOR = '';
  if (level >= 2) m.defines.TEX_NORMAL = '';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tRock: { value: T.rock }, tRockN: { value: T.rockN }, tGrass: { value: T.grass }, tGrassN: { value: T.grassN },
      tSand: { value: T.sand }, tSandN: { value: T.sandN }, tSnow: { value: T.snow }, tSnowN: { value: T.snowN },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec3 vWN;
        uniform sampler2D tRock, tRockN, tGrass, tGrassN, tSand, tSandN, tSnow, tSnowN;
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
          float detail = gvNoise(vWP.xz * 0.22) * 0.6 + gvNoise(vWP.xz * 1.1 + 7.0) * 0.4;
          vec3 ground = diffuseColor.rgb * (0.85 + 0.3 * detail);
          float spots = smoothstep(0.35, 0.75, gvNoise(vWP.xz * 0.06 + 11.0)) * (1.0 - gSand) * (1.0 - gSnow);
          ground = mix(ground, ground * vec3(1.15, 1.06, 0.72), spots * 0.55);
          float warp = gvNoise(vWP.xz * 0.045) * 9.0;
          float band = smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(vWP.y * 1.5 + warp));
          vec3 rock = mix(vec3(0.72, 0.36, 0.17), vec3(0.5, 0.24, 0.11), band);
          #ifdef TEX_COLOR
            float lg = lum(texture2D(tGrass, vWP.xz * 0.25).rgb), ls = lum(texture2D(tSand, vWP.xz * 0.3).rgb), lw = lum(texture2D(tSnow, vWP.xz * 0.2).rgb);
            ground *= mix(1.0, clamp(mix(mix(lg * 2.0, ls * 1.9, gSand), lw * 1.15, gSnow), 0.55, 1.45), 0.75);
            vec3 rt = triColor(tRock, vWP, wn, 0.16);
            rock = mix(rock, rt * vec3(1.15, 1.0, 0.9), 0.6) * (0.75 + 0.8 * lum(rt));
          #else
            float fine = 0.5 + 0.5 * sin(vWP.y * 6.5 + warp * 2.0);
            rock *= (0.9 + 0.12 * fine) * (0.86 + 0.28 * gvNoise(vec2(vWP.x + vWP.z, vWP.y) * 0.7));
          #endif
          float hi = smoothstep(62.0, 108.0, vWP.y);
          rock = mix(rock, vec3(lum(rock)) * vec3(1.0, 0.98, 0.96), hi * 0.8);
          rock = mix(rock, vec3(0.9, 0.92, 0.95), smoothstep(124.0, 140.0, vWP.y) * 0.6);
          float foam = smoothstep(0.35, 0.0, abs(vWP.y - 0.15));
          ground = mix(ground, vec3(1.0), foam * 0.7);
          diffuseColor.rgb = mix(ground, rock, gSteep);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef TEX_NORMAL
        {
          vec3 wn = normalize(vWN);
          vec3 nGround = normalize(mix(mix(triNormal(tGrassN, vWP, wn, 0.25), triNormal(tSandN, vWP, wn, 0.3), gSand), triNormal(tSnowN, vWP, wn, 0.2), gSnow));
          vec3 nW = normalize(mix(mix(wn, nGround, 0.6), triNormal(tRockN, vWP, wn, 0.16), gSteep));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }
        #endif`);
  };
  return m;
}

export function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSun: { value: SUN_DIR }, uDeep: { value: new THREE.Color('#2f86b8') },
      uSky: { value: new THREE.Color('#a6d0ea') }, uSunCol: { value: new THREE.Color('#fff0c8') },
    }]),
    vertexShader: `varying vec3 vWP;
      #include <fog_pars_vertex>
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uSun, uDeep, uSky, uSunCol; varying vec3 vWP;
      #include <common>
      #include <fog_pars_fragment>
      // наклон волн считаем сразу формулой (а не по четырём соседним точкам) — в 4 раза дешевле
      vec2 wgrad(vec2 p){ vec2 g = vec2(0.0);
        g += vec2(0.21, 0.0) * cos(p.x * 0.21 + uTime * 0.9) * 0.5;
        g += vec2(0.0, 0.17) * cos(p.y * 0.17 - uTime * 0.7) * 0.5;
        g += vec2(0.53, 0.53) * cos((p.x + p.y) * 0.53 + uTime * 1.7) * 0.25;
        g += vec2(0.91, -0.91) * cos((p.x - p.y) * 0.91 - uTime * 2.1) * 0.15;
        g += vec2(2.3, 1.7) * cos(p.x * 2.3 + p.y * 1.7 + uTime * 3.1) * 0.06;
        return g; }
      void main(){ vec2 g = wgrad(vWP.xz);
        vec3 n = normalize(vec3(-g.x / 3.0, 1.0, -g.y / 3.0));
        vec3 V = normalize(cameraPosition - vWP);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        vec3 col = mix(uDeep, uSky, clamp(fres * 0.9 + 0.08, 0.0, 1.0));
        vec3 R = reflect(-V, n);
        col += uSunCol * (pow(max(dot(R, uSun), 0.0), 220.0) * 4.0 + pow(max(dot(R, uSun), 0.0), 18.0) * 0.1);
        gl_FragColor = vec4(col, 0.9);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}
