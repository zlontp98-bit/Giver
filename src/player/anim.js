// Как выглядит герой: модель, фонарик, верёвка, тень и анимация по состоянию (идёт, лезет, висит, летит).
// Методы подмешиваются в Player (см. player.js) — this здесь всегда герой.
import * as THREE from 'three';
import { makeHero } from './hero.js';
import { HANG } from './tuning.js';

export class AnimMethods {
  // герой, фонарик, верёвка с крюком и кружок тени под ногами
  initVisuals(scene) {
    this.hero = makeHero();
    // герой не отбрасывает «настоящую» тень (тени обновляются не каждый кадр) — под ним свой кружок
    this.hero.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    scene.add(this.hero.root);
    // фонарик на шапке: чем глубже, тем ярче
    this.lamp = new THREE.PointLight('#ffd29a', 0, 16, 1.4);
    this.lamp.position.set(0, 1.75, 0.3);
    this.hero.root.add(this.lamp);
    // верёвка и крюк
    const rg = new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1, true);
    rg.translate(0, 0.5, 0);
    rg.rotateX(Math.PI / 2);
    this.ropeMesh = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: '#c98a4b' }));
    this.ropeMesh.visible = false;
    this.hookHead = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 8), new THREE.MeshLambertMaterial({ color: '#3d434c' }));
    this.hookHead.visible = false;
    scene.add(this.ropeMesh, this.hookHead);
    const sg = new THREE.CircleGeometry(0.42, 16);
    sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false }));
    scene.add(this.shadow);
  }

  // ——— картинка ———
  animate(dt) {
    const H = this.hero, p = this.pos;
    H.root.position.copy(p);
    H.root.rotation.y = this.facing;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.squash = Math.max(0, this.squash - dt * 4);
    const sq = this.squash * 0.18;
    H.body.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
    const f = Math.min(1, dt * 14);
    const pose = (o, x, z) => { o.rotation.x += (x - o.rotation.x) * f; o.rotation.z += (z - o.rotation.z) * f; };
    const st = this.state === 'mantle' ? this.mantle.then : this.state;
    if (st === 'ground' && this.state !== 'mantle') {
      this.walkPhase += dt * hs * 2.3;
      const amp = Math.min(1, hs / 3) * (hs > 5.5 ? 1.0 : 0.75);
      const s = Math.sin(this.walkPhase) * amp;
      pose(H.legL, s, 0); pose(H.legR, -s, 0);
      pose(H.armL, -s * 0.9, -0.35); pose(H.armR, s * 0.9, 0.35);
      H.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.06 * amp + Math.sin(this.time * 2) * 0.01;
      H.body.rotation.x = Math.min(0.25, hs * 0.03);
    } else if (st === 'climb') {
      // руки по очереди тянутся вверх, ноги упираются
      const s = Math.sin(this.climbPhase);
      pose(H.armL, -2.5 - s * 0.45, -0.35); pose(H.armR, -2.5 + s * 0.45, 0.35);
      pose(H.legL, -0.5 + s * 0.4, 0.15); pose(H.legR, -0.5 - s * 0.4, -0.15);
      H.body.rotation.x = -0.12; H.body.position.y = 0;
    } else if (st === 'rope' || st === 'zip') {
      const sw = Math.sin(this.time * 3) * 0.2;
      pose(H.armR, -2.95, 0.15); pose(H.armL, -2.95, -0.15);
      pose(H.legL, 0.25 + sw, 0.1); pose(H.legR, -0.15 - sw, -0.1);
      H.body.rotation.x = st === 'zip' ? 0.15 : 0; H.body.position.y = 0;
    } else if (this.state === 'mantle') {
      pose(H.armL, -2.4, -0.2); pose(H.armR, -2.4, 0.2);
      pose(H.legL, -0.9, 0); pose(H.legR, 0.2, 0);
    } else {
      const up = this.vel.y > 0;
      pose(H.armL, up ? -2.6 : -1.3, -0.6); pose(H.armR, up ? -2.6 : -1.3, 0.6);
      pose(H.legL, up ? -0.7 : 0.3, 0.1); pose(H.legR, up ? 0.2 : -0.3, -0.1);
      H.body.rotation.x = 0; H.body.position.y = 0;
    }
    H.head.rotation.z = Math.sin(this.time * 1.3) * 0.04;
    // верёвка: от рук до кольца (крюк летит или зацеплен)
    const hand = _c.copy(p).setY(p.y + (this.rope || this.zip ? HANG : 1.5));
    let end = null;
    if (this.rope) end = this.rope.anchor.pos;
    else if (this.hook) end = _d.copy(hand).lerp(this.hook.anchor.pos, Math.min(1, this.hook.t / this.hook.dur));
    if (end) {
      this.ropeMesh.visible = true;
      this.ropeMesh.position.copy(hand);
      this.ropeMesh.lookAt(end);
      this.ropeMesh.scale.set(1, 1, Math.max(0.01, hand.distanceTo(end)));
      this.hookHead.visible = true;
      this.hookHead.position.copy(end);
    } else { this.ropeMesh.visible = false; this.hookHead.visible = false; }
    // кружок тени под ногами
    const sup = this.state === 'ground' ? { y: p.y } : this.supportAt(_q.copy(p).setY(p.y + 0.05), 0.1);
    if (sup && p.y - sup.y < 12) {
      const hgt = Math.max(0, p.y - sup.y);
      this.shadow.visible = true;
      this.shadow.position.set(p.x, sup.y + 0.04, p.z);
      this.shadow.scale.setScalar(Math.max(0.35, 1 - hgt * 0.05));
      this.shadow.material.opacity = Math.max(0.08, 0.26 - hgt * 0.01);
    } else this.shadow.visible = false;
  }
}

const _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Vector3();
