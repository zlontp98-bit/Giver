// Существо первого яруса — скальник: плоский каменный ползун на шести ногах, живёт на дне у своего логова.
// Простой ИИ (состояния):
//   idle   — бродит у логова;
//   alert  — заметил героя (близко, на одной высоте, ничто не загораживает): замирает и шипит (успей понять);
//   chase  — бежит за героем: быстрее шага (5.2 м/с), медленнее бега (7) — убегай бегом;
//   attack — рядом: бросок, −18 здоровья и отбрасывает; потом передышка;
//   return — потерял интерес (далеко, ушёл от логова, герой на стене/в воде/высоко) — домой, какое-то время
//            не замечает. По скалам и в воду не лезет: спасение — залезть на стену, уйти в озеро или убежать.
// Это сущность kind: 'creature' (позиция и состояние — данные; вид — модель с ногами). Не сохраняется: после
// перезапуска снова у логова.
import * as THREE from 'three';

const SEE = 15, LOSE = 26, SPEED = { idle: 1.3, chase: 5.2, return: 2.6 }, BITE = 18, REACH = 1.6;

export class Creature {
  constructor(scene, physics, home, leash, events) {
    this.P = physics; this.ev = events;
    this.home = new THREE.Vector3(...home);
    this.leash = leash;
    this.e = { id: 'creature:rockling', kind: 'creature', pos: this.home.clone(), state: 'idle', yaw: 0 };
    this.target = this.home.clone();
    this.timer = 0; this.cool = 0; this.calm = 0; this.unreach = 0; this.walk = 0;
    this.model = buildModel();
    scene.add(this.model.root);
    this.sync();
  }

  get pos() { return this.e.pos; }
  get state() { return this.e.state; }
  set state(s) { if (this.e.state !== s) { this.e.state = s; this.timer = 0; } }

  // вернуть домой (после гибели героя, при перезапуске)
  reset() { this.e.pos.copy(this.home); this.state = 'idle'; this.calm = 3; this.sync(); }

  canSee(hero) {
    if (hero.dead || this.calm > 0) return false;
    const p = this.e.pos, h = hero.pos, d = Math.hypot(h.x - p.x, h.z - p.z);
    if (d > SEE || Math.abs(h.y - p.y) > 4) return false;
    if (hero.state !== 'ground' || hero.inWater) return false;
    return this.P.clearLine(_a.set(p.x, p.y + 0.8, p.z), _b.set(h.x, h.y + 1, h.z), 0.3);
  }

  update(dt, hero) {
    const p = this.e.pos, h = hero.pos;
    const far = p.distanceTo(h);
    if (far > 140) return;                                      // далеко — спит (не тратим время)
    this.timer += dt; this.cool = Math.max(0, this.cool - dt); this.calm = Math.max(0, this.calm - dt);
    const fromHome = Math.hypot(p.x - this.home.x, p.z - this.home.z);
    const reachable = hero.state === 'ground' && !hero.inWater && Math.abs(h.y - p.y) < 2.5 && !hero.dead;
    let speed = 0;
    switch (this.e.state) {
      case 'idle':
        if (this.timer > 4 + (this.e.pos.x * 7.3 % 3 + 3) % 3 || p.distanceTo(this.target) < 0.8) {
          this.timer = 0;
          const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 10;
          this.target.set(this.home.x + Math.cos(a) * r, p.y, this.home.z + Math.sin(a) * r);
        }
        speed = SPEED.idle;
        if (this.canSee(hero)) { this.state = 'alert'; this.ev.alert(); }
        break;
      case 'alert':
        this.target.copy(h);
        if (this.timer > 0.8) this.state = 'chase';
        break;
      case 'chase':
        this.target.copy(h);
        speed = SPEED.chase;
        this.unreach = reachable ? 0 : this.unreach + dt;
        if (far > LOSE || fromHome > this.leash || this.unreach > 2.5 || hero.dead) { this.state = 'return'; this.calm = 6; this.ev.lost(); break; }
        if (far < REACH && reachable && this.cool <= 0) this.state = 'attack';
        break;
      case 'attack':
        this.target.copy(h);
        speed = this.timer < 0.25 ? 6 : 0;                      // бросок
        if (this.timer > 0.25 && this.cool <= 0) {
          this.cool = 1.4;
          if (far < REACH + 0.4 && reachable) this.ev.bite(BITE, _a.subVectors(h, p).setY(0).normalize());
        }
        if (this.timer > 0.7) this.state = 'chase';
        break;
      case 'return':
        this.target.copy(this.home);
        speed = SPEED.return;
        if (fromHome < 2) this.state = 'idle';
        break;
    }
    if (speed > 0) this.move(dt, speed);
    this.walk += dt * (speed > 0 ? 2 + speed * 1.6 : 0);
    this.sync(dt);
  }

  // шаг к цели по земле: в воду, на стену и в обрыв не идёт
  move(dt, speed) {
    const p = this.e.pos, dx = this.target.x - p.x, dz = this.target.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const want = Math.atan2(dx, dz);
    let dy = want - this.e.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.e.yaw += Math.max(-1, Math.min(1, dy)) * Math.min(1, dt * 7);
    const step = Math.min(d, speed * dt);
    const nx = p.x + Math.sin(this.e.yaw) * step, nz = p.z + Math.cos(this.e.yaw) * step;
    if (this.P.waterAt(nx, nz)) return;
    const g = this.P.ground(nx, p.y + 1, nz, 1.2, 2.5);
    if (!g || g.box || g.ny < 0.6 || g.y - p.y > 0.9) return;
    p.set(nx, g.y, nz);
  }

  sync() {
    const M = this.model, e = this.e, chase = e.state === 'chase' || e.state === 'attack';
    M.root.position.copy(e.pos);
    M.root.rotation.y = e.yaw;
    M.body.position.y = 0.42 + Math.sin(this.walk * 2) * 0.03 + (e.state === 'alert' ? 0.12 : 0);
    M.body.rotation.x = chase ? 0.12 : e.state === 'alert' ? -0.25 : 0;
    M.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.walk + (i % 2 ? Math.PI : 0) + i * 0.4) * 0.5; });
    M.eyes.color.setHex(chase || e.state === 'alert' ? 0xff5a2a : 0xffa04a);
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

function buildModel() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const stone = new THREE.MeshLambertMaterial({ color: 0x6a6e78, emissive: 0x1a1c22 }), plate = new THREE.MeshLambertMaterial({ color: 0x9aa0aa, emissive: 0x23262c });
  const eyes = new THREE.MeshBasicMaterial({ color: 0xffa04a });
  const add = (g, m, x, y, z, s = [1, 1, 1], par = body) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.scale.set(...s); o.castShadow = true; par.add(o); return o; };
  add(new THREE.DodecahedronGeometry(0.55, 0), stone, 0, 0, 0, [1.05, 0.5, 1.5]);
  for (let i = 0; i < 4; i++) add(new THREE.DodecahedronGeometry(0.3, 0), plate, 0, 0.22, -0.55 + i * 0.36, [1.3 - i * 0.12, 0.45, 0.7]);
  add(new THREE.DodecahedronGeometry(0.3, 0), stone, 0, 0.02, 0.78, [1.1, 0.7, 0.9]);
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.085, 6, 4), eyes, s * 0.15, 0.1, 1.0);
  const legs = [];
  const legGeo = new THREE.BoxGeometry(0.07, 0.48, 0.07).translate(0, -0.24, 0);
  for (let i = 0; i < 6; i++) {
    const s = i % 2 ? 1 : -1, z = -0.45 + Math.floor(i / 2) * 0.45;
    const hip = new THREE.Group();
    hip.position.set(s * 0.45, 0.42, z);
    hip.rotation.z = s * 0.7;
    root.add(hip);
    add(legGeo, stone, 0, 0, 0, [1, 1, 1], hip);
    legs.push(hip);
  }
  return { root, body, legs, eyes };
}
