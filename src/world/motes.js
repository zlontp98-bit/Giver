// Светящиеся пылинки вокруг героя: глубже — ярче, цвет — как у яруса (споры, искорки кристаллов).
import * as THREE from 'three';

export class Motes {
  constructor(scene, count = 160, size = 36) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * size; pos[i * 3 + 1] = Math.random() * size; pos[i * 3 + 2] = Math.random() * size;
      seed[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.u = {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uSize: { value: size }, uScale: { value: 400 },
      uColor: { value: new THREE.Color('#ffffff') }, uAlpha: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aSeed; uniform float uTime, uSize, uScale; uniform vec3 uCenter; varying float vA;
        void main(){
          vec3 drift = vec3(sin(uTime * 0.3 + aSeed * 20.0) * 1.5, uTime * (0.25 + aSeed * 0.35), cos(uTime * 0.25 + aSeed * 13.0) * 1.5);
          vec3 p = mod(position + drift - uCenter + uSize * 0.5, uSize) - uSize * 0.5 + uCenter;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.07 + aSeed * 0.09) * uScale / -mv.z;
          vA = (0.5 + 0.5 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 40.0)) * smoothstep(uSize * 0.5, uSize * 0.3, length(p - uCenter));
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uColor * 1.6, smoothstep(0.5, 0.0, d) * vA * uAlpha); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(time, center, color, alpha, scale) {
    this.u.uTime.value = time;
    this.u.uCenter.value.copy(center);
    this.u.uColor.value.copy(color);
    this.u.uAlpha.value = alpha;
    this.u.uScale.value = scale;
    this.points.visible = alpha > 0.01;
  }
}
