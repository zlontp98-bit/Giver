// Камера третьего лица: смотрит на героя и не заглядывает сквозь скалу (world.solid). На стене,
// верёвке и тросе сама заходит за спину — если игрок не крутит её пальцем.
// yaw/pitch/dist открыты: их крутит палец, а бот и «Замер» ставят напрямую.
import * as THREE from 'three';

export class FollowCamera {
  constructor(camera, world, start) {
    this.camera = camera;
    this.world = world;                         // нужен world.solid(x, y, z)
    this.yaw = Math.atan2(start.x, start.z);
    this.pitch = 0.3;
    this.dist = 7.5;
    this.target = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
  }

  // палец по правой половине экрана (или мышь)
  look(inp) {
    this.yaw -= inp.camDX * 0.006;
    this.pitch = Math.max(-0.55, Math.min(1.25, this.pitch + inp.camDY * 0.005));
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
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    let dist = this.dist;
    // не заглядывать сквозь скалу
    for (let i = 1; i <= 14; i++) {
      const d = (this.dist * i) / 14;
      if (this.world.solid(target.x + Math.sin(this.yaw) * cp * d, target.y + sp * d, target.z + Math.cos(this.yaw) * cp * d)) { dist = Math.max(1.1, d - 0.7); break; }
    }
    this.camPos.set(target.x + Math.sin(this.yaw) * cp * dist, target.y + sp * dist, target.z + Math.cos(this.yaw) * cp * dist);
    this.camera.position.lerp(this.camPos, Math.min(1, dt * 10));
    this.camera.lookAt(target);
  }
}
