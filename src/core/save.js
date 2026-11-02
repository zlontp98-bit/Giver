// Сохранение на телефоне: одна запись в localStorage. В записи есть номер формата (v) — старые
// записи переводятся в новый вид. Имя ключа не меняем: в нём настройки и рекорды прошлых версий.
//
// Формат 2:
//   settings — настройки (качество графики, показывать ли FPS)
//   records  — рекорды: mountain (гора 0.1–0.3), abyss (Бездна 0.4)
//   progress — прогресс в мире (герой, рюкзак, постройки…) — заполнится в следующих этапах 0.5
//   bench    — последние «Замеры» скорости (для сравнения версий на телефоне)
const KEY = 'giver_v1';
export const SAVE_FORMAT = 2;
const BENCH_KEEP = 8;

function fresh() {
  return { v: SAVE_FORMAT, settings: { quality: 'low', showFps: false }, records: {}, progress: null, bench: [] };
}

// 0.2–0.4 хранили плоский объект: { quality (0.2), quality2, best, bestStars (гора), best2, bestShards2 (Бездна) }
export function migrate(old) {
  const s = fresh();
  if (!old || typeof old !== 'object') return s;
  if (old.v === SAVE_FORMAT) {
    return {
      ...s, ...old,
      settings: { ...s.settings, ...(old.settings || {}) },
      records: { ...(old.records || {}) },
      bench: Array.isArray(old.bench) ? old.bench.slice(0, BENCH_KEEP) : [],
    };
  }
  if (old.quality2) s.settings.quality = old.quality2;          // «quality» из 0.2 не берём (там было тяжело)
  if (old.best) s.records.mountain = { time: old.best, stars: old.bestStars || 0 };
  if (old.best2) s.records.abyss = { time: old.best2, shards: old.bestShards2 || 0 };
  return s;
}

export class Save {
  constructor(storage) {
    this.storage = storage || safeStorage();
    let raw = null;
    try { raw = JSON.parse(this.storage.getItem(KEY)); } catch (e) { raw = null; }
    this.data = migrate(raw);
    this.migrated = !!raw && raw.v !== SAVE_FORMAT;
    if (this.migrated) this.write();
  }

  get settings() { return this.data.settings; }
  get records() { return this.data.records; }

  write() {
    try { this.storage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* нет места — не страшно */ }
  }

  addBench(result) {
    this.data.bench.unshift(result);
    if (this.data.bench.length > BENCH_KEEP) this.data.bench.length = BENCH_KEEP;
    this.write();
  }
}

// если хранилище недоступно (бывает в приватном режиме браузера) — живём в памяти
function safeStorage() {
  try {
    const ls = window.localStorage;
    ls.getItem(KEY);
    return ls;
  } catch (e) {
    const mem = new Map();
    return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  }
}
