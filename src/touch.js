// On-screen controls for phones and tablets. Each button is multi-touch aware (pointer
// capture per finger), feeds the same intents as the keyboard, and never gets stuck:
// pointerup, pointercancel, lostpointercapture, blur and visibility changes all release it.

const BUTTONS = [
  { id: 'left', label: '◀', cls: 'steer l', aria: 'Steer left' },
  { id: 'right', label: '▶', cls: 'steer r', aria: 'Steer right' },
  { id: 'gas', label: 'GAS', cls: 'gas', aria: 'Throttle' },
  { id: 'brake', label: 'BRAKE', cls: 'brake', aria: 'Brake' },
  { id: 'boost', label: 'BOOST', cls: 'boost', aria: 'Boost' },
  { id: 'jump', label: 'JUMP', cls: 'jump', aria: 'Jump' },
];

export function isTouchDevice() {
  const q = new URLSearchParams(location.search);
  if (q.has('touch')) return true;
  if (q.has('notouch')) return false;
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
}

export class TouchControls {
  constructor(input, handlers = {}) {
    this.input = input;
    this.handlers = handlers;
    this.root = document.getElementById('touch');
    this.pointers = new Map(); // pointerId -> button id
    this.els = {};
    for (const b of BUTTONS) {
      const el = document.createElement('button');
      el.className = `tbtn ${b.cls}`;
      el.dataset.id = b.id;
      el.setAttribute('aria-label', b.aria);
      el.innerHTML = `<span>${b.label}</span>${b.id === 'jump' || b.id === 'boost' ? '<i class="meter"></i>' : ''}`;
      el.addEventListener('pointerdown', (e) => this.down(e, b.id));
      el.addEventListener('pointerup', (e) => this.up(e));
      el.addEventListener('pointercancel', (e) => this.up(e));
      el.addEventListener('lostpointercapture', (e) => this.up(e));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      this.root.appendChild(el);
      this.els[b.id] = el;
    }
    this.pause = document.getElementById('tpause');
    this.pause.addEventListener('pointerdown', (e) => { e.preventDefault(); handlers.pause?.(); });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    this.root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  down(e, id) {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
    this.pointers.set(e.pointerId, id);
    this.els[id].classList.add('on');
    if (id === 'jump') this.input.jump = true;
    if (id === 'left') this.handlers.left?.();
    if (id === 'right') this.handlers.right?.();
    if (navigator.vibrate) navigator.vibrate(8);
    this.sync();
  }

  up(e) {
    const id = this.pointers.get(e.pointerId);
    if (id === undefined) return;
    this.pointers.delete(e.pointerId);
    if (![...this.pointers.values()].includes(id)) this.els[id].classList.remove('on');
    this.sync();
  }

  releaseAll() {
    this.pointers.clear();
    for (const el of Object.values(this.els)) el.classList.remove('on');
    this.sync();
  }

  sync() {
    const held = new Set(this.pointers.values());
    const t = this.input.touch;
    t.left = held.has('left');
    t.right = held.has('right');
    t.gas = held.has('gas');
    t.brake = held.has('brake');
    t.boost = held.has('boost');
  }

  show(v) {
    this.root.hidden = !v;
    this.pause.hidden = !v;
    if (!v) this.releaseAll();
  }

  // Live meters on the buttons: jump recharge ring and boost fuel.
  update(rider) {
    const j = Math.round(rider.jump * 100), b = Math.round(rider.boost * 100);
    if (j !== this.lastJ) { this.lastJ = j; this.els.jump.style.setProperty('--p', j); this.els.jump.classList.toggle('ready', j >= 100); }
    if (b !== this.lastB) { this.lastB = b; this.els.boost.style.setProperty('--p', b); }
  }
}
