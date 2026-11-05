// Убранство «разлома» (демоверсия): то, что даёт масштаб и настроение, но не тяжело для телефона.
//   • корни — свисают с края и из-под полок, огибают скалу (трубки с сужением, один меш на всё);
//   • верёвочный мост с полки на ближний останец (по нему можно пройти — коробки-столкновения на досках);
//   • дальние водопады — струи из трещин на разной высоте, тают в тумане;
//   • пласты тумана на разной глубине (сквозь просветы видны силуэты ниже) — медленно плывут;
//   • косые лучи солнца в пустоте (мягкие, складываются со светом).
// Всё — несколько мешей и простые шейдеры; живых источников света нет.
import * as THREE from 'three';

const TAU = Math.PI * 2;

export class RiftDecor {
  constructor(scene, L, W, physics, waterMat, ribbon, sunDir) {
    this.scene = scene; this.L = L; this.W = W; this.P = physics;
    this.u = { uTime: { value: 0 } };
    this.colliders = [];
    let seed = 4711;
    this.rnd = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 0) % 1000003) / 1000003; };
    this.roots();
    this.bridge();
    this.falls(waterMat, ribbon);
    this.fogLayers();
    this.shafts(sunDir);
  }

  R(th, y) { return this.W.pitR(Math.cos(th), Math.sin(th), y); }

  // ——— корни ———
  // Корень: из скалы у края вниз по стене, чуть отходя от неё, с изгибами; сужается к концу.
  roots() {
    const W = this.W, N = Math.PI, rnd = this.rnd;
    const pos = [], col = [], idx = [];
    const n = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b = new THREE.Vector3();
    const tube = (pts, r0, r1, c0, c1) => {
      const base = pos.length / 3, SEG = 6;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
        const t = new THREE.Vector3().subVectors(q, o).normalize();
        a.copy(Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).cross(t).normalize();
        b.copy(t).cross(a).normalize();
        const u = i / (pts.length - 1), r = r0 + (r1 - r0) * u;
        for (let k = 0; k < SEG; k++) {
          const ang = (k / SEG) * TAU, cx = Math.cos(ang), cy = Math.sin(ang);
          pos.push(p.x + (a.x * cx + b.x * cy) * r, p.y + (a.y * cx + b.y * cy) * r, p.z + (a.z * cx + b.z * cy) * r);
          const sh = 0.75 + 0.25 * cy;                 // сверху светлее (свет неба), снизу темнее
          col.push(c0[0] * sh + (c1[0] - c0[0]) * u, c0[1] * sh + (c1[1] - c0[1]) * u, c0[2] * sh + (c1[2] - c0[2]) * u);
        }
        if (i) for (let k = 0; k < SEG; k++) {
          const i0 = base + (i - 1) * SEG + k, i1 = base + (i - 1) * SEG + ((k + 1) % SEG), j0 = i0 + SEG, j1 = i1 + SEG;
          idx.push(i0, j0, i1, i1, j0, j1);
        }
      }
    };
    // путь корня по стене: шаг вниз, держим расстояние от скалы off (метров), изгибы — шумом
    const drape = (th, y0, len, off, wob) => {
      const pts = [];
      let th1 = th, y = y0;
      for (let s = 0; s <= len; s += 1.6) {
        const R0 = this.R(th1, y);
        let p = new THREE.Vector3(Math.sin(th1) * R0, y, Math.cos(th1) * R0);
        // к воздуху: по нормали формулы мира, пока не будет off от скалы
        for (let k = 0; k < 8; k++) {
          const f = W.f(p.x, p.y, p.z);
          if (Math.abs(f - off) < 0.15) break;
          W.normal(p.x, p.y, p.z, n);
          p.addScaledVector(n, (off - f) * 0.8);
        }
        pts.push(p);
        y -= 1.6;
        th1 += wob * Math.sin(s * 0.21 + th * 9) * 0.004;
        if (y < -95) break;
      }
      return pts;
    };
    const bark = [0.27, 0.19, 0.13], tip = [0.2, 0.26, 0.2];
    // большие корни у посёлка (под смотровой и по сторонам) — видно сразу у края
    for (let i = 0; i < 14; i++) {
      const th = N + (rnd() - 0.5) * 1.6, r0 = 0.35 + rnd() * 0.6;
      const pts = drape(th, -1.5 - rnd() * 3, 14 + rnd() * 30, r0 * 0.9, 1);
      if (pts.length > 3) tube(pts, r0, r0 * 0.15, bark, tip);
    }
    // тонкие корни-плети по всему краю
    for (let i = 0; i < 70; i++) {
      const th = rnd() * TAU, r0 = 0.08 + rnd() * 0.16;
      const pts = drape(th, -1 - rnd() * 4, 6 + rnd() * 22, 0.25 + r0, 2.5);
      if (pts.length > 3) tube(pts, r0, 0.03, bark, tip);
    }
    // из-под полок второй и третьей ступени (уходят в туман)
    for (let k = 0; k < 2; k++) for (let i = 0; i < 18; i++) {
      const th = rnd() * TAU, bk = this.W.bench(th, k);
      if (bk.d < 5) continue;
      const r0 = 0.15 + rnd() * 0.35;
      const pts = drape(th, bk.y - 2.5, 10 + rnd() * 26, 0.4 + r0, 1.5);
      if (pts.length > 3) tube(pts, r0, 0.05, bark, tip);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.castShadow = false; m.receiveShadow = true;
    this.scene.add(m);
    this.rootMesh = m;
  }

  // ——— верёвочный мост: с первой полки на ближний останец ———
  bridge() {
    const L = this.L, W = this.W;
    const B = L.demo && L.demo.bridge;
    if (!B) return;
    const a = new THREE.Vector3(...B.a), b = new THREE.Vector3(...B.b);
    const d = new THREE.Vector3().subVectors(b, a), len = Math.hypot(d.x, d.z), dir = Math.atan2(d.x, d.z);
    const side = new THREE.Vector3(Math.cos(dir), 0, -Math.sin(dir));
    const nPl = Math.round(len / 0.55), plank = new THREE.BoxGeometry(1.7, 0.1, 0.42);
    const deckY = (u) => a.y + (b.y - a.y) * u - B.sag * 4 * u * (1 - u);
    const wood = new THREE.MeshLambertMaterial({ color: '#7a5a3c' });
    const planks = new THREE.InstancedMesh(plank, wood, nPl);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < nPl; i++) {
      const u = (i + 0.5) / nPl, y = deckY(u);
      const slope = (deckY(Math.min(1, u + 0.01)) - deckY(Math.max(0, u - 0.01))) / (0.02 * len);
      q.setFromEuler(e.set(-Math.atan(slope), dir, (this.rnd() - 0.5) * 0.06, 'YXZ'));
      m4.compose(new THREE.Vector3(a.x + d.x * u, y, a.z + d.z * u), q, new THREE.Vector3(1, 1, 0.85 + this.rnd() * 0.3));
      planks.setMatrixAt(i, m4);
    }
    planks.castShadow = true; planks.receiveShadow = true;
    this.scene.add(planks);
    // верёвки-перила и столбики на концах
    const ropeM = new THREE.MeshLambertMaterial({ color: '#a58a62' });
    for (const s of [-0.95, 0.95]) {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const u = i / 24, y = deckY(u) + 1.0 - 0.25 * Math.sin(u * Math.PI);
        pts.push(new THREE.Vector3(a.x + d.x * u + side.x * s, y, a.z + d.z * u + side.z * s));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.035, 5, false), ropeM);
      this.scene.add(tube);
      for (const u of [0, 1]) {
        const p = new THREE.Vector3(a.x + d.x * u + side.x * s, deckY(u), a.z + d.z * u + side.z * s);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.5, 6), wood);
        post.position.set(p.x, p.y + 0.55, p.z);
        this.scene.add(post);
      }
    }
    // столкновения: короткие отрезки настила (по ним идёшь), края — невысокие стенки (не свалиться)
    const SEG = 10;
    for (let i = 0; i < SEG; i++) {
      const u = (i + 0.5) / SEG, y = deckY(u);
      const c = new THREE.Vector3(a.x + d.x * u, y - 0.1, a.z + d.z * u);
      const col = { box: true, c, hx: 0.85, hy: 0.1, hz: len / SEG / 2 + 0.05, rot: dir, cos: Math.cos(dir), sin: Math.sin(dir) };
      this.colliders.push(col);
      for (const s of [-1, 1]) {
        const cs = c.clone().addScaledVector(side, s * 1.0); cs.y = y + 0.5;
        this.colliders.push({ box: true, c: cs, hx: 0.06, hy: 0.5, hz: len / SEG / 2 + 0.05, rot: dir, cos: Math.cos(dir), sin: Math.sin(dir) });
      }
    }
  }

  // ——— дальние водопады: из трещин на разной высоте, вниз — в туман ———
  falls(waterMat, ribbon) {
    if (!waterMat || !ribbon) return;
    const W = this.W, N = Math.PI;
    for (const [th, y0, w] of [[0.15, -6, 4.5], [-0.75, -22, 3.2], [0.95, -14, 3.8], [-1.6, -3, 5.5], [2.25, -30, 2.8]]) {
      if (Math.abs(Math.atan2(Math.sin(th - N), Math.cos(th - N))) < 0.9) continue;     // не у посёлка
      const R0 = this.R(th, y0), out = [-Math.sin(th), 0, -Math.cos(th)];
      const top = [Math.sin(th) * (R0 - 0.4), y0, Math.cos(th) * (R0 - 0.4)];
      const pts = [];
      for (let i = 0; i <= 30; i++) {
        const t = i / 30, drop = t * t * 140 + t * 10;
        let r = R0 - 0.4 - Math.min(6, t * 30);
        const y = y0 - drop;
        r = Math.min(r, this.R(th, y) - 1.2);                   // не уходит в скалу
        pts.push([Math.sin(th) * r, y, Math.cos(th) * r]);
      }
      const mesh = new THREE.Mesh(
        ribbon(pts, (t) => w + t * w * 1.4, () => [-out[2], 0, out[0]], (t) => 1 - Math.pow(Math.min(1, t * 1.1), 1.4)),
        waterMat({ fall: true, color: '#7fc8dc', alpha: 0.75, speed: 1.1 }));
      this.scene.add(mesh);
    }
  }

  // ——— пласты тумана на глубине: сквозь просветы видны силуэты ниже ———
  fogLayers() {
    const mat = (y, col, a, scale) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: this.u.uTime, uCol: { value: new THREE.Color(col) }, uA: { value: a }, uY: { value: y }, uS: { value: scale } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uTime, uA, uY, uS; uniform vec3 uCol; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
        void main(){
          vec2 p = vW.xz * uS + vec2(uTime * 0.012, uTime * 0.007);
          float c = n(p) * 0.6 + n(p * 2.3 + 5.0) * 0.3 + n(p * 5.1 + 9.0) * 0.1;
          float a = smoothstep(0.32, 0.78, c) * uA;
          // у камеры тоньше (не стена тумана перед глазами), у стен — гуще
          float dCam = length(cameraPosition - vW);
          a *= smoothstep(6.0, 40.0, dCam);
          gl_FragColor = vec4(uCol, a);
          #include <colorspace_fragment>
        }`,
    });
    this.layers = [];
    for (const [y, col, a, s] of [[-46, '#9fb6c4', 0.55, 0.018], [-72, '#6f8ea4', 0.7, 0.014], [-110, '#41637d', 0.85, 0.011]]) {
      const g = new THREE.CircleGeometry(300, 48);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat(y, col, a, s));
      m.position.y = y;
      m.renderOrder = 4;
      this.scene.add(m);
      this.layers.push(m);
    }
  }

  // ——— косые лучи солнца: длинные мягкие полосы вдоль направления солнца, складываются со светом ———
  shafts(sunDir) {
    const W = this.W, rnd = this.rnd;
    const s = sunDir.clone().normalize();
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uTime: this.u.uTime, uCol: { value: new THREE.Color('#ffd9a0') } },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uTime; uniform vec3 uCol; varying vec2 vUv; varying vec3 vW;
        void main(){
          float across = sin(vUv.x * 3.14159);
          float along = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
          float flick = 0.8 + 0.2 * sin(uTime * 0.4 + vW.x * 0.05);
          float near = smoothstep(8.0, 45.0, length(cameraPosition - vW));
          gl_FragColor = vec4(uCol * across * across * along * flick * near * 0.16, 1.0);
        }`,
    });
    // луч: широкая полоса от точки у края (высоко) вниз по направлению света (−sunDir), повёрнута к центру
    const make = (top, len, w) => {
      const dirDown = s.clone().negate();
      const g = new THREE.PlaneGeometry(w, len, 1, 1);
      g.translate(0, -len / 2, 0);
      const m = new THREE.Mesh(g, mat);
      m.position.copy(top);
      // ось Y полосы — вдоль луча, плоскость — лицом примерно к центру разлома
      const yAxis = dirDown.clone().negate();
      const toC = new THREE.Vector3(-top.x, 0, -top.z).normalize();
      const xAxis = new THREE.Vector3().crossVectors(yAxis, toC).normalize();
      const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      m.renderOrder = 5;
      m.frustumCulled = false;
      this.scene.add(m);
    };
    // начала лучей — на западном краю (откуда светит солнце), через пустоту на восток
    for (let i = 0; i < 6; i++) {
      const th = -Math.PI / 2 + (rnd() - 0.5) * 1.6, R0 = this.R(th, 0);
      const top = new THREE.Vector3(Math.sin(th) * (R0 - 6), -2 - rnd() * 6, Math.cos(th) * (R0 - 6));
      make(top, 160 + rnd() * 80, 9 + rnd() * 14);
    }
  }

  update(time) { this.u.uTime.value = time; }
}
