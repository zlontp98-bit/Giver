// Экраны и кнопки меню: старт, пауза (качество графики, счётчик FPS, «Замер»), «сорвался», финиш,
// итог «Замера», кнопка «Назад» на Android и пауза, когда игру свернули.
import { fmtTime } from './hud.js';

const $ = (id) => document.getElementById(id);

export class Screens {
  // ctx: { game, hud, input, save, version, onStart, onRespawn, onToCamp, onQuality, onShowFps,
  //        onBench, onBenchAbort, benchRunning() }
  constructor(ctx) {
    this.ctx = ctx;
    const { game, hud, save } = ctx;
    // рекорды старой Бездны (0.4) к новому миру не относятся — показываем только спуск на дно первого яруса
    const rec = save.records.layer1;
    if (rec) $('best').textContent = `Рекорд спуска на дно: ${fmtTime(rec.time)}`;
    document.querySelectorAll('.ver').forEach((el) => { el.textContent = `версия ${ctx.version}`; });

    $('go').onclick = () => {
      hud.screen('sStart', false);
      game.running = true;
      document.body.classList.add('playing');
      ctx.onStart();
    };
    $('pause').onclick = () => this.setPaused(true);
    $('resume').onclick = () => this.setPaused(false);
    $('restart').onclick = () => location.reload();
    $('toCamp').onclick = () => { this.setPaused(false); ctx.onToCamp(); };
    $('respawn').onclick = () => { hud.screen('sDead', false); ctx.onRespawn(); game.running = true; document.body.classList.add('playing'); };
    $('again').onclick = () => location.reload();
    if (window.AndroidBridge && window.AndroidBridge.exit) {
      $('exit').hidden = false;
      $('exit').onclick = () => window.AndroidBridge.exit();
    }
    document.querySelectorAll('[data-quality] button').forEach((b) => { b.onclick = () => ctx.onQuality(b.dataset.q); });
    document.querySelectorAll('[data-fps] button').forEach((b) => { b.onclick = () => ctx.onShowFps(b.dataset.v === '1'); });
    $('bench').onclick = () => {
      hud.screen('sPause', false);
      document.body.classList.add('bench');
      ctx.onBench();
    };
    $('benchOk').onclick = () => { hud.screen('sBench', false); hud.screen('sPause', true); };

    // кнопка «Назад» на Android: пауза / продолжить (во время «Замера» — прервать его)
    window.__onBack = () => {
      if (ctx.benchRunning()) { ctx.onBenchAbort(); return true; }
      if ($('sNote').classList.contains('show')) { $('noteClose').onclick(); return true; }
      if ($('sBench').classList.contains('show')) { $('benchOk').onclick(); return true; }
      if (!game.running && !game.paused) return false;
      this.setPaused(!game.paused);
      return true;
    };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      if (ctx.benchRunning()) ctx.onBenchAbort();
      else if (game.running) this.setPaused(true);
    });
  }

  setPaused(p) {
    const { game, hud, input } = this.ctx;
    if (game.won || (!game.running && !game.paused)) return;
    game.paused = p;
    game.running = !p;
    hud.screen('sPause', p);
    document.body.classList.toggle('playing', !p);
    input.reset();
  }

  showQuality(key) {
    document.querySelectorAll('[data-quality] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === key)));
  }
  showFpsSetting(on) {
    document.querySelectorAll('[data-fps] button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.v === '1') === on)));
  }

  showDead(text) {
    $('deadTxt').textContent = text;
    setTimeout(() => this.ctx.hud.screen('sDead', true), 700);
    document.body.classList.remove('playing');
  }

  showWin(time, shards, total, note) {
    $('wTime').textContent = fmtTime(time);
    $('wStars').textContent = `${shards}/${total}`;
    $('winTxt').textContent = note;
    document.body.classList.remove('playing');
    setTimeout(() => this.ctx.hud.screen('sWin', true), 1200);
  }

  benchProgress(secondsLeft) { $('benchLeft').textContent = `${secondsLeft} с`; }

  // r — итог замера (см. Benchmark.finish), history — прошлые замеры (новые сверху)
  showBench(r, history) {
    document.body.classList.remove('bench');
    if (!r) { this.ctx.hud.screen('sPause', true); return; }
    $('bFps').textContent = r.fps.toFixed(0);
    $('bQual').textContent = r.qualityName;
    $('bLoad').textContent = `${Math.min(100, Math.round((100 * r.cap) / r.fps))}%`;
    $('bLow').textContent = `${r.low1.toFixed(0)} FPS`;
    $('bCpu').textContent = `${r.cpu.toFixed(1)} мс`;
    $('bInfo').textContent = `Экран ${r.screen}, рисуем ${r.canvas} · видеочип: ${r.gpu} · ядер: ${r.cores || '?'} · версия ${r.version}`;
    $('bHist').innerHTML = history.slice(1, 6).map((h) =>
      `<li>${h.date} · ${h.qualityName} · <b>${h.fps.toFixed(0)} FPS</b> · ${h.version}</li>`).join('') || '<li>Это первый замер</li>';
    this.ctx.hud.screen('sBench', true);
  }
}
