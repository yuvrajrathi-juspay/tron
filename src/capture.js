// Frame-exact capture support (used only when recording the trailer).
//
// Replaces the page's clock with a virtual one that advances exactly one frame per capture
// step, so the recording is perfectly smooth no matter how long each frame takes to render
// and screenshot. performance.now, setTimeout/setInterval and every CSS/WAAPI animation are
// all moved onto that clock.

export function installVirtualClock() {
  const start = performance.now();
  let now = start;
  let nextId = 1;
  const timers = new Map();

  performance.now = () => now;
  const dateStart = Date.now();
  Date.now = () => dateStart + (now - start);
  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = nextId++;
    timers.set(id, { at: now + Math.max(0, ms), fn, args });
    return id;
  };
  window.setInterval = (fn, ms = 0, ...args) => {
    const id = nextId++;
    timers.set(id, { at: now + Math.max(1, ms), fn, args, every: Math.max(1, ms) });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  window.clearInterval = (id) => timers.delete(id);

  const seen = new WeakSet();
  return {
    get now() { return now; },
    get elapsed() { return (now - start) / 1000; },
    advance(ms) {
      now += ms;
      // run everything that came due, in order (timers may schedule more timers)
      for (let guard = 0; guard < 1000; guard++) {
        let best = null, bestId = 0;
        for (const [id, t] of timers) if (t.at <= now && (!best || t.at < best.at)) { best = t; bestId = id; }
        if (!best) break;
        if (best.every) best.at += best.every; else timers.delete(bestId);
        try { best.fn(...best.args); } catch (e) { console.error(e); }
      }
      // CSS animations/transitions and element.animate(): step them on the virtual clock
      for (const a of document.getAnimations()) {
        if (!seen.has(a)) {
          seen.add(a);
          a.pause();
          a.currentTime = 0;
        } else {
          a.currentTime = (a.currentTime || 0) + ms;
        }
      }
    },
  };
}
