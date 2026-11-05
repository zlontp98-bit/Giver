// Вода и воздух разлома: ручей, водопады, слои тумана, облака между скалами, кристаллы, луч света из глубины.
import * as THREE from 'three';
import { STREAM, groundBase, rimR, thetaOf, C } from './terrain.js';
import { makeNoise2D } from '../../src/noise.js';
import { puffTexture, mistTexture } from './sky.js';

// полосы падающей воды — текстура (рисуется один раз)
function streakTexture() {
  const W = 64, H = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), n = makeNoise2D(3), img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W * 6.2832;
    const s = 0.5 + 0.5 * (n(Math.cos(u) * 3 + 10, Math.sin(u) * 3 + y / 90) * 0.6 + n(Math.cos(u) * 9, Math.sin(u) * 9 + y / 30) * 0.4);
    const v = Math.max(0, Math.min(1, (s - 0.25) * 1.8));
    const i = (y * W + x) * 4;
    img.data[i] = 200 + 55 * v; img.data[i + 1] = 225 + 30 * v; img.data[i + 2] = 255; img.data[i + 3] = (0.35 + 0.65 * v) * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Waters {
  constructor(scene, q) {
    this.scene = scene;
    this.anim = [];
    this.streak = streakTexture();
    this.puff = puffTexture();
    this.fallMat = new THREE.MeshBasicMaterial({ map: this.streak, transparent: true, depthWrite: false, vertexColors: true, side: THREE.DoubleSide });
    this.anim.push((t) => { this.streak.offset.y = t * 0.9; });
    this.buildStream();
  }

  // ручей по поселению: полоса воды по руслу
  buildStream() {
    const pts = STREAM.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(pts);
    const N = 90, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, p = curve.getPointAt(t), tg = curve.getTangentAt(t);
      const side = new THREE.Vector3(-tg.z, 0, tg.x).normalize();
      const w = 1.7 + 0.4 * Math.sin(t * 9);
      const y = groundBase(p.x, p.z) - 0.55;
      for (const s of [-1, 1]) { pos.push(p.x + side.x * w * s, y, p.z + side.z * w * s); uv.push(s * 0.5 + 0.5, t * 30); }
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const tex = this.streak.clone(); tex.needsUpdate = true; tex.repeat.set(1, 0.25);
    const m = new THREE.MeshLambertMaterial({ color: '#5fa2c4', map: tex, transparent: true, opacity: 0.88, emissive: '#1d4d6a' });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.anim.push((t) => { tex.offset.y = -t * 0.25; });
    // конец ручья → водопад с края
    const end = STREAM[STREAM.length - 1], th = thetaOf(end[0], end[1]), R = rimR(th);
    const top = new THREE.Vector3(C.x + Math.sin(th) * (R + 0.5), groundBase(end[0], end[1]) - 0.6, C.z + Math.cos(th) * (R + 0.5));
    const out = new THREE.Vector3(-Math.sin(th), 0, -Math.cos(th));
    this.waterfall(top, out, 3.4, 200, 7);
  }

  // водопад: изогнутая лента от края вниз, тает в тумане
  waterfall(top, out, width, height, widthEnd = width * 1.8) {
    const side = new THREE.Vector3(-out.z, 0, out.x);
    const R = 30, X = 3, pos = [], col = [], uv = [], idx = [];
    for (let k = 0; k <= R; k++) {
      const s = k / R, drop = height * s * s * 0.15 + height * s * 0.85;
      const reach = 1.2 + 6 * Math.sqrt(s) + height * 0.02 * s;
      const w = width + (widthEnd - width) * s;
      for (let i = 0; i <= X; i++) {
        const u = i / X - 0.5;
        const bow = (1 - 4 * u * u) * 0.5;      // середина чуть дальше от стены
        pos.push(top.x + out.x * (reach + bow) + side.x * u * w, top.y - drop, top.z + out.z * (reach + bow) + side.z * u * w);
        const a = Math.min(1, s * 12) * (1 - Math.pow(s, 1.5)) * (1 - Math.abs(u) * 0.5);
        col.push(1, 1, 1, Math.max(0, a));
        uv.push(i / X * (w / 8), -drop / 22);
      }
      if (k < R) for (let i = 0; i < X; i++) { const a = k * (X + 1) + i, b = a + X + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, this.fallMat);
    m.renderOrder = 2;
    this.scene.add(m);
    // брызги у верха и облако внизу
    this.sprite(top.clone().addScaledVector(out, 2.5).setY(top.y - 2), width * 2.4, 0.35, '#eef6ff');
    this.sprite(top.clone().addScaledVector(out, 8).setY(top.y - height * 0.55), width * 7, 0.55, '#dfe8ff');
    return m;
  }

  sprite(p, size, opacity, color = '#ffffff') {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puff, color, transparent: true, opacity, depthWrite: false, fog: true }));
    s.position.copy(p); s.scale.set(size, size * 0.7, 1);
    this.scene.add(s);
    return s;
  }

  // слои тумана внутри разлома и облака между скалами
  mist(layers, puffs) {
    const tex = mistTexture();
    const geo = new THREE.PlaneGeometry(520, 680, 20, 26).rotateX(-Math.PI / 2);   // туман считается в вершинах — нужна сетка
    const L = [{ y: -96, o: 0.3, rep: 3.2, sp: 0.004 }, { y: -150, o: 0.42, rep: 2.2, sp: -0.003 }, { y: -205, o: 0.7, rep: 1.6, sp: 0.002 }].slice(0, layers);
    L.forEach((l) => {
      const t = tex.clone(); t.needsUpdate = true; t.repeat.set(l.rep, l.rep * 1.3);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, color: '#dde4ff', transparent: true, opacity: l.o, depthWrite: false }));
      m.position.set(C.x, l.y, C.z);
      m.renderOrder = 1;
      this.scene.add(m);
      this.anim.push((time) => { t.offset.set(time * l.sp, time * l.sp * 0.6); });
    });
    // облака-клочья между скалами (дальние больше)
    const rnd = makeNoise2D(41);
    for (let i = 0; i < puffs; i++) {
      const a = i * 2.399, r = 30 + (i * 37) % 160;
      const x = C.x + Math.sin(a) * r * 0.62, z = C.z + 40 + Math.cos(a) * r * 0.95;
      const y = -45 - ((i * 53) % 80);
      const s = this.sprite(new THREE.Vector3(x, y, z), 40 + ((i * 29) % 50), 0.5 + 0.15 * rnd(i, 1), '#e6ebff');
      const x0 = x, ph = i * 1.7;
      this.anim.push((t) => { s.position.x = x0 + Math.sin(t * 0.03 + ph) * 6; });
    }
  }

  update(t) { for (const f of this.anim) f(t); }
}

// светящиеся кристаллы (редкие): кучки вытянутых восьмигранников, одним вызовом рисования
export function crystals(scene, spots) {
  const geo = new THREE.OctahedronGeometry(1, 0);
  geo.scale(0.35, 1.6, 0.35); geo.translate(0, 1.0, 0);
  const mat = new THREE.MeshLambertMaterial({ color: '#b48cff', emissive: '#7a3cff', emissiveIntensity: 1.1 });
  const list = [];
  spots.forEach((p, si) => {
    const n = p.n || 6;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4 + si, r = i === 0 ? 0 : 0.5 + (i % 3) * 0.45;
      list.push({ x: p.x + Math.sin(a) * r, y: p.y - 0.2, z: p.z + Math.cos(a) * r, s: (p.s || 1) * (i === 0 ? 1.5 : 0.6 + ((i * 7) % 5) * 0.12), tilt: i === 0 ? 0 : 0.45, a });
    }
  });
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  list.forEach((c, i) => {
    e.set(Math.cos(c.a) * c.tilt, c.a, Math.sin(c.a) * c.tilt);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(c.x, c.y, c.z), q, new THREE.Vector3(c.s, c.s, c.s));
    im.setMatrixAt(i, m);
  });
  scene.add(im);
  return { mesh: im, mat };
}

// луч фиолетового света из глубины (без настоящей лампы — просто светящийся прозрачный столб)
export function beam(scene, x, z) {
  const g = new THREE.CylinderGeometry(2.2, 5, 520, 16, 1, true);
  g.translate(0, 260 - 330, 0);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform float uTime; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float edge = pow(abs(dot(vN, vV)), 1.5);
        float fade = smoothstep(-330.0, -150.0, vY) * (1.0 - smoothstep(-40.0, 190.0, vY));
        float pulse = 0.8 + 0.2 * sin(uTime * 1.3 + vY * 0.03);
        gl_FragColor = vec4(vec3(0.62, 0.34, 1.0) * edge * fade * pulse * 0.9, 1.0); }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, 0, z);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return m;
}
