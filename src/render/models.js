// Готовые модели (Kenney Nature Kit, CC0): загрузка из base64, перекраска под нашу палитру,
// размножение одинаковых моделей одним вызовом рисования (InstancedMesh).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS } from '../assets.gen.js';

// Цвета Kenney пастельные и бирюзовые — заменяем по имени материала.
export const PALETTE = {
  wood: '#a8754a', woodDark: '#6e4529', stone: '#9c968e', stoneDark: '#7b766f', leafsFall: '#e09a4a', grass: '#5f9e3a',
  colorPurple: '#9b6fd6', colorRed: '#d9482f', colorRedDark: '#a8331f', colorYellow: '#f2c230', woodBark: '#7a4f2e',
  woodInner: '#d8b07a', woodBarkDark: '#5a3a22', dirt: '#9b8f80', dirtDark: '#7d6f60', leafsGreen: '#4f9a3e', leafsDark: '#2f6e3a',
};

function b64ToBuf(url) {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

// Модели наборов Kenney с общей текстурой-палитрой (colormap.png) называются с приставкой набора:
// sv- (выживание), ft- (городок), tr- (железная дорога), dg- (подземелье). Палитру берём из ASSETS.
const KITS = ['sv', 'ft', 'tr', 'dg'];

// Природа Quaternius (Stylized Nature MegaKit, CC0) — приставка q-: текстуры общие (q-*.png|jpg в ASSETS,
// по 256 px), листва — вырезка по альфе с двух сторон, у кроны нормали «шаром» от её середины (мягкий
// стилизованный свет без лишних треугольников). Цвет вершин (затенение у ствола, у травы) — как есть.
const qMaps = {};
async function loadQ(n) {
  const mgr = new THREE.LoadingManager();
  mgr.setURLModifier((u) => ASSETS[u.split('/').pop()] || u);
  const g = await new GLTFLoader(mgr).parseAsync(b64ToBuf(ASSETS[n]), '');
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.material;
    let map = src.map || null;
    if (map) {
      const key = map.name || map.uuid;
      map = qMaps[key] || (qMaps[key] = map);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 1;
    }
    const leafy = /leaf|leaves|grass|flower|fern|clover|plant/i.test(src.name);
    o.material = new THREE.MeshLambertMaterial({
      map, color: src.color, vertexColors: !!o.geometry.attributes.color,
      alphaTest: src.alphaTest > 0 || src.transparent || leafy ? 0.42 : 0, side: src.side,
    });
    o.material.name = src.name;
    if (leafy && /tree|pine|bush|leaves_normal|twisted/i.test(src.name + n)) roundNormals(o.geometry);
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return g.scene;
}
// крона: нормаль — от середины кроны наружу (смешана с настоящей), чтобы листва светилась как одно облако
function roundNormals(geo) {
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3()), p = geo.attributes.position, nr = geo.attributes.normal;
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i) - c.x, (p.getY(i) - c.y) * 0.8, p.getZ(i) - c.z).normalize();
    w.set(nr.getX(i), nr.getY(i), nr.getZ(i));
    v.multiplyScalar(0.8).addScaledVector(w, 0.2).normalize();
    nr.setXYZ(i, v.x, v.y, v.z);
  }
  nr.needsUpdate = true;
}

// подогнать модель q- по высоте к другой (чтобы размеры из запекания подходили): масштаб — в геометрию
export function fitHeight(root, toRoot) {
  const h = (r) => new THREE.Box3().setFromObject(r).getSize(new THREE.Vector3()).y;
  const k = h(toRoot) / Math.max(1e-3, h(root));
  root.traverse((o) => { if (o.isMesh) { o.geometry = o.geometry.clone(); o.geometry.scale(k, k, k); } });
  return root;
}

export async function loadModels() {
  const names = Object.keys(ASSETS).filter((n) => n.endsWith('.glb'));
  const out = {}, maps = {};
  await Promise.all(names.map(async (n) => {
    if (n.startsWith('q-')) { out[n.replace('.glb', '')] = await loadQ(n); return; }
    const kit = KITS.find((k) => n.startsWith(k + '-'));
    const mgr = new THREE.LoadingManager();
    if (kit) mgr.setURLModifier((u) => (u.endsWith('colormap.png') ? ASSETS[`${kit}-colormap.png`] : u));
    const g = await new GLTFLoader(mgr).parseAsync(b64ToBuf(ASSETS[n]), '');
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const src = o.material;
      if (src.map) {
        // одна палитра на весь набор — без мип-уровней, чтобы цвета соседних клеток не смешивались
        const map = maps[kit] || (maps[kit] = src.map);
        map.generateMipmaps = false;
        map.minFilter = THREE.LinearFilter;
        o.material = new THREE.MeshLambertMaterial({ map, side: src.side });
      } else {
        const c = PALETTE[src.name] ? new THREE.Color(PALETTE[src.name]) : src.color;
        o.material = new THREE.MeshLambertMaterial({ color: c, side: src.side });
      }
      o.castShadow = true;
      o.receiveShadow = true;
    });
    out[n.replace('.glb', '')] = kit ? g.scene : mergeColored(g.scene);
  }));
  return out;
}

// Модели без текстуры (природа Kenney): все части — в одну геометрию с цветом в вершинах.
// Тогда пачка таких моделей рисуется одним вызовом, а не двумя-тремя (листва, ствол…).
function mergeColored(root) {
  root.updateMatrixWorld(true);
  const pos = [], nor = [], col = [], idx = [];
  let side = THREE.FrontSide;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const c = o.material.color, base = pos.length / 3;
    if (o.material.side !== THREE.FrontSide) side = THREE.DoubleSide;
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side }));
  mesh.castShadow = true; mesh.receiveShadow = true;
  const out = new THREE.Group();
  out.add(mesh);
  return out;
}

export function loadTexture(name, srgb) {
  const tx = new THREE.TextureLoader().load(ASSETS[name]);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tx.anisotropy = 4;
  return tx;
}

// Много копий одной модели: list = [{x, y, z, s, r, sy?, q?}] (q — свой поворот вместо r).
// Возвращает созданные InstancedMesh.
export function instance(scene, root, list, { shadow = true } = {}) {
  if (!list.length) return [];
  root.updateMatrixWorld(true);
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), m = new THREE.Matrix4();
  const made = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, list.length);
    list.forEach((p, i) => {
      if (p.q) q.copy(p.q); else q.setFromAxisAngle(up, p.r || 0);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s * (p.sy || 1), p.s)).multiply(o.matrixWorld);
      im.setMatrixAt(i, m);
    });
    im.castShadow = shadow;
    im.receiveShadow = true;
    scene.add(im);
    made.push(im);
  });
  return made;
}

export function place(scene, root, pos, scale, rotY = 0) {
  const o = root.clone();
  o.position.copy(pos);
  o.scale.setScalar(scale);
  o.rotation.y = rotY;
  scene.add(o);
  return o;
}
