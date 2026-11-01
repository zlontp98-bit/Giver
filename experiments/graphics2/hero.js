// Новый герой: круглый, с большими глазами, в шапке с помпоном, шарфе и с рюкзаком.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const mat = (c) => new THREE.MeshLambertMaterial({ color: c });

export function makeHero(opts = {}) {
  const C = {
    skin: '#f6c7a1', jacket: '#2fb4a6', jacketDark: '#23897f', hat: '#ff8a3d', hatDark: '#e46d22',
    pom: '#fff4e0', scarf: '#e8434f', pants: '#3b4f6b', boots: '#7a4b2c', pack: '#e0a640', mat: '#5da35a',
    eye: '#1c1c24', cheek: '#ff9b9b', ...opts,
  };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const shadowy = [];
  const add = (parent, geo, color, x, y, z) => {
    const m = new THREE.Mesh(geo, typeof color === 'string' ? mat(color) : color);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    shadowy.push(m);
    return m;
  };

  // туловище — круглая «капсула» куртки
  const torso = add(body, new THREE.CapsuleGeometry(0.27, 0.26, 6, 16), C.jacket, 0, 0.66, 0);
  torso.scale.set(1, 1, 0.9);
  // молния на куртке
  add(body, new THREE.BoxGeometry(0.03, 0.42, 0.02), C.jacketDark, 0, 0.66, 0.245);

  // голова
  const head = new THREE.Group();
  head.position.set(0, 1.22, 0.02);
  body.add(head);
  add(head, new THREE.SphereGeometry(0.38, 28, 20), C.skin, 0, 0, 0).scale.set(1, 0.95, 0.95);
  // глаза с бликами
  for (const s of [-1, 1]) {
    const e = add(head, new THREE.SphereGeometry(0.06, 16, 12), C.eye, s * 0.13, 0.03, 0.315);
    e.scale.set(0.85, 1.2, 0.5);
    add(head, new THREE.SphereGeometry(0.02, 8, 6), '#ffffff', s * 0.13 + 0.02, 0.065, 0.345);
    const ch = add(head, new THREE.SphereGeometry(0.065, 12, 8), C.cheek, s * 0.22, -0.07, 0.27);
    ch.scale.set(1, 0.6, 0.35);
  }
  // улыбка
  const smile = add(head, new THREE.TorusGeometry(0.04, 0.011, 6, 14, Math.PI), C.eye, 0, -0.07, 0.345);
  smile.rotation.z = Math.PI;
  // шапка с отворотом и помпоном
  const hat = add(head, new THREE.SphereGeometry(0.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), C.hat, 0, 0.09, 0);
  hat.scale.set(1, 1.05, 1);
  const brim = add(head, new THREE.TorusGeometry(0.375, 0.07, 10, 28), C.hatDark, 0, 0.11, 0);
  brim.rotation.x = Math.PI / 2;
  add(head, new THREE.SphereGeometry(0.1, 14, 10), C.pom, 0, 0.52, 0);

  // шарф
  const scarf = add(body, new THREE.TorusGeometry(0.21, 0.075, 10, 20), C.scarf, 0, 0.93, 0);
  scarf.rotation.x = Math.PI / 2;
  const tail = add(body, new RoundedBoxGeometry(0.12, 0.3, 0.06, 2, 0.03), C.scarf, 0.11, 0.8, 0.25);
  tail.rotation.z = 0.15;

  // руки (точка вращения — плечо) с варежками
  const arm = (s) => {
    const g = new THREE.Group();
    g.position.set(s * 0.3, 0.92, 0);
    body.add(g);
    const a = add(g, new THREE.CapsuleGeometry(0.085, 0.24, 4, 10), C.jacket, 0, -0.17, 0);
    a.castShadow = true;
    add(g, new THREE.SphereGeometry(0.1, 14, 10), C.scarf, 0, -0.36, 0.01);
    g.rotation.z = s * 0.35;
    return g;
  };
  const armL = arm(-1), armR = arm(1);

  // ноги с ботинками
  const leg = (s) => {
    const g = new THREE.Group();
    g.position.set(s * 0.13, 0.36, 0);
    root.add(g);
    add(g, new THREE.CapsuleGeometry(0.1, 0.12, 4, 10), C.pants, 0, -0.12, 0);
    const b = add(g, new RoundedBoxGeometry(0.2, 0.14, 0.3, 3, 0.06), C.boots, 0, -0.29, 0.04);
    b.castShadow = true;
    return g;
  };
  const legL = leg(-1), legR = leg(1);

  // рюкзак со спальником
  add(body, new RoundedBoxGeometry(0.46, 0.52, 0.26, 3, 0.08), C.pack, 0, 0.72, -0.3);
  add(body, new RoundedBoxGeometry(0.3, 0.18, 0.06, 2, 0.03), '#c98d2c', 0, 0.62, -0.44);
  const roll = add(body, new THREE.CylinderGeometry(0.1, 0.1, 0.52, 14), C.mat, 0, 1.02, -0.3);
  roll.rotation.z = Math.PI / 2;
  // лямки
  for (const s of [-1, 1]) add(body, new THREE.BoxGeometry(0.06, 0.4, 0.03), '#6b4a2a', s * 0.15, 0.72, 0.23);

  return { root, body, head, armL, armR, legL, legR, meshes: shadowy };
}
