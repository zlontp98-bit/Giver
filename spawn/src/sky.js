// Небо (вечер: синее сверху, тёплое у солнца, облака) и туман:
// обычная дымка по расстоянию + холодный туман, который густеет вглубь разлома.
// Цвет дымки = цвет неба у горизонта в ту же сторону — дальние скалы растворяются в небе без шва.
import * as THREE from 'three';
import { makeNoise3D } from '../../src/noise.js';

export const SUN = new THREE.Vector3(-0.45, 0.42, -0.8).normalize();   // низкое вечернее солнце за разломом, слева

const v3 = (c) => `vec3(${c.map((x) => x.toFixed(3)).join(',')})`;
const HORIZON = [0.55, 0.6, 0.92], WARM = [1.2, 0.7, 0.45], ZENITH = [0.1, 0.2, 0.58];
const MIST = [0.5, 0.58, 0.84], MIST_DEEP = [0.36, 0.34, 0.7];
const S = (v) => `vec3(${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)})`;
const HORIZON_GLSL = `
  vec3 gvHorizon(vec3 d){
    vec2 a = normalize(d.xz + 1e-5), b = normalize(${S(SUN)}.xz);
    float s = max(dot(a, b), 0.0);
    return mix(${v3(HORIZON)}, ${v3(WARM)}, pow(s, 6.0) * 0.7 + pow(s, 40.0) * 0.35);
  }`;

// заменяем туман three.js во всех материалах. Считаем его в вершинах (их в разы меньше, чем точек экрана —
// на телефоне это заметно дешевле), в точке только смешиваем цвет.
export function patchFog() {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `#ifdef USE_FOG
    varying vec4 vFog;
    #ifdef FOG_EXP2
      uniform float fogDensity;
    #endif
    ${HORIZON_GLSL}
  #endif`;
  C.fog_vertex = `#ifdef USE_FOG
    {
      vec3 fw = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
      vec3 fd = fw - cameraPosition; float dist = max(length(fd), 1e-3); vec3 vd = fd / dist;
      #ifdef FOG_EXP2
        float dens = fogDensity;
      #else
        float dens = 0.001;
      #endif
      float hm = clamp((-fw.y - 12.0) / 210.0, 0.0, 1.0);          // 0 — на плато, 1 — на глубине ~220 м
      float f = 1.0 - exp(-dist * dens);
      float m = (1.0 - exp(-dist * (0.0012 + 0.026 * hm * hm))) * smoothstep(0.0, 0.18, hm);
      vec3 fc = mix(gvHorizon(vd), mix(${v3(MIST)}, ${v3(MIST_DEEP)}, smoothstep(0.55, 1.0, hm)), smoothstep(0.0, 0.5, hm));
      vFog = vec4(fc, clamp(max(f, m), 0.0, 1.0));
    }
  #endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
    uniform vec3 fogColor; varying vec4 vFog;
    #ifdef FOG_EXP2
      uniform float fogDensity;
    #else
      uniform float fogNear; uniform float fogFar;
    #endif
  #endif`;
  C.fog_fragment = '#ifdef USE_FOG\n gl_FragColor.rgb = mix(gl_FragColor.rgb, vFog.rgb, vFog.a);\n#endif';
}

// облака — один раз рисуем в текстуру (дёшево: в кадре только одна выборка)
function cloudTexture() {
  const W = 512, H = 256, n = makeNoise3D(5);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H);
  const sunAz = Math.atan2(SUN.x, SUN.z);
  for (let y = 0; y < H; y++) {
    const el = (y / H) * Math.PI / 2;             // 0 — горизонт, низ текстуры; π/2 — зенит
    const ce = Math.cos(el);
    for (let x = 0; x < W; x++) {
      const az = (x / W) * Math.PI * 2 - Math.PI;
      const px = Math.sin(az) * ce, pz = Math.cos(az) * ce, py = Math.sin(el);
      // облака растянуты по горизонту: ниже — плотнее
      let f = 0, a = 1, fr = 1.6, norm = 0;
      for (let o = 0; o < 5; o++) { f += a * n(px * fr * 2.2, py * fr * 5.5, pz * fr * 2.2); norm += a; a *= 0.5; fr *= 2.1; }
      f /= norm;
      const band = Math.exp(-(((el - 0.22) / 0.2) ** 2)) * 0.9 + 0.25;
      let dens = Math.max(0, Math.min(1, (f + 0.12) * 2.6 * band - 0.18));
      dens = dens * dens * (3 - 2 * dens);
      // подсветка: края к солнцу — тёплые
      const toSun = Math.max(0, Math.cos(az - sunAz)) * (1 - py);
      const lit = Math.max(0, Math.min(1, 0.35 + 0.65 * toSun + 0.3 * (f - 0.1)));
      const i = ((H - 1 - y) * W + x) * 4;
      img.data[i] = dens * 255; img.data[i + 1] = lit * 255; img.data[i + 2] = 0; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
  return t;
}

export function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { tClouds: { value: cloudTexture() }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tClouds; uniform float uTime; varying vec3 vDir;
      ${HORIZON_GLSL}
      void main(){
        vec3 d = normalize(vDir);
        vec3 hor = gvHorizon(d);
        float up = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(hor, ${v3(ZENITH)}, pow(smoothstep(0.0, 0.8, up), 0.55));
        float s = max(dot(d, ${S(SUN)}), 0.0);
        col += vec3(1.0, 0.72, 0.42) * (pow(s, 900.0) * 9.0 + pow(s, 60.0) * 0.5 + pow(s, 8.0) * 0.22);
        if (d.y > 0.0) {
          vec2 uv = vec2(atan(d.x, d.z) / 6.28318 + 0.5 + uTime * 0.0008, asin(clamp(d.y, 0.0, 1.0)) / 1.5708);
          vec4 c = texture2D(tClouds, uv);
          vec3 shade = mix(vec3(0.42, 0.42, 0.68), vec3(1.25, 0.86, 0.66), c.g);
          col = mix(col, shade, c.r * 0.92 * smoothstep(0.0, 0.05, d.y));
        }
        // ниже горизонта — туман разлома
        col = mix(col, ${v3(MIST)}, smoothstep(0.0, -0.25, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// мягкое круглое пятно (облако тумана, брызги)
export function puffTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d'), n = makeNoise3D(9), img = ctx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const dx = (x - 64) / 64, dy = (y - 64) / 64, r = Math.hypot(dx, dy);
    const f = 0.5 + 0.5 * (n(x / 22, y / 22, 0) * 0.7 + n(x / 9, y / 9, 3) * 0.3);
    const a = Math.max(0, 1 - r) ** 1.6 * (0.55 + 0.6 * f);
    const i = (y * 128 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.min(255, a * 255);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// большой слой тумана (повторяющаяся текстура облаков)
export function mistTexture() {
  const W = 256, cv = document.createElement('canvas'); cv.width = cv.height = W;
  const ctx = cv.getContext('2d'), n = makeNoise3D(13), img = ctx.createImageData(W, W);
  const T = Math.PI * 2;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W * T, v = y / W * T;
    // бесшовно: шум на торе
    let f = 0, a = 1, fr = 1, nn = 0;
    for (let o = 0; o < 4; o++) { f += a * n(Math.cos(u) * fr * 1.2 + 9, Math.sin(u) * fr * 1.2 + Math.cos(v) * fr * 1.2, Math.sin(v) * fr * 1.2); nn += a; a *= 0.5; fr *= 2; }
    f = f / nn;
    const al = Math.max(0, Math.min(1, (f + 0.15) * 1.9));
    const i = (y * W + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = al * al * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
