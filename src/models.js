// Готовые модели (Kenney Nature Kit, CC0): загрузка из base64, перекраска под нашу палитру,
// размножение одинаковых моделей одним вызовом рисования (InstancedMesh).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS } from './assets.gen.js';

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

export async function loadModels() {
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
      o.castShadow = true;
      o.receiveShadow = true;
    });
    out[n.replace('.glb', '')] = g.scene;
  }));
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
