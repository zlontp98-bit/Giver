// Настроение по глубине: цвет и густота дымки, сила неба и солнца, фонарик героя и один общий свет
// от ближайшего костра. В шахте и пещерах — темно и тепло, светят лампы (их свет запечён в скалу).
// Ламп мало нарочно: каждая живая лампа — работа видеокарте в каждой точке экрана.
import * as THREE from 'three';
import { flicker } from './fire.js';

// полосы по высоте: выше — светлее и прозрачнее, глубже — гуще дымка
const BANDS = [
  { y: 10, fog: '#d7e6ee', fogD: 0.0013, light: 1.0, glow: '#eef6d0' },
  { y: -25, fog: '#c6dbe4', fogD: 0.0018, light: 0.97, glow: '#dff3b8' },
  { y: -85, fog: '#aec3cb', fogD: 0.0033, light: 0.86, glow: '#c4ecff' },
  { y: -145, fog: '#8aa3b4', fogD: 0.0046, light: 0.74, glow: '#86ecff' },
  { y: -210, fog: '#68869c', fogD: 0.006, light: 0.62, glow: '#7affd9' },
].map((b) => ({ ...b, fogC: new THREE.Color(b.fog), glowC: new THREE.Color(b.glow) }));
const CAVE = { fog: new THREE.Color('#1d1915'), fogD: 0.016, light: 0.3 };
const lerp = (a, b, t) => a + (b - a) * t;

export class Atmosphere {
  constructor(gfx) {
    this.gfx = gfx;
    this.localLight = new THREE.PointLight('#ff8a3a', 0, 16, 1.6);
    gfx.scene.add(this.localLight);
    this.glow = new THREE.Color();              // цвет светящихся пылинок
    this.fog = new THREE.Color();
    this.cave = 0;                              // 0 — снаружи, 1 — глубоко в скале
  }

  // inCave — герой внутри скалы (шахта, пещера); fires — костры (Vector3)
  update(dt, clock, player, fires, inCave) {
    const { scene, hemi, sun } = this.gfx, y = player.pos.y;
    let i = 0;
    while (i < BANDS.length - 2 && y < BANDS[i + 1].y) i++;
    const a = BANDS[i], b = BANDS[i + 1], t = Math.min(1, Math.max(0, (a.y - y) / (a.y - b.y)));
    this.cave += ((inCave ? 1 : 0) - this.cave) * Math.min(1, dt * 1.5);
    const k = this.cave;
    this.fog.copy(a.fogC).lerp(b.fogC, t).lerp(CAVE.fog, k);
    scene.fog.color.copy(this.fog);
    scene.background.copy(this.fog);
    scene.fog.density = lerp(lerp(a.fogD, b.fogD, t), CAVE.fogD, k);
    // дальше, чем дымка закрывает почти всё (98.5%), не рисуем: в шахте это ~130 м, на дне ~350 м
    const far = Math.min(1300, 2.1 / scene.fog.density);
    const cam = this.gfx.camera;
    if (Math.abs(cam.far - far) > 2) { cam.far = far; cam.updateProjectionMatrix(); }
    const light = lerp(lerp(a.light, b.light, t), CAVE.light, k);
    hemi.intensity = 1.05 * light;
    sun.intensity = 2.9 * Math.pow(light, 1.2);
    // фонарик на шапке: чем темнее, тем ярче; в шахте слабее — там свои лампы, пусть между ними будет темно
    player.lamp.intensity = Math.max(0, 0.95 - light) * 7 * (1 - 0.45 * k);
    this.glow.copy(a.glowC).lerp(b.glowC, t);
    // ближайший костёр
    let best = null, bd = 40;
    for (const f of fires) { const d = f.distanceTo(player.pos); if (d < bd) { bd = d; best = f; } }
    if (best) {
      this.localLight.position.copy(best).y += 1.0;
      this.localLight.intensity = flicker(clock);
    } else this.localLight.intensity = 0;
  }
}
