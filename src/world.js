// Природа острова: пальмы, деревья, ёлки, камни, трава и цветы (модели Kenney), кусты с ягодами,
// флаг на вершине. Тропа маршрута остаётся свободной. Плюс столкновения со стволами и камнями.
import * as THREE from 'three';
import { HALF } from './terrain.js';
import { makeRng } from './noise.js';
import { instance } from './models.js';

export class World {
  constructor(scene, terrain, models, course, seed, gfx) {
    this.scene = scene; this.t = terrain; this.M = models; this.course = course;
    this.rng = makeRng(seed + 99);
    this.grid = new Map();
    this.bushes = [];
    // где ничего не сажать: точки маршрута, препятствия, лагеря
    this.keep = [];
    for (const step of course.route) if (step.to) this.keep.push([step.to, 3.2]);
    for (const b of course.crossings) { this.keep.push([b.B, 4.5]); this.keep.push([b.T, 3.5]); }
    for (const box of course.boxes) this.keep.push([box.c, 3.0]);
    for (const c of course.campSpots) this.keep.push([c, 6.5]);
    this.keep.push([course.start, 6]);
    this.plant(gfx);
    this.addSummit();
  }

  free(x, z) {
    for (const [p, r] of this.keep) if (Math.abs(p.x - x) < r && Math.abs(p.z - z) < r && Math.hypot(p.x - x, p.z - z) < r) return false;
    return true;
  }

  spots(count, tries, ok, s0, s1, around) {
    const out = [];
    for (let k = 0; k < tries && out.length < count; k++) {
      let x, z;
      if (around) { const a = this.rng() * Math.PI * 2, r = this.rng() * around.r; x = around.p.x + Math.cos(a) * r; z = around.p.z + Math.sin(a) * r; }
      else { x = (this.rng() * 2 - 1) * HALF * 0.9; z = (this.rng() * 2 - 1) * HALF * 0.9; }
      const y = this.t.heightAt(x, z);
      if (!ok(x, y, z) || !this.free(x, z)) continue;
      out.push({ x, y: y - 0.05, z, s: s0 + this.rng() * (s1 - s0), r: this.rng() * Math.PI * 2 });
    }
    return out;
  }

  flat(x, z, k = 0.88) { return this.t.normalAt(x, z).y > k; }

  plant(gfx) {
    const M = this.M, S = this.scene;
    const split = (list, n) => Array.from({ length: n }, (_, i) => list.filter((_, j) => j % n === i));
    const palms = this.spots(140, 30000, (x, y, z) => y > 1.9 && y < 9 && this.flat(x, z), 5, 7.5);
    const [p1, p2] = split(palms, 2);
    instance(S, M.tree_palmDetailedTall, p1); instance(S, M.tree_palmTall, p2);
    const leafy = this.spots(260, 30000, (x, y, z) => y > 6 && y < 55 && this.flat(x, z), 4, 6.5);
    const [l1, l2, l3] = split(leafy, 3);
    instance(S, M.tree_oak, l1); instance(S, M.tree_default, l2); instance(S, M.tree_fat, l3);
    const pines = this.spots(220, 30000, (x, y, z) => y > 45 && y < 106 && this.flat(x, z), 4, 6.5);
    const [n1, n2] = split(pines, 2);
    instance(S, M.tree_pineRoundA, n1); instance(S, M.tree_pineTallA_detailed, n2);
    for (const p of [...palms, ...leafy, ...pines]) this.addCollider(p.x, p.z, 0.32 * p.s / 5);
    const rocks = this.spots(150, 20000, (x, y, z) => y > 1.5 && this.flat(x, z, 0.8), 2.5, 6);
    const [r1, r2, r3] = split(rocks, 3);
    instance(S, M.rock_largeA, r1); instance(S, M.rock_largeC, r2); instance(S, M.rock_tallA, r3);
    for (const p of rocks) this.addCollider(p.x, p.z, 0.38 * p.s);
    // трава и цветы — их количество зависит от качества графики (im.count)
    const grassOk = (x, y, z) => y > 3 && y < 100 && this.flat(x, z, 0.82);
    const small = [];
    small.push(...instance(S, M.grass, this.spots(2400, 40000, grassOk, 1.4, 2.2), { shadow: false }));
    small.push(...instance(S, M.grass_large, this.spots(700, 20000, grassOk, 1.3, 2.0), { shadow: false }));
    small.push(...instance(S, M.flower_yellowA, this.spots(260, 12000, grassOk, 1.4, 1.9), { shadow: false }));
    small.push(...instance(S, M.flower_redA, this.spots(200, 12000, grassOk, 1.4, 1.9), { shadow: false }));
    small.push(...instance(S, M.flower_purpleA, this.spots(200, 12000, grassOk, 1.4, 1.9), { shadow: false }));
    small.push(...instance(S, M.rock_smallA, this.spots(200, 8000, grassOk, 1.6, 2.6), { shadow: false }));
    for (const im of small) { im.userData.total = im.count; gfx.grass.push(im); }
    this.addBushes();
  }

  // кусты с ягодами: съел — силы полные, немного здоровья
  addBushes() {
    const berryGeo = new THREE.SphereGeometry(0.1, 6, 4);
    const berryMat = new THREE.MeshLambertMaterial({ color: '#e0283f', emissive: '#5a0010', emissiveIntensity: 0.4 });
    const list = this.spots(40, 12000, (x, y, z) => y > 5 && y < 135 && this.flat(x, z, 0.85), 2.4, 3.0);
    // ягоды — у тропы: на уступах, где идёт маршрут
    for (const b of this.course.crossings) {
      const p = b.T.clone().addScaledVector(this.course.side(b.theta), 3.5);
      p.y = this.t.heightAt(p.x, p.z);
      if (this.flat(p.x, p.z, 0.85) && Math.abs(p.y - b.ht) < 1.2) list.push({ x: p.x, y: p.y, z: p.z, s: 2.8, r: 0 });
    }
    instance(this.scene, this.M.plant_bush, list);
    for (const p of list) {
      const berries = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const be = new THREE.Mesh(berryGeo, berryMat);
        const a = (i / 7) * Math.PI * 2 + this.rng();
        be.position.set(Math.cos(a) * 0.45 * p.s / 2.8, (0.35 + this.rng() * 0.35) * p.s / 2.8, Math.sin(a) * 0.45 * p.s / 2.8);
        berries.add(be);
      }
      berries.position.set(p.x, p.y, p.z);
      this.scene.add(berries);
      this.bushes.push({ x: p.x, y: p.y, z: p.z, berries, taken: false });
    }
  }

  addSummit() {
    const s = this.t.summit;
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.2, 8), new THREE.MeshLambertMaterial({ color: '#e8e8e8' }));
    pole.position.y = 2.1;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1, 8, 1), new THREE.MeshLambertMaterial({ color: '#ff7a3d', side: THREE.DoubleSide, emissive: '#7a2a00', emissiveIntensity: 0.3 }));
    cloth.geometry.translate(0.9, 0, 0);
    cloth.position.set(0, 3.55, 0);
    g.add(pole, cloth);
    const cairn = this.M.rock_tallA.clone();
    cairn.scale.setScalar(1.6);
    g.add(cairn);
    g.position.copy(s);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(g);
    this.flag = cloth;
    this.addCollider(s.x, s.z, 0.6);
  }

  addCollider(x, z, r) {
    const key = `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key).push({ x, z, r });
  }

  pushOut(p, r) {
    const gx = Math.floor(p.x / 8), gz = Math.floor(p.z / 8);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = this.grid.get(`${gx + a},${gz + b}`);
      if (!list) continue;
      for (const c of list) {
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
        if (d < min && d > 1e-4) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; }
      }
    }
  }

  update(time) {
    if (this.flag) {
      const a = this.flag.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) {
        const x = a.getX(i);
        a.setZ(i, Math.sin(time * 4 + x * 3) * 0.12 * x);
      }
      a.needsUpdate = true;
    }
  }
}
