// Игровые сущности: всё, с чем герой что-то делает, — записки, тайники, ресурсы, рюкзаки, постройки, существа.
// Сущность = данные (id, kind, pos и поля вида) + необязательный «вид» (view) с методом sync(e), который
// обновляет картинку. Изменения пишутся в состояние игры (state.entities) — так они сохраняются и потом
// могут уйти по сети. Свои сущности (рюкзак на месте гибели, постройка) хранятся в состоянии целиком.
import * as THREE from 'three';

const CELL = 24;                    // сетка для поиска ближайших
const key = (x, z) => Math.floor(x / CELL) * 65536 + Math.floor(z / CELL);

export class Entities {
  constructor(state) {
    this.state = state;
    this.all = new Map();
    this.grid = new Map();
    this.listeners = [];
  }

  // add({ id, kind, pos: Vector3, ... }, view?) — сущность уровня; dynamic: true — своя (сохраняется целиком)
  add(e, view = null) {
    const saved = this.state.entities[e.id];
    if (saved) Object.assign(e, saved.dynamic ? { ...saved, pos: new THREE.Vector3(...saved.pos) } : saved);
    e.view = view;
    this.all.set(e.id, e);
    this.index(e);
    if (e.dynamic) this.persist(e);
    if (view && view.sync) view.sync(e);
    return e;
  }

  index(e) {
    const k = key(e.pos.x, e.pos.z);
    if (!this.grid.has(k)) this.grid.set(k, new Set());
    this.grid.get(k).add(e);
    e._k = k;
  }

  get(id) { return this.all.get(id); }
  byKind(kind) { const out = []; for (const e of this.all.values()) if (e.kind === kind) out.push(e); return out; }

  // изменить сущность: патч ложится и в состояние (то, что надо сохранять)
  set(e, patch) {
    Object.assign(e, patch);
    if (e.dynamic) this.persist(e);
    else this.state.entities[e.id] = { ...(this.state.entities[e.id] || {}), ...stripPos(patch) };
    if (patch.pos) { this.grid.get(e._k)?.delete(e); this.index(e); }
    if (e.view && e.view.sync) e.view.sync(e);
    for (const f of this.listeners) f(e, patch);
  }

  remove(e) {
    this.all.delete(e.id);
    this.grid.get(e._k)?.delete(e);
    if (e.dynamic) delete this.state.entities[e.id];
    else this.state.entities[e.id] = { ...(this.state.entities[e.id] || {}), removed: true };
    if (e.view && e.view.dispose) e.view.dispose(e);
  }

  persist(e) {
    const o = {};
    for (const [k, v] of Object.entries(e)) if (k !== 'view' && k[0] !== '_') o[k] = v;
    o.pos = [e.pos.x, e.pos.y, e.pos.z];
    this.state.entities[e.id] = o;
  }

  // ближайшая сущность в радиусе r (и по высоте dy), подходящая под test
  // ближайшая сущность в радиусе r (у больших — e.reach: дотянуться можно на столько дальше)
  nearest(p, r, dy, test) {
    let best = null, bd = 1e9;
    const R = r + 2;
    const x0 = Math.floor((p.x - R) / CELL), x1 = Math.floor((p.x + R) / CELL), z0 = Math.floor((p.z - R) / CELL), z1 = Math.floor((p.z + R) / CELL);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const set = this.grid.get(gx * 65536 + gz);
      if (!set) continue;
      for (const e of set) {
        if (Math.abs(e.pos.y - p.y) > dy || (test && !test(e))) continue;
        const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z) - (e.reach || 0);
        if (d < r && d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }

  // свои сущности из сохранения (рюкзаки, постройки), для которых нужно создать вид: makeView(kind) → view
  restoreDynamic(makeView) {
    for (const [id, s] of Object.entries(this.state.entities)) {
      if (!s.dynamic || this.all.has(id)) continue;
      const e = { ...s, pos: new THREE.Vector3(...s.pos) };
      this.add(e, makeView(e));
    }
  }
}

function stripPos(p) { const o = { ...p }; delete o.pos; return o; }
