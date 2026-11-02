// Маршрут вниз: полки по спирали и связки между ними —
//   climb    — спуститься по голой стене руками («Хват», тратит силы)
//   rappel   — кольцо на краю полки: «Крюк», и спускаешься по верёвке (джойстик вниз)
//   jumps    — прыжки вниз по парящим камням
//   zip      — трос через бездну на полку напротив
//   mushroom — прыгнуть вниз на огромный гриб: он смягчит падение
// Плюс мостки с плато к первой полке, лагеря, осколки (собирать), подсказки и шаги для бота.
import * as THREE from 'three';
import { makeRng } from './noise.js';
import { RIM_Y, BOTTOM_Y, LAYERS, layerAt, normA, PH, PR } from './abyss.js';
import { place } from './models.js';

const PATTERN = ['climb', 'rappel', 'jumps', 'climb', 'zip', 'mushroom', 'climb', 'rappel', 'jumps', 'zip',
  'climb', 'mushroom', 'rappel', 'climb', 'jumps', 'zip', 'climb', 'rappel', 'mushroom', 'jumps'];

export class Descent {
  constructor(abyss, seed) {
    this.A = abyss;
    this.rng = makeRng(seed + 31);
    this.boxes = []; this.movers = [];
    this.anchors = [];   // кольца: { kind: 'rappel'|'zip', pos, zip? }
    this.zips = [];      // тросы: { a, b, len, dir }
    this.shards = []; this.camps = []; this.hints = []; this.route = [];
    this.links = [];     // связки между полками (для постройки)
    this.plan();
  }

  at(theta, r, y) { return new THREE.Vector3(Math.sin(theta) * r, y, Math.cos(theta) * r); }
  midR(L, th) { const u = Math.max(0, this.A.ledgeU(L, th)); return this.A.wallR(th, L.y) - this.A.ledgeDepth(L, u) * 0.5; }
  onLedge(L, th, frac = 0.5) {
    const u = Math.max(0, this.A.ledgeU(L, th));
    return this.at(th, this.A.wallR(th, L.y) - this.A.ledgeDepth(L, u) * frac, L.y);
  }
  // глубина полки, чтобы на угле th её внутренний край был не дальше rIn от оси шахты
  depthFor(th, y, rIn) { return Math.max(5, (this.A.wallR(th, y) - rIn) / 0.8); }

  plan() {
    const A = this.A, rng = this.rng;
    const th0 = 0;
    this.start = this.at(th0, A.wallR(th0, RIM_Y) + 8, RIM_Y);
    // первая полка — под мостками у края
    let L = A.addLedge({ y: -10, th1: th0 + 0.02, span: 0.8, depth: 6, thick: 3 });
    this.links.push({ type: 'stairs', to: L, theta: th0 });
    for (let k = 0; k < 60; k++) {
      const type = PATTERN[k % PATTERN.length];
      const end = normA(L.th1 + L.span);
      let next;
      if (type === 'climb') {
        const dy = 9 + rng() * 4, th = end + 0.05;
        next = A.addLedge({ y: L.y - dy, th1: th - 0.14, span: 0.6 + rng() * 0.3, depth: 5 + rng() * 1.5, thick: 2.5 + rng() });
        this.links.push({ type, from: L, to: next, theta: th });
      } else if (type === 'rappel') {
        // кольцо над краем полки; полка внизу должна выступать дальше — чтобы приземлиться на неё
        const dy = 14 + rng() * 7, th = end - 0.08, y = L.y - dy;
        const rRing = A.ledgeInner(L, th, A.ledgeU(L, th)) - 0.35;
        next = A.addLedge({ y, th1: th - 0.18, span: 0.65 + rng() * 0.3, depth: this.depthFor(th, y, rRing - 3), thick: 3 + rng() });
        this.links.push({ type, from: L, to: next, theta: th });
      } else if (type === 'jumps') {
        // парящие камни: каждый на 1.5–2 м ниже и на ~3 м дальше вдоль стены
        const steps = 5, plats = [];
        let th = end - 0.015, y = L.y;
        for (let i = 0; i < steps; i++) {
          th += 0.066; y -= 1.5 + rng() * 0.5;
          plats.push({ th, y, r: A.wallR(th, y) - 2.7 - Math.sin(i * 1.3) * 0.6 });
        }
        next = A.addLedge({ y: y - 1.5, th1: th - 0.03, span: 0.6 + rng() * 0.3, depth: 5.5 + rng() * 1.5, thick: 2.5 + rng() });
        this.links.push({ type, from: L, to: next, plats });
      } else if (type === 'zip') {
        const dy = 18 + rng() * 6, thA = end - 0.07, thB = normA(thA + Math.PI * (0.62 + rng() * 0.15));
        next = A.addLedge({ y: L.y - dy, th1: thB - 0.06, span: 0.65 + rng() * 0.3, depth: 6 + rng(), thick: 3 });
        this.links.push({ type, from: L, to: next, thA, thB });
      } else {   // mushroom
        const dy = 11 + rng() * 4, th = end - 0.1, y = L.y - dy;
        const rPad = A.ledgeInner(L, th, A.ledgeU(L, th)) - 1.7;
        next = A.addLedge({ y, th1: th - 0.24, span: 0.6 + rng() * 0.3, depth: this.depthFor(th, y, rPad - 3.2), thick: 3 });
        this.links.push({ type, from: L, to: next, theta: th, rPad });
      }
      L = next;
      if (L.y < BOTTOM_Y + 30) break;
    }
    // с последней полки — на дно по верёвке
    this.links.push({ type: 'rappel', from: L, to: null, theta: normA(L.th1 + L.span * 0.85) });
  }

  // ——— постройка ———
  build(scene, models) {
    this.scene = scene; this.M = models;
    this.matWood = new THREE.MeshLambertMaterial({ color: '#a8754a' });
    this.matWoodDark = new THREE.MeshLambertMaterial({ color: '#6e4529' });
    this.matMetal = new THREE.MeshLambertMaterial({ color: '#59606a' });
    this.matRing = new THREE.MeshLambertMaterial({ color: '#d9dde3', emissive: '#ff8a3a', emissiveIntensity: 0 });
    this.matCable = new THREE.MeshLambertMaterial({ color: '#3a3330' });
    this.shardGeo = new THREE.OctahedronGeometry(0.32, 0);
    this.shardGeo.scale(0.7, 1.3, 0.7);
    this.matShard = new THREE.MeshLambertMaterial({ color: '#8ff3ff', emissive: '#3fd0ff', emissiveIntensity: 1.1 });

    let pos = this.start.clone();
    this.route.push({ type: 'walk', to: pos.clone() });
    for (const link of this.links) pos = this['make_' + link.type](link, pos);
    this.goal = new THREE.Vector3(0, BOTTOM_Y, 0);
    this.route.push({ type: 'walk', to: this.goal.clone().setY(BOTTOM_Y) });
    // лагерь у края — отсюда начинается спуск (костёр для красоты, сохранение — сам старт)
    {
      const th = -0.2, r = this.A.wallR(th, RIM_Y) + 10;
      const face = Math.atan2(-Math.sin(th), -Math.cos(th));
      this.baseFire = this.at(th, r, RIM_Y);
      place(this.scene, this.M.tent_detailedOpen, this.at(th - 0.06, r + 3.5, RIM_Y), 3.6, face + 0.5);
      place(this.scene, this.M.campfire_stones, this.baseFire, 2.6);
      place(this.scene, this.M.campfire_logs, this.baseFire, 2.4, 0.6);
    }
    // лагеря: первая полка каждого яруса
    const seen = new Set();
    for (const L of this.A.ledges) {
      const k = layerAt(L.y);
      if (k === 0 || seen.has(k)) continue;
      seen.add(k);
      this.makeCamp(L);
    }
    this.total = this.shards.length;
  }

  walk(L, thFrom, thTo, idx) {
    // точки вдоль полки посередине её ширины
    const d = normA(thTo - thFrom), back = d > Math.PI;     // идти можно и назад
    const span = back ? -(Math.PI * 2 - d) : d;
    const n = Math.max(1, Math.round(Math.abs(span) * this.A.wallR(thFrom, L.y) / 4));
    let last = null;
    for (let i = 1; i <= n; i++) {
      const th = thFrom + span * (i / n);
      const p = this.onLedge(L, th, 0.5);
      this.route.push({ type: 'walk', to: p });
      if (i % 2 === 1 && i < n) this.addShard(p.clone().add(new THREE.Vector3(0, 1.1, 0)));
      last = p;
    }
    return last;
  }

  make_stairs(link, pos) {
    // мостки: доски по стене от края плато вниз до первой полки
    const A = this.A, L = link.to, th0 = link.theta;
    const n = 11, planks = [];
    for (let i = 0; i < n; i++) {
      const th = th0 - 0.16 + i * 0.03, y = RIM_Y - 0.9 * (i + 1);
      const r = A.wallR(th, y) - 0.95;
      const c = this.at(th, r, y - 0.12);
      planks.push(this.addBox(c, 0.75, 0.12, 0.6, th, 'plank', this.matWood));
      // опора под доской
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), this.matWoodDark);
      leg.position.copy(this.at(th, r + 0.45, y - 0.65));
      this.scene.add(leg);
    }
    const edge = this.at(th0 - 0.19, A.wallR(th0 - 0.19, RIM_Y) + 1.2, RIM_Y);
    this.route.push({ type: 'walk', to: edge });
    this.route.push({ type: 'jumps', plats: planks, to: this.onLedge(L, th0 + 0.2, 0.5) });
    this.hint(edge, 'Мостки вниз: шагай с доски на доску до первого уступа');
    this.sign(edge, th0 - 0.12);
    return this.walk(L, th0 + 0.2, normA(L.th1 + L.span * 0.9), 0);
  }

  make_climb(link, pos) {
    const A = this.A, L = link.from, N = link.to, th = link.theta;
    // точка у самого конца полки, у стены
    const thE = normA(L.th1 + L.span * 0.97);
    const at = this.at(thE, A.wallR(thE, L.y) - 0.9, L.y);
    this.route.push({ type: 'walk', to: at });
    const land = this.at(th, A.wallR(th, N.y) - 1.0, N.y);
    this.route.push({ type: 'climb', theta: th, fromY: L.y, to: land });
    this.hint(at, 'Подойди к стене и жми «Хват». Отойди вбок за край уступа и спускайся — следи за силами!');
    // меловые метки на стене, где лезть
    this.marks(th, L.y, N.y);
    return this.walk(N, th, normA(N.th1 + N.span * 0.9), 0);
  }

  make_rappel(link, pos) {
    const A = this.A, L = link.from, N = link.to, th = link.theta;
    const uL = A.ledgeU(L, th);
    const rin = A.ledgeInner(L, th, uL);
    const post = this.at(th, rin + 0.6, L.y);
    const ring = this.at(th, rin - 0.35, L.y + 1.6);
    this.ringPost(post, ring, th);
    const anchor = { kind: 'rappel', pos: ring };
    this.anchors.push(anchor);
    const at = this.at(th, rin + 1.2, L.y);
    this.route.push({ type: 'walk', to: at });
    const land = N ? this.at(th, A.wallR(th, N.y) - A.ledgeDepth(N, A.ledgeU(N, th)) * 0.45, N.y) : this.at(th, A.wallR(th, BOTTOM_Y) - 8, BOTTOM_Y);
    this.route.push({ type: 'rappel', anchor, to: land, floor: !N });
    this.hint(at, 'Кольцо для верёвки: наведи камеру, «Крюк» — и спускайся, держа джойстик вниз');
    if (!N) return land;
    return this.walk(N, th, normA(N.th1 + N.span * 0.9), 0);
  }

  make_jumps(link, pos) {
    const A = this.A, N = link.to, plats = [];
    link.plats.forEach((p, i) => {
      const c = this.at(p.th, p.r, p.y - 0.25);
      const box = this.addBox(c, 1.0, 0.25, 1.0, p.th, 'plank', null);
      box.mesh = this.rockPlatform(c, p.y);
      if (i === 2) {           // одна парящая глыба плавает вверх-вниз
        const base = c.clone();
        this.movers.push({ box, f: (t) => base.clone().setY(base.y + Math.sin(t * 1.4) * 0.5) });
      }
      plats.push(box);
      if (i === 3) this.addShard(c.clone().add(new THREE.Vector3(0, 1.4, 0)));
    });
    const L = link.from, thE = normA(L.th1 + L.span * 0.96);
    this.route.push({ type: 'walk', to: this.at(thE, this.A.wallR(thE, L.y) - 1.2, L.y) });
    const land = this.onLedge(N, normA(N.th1 + 0.12), 0.5);
    this.route.push({ type: 'jumps', plats, to: land });
    this.hint(this.onLedge(L, normA(L.th1 + L.span * 0.9), 0.5), 'Прыгай вниз по парящим камням. Одна глыба качается!');
    return this.walk(N, normA(N.th1 + 0.12), normA(N.th1 + N.span * 0.9), 0);
  }

  make_zip(link, pos) {
    const A = this.A, L = link.from, N = link.to;
    const a = this.at(link.thA, A.ledgeInner(L, link.thA, A.ledgeU(L, link.thA)) + 1.0, L.y + 2.6);
    const uB = Math.max(0.05, A.ledgeU(N, link.thB));
    const b = this.at(link.thB, A.ledgeInner(N, link.thB, uB) + 2.6, N.y + 2.3);
    const zip = { a, b, len: a.distanceTo(b), dir: b.clone().sub(a).normalize() };
    this.zips.push(zip);
    // трос и столбы
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, zip.len, 5), this.matCable);
    cable.position.copy(a).lerp(b, 0.5);
    cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), zip.dir);
    this.scene.add(cable);
    for (const [p, Lx, th] of [[a, L, link.thA], [b, N, link.thB]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 3.0, 8), this.matWoodDark);
      pole.position.set(p.x, Lx.y + 1.4, p.z);
      pole.castShadow = true;
      this.scene.add(pole);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.06, 8, 22), this.matRing.clone());
    ring.position.copy(a).addScaledVector(zip.dir, 0.8).add(new THREE.Vector3(0, -0.15, 0));
    this.scene.add(ring);
    const glow = makeGlow(); glow.position.copy(ring.position); this.scene.add(glow);
    const anchor = { kind: 'zip', pos: ring.position.clone(), zip, mesh: ring, glow };
    this.anchors.push(anchor);
    const at = this.at(link.thA, A.ledgeInner(L, link.thA, A.ledgeU(L, link.thA)) + 2.0, L.y);
    this.route.push({ type: 'walk', to: at });
    const land = this.at(link.thB, A.ledgeInner(N, link.thB, uB) + 3.2, N.y);
    this.route.push({ type: 'zip', anchor, to: land });
    this.addShard(a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -1.2, 0)));
    this.hint(at, 'Трос через бездну! Наведи камеру на кольцо у троса и жми «Крюк»');
    return this.walk(N, link.thB, normA(N.th1 + N.span * 0.9), 0);
  }

  make_mushroom(link, pos) {
    const A = this.A, L = link.from, N = link.to, th = link.theta;
    const rin = A.ledgeInner(L, th, A.ledgeU(L, th));
    const drop = this.at(th, link.rPad, N.y);              // куда упадёшь, если шагнуть с края
    const pad = this.addBox(drop.clone().setY(N.y + 0.55), 1.6, 0.55, 1.6, th, 'pad', null);
    pad.soft = true;
    const m = place(this.scene, this.M.mushroom_red, drop.clone().setY(N.y), 19, th);
    m.scale.y = 7.2;                                       // шляпка — на высоте 1.1 м, как «батут»
    pad.mesh = m;
    for (let i = 0; i < 4; i++) {                          // мелкие грибы вокруг
      const a = th + (i - 1.5) * 0.045, r = link.rPad + (i % 2 ? 1.9 : -1.8);
      place(this.scene, this.M.mushroom_red, this.at(a, r, N.y), 5 + i, i);
    }
    const at = this.at(th, rin + 0.8, L.y);
    this.route.push({ type: 'walk', to: at });
    this.route.push({ type: 'drop', pad, to: this.onLedge(N, th, 0.45) });
    this.hint(at, 'Внизу огромный гриб — прыгай на него с края, он смягчит падение');
    return this.walk(N, th, normA(N.th1 + N.span * 0.9), 0);
  }

  makeCamp(L) {
    const th = normA(L.th1 + L.span * 0.5), A = this.A;
    const wall = A.wallR(th, L.y), dep = A.ledgeDepth(L, 0.5);
    const p = this.at(th, wall - dep * 0.55, L.y);
    const out = new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
    const face = Math.atan2(-out.x, -out.z);
    place(this.scene, this.M.tent_detailedOpen, this.at(th + 0.05, wall - dep * 0.35, L.y), 3.6, face + 0.4);
    const fire = this.at(th - 0.04, wall - dep * 0.6, L.y);
    place(this.scene, this.M.campfire_stones, fire, 2.6);
    place(this.scene, this.M.campfire_logs, fire, 2.4, 0.6);
    this.camps.push({ pos: p, fire, index: this.camps.length, reached: false, layer: layerAt(L.y) });
  }

  // ——— мелкие постройки ———
  ringPost(post, ring, th) {
    const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 8), this.matWoodDark);
    p1.position.set(post.x, post.y + 1.0, post.z);
    const dir = ring.clone().sub(post).setY(0);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, dir.length() + 0.3), this.matWoodDark);
    beam.position.copy(post).lerp(ring, 0.5).setY(ring.y + 0.35);
    beam.lookAt(ring.x, beam.position.y, ring.z);
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.06, 8, 22), this.matRing.clone());
    r.position.copy(ring);
    this.scene.add(p1, beam, r);
    const glow = makeGlow(); glow.position.copy(ring); this.scene.add(glow);
    [p1, beam].forEach((m) => { m.castShadow = true; });
  }

  rockPlatform(c, top) {
    const g = new THREE.CylinderGeometry(1.15, 0.6, 1.4, 7, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0) pos.setXYZ(i, pos.getX(i) * (0.8 + Math.random() * 0.3), pos.getY(i) - Math.random() * 0.5, pos.getZ(i) * (0.8 + Math.random() * 0.3));
    g.computeVertexNormals();
    const k = layerAt(top), Lr = LAYERS[k];
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: Lr.rock }));
    m.position.set(c.x, top - 0.7, c.z);
    const moss = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.18, 0.12, 7), new THREE.MeshLambertMaterial({ color: Lr.ground }));
    moss.position.y = 0.7;
    m.add(moss);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  marks(th, yTop, yBot) {
    const g = new THREE.PlaneGeometry(0.35, 0.18);
    const mat = new THREE.MeshBasicMaterial({ color: '#f4efe4', transparent: true, opacity: 0.7, depthWrite: false });
    for (let y = yTop - 1.5; y > yBot + 0.5; y -= 1.6) {
      const t = th + (Math.round(y) % 2 ? 0.006 : -0.006);
      const r = this.A.wallR(t, y) - 0.06;
      const m = new THREE.Mesh(g, mat);
      m.position.copy(this.at(t, r, y));
      m.lookAt(0, y, 0);
      this.scene.add(m);
    }
  }

  sign(p, th) {
    const s = this.at(th, this.A.wallR(th, RIM_Y) + 2.2, RIM_Y);
    place(this.scene, this.M.sign, s, 3.2, th);
  }

  addBox(c, hx, hy, hz, psi, kind, mat) {
    const box = { c: c.clone(), hx, hy, hz, psi, cos: Math.cos(psi), sin: Math.sin(psi), kind, dp: new THREE.Vector3() };
    if (mat) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
      m.position.copy(c); m.rotation.y = psi;
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
      box.mesh = m;
    }
    this.boxes.push(box);
    return box;
  }

  addShard(p) {
    const m = new THREE.Mesh(this.shardGeo, this.matShard);
    m.position.copy(p);
    this.scene.add(m);
    this.shards.push({ pos: p.clone(), mesh: m, taken: false });
  }

  hint(p, text) {
    // каждую подсказку — только в первый раз (дальше игрок уже знает, что делать)
    if (this.hints.some((h) => h.text === text)) return;
    this.hints.push({ pos: p.clone(), r: 6, text, shown: false });
  }

  update(time) {
    for (const mv of this.movers) {
      const np = mv.f(time);
      mv.box.dp.subVectors(np, mv.box.c);
      mv.box.c.copy(np);
      if (mv.box.mesh) mv.box.mesh.position.set(np.x, np.y + mv.box.hy - 0.7, np.z);
    }
    for (const s of this.shards) {
      if (s.taken) continue;
      s.mesh.rotation.y = time * 1.8;
      s.mesh.position.y = s.pos.y + Math.sin(time * 2.4 + s.pos.x) * 0.12;
    }
  }

  // ——— доски, камни, грибы: столкновения ———
  local(b, x, z) { const dx = x - b.c.x, dz = z - b.c.z; return [dx * b.cos - dz * b.sin, dx * b.sin + dz * b.cos]; }
  support(x, z, y, step = 0.35) {
    let best = null;
    for (const b of this.boxes) {
      const top = b.c.y + b.hy;
      if (top > y + step || top < y - 2) continue;
      const [lx, lz] = this.local(b, x, z);
      if (Math.abs(lx) <= b.hx + 0.12 && Math.abs(lz) <= b.hz + 0.12 && (!best || top > best.top)) best = { top, box: b };
    }
    return best;
  }
  pushOut(p, vel) {
    let bumped = false;
    for (const b of this.boxes) {
      const top = b.c.y + b.hy, bottom = b.c.y - b.hy;
      if (p.y >= top - 0.35 || p.y + PH <= bottom) continue;
      let [lx, lz] = this.local(b, p.x, p.z);
      const ex = b.hx + PR, ez = b.hz + PR;
      if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
      if (vel && vel.y > 0 && p.y + PH - vel.y * 0.03 <= bottom + 0.05 && Math.abs(lx) < b.hx && Math.abs(lz) < b.hz) { p.y = bottom - PH; vel.y = 0; bumped = true; continue; }
      if (ex - Math.abs(lx) < ez - Math.abs(lz)) lx = Math.sign(lx || 1) * ex; else lz = Math.sign(lz || 1) * ez;
      p.x = b.c.x + lx * b.cos + lz * b.sin;
      p.z = b.c.z - lx * b.sin + lz * b.cos;
    }
    return bumped;
  }
}

export function makeGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,220,160,1)');
  grd.addColorStop(0.35, 'rgba(255,150,60,0.55)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }));
  s.scale.setScalar(1.6);
  return s;
}
