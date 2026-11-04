// Густая трава вокруг героя: тысячи простых травинок (по 1 треугольнику, без прозрачности — дёшево для
// телефона), качаются на ветру, у корня темнее, к кончику светлее; пятна тёплой/прохладной травы — по тому же
// шуму, что и земля (world/terrain.js), чтобы трава и земля совпадали по цвету.
// Плитки 8×8 м в квадрате вокруг героя; ушёл — дальние плитки переезжают вперёд (опора — луч по формуле мира).
import * as THREE from 'three';
import { WIND } from './props.js';

const TILE = 8, R = 3;                          // плиток по 3 в каждую сторону: квадрат 56×56 м
const R_LOW = 2;                                // на «Низкой» — по 2 (40×40 м)
const PER_TILE = { low: 240, medium: 460, high: 680 };

export class GrassField {
  // skip: [{ x, z, r }] — где травы нет (утоптанная площадь посёлка)
  constructor(scene, physics, W, sunDir, skip = []) {
    this.P = physics; this.W = W; this.sun = sunDir; this.skip = skip;
    this.tiles = new Map();
    this.pool = [];
    this.per = PER_TILE.medium;
    this.r = R;
    this.group = new THREE.Group();
    scene.add(this.group);
    // травинка: узкий треугольник высотой 1 (масштаб — в экземпляре), y = 0 у корня
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.035, 0, 0, 0.035, 0, 0, 0.0, 1, 0.08], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0.2, 0, 1, 0.2, 0, 1, 0.4], 3));
    this.geo = g;
    // свой простой шейдер: цвет (пятна, корень/кончик, свет места, солнце) считается в вершине,
    // пиксель только выводит цвет + дымку — травинок много, они мелкие, так дешевле всего
    this.mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uWindTime: WIND, uSun: { value: 1 } }]),
      vertexShader: `uniform float uWindTime, uSun; varying vec3 vCol;
        float gvHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gvNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(gvHash(i), gvHash(i + vec2(1.0, 0.0)), u.x), mix(gvHash(i + vec2(0.0, 1.0)), gvHash(i + vec2(1.0, 1.0)), u.x), u.y); }
        #include <fog_pars_vertex>
        void main(){
          vec3 transformed = position;
          vec3 ip = instanceMatrix[3].xyz;
          float ph = uWindTime * 2.1 + ip.x * 0.31 + ip.z * 0.23;
          float gust = 0.55 + 0.45 * sin(uWindTime * 0.7 + ip.x * 0.05);
          transformed.x += sin(ph) * position.y * position.y * 0.22 * gust;
          transformed.z += cos(ph * 0.8) * position.y * position.y * 0.12 * gust;
          float big = gvNoise(ip.xz * 0.03 + 7.0), mid = gvNoise(ip.xz * 0.4);
          vec3 c = mix(vec3(0.50, 0.63, 0.22), vec3(0.30, 0.54, 0.32), smoothstep(0.3, 0.7, big)) * (0.9 + 0.2 * mid);
          vec3 sc = c * mix(0.72, 1.06, position.y) * instanceColor * uSun;    // цвет как на экране (sRGB)
          vCol = sc * sc;                                                         // → линейный (≈ гамма 2)
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `varying vec3 vCol;
        #include <common>
        #include <fog_pars_fragment>
        void main(){
          gl_FragColor = vec4(vCol, 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
  }

  setQuality(q) {
    const n = PER_TILE[q] || PER_TILE.medium;
    this.r = q === 'low' ? R_LOW : R;
    if (n === this.per) return;
    this.per = n;
    for (const t of this.tiles.values()) this.release(t);
    this.tiles.clear();
  }

  release(t) { t.mesh.visible = false; this.pool.push(t); }

  // заполнить плитку (tx, tz): травинки на пологой земле (не на скале, не в воде, не под водой)
  fill(tx, tz) {
    let t = this.pool.pop();
    if (!t || t.n !== this.per) {
      if (t) { this.group.remove(t.mesh); t.mesh.dispose(); }
      const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.per);
      mesh.frustumCulled = true;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.per * 3), 3);
      this.group.add(mesh);
      t = { mesh, n: this.per };
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    let seed = (tx * 73856093) ^ (tz * 19349663);
    const rnd = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 0) % 100000) / 100000; };
    let k = 0, minY = 1e9, maxY = -1e9;
    // опора — по сетке 2 м (луч по формуле мира), между узлами — ближайший узел
    const grid = [];
    for (let gx = 0; gx <= 4; gx++) for (let gz = 0; gz <= 4; gz++) {
      const x = tx * TILE + gx * 2, z = tz * TILE + gz * 2;
      const g = this.P.ground(x, 60, z, 0, 400);
      if (!(g && g.ny > 0.78 && !g.box && !g.water && !this.P.waterAt(x, z))) { grid.push(null); continue; }
      // тень от скал: луч к солнцу (как запечённый свет земли)
      const sh = this.sun ? this.W.raycast(x, g.y + 0.6, z, this.sun.x, this.sun.y, this.sun.z, 140) : -1;
      grid.push({ y: g.y, lit: sh < 0 ? 1 : 0.58 });
    }
    for (let i = 0; i < this.per; i++) {
      const u = rnd(), v = rnd(), x = tx * TILE + u * TILE, z = tz * TILE + v * TILE;
      const gn = grid[Math.round(u * 4) * 5 + Math.round(v * 4)];
      if (gn === null || this.skip.some((q) => Math.hypot(x - q.x, z - q.z) < q.r)) continue;
      const gy = gn.y;
      const h = 0.35 + rnd() * 0.45;
      p.set(x, gy - 0.03, z);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      s.set(0.8 + rnd() * 0.6, h, 1);
      m.compose(p, q, s);
      t.mesh.setMatrixAt(k, m);
      const lit = gn.lit * (1.0 + rnd() * 0.2);
      t.mesh.setColorAt(k, c.setRGB(lit, lit, lit));
      k++;
      minY = Math.min(minY, gy); maxY = Math.max(maxY, gy);
    }
    t.mesh.count = k;
    t.mesh.instanceMatrix.needsUpdate = true;
    if (t.mesh.instanceColor) t.mesh.instanceColor.needsUpdate = true;
    t.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(tx * TILE + TILE / 2, (minY + maxY) / 2 || 0, tz * TILE + TILE / 2), TILE * 0.75 + (maxY - minY) / 2 + 1);
    t.mesh.visible = k > 0;
    return t;
  }

  // каждый кадр: держать плитки вокруг точки (героя); новые — не больше 2 за кадр (без рывков)
  update(pos) {
    const cx = Math.floor(pos.x / TILE), cz = Math.floor(pos.z / TILE);
    for (const [key, t] of this.tiles) {
      if (Math.abs(t.tx - cx) > this.r || Math.abs(t.tz - cz) > this.r) { this.release(t); this.tiles.delete(key); }
    }
    let built = 0;
    for (let d = 0; d <= this.r && built < 2; d++) for (let ix = -d; ix <= d && built < 2; ix++) for (let iz = -d; iz <= d && built < 2; iz++) {
      if (Math.max(Math.abs(ix), Math.abs(iz)) !== d) continue;
      const tx = cx + ix, tz = cz + iz, key = tx * 100000 + tz;
      if (this.tiles.has(key)) continue;
      const t = this.fill(tx, tz);
      t.tx = tx; t.tz = tz;
      this.tiles.set(key, t);
      built++;
    }
  }
}
