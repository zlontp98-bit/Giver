// Всё, что стоит на острове: море, деревья, камни, кусты с ягодами, лагеря, флаг на вершине.
import * as THREE from 'three';
import { HALF, CELL, WALKABLE_NY } from './terrain.js';
import { makeRng } from './noise.js';

export class World {
  constructor(scene, terrain, seed) {
    this.scene = scene;
    this.t = terrain;
    this.rng = makeRng(seed + 99);
    this.colliders = [];          // {x, z, r} — стволы и камни
    this.grid = new Map();        // быстрый поиск препятствий рядом
    this.bushes = [];             // {x, y, z, mesh, taken}
    this.camps = [];              // {x, y, z, index, reached}
    this.addSea();
    this.findStart();
    this.addCamps();
    this.addTrees();
    this.addRocks();
    this.addBushes();
    this.addSummit();
  }

  addSea() {
    const geo = new THREE.PlaneGeometry(2400, 2400);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: '#3f8fcf', transparent: true, opacity: 0.82 });
    const sea = new THREE.Mesh(geo, mat);
    sea.position.y = 0;
    this.scene.add(sea);
    this.sea = sea;
  }

  // Старт — на южном пляже.
  findStart() {
    const t = this.t;
    let x = 0, z = HALF - 4;
    for (let s = HALF - 4; s > 0; s -= 0.5) {
      if (t.heightAt(0, s) > 1.2) { z = s - 2; break; }
    }
    this.start = new THREE.Vector3(x, t.heightAt(x, z), z);
    this.startAngle = Math.atan2(z - t.summit.z, x - t.summit.x);
  }

  // Лагеря (точки сохранения) на полках по дороге вверх, примерно с южной стороны.
  addCamps() {
    const t = this.t;
    const targets = [42, 84, 120];
    const tent = makeTent();
    targets.forEach((H, index) => {
      let best = null, bestScore = 1e9;
      for (let k = 0; k < 30000; k++) {
        const x = (this.rng() * 2 - 1) * HALF * 0.8, z = (this.rng() * 2 - 1) * HALF * 0.8;
        const y = t.heightAt(x, z);
        if (Math.abs(y - H) > 7) continue;
        if (!flatAround(t, x, z, 2.5)) continue;
        let da = Math.atan2(z - t.summit.z, x - t.summit.x) - this.startAngle;
        da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
        const score = da * 40 + Math.abs(y - H);
        if (score < bestScore) { bestScore = score; best = { x, z, y }; }
      }
      if (!best) return;
      const g = tent.clone();
      g.position.set(best.x, best.y, best.z);
      g.rotation.y = Math.atan2(best.x - t.summit.x, best.z - t.summit.z);
      this.scene.add(g);
      this.camps.push({ ...best, index, reached: false, mesh: g });
      this.addCollider(best.x, best.z, 1.1);
    });
  }

  addTrees() {
    const t = this.t;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1.6, 6);
    trunkGeo.translate(0, 0.8, 0);
    const leafGeo = mergeCones();
    const trunkMat = new THREE.MeshLambertMaterial({ color: '#6b4a2f', flatShading: true });
    const leafMat = new THREE.MeshLambertMaterial({ color: '#2f6b35', flatShading: true });
    const spots = [];
    for (let k = 0; k < 6000 && spots.length < 520; k++) {
      const x = (this.rng() * 2 - 1) * HALF * 0.85, z = (this.rng() * 2 - 1) * HALF * 0.85;
      const y = t.heightAt(x, z);
      if (y < 2.6 || y > 95) continue;
      if (this.rng() < y / 110) continue;                 // выше — реже
      if (t.normalAt(x, z).y < 0.88) continue;
      if (Math.hypot(x - this.start.x, z - this.start.z) < 7) continue;
      if (this.camps.some((c) => Math.hypot(c.x - x, c.z - z) < 5)) continue;
      spots.push({ x, y, z, s: 0.75 + this.rng() * 0.7 });
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const tint = new THREE.Color();
    spots.forEach((s, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rng() * Math.PI * 2);
      sc.set(s.s, s.s * (0.9 + this.rng() * 0.35), s.s);
      p.set(s.x, s.y - 0.1, s.z);
      m.compose(p, q, sc);
      trunks.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
      tint.setHSL(0.3 + this.rng() * 0.06, 0.45, 0.26 + this.rng() * 0.1);
      leaves.setColorAt(i, tint);
      this.addCollider(s.x, s.z, 0.35 * s.s);
    });
    this.scene.add(trunks, leaves);
  }

  addRocks() {
    const t = this.t;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: '#8a847c', flatShading: true });
    const spots = [];
    for (let k = 0; k < 5000 && spots.length < 170; k++) {
      const x = (this.rng() * 2 - 1) * HALF * 0.8, z = (this.rng() * 2 - 1) * HALF * 0.8;
      const y = t.heightAt(x, z);
      if (y < 1.5) continue;
      if (t.normalAt(x, z).y < 0.8) continue;
      if (Math.hypot(x - this.start.x, z - this.start.z) < 6) continue;
      if (this.camps.some((c) => Math.hypot(c.x - x, c.z - z) < 4)) continue;
      spots.push({ x, y, z, s: 0.4 + this.rng() * 1.1 });
    }
    const rocks = new THREE.InstancedMesh(geo, mat, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    spots.forEach((s, i) => {
      e.set(this.rng() * 3, this.rng() * 3, this.rng() * 3);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(s.x, s.y + s.s * 0.2, s.z), q, new THREE.Vector3(s.s * 1.2, s.s * 0.8, s.s));
      rocks.setMatrixAt(i, m);
      if (s.s > 0.6) this.addCollider(s.x, s.z, s.s * 0.9);
    });
    this.scene.add(rocks);
  }

  // Кусты с ягодами: съел — вернулись силы и немного здоровья.
  addBushes() {
    const t = this.t;
    const bushGeo = new THREE.IcosahedronGeometry(0.55, 0);
    const bushMat = new THREE.MeshLambertMaterial({ color: '#3c7a3a', flatShading: true });
    const berryGeo = new THREE.SphereGeometry(0.11, 6, 4);
    const berryMat = new THREE.MeshLambertMaterial({ color: '#d0263c' });
    let placed = 0;
    for (let k = 0; k < 8000 && placed < 46; k++) {
      const x = (this.rng() * 2 - 1) * HALF * 0.75, z = (this.rng() * 2 - 1) * HALF * 0.75;
      const y = t.heightAt(x, z);
      if (y < 6 || y > 135) continue;
      if (t.normalAt(x, z).y < 0.85) continue;
      // больше кустов на высоте, где без них тяжело
      if (this.rng() > 0.25 + y / 160) continue;
      const g = new THREE.Group();
      const b = new THREE.Mesh(bushGeo, bushMat);
      b.scale.set(1, 0.75, 1);
      b.position.y = 0.35;
      g.add(b);
      const berries = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const be = new THREE.Mesh(berryGeo, berryMat);
        const a = (i / 7) * Math.PI * 2 + this.rng();
        be.position.set(Math.cos(a) * 0.45, 0.25 + this.rng() * 0.35, Math.sin(a) * 0.45);
        berries.add(be);
      }
      g.add(berries);
      g.position.set(x, y, z);
      this.scene.add(g);
      this.bushes.push({ x, y, z, berries, taken: false });
      placed++;
    }
  }

  addSummit() {
    const s = this.t.summit;
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), new THREE.MeshLambertMaterial({ color: '#dddddd' }));
    pole.position.y = 2;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshLambertMaterial({ color: '#ff7a3d', side: THREE.DoubleSide }));
    cloth.position.set(0.8, 3.4, 0);
    g.add(pole, cloth);
    // каменная пирамидка-тур
    const cairn = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 0), new THREE.MeshLambertMaterial({ color: '#77736d', flatShading: true }));
    cairn.position.y = 0.3;
    g.add(cairn);
    g.position.copy(s);
    this.scene.add(g);
    this.flag = cloth;
  }

  addCollider(x, z, r) {
    const c = { x, z, r };
    this.colliders.push(c);
    const key = `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key).push(c);
  }

  // Отталкивание от стволов и камней (герой — круг радиусом r).
  pushOut(p, r) {
    const gx = Math.floor(p.x / 8), gz = Math.floor(p.z / 8);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const list = this.grid.get(`${gx + a},${gz + b}`);
        if (!list) continue;
        for (const c of list) {
          const dx = p.x - c.x, dz = p.z - c.z;
          const d = Math.hypot(dx, dz), min = c.r + r;
          if (d < min && d > 1e-4) {
            p.x = c.x + (dx / d) * min;
            p.z = c.z + (dz / d) * min;
          }
        }
      }
    }
  }

  update(time) {
    if (this.flag) this.flag.rotation.y = Math.sin(time * 2.2) * 0.25;
  }
}

function flatAround(t, x, z, r) {
  for (let a = 0; a < 8; a++) {
    const px = x + Math.cos((a / 8) * Math.PI * 2) * r;
    const pz = z + Math.sin((a / 8) * Math.PI * 2) * r;
    if (t.normalAt(px, pz).y < 0.82) return false;
  }
  return t.normalAt(x, z).y > 0.86;
}

function mergeCones() {
  // два конуса ёлки одной геометрией
  const a = new THREE.ConeGeometry(1.25, 2.4, 7);
  a.translate(0, 2.4, 0);
  const b = new THREE.ConeGeometry(0.9, 1.9, 7);
  b.translate(0, 3.5, 0);
  const pos = [...a.toNonIndexed().attributes.position.array, ...b.toNonIndexed().attributes.position.array];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function makeTent() {
  const g = new THREE.Group();
  const tent = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.7, 4), new THREE.MeshLambertMaterial({ color: '#e3a03a', flatShading: true }));
  tent.position.y = 0.85;
  tent.rotation.y = Math.PI / 4;
  g.add(tent);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 5), new THREE.MeshLambertMaterial({ color: '#cccccc' }));
  pole.position.set(1.8, 1.3, 0.6);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshLambertMaterial({ color: '#3fa0e0', side: THREE.DoubleSide }));
  flag.position.set(2.15, 2.35, 0.6);
  g.add(pole, flag);
  return g;
}

export { WALKABLE_NY, CELL };
