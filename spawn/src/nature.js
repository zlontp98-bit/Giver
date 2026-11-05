// Растения и камни: ёлки (подробные рядом, простые вдали), лиственные «пушистые» деревья, кусты,
// трава с ветром, валуны. Всё одинаковое — InstancedMesh (один вызов рисования на вид).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise3D } from '../../src/noise.js';

const n3 = makeNoise3D(77);
function paint(g, fn) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color(), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v, col, i); c.set([col.r, col.g, col.b], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const strip = (g) => { const o = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(o.attributes)) if (!['position', 'normal', 'color'].includes(k)) o.deleteAttribute(k); return o; };

// ——— ёлка: ярусы «лап» с зубчатым краем, тёмная внутри, светлая на концах ———
export function pineGeometry(detail = true) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.3, 3.2, detail ? 7 : 5, 1);
  trunk.translate(0, 1.6, 0);
  parts.push(paint(trunk, (v, c) => c.set('#5a3b26').multiplyScalar(0.8 + 0.3 * (v.y / 3.2))));
  const tiers = detail ? 7 : 2;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const r = 2.6 * (1 - f * 0.82) * (detail ? 1 + 0.08 * Math.sin(t * 2.7) : 1), h = (detail ? 2.1 : 2.8) - f * 0.8, y = 1.4 + f * 6.8;
    const seg = detail ? 13 : 7;
    const cone = new THREE.ConeGeometry(r, h, seg, detail ? 2 : 1, true);
    const p = cone.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (v.y < -h / 2 + 0.01) {          // нижний край — зубцы и провисание
        const a = Math.atan2(v.x, v.z), k = 1 + 0.2 * Math.sin(a * 8 + t * 1.3) + 0.08 * Math.sin(a * 3 + t);
        v.x *= k; v.z *= k; v.y -= 0.35 * k;
      }
      p.setXYZ(i, v.x, v.y, v.z);
    }
    cone.rotateY(t * 0.7);
    cone.translate(0, y, 0);
    cone.computeVertexNormals();
    // нормали «пушистые»: от оси наружу и чуть вверх — мягкий объём без гранёности
    const nn = cone.attributes.normal;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(cone.attributes.position, i); const l = Math.hypot(v.x, v.z) || 1; nn.setXYZ(i, v.x / l * 0.8, 0.6, v.z / l * 0.8); }
    parts.push(paint(cone, (v, c) => {
      const edge = Math.min(1, Math.hypot(v.x, v.z) / r);
      c.set('#24502e').lerp(new THREE.Color('#4f8f3c'), edge * 0.8 + f * 0.25);
      if (edge > 0.85) c.lerp(new THREE.Color('#8fbf55'), 0.25);
    }));
  }
  return mergeGeometries(parts.map(strip));
}

// ——— лиственное дерево: ствол и пушистая крона из нескольких «шаров» ———
export function roundTreeGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.42, 3.4, 8, 3);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + Math.sin(y * 0.9) * 0.15); }
  trunk.translate(0, 1.7, 0); trunk.computeVertexNormals();
  parts.push(paint(trunk, (v, c) => c.set('#6b4a30')));
  const blobs = [[0, 4.6, 0, 2.3], [1.4, 4.1, 0.4, 1.6], [-1.2, 4.3, -0.5, 1.7], [0.3, 5.6, -0.6, 1.5], [-0.4, 3.9, 1.2, 1.4]];
  const center = new THREE.Vector3(0, 4.6, 0);
  for (const [x, y, z, r] of blobs) {
    const s = new THREE.IcosahedronGeometry(r, 1);
    const p = s.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = 1 + 0.18 * n3(v.x * 1.3 + x, v.y * 1.3 + y, v.z * 1.3 + z);
      p.setXYZ(i, v.x * k + x, v.y * k * 0.9 + y, v.z * k + z);
    }
    const nn = s.attributes.normal;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).sub(center).normalize(); nn.setXYZ(i, v.x, v.y, v.z); }
    parts.push(paint(s, (v, c) => {
      const up = (v.y - 3) / 4;
      c.set('#2f6a2e').lerp(new THREE.Color('#78b44a'), Math.max(0, Math.min(1, up * 0.8 + 0.15 * n3(v.x, v.y, v.z))));
    }));
  }
  return mergeGeometries(parts.map(strip));
}

export function bushGeometry() {
  const parts = [];
  for (const [x, y, z, r] of [[0, 0.5, 0, 0.75], [0.6, 0.4, 0.2, 0.55], [-0.5, 0.42, -0.2, 0.6], [0.1, 0.85, -0.2, 0.5]]) {
    const s = new THREE.IcosahedronGeometry(r, 1);
    const p = s.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + 0.2 * n3(v.x * 3 + x, v.y * 3, v.z * 3); p.setXYZ(i, v.x * k + x, v.y * k + y, v.z * k + z); }
    const nn = s.attributes.normal;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).sub(new THREE.Vector3(0, 0.2, 0)).normalize(); nn.setXYZ(i, v.x, v.y, v.z); }
    parts.push(paint(s, (v, c) => c.set('#2e6a30').lerp(new THREE.Color('#6aa844'), Math.min(1, v.y / 1.2))));
  }
  return mergeGeometries(parts.map(strip));
}

// ——— валун: неровный шар, сверху мох ———
export function boulderGeometry(seed, flat = 1, moss = true, detail = 3) {
  const ico = new THREE.IcosahedronGeometry(1, detail); ico.deleteAttribute('uv'); ico.deleteAttribute('normal');
  const g = mergeVertices(ico);                      // общие вершины — гладкие нормали, без граней
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.28 * n3(v.x * 1.4 + seed, v.y * 1.4, v.z * 1.4) + 0.08 * n3(v.x * 4, v.y * 4 + seed, v.z * 4);
    p.setXYZ(i, v.x * k * 1.2, Math.max(-0.35, v.y * k * 0.72 * flat), v.z * k);
  }
  g.computeVertexNormals();
  return strip(paint(g, (v, c, i) => {
    const ny = g.attributes.normal.getY(i);
    c.set(moss ? '#8f877d' : '#b8ad9c').multiplyScalar(0.85 + 0.25 * n3(v.x * 3, v.y * 3, v.z * 3 + seed));
    if (moss && ny > 0.55) c.lerp(new THREE.Color('#6c9440'), Math.min(1, (ny - 0.55) * 2.5));
  }));
}

// ——— трава: пучок изогнутых травинок, качается на ветру (в вершинах) ———
export function grassGeometry() {
  const parts = [];
  for (let b = 0; b < 6; b++) {
    const a = b * 2.39, r = 0.12 * (b % 3), h = 0.45 + ((b * 37) % 10) / 22;
    const g = new THREE.PlaneGeometry(0.09, h, 1, 3);
    g.translate(0, h / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / h; p.setZ(i, p.getZ(i) + y * y * 0.22); if (y > 0.99) p.setX(i, 0); }
    g.rotateY(a); g.translate(Math.sin(a) * r, 0, Math.cos(a) * r);
    const nn = g.attributes.normal;
    for (let i = 0; i < p.count; i++) nn.setXYZ(i, 0, 1, 0);       // как у земли — без тёмной изнанки
    parts.push(paint(g, (v, c) => c.set('#3d7a2a').lerp(new THREE.Color('#a8d060'), Math.min(1, v.y / 0.8))));
  }
  return mergeGeometries(parts.map(strip));
}

export const windUniform = { value: 0 };
export function windMaterial(opts = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windUniform;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float sway = sin(uWind * 1.7 + ip.x * 0.35 + ip.z * 0.22) * 0.5 + sin(uWind * 2.9 + ip.x * 0.9) * 0.25;
          transformed.x += sway * position.y * position.y * 0.35;
          transformed.z += sway * position.y * position.y * 0.18;
        #endif`);
    // обе стороны травинки освещены одинаково (без тёмной изнанки)
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', 'vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;');
  };
  return m;
}

// то же, но по клеткам сетки: каждая клетка — свой InstancedMesh, вне кадра не рисуется
export function instancedCells(scene, geo, mat, list, cell, opts) {
  const cells = new Map();
  for (const p of list) { const k = Math.floor(p.x / cell) + ',' + Math.floor(p.z / cell); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(p); }
  return [...cells.values()].map((l) => instanced(scene, geo, mat, l, opts));
}

// много копий: list = [{x, y, z, s, r, sy?}]; tint — немного разный цвет у каждой копии
export function instanced(scene, geo, mat, list, { shadow = true, receive = true, tint = 0.12 } = {}) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  list.forEach((p, i) => {
    q.setFromAxisAngle(up, p.r || 0);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s * (p.sy || 1), p.s));
    im.setMatrixAt(i, m);
    if (tint) { const k = 1 - tint + 2 * tint * (((i * 7919) % 101) / 100); im.setColorAt(i, c.setRGB(k, k * (0.97 + 0.06 * (((i * 31) % 7) / 6)), k)); }
  });
  im.castShadow = shadow; im.receiveShadow = receive;
  im.userData.total = list.length;
  scene.add(im);
  return im;
}
