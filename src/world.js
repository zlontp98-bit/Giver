// Убранство Бездны по ярусам: лес на плато, трава и цветы на верхних уступах, корни и лианы ниже,
// светящиеся кристаллы в гротах, на дне — светящееся озерцо и огромный кристалл (цель).
// Плюс кусты с ягодами (силы) и столкновения со стволами и камнями.
import * as THREE from 'three';
import { makeRng } from './noise.js';
import { instance } from './models.js';
import { RIM_Y, BOTTOM_Y, R_OUT, LAYERS, layerAt, normA } from './abyss.js';

export class World {
  constructor(scene, abyss, descent, models, seed, gfx) {
    this.scene = scene; this.A = abyss; this.D = descent; this.M = models;
    this.rng = makeRng(seed + 99);
    this.grid = new Map();
    this.bushes = [];
    this.keep = [];
    for (const s of descent.route) if (s.to) this.keep.push([s.to, 2.4]);
    for (const b of descent.boxes) this.keep.push([b.c, 2.5]);
    for (const c of descent.camps) this.keep.push([c.pos, 4.5]);
    this.keep.push([descent.start, 5]);
    if (descent.baseFire) this.keep.push([descent.baseFire, 7]);
    for (const a of descent.anchors) this.keep.push([a.pos.clone().setY(a.pos.y - 1.6), 2.5]);
    this.plateau(gfx);
    this.ledges(gfx);
    this.roots();
    this.wallDecor(gfx);
    this.crystals();
    this.bottom();
  }

  free(x, z, y) {
    for (const [p, r] of this.keep) if (Math.abs(p.y - y) < 3 && Math.hypot(p.x - x, p.z - z) < r) return false;
    return true;
  }

  // ——— плато вокруг устья ———
  plateau(gfx) {
    const A = this.A, M = this.M, S = this.scene, rng = this.rng;
    const pts = (count, rMin, rMax, s0, s1) => {
      const out = [];
      for (let k = 0; k < count * 6 && out.length < count; k++) {
        const th = rng() * Math.PI * 2, rw = A.wallR(th, RIM_Y), r = rw + rMin + rng() * (rMax - rMin);
        const x = Math.sin(th) * r, z = Math.cos(th) * r, y = RIM_Y + A.plateauBump(x, z, r);
        if (!this.free(x, z, y)) continue;
        out.push({ x, y: y - 0.05, z, s: s0 + rng() * (s1 - s0), r: rng() * 6.28 });
      }
      return out;
    };
    const trees = pts(170, 7, R_OUT - A.wallR(0, 0) - 5, 4.5, 7);
    const split = (l, n) => Array.from({ length: n }, (_, i) => l.filter((_, j) => j % n === i));
    const [t1, t2, t3, t4] = split(trees, 4);
    instance(S, M.tree_oak, t1); instance(S, M.tree_default, t2); instance(S, M.tree_pineRoundA, t3); instance(S, M.tree_fat, t4);
    for (const p of trees) this.addCollider(p.x, p.z, 0.3 * p.s / 5, p.y);
    const rocks = pts(50, 3, 60, 2.5, 5);
    instance(S, M.rock_largeA, rocks);
    for (const p of rocks) this.addCollider(p.x, p.z, 0.35 * p.s, p.y);
    const small = [];
    small.push(...instance(S, M.grass, pts(900, 1.5, 70, 1.6, 2.4), { shadow: false }));
    small.push(...instance(S, M.flower_yellowA, pts(150, 1.5, 60, 1.5, 2), { shadow: false }));
    small.push(...instance(S, M.flower_redA, pts(120, 1.5, 60, 1.5, 2), { shadow: false }));
    for (const im of small) { im.userData.total = im.count; gfx.grass.push(im); }
  }

  // ——— уступы: трава, цветы, папоротники, грибы, кусты с ягодами, мох и лианы ———
  ledges(gfx) {
    const A = this.A, M = this.M, S = this.scene, rng = this.rng;
    // что растёт на каждом ярусе: [модель, доля, размер от, до, «мелочь» (зависит от качества)]
    const FLORA = [
      [['grass', 0.55, 1.4, 2.2, true], ['flower_yellowA', 0.12, 1.4, 2, true], ['flower_purpleA', 0.1, 1.4, 2, true], ['plant_bushLarge', 0.06, 2, 3],
        ['mushroom_redGroup', 0.05, 3, 5], ['rock_largeC', 0.07, 1.5, 3]],
      [['grass', 0.35, 1.5, 2.3, true], ['grass_leafsLarge', 0.25, 2.5, 4, true], ['plant_bushLarge', 0.08, 2, 3.2], ['mushroom_tanGroup', 0.12, 3, 6],
        ['mushroom_redGroup', 0.08, 3, 5], ['rock_largeC', 0.07, 1.5, 3]],
      [['grass', 0.25, 1.4, 2.2, true], ['mushroom_tanTall', 0.25, 4, 8], ['mushroom_tanGroup', 0.18, 3, 6], ['rock_largeC', 0.17, 1.5, 3.2], ['grass_leafsLarge', 0.1, 2, 3, true]],
      [['grass_leafsLarge', 0.2, 2, 3, true], ['mushroom_tanTall', 0.3, 5, 9], ['mushroom_redGroup', 0.15, 3, 6], ['rock_largeC', 0.25, 1.5, 3.5]],
    ];
    const lists = new Map(), moss = [], vines = [], trees = [], bushes = [];
    const add = (name, p, small) => { if (!lists.has(name)) lists.set(name, { small, list: [] }); lists.get(name).list.push(p); };
    for (const L of A.ledges) {
      const k = layerAt(L.y), flora = FLORA[k];
      const n = Math.round(L.span * A.wallR(L.th1, L.y) * 3.2);
      for (let i = 0; i < n; i++) {
        const u = 0.05 + rng() * 0.9, th = normA(L.th1 + u * L.span), f = 0.08 + rng() * 0.85;
        const r = A.wallR(th, L.y) - A.ledgeDepth(L, u) * f;
        const x = Math.sin(th) * r, z = Math.cos(th) * r;
        if (!this.free(x, z, L.y)) continue;
        let roll = rng();
        for (const [name, share, s0, s1, small] of flora) {
          if ((roll -= share) > 0) continue;
          add(name, { x, y: L.y - 0.05, z, s: s0 + rng() * (s1 - s0), r: rng() * 6.28 }, !!small);
          break;
        }
        if (k === 0 && f < 0.25 && rng() < 0.05) trees.push({ x, y: L.y - 0.05, z, s: 3.5 + rng() * 1.5, r: rng() * 6.28 });
      }
      // куст с ягодами в середине уступа
      if (rng() < 0.55) {
        const th = normA(L.th1 + L.span * (0.3 + rng() * 0.4)), r = A.wallR(th, L.y) - A.ledgeDepth(L, 0.5) * 0.2;
        bushes.push({ x: Math.sin(th) * r, y: L.y, z: Math.cos(th) * r, s: 2.6, r: 0 });
      }
      // мох свисает с края уступа, лианы — с низа (верхние ярусы)
      for (let i = 0; i < 9; i++) {
        const u = 0.08 + rng() * 0.84, th = normA(L.th1 + u * L.span), sc = 3.5 + rng() * 3;
        const r = A.ledgeInner(L, th, u) - 0.12 - 0.48 * sc;
        moss.push({ x: Math.sin(th) * r, y: L.y - 0.478 * sc + 0.05, z: Math.cos(th) * r, s: sc, r: th });
      }
      if (k <= 1) for (let i = 0; i < 10; i++) {
        const u = rng(), th = normA(L.th1 + u * L.span), r = A.ledgeInner(L, th, u) + 0.3 + rng() * 1.2;
        vines.push({ x: Math.sin(th) * r, y: L.y - L.thick * 0.6, z: Math.cos(th) * r, len: 2 + rng() * 5 });
      }
    }
    for (const [name, { small, list }] of lists) {
      const made = instance(S, M[name], list, { shadow: !small });
      if (small) for (const im of made) { im.userData.total = im.count; gfx.grass.push(im); }
    }
    instance(S, M.hanging_moss, moss, { shadow: false });
    instance(S, M.tree_pineTallA_detailed, trees);
    for (const p of trees) this.addCollider(p.x, p.z, 0.25, p.y);
    this.addBushes(bushes);
    // лианы — одна геометрия на все
    if (vines.length) {
      const g = new THREE.CylinderGeometry(0.05, 0.03, 1, 4);
      g.translate(0, -0.5, 0);
      const im = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: '#3f7a35' }), vines.length);
      const m = new THREE.Matrix4();
      vines.forEach((v, i) => { m.makeScale(1, v.len, 1).setPosition(v.x, v.y, v.z); im.setMatrixAt(i, m); });
      S.add(im);
    }
  }

  addBushes(list) {
    if (!list.length) return;
    instance(this.scene, this.M.plant_bush, list);
    const geo = new THREE.SphereGeometry(0.1, 6, 4);
    const mat = new THREE.MeshLambertMaterial({ color: '#e0283f', emissive: '#7a0018', emissiveIntensity: 0.6 });
    for (const p of list) {
      const g = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const be = new THREE.Mesh(geo, mat), a = (i / 7) * Math.PI * 2 + this.rng();
        be.position.set(Math.cos(a) * 0.42, 0.35 + this.rng() * 0.35, Math.sin(a) * 0.42);
        g.add(be);
      }
      g.position.set(p.x, p.y, p.z);
      this.scene.add(g);
      this.bushes.push({ x: p.x, y: p.y, z: p.z, berries: g, taken: false });
    }
  }

  // ——— на стенах: выступающие камни, пучки травы и мох (чтобы стена при лазании не была голой) ———
  wallDecor(gfx) {
    const A = this.A, M = this.M, S = this.scene, rng = this.rng;
    const rocks = [], tufts = [], moss = [];
    const up = new THREE.Vector3(0, 1, 0), inward = new THREE.Vector3(), axis = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    // поворот: «верх» модели смотрит внутрь шахты (и чуть вверх — tilt), плюс разворот вокруг этой оси
    const orient = (th, tilt, spin) => {
      inward.set(-Math.sin(th), Math.tan(tilt), -Math.cos(th)).normalize();
      qa.setFromUnitVectors(up, inward);
      qb.setFromAxisAngle(axis.copy(up), spin);
      return qa.clone().multiply(qb);
    };
    const onLedge = (th, y) => A.ledges.some((L) => y < L.y + 1 && y > L.y - L.thick - 2.5 && A.ledgeU(L, th) >= 0);
    // где лазают по маршруту — погуще
    const spots = this.D.links.filter((l) => l.type === 'climb').map((l) => [l.theta, l.from.y, l.to.y]);
    // сначала места у маршрута: на «Низкой» рисуется только начало списков (см. gfx.grass)
    const nSpot = spots.length * 40;
    for (let i = 0; i < nSpot + 1500; i++) {
      let th = rng() * Math.PI * 2, y = -2 - rng() * 226;
      if (i < nSpot) {           // по бокам от линии, где лезет герой (не на ней — камни ведь «ненастоящие»)
        const [t0, y0, y1] = spots[i % spots.length];
        th = t0 + (rng() < 0.5 ? -1 : 1) * (0.06 + rng() * 0.14); y = y1 + rng() * (y0 - y1 + 2);
      }
      if (onLedge(th, y)) continue;
      const r = A.wallR(th, y), k = layerAt(y), roll = rng();
      const at = (d) => ({ x: Math.sin(th) * (r - d), y, z: Math.cos(th) * (r - d) });
      if (roll < 0.3) rocks.push({ ...at(0.15), s: 1.0 + rng() * 1.6, q: orient(th, 0.2 + rng() * 0.6, rng() * 6.28) });
      else if (roll < 0.7 && k <= 1) tufts.push({ ...at(0.05), s: 1.6 + rng() * 1.2, q: orient(th, 0.7 + rng() * 0.4, rng() * 6.28) });
      else if (roll < 0.85 && k <= 2) { const sc = 3 + rng() * 3; moss.push({ ...at(0.12 + 0.48 * sc), y: y - 0.478 * sc, s: sc, r: th }); }
    }
    // сколько рисовать — зависит от качества (как трава)
    for (const im of [...instance(S, M.rock_largeC, rocks, { shadow: false }), ...instance(S, M.grass, tufts, { shadow: false })]) { im.userData.total = im.count; gfx.grass.push(im); }
    instance(S, M.hanging_moss, moss, { shadow: false });
  }

  // ——— огромные корни по стенам корневого яруса ———
  roots() {
    const A = this.A, rng = this.rng, mat = new THREE.MeshLambertMaterial({ color: '#5a3d27' });
    for (let i = 0; i < 14; i++) {
      const th0 = rng() * Math.PI * 2, y0 = LAYERS[1].top - 5 - rng() * 50, pts = [];
      for (let k = 0; k <= 6; k++) {
        const th = th0 + k * 0.05 * (rng() < 0.5 ? 1 : 1.3), y = y0 - k * (2 + rng() * 3);
        pts.push(new THREE.Vector3(Math.sin(th), 0, Math.cos(th)).multiplyScalar(A.wallR(th, y) - 0.3).setY(y));
      }
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.35 + rng() * 0.45, 6, false);
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      this.scene.add(m);
    }
  }

  // ——— светящиеся кристаллы в гротах и на дне ———
  crystals() {
    const A = this.A, rng = this.rng;
    const g = crystalGeometry();
    const list = [];
    for (const L of A.ledges) {
      const k = layerAt(L.y);
      if (k < 2) continue;
      for (let i = 0; i < 9; i++) {
        const u = 0.05 + rng() * 0.9, th = normA(L.th1 + u * L.span), f = 0.05 + rng() * 0.3;
        const r = A.wallR(th, L.y) - A.ledgeDepth(L, u) * f;
        const x = Math.sin(th) * r, z = Math.cos(th) * r;
        if (!this.free(x, z, L.y)) continue;
        list.push({ x, y: L.y - 0.1, z, s: 0.6 + rng() * 1.2, k });
      }
    }
    // на дне
    for (let i = 0; i < 46; i++) {
      const th = rng() * Math.PI * 2, r = 9 + rng() * (A.wallR(th, BOTTOM_Y) - 12);
      const x = Math.sin(th) * r, z = Math.cos(th) * r;
      list.push({ x, y: BOTTOM_Y + A.floorBump(x, z, r) - 0.15, z, s: 0.5 + rng() * 1.6, k: 3 });
    }
    // на стенах глубже 120 м
    for (let i = 0; i < 70; i++) {
      const th = rng() * Math.PI * 2, y = -120 - rng() * 105;
      const r = A.wallR(th, y) - 0.2;
      list.push({ x: Math.sin(th) * r, y, z: Math.cos(th) * r, s: 0.5 + rng() * 1.4, k: layerAt(y), wall: th });
    }
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.6 });
    // свечение того же цвета, что и сам кристалл (цвет у каждого свой)
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor;\n#endif');
    };
    const im = new THREE.InstancedMesh(g, mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
    list.forEach((p, i) => {
      if (p.wall !== undefined) e.set(Math.PI / 2 * 0.8, p.wall + Math.PI, (rng() - 0.5) * 0.8);   // торчат из стены внутрь
      else e.set((rng() - 0.5) * 0.5, rng() * 6, (rng() - 0.5) * 0.5);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s * (1.2 + rng()), p.s));
      im.setMatrixAt(i, m);
      c.set(p.k >= 3 ? (rng() < 0.5 ? '#c77dff' : '#8f6bff') : (rng() < 0.6 ? '#5fe0ff' : '#7affd9'));
      im.setColorAt(i, c);
    });
    im.castShadow = false;
    this.scene.add(im);
  }

  // ——— дно: светящееся озерцо и огромный кристалл — цель спуска ———
  bottom() {
    const S = this.scene, y = BOTTOM_Y;
    const pond = new THREE.Mesh(new THREE.CircleGeometry(11, 40), new THREE.MeshLambertMaterial({ color: '#2b6f8a', emissive: '#1fa7c9', emissiveIntensity: 0.55, transparent: true, opacity: 0.85 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(0, y - 0.25, 0);
    S.add(pond);
    const g = crystalGeometry();
    const mat = new THREE.MeshLambertMaterial({ color: '#e7c8ff', emissive: '#b86bff', emissiveIntensity: 1.0 });
    const big = new THREE.Group();
    const parts = [[0, 0, 0, 2.2, 6.5, 0], [1.6, 0, 0.6, 1.1, 3.6, 0.35], [-1.4, 0, 0.9, 1.0, 3.0, -0.4], [0.4, 0, -1.6, 1.2, 3.8, 0.25], [-0.9, 0, -1.2, 0.8, 2.4, -0.3]];
    for (const [x, , z, s, h, tilt] of parts) {
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, 0, z);
      m.scale.set(s, h, s);
      m.rotation.set(tilt, 0, -tilt);
      big.add(m);
    }
    big.position.set(0, y - 0.3, 0);
    S.add(big);
    this.goal = big;
    this.goalPos = new THREE.Vector3(0, y + 6, 0);
    this.addCollider(0, 0, 2.6, y);
  }

  addCollider(x, z, r, y) {
    const key = `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key).push({ x, z, r, y });
  }

  pushOut(p, r) {
    // стволы и камни: на плато, на полках и кристалл на дне (только на своей высоте)
    const gx = Math.floor(p.x / 8), gz = Math.floor(p.z / 8);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = this.grid.get(`${gx + a},${gz + b}`);
      if (!list) continue;
      for (const c of list) {
        if (p.y < c.y - 1.8 || p.y > c.y + 5) continue;
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
        if (d < min && d > 1e-4) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; }
      }
    }
  }

  update(time) {
    if (this.goal) this.goal.rotation.y = time * 0.15;
  }
}

// кристалл: шестигранная призма с острой верхушкой (основание на y = 0)
function crystalGeometry() {
  const body = new THREE.CylinderGeometry(0.3, 0.36, 1, 6, 1);
  body.translate(0, 0.5, 0);
  const tip = new THREE.ConeGeometry(0.3, 0.45, 6);
  tip.translate(0, 1.22, 0);
  const pos = [...body.toNonIndexed().attributes.position.array, ...tip.toNonIndexed().attributes.position.array];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
