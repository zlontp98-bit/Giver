// Управление: на телефоне — джойстик слева, поворот камеры пальцем справа, кнопки «хват», «крюк», «прыжок», «бег».
// На компьютере — WASD/стрелки, Shift — бег, пробел — прыжок, Q — хват, E или правая кнопка мыши — крюк, мышь — камера.

export class Input {
  constructor(layer, ui) {
    this.mx = 0; this.my = 0;
    this.joy = { id: null, x0: 0, y0: 0, x: 0, y: 0 };
    this.look = { id: null, x: 0, y: 0 };
    this.camDX = 0; this.camDY = 0;
    this.jump = false; this.hook = false; this.grab = false;
    this.keys = new Set();
    this.lastLook = 0;
    this.ui = ui;
    this.R = 60;   // радиус джойстика, px

    layer.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.moveEv(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    layer.addEventListener('contextmenu', (e) => e.preventDefault());

    const press = (el, fn) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.add('down');
        fn();
      });
      const off = () => el.classList.remove('down');
      el.addEventListener('pointerup', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('pointercancel', off);
    };
    press(ui.btnJump, () => { this.jump = true; });
    press(ui.btnHook, () => { this.hook = true; });
    press(ui.btnGrab, () => { this.grab = true; });
    press(ui.btnRun, () => { this.runToggle = !this.runToggle; ui.btnRun.classList.toggle('on', this.runToggle); });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') { this.jump = true; e.preventDefault(); }
      if (e.code === 'KeyE' || e.code === 'KeyF') this.hook = true;
      if (e.code === 'KeyQ' || e.code === 'KeyG') this.grab = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  down(e) {
    e.preventDefault();
    if (e.pointerType === 'mouse' && e.button === 2) { this.hook = true; return; }
    const touch = e.pointerType !== 'mouse';
    if (touch && e.clientX < window.innerWidth * 0.45 && this.joy.id === null) {
      this.joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      this.ui.showJoystick(e.clientX, e.clientY);
    } else if (this.look.id === null) {
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  }

  moveEv(e) {
    if (e.pointerId === this.joy.id) {
      this.joy.x = e.clientX; this.joy.y = e.clientY;
      let dx = this.joy.x - this.joy.x0, dy = this.joy.y - this.joy.y0;
      const d = Math.hypot(dx, dy);
      if (d > this.R) { dx *= this.R / d; dy *= this.R / d; }
      this.ui.moveKnob(dx, dy);
    } else if (e.pointerId === this.look.id) {
      this.camDX += e.clientX - this.look.x;
      this.camDY += e.clientY - this.look.y;
      this.look.x = e.clientX; this.look.y = e.clientY;
      this.lastLook = performance.now();
    }
  }

  up(e) {
    if (e.pointerId === this.joy.id) { this.joy.id = null; this.ui.hideJoystick(); }
    if (e.pointerId === this.look.id) this.look.id = null;
  }

  // Снимок ввода на этот кадр.
  read() {
    let mx = 0, my = 0, run = false;
    if (this.joy.id !== null) {
      const dx = this.joy.x - this.joy.x0, dy = this.joy.y - this.joy.y0;
      const d = Math.hypot(dx, dy);
      const k = d > 8 ? Math.min(1, d / this.R) / d : 0;
      mx = dx * k; my = -dy * k;
      run = this.runToggle || d > this.R * 1.25;   // дотянул палец за край — бег
    }
    const K = this.keys;
    const kx = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
    const ky = (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0);
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      mx = kx / l; my = ky / l;
      run = K.has('ShiftLeft') || K.has('ShiftRight') || this.runToggle;
    }
    const out = {
      mx, my, run,
      jump: this.jump, hook: this.hook, grab: this.grab,
      camDX: this.camDX, camDY: this.camDY,
      looking: this.look.id !== null || performance.now() - this.lastLook < 1200,
    };
    this.jump = false; this.hook = false; this.grab = false; this.camDX = 0; this.camDY = 0;
    return out;
  }

  reset() {
    this.joy.id = null; this.look.id = null; this.ui.hideJoystick();
    this.jump = false; this.hook = false; this.grab = false; this.keys.clear();
  }
}
