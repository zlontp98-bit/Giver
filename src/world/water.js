// Вода: река наверху, водопад с края в заводь на террасе, ручей, второй высокий водопад в озеро на дне,
// брызги и туман у подножия водопадов. Всё — простые ленты и диски со своим шейдером (течение рисуется
// в шейдере, телефону это дёшево). Купание и мягкое падение в воду — позже.
import * as THREE from 'three';

const U = { time: { value: 0 } };

function waterMat({ fall = false, color = '#2f8fb0', foam = '#e8fbff', alpha = 0.82, speed = 1 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: U.time, uCol: { value: new THREE.Color(color) }, uFoam: { value: new THREE.Color(foam) }, uAlpha: { value: alpha }, uSpeed: { value: speed },
    }]),
    vertexShader: `varying vec2 vUv; varying float vFade;
      attribute float aFade;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vFade = aFade; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime, uAlpha, uSpeed; uniform vec3 uCol, uFoam; varying vec2 vUv; varying float vFade;
      #include <common>
      #include <fog_pars_fragment>
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
      void main(){
        ${fall
          ? `float s = n(vec2(vUv.x * 9.0, vUv.y * 0.6 - uTime * 2.6 * uSpeed)) * 0.6 + n(vec2(vUv.x * 23.0, vUv.y * 1.4 - uTime * 3.4 * uSpeed)) * 0.4;
             vec3 col = mix(uCol, uFoam, smoothstep(0.35, 0.8, s) * 0.85 + 0.15);
             float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
             float a = uAlpha * edge * (0.55 + 0.45 * s) * vFade;`
          : `vec2 p = vec2(vUv.x * 4.0, vUv.y * 1.2 - uTime * 0.9 * uSpeed);
             float s = n(p * 2.0) * 0.6 + n(p * 5.0 + 7.0) * 0.4;
             vec3 col = mix(uCol, uFoam, smoothstep(0.62, 0.85, s) * 0.6);
             float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
             float a = uAlpha * (0.6 + 0.4 * edge) * vFade;`}
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// лента вдоль ломаной: pts — [x, y, z], width — ширина (число или функция от доли пути), side — направление «вбок»
function ribbon(pts, width, sideFn, fadeFn = () => 1) {
  const pos = [], uv = [], fade = [], idx = [];
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    const t = i / (pts.length - 1), w = typeof width === 'function' ? width(t) : width;
    const [sx, sy, sz] = sideFn(i);
    for (const k of [-0.5, 0.5]) {
      pos.push(pts[i][0] + sx * w * k, pts[i][1] + sy * w * k, pts[i][2] + sz * w * k);
      uv.push(k + 0.5, len / 6);
      fade.push(fadeFn(t));
    }
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
  g.setIndex(idx);
  return g;
}

function disc(rx, rz, seg = 40) {
  const g = new THREE.CircleGeometry(1, seg);
  g.rotateX(-Math.PI / 2);
  g.scale(rx, 1, rz);
  const n = g.attributes.position.count;
  g.setAttribute('aFade', new THREE.Float32BufferAttribute(new Array(n).fill(1), 1));
  // uv: по кругу — чтобы рябь шла
  return g;
}

// брызги и туман у водопада
function mist(center, radius, height, count, color = '#eaf6ff') {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
    pos.set([center.x + Math.cos(a) * r, center.y + Math.random() * height, center.z + Math.sin(a) * r], i * 3);
    seed[i] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: U.time, uCol: { value: new THREE.Color(color) }, uScale: { value: 400 } }]),
    vertexShader: `attribute float aSeed; uniform float uTime, uScale; varying float vA;
      #include <fog_pars_vertex>
      void main(){ vec3 p = position; float t = fract(uTime * (0.18 + aSeed * 0.2) + aSeed);
        p.y += t * 7.0; p.x += sin(uTime * 0.7 + aSeed * 30.0) * 2.0 * t; p.z += cos(uTime * 0.6 + aSeed * 20.0) * 2.0 * t;
        vA = sin(t * 3.14159) * 0.55;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = (2.4 + aSeed * 3.0) * uScale / -mvPosition.z;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform vec3 uCol; varying float vA;
      #include <common>
      #include <fog_pars_fragment>
      void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uCol, smoothstep(0.5, 0.0, d) * vA);
        #include <fog_fragment>
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.userData.mist = m;
  return p;
}

export class Water {
  constructor(scene, L, W) {
    this.scene = scene; this.mists = [];
    const up = [0, 1, 0];
    // ——— река наверху ———
    const R = L.river.pts, rpts = [];
    for (let i = 0; i < R.length; i++) {
      const [x, z] = R[i];
      const y = i < R.length - 1 ? W.terrainH(x, z) + 1.0 : rpts[i - 1][1] - 0.4;
      rpts.push([x, y, z]);
    }
    const flowSide = (pts) => (i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
      return [dz / l, 0, -dx / l];
    };
    scene.add(new THREE.Mesh(ribbon(rpts, 9.5, flowSide(rpts)), waterMat({ color: '#3a8fb0', alpha: 0.85 })));
    // ——— водопад с края в заводь ———
    const top = rpts[rpts.length - 1], prev = rpts[rpts.length - 2];
    const dir = [top[0] - prev[0], 0, top[2] - prev[2]], dl = Math.hypot(dir[0], dir[2]);
    dir[0] /= dl; dir[2] /= dl;
    const pool = L.poolA, poolY = -22.2;
    const fall1 = this.fall(top, dir, poolY, 2.8, 8);
    scene.add(new THREE.Mesh(ribbon(fall1, (t) => 8.5 - t * 1.5, () => [dir[2], 0, -dir[0]]), waterMat({ fall: true, color: '#9fd6ea', alpha: 0.92 })));
    scene.add(new THREE.Mesh(disc(8, 7), waterMat({ color: '#2f86a8', alpha: 0.86, speed: 0.4 })).translateX(pool.x).translateY(poolY).translateZ(pool.z));
    this.addMist(new THREE.Vector3(fall1[fall1.length - 1][0], poolY, fall1[fall1.length - 1][2]), 6, 2, 70);
    // ——— ручей по террасе ———
    const spts = L.streamA.map((p) => [p[0], p[1] - 0.45, p[2]]);
    // где ручей срывается с края террасы: идём вдоль последнего отрезка, пока под водой есть скала
    const a = spts[spts.length - 2], b = spts[spts.length - 1];
    const sd = [b[0] - a[0], 0, b[2] - a[2]], sl = Math.hypot(sd[0], sd[2]);
    sd[0] /= sl; sd[2] /= sl;
    let edge = [...a];
    for (let k = 0; k < 80; k++) {
      const x = a[0] + sd[0] * k * 0.5, z = a[2] + sd[2] * k * 0.5;
      if (W.f(x, a[1] - 3, z) > 0.5) { edge = [x, Math.min(a[1], b[1]), z]; break; }
    }
    const streamPts = [...spts.slice(0, -1), edge];
    scene.add(new THREE.Mesh(ribbon(streamPts, 5, flowSide(streamPts)), waterMat({ color: '#3a96b4', alpha: 0.85, speed: 1.4 })));
    // ——— второй водопад: с края террасы в озеро на дне ———
    const fall2 = this.fall(edge, sd, L.lake.y, 3.2, 26);
    scene.add(new THREE.Mesh(ribbon(fall2, (t) => 5.5 + t * 6, () => [sd[2], 0, -sd[0]], (t) => 1 - 0.45 * t), waterMat({ fall: true, color: '#a9dcef', alpha: 0.85, speed: 1.3 })));
    const last = fall2[fall2.length - 1];
    this.addMist(new THREE.Vector3(last[0], L.lake.y, last[2]), 14, 6, 140);
    // ——— озеро на дне — светится изнутри ———
    const lake = new THREE.Mesh(disc(L.lake.rx - 2.5, L.lake.rz - 2.5, 48), waterMat({ color: '#2aa6b8', foam: '#b9fbff', alpha: 0.9, speed: 0.25 }));
    lake.position.set(L.lake.x, L.lake.y, L.lake.z);
    scene.add(lake);
    this.lakeY = L.lake.y;
    this.fallTops = [top, edge];
  }

  // путь падающей воды: сначала по дуге вперёд, потом почти отвесно
  fall(top, dir, bottomY, speed, steps) {
    const pts = [], g = 9.8, H = top[1] - bottomY, T = Math.sqrt((2 * H) / g);
    for (let i = 0; i <= steps; i++) {
      const t = (T * i) / steps, drop = 0.5 * g * t * t;
      pts.push([top[0] + dir[0] * speed * t, top[1] - drop, top[2] + dir[2] * speed * t]);
    }
    return pts;
  }

  addMist(c, r, h, n) {
    const m = mist(c, r, h, n);
    this.scene.add(m);
    this.mists.push(m);
  }

  update(time, pixelScale) {
    U.time.value = time;
    for (const m of this.mists) m.userData.mist.uniforms.uScale.value = pixelScale;
  }
}
