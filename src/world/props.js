// Всё, что стоит в мире: растения и камни (расставлены при запекании, у каждого своя освещённость),
// посёлок (стены, двери и окна из Kenney Fantasy Town Kit, крыши — свои), смотровая площадка, перила
// тропы, лагеря, шахта (рельсы, крепь, лампы, вагонетки), закрытый проход вниз.
// Одинаковые вещи рисуются «пачкой» (InstancedMesh) по участкам — невидимые участки не рисуются,
// мелочь (трава, цветы) — только рядом с камерой.
// Столкновения (дома, перила, ящики, стволы) — в this.colliders для world/physics.js.
import * as THREE from 'three';
import { bakedProps } from './terrain.js';
import { makeRng } from '../core/noise.js';

export const WIND = { value: 0 };            // время для ветра (общий uniform)
const TAU = Math.PI * 2;
const S = 2.6;                               // клетка домов, м

// покачивание от ветра: верх модели гуляет сильнее низа
function windy(mat, k) {
  if (mat.userData.windK !== undefined) return mat;
  mat.userData.windK = k;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWindTime = WIND;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
          #else
            vec3 ip = vec3(0.0);
          #endif
          float wy = max(transformed.y, 0.0);
          float ph = uWindTime * 1.6 + ip.x * 0.21 + ip.z * 0.17;
          transformed.x += sin(ph) * wy * wy * ${k.toFixed(3)};
          transformed.z += cos(ph * 0.8 + 1.3) * wy * wy * ${(k * 0.6).toFixed(3)};
        }`);
  };
  mat.customProgramCacheKey = () => 'wind' + k;
  return mat;
}

// светятся своим цветом (кристаллы, светящиеся грибы)
function glowing(mat, strength) {
  mat.emissive = new THREE.Color('#ffffff');
  mat.emissiveIntensity = strength;
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor;\n#endif');
  };
  mat.customProgramCacheKey = () => 'glow' + strength;
  return mat;
}

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
function crystalCluster() {
  const one = crystalGeometry(), parts = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  [[0, 0, 0, 1, 2.4, 0, 0], [0.55, 0, 0.2, 0.6, 1.5, 0.35, 0.2], [-0.5, 0, 0.3, 0.55, 1.3, -0.4, 0.1], [0.1, 0, -0.55, 0.65, 1.6, 0.2, -0.35], [-0.3, 0, -0.4, 0.45, 1.0, -0.3, -0.3]]
    .forEach(([x, y, z, s, h, rx, rz]) => {
      const g = one.clone();
      m.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, 0, rz)), new THREE.Vector3(s, h, s));
      g.applyMatrix4(m);
      parts.push(g.attributes.position.array);
    });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(parts.flatMap((a) => Array.from(a)), 3));
  g.computeVertexNormals();
  return g;
}

// виды растений и камней из запекания → модель и как рисовать
const KINDS = {
  oak: { model: 'tree_oak', cell: 160, shadow: true, wind: 0.02, col: 0.32, far: 'round' },
  pine: { model: 'tree_pineRoundA', cell: 160, shadow: true, wind: 0.015, col: 0.3, far: 'cone' },
  pineTall: { model: 'tree_pineTallA_detailed', cell: 160, shadow: true, wind: 0.012, col: 0.28, far: 'cone' },
  round: { model: 'tree_default', cell: 160, shadow: true, wind: 0.02, col: 0.3, far: 'round' },
  fat: { model: 'tree_fat', cell: 160, shadow: true, wind: 0.02, col: 0.34, far: 'round' },
  deadTree: { model: 'sv-tree-trunk', cell: 160, shadow: true, col: 0.3, tint: [0.85, 0.8, 0.75] },
  bush: { model: 'plant_bushLarge', cell: 80, small: 130, wind: 0.05 },
  berry: { model: 'plant_bush', cell: 80, small: 130, wind: 0.05, berries: true },
  rock: { model: 'rock_largeC', cell: 160, shadow: true, col: 0.4 },
  mushroom: { model: 'mushroom_redGroup', cell: 80, small: 110 },
  mushGlow: { model: 'mushroom_tanTall', cell: 80, small: 150, glow: 0.55, tint: [0.45, 1.0, 0.95] },
  grass: { model: 'grass', cell: 64, small: 60, wind: 0.12, grass: true },
  grassDry: { model: 'grass', cell: 64, small: 60, wind: 0.12, grass: true, tint: [1.35, 1.15, 0.6] },
  grassDeep: { model: 'grass_leafsLarge', cell: 64, small: 60, wind: 0.08, grass: true, tint: [0.55, 1.05, 1.0] },
  fern: { model: 'grass_leafsLarge', cell: 64, small: 70, wind: 0.08, grass: true },
  flowerY: { model: 'flower_yellowA', cell: 64, small: 50, wind: 0.1, grass: true },
  flowerR: { model: 'flower_redA', cell: 64, small: 50, wind: 0.1, grass: true },
  flowerP: { model: 'flower_purpleA', cell: 64, small: 50, wind: 0.1, grass: true },
  crystal: { geo: 'crystal', cell: 80, small: 150, glow: 0.7, color: true },
  crystalBig: { geo: 'cluster', cell: 120, glow: 0.8, color: true, col: 3, colH: 2.3 },
};

export class Props {
  constructor(scene, L, W, models, gfx) {
    this.scene = scene; this.L = L; this.W = W; this.M = models; this.gfx = gfx;
    this.colliders = [];            // { box: c, hx, hy, hz, rot } или { cyl: x, z, y0, y1, r }
    this.near = [];                 // мелочь: рисуется только рядом — { mesh, x, z, r, max }
    this.spin = [];                 // вращается (мельница, водяное колесо)
    this.camps = [];                // точки сохранения: { pos, name, fire }
    this.fires = [];                // костры с огнём
    this.lanternTops = [];
    this.rng = makeRng(4242);
    this.H = (x, z) => this.groundAt(x, z);
    this.scatter();
    this.village();
    this.lookout();
    this.pathRails();
    this.campForest();
    this.campLost();
    this.mine();
    this.gate();
    this.anchors = [];              // за что цепляется крюк, кроме скал: кольца и начала тросов
    this.zipLines();
    this.rings();
    this.notesAndFinds();
    this.resourceViews();
    this.rubbleViews();
    this.stations();
  }

  // ——— ресурсы (этап 4): модели по видам; собрали — экземпляр прячется, вырос снова — показывается ———
  // Вернёт для каждого ресурса { data, view } — main.js делает из них сущности.
  resourceViews() {
    const R = this.L.resources, byType = {};
    R.forEach((r) => (byType[r.type] || (byType[r.type] = [])).push(r));
    const rng = makeRng(707);
    this.resList = [];
    const hideShow = (meshes, i, mats, on) => { for (let k = 0; k < meshes.length; k++) { meshes[k].setMatrixAt(i, on ? mats[k][i] : ZERO); meshes[k].instanceMatrix.needsUpdate = true; } };
    const fromModel = (type, model, s, opts = {}) => {
      const list = (byType[type] || []).map((r) => ({ x: r.pos[0], y: r.pos[1] + (opts.dy || 0), z: r.pos[2], ry: rng() * TAU, s: s * (r.rich ? 1.35 : 1) }));
      if (!list.length) return;
      const meshes = this.many(model, list, { shadow: false });
      if (opts.glow) for (const m of meshes) m.material = glowing(m.material.clone(), opts.glow);
      const mats = meshes.map((m) => list.map((_, i) => { const q = new THREE.Matrix4(); m.getMatrixAt(i, q); return q; }));
      byType[type].forEach((r, i) => this.resList.push({ r, view: { sync: (e) => hideShow(meshes, i, mats, !e.taken) } }));
    };
    fromModel('wood', 'sv-resource-wood', 7);
    fromModel('stone', 'sv-resource-stone', 6);
    fromModel('mushroom', 'mushroom_redGroup', 2.4);
    fromModel('glowshroom', 'mushroom_tanTall', 2.6, { glow: 0.9 });
    // руда: тёмный камень с рыжими крупинками (светятся немного — видно в шахте)
    const ores = byType.ore || [];
    if (ores.length) {
      const body = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.55), new THREE.MeshLambertMaterial({ color: '#4d4541' }), ores.length);
      const bits = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: '#ff9a3c' }), ores.length * 4);
      const mb = [], mt = [];
      ores.forEach((r, i) => {
        const sc = r.rich ? 1.4 : 1, m = new THREE.Matrix4().compose(new THREE.Vector3(r.pos[0], r.pos[1] + 0.35 * sc, r.pos[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng(), rng() * 3, rng())), new THREE.Vector3(sc, sc * 0.8, sc));
        body.setMatrixAt(i, m); mb.push(m);
        for (let k = 0; k < 4; k++) {
          const a = k * 1.7 + i, q = new THREE.Matrix4().makeTranslation(r.pos[0] + Math.cos(a) * 0.45 * sc, r.pos[1] + (0.3 + (k % 2) * 0.25) * sc, r.pos[2] + Math.sin(a) * 0.45 * sc);
          bits.setMatrixAt(i * 4 + k, q); mt.push(q);
        }
      });
      body.castShadow = true;
      this.scene.add(body, bits);
      ores.forEach((r, i) => this.resList.push({ r, view: { sync: (e) => {
        body.setMatrixAt(i, e.taken ? ZERO : mb[i]); body.instanceMatrix.needsUpdate = true;
        for (let k = 0; k < 4; k++) bits.setMatrixAt(i * 4 + k, e.taken ? ZERO : mt[i * 4 + k]);
        bits.instanceMatrix.needsUpdate = true;
      } } }));
    }
    // ягоды на кустах — тоже ресурс (раньше съедались сами)
    if (this.berryMesh) {
      const orig = [];
      for (let k = 0; k < this.berryMesh.count; k++) { const q = new THREE.Matrix4(); this.berryMesh.getMatrixAt(k, q); orig.push(q); }
      this.bushes.forEach((b, i) => this.resList.push({ r: { id: `res:berry${i}`, type: 'berry', pos: [b.x, b.y, b.z] }, view: { sync: (e) => {
        for (let k = 0; k < 7; k++) this.berryMesh.setMatrixAt(b.idx + k, e.taken ? ZERO : orig[b.idx + k]);
        this.berryMesh.instanceMatrix.needsUpdate = true;
      } } }));
    }
  }

  // ——— завалы: груда камней поперёк хода; разбили — камни и столкновение исчезают ———
  rubbleViews() {
    this.rubbleList = [];
    for (const R of this.L.rubble) {
      const [x, y, z] = R.pos, c = Math.cos(R.rot), s = Math.sin(R.rot);
      const list = [[-1.4, 0, 2.6], [0, 0.2, 3.0], [1.4, 0, 2.5], [-0.6, 1.3, 2.0], [0.7, 1.2, 2.2]].map(([u, h, sc], i) => ({ x: x + u * c, y: y + h - 0.3, z: z - u * s, ry: i * 1.3, s: sc }));
      const meshes = this.many('rock_largeC', list);
      const col = { box: true, c: new THREE.Vector3(x, y + 1.6, z), hx: 2.4, hy: 1.6, hz: 0.9, rot: R.rot, cos: Math.cos(R.rot), sin: Math.sin(R.rot) };
      this.colliders.push(col);
      this.rubbleList.push({ r: R, view: { sync: (e) => {
        if (!e.cleared) return;
        for (const m of meshes) m.visible = false;
        if (this.physics) this.physics.removeCollider(col);
      } } });
    }
  }

  // ——— верстаки и печи (места крафта) ———
  stations() {
    const parts = [], glow = [];
    for (const st of this.L.stations) {
      const [x, y, z] = st.pos;
      if (st.type === 'workbench' && st.model !== false) {
        this.many('sv-workbench', [{ x, y, z, ry: 0.3, s: 3 }]);
        this.box(x, y + 0.5, z, 0.9, 0.5, 0.6, 0.3);
      }
      if (st.type === 'furnace') {
        const body = new THREE.BoxGeometry(1.6, 1.5, 1.4); body.translate(0, 0.75, 0);
        parts.push({ geo: body, m: new THREE.Matrix4().makeTranslation(x, y, z), color: '#7d7368' });
        const top = new THREE.CylinderGeometry(0.3, 0.38, 1.4, 6); top.translate(0.35, 2.1, -0.3);
        parts.push({ geo: top, m: new THREE.Matrix4().makeTranslation(x, y, z), color: '#5d554d' });
        const mouth = new THREE.BoxGeometry(0.7, 0.5, 0.1); mouth.translate(0, 0.55, 0.71);
        glow.push(new THREE.Matrix4().makeTranslation(x, y, z));
        this.box(x, y + 0.75, z, 0.8, 0.75, 0.7, 0);
        st._mouth = mouth;
      }
    }
    if (parts.length) this.solid(parts);
    if (glow.length) {
      const g = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.5, 0.1).translate(0, 0.55, 0.71), new THREE.MeshBasicMaterial({ color: '#ff8a3a' }), glow.length);
      glow.forEach((m, i) => g.setMatrixAt(i, m));
      this.scene.add(g);
    }
  }

  // ——— записки (столбики с табличкой) и находки (сундуки с огоньком над ними) ———
  notesAndFinds() {
    this.notes = this.L.notes.map((n) => ({ id: n.id, title: n.title, text: n.text, pos: new THREE.Vector3(...n.at), read: false }));
    this.finds = this.L.finds.map((f, i) => ({ id: f.id, name: f.name, where: f.where, pos: new THREE.Vector3(...f.pos), taken: false, idx: i }));
    this.many('sv-signpost-single', this.notes.map((n, i) => ({ x: n.pos.x, y: n.pos.y, z: n.pos.z, ry: i * 1.7, s: 2.4 })));
    for (const n of this.notes) this.colliders.push({ cyl: true, x: n.pos.x, z: n.pos.z, y0: n.pos.y, y1: n.pos.y + 2, r: 0.18 });
    this.many('sv-chest', this.finds.map((f, i) => ({ x: f.pos.x, y: f.pos.y, z: f.pos.z, ry: i * 2.1, s: 2.8 })));
    for (const f of this.finds) this.box(f.pos.x, f.pos.y + 0.4, f.pos.z, 0.5, 0.4, 0.5, 0);
    // огонёк над закрытым сундуком — видно из темноты
    const g = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color: '#ffd76a' }), this.finds.length);
    this.finds.forEach((f, i) => g.setMatrixAt(i, new THREE.Matrix4().makeTranslation(f.pos.x, f.pos.y + 1.6, f.pos.z)));
    this.scene.add(g);
    this.findGlow = g;
  }

  // сундук открыт — огонёк гаснет
  hideFindGlow(idx) {
    this.findGlow.setMatrixAt(idx, new THREE.Matrix4().makeScale(0, 0, 0));
    this.findGlow.instanceMatrix.needsUpdate = true;
  }

  // ——— тросы через провалы: два столба, провисший трос; крюк у начала — и поехали ———
  zipLines() {
    const parts = [], wood = '#7a5232', iron = '#3c4149';
    const cablePts = [];
    for (const Z of this.L.zips) {
      const a = new THREE.Vector3(...Z.a), b = new THREE.Vector3(...Z.b);
      // столбы с перекладиной (на смотровой — короче: стоит на настиле)
      for (const [p, h] of [[a, Z.postA], [b, Z.postB]]) {
        const pole = new THREE.CylinderGeometry(0.16, 0.2, h + 0.4, 6);
        pole.translate(0, (h + 0.4) / 2 - 0.3, 0);
        parts.push({ geo: pole, m: new THREE.Matrix4().makeTranslation(p.x, p.y - h, p.z), color: wood });
        const bar = new THREE.BoxGeometry(1.2, 0.16, 0.16);
        parts.push({ geo: bar, m: new THREE.Matrix4().makeRotationY(Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2).setPosition(p.x, p.y + 0.05, p.z), color: wood });
        this.colliders.push({ cyl: true, x: p.x, z: p.z, y0: p.y - h - 0.3, y1: p.y + 0.2, r: 0.22 });
      }
      // трос: ломаная по провисающей кривой
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const u = i / 24;
        pts.push(new THREE.Vector3().lerpVectors(a, b, u).setY(a.y + (b.y - a.y) * u - Z.sag * 4 * u * (1 - u)));
      }
      cablePts.push(pts);
      const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
      dir.multiplyScalar(1 / len);
      this.anchors.push({ kind: 'zip', name: Z.name, pos: a.clone(), zip: { a, b, dir, len, sag: Z.sag } });
    }
    for (const pts of cablePts) {
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.04, 5, false);
      parts.push({ geo: tube, m: new THREE.Matrix4(), color: iron });
    }
    if (parts.length) this.solid(parts);
  }

  // ——— кольца — особые точки для крюка: железное кольцо на скале и огонёк рядом (видно издалека) ———
  rings() {
    const parts = [], glowPos = [], n = new THREE.Vector3();
    for (const Rg of this.L.rings) {
      const p = new THREE.Vector3(...Rg.pos);
      this.W.normal(p.x, p.y, p.z, n);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const ring = new THREE.TorusGeometry(0.34, 0.07, 8, 18);
      ring.rotateX(Math.PI / 2);                              // кольцо висит вниз от скобы
      ring.translate(0, -0.3, 0.12);
      parts.push({ geo: ring, m: new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)), color: '#4a5058' });
      const plate = new THREE.BoxGeometry(0.42, 0.42, 0.14);
      parts.push({ geo: plate, m: new THREE.Matrix4().compose(p.clone().addScaledVector(n, -0.12), q, new THREE.Vector3(1, 1, 1)), color: '#2e3238' });
      glowPos.push(p.clone().addScaledVector(n, 0.25).setY(p.y + 0.45));
      this.anchors.push({ kind: 'ring', name: Rg.name, pos: p.clone().setY(p.y - 0.3).addScaledVector(n, 0.12) });
    }
    if (!parts.length) return;
    this.solid(parts);
    const glow = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: '#8ff0ff' }), glowPos.length);
    glowPos.forEach((g, i) => glow.setMatrixAt(i, new THREE.Matrix4().makeTranslation(g.x, g.y, g.z)));
    this.scene.add(glow);
    this.ringGlow = glow;
  }

  // высота земли под точкой (по формуле мира)
  groundAt(x, z, yTop = 40, maxDrop = 300) {
    const t = this.W.raycast(x, yTop, z, 0, -1, 0, maxDrop);
    return t < 0 ? yTop - maxDrop : yTop - t;
  }

  // ——— растения и камни из запекания ———
  scatter() {
    const data = bakedProps(), geos = { crystal: crystalGeometry(), cluster: crystalCluster() };
    for (const [kind, list] of Object.entries(data)) {
      const k = KINDS[kind];
      if (!k || !list.length) continue;
      let root;
      if (k.geo) {
        const mat = glowing(new THREE.MeshLambertMaterial({ color: '#ffffff' }), k.glow);
        root = new THREE.Mesh(geos[k.geo], mat);
      } else {
        root = this.M[k.model];
        if (!root) continue;
        root.traverse((o) => {
          if (!o.isMesh) return;
          if (k.wind) windy(o.material, k.wind);
          if (k.glow) glowing(o.material, k.glow);
        });
      }
      const meshes = this.cells(root, list, k, kind);
      if (k.far) this.farTrees(list, k, meshes);
      if (k.col) for (let i = 0; i < list.length; i += 6) this.colliders.push({ cyl: true, x: list[i], z: list[i + 2], y0: list[i + 1] - 1, y1: list[i + 1] + (k.colH ? k.colH * list[i + 4] : 4), r: k.col * list[i + 4] * 0.25 });
      if (k.grass) for (const m of meshes) { m.userData.total = m.count; this.gfx.grass.push(m); }
      if (k.berries) this.berries(list);
    }
  }

  // экземпляры по участкам: каждый участок отсекается отдельно (и не рисуется вдали, если мелкий)
  cells(root, list, k, kind) {
    const cell = k.cell, groups = new Map();
    for (let i = 0; i < list.length; i += 6) {
      const key = Math.floor(list[i] / cell) * 4096 + Math.floor(list[i + 2] / cell);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    root.updateMatrixWorld(true);
    const parts = [];
    root.traverse((o) => { if (o.isMesh) parts.push(o); });
    const out = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    const tint = k.tint || [1, 1, 1];
    const crystalCols = [new THREE.Color('#5fe0ff'), new THREE.Color('#7affd9'), new THREE.Color('#c77dff')];
    for (const idxs of groups.values()) {
      let cx = 0, cz = 0;
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, idxs.length);
        idxs.forEach((i, n) => {
          const s = list[i + 4];
          q.setFromAxisAngle(up, list[i + 3]);
          m.compose(new THREE.Vector3(list[i], list[i + 1], list[i + 2]), q, new THREE.Vector3(s, s * (k.color ? 1.3 : 1), s)).multiply(part.matrixWorld);
          im.setMatrixAt(n, m);
          const lit = list[i + 5];
          if (k.color) c.copy(crystalCols[(i / 6) % 3 === 0 && list[i + 1] < -150 ? 2 : (i / 6) % 2]);
          else c.setRGB(lit * tint[0], lit * tint[1], lit * tint[2]);
          im.setColorAt(n, c);
          cx += list[i]; cz += list[i + 2];
        });
        im.castShadow = !!k.shadow;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        this.scene.add(im);
        out.push(im);
        if (k.small) this.near.push({ mesh: im, x: im.boundingSphere.center.x, z: im.boundingSphere.center.z, r: im.boundingSphere.radius, max: k.small });
      }
    }
    return out;
  }

  // дальние деревья: вместо модели — простая крона (конус или шар) и ствол; ближние участки — настоящие
  farTrees(list, k, nearMeshes) {
    const crown = k.far === 'cone' ? new THREE.ConeGeometry(0.42, 1.05, 6) : new THREE.IcosahedronGeometry(0.38, 0);
    crown.translate(0, k.far === 'cone' ? 0.72 : 0.78, 0);
    const trunk = new THREE.CylinderGeometry(0.05, 0.07, 0.4, 5);
    trunk.translate(0, 0.2, 0);
    const pos = [], col = [];
    const add = (g, c) => { const a = g.toNonIndexed().attributes.position.array; for (let i = 0; i < a.length; i++) pos.push(a[i]); for (let i = 0; i < a.length / 3; i++) col.push(...c); };
    add(crown, k.far === 'cone' ? [0.18, 0.42, 0.25] : [0.3, 0.55, 0.24]);
    add(trunk, [0.42, 0.28, 0.16]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const root = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const far = this.cells(root, list, { ...k, shadow: false, far: null }, 'far');
    // пары «ближний/дальний» по одинаковым участкам
    this.lods = this.lods || [];
    for (let i = 0; i < far.length && i < nearMeshes.length; i++) {
      const c = nearMeshes[i].boundingSphere.center;
      this.lods.push({ near: nearMeshes[i], far: far[i], x: c.x, z: c.z, r: nearMeshes[i].boundingSphere.radius });
    }
  }

  berries(list) {
    const geo = new THREE.SphereGeometry(0.1, 6, 4), mat = new THREE.MeshLambertMaterial({ color: '#e0283f', emissive: '#7a0018', emissiveIntensity: 0.5 });
    const n = (list.length / 6) * 7, im = new THREE.InstancedMesh(geo, mat, n), m = new THREE.Matrix4();
    let k = 0;
    this.bushes = [];
    for (let i = 0; i < list.length; i += 6) {
      for (let b = 0; b < 7; b++) {
        const a = (b / 7) * TAU + i, r = 0.35 * list[i + 4] * 0.5;
        m.makeTranslation(list[i] + Math.cos(a) * r, list[i + 1] + 0.35 + (b % 3) * 0.18, list[i + 2] + Math.sin(a) * r);
        im.setMatrixAt(k++, m);
      }
      this.bushes.push({ x: list[i], y: list[i + 1], z: list[i + 2], taken: false, idx: k - 7 });
    }
    this.berryMesh = im;
    this.scene.add(im);
  }

  // ——— простые части (наши): коробки с цветом вершин, сливаются в один меш ———
  solid(parts) {
    const pos = [], col = [], idx = [];
    const c = new THREE.Color();
    for (const p of parts) {
      const g = p.geo, base = pos.length / 3;
      g.applyMatrix4(p.m);
      const pa = g.attributes.position.array;
      for (let i = 0; i < pa.length; i++) pos.push(pa[i]);
      c.set(p.color);
      for (let i = 0; i < pa.length / 3; i++) { const v = 0.94 + 0.12 * ((i * 7919) % 13) / 13; col.push(c.r * v, c.g * v, c.b * v); }
      const ia = g.index ? g.index.array : [...Array(pa.length / 3).keys()];
      for (let i = 0; i < ia.length; i++) idx.push(base + ia[i]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  // много одинаковых моделей по списку { x, y, z, ry, s }
  many(name, list, { shadow = true, scaleY = 1 } = {}) {
    const root = this.M[name];
    if (!root || !list.length) return [];
    root.updateMatrixWorld(true);
    const out = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, list.length);
      list.forEach((p, i) => {
        q.setFromEuler(e.set(p.rx || 0, p.ry || 0, p.rz || 0, 'YXZ'));
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s * (p.sy || scaleY), p.s)).multiply(o.matrixWorld);
        im.setMatrixAt(i, m);
      });
      im.castShadow = shadow; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
      out.push(im);
    });
    return out;
  }

  box(x, y, z, hx, hy, hz, rot = 0) { this.colliders.push({ box: true, c: new THREE.Vector3(x, y, z), hx, hy, hz, rot, cos: Math.cos(rot), sin: Math.sin(rot) }); }

  // ——— посёлок ———
  village() {
    const V = this.L.village, parts = [], mods = {};
    const put = (name, p) => (mods[name] || (mods[name] = [])).push(p);
    for (const h of V.houses) this.house(h, put, parts);
    // площадь: костёр, камни вокруг, лавки
    const [fx, fz] = V.fire, fy = this.H(fx, fz);
    put('campfire_stones', { x: fx, y: fy, z: fz, s: 2.8 });
    put('campfire_logs', { x: fx, y: fy, z: fz, s: 2.6, ry: 0.6 });
    this.fires.push(new THREE.Vector3(fx, fy, fz));
    this.camps.push({ pos: new THREE.Vector3(fx + 3, fy, fz + 3), name: 'посёлок', village: true });
    for (let a = 0; a < 5; a++) {
      const ang = (a / 5) * TAU + 0.3, x = fx + Math.cos(ang) * 4.2, z = fz + Math.sin(ang) * 4.2;
      put('sv-tree-log', { x, y: this.H(x, z), z, ry: -ang, s: 1.3 });   // бревно лежит по кругу (длинное — вдоль z модели)
    }
    for (const [x, z, r] of V.stalls) {
      const y = this.H(x, z);
      put(r > 0 ? 'ft-stall-red' : 'ft-stall-green', { x, y, z, ry: r + Math.PI, s: 3 });
      this.box(x, y + 1.6, z, 1.5, 1.6, 1.5, r);
      put('sv-box-large', { x: x + 2.4, y, z: z + 0.6, ry: r, s: 2.6 });
      put('sv-barrel', { x: x - 2.2, y, z: z + 1.2, s: 2.6 });
    }
    // фонари
    for (const [x, z] of V.lanterns) {
      const y = this.H(x, z);
      put('ft-lantern', { x, y, z, s: 2.2 });
      this.lanternTops.push(new THREE.Vector3(x, y + 3.25, z));
      this.colliders.push({ cyl: true, x, z, y0: y, y1: y + 3, r: 0.25 });
    }
    // повозки, ящики, бочки — для жизни
    const deco = [['ft-cart', 14, -8, 0.4, 2.6], ['ft-cart', -16, 30, 2.2, 2.6], ['sv-barrel', 8, -12, 0, 2.6], ['sv-barrel', 9.5, -11, 0, 2.6], ['sv-box', 20, 4, 0.3, 2.6], ['sv-box-large', -18, -14, 1.2, 2.6], ['sv-bucket', -9, 9, 0, 2.6]];
    for (const [name, dx, dz, ry, s] of deco) {
      const x = this.L.settle.x + dx, z = this.L.settle.z + dz, y = this.H(x, z);
      put(name, { x, y, z, ry, s });
      this.box(x, y + 0.7, z, 0.9, 0.7, 0.9, ry);
    }
    this.villageGreen(V, put);
    // ветряная мельница на холме: башня наша, крылья — из набора, крутятся
    const [mx, mz] = V.windmill, my = this.H(mx, mz);
    const tower = new THREE.CylinderGeometry(2.4, 3.4, 11, 8);
    tower.translate(0, 5.5, 0);
    parts.push({ geo: tower, m: new THREE.Matrix4().makeTranslation(mx, my - 0.4, mz), color: '#d8cfc0' });
    const cap = new THREE.ConeGeometry(3.2, 3.2, 8);
    cap.translate(0, 12.6, 0);
    parts.push({ geo: cap, m: new THREE.Matrix4().makeTranslation(mx, my - 0.4, mz), color: '#b34a3c' });
    this.colliders.push({ cyl: true, x: mx, z: mz, y0: my - 1, y1: my + 12, r: 3.2 });
    const blades = this.M['ft-windmill'] && this.M['ft-windmill'].clone();
    if (blades) {
      const piv = new THREE.Group();
      piv.position.set(mx + 3.2, my + 9.5, mz);
      blades.scale.setScalar(4.2);
      piv.add(blades);
      this.scene.add(piv);
      this.spin.push({ obj: blades, axis: 'x', speed: 0.45 });
    }
    // водяное колесо на реке
    const [wx, wz] = V.watermill, wy = this.H(wx, wz);
    const wheel = this.M['ft-watermill'] && this.M['ft-watermill'].clone();
    if (wheel) {
      wheel.position.set(wx, wy + 1.6, wz);
      wheel.scale.setScalar(3.2);
      wheel.rotation.y = 0.6;
      this.scene.add(wheel);
      this.spin.push({ obj: wheel, axis: 'x', speed: -0.7 });
    }
    for (const [name, list] of Object.entries(mods)) this.many(name, list);
    // огоньки в фонарях
    const glow = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffd38a' }), this.lanternTops.length);
    this.lanternTops.forEach((p, i) => glow.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    this.scene.add(glow);
    this.solid(parts);
  }

  // зелень посёлка: деревья вокруг, кусты у домов, цветы у дверей, поленницы
  villageGreen(V, put) {
    const { x: sx, z: sz } = this.L.settle, rng = makeRng(9090), W = this.W;
    const busy = (x, z, gap) => {
      for (const h of V.houses) if (Math.hypot(x - h.x, z - h.z) < gap + Math.max(h.w, h.d) * S * 0.75) return true;
      for (const [x2, z2] of V.stalls) if (Math.hypot(x - x2, z - z2) < gap + 2.5) return true;
      if (Math.abs(x - sx) < 7 && z > sz + 14) return true;                              // тропа к смотровой
      if (Math.hypot(x - V.fire[0], z - V.fire[1]) < gap + 7) return true;               // площадь у костра
      if (Math.hypot(x - V.windmill[0], z - V.windmill[1]) < gap + 5) return true;
      if (W.river && W.riverDist(x, z) < gap + 4) return true;                          // не в реке
      return Math.hypot(x, z) < W.pitR(Math.cos(Math.atan2(x, z)), Math.sin(Math.atan2(x, z)), 0) + 10;   // не у обрыва
    };
    const flat = (x, z) => { const y = this.H(x, z); return W.normal(x, y + 0.2, z, _v).y > 0.85 ? y : null; };
    // деревья по краю посёлка
    const trees = ['tree_oak', 'tree_default', 'tree_fat', 'tree_oak'];
    for (let i = 0, n = 0; i < 300 && n < 26; i++) {
      const a = rng() * TAU, r = 34 + rng() * 26, x = sx + Math.cos(a) * r, z = sz + 4 + Math.sin(a) * r;
      if (busy(x, z, 4)) continue;
      const y = flat(x, z);
      if (y === null) continue;
      const s = 4.6 + rng() * 1.8;
      put(trees[n % 4], { x, y: y - 0.2, z, ry: rng() * TAU, s });
      this.colliders.push({ cyl: true, x, z, y0: y - 1, y1: y + 4, r: 0.32 * s * 0.25 });
      n++;
    }
    // кусты и цветы у стен и дверей домов
    for (const h of V.houses) {
      const fx = Math.sin(h.face), fz = Math.cos(h.face), rx = fz, rz = -fx;        // «вперёд» (дверь) и «вбок»
      const hw = (h.w * S) / 2, hd = (h.d * S) / 2;
      for (const side of [-1, 1]) {
        const bx = h.x + rx * side * (hw + 1.4) + fx * (hd - 1), bz = h.z + rz * side * (hw + 1.4) + fz * (hd - 1);
        const by = this.H(bx, bz);
        put('plant_bushLarge', { x: bx, y: by, z: bz, ry: rng() * TAU, s: 2.6 + rng() * 0.8 });
        for (let k = 0; k < 7; k++) {
          const t = (k / 6 - 0.5) * (hw - 1.6) + side * (hw * 0.5), cx = h.x + rx * t + fx * (hd + 1.1), cz = h.z + rz * t + fz * (hd + 1.1);
          put(['flower_redA', 'flower_yellowA', 'flower_purpleA'][(k + (side > 0 ? 1 : 0)) % 3], { x: cx, y: this.H(cx, cz), z: cz, ry: rng() * TAU, s: 1.8 + rng() * 0.5 });
        }
      }
      // поленница у задней стены
      const wx = h.x - fx * (hd + 1.0) + rx * (hw * 0.4), wz = h.z - fz * (hd + 1.0) + rz * (hw * 0.4), wy = this.H(wx, wz);
      for (let k = 0; k < 3; k++) put('sv-resource-wood', { x: wx + rx * (k - 1) * 0.1, y: wy + k * 0.42, z: wz + rz * (k - 1) * 0.1, ry: h.face + Math.PI / 2 + (k % 2) * 0.1, s: 7 });
      this.box(wx, wy + 0.65, wz, 0.9, 0.65, 0.5, h.face);
    }
    // кусты и трава по посёлку (не на площади и не на тропе)
    for (let i = 0, n = 0; i < 300 && n < 34; i++) {
      const a = rng() * TAU, r = 14 + rng() * 34, x = sx + Math.cos(a) * r, z = sz + 4 + Math.sin(a) * r;
      if (busy(x, z, 1.5)) continue;
      const y = flat(x, z);
      if (y === null) continue;
      put(n % 3 ? 'grass_leafsLarge' : 'plant_bush', { x, y, z, ry: rng() * TAU, s: 2.2 + rng() * 1.2 });
      n++;
    }
    // сундук у Дома экспедиций
    const hall = V.houses.find((h) => h.hall);
    if (hall) {
      const cx = hall.x + 4.2, cz = hall.z + (hall.d * S) / 2 + 1.2, cy = this.H(cx, cz);
      put('sv-chest', { x: cx, y: cy, z: cz, ry: 0.2, s: 3 });
      this.box(cx, cy + 0.4, cz, 0.45, 0.4, 0.45, 0.2);
    }
  }

  // дом: каменный низ, деревянный верх, окна, дверь, угловые столбы, двускатная крыша
  house(h, put, parts) {
    const { w, d, floors } = h, rot = h.face, cr = Math.cos(rot), sr = Math.sin(rot);
    // земля под домом: берём самую низкую точку углов — фундамент уходит в землю
    let gy = 1e9;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
      const lx = (a * w * S) / 2, lz = (b * d * S) / 2;
      gy = Math.min(gy, this.H(h.x + lx * cr + lz * sr, h.z - lx * sr + lz * cr));
    }
    const base = gy + 0.5;
    const toW = (lx, ly, lz) => [h.x + lx * cr + lz * sr, ly, h.z - lx * sr + lz * cr];
    // фундамент
    const fnd = new THREE.BoxGeometry(w * S + 0.6, 2.6, d * S + 0.6);
    fnd.translate(0, -0.8, 0);
    parts.push({ geo: fnd, m: new THREE.Matrix4().makeRotationY(rot).setPosition(h.x, base, h.z), color: '#8f8a80' });
    // стены по периметру: модуль стены стоит у +x края своей клетки
    const sides = [[1, 0, 0], [0, 1, -Math.PI / 2], [-1, 0, Math.PI], [0, -1, Math.PI / 2]];   // восток, юг(перед), запад, север
    for (let f = 0; f < floors; f++) {
      const y = base + f * S, stone = f === 0;
      for (const [sx, sz, ang] of sides) {
        const n = sx !== 0 ? d : w;
        for (let k = 0; k < n; k++) {
          const off = k - (n - 1) / 2;
          const lx = sx !== 0 ? (sx * (w - 1) * S) / 2 : off * S;
          const lz = sz !== 0 ? (sz * (d - 1) * S) / 2 : off * S;
          const front = sz === 1, mid = Math.abs(off) < 0.6;
          let name = stone ? 'ft-wall' : 'ft-wall-wood';
          if (front && mid && f === 0) name = 'ft-wall-door';
          else if ((k + f) % 2 === 1 || (front && f === 1 && mid)) name = stone ? 'ft-wall-window-shutters' : 'ft-wall-wood-window-shutters';
          const [x, , z] = toW(lx, 0, lz);
          put(name, { x, y, z, ry: rot + ang, s: S });
        }
      }
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const [x, , z] = toW((a * w * S) / 2, 0, (b * d * S) / 2);
        put('ft-pillar-wood', { x, y, z, s: S * 1.2, sy: 1 / 1.2 });
      }
    }
    // крыша вдоль длинной стороны
    const top = base + floors * S, long = w >= d, span = (long ? d : w) * S + 1.2, len = (long ? w : d) * S + 1.4;
    const rise = span * 0.42, half = span / 2;
    const roof = new THREE.BufferGeometry();
    const v = [-len / 2, 0, -half, len / 2, 0, -half, len / 2, rise, 0, -len / 2, rise, 0, -len / 2, 0, half, len / 2, 0, half];
    roof.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    roof.setIndex([0, 3, 2, 0, 2, 1, 4, 5, 2, 4, 2, 3, 0, 2, 3, 0, 1, 2, 4, 3, 2, 4, 2, 5]);
    const roofColor = h.hall ? '#3f8f7a' : ['#c4473a', '#b85a3a', '#4f8f6a'][Math.round(h.x + h.z) % 3 < 0 ? 0 : Math.round(h.x + h.z) % 3];
    const rm = new THREE.Matrix4().makeRotationY(rot + (long ? 0 : Math.PI / 2)).setPosition(h.x, top, h.z);
    parts.push({ geo: roof.toNonIndexed(), m: rm, color: roofColor });
    // треугольники фронтонов
    const gab = new THREE.BufferGeometry();
    const hw = span / 2 - 0.6;
    gab.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -hw, 0, 0, hw, 0, rise - 0.3, 0], 3));
    for (const sgn of [-1, 1]) {
      const g = gab.clone();
      g.translate(sgn * (len / 2 - 0.7), 0, 0);
      if (sgn < 0) g.setIndex([0, 1, 2]); else g.setIndex([0, 2, 1]);
      parts.push({ geo: g.toNonIndexed(), m: rm.clone(), color: '#d9c7a4' });
    }
    if (h.hall) {
      const [bx, , bz] = toW(-S * 0.9, 0, (d * S) / 2 + 0.25);
      put('ft-banner-red', { x: bx, y: base + S * 1.2, z: bz, ry: rot - Math.PI / 2, s: S * 1.4 });
    }
    const [cx, , cz] = toW((w * S) / 4, 0, -(d * S) / 4);
    put('ft-chimney', { x: cx, y: top - 0.6, z: cz, ry: rot, s: S * 1.3 });
    // столкновение: весь дом — коробка
    this.box(h.x, base + (floors * S) / 2, h.z, (w * S) / 2 + 0.2, (floors * S) / 2 + 0.5, (d * S) / 2 + 0.2, rot);
  }

  // ——— смотровая площадка над пропастью ———
  lookout() {
    const { a, b } = this.L.lookout, y = 0.35;
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]), dir = Math.atan2(b[0] - a[0], b[2] - a[2]);
    const cx = (a[0] + b[0]) / 2, cz = (a[2] + b[2]) / 2, half = 3;
    const planks = [], posts = [], rails = [];
    for (let s = -len / 2 + 1; s < len / 2; s += 2) {
      for (const o of [-1.5, 0.5, 2.5]) {
        const x = cx + Math.sin(dir) * s + Math.cos(dir) * (o - 0.5), z = cz + Math.cos(dir) * s - Math.sin(dir) * (o - 0.5);
        planks.push({ x, y, z, ry: dir, s: 2 });
      }
    }
    // опоры уходят вниз к скале
    for (const s of [-len / 2 + 1, -len / 6, len / 6, len / 2 - 0.5]) for (const o of [-half + 0.3, half - 0.3]) {
      const x = cx + Math.sin(dir) * s + Math.cos(dir) * o, z = cz + Math.cos(dir) * s - Math.sin(dir) * o;
      posts.push({ x, y: y - 6, z, s: 1.3, sy: 6 / 1.3 });
    }
    // перила с трёх сторон
    for (let s = -len / 2 + 6; s < len / 2; s += 2) for (const o of [-half, half]) {
      const x = cx + Math.sin(dir) * s + Math.cos(dir) * o, z = cz + Math.cos(dir) * s - Math.sin(dir) * o;
      rails.push({ x, y, z, ry: dir + (o > 0 ? 0 : Math.PI) + Math.PI / 2, s: 2.2 });
    }
    for (const o of [-2, 0, 2]) {
      const x = b[0] + Math.cos(dir) * o, z = b[2] - Math.sin(dir) * o;
      rails.push({ x, y, z, ry: dir, s: 2.2 });
    }
    this.many('ft-planks', planks);
    this.many('ft-pillar-wood', posts);
    this.many('ft-fence', rails);
    // столкновения: настил (по нему ходят), перила (не дают упасть)
    this.box(cx, y - 0.2, cz, half, 0.25, len / 2, dir);
    for (const o of [-half - 0.1, half + 0.1]) this.box(cx + Math.cos(dir) * o, y + 0.5, cz - Math.sin(dir) * o, 0.12, 0.6, len / 2 - 2.5, dir);
    this.box(b[0] + Math.sin(dir) * 0.6, y + 0.5, b[2] + Math.cos(dir) * 0.6, half, 0.6, 0.12, dir);
  }

  // перила вдоль тропы вниз на террасу (с внешней стороны)
  pathRails() {
    const W = this.W, N = Math.PI, th0 = N - 0.10, span = 0.40, posts = [];
    for (let u = 0.04; u < 0.98; u += 0.025) {
      const th = th0 + span * u, y = -1.6 + (-22.5 + 1.6) * u;
      const R = W.pitR(Math.cos(th), Math.sin(th), y) - 4.6 * (0.35 + 0.65 * Math.min(1, u / 0.12, (1 - u) / 0.12)) + 0.5;
      const x = Math.sin(th) * R, z = Math.cos(th) * R, gy = this.groundAt(x, z, y + 3, 8);
      posts.push({ x, y: gy, z, ry: th + Math.PI / 2, s: 2.4 });
      this.box(x, gy + 0.5, z, 0.1, 0.55, 1.3, th);
    }
    this.many('ft-fence', posts);
  }

  // ——— лагерь у водопада на террасе (первая точка сохранения внизу) ———
  campForest() {
    const p = this.L.poolA, x = p.x - 14, z = p.z - 2, y = this.H(x, z, -10, 40);
    const tent = { x: x + 2, y, z: z - 3, ry: 0.4, s: 7 };
    this.many('sv-tent-canvas', [tent]);
    this.box(tent.x, y + 1.2, tent.z, 2, 1.3, 2, 0.4);
    this.many('campfire_stones', [{ x: x - 2, y, z: z + 1, s: 2.6 }]);
    this.many('campfire_logs', [{ x: x - 2, y, z: z + 1, s: 2.4, ry: 0.5 }]);
    this.many('sv-box-large', [{ x: x + 5, y, z: z + 2, ry: 1.1, s: 2.6 }]);
    this.many('sv-bedroll', [{ x: x - 4.5, y, z: z - 2, ry: 0.9, s: 3 }]);
    this.fires.push(new THREE.Vector3(x - 2, y, z + 1));
    this.camps.push({ pos: new THREE.Vector3(x, y, z), name: 'лагерь у водопада' });
  }

  // ——— Затерянный лагерь на западном плато ———
  campLost() {
    const c = this.L.campD.center, th = this.L.campD.th, rng = makeRng(99);
    const out = new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
    const tents = [], items = {};
    const add = (name, p) => (items[name] || (items[name] = [])).push(p);
    for (let i = 0; i < 4; i++) {
      const a = th + Math.PI + (i - 1.5) * 0.5, r = 9 + (i % 2) * 3;
      const x = c[0] + Math.sin(a) * r, z = c[2] + Math.cos(a) * r, y = this.H(x, z, -100, 40);
      add(i % 2 ? 'sv-tent-canvas-half' : 'sv-tent-canvas', { x, y, z, ry: a + Math.PI, s: 6.5 });
      this.box(x, y + 1.2, z, 1.9, 1.3, 1.9, a);
    }
    const y0 = this.H(c[0], c[2], -100, 40);
    add('sv-campfire-pit', { x: c[0], y: y0, z: c[2], s: 4 });
    for (let i = 0; i < 10; i++) {
      const a = rng() * TAU, r = 4 + rng() * 9, x = c[0] + Math.cos(a) * r, z = c[2] + Math.sin(a) * r, y = this.H(x, z, -100, 40);
      const name = ['sv-box', 'sv-box-open', 'sv-barrel', 'sv-barrel-open', 'sv-bedroll-packed', 'sv-bottle'][i % 6];
      add(name, { x, y, z, ry: rng() * TAU, s: 2.8 });
    }
    const sx = c[0] - out.x * 14, sz = c[2] - out.z * 14;
    add('sv-structure-canvas', { x: sx, y: this.H(sx, sz, -100, 40), z: sz, ry: th, s: 7 });
    const fx = c[0] + out.x * 6, fz = c[2] + out.z * 6;
    add('ft-banner-red', { x: fx, y: this.H(fx, fz, -100, 40), z: fz, ry: th, s: 4 });
    for (const [name, list] of Object.entries(items)) this.many(name, list);
    this.camps.push({ pos: new THREE.Vector3(c[0] + 4, y0, c[2] + 4), name: 'Затерянный лагерь' });
  }

  // ——— шахта: рельсы, крепь, лампы, вагонетки ———
  mine() {
    const rails = [], beams = [], posts = [], lamps = [];
    const paths = [this.L.mine, this.L.ramp];
    for (const path of paths) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], len = Math.hypot(b[0] - a[0], b[2] - a[2]), dir = Math.atan2(b[0] - a[0], b[2] - a[2]);
        const pitch = Math.atan2(b[1] - a[1], len);
        for (let d = 0.8; d < len; d += 1.6) {
          const t = d / len, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, y = a[1] + (b[1] - a[1]) * t;
          if (path === this.L.mine) rails.push({ x, y: y + 0.02, z, ry: dir, rx: -pitch, s: 1.6 });
        }
        for (let d = 3; d < len; d += 7) {
          const t = d / len, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, y = a[1] + (b[1] - a[1]) * t;
          const sx = Math.cos(dir) * 2.3, sz = -Math.sin(dir) * 2.3;
          posts.push({ x: x + sx, y, z: z + sz, s: 1.6, sy: 3.3 / 1.6 }, { x: x - sx, y, z: z - sz, s: 1.6, sy: 3.3 / 1.6 });
          beams.push({ x, y: y + 3.3, z, ry: dir + Math.PI / 2, s: 1.6, sx: 5 });
        }
      }
    }
    this.many('tr-track', rails);
    this.many('ft-pillar-wood', posts);
    const beamParts = beams.map((b) => {
      const g = new THREE.BoxGeometry(5.0, 0.28, 0.32);
      return { geo: g, m: new THREE.Matrix4().makeRotationY(b.ry).setPosition(b.x, b.y, b.z), color: '#6e4a2f' };
    });
    for (const p of this.L.mineLamps) lamps.push({ x: p[0], y: p[1] - 2.6, z: p[2], s: 1.8 });
    this.many('ft-lantern', lamps);
    const glow = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffcf80' }), lamps.length);
    lamps.forEach((l, i) => glow.setMatrixAt(i, new THREE.Matrix4().makeTranslation(l.x, l.y + 2.65, l.z)));
    this.scene.add(glow);
    for (const l of lamps) this.colliders.push({ cyl: true, x: l.x, z: l.z, y0: l.y, y1: l.y + 2.6, r: 0.2 });
    this.solid(beamParts);
    // у входа и в зале: вагонетки, ящики, кирки
    const e = this.L.mine[0], h = this.L.hall;
    const stuff = [['tr-train-carriage-dirt', this.L.mine[2], 1.4], ['sv-box-large', [e[0] + 2, e[1], e[2] - 2], 2.6], ['sv-barrel', [e[0] - 2.5, e[1], e[2] + 1], 2.6],
      ['sv-tool-pickaxe', [h.pos[0] + 3, h.floor, h.pos[2] + 2], 3], ['sv-workbench', [h.pos[0] - 5, h.floor, h.pos[2] - 3], 3], ['sv-box', [h.pos[0] - 6, h.floor, h.pos[2] + 2], 2.8]];
    for (const [name, p, s] of stuff) {
      const y = this.groundAt(p[0], p[2], p[1] + 2, 6);
      this.many(name, [{ x: p[0], y, z: p[2], ry: this.rng() * TAU, s }]);
      this.box(p[0], y + 0.6, p[2], 0.9, 0.7, 0.9, 0);
    }
  }

  // ——— проход на второй ярус: решётка и завал ———
  gate() {
    const g = this.L.gate, dx = g.outer[0] - g.inner[0], dz = g.outer[2] - g.inner[2], dir = Math.atan2(dx, dz);
    const x = g.inner[0] + dx * 0.32, z = g.inner[2] + dz * 0.32, y = g.inner[1];
    this.many('dg-gate-metal-bars', [{ x, y, z, ry: dir, s: 1.7 }]);
    this.box(x, y + 3, z, 3.8, 3.2, 0.5, dir);
    const rocks = [];
    for (let i = 0; i < 6; i++) rocks.push({ x: x + dx * 0.08 + (i - 2.5) * 1.2, y: y - 0.3, z: z + dz * 0.08 + ((i * 37) % 5) * 0.4, ry: i, s: 4 + (i % 3) });
    this.many('rock_largeC', rocks);
  }

  // ягоды съели — спрятать их на кусте
  takeBerries(b) {
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < 7; k++) this.berryMesh.setMatrixAt(b.idx + k, m);
    this.berryMesh.instanceMatrix.needsUpdate = true;
  }

  // мелочь: показывать только рядом с камерой; крутящиеся части
  update(time, cam) {
    WIND.value = time;
    for (const n of this.near) n.mesh.visible = Math.hypot(n.x - cam.x, n.z - cam.z) - n.r < n.max;
    if (this.lods) for (const l of this.lods) {
      const near = Math.hypot(l.x - cam.x, l.z - cam.z) - l.r < 110;
      l.near.visible = near; l.far.visible = !near;
    }
    for (const s of this.spin) s.obj.rotation[s.axis] = time * s.speed;
    if (this.findGlow) { this.findGlow.rotation.y = 0; this.findGlow.position.y = Math.sin(time * 2.2) * 0.12; }
  }
}

const _v = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
