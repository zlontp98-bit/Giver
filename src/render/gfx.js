// Картинка: рендер, небо, дымка, солнце с тенями, материал скал, эффекты и уровни качества.
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { loadTexture } from './models.js';

// fps — сколько кадров в секунду рисуем (меньше — телефон меньше греется), tex: 0 — скалы без текстур
// (только наши цвета), 1 — текстуры цвета, 2 — плюс неровности (карты нормалей)
export const QUALITY = {
  low: { name: 'Низкая', fps: 30, dpr: 0.9, shadows: 0, fx: false, ao: false, smaa: false, grass: 0.25, tex: 0, lod: 0.7 },
  medium: { name: 'Средняя', fps: 30, dpr: 1.0, shadows: 1024, fx: false, ao: false, smaa: false, grass: 0.55, tex: 1, lod: 1 },
  high: { name: 'Высокая', fps: 60, dpr: 1.5, shadows: 2048, fx: true, ao: true, smaa: true, grass: 1.0, tex: 2, lod: 1.25 },
};
export const QUALITY_ORDER = ['low', 'medium', 'high'];

export const SUN_DIR = new THREE.Vector3(-0.42, 0.78, -0.46).normalize();   // с северо-запада, высоко — то же при запекании мира
const HORIZON = new THREE.Color('#f6e4c6'), TOP = new THREE.Color('#3d8ae0');
const FOG = new THREE.Color('#ead9c2');

// «Дымка глубины»: обычная дымка по расстоянию + синеватая по высоте — чем ниже точка мира, тем сильнее
// она тонет в цвете глубины (видно с любого места: смотришь в Бездну — дно растворяется). Для всех материалов
// сразу: подменяем общие куски шейдеров three.js. Высоту берём из mvPosition (есть во всех шейдерах).
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth; varying float vFogY;\n#endif';
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogY = (transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz)).y;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying float vFogY;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float gvDeep = smoothstep( -12.0, -150.0, vFogY );
  vec3 gvFogC = mix( fogColor, vec3( 0.26, 0.42, 0.55 ), gvDeep * 0.85 );
  fogFactor = max( fogFactor, gvDeep * ( 1.0 - exp( - vFogDepth * 0.011 ) ) * 0.94 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, gvFogC, fogFactor );
#endif`;

export function createGfx() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'default', stencil: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;          // тени пересчитываем не каждый кадр (см. render)
  document.body.prepend(renderer.domElement);
  renderer.info.autoReset = false;               // считаем все проходы кадра вместе (с эффектами их несколько)

  const scene = new THREE.Scene();
  scene.background = FOG.clone();
  scene.fog = new THREE.FogExp2(FOG, 0.0042);
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.15, 1300);

  // небо: от тёплой дымки у горизонта к голубому, солнце со свечением
  // Небо рисуется первым и без проверки глубины — это просто фон. Сфера всегда внутри дальней границы
  // камеры (её радиус подстраивается в render), а в глубине Бездны небо плавно уходит в цвет дымки —
  // раньше у края оно то пропадало, то появлялось (мигало).
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1100, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
    uniforms: { top: { value: TOP }, horizon: { value: HORIZON }, sunDir: { value: SUN_DIR }, sunCol: { value: new THREE.Color('#fff1d0') },
      fogCol: { value: new THREE.Color() }, fogMix: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, horizon, sunDir, sunCol, fogCol; uniform float fogMix; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir);
        vec3 col = mix(horizon, top, pow(smoothstep(-0.02, 0.75, d.y), 0.85));
        float s = max(dot(d, sunDir), 0.0);
        col += sunCol * (pow(s, 1400.0) * 6.0 + pow(s, 40.0) * 0.35 + pow(s, 5.0) * 0.12);
        col = mix(col, fogCol, fogMix);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -3000;
  scene.add(sky);
  // видеокарта телефона может «потерять» картинку (нехватка памяти, сворачивание) — тогда восстанавливаем
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); gfx.lost = true; }, false);
  renderer.domElement.addEventListener('webglcontextrestored', () => { gfx.lost = false; gfx.setQuality(gfx.quality); }, false);

  const hemi = new THREE.HemisphereLight('#dbe9ff', '#a38a6c', 1.5);
  scene.add(hemi);
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
    renderer, scene, camera, sun, hemi, sky, quality: null, grass: [], terrainMesh: null, terrainMats: null, rockMeshes: [],
    shadowTick: 0, shadowDirty: true, lastSun: '', over: {}, resScale: 1, q: null,
    get fps() { return (QUALITY[gfx.quality] || QUALITY.low).fps; },
    setQuality(key) {
      // gfx.over — временные отличия от режима (для «подробного замера»: без текстур скал, без теней, без AO)
      const q = { ...(QUALITY[key] || QUALITY.low), ...gfx.over };
      gfx.quality = key;
      gfx.q = q;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr) * gfx.resScale);
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
        renderer.toneMapping = THREE.NeutralToneMapping;      // бережнее к цвету, чем ACES — меньше «выцветания»
      }
      for (const im of gfx.grass) im.count = Math.max(1, Math.floor(im.userData.total * q.grass));
      gfx.lodScale = q.lod || 1;                              // как далеко рисовать подробные деревья и мелочь
      if (gfx.rockMeshes.length) {
        if (!gfx.terrainMats) gfx.terrainMats = [0, 1, 2].map((lv) => (gfx.materialFactory || terrainMaterial)(lv));
        for (const m of gfx.rockMeshes) m.material = gfx.terrainMats[q.tex];
      }
      scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
      gfx.shadowDirty = true;
    },
    // чёткость рендера (доля от режима): при долгих просадках её снижает main.js (adaptQuality)
    setResScale(sc) {
      gfx.resScale = sc;
      const q = gfx.q || QUALITY.low;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr) * sc);
      renderer.setSize(window.innerWidth, window.innerHeight);
      if (composer && q.fx) composer.setSize(window.innerWidth, window.innerHeight);
    },
    // что нарисовано в последнем кадре (все проходы вместе): треугольники, вызовы отрисовки, размер рендера
    stats() {
      const r = renderer.info.render, c = renderer.domElement;
      return { tris: r.triangles, calls: r.calls, points: r.points, w: c.width, h: c.height, scale: gfx.resScale };
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
    // скомпилировать все шейдеры заранее (иначе первый показ новой модели — заминка на телефоне)
    precompile() {
      const hidden = [];
      scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      try { renderer.compile(scene, camera); } catch (e) { /* не страшно — скомпилируется при показе */ }
      for (const o of hidden) o.visible = false;
    },
    render(dt) {
      if (gfx.lost) return;
      renderer.info.reset();
      sky.position.copy(camera.position);
      sky.scale.setScalar(Math.min(1, (camera.far * 0.9) / 1100));
      sky.material.uniforms.fogCol.value.copy(scene.fog.color);
      const y = camera.position.y;
      sky.material.uniforms.fogMix.value = Math.min(1, Math.max(0, (-6 - y) / 64));
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

// ——— материал скал: наши мультяшные цвета + настоящие текстуры (камень — с трёх сторон) ———
// level 0 — без текстур (дёшево, телефон не греется), 1 — текстуры цвета, 2 — плюс неровности.
// Крупные пятна и полосы считаются в вершинах (их ~30 тысяч), а не в каждой точке экрана (их миллион):
// так стена, которая занимает почти весь экран, рисуется в несколько раз дешевле.
let TEX = null;
const NOISE_GLSL = `
  float gvHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gvNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(gvHash(i), gvHash(i + vec2(1.0, 0.0)), u.x), mix(gvHash(i + vec2(0.0, 1.0)), gvHash(i + vec2(1.0, 1.0)), u.x), u.y); }`;
export function terrainMaterial(level = 2) {
  if (!TEX) TEX = {
    rock: loadTexture('cliff_side_diff.jpg', true), rockN: loadTexture('cliff_side_nor.jpg'),
    grass: loadTexture('grass_ground_diff.jpg', true), grassN: loadTexture('grass_ground_nor.jpg'),
  };
  const T = TEX;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.defines = {};
  if (level >= 1) m.defines.TEX_COLOR = '';
  if (level >= 2) m.defines.TEX_NORMAL = '';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tRock: { value: T.rock }, tRockN: { value: T.rockN }, tGrass: { value: T.grass }, tGrassN: { value: T.grassN } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec3 vWN; varying float vRock;
        ${NOISE_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);
        {
          // слои породы (волнистые), вертикальные потёки и пятна — всё крупное, хватает вершин
          float warp = gvNoise(vec2(vWP.x + vWP.z, vWP.x - vWP.z) * 0.035) * 9.0;
          float band = smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(vWP.y * 0.9 + warp));
          float streak = gvNoise(vec2((vWP.x - vWP.z) * 0.2, vWP.y * 0.035));
          float blot = gvNoise(vec2(vWP.x + vWP.z, vWP.y * 1.2) * 0.22);
          vRock = mix(1.06, 0.9, band) * (0.82 + 0.3 * streak) * (0.86 + 0.26 * blot);
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec3 vWN; varying float vRock;
        uniform sampler2D tRock, tRockN, tGrass, tGrassN;
        ${NOISE_GLSL}
        vec3 gvBlend(vec3 n){ vec3 b = pow(abs(n), vec3(4.0)); return b / (b.x + b.y + b.z); }
        vec3 triColor(sampler2D t, vec3 p, vec3 n, float s){ vec3 b = gvBlend(n);
          return texture2D(t, p.zy * s).rgb * b.x + texture2D(t, p.xz * s).rgb * b.y + texture2D(t, p.xy * s).rgb * b.z; }
        vec3 triNormal(sampler2D t, vec3 p, vec3 n, float s){ vec3 b = gvBlend(n);
          vec3 tx = texture2D(t, p.zy * s).xyz * 2.0 - 1.0, ty = texture2D(t, p.xz * s).xyz * 2.0 - 1.0, tz = texture2D(t, p.xy * s).xyz * 2.0 - 1.0;
          tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x); ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y); tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
          return normalize(tx.zyx * b.x + ty.xzy * b.y + tz.xyz * b.z); }
        float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
        float gSteep, gVein;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 wn = normalize(vWN);
          gSteep = 1.0 - smoothstep(0.55, 0.8, wn.y);
          float detail = gvNoise(vWP.xz * 1.1 + vWP.y * 0.7);       // мелкая зернистость — одна на точку
          vec3 base = diffuseColor.rgb;
          vec3 ground = base * (0.84 + 0.32 * detail);
          vec3 rock = base * vRock * (0.9 + 0.2 * detail);
          #ifdef TEX_COLOR
            ground *= mix(1.0, clamp(lum(texture2D(tGrass, vWP.xz * 0.25).rgb) * 2.0, 0.6, 1.4), 0.7);
            rock *= 0.55 + 1.1 * lum(triColor(tRock, vWP, wn, 0.16));
          #endif
          diffuseColor.rgb = mix(ground, rock, gSteep);
          // тонкие светящиеся жилки — только глубже 100 м
          gVein = 0.0;
          if (vWP.y < -100.0) {
            float vn = gvNoise(vec2((vWP.x + vWP.z) * 0.3, vWP.y * 0.2)) * 0.7 + gvNoise(vec2((vWP.x - vWP.z) * 0.55 + 13.0, vWP.y * 0.45)) * 0.3;
            gVein = smoothstep(0.955, 0.99, 1.0 - abs(vn - 0.5) * 2.0) * smoothstep(-105.0, -175.0, vWP.y) * gSteep;
            gVein *= smoothstep(0.42, 0.62, gvNoise(vec2(vWP.x - vWP.z, vWP.y * 1.5) * 0.045 + 3.0));   // жилки пятнами, не сплошной сеткой
          }
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += mix(vec3(0.1, 0.6, 0.9), vec3(0.6, 0.25, 0.95), smoothstep(-160.0, -215.0, vWP.y)) * gVein * 0.55;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef TEX_NORMAL
        {
          vec3 wn = normalize(vWN);
          vec3 nGround = triNormal(tGrassN, vWP, wn, 0.25);
          vec3 nW = normalize(mix(mix(wn, nGround, 0.6), triNormal(tRockN, vWP, wn, 0.16), gSteep));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }
        #endif`);
  };
  return m;
}
