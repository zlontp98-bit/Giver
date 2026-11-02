// Скорость игры на телефоне:
//   FpsMeter  — счётчик в углу экрана (включается в паузе): кадров в секунду, длина кадра, работа процессора;
//   Benchmark — «Замер»: 30 секунд облёта по миру БЕЗ ограничения кадров, потом итог: средний FPS,
//               самые медленные кадры, работа процессора, видеочип. Нужен, чтобы сравнивать версии
//               и качество графики на настоящем телефоне (на компьютере цифры другие).

export class FpsMeter {
  constructor(el) {
    this.el = el;
    this.on = false;
    this.reset();
  }
  reset() { this.n = 0; this.time = 0; this.cpu = 0; }
  setVisible(on) {
    this.on = on;
    this.el.hidden = !on;
    this.reset();
  }
  // interval — секунды с прошлого кадра, cpuMs — сколько наш код считал этот кадр
  frame(interval, cpuMs) {
    if (!this.on) return;
    this.n++; this.time += interval; this.cpu += cpuMs;
    if (this.time < 0.5) return;
    const fps = this.n / this.time;
    this.el.textContent = `${fps.toFixed(0)} FPS · кадр ${((1000 * this.time) / this.n).toFixed(0)} мс · ЦП ${(this.cpu / this.n).toFixed(1)} мс`;
    this.reset();
  }
}

export class Benchmark {
  constructor() {
    this.running = false;
    this.duration = 30;      // секунд
    this.warmup = 1;         // первую секунду не считаем (камера долетает до точки)
  }

  // path — точки облёта (Vector3, по ним идёт герой, камера летит следом)
  start(path, player, cam) {
    this.path = path;
    this.lens = [0];
    for (let i = 1; i < path.length; i++) this.lens.push(this.lens[i - 1] + path[i].distanceTo(path[i - 1]));
    this.total = this.lens[this.lens.length - 1];
    this.t = 0;
    this.intervals = [];
    this.cpu = [];
    this.saved = { pos: player.pos.clone(), facing: player.facing, yaw: cam.yaw, pitch: cam.pitch };
    this.running = true;
  }

  // каждый кадр: передвинуть героя по пути, повернуть камеру; вернёт долю пройденного (0..1)
  step(raw, player, cam) {
    this.t += raw;
    const u = Math.min(1, this.t / this.duration);
    const s = u * this.total;
    let i = 1;
    while (i < this.lens.length - 1 && this.lens[i] < s) i++;
    const a = this.path[i - 1], b = this.path[i];
    const k = (s - this.lens[i - 1]) / Math.max(1e-6, this.lens[i] - this.lens[i - 1]);
    player.pos.lerpVectors(a, b, k);
    const dx = b.x - a.x, dz = b.z - a.z;
    if (dx * dx + dz * dz > 1e-6) player.facing = Math.atan2(dx, dz);
    // камера сзади и чуть покачивается — чтобы в кадр попадали разные стороны
    cam.yaw = player.facing + Math.PI + Math.sin(this.t * 0.6) * 0.9;
    cam.pitch = 0.32 + Math.sin(this.t * 0.45) * 0.18;
    return u;
  }

  record(raw, cpuMs) {
    if (this.t < this.warmup) return;
    this.intervals.push(raw);
    this.cpu.push(cpuMs);
  }

  get done() { return this.t >= this.duration; }
  get secondsLeft() { return Math.max(0, Math.ceil(this.duration - this.t)); }

  // закончить: вернуть героя и камеру на место, посчитать итог
  finish(player, cam) {
    this.running = false;
    player.pos.copy(this.saved.pos);
    player.facing = this.saved.facing;
    cam.yaw = this.saved.yaw;
    cam.pitch = this.saved.pitch;
    const n = this.intervals.length;
    if (!n) return null;
    const time = this.intervals.reduce((x, y) => x + y, 0);
    const sorted = [...this.intervals].sort((x, y) => x - y);
    const p99 = sorted[Math.min(n - 1, Math.floor(n * 0.99))];
    return {
      fps: n / time,
      low1: 1 / p99,
      cpu: this.cpu.reduce((x, y) => x + y, 0) / n,
      frames: n,
      seconds: time,
    };
  }
}

// название видеочипа (например, «Mali-G57 MC2») — чтобы понимать, на чём мерили
export function gpuName(renderer) {
  const gl = renderer.getContext();
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch (e) { /* нет — не страшно */ }
  try { return String(gl.getParameter(gl.RENDERER)); } catch (e) { return 'неизвестно'; }
}

// точки облёта по маршруту: не больше max штук, примерно поровну по длине пути
export function pathFromRoute(route, max = 60) {
  const pts = [];
  for (const s of route) if (s.to) pts.push(s.to.clone());
  if (pts.length <= max) return pts;
  const out = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round((i / (max - 1)) * (pts.length - 1))]);
  return out;
}
