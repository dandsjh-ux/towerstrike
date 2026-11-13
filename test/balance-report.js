// Bot-vs-bot balance report.  Usage: node test/balance-report.js [seeds=24] [maps=meadow,riverbend,windmill] [skill=normal]
// Runs full matches (bot defender vs 1..5 bot strikers) and prints the defender win-rate and average base HP left.
import { runMatch, summarize } from './sim-helpers.js';
import { MAP_IDS } from '../shared/maps.js';

const seeds = Number(process.argv[2] || 24);
const maps = (process.argv[3] || MAP_IDS.join(',')).split(',');
const skill = process.argv[4] || 'normal';
const t0 = Date.now();
const rows = [];
for (const mapId of maps) {
  for (let n = 1; n <= 5; n++) {
    const res = [];
    for (let s = 1; s <= seeds; s++) res.push(summarize(runMatch({ nStrikers: n, seed: s * 7349 + n * 31 + mapId.length, settings: { mapId, botSkill: skill } })));
    const avg = (k) => res.reduce((a, r) => a + r[k], 0) / res.length;
    rows.push({
      map: mapId, strikers: n,
      defWin: (res.filter((r) => r.winner === 'defender').length / res.length).toFixed(2),
      baseLeft: avg('baseFrac').toFixed(2),
      rounds: avg('rounds').toFixed(1),
      towers: avg('towers').toFixed(0),
      disables: avg('disables').toFixed(0),
      deaths: avg('deaths').toFixed(0),
      defCoins: avg('defCoins').toFixed(0),
      strCoins: avg('strCoins').toFixed(0),
    });
  }
}
console.table(rows);
const all = rows.map((r) => Number(r.defWin));
console.log(`Overall defender win rate ${(all.reduce((a, b) => a + b, 0) / all.length).toFixed(2)} | mean |dev| from 0.5 = ${(all.reduce((a, b) => a + Math.abs(b - 0.5), 0) / all.length).toFixed(2)} | ${seeds} seeds per cell | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
