// Настроение по глубине: цвет и густота дымки, сила неба и солнца, фонарик героя, мягкая подсветка
// стен изнутри шахты и один общий свет от ближайшего костра (или от кристалла на дне).
// Ламп мало нарочно: каждая лампа — работа видеокарте в каждой точке экрана (телефон греется).
import * as THREE from 'three';
import { layerMix } from '../world/abyss.js';
import { flicker } from './fire.js';

const lerp = (a, b, t) => a + (b - a) * t;

export class Atmosphere {
  constructor(gfx) {
    this.gfx = gfx;
    this.localLight = new THREE.PointLight('#ff8a3a', 0, 16, 1.6);
    this.fillLight = new THREE.PointLight('#ffffff', 1.3, 0, 0);
    gfx.scene.add(this.localLight, this.fillLight);
    this.glow = new THREE.Color();              // цвет светящихся пылинок
    this.fog = new THREE.Color();
    this.tmp = new THREE.Color();
  }

  // fires — костры (у каждого base), goalPos — кристалл на дне
  update(clock, player, fires, goalPos) {
    const { scene, hemi, sun } = this.gfx;
    const { localLight, fillLight, tmp } = this;
    const m = layerMix(player.pos.y), t = m.t;
    this.fog.set(m.a.fog).lerp(tmp.set(m.b.fog), t);
    scene.fog.color.copy(this.fog);
    scene.background.copy(this.fog);
    scene.fog.density = lerp(m.a.fogD, m.b.fogD, t);
    const light = lerp(m.a.light, m.b.light, t);
    hemi.intensity = 1.5 * light;
    sun.intensity = 2.7 * Math.pow(light, 1.5);
    player.lamp.intensity = Math.max(0, 1 - light) * 9;
    fillLight.color.set(m.a.fill).lerp(tmp.set(m.b.fill), t);
    fillLight.intensity = 1.2 + (1 - light) * 0.9;
    fillLight.position.set(0, player.pos.y + 8, 0);
    // ближайший костёр или кристалл на дне
    let best = null, bd = 40;
    for (const f of fires) { const d = f.base.distanceTo(player.pos); if (d < bd) { bd = d; best = f; } }
    const dg = goalPos.distanceTo(player.pos);
    if (dg < 60 && (!best || dg < bd)) {
      localLight.position.copy(goalPos);
      localLight.color.set('#b86bff'); localLight.distance = 45; localLight.decay = 1.4;
      localLight.intensity = 38 + Math.sin(clock * 1.7) * 6;
    } else if (best) {
      localLight.position.copy(best.base).y += 0.9;
      localLight.color.set('#ff8a3a'); localLight.distance = 16; localLight.decay = 1.6;
      localLight.intensity = flicker(clock);
    } else localLight.intensity = 0;
    this.glow.set(m.a.glow).lerp(tmp.set(m.b.glow), t);
    if (this.glow.r + this.glow.g + this.glow.b < 0.1) this.glow.set('#e8f0c8');
  }
}
