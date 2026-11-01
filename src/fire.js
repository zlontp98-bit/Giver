// Костёр частицами: пламя, искры и дым. Плюс светлячки вокруг лагеря.
import * as THREE from 'three';

const vert = `
  attribute float aSeed;
  uniform float uTime, uScale, uLife, uRise, uSpread, uSize, uGrow;
  varying float vT; varying float vSeed;
  float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
  void main(){
    float t = fract(uTime / uLife + aSeed);
    vT = t; vSeed = aSeed;
    float a = h1(aSeed) * 6.2832, r = h1(aSeed + 1.7) * uSpread;
    vec3 p = position;
    p.x += cos(a) * r * (1.0 - t * 0.6) + sin(uTime * 3.0 + aSeed * 40.0) * 0.08 * t;
    p.z += sin(a) * r * (1.0 - t * 0.6) + cos(uTime * 2.3 + aSeed * 30.0) * 0.08 * t;
    p.y += t * uRise * (0.6 + 0.6 * h1(aSeed + 3.1));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = uSize * mix(1.0, uGrow, t) * (0.6 + 0.8 * h1(aSeed + 5.3));
    gl_PointSize = size * uScale / -mv.z;
  }`;

function points(count, base, material) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) { pos.set([base.x, base.y, base.z], i * 3); seed[i] = i / count + Math.random() * 0.01; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const p = new THREE.Points(g, material);
  p.frustumCulled = false;
  return p;
}

export class Campfire {
  constructor(scene, base) {
    this.uniforms = [];
    const mk = (opts, frag, blending) => {
      const u = {
        uTime: { value: 0 }, uScale: { value: 400 }, uLife: { value: opts.life }, uRise: { value: opts.rise },
        uSpread: { value: opts.spread }, uSize: { value: opts.size }, uGrow: { value: opts.grow },
      };
      this.uniforms.push(u);
      return new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending });
    };
    // пламя: жёлтое в середине → оранжевое → красное, тает к верху
    const flame = mk({ life: 0.85, rise: 1.3, spread: 0.3, size: 0.5, grow: 0.2 }, `
      varying float vT; varying float vSeed;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
        vec3 c = mix(vec3(2.2, 1.5, 0.5), vec3(2.0, 0.6, 0.1), smoothstep(0.0, 0.45, vT));
        c = mix(c, vec3(1.2, 0.18, 0.05), smoothstep(0.5, 1.0, vT));
        gl_FragColor = vec4(c, a * (1.0 - vT) * 0.75); }`, THREE.AdditiveBlending);
    // искры: маленькие, яркие, летят выше
    const sparks = mk({ life: 1.8, rise: 3.6, spread: 0.5, size: 0.09, grow: 0.5 }, `
      varying float vT; varying float vSeed;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.1, d);
        float blink = step(0.35, fract(vSeed * 91.0 + vT * 6.0));
        gl_FragColor = vec4(vec3(6.0, 3.0, 0.8), a * (1.0 - vT) * blink); }`, THREE.AdditiveBlending);
    // дым: серый, медленный, расплывается
    const smoke = mk({ life: 4.5, rise: 5.5, spread: 0.25, size: 0.9, grow: 4.0 }, `
      varying float vT;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.42, 0.4, 0.4), a * smoothstep(0.0, 0.15, vT) * (1.0 - vT) * 0.22); }`, THREE.NormalBlending);
    const b = base.clone(); b.y += 0.15;
    this.objs = [points(26, b.clone().add(new THREE.Vector3(0, 0.5, 0)), smoke), points(110, b, flame), points(40, b, sparks)];
    this.objs.forEach((o) => scene.add(o));
    // тёплый свет от огня (мерцает)
    this.light = new THREE.PointLight('#ff8a3a', 28, 16, 1.6);
    this.light.position.copy(base).add(new THREE.Vector3(0, 0.9, 0));
    scene.add(this.light);
  }
  update(time, scale) {
    for (const u of this.uniforms) { u.uTime.value = time; u.uScale.value = scale; }
    this.light.intensity = 26 + Math.sin(time * 13) * 3 + Math.sin(time * 7.3) * 4 + Math.sin(time * 23.0) * 2;
  }
  setVisible(v) { this.objs.forEach((o) => { o.visible = v; }); }
}

// Светлячки: медленно кружат в воздухе вокруг лагеря.
export class Fireflies {
  constructor(scene, center, count = 28, radius = 9) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * radius;
      pos.set([center.x + Math.cos(a) * r, center.y + 0.5 + Math.random() * 2.5, center.z + Math.sin(a) * r], i * 3);
      seed[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.u = { uTime: { value: 0 }, uScale: { value: 400 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aSeed; uniform float uTime, uScale; varying float vA;
        void main(){ vec3 p = position;
          p.x += sin(uTime * 0.6 + aSeed * 30.0) * 0.8; p.y += sin(uTime * 0.9 + aSeed * 17.0) * 0.4; p.z += cos(uTime * 0.5 + aSeed * 23.0) * 0.8;
          vA = 0.5 + 0.5 * sin(uTime * 2.5 + aSeed * 60.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = 0.12 * uScale / -mv.z; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vec3(2.4, 3.2, 0.9), smoothstep(0.5, 0.0, d) * vA); }`,
    });
    this.obj = new THREE.Points(g, m);
    this.obj.frustumCulled = false;
    scene.add(this.obj);
  }
  update(time, scale) { this.u.uTime.value = time; this.u.uScale.value = scale; }
}
