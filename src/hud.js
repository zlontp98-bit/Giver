// Надписи и полоски поверх игры.
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.hp = $('hp').firstElementChild;
    this.st = $('st').firstElementChild;
    this.stBar = $('st');
    this.altV = $('altV'); this.altT = $('altT'); this.time = $('time');
    this.msg = $('msg'); this.hurtEl = $('hurt');
    this.joy = $('joy'); this.knob = $('knob'); this.joyHint = $('joyHint');
    this.btnJump = $('bJump'); this.btnGrab = $('bGrab'); this.btnRun = $('bRun');
    this.msgTimer = 0;
    this.last = {};
  }

  set(key, el, prop, value) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el[prop] = value;
  }

  update(dt, player, summitY, elapsed) {
    this.set('hp', this.hp.style, 'width', `${player.health.toFixed(0)}%`);
    this.set('st', this.st.style, 'width', `${player.stamina.toFixed(0)}%`);
    const low = player.stamina < 25 && (player.climbing || player.state === 'air');
    if (this.last.low !== low) { this.last.low = low; this.stBar.classList.toggle('low', low); }
    const alt = Math.max(0, Math.round(player.pos.y));
    this.set('alt', this.altV, 'textContent', `${alt} м`);
    this.set('altT', this.altT, 'textContent', `до вершины ${Math.max(0, Math.round(summitY - player.pos.y))} м`);
    this.set('time', this.time, 'textContent', fmtTime(elapsed));
    const hint = player.wallPush > 0.5 && player.state === 'ground';
    if (this.last.hint !== hint) { this.last.hint = hint; this.btnGrab.classList.toggle('hint', hint); }
    if (this.last.climb !== player.climbing) { this.last.climb = player.climbing; this.btnGrab.classList.toggle('active', player.climbing); }
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msg.classList.remove('show');
    }
  }

  message(text, sec = 2.2) {
    this.msg.textContent = text;
    this.msg.classList.add('show');
    this.msgTimer = sec;
  }

  hurt() {
    this.hurtEl.style.transition = 'none';
    this.hurtEl.style.opacity = '1';
    requestAnimationFrame(() => {
      this.hurtEl.style.transition = 'opacity .6s';
      this.hurtEl.style.opacity = '0';
    });
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
