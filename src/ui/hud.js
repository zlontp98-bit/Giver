// Интерфейс поверх игры: полоски, глубина, осколки, полоска спуска с лагерями, прицел крюка, кнопки, сообщения.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const ICON = (id) => `<svg class="ico"><use href="#i-${id}" /></svg>`;

export class Hud {
  constructor() {
    this.hp = $('hp').firstElementChild;
    this.st = $('st').firstElementChild;
    this.stBar = $('st');
    this.altV = $('altV'); this.altT = $('altT'); this.time = $('time'); this.starsEl = $('stars'); this.starChip = $('starChip');
    this.toastEl = $('toast'); this.hurtEl = $('hurt');
    this.joy = $('joy'); this.knob = $('knob'); this.joyHint = $('joyHint');
    this.btnJump = $('bJump'); this.btnHook = $('bHook'); this.btnRun = $('bRun'); this.hookLbl = $('hookLbl');
    this.btnGrab = $('bGrab'); this.grabLbl = $('grabLbl');
    this.btnAct = $('bAct'); this.actLbl = $('actLbl');
    this.reticle = $('reticle'); this.retD = $('retD');
    this.track = $('track'); this.me = $('me');
    this.toastTimer = 0;
    this.last = {};
    this.v = new THREE.Vector3();
  }

  // метки на полоске спуска: лагеря и дно; areaName(x, y, z) — название места
  setupTrack(bottomY, camps, areaName) {
    this.bottomY = bottomY;
    this.areaName = areaName;
    this.campMarks = camps.map((c) => {
      const el = document.createElement('div');
      el.className = 'mk';
      el.innerHTML = ICON('tent');
      el.style.left = `${(c.pos.y / bottomY) * 100}%`;
      this.track.appendChild(el);
      return { el, c };
    });
    const flag = document.createElement('div');
    flag.className = 'mk';
    flag.innerHTML = ICON('gem');
    flag.style.left = '100%';
    this.track.appendChild(flag);
  }

  set(key, el, prop, value) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el[prop] = value;
  }
  cls(key, el, name, on) {
    if (this.last[key] === on) return;
    this.last[key] = on;
    el.classList.toggle(name, on);
  }

  update(dt, player, game, camera) {
    this.set('hp', this.hp.style, 'width', `${player.health.toFixed(0)}%`);
    this.set('st', this.st.style, 'width', `${player.stamina.toFixed(0)}%`);
    this.cls('low', this.stBar, 'low', player.stamina < 25 && player.state !== 'ground');
    const y = player.pos.y;
    this.set('alt', this.altV, 'textContent', `${Math.max(0, Math.round(-y))} м`);
    this.set('altT', this.altT, 'textContent', this.areaName(player.pos.x, y, player.pos.z));
    this.set('time', this.time, 'textContent', fmtTime(game.elapsed));
    this.set('stars', this.starsEl, 'textContent', `${game.shards}/${game.shardsTotal}`);
    this.cls('noShards', this.starChip, 'hide', !game.shardsTotal);
    this.set('me', this.me.style, 'left', `${Math.max(0, Math.min(100, (y / this.bottomY) * 100)).toFixed(1)}%`);
    if (this.campMarks) for (const m of this.campMarks) this.cls(`camp${m.c.index}`, m.el, 'done', m.c.reached);
    // кнопка «Хват»: светится у стены; синяя, когда висим на руках
    const climbing = player.state === 'climb' || (player.state === 'mantle' && player.mantle.then === 'climb');
    this.cls('grabReady', this.btnGrab, 'ready', !climbing && player.canGrab);
    this.cls('grabOn', this.btnGrab, 'on', climbing);
    this.set('grabLbl', this.grabLbl, 'textContent', climbing ? 'отпустить' : 'хват');
    // кнопка «Действие»: появляется у записки и сундука
    const it = player.interact;
    this.cls('actShow', this.btnAct, 'show', !!it);
    if (it) this.set('actLbl', this.actLbl, 'textContent', it.kind === 'note' ? 'читать' : 'открыть');
    // кнопка крюка: светится, когда есть кольцо; синяя, когда висим на верёвке или тросе
    const onRope = !!player.rope || player.state === 'zip' || !!player.hook || (player.state === 'mantle' && (player.mantle.then === 'rope' || player.mantle.then === 'zip'));
    this.cls('ready', this.btnHook, 'ready', !onRope && !!player.target);
    this.cls('ropeOn', this.btnHook, 'on', onRope);
    this.set('hookLbl', this.hookLbl, 'textContent', onRope ? 'отпустить' : 'крюк');
    // прицел крюка: на цели (скала или кольцо) — яркий с расстоянием; цели нет — бледный, куда смотрит прицел
    const tgt = !onRope && player.target;
    const at = tgt ? tgt.pos : (!onRope && player.aimOn && player.aimPoint) || null;
    if (at && game.running) {
      const v = this.v.copy(at).project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      this.cls('ret', this.reticle, 'on', vis);
      this.cls('retFar', this.reticle, 'far', !tgt);
      this.cls('retRing', this.reticle, 'ring', !!tgt && !tgt.free);
      if (vis) {
        this.reticle.style.transform = `translate(${((v.x + 1) / 2) * window.innerWidth}px, ${((1 - v.y) / 2) * window.innerHeight}px)`;
        this.set('retD', this.retD, 'textContent', tgt ? (tgt.kind === 'zip' ? 'трос' : `${Math.round(tgt.pos.distanceTo(player.pos))} м`) : '');
      }
    } else this.cls('ret', this.reticle, 'on', false);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }

  message(text, sec = 2.4, hint = false) {
    this.toastEl.textContent = text;
    this.toastEl.classList.toggle('hint', hint);
    this.toastEl.classList.add('show');
    this.toastTimer = sec;
  }

  starPop() {
    this.starChip.classList.remove('pop');
    void this.starChip.offsetWidth;
    this.starChip.classList.add('pop');
  }

  hurt() {
    this.hurtEl.style.transition = 'none';
    this.hurtEl.style.opacity = '1';
    requestAnimationFrame(() => { this.hurtEl.style.transition = 'opacity .6s'; this.hurtEl.style.opacity = '0'; });
  }

  showJoystick(x, y) {
    this.joy.style.left = `${x}px`; this.joy.style.top = `${y}px`;
    this.joy.style.display = 'block';
    this.moveKnob(0, 0);
    this.joyHint.style.display = 'none';
  }
  moveKnob(dx, dy) { this.knob.style.transform = `translate(${dx}px, ${dy}px)`; }
  hideJoystick() { this.joy.style.display = 'none'; }

  screen(id, show) { $(id).classList.toggle('show', show); }
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
