// Демо «Графика 2.0»: та же гора, но мягкий свет, дымка, тени, слоистые скалы, пальмы и новый герой.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Terrain, N, CELL, HALF } from '../../src/terrain.js';
import { makeRng, smoothstep } from '../../src/noise.js';
import { makeHero } from './hero.js';

const SEED = 20261101;
const W = window.innerWidth, H = window.innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = new THREE.Color('#e9eee4'), TOP = new THREE.Color('#86bfe6');
scene.fog = new THREE.FogExp2(HORIZON, 0.0058);
const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 2000);

// небо: плавный переход от дымки у горизонта к голубому, солнце
const SUN_DIR = new THREE.Vector3(-0.45, 0.62, 0.64).normalize();
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  uniforms: { top: { value: TOP }, horizon: { value: HORIZON }, sunDir: { value: SUN_DIR }, sunCol: { value: new THREE.Color('#fff2cf') } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 top, horizon, sunDir, sunCol; varying vec3 vDir;
    void main(){ vec3 d = normalize(vDir); float h = d.y;
      vec3 col = mix(horizon, top, pow(smoothstep(-0.05, 0.75, h), 0.9));
      float s = max(dot(d, sunDir), 0.0);
      col += sunCol * (pow(s, 900.0) * 4.0 + pow(s, 14.0) * 0.22);
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
}));
scene.add(sky);

scene.add(new THREE.HemisphereLight('#dceeff', '#b8935f', 1.25));
const sun = new THREE.DirectionalLight('#fff0d4', 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 400;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);

const terrain = new Terrain(SEED);
scene.add(stylizedTerrain(terrain));

// море
const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: '#58b7d8', transparent: true, opacity: 0.86 }));
sea.rotation.x = -Math.PI / 2;
sea.position.y = 0.02;
scene.add(sea);

// место для героя: уступ на южном склоне на высоте ~45 м
const s = terrain.summit;
let hero = null;
for (let d = 10; d < HALF; d += 0.5) {
  const x = s.x + Math.sin(0.25) * d, z = s.z + Math.cos(0.25) * d;
  const y = terrain.heightAt(x, z);
  if (y < 47 && terrain.normalAt(x, z).y > 0.9) { hero = new THREE.Vector3(x, y, z); break; }
}
const away = new THREE.Vector3(hero.x - s.x, 0, hero.z - s.z).normalize();   // от горы — к морю
const start = new THREE.Vector3(0, terrain.heightAt(0, 112), 112);

addVegetation(scene, terrain, [hero, start]);
addClouds(scene, s);

const H1 = makeHero();
H1.root.position.copy(hero);
H1.root.rotation.y = Math.atan2(away.x, away.z) + 0.35;
H1.armR.rotation.set(-0.2, 0, 2.5);          // машет рукой
H1.head.rotation.z = 0.08;
scene.add(H1.root);

// ——— кадры ———
function frame(n) {
  if (n === 1) {          // герой крупно, за ним скалы
    const side = new THREE.Vector3(away.z, 0, -away.x);
    camera.position.copy(hero).addScaledVector(away, 3.1).addScaledVector(side, 1.1).add(new THREE.Vector3(0, 1.25, 0));
    camera.lookAt(hero.x, hero.y + 1.0, hero.z);
    aimSun(hero);
  } else if (n === 2) {   // со спины героя — вид на остров и море
    camera.position.copy(hero).addScaledVector(away, -4.2).add(new THREE.Vector3(0, 2.6, 0));
    const look = hero.clone().addScaledVector(away, 40); look.y = hero.y - 14;
    camera.lookAt(look);
    aimSun(hero);
  } else {                // с пляжа на гору
    camera.position.copy(start).add(new THREE.Vector3(6, 1.7, 6));
    camera.lookAt(s.x, s.y * 0.45, s.z);
    aimSun(start);
  }
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
}
function aimSun(p) {
  sun.target.position.copy(p);
  sun.position.copy(p).addScaledVector(SUN_DIR, 150);
  sun.target.updateMatrixWorld();
}
window.__frame = frame;
frame(1);

// ——— рельеф: гладкий, слоистый песчаник на стенах, шум на земле ———
function stylizedTerrain(t) {
  const S = N + 1;
  const pos = new Float32Array(S * S * 3), col = new Float32Array(S * S * 3);
  const c = new THREE.Color(), n = new THREE.Vector3();
  const P = {
    wet: new THREE.Color('#cbb083'), sand: new THREE.Color('#f0dcaa'), grass: new THREE.Color('#8fcc5e'),
    forest: new THREE.Color('#5ea44c'), alpine: new THREE.Color('#a9b56d'), snow: new THREE.Color('#f5f8fb'),
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
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uRockA: { value: new THREE.Color('#d9925a') }, uRockB: { value: new THREE.Color('#b06a3e') },
      uRockC: { value: new THREE.Color('#a39d97') }, uRockD: { value: new THREE.Color('#7d7772') },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec3 vWN;
        uniform vec3 uRockA, uRockB, uRockC, uRockD;
        float gvHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gvNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(gvHash(i), gvHash(i + vec2(1.0, 0.0)), u.x), mix(gvHash(i + vec2(0.0, 1.0)), gvHash(i + vec2(1.0, 1.0)), u.x), u.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float n1 = gvNoise(vWP.xz * 0.22), n2 = gvNoise(vWP.xz * 1.1 + 7.0), n3 = gvNoise(vWP.xz * 4.5 + 3.0);
          float detail = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
          float steep = 1.0 - smoothstep(0.58, 0.8, normalize(vWN).y);
          float warp = gvNoise(vWP.xz * 0.045) * 9.0 + gvNoise(vec2(vWP.x + vWP.z, vWP.y) * 0.35) * 1.4;
          float band = smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(vWP.y * 1.5 + warp));
          float fine = 0.5 + 0.5 * sin(vWP.y * 7.0 + warp * 2.3);
          float hi = smoothstep(60.0, 105.0, vWP.y);
          vec3 rock = mix(mix(uRockA, uRockC, hi), mix(uRockB, uRockD, hi), band);
          rock *= (0.9 + 0.12 * fine) * (0.86 + 0.28 * detail);
          rock = mix(rock, vec3(0.93, 0.95, 0.97), smoothstep(122.0, 138.0, vWP.y) * 0.6);
          float spots = smoothstep(0.35, 0.75, gvNoise(vWP.xz * 0.06 + 11.0));
          vec3 ground = diffuseColor.rgb * (0.8 + 0.4 * detail);
          float grassy = smoothstep(2.6, 4.0, vWP.y) * (1.0 - smoothstep(100.0, 112.0, vWP.y));
          ground = mix(ground, ground * vec3(1.18, 1.08, 0.72), spots * grassy * 0.6);
          float foam = smoothstep(0.35, 0.0, abs(vWP.y - 0.12));
          ground = mix(ground, vec3(1.0), foam * 0.7);
          diffuseColor.rgb = mix(ground, rock, steep);
        }`);
  };
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function addVegetation(scene, t, keepAway) {
  const rng = makeRng(SEED + 3);
  const far = (x, z, r) => keepAway.every((p) => Math.hypot(p.x - x, p.z - z) > r);
  const spots = (count, tries, ok) => {
    const out = [];
    for (let k = 0; k < tries && out.length < count; k++) {
      const x = (rng() * 2 - 1) * HALF * 0.88, z = (rng() * 2 - 1) * HALF * 0.88, y = t.heightAt(x, z);
      if (ok(x, y, z) && far(x, z, 3.5)) out.push({ x, y, z, s: 0.8 + rng() * 0.5, r: rng() * Math.PI * 2 });
    }
    return out;
  };
  const place = (geo, material, list, lift = 0) => {
    const im = new THREE.InstancedMesh(geo, material, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, p.r);
      m.compose(new THREE.Vector3(p.x, p.y + lift, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
      im.setMatrixAt(i, m);
    });
    im.castShadow = true; im.receiveShadow = true;
    scene.add(im);
    return im;
  };

  // пальмы на берегу
  const palms = spots(140, 20000, (x, y, z) => y > 1.9 && y < 9 && t.normalAt(x, z).y > 0.9);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, 2.6, 0), new THREE.Vector3(0.9, 4.6, 0));
  const trunk = new THREE.TubeGeometry(curve, 10, 0.15, 7, false);
  place(trunk, new THREE.MeshLambertMaterial({ color: '#a77b4f' }), palms);
  const fronds = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.PlaneGeometry(0.55, 2.5, 1, 7);
    g.translate(0, 1.25, 0);
    g.rotateZ(-Math.PI / 2);
    const a = g.attributes.position;
    for (let v = 0; v < a.count; v++) {
      const x = a.getX(v), zz = a.getY(v);
      a.setY(v, -0.16 * x * x + Math.abs(zz) * 0.25);          // свисает и чуть сложен «домиком»
      a.setZ(v, zz * (1 - x / 3.2));                             // сужается к концу
    }
    g.rotateY((i / 8) * Math.PI * 2 + (i % 2) * 0.2);
    g.translate(0.9, 4.6, 0);
    fronds.push(g);
  }
  const frondGeo = mergeGeometries(fronds);
  frondGeo.computeVertexNormals();
  place(frondGeo, new THREE.MeshLambertMaterial({ color: '#4fae4a', side: THREE.DoubleSide }), palms);

  // круглые лиственные деревья пониже, ёлки повыше
  const leafy = spots(260, 20000, (x, y, z) => y > 7 && y < 55 && t.normalAt(x, z).y > 0.88);
  const lt = new THREE.CylinderGeometry(0.14, 0.22, 2.2, 7); lt.translate(0, 1.1, 0);
  place(lt, new THREE.MeshLambertMaterial({ color: '#7b5233' }), leafy);
  const crown = mergeGeometries([
    new THREE.IcosahedronGeometry(1.15, 2).translate(0, 2.7, 0),
    new THREE.IcosahedronGeometry(0.85, 2).translate(0.75, 2.3, 0.2),
    new THREE.IcosahedronGeometry(0.8, 2).translate(-0.6, 2.4, -0.35),
  ]);
  const crowns = place(crown, new THREE.MeshLambertMaterial({ color: '#ffffff' }), leafy);
  const tint = new THREE.Color();
  leafy.forEach((_, i) => { tint.setHSL(0.27 + rng() * 0.07, 0.5, 0.36 + rng() * 0.1); crowns.setColorAt(i, tint); });

  const pines = spots(160, 20000, (x, y, z) => y > 50 && y < 100 && t.normalAt(x, z).y > 0.88);
  const pt = new THREE.CylinderGeometry(0.12, 0.18, 1.4, 6); pt.translate(0, 0.7, 0);
  place(pt, new THREE.MeshLambertMaterial({ color: '#6b4a2f' }), pines);
  const pc = mergeGeometries([new THREE.ConeGeometry(1.1, 2.2, 10).translate(0, 2.0, 0), new THREE.ConeGeometry(0.8, 1.7, 10).translate(0, 3.1, 0)]);
  place(pc, new THREE.MeshLambertMaterial({ color: '#3f7f45' }), pines);

  // валуны — бугристые, гладкие
  const rocks = spots(160, 20000, (x, y, z) => y > 1.5 && t.normalAt(x, z).y > 0.8);
  const rg = new THREE.IcosahedronGeometry(1, 2);
  const ra = rg.attributes.position;
  for (let v = 0; v < ra.count; v++) {
    const k = 1 + 0.18 * Math.sin(ra.getX(v) * 4.1) * Math.cos(ra.getZ(v) * 3.3);
    ra.setXYZ(v, ra.getX(v) * k * 1.2, ra.getY(v) * k * 0.7, ra.getZ(v) * k);
  }
  rg.computeVertexNormals();
  place(rg, new THREE.MeshLambertMaterial({ color: '#b3a796' }), rocks.map((r) => ({ ...r, s: r.s * 0.7 })), 0.15);
}

function addClouds(scene, s) {
  const rng = makeRng(SEED + 7);
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const mtl = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#c9d6e3', emissiveIntensity: 0.25 });
  const list = [];
  for (let c = 0; c < 22; c++) {
    const a = rng() * Math.PI * 2, r = 90 + rng() * 260, cy = 100 + rng() * 70;
    const cx = s.x + Math.cos(a) * r, cz = s.z + Math.sin(a) * r;
    for (let i = 0; i < 6; i++) list.push([cx + (rng() - 0.5) * 22, cy + (rng() - 0.3) * 4, cz + (rng() - 0.5) * 12, 5 + rng() * 6]);
  }
  const im = new THREE.InstancedMesh(geo, mtl, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  list.forEach(([x, y, z, r], i) => { m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(r * 1.5, r * 0.65, r)); im.setMatrixAt(i, m); });
  scene.add(im);
}
