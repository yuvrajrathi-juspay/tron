import { ARENA_HALF } from './config.js';
import { walkCells } from './spatial.js';

// Coarse occupancy grid of the arena. The simulation rasterises every light wall into it;
// the bots flood-fill it to judge how much room each direction leaves them.
export class Grid {
  constructor(half = ARENA_HALF, cell = 2) {
    this.half = half;
    this.cell = cell;
    this.n = Math.ceil((2 * half) / cell);
    this.cells = new Uint8Array(this.n * this.n);
    this.seen = new Uint32Array(this.n * this.n);
    this.queue = new Int32Array(this.n * this.n);
    this.stamp = 1;
  }

  // Cells that are always blocked on this map (void pits, the reactor pillar).
  setStatic(blockedAt) {
    const n = this.n;
    this.static = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -this.half + (i + 0.5) * this.cell, z = -this.half + (j + 0.5) * this.cell;
        if (blockedAt(x, z)) this.static[j * n + i] = 1;
      }
    }
    this.clear();
  }

  clear() {
    if (this.static) this.cells.set(this.static);
    else this.cells.fill(0);
  }

  ci(v) {
    return Math.floor((v + this.half) / this.cell);
  }

  // Marks every cell a wall from (ax, az) to (bx, bz) passes through (any direction, no corner gaps).
  markLine(ax, az, bx, bz) {
    const cells = this.cells, n = this.n;
    walkCells(ax, az, bx, bz, this.cell, this.half, n, (i, j) => { cells[j * n + i] = 1; });
  }

  // A cell is blocked when a wall passes through it or it lies outside the current (shrinking) arena.
  blocked(i, j, curHalf) {
    const n = this.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return true;
    if (this.cells[j * n + i]) return true;
    const c = this.cell;
    const cx = -this.half + (i + 0.5) * c;
    const cz = -this.half + (j + 0.5) * c;
    const lim = curHalf - c * 0.5;
    return cx > lim || cx < -lim || cz > lim || cz < -lim;
  }

  // Breadth-first count of free cells reachable from (x, z), stopping at `cap`.
  flood(x, z, cap, curHalf) {
    const n = this.n;
    const i0 = this.ci(x), j0 = this.ci(z);
    if (this.blocked(i0, j0, curHalf)) return 0;
    const seen = this.seen, q = this.queue;
    const s = ++this.stamp;
    if (s > 0xfffffff0) { seen.fill(0); this.stamp = 1; }
    const st = this.stamp;
    let head = 0, tail = 0;
    q[tail++] = j0 * n + i0;
    seen[j0 * n + i0] = st;
    let count = 0;
    while (head < tail && count < cap) {
      const k = q[head++];
      count++;
      const i = k % n, j = (k - i) / n;
      // unrolled 4-neighbourhood
      if (i > 0) { const m = k - 1; if (seen[m] !== st) { seen[m] = st; if (!this.blocked(i - 1, j, curHalf)) q[tail++] = m; } }
      if (i < n - 1) { const m = k + 1; if (seen[m] !== st) { seen[m] = st; if (!this.blocked(i + 1, j, curHalf)) q[tail++] = m; } }
      if (j > 0) { const m = k - n; if (seen[m] !== st) { seen[m] = st; if (!this.blocked(i, j - 1, curHalf)) q[tail++] = m; } }
      if (j < n - 1) { const m = k + n; if (seen[m] !== st) { seen[m] = st; if (!this.blocked(i, j + 1, curHalf)) q[tail++] = m; } }
    }
    return count;
  }
}
