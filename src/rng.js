// Seeded randomness. Gameplay (sim + bots) draws from `rand`, visual flourishes from `vrand`,
// so test hooks can replay a round exactly while effects keep their own stream.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let game = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
let visual = mulberry32((Date.now() * 7 + 11) >>> 0);

export function rand() { return game(); }
export function vrand() { return visual(); }
export function seedRandom(seed) {
  game = mulberry32(seed >>> 0);
  visual = mulberry32((seed * 2654435761 + 1) >>> 0);
}
