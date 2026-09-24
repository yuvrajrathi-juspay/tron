// Arena definitions. Pure data: the terrain engine, simulation, bots, renderer, minimap
// and menu previews are all generated from these.
//
// Headings follow the game convention: forward = (sin θ, -cos θ); θ = 0 faces north (-z).

const P = Math.PI;
const toward = (x, z, tx = 0, tz = 0) => Math.atan2(tx - x, -(tz - z)); // heading from (x,z) toward (tx,tz)
const ccw = (x, z) => Math.atan2(z, x);                                  // tangent heading (pinwheel flow)

function ring(n, r, a0 = 0) {
  return Array.from({ length: n }, (_, k) => {
    const a = a0 + (k * 2 * P) / n;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}

export const MAPS = {
  grid: {
    id: 'grid',
    name: 'THE GRID',
    tagline: 'The classic. Flat, fast, nowhere to hide.',
    blurb: ['Classic flat arena', 'Mirror-finish floor', 'Pure light-cycle duel'],
    half: 92,
    spawnR: 60,
    spawnA0: P / 2,
    suddenAt: 40,
    shrinkRate: 2.4,
    minHalf: 22,
    mirror: true,
    theme: 'grid',
    accent: '#22e8ff',
    features: [],
    pads: [],
    portals: [],
    sweepers: [],
    pickups: [],
    music: { bpm: 112, roots: [45, 41, 48, 43], chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]] },
  },

  mesa: {
    id: 'mesa',
    name: 'SUNDOWN MESA',
    tagline: 'Climb the mesa, fly off the edge, ride the dunes at dusk.',
    blurb: ['Raised mesa with 4 ramps', 'Launch kickers & air-time dunes', 'Boost pads · Ghost on the summit'],
    half: 138,
    spawnR: 98,
    spawnA0: P / 4,
    suddenAt: 55,
    shrinkRate: 3.4,
    minHalf: 30,
    mirror: false,
    theme: 'mesa',
    accent: '#ff5fa2',
    features: [
      { type: 'mesa', x: 0, z: 0, w: 48, d: 48, h: 6 },
      // four ramps up onto the mesa (their tops meet its edge)
      { type: 'ramp', x: 0, z: 39, heading: 0, length: 30, width: 12, h: 6, attach: true },
      { type: 'ramp', x: 0, z: -39, heading: P, length: 30, width: 12, h: 6, attach: true },
      { type: 'ramp', x: 39, z: 0, heading: -P / 2, length: 30, width: 12, h: 6, attach: true },
      { type: 'ramp', x: -39, z: 0, heading: P / 2, length: 30, width: 12, h: 6, attach: true },
      // corner kickers that fling you toward the middle
      ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz]) => ({
        type: 'ramp', x: sx * 84, z: sz * 84, heading: toward(sx * 84, sz * 84), length: 14, width: 9, h: 3.2,
      })),
      // rolling dunes: hit them fast and you're airborne
      ...ring(8, 112, P / 8).map(([x, z]) => ({ type: 'bump', x, z, r: 13, h: 2.6 })),
      ...ring(4, 76, 0).map(([x, z]) => ({ type: 'bump', x, z, r: 9, h: 2.1 })),
    ],
    pads: [
      ...ring(4, 124, 0).map(([x, z]) => ({ x, z, heading: ccw(x, z), length: 16, width: 5 })),
      ...ring(4, 62, P / 4).map(([x, z]) => ({ x, z, heading: ccw(x, z), length: 12, width: 5 })),
    ],
    portals: [],
    sweepers: [],
    pickups: [
      { x: 0, z: 0, type: 'ghost' },
      ...ring(4, 76, 0).map(([x, z]) => ({ x, z, type: 'boost' })),
      ...ring(4, 100, 0).map(([x, z]) => ({ x, z, type: 'jump' })),
    ],
    music: { bpm: 100, roots: [42, 38, 45, 40], chords: [[54, 57, 61], [50, 54, 57], [52, 57, 61], [52, 56, 59]] },
  },

  orbital: {
    id: 'orbital',
    name: 'ORBITAL RIFT',
    tagline: 'A station deck in deep space. Mind the lasers. Mind the gaps.',
    blurb: ['Rotating reactor lasers (jump them!)', 'Void pits with launch kickers', 'Corner-to-corner portals'],
    half: 138,
    spawnR: 98,
    spawnA0: P / 4,
    suddenAt: 55,
    shrinkRate: 3.4,
    minHalf: 30,
    mirror: false,
    theme: 'orbital',
    accent: '#9d7bff',
    features: [
      { type: 'pillar', x: 0, z: 0, r: 7, h: 30 },
      // void pits in a ring
      { type: 'pit', x: 0, z: -72, w: 34, d: 12 },
      { type: 'pit', x: 0, z: 72, w: 34, d: 12 },
      { type: 'pit', x: 72, z: 0, w: 12, d: 34 },
      { type: 'pit', x: -72, z: 0, w: 12, d: 34 },
      // kickers on both sides of every pit, lips 3m from the edge, in separate lanes so each
      // jump lands on open deck (never on the back of the kicker facing the other way)
      { type: 'ramp', x: -9, z: -58, heading: 0, length: 10, width: 10, h: 3.5 },
      { type: 'ramp', x: 9, z: -86, heading: P, length: 10, width: 10, h: 3.5 },
      { type: 'ramp', x: 9, z: 58, heading: P, length: 10, width: 10, h: 3.5 },
      { type: 'ramp', x: -9, z: 86, heading: 0, length: 10, width: 10, h: 3.5 },
      { type: 'ramp', x: 58, z: 9, heading: P / 2, length: 10, width: 10, h: 3.5 },
      { type: 'ramp', x: 86, z: -9, heading: -P / 2, length: 10, width: 10, h: 3.5 },
      { type: 'ramp', x: -58, z: -9, heading: -P / 2, length: 10, width: 10, h: 3.5 },
      { type: 'ramp', x: -86, z: 9, heading: P / 2, length: 10, width: 10, h: 3.5 },
      // a few swells in the deck plating
      ...[[40, 112], [-112, 40], [-40, -112], [112, -40]].map(([x, z]) => ({ type: 'bump', x, z, r: 10, h: 2.2 })),
    ],
    pads: ring(4, 121, 0).map(([x, z]) => ({ x, z, heading: ccw(x, z), length: 16, width: 5 })),
    portals: [
      { a: [-112, -112], b: [112, 112], color: '#b58cff' },
      { a: [112, -112], b: [-112, 112], color: '#ffb020' },
    ],
    sweepers: [{ x: 0, z: 0, inner: 7, len: 44, arms: 2, speed: 0.3, phase: 0.4 }],
    pickups: [
      { x: 28, z: 28, type: 'ghost' },
      { x: -28, z: -28, type: 'ghost' },
      { x: 50, z: -50, type: 'boost' },
      { x: -50, z: 50, type: 'boost' },
      ...ring(4, 106, 0).map(([x, z]) => ({ x, z, type: 'jump' })),
    ],
    music: { bpm: 124, roots: [38, 34, 41, 36], chords: [[50, 53, 57], [46, 50, 53], [48, 53, 57], [48, 52, 55]] },
  },
};

export const MAP_ORDER = ['grid', 'mesa', 'orbital'];
