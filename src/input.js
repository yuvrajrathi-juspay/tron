// Keyboard input as game intents. Everything that drives the bike is held:
// A/D steer, W throttle, S brake, Shift boost. Space (jump) is edge-triggered.
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const THROTTLE = new Set(['KeyW', 'ArrowUp']);
const BRAKE = new Set(['KeyS', 'ArrowDown']);
const BOOST = new Set(['ShiftLeft', 'ShiftRight']);
const JUMP = new Set(['Space']);
const GAME_KEYS = new Set([...LEFT, ...RIGHT, ...THROTTLE, ...BRAKE, ...BOOST, ...JUMP]);

export class Input {
  constructor() {
    this.held = new Set();
    this.jump = false;
    this.touch = { left: false, right: false, gas: false, brake: false, boost: false }; // fed by TouchControls
    this.handlers = {};
    window.addEventListener('keydown', (e) => this.down(e));
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
  }

  on(name, fn) { this.handlers[name] = fn; }

  down(e) {
    if (e.target instanceof HTMLInputElement) return;
    const c = e.code;
    if (GAME_KEYS.has(c)) e.preventDefault();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!e.repeat) {
      if (JUMP.has(c)) this.jump = true;
      if (c === 'Escape' || c === 'KeyP') this.handlers.pause?.();
      if (c === 'KeyM') this.handlers.mute?.();
      if (c === 'Enter' || c === 'Space') this.handlers.confirm?.(c);
      if (LEFT.has(c)) this.handlers.left?.();
      if (RIGHT.has(c)) this.handlers.right?.();
    }
    this.held.add(c);
  }

  isHeld(set) {
    for (const c of set) if (this.held.has(c)) return true;
    return false;
  }

  // -1 full left, +1 full right, 0 when neither (or both) are held
  get steer() {
    const r = this.isHeld(RIGHT) || this.touch.right, l = this.isHeld(LEFT) || this.touch.left;
    return (r ? 1 : 0) - (l ? 1 : 0);
  }
  get throttle() { return this.isHeld(THROTTLE) || this.touch.gas; }
  get brake() { return this.isHeld(BRAKE) || this.touch.brake; }
  get boost() { return this.isHeld(BOOST) || this.touch.boost; }

  takeJump() {
    const j = this.jump;
    this.jump = false;
    return j;
  }

  clear() {
    this.held.clear();
    this.jump = false;
  }
}
