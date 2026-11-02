// Подсказки камере от героя: на стене, верёвке и тросе камера сама заходит за спину.
// Методы подмешиваются в Player (см. player.js).

export class CameraHintMethods {
  // куда смотреть камере (null — пусть крутит игрок)
  cameraYaw() {
    // на стене — за спину, со стороны пропасти (по нормали скалы)
    if (this.state === 'climb' && this.climb) return Math.atan2(this.climb.n.x, this.climb.n.z);
    if (this.state === 'mantle' && this.mantle.then === 'climb' && this.climb) return Math.atan2(this.climb.n.x, this.climb.n.z);
    if (this.state === 'rope') return this.facing + Math.PI;
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
