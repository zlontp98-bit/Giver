// Маршрут к вершине. Гора — уступы и стены; руками по стенам не залезть, каждую стену проходим по-своему:
//   hook   — кольцо на краю стены: стреляешь крюком, тебя подтягивает наверх
//   stairs — доски на стене (одна ездит): прыжки снизу вверх
//   bounce — гриб-батут: прыгнул — подбросило на следующий уступ
//   lift   — платформа сама возит вверх-вниз
// Между стенами — прогулка по уступу за звёздочками. Плюс лагеря (точки сохранения) и подсказки.
import * as THREE from 'three';
import { makeRng } from './noise.js';
import { MOUNT } from './terrain.js';
import { place, instance } from './models.js';

const PATTERN = ['hook', 'stairs', 'hook', 'bounce', 'hook', 'lift', 'stairs', 'hook', 'bounce', 'hook', 'lift', 'hook', 'stairs', 'hook'];
const ZIG = [0, 0.1, -0.06, 0.12, -0.1, 0.08, -0.12, 0.1, -0.08, 0.12, -0.1, 0.06, -0.12, 0.1];
export const PLAYER_R = 0.35, PLAYER_H = 1.75;

export class Course {
  constructor(terrain, start, seed) {
    this.t = terrain;
    this.start = start.clone();
    this.rng = makeRng(seed + 1234);
    this.boxes = [];     // твёрдые доски/платформы: {c, hx, hy, hz, psi, cos, sin, kind, dp, mesh}
    this.movers = [];    // движущиеся (доски, лифты)
    this.anchors = [];   // кольца для крюка: {pos, landing, mesh, glow}
    this.stars = [];     // {pos, mesh, taken}
    this.camps = [];     // {pos, index, reached}
    this.hints = [];     // {pos, r, text, shown}
    this.route = [];     // шаги для бота-проверяльщика
    this.crossings = []; // найденные стены
    this.center = new THREE.Vector3(MOUNT.x, 0, MOUNT.z);
    this.theta0 = Math.atan2(start.x - MOUNT.x, start.z - MOUNT.z);
    this.flattenSummit();
    // 1-й проход: найти стены и места лагерей, выровнять под лагеря; 2-й — уже по выровненной горе
    const plan = this.plan();
    this.campSpots = this.pickCamps(plan);
    for (const c of this.campSpots) terrain.flatten(c, 2.6, 4.8);
    this.crossings = this.plan();
  }

  // площадка у флага: вершина — ровная, чтобы на неё можно было зайти
  flattenSummit() {
    const t = this.t, s = t.summit;
    let sum = 0, n = 0;
    for (let a = 0; a < 16; a++) for (const r of [1, 2.5, 4]) {
      const x = s.x + Math.cos(a / 16 * Math.PI * 2) * r, z = s.z + Math.sin(a / 16 * Math.PI * 2) * r;
      sum += t.heightAt(x, z); n++;
    }
    const y = sum / n;
    t.flatten(new THREE.Vector3(s.x, y, s.z), 4.5, 8);
    s.y = t.heightAt(s.x, s.z);
  }

  // ——— геометрия (полярные координаты от центра горы) ———
  at(theta, r) {
    const s = this.center;
    const x = s.x + Math.sin(theta) * r, z = s.z + Math.cos(theta) * r;
    return new THREE.Vector3(x, this.t.heightAt(x, z), z);
  }
  out(theta) { return new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta)); }      // от горы наружу
  side(theta) { return new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta)); }    // вдоль уступа
  ny(p) { return this.t.normalAt(p.x, p.z).y; }

  // первая стена выше 2.5 м, начинающаяся на нашем уступе (высота ledgeH), если идти от r0 к вершине
  findBand(theta, r0, ledgeH) {
    let onLedge = false, inWall = false, rb = 0, hb = 0, flat = 0, rtc = 0;
    for (let r = r0; r > 0.5; r -= 0.25) {
      const p = this.at(theta, r), ny = this.ny(p);
      if (!onLedge) { if (ny > 0.8 && Math.abs(p.y - ledgeH) < 2.5) onLedge = true; continue; }
      if (!inWall) {
        if (ny < 0.7) { inWall = true; rb = r + 0.25; hb = this.at(theta, rb).y; flat = 0; }
      } else if (ny > 0.8) {
        if (flat === 0) rtc = r;
        flat += 0.25;
        if (flat >= 1.0) {
          const ht = this.at(theta, rtc).y;
          if (ht - hb > 2.5) return { rb, rt: rtc, hb, ht };
          inWall = false;
        }
      } else flat = 0;
    }
    return null;
  }

  plan() {
    const s = this.center;
    const out = [];
    let r = Math.hypot(this.start.x - s.x, this.start.z - s.z), ledgeH = this.start.y;
    for (let i = 0; i < 40; i++) {
      let band = null, theta = 0;
      for (const k of [1, 0.5, 0]) {          // если на этом направлении уступ пропадает — ближе к центру
        theta = this.theta0 + ZIG[i % ZIG.length] * k;
        band = this.findBand(theta, r + 6, ledgeH);
        if (band) break;
      }
      if (!band) break;
      out.push({ i, theta, ...band });
      r = band.rt - 0.5;
      ledgeH = band.ht;
    }
    return out;
  }

  pickCamps(plan) {
    const spots = [];
    for (const target of [36, 76, 112]) {
      let best = null, bd = 1e9;
      plan.forEach((b, k) => {
        if (k + 1 >= plan.length) return;
        const d = Math.abs(b.ht - target);
        if (d < bd) { bd = d; best = k; }
      });
      if (best === null || spots.some((p) => p.k === best)) continue;
      const a = plan[best], b = plan[best + 1];
      // посередине уступа между двумя стенами, сбоку от тропы
      const theta = (a.theta + b.theta) / 2 + 0.07;
      const rMid = (a.rt + b.rb) / 2;
      const p = this.at(theta, rMid);
      if (Math.abs(p.y - a.ht) > 2.5) continue;
      p.y = a.ht + (p.y - a.ht) * 0.3;
      p.k = best;
      spots.push(p);
    }
    return spots;
  }

  // ——— постройка ———
  build(scene, models) {
    this.scene = scene;
    this.models = models;
    this.matPlank = new THREE.MeshLambertMaterial({ color: '#b07a48' });
    this.matPlankDark = new THREE.MeshLambertMaterial({ color: '#6e4529' });
    this.matStone = new THREE.MeshLambertMaterial({ color: '#a8a097' });
    this.matMetal = new THREE.MeshLambertMaterial({ color: '#59606a' });
    this.matRing = new THREE.MeshLambertMaterial({ color: '#d9dde3', emissive: '#ff8a3a', emissiveIntensity: 0 });
    this.starGeo = makeStarGeometry();
    this.matStar = new THREE.MeshLambertMaterial({ color: '#ffd23a', emissive: '#ffb000', emissiveIntensity: 0.9 });

    let prevT = this.start.clone(), prevTheta = this.theta0;
    this.route.push({ type: 'walk', to: this.start.clone() });
    // какие препятствия где: по очереди из PATTERN, плюс хотя бы два батута на широких уступах
    this.crossings.forEach((b, idx) => { b.kind = this.chooseKind(idx, b); });
    let bounces = this.crossings.filter((b) => b.kind === 'bounce').length;
    for (const b of [...this.crossings].sort((x, y) => y.depth - x.depth)) {
      if (bounces >= 2) break;
      if (b.i >= 2 && b.kind === 'hook' && b.depth >= 2.6 && b.ht - b.hb <= 17) { b.kind = 'bounce'; bounces++; }
    }
    this.crossings.forEach((b, idx) => {
      const kind = b.kind;
      const o = this.out(b.theta);
      const B = this.at(b.theta, b.rb + (kind === 'bounce' ? Math.min(3.4, b.depth - 0.3) : 1.2));
      const T = this.landing(b);
      b.B = B; b.T = T;
      this.walkLedge(prevT, prevTheta, B, b.theta, b.hb, idx);
      if (kind === 'hook') this.makeHook(b, o, B, T);
      else if (kind === 'stairs') this.makeStairs(b, o, B, T);
      else if (kind === 'bounce') this.makeBounce(b, o, B, T);
      else this.makeLift(b, o, B, T);
      prevT = b.T; prevTheta = b.thetaEnd !== undefined ? b.thetaEnd : b.theta;
    });
    // последняя прогулка — к флагу
    const s = this.t.summit;
    this.route.push({ type: 'walk', to: s.clone() });
    this.campSpots.forEach((p, index) => this.makeCamp(p, index));
    this.total = this.stars.length;
  }

  // сколько метров ровного уступа перед стеной (до обрыва)
  ledgeDepth(b) {
    let d = 0;
    for (let r = b.rb + 0.8; r < b.rb + 10; r += 0.25) {
      const p = this.at(b.theta, r);
      if (this.ny(p) < 0.8 || Math.abs(p.y - b.hb) > 1.2) break;
      d = r - b.rb;
    }
    return d;
  }

  chooseKind(idx, b) {
    let kind = PATTERN[idx % PATTERN.length];
    const rise = b.ht - b.hb;
    b.depth = this.ledgeDepth(b);
    if (kind === 'bounce' && (b.depth < 2.4 || rise > 17)) kind = 'stairs';
    if (kind === 'stairs' && rise > 15) kind = 'lift';
    if (kind === 'lift' && rise > 18) kind = 'hook';
    return kind;
  }

  landing(b) {
    for (const d of [1.6, 1.2, 0.9, 2.2, 0.6]) {
      const p = this.at(b.theta, b.rt - d);
      if (this.ny(p) > 0.8 && Math.abs(p.y - b.ht) < 1.0) return p;
    }
    return this.at(b.theta, b.rt - 1.2);
  }

  walkLedge(from, thFrom, to, thTo, ledgeH, idx) {
    const s = this.center;
    const r0 = Math.hypot(from.x - s.x, from.z - s.z), r1 = Math.hypot(to.x - s.x, to.z - s.z);
    const n = Math.max(2, Math.round(Math.abs(thTo - thFrom) * r0 / 3.5));
    const pts = [];
    for (let k = 1; k <= n; k++) {
      const u = k / n, th = thFrom + (thTo - thFrom) * u, rr = r0 + (r1 - r0) * u;
      let best = null;
      for (const dr of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3]) {
        const p = this.at(th, rr + dr);
        if (this.ny(p) > 0.8 && Math.abs(p.y - ledgeH) < 1.5) { best = p; break; }
      }
      if (best) pts.push(best);
    }
    pts.push(to.clone());
    pts.forEach((p) => this.route.push({ type: 'walk', to: p }));
    // звёздочки по тропе
    if (idx > 0) pts.slice(0, -1).forEach((p, k) => { if (k % 2 === 0) this.addStar(p.clone().add(new THREE.Vector3(0, 1.1, 0))); });
  }

  // ——— препятствия ———
  makeHook(b, o, B, T) {
    // столб на краю и перекладина над обрывом, на ней кольцо — так его видно даже от самого низа стены
    const post = this.at(b.theta, b.rt - 0.6);
    const ring = post.clone().addScaledVector(o, 1.7).add(new THREE.Vector3(0, 1.75, 0));
    const g = new THREE.Group();
    const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.3, 8), this.matPlankDark);
    p1.position.set(post.x, post.y + 1.0, post.z);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.0), this.matPlankDark);
    beam.position.copy(post).addScaledVector(o, 0.85).add(new THREE.Vector3(0, 2.1, 0));
    beam.lookAt(ring.x, beam.position.y, ring.z);
    const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6), this.matMetal);
    hang.position.copy(ring).add(new THREE.Vector3(0, 0.2, 0));
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.06, 8, 22), this.matRing.clone());
    r.position.copy(ring);
    r.lookAt(ring.clone().add(o));
    g.add(p1, beam, hang, r);
    [p1, beam, r].forEach((m) => { m.castShadow = true; });
    this.scene.add(g);
    const glow = makeGlow();
    glow.position.copy(ring);
    this.scene.add(glow);
    const anchor = { pos: ring, landing: T.clone(), mesh: r, glow };
    this.anchors.push(anchor);
    this.route.push({ type: 'hook', anchor, to: T.clone() });
    this.hint(B, 'Наведи камеру на кольцо и жми «Крюк» — подтянет наверх');
    this.addStar(T.clone().add(new THREE.Vector3(0, 1.1, 0)));
    this.sign(B, o, b.theta);
  }

  makeStairs(b, o, B, T) {
    // башня-обби перед стеной: площадки по спирали — 6 на круг, каждая на ~0,55 м выше.
    // Над площадкой следующий виток в 3,3+ м — в прыжке головой не стукнуться.
    // Первая и последняя площадки — со стороны стены: снизу к первой подходишь, с последней — мостик на уступ.
    const sd = this.side(b.theta);
    const C = this.at(b.theta, b.rb + 3.3);
    const RAD = 1.7, PER = 6;
    const dirAt = (a) => o.clone().multiplyScalar(Math.cos(a)).addScaledVector(sd, Math.sin(a));
    const p0 = C.clone().addScaledVector(dirAt(Math.PI), RAD);
    const g1 = Math.min(b.hb, this.t.heightAt(p0.x, p0.z));
    const top = b.ht + 0.05;
    const n = PER * Math.max(1, Math.ceil(((top - g1) / 0.58 - 1) / PER)) + 1;
    const turn = b.i % 2 === 0 ? 1 : -1;
    const planks = [];
    const moving = Math.floor(n / 2);
    let lastC = null;
    for (let k = 1; k <= n; k++) {
      const a = Math.PI + turn * (k - 1) * (2 * Math.PI / PER);
      const y = g1 + (k * (top - g1)) / n;
      const c = C.clone().addScaledVector(dirAt(a), RAD).setY(y - 0.12);
      const box = this.addBox(c, 0.55, 0.12, 0.55, b.theta, 'plank', this.matPlank);
      if (k === moving) {
        const base = c.clone();
        box.kind = 'moving';
        this.movers.push({ box, f: (t) => base.clone().setY(base.y + Math.sin(t * 2.2) * 0.25) });
        box.mesh.material = new THREE.MeshLambertMaterial({ color: '#d29a5c', emissive: '#5a2c00', emissiveIntensity: 0.25 });
      }
      planks.push(box);
      if (k === Math.ceil(n / 2) + 1) this.addStar(c.clone().add(new THREE.Vector3(0, 1.2, 0)));
      lastC = c;
    }
    // мостик от верхней площадки на уступ (идёт к стене — над нижними витками не проходит)
    const edge = this.at(b.theta, b.rt - 1.0);
    const dx = edge.x - lastC.x, dz = edge.z - lastC.z, L = Math.hypot(dx, dz);
    const mid = new THREE.Vector3((edge.x + lastC.x) / 2, lastC.y, (edge.z + lastC.z) / 2);
    planks.push(this.addBox(mid, 0.55, 0.12, L / 2 + 0.3, Math.atan2(dx, dz), 'plank', this.matPlankDark));
    this.route.push({ type: 'stairs', planks, to: T.clone() });
    this.hint(B, 'Башня из досок: прыгай по кругу вверх! Одна доска качается');
    this.sign(B, o, b.theta);
  }

  makeBounce(b, o, B, T) {
    const c = this.at(b.theta, b.rb + Math.min(1.7, Math.max(1.0, b.depth * 0.42)));
    const pad = this.addBox(new THREE.Vector3(c.x, c.y + 0.4, c.z), 0.85, 0.4, 0.85, b.theta, 'pad', null);
    pad.bounce = { target: T.clone(), vy: Math.sqrt(2 * 22 * (b.ht - (c.y + 0.8) + 2.6)) };
    const m = place(this.scene, this.models.mushroom_red, new THREE.Vector3(c.x, c.y - 0.05, c.z), 10.5);
    m.scale.y = 4.4;
    pad.mesh = m;
    this.route.push({ type: 'bounce', pad, to: T.clone() });
    this.hint(B, 'Запрыгни на гриб — подбросит на уступ выше!');
    this.addStar(this.at(b.theta, b.rb + 1.0).add(new THREE.Vector3(0, b.ht - b.hb + 1.5, 0)).setY(b.ht + 2.2));
    this.sign(B, o, b.theta, 2.8);
  }

  makeLift(b, o, B, T) {
    const p0 = this.at(b.theta, b.rb + 1.9); p0.y = b.hb + 0.12 - 0.15;
    const p1 = this.at(b.theta, b.rt + 1.5); p1.y = b.ht + 0.05 - 0.15;
    const box = this.addBox(p0.clone(), 1.1, 0.15, 1.1, b.theta, 'lift', this.matStone);
    // перила-столбики для красоты
    const deco = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6), this.matPlankDark);
    deco.position.set(0.95, 0.6, 0.95);
    box.mesh.add(deco);
    const d2 = deco.clone(); d2.position.set(-0.95, 0.6, 0.95); box.mesh.add(d2);
    const period = 13;
    this.movers.push({
      box, f: (t) => {
        const u = (t % period) / period;   // 0..1: стоит внизу, едет вверх, стоит наверху, едет вниз
        let k;
        if (u < 0.15) k = 0; else if (u < 0.5) k = smooth((u - 0.15) / 0.35); else if (u < 0.65) k = 1; else k = 1 - smooth((u - 0.65) / 0.35);
        return p0.clone().lerp(p1, k);
      },
    });
    this.route.push({ type: 'lift', box, p0: p0.clone(), p1: p1.clone(), to: T.clone() });
    this.hint(B, 'Встань на платформу — она сама поднимет');
    this.sign(B, o, b.theta);
  }

  makeCamp(p, index) {
    const M = this.models;
    const o = this.out(Math.atan2(p.x - this.center.x, p.z - this.center.z));
    const face = Math.atan2(o.x, o.z);
    const fire = p.clone().addScaledVector(o, 1.2);
    fire.y = this.t.heightAt(fire.x, fire.z);
    place(this.scene, M.tent_detailedOpen, this.ground(p.clone().addScaledVector(o, -1.6)), 4.0, face + 0.3);
    place(this.scene, M.campfire_stones, fire, 2.6);
    place(this.scene, M.campfire_logs, fire, 2.4, 0.6);
    const sd = new THREE.Vector3(o.z, 0, -o.x);
    place(this.scene, M.log, this.ground(fire.clone().addScaledVector(sd, 1.9)), 3.2, face);
    this.camps.push({ pos: p.clone(), fire, index, reached: false });
  }

  ground(p) { p.y = this.t.heightAt(p.x, p.z); return p; }

  sign(B, o, theta, off = 1.6) {
    const p = this.ground(B.clone().addScaledVector(this.side(theta), off));
    place(this.scene, this.models.sign, p, 3.2, Math.atan2(o.x, o.z) + Math.PI);
  }

  addBox(c, hx, hy, hz, psi, kind, mat) {
    const box = { c: c.clone(), hx, hy, hz, psi, cos: Math.cos(psi), sin: Math.sin(psi), kind, dp: new THREE.Vector3() };
    if (mat) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
      m.position.copy(c);
      m.rotation.y = psi;
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
      box.mesh = m;
    }
    this.boxes.push(box);
    return box;
  }

  addStar(p) {
    const m = new THREE.Mesh(this.starGeo, this.matStar);
    m.position.copy(p);
    m.castShadow = false;
    this.scene.add(m);
    this.stars.push({ pos: p.clone(), mesh: m, taken: false });
  }

  hint(p, text) { this.hints.push({ pos: p.clone(), r: 6, text, shown: false }); }

  // ——— каждый кадр ———
  update(time, dt) {
    for (const mv of this.movers) {
      const np = mv.f(time);
      mv.box.dp.subVectors(np, mv.box.c);
      mv.box.c.copy(np);
      if (mv.box.mesh) mv.box.mesh.position.copy(np);
    }
    for (const s of this.stars) {
      if (s.taken) continue;
      s.mesh.rotation.y = time * 2.2;
      s.mesh.position.y = s.pos.y + Math.sin(time * 2.5 + s.pos.x) * 0.12;
    }
  }

  // ——— столкновения с досками и платформами ———
  local(box, x, z) {
    const dx = x - box.c.x, dz = z - box.c.z;
    return [dx * box.cos - dz * box.sin, dx * box.sin + dz * box.cos];
  }
  // самая высокая опора под ногами не выше y + step
  support(x, z, y, step = 0.35) {
    let best = null;
    for (const b of this.boxes) {
      const top = b.c.y + b.hy;
      if (top > y + step || top < y - 2) continue;
      const [lx, lz] = this.local(b, x, z);
      if (Math.abs(lx) <= b.hx + 0.12 && Math.abs(lz) <= b.hz + 0.12 && (!best || top > best.top)) best = { top, box: b };
    }
    return best;
  }
  // вытолкнуть героя из боков досок; вернуть true, если ударились головой
  pushOut(p, vel) {
    let bumped = false;
    for (const b of this.boxes) {
      const top = b.c.y + b.hy, bottom = b.c.y - b.hy;
      if (p.y >= top - 0.35 || p.y + PLAYER_H <= bottom) continue;
      let [lx, lz] = this.local(b, p.x, p.z);
      const ex = b.hx + PLAYER_R, ez = b.hz + PLAYER_R;
      if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
      if (vel.y > 0 && p.y + PLAYER_H - vel.y * 0.02 <= bottom + 0.05 && Math.abs(lx) < b.hx && Math.abs(lz) < b.hz) {
        p.y = bottom - PLAYER_H; vel.y = 0; bumped = true; continue;
      }
      if (ex - Math.abs(lx) < ez - Math.abs(lz)) lx = Math.sign(lx || 1) * ex; else lz = Math.sign(lz || 1) * ez;
      p.x = b.c.x + lx * b.cos + lz * b.sin;
      p.z = b.c.z - lx * b.sin + lz * b.cos;
    }
    return bumped;
  }
}

function smooth(u) { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); }

function makeStarGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 === 0 ? 0.42 : 0.18;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 });
  g.center();
  return g;
}

function makeGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,220,160,1)');
  grd.addColorStop(0.35, 'rgba(255,150,60,0.55)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffffff', opacity: 0.5 }));
  s.scale.setScalar(1.6);
  return s;
}

export { instance };
