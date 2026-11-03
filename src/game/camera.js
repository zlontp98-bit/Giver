// Камера третьего лица: смотрит на героя и никогда не заходит в скалу. На стене, верёвке и тросе сама
// заходит за спину — если игрок не крутит её пальцем. yaw/pitch/dist открыты: их крутит палец, а бот
// и «Замер» ставят напрямую.
//
// Почему так строго: если камера оказывается внутри камня, видна «изнанка» мира — экран на миг чернеет.
// Поэтому: (1) от героя к камере идём лучом по «формуле мира» и держим 0.45 м до скалы; (2) если плавное
// движение камеры прошло бы сквозь камень — ставим её сразу на безопасное место; (3) герой перенёсся
// (лагерь, «Продолжить») — камера переносится вместе с ним, а не летит через скалы.
import * as THREE from 'three';

const CLEAR = 0.45;          // сколько держать до скалы, м

export class FollowCamera {
  // world: { dist(x, y, z) — расстояние до скалы (SDF), normal(x, y, z, out) — от скалы наружу,
  //         solid(x, y, z, pad) — скала или постройка }
  constructor(camera, world, start) {
    this.camera = camera;
    this.world = world;
    this.yaw = Math.atan2(start.x, start.z);
    this.pitch = 0.3;
    this.dist = 7.5;
    this.target = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.lastTarget = null;
    this._d = new THREE.Vector3();
    this._q = new THREE.Vector3();
    this._n = new THREE.Vector3();
  }

  // палец по правой половине экрана (или мышь)
  look(inp) {
    this.yaw -= inp.camDX * 0.006;
    this.pitch = Math.max(-0.55, Math.min(1.25, this.pitch + inp.camDY * 0.005));
  }

  // сколько можно отойти от точки p по направлению d (не дальше max), не подходя к скале ближе CLEAR
  freeDistance(p, d, max) {
    const W = this.world;
    let t = 0.15;
    while (t < max) {
      const x = p.x + d.x * t, y = p.y + d.y * t, z = p.z + d.z * t;
      const f = W.dist(x, y, z);
      if (f < CLEAR || W.solid(x, y, z, 0.3)) return Math.max(0.15, t - 0.2);
      t += Math.min(1.0, Math.max(0.12, f - CLEAR));
    }
    return max;
  }

  // точка камеры в воздухе и между ней и героем нет камня
  safe(target, c) {
    const W = this.world;
    if (W.dist(c.x, c.y, c.z) < CLEAR * 0.6) return false;
    for (let i = 1; i <= 6; i++) {
      const u = i / 7, q = this._q.lerpVectors(target, c, u);
      if (W.dist(q.x, q.y, q.z) < 0.08) return false;
    }
    return true;
  }

  // auto — можно ли камере самой поворачиваться (во время игры, а не на паузе)
  update(dt, inp, player, auto) {
    const wantYaw = player.cameraYaw(), wantPitch = player.cameraPitch();
    if (!inp.looking && auto) {
      if (wantYaw !== null) {
        const d = Math.atan2(Math.sin(wantYaw - this.yaw), Math.cos(wantYaw - this.yaw));
        this.yaw += d * Math.min(1, dt * 2.2);
      }
      if (wantPitch !== null) this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 1.5);
    }
    const target = this.target.copy(player.pos);
    target.y += 1.5;
    // голова у самой скалы (лезем под нависанием, узкий ход) — точку, вокруг которой ходит камера, отодвигаем
    // от камня, иначе камера окажется в нём
    for (let i = 0; i < 3; i++) {
      const f0 = this.world.dist(target.x, target.y, target.z);
      if (f0 >= CLEAR) break;
      const n = this.world.normal(target.x, target.y, target.z, this._n);
      target.addScaledVector(n, CLEAR - f0 + 0.02);
    }
    // герой перенёсся (лагерь, «Продолжить», «Замер») — камера сразу за ним
    const jumped = !this.lastTarget || this.lastTarget.distanceTo(target) > 6;
    if (!this.lastTarget) this.lastTarget = new THREE.Vector3();
    this.lastTarget.copy(target);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const d = this._d.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    const dist = this.freeDistance(target, d, this.dist);
    this.camPos.copy(target).addScaledVector(d, dist);
    const cam = this.camera.position;
    if (jumped) cam.copy(this.camPos);
    else {
      cam.lerp(this.camPos, Math.min(1, dt * 10));
      if (!this.safe(target, cam)) cam.copy(this.camPos);     // плавно — только по воздуху
    }
    this.camera.lookAt(target);
  }
}
