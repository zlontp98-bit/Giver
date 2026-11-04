// Рюкзак, рецепты и снаряжение. Только данные и правила (без картинки): рюкзак — state.inv { id: сколько },
// снаряжение — state.gear { id: true }. Вместимость — ячейки: в одной ячейке до stack штук одного вида.
// Снаряжение не занимает ячеек: сделал — надето навсегда, и оно даёт новые возможности, а не только цифры.

export const ITEMS = {
  wood: { name: 'Дерево', stack: 10 },
  stone: { name: 'Камень', stack: 10 },
  ore: { name: 'Железная руда', stack: 10 },
  berry: { name: 'Ягоды', stack: 10, eat: { stamina: 35 } },
  mushroom: { name: 'Грибы', stack: 10 },
  glowshroom: { name: 'Светогрибы', stack: 10 },
  ingot: { name: 'Железный слиток', stack: 10 },
  stew: { name: 'Похлёбка', stack: 5, eat: { stamina: 100, health: 30 } },
  platform: { name: 'Платформа', stack: 3, place: 'platform' },
  shelter: { name: 'Укрытие', stack: 1, place: 'shelter' },
};

// снаряжение: что даёт (gear-флаги читает герой — player.gear)
export const GEAR = {
  pickaxe: { name: 'Кирка', what: 'добывать руду и разбивать завалы' },
  spikes: { name: 'Шипы на ботинки', what: 'на стене силы тратятся на треть меньше, можно лезть под крутым нависанием' },
  cable: { name: 'Стальной трос', what: 'верёвка до 120 м вместо 75 — спуск на дно с плато лагеря' },
  grapple: { name: 'Крюк-кошка', what: 'крюк летит на 36 м вместо 24, вверх по верёвке — втрое быстрее и легче' },
};

// at: 'workbench' | 'furnace' | 'fire' (у печи и у костра)
export const RECIPES = [
  { id: 'pickaxe', name: 'Кирка', at: 'workbench', need: { wood: 3, stone: 2 }, gear: 'pickaxe' },
  { id: 'ingot', name: 'Железный слиток', at: 'furnace', need: { ore: 2, wood: 1 }, give: { ingot: 1 } },
  { id: 'spikes', name: 'Шипы на ботинки', at: 'workbench', need: { ingot: 2, wood: 1 }, gear: 'spikes' },
  { id: 'cable', name: 'Стальной трос', at: 'workbench', need: { ingot: 3, wood: 1 }, gear: 'cable' },
  { id: 'grapple', name: 'Крюк-кошка', at: 'workbench', need: { ingot: 2, stone: 2 }, gear: 'grapple' },
  { id: 'platform', name: 'Платформа', at: 'workbench', need: { wood: 3 }, give: { platform: 1 }, what: 'поставить на стене или над краем и отдохнуть; разберёшь — вернётся' },
  { id: 'shelter', name: 'Укрытие', at: 'workbench', need: { wood: 4, stone: 1 }, give: { shelter: 1 }, what: 'временный лагерь на ровной земле: сорвёшься — вернёшься сюда' },
  { id: 'stew', name: 'Похлёбка', at: 'furnace', need: { mushroom: 1, glowshroom: 1, berry: 2 }, alt: { mushroom: 2, berry: 2 }, give: { stew: 1 } },
];

export const BAG_SLOTS = 8;

export class Inventory {
  constructor(state) { this.state = state; }
  get inv() { return this.state.inv; }
  get gear() { return this.state.gear; }
  count(id) { return this.inv[id] || 0; }
  has(need) { return Object.entries(need).every(([id, n]) => this.count(id) >= n); }
  slotsUsed(inv = this.inv) { let s = 0; for (const [id, n] of Object.entries(inv)) if (n > 0) s += Math.ceil(n / (ITEMS[id] ? ITEMS[id].stack : 10)); return s; }

  // сколько штук id влезет
  room(id) {
    const st = ITEMS[id].stack, have = this.count(id), free = BAG_SLOTS - this.slotsUsed();
    return Math.max(0, free * st + (have % st ? st - (have % st) : 0));
  }
  add(id, n) {
    const k = Math.min(n, this.room(id));
    if (k > 0) this.inv[id] = this.count(id) + k;
    return k;
  }
  take(id, n) {
    const k = Math.min(n, this.count(id));
    this.inv[id] = this.count(id) - k;
    if (!this.inv[id]) delete this.inv[id];
    return k;
  }

  // какие ингредиенты рецепт возьмёт (основной набор или запасной)
  needFor(r) { if (this.has(r.need)) return r.need; if (r.alt && this.has(r.alt)) return r.alt; return null; }
  canCraft(r) {
    if (r.gear && this.gear[r.gear]) return { ok: false, why: 'уже есть' };
    const need = this.needFor(r);
    if (!need) return { ok: false, why: 'не хватает' };
    if (r.give) {
      // место после того, как ингредиенты уйдут
      const after = { ...this.inv };
      for (const [id, n] of Object.entries(need)) { after[id] -= n; if (!after[id]) delete after[id]; }
      for (const [id, n] of Object.entries(r.give)) after[id] = (after[id] || 0) + n;
      if (this.slotsUsed(after) > BAG_SLOTS) return { ok: false, why: 'рюкзак полон' };
    }
    return { ok: true, need };
  }
  craft(r) {
    const c = this.canCraft(r);
    if (!c.ok) return c;
    for (const [id, n] of Object.entries(c.need)) this.take(id, n);
    if (r.gear) this.gear[r.gear] = true;
    if (r.give) for (const [id, n] of Object.entries(r.give)) this.inv[id] = this.count(id) + n;
    return { ok: true };
  }
}
