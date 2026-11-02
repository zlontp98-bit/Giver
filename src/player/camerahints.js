// Подсказки камере от героя: на стене, верёвке и тросе камера сама заходит за спину.
// Методы подмешиваются в Player (см. player.js).

export class CameraHintMethods {
  // куда смотреть камере (null — пусть крутит игрок)
  cameraYaw() {
    if (this.state === 'climb' || this.state === 'rope' || (this.state === 'mantle' && this.mantle.then !== 'ground')) {
      const p = this.state === 'mantle' ? this.mantle.to : this.pos;
      return Math.atan2(p.x, p.z) + Math.PI;
    }
    if (this.state === 'zip' && this.zip) return Math.atan2(-this.zip.z.dir.x, -this.zip.z.dir.z);
    return null;
  }
  cameraPitch() {
    if (this.state === 'climb') return 0.5;
    if (this.state === 'rope') return 0.65;
    if (this.state === 'zip') return 0.3;
    return null;
  }
}
