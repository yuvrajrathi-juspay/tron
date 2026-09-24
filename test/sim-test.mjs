// Headless bot-vs-bot simulation on every map: checks the rules never throw, rounds always end,
// reports death causes and feature usage, and compares bot difficulties against a stand-in "player".
import { Sim } from '../src/sim.js';
import { Bot } from '../src/ai.js';
import { MAPS, MAP_ORDER } from '../src/maps.js';

function run(mapId, playerDiff, botDiff, rounds, dt = 1 / 120) {
  const sim = new Sim(MAPS[mapId]);
  const bots = sim.riders.map((r, i) => (i === 0 ? new Bot(sim, r, playerDiff, 'survivor') : new Bot(sim, r, botDiff)));
  const st = { wins: [0, 0, 0, 0], draws: 0, dur: [], causes: {}, feats: {}, maxY: 0 };
  for (let k = 0; k < rounds; k++) {
    sim.startRound();
    bots.forEach((b) => b.reset());
    let t = 0;
    while (!(sim.over && sim.overTime > 0.5)) {
      for (const b of bots) b.update(dt);
      sim.step(dt);
      t += dt;
      for (const r of sim.riders) if (r.alive) st.maxY = Math.max(st.maxY, r.y);
      for (const e of sim.events) {
        if (e.type === 'crash') st.causes[e.cause] = (st.causes[e.cause] || 0) + 1;
        else if (['pad', 'portal', 'pickup', 'bigAir', 'nearMiss', 'jump'].includes(e.type)) st.feats[e.type] = (st.feats[e.type] || 0) + 1;
      }
      sim.events.length = 0;
      if (!sim.riders[0].alive) sim.hurry();
      if (t > 400) throw new Error(`round never ended on ${mapId}`);
      for (const r of sim.riders) if (Number.isNaN(r.x + r.z + r.y)) throw new Error('NaN position');
    }
    st.dur.push(sim.time);
    if (sim.winner) st.wins[sim.winner.id]++; else st.draws++;
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return { map: mapId, playerDiff, botDiff, wins: st.wins.join('/'), draws: st.draws, avgRound: +avg(st.dur).toFixed(1), maxRound: +Math.max(...st.dur).toFixed(1), maxY: +st.maxY.toFixed(1), causes: st.causes, feats: st.feats };
}

const N = Number(process.argv[2] || 60);
const only = process.argv[3];
const t0 = performance.now();
for (const id of MAP_ORDER) {
  if (only && id !== only) continue;
  for (const [p, b] of [['ace', 'pilot'], ['pilot', 'pilot'], ['rookie', 'pilot']]) console.log(JSON.stringify(run(id, p, b, N)));
}
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
