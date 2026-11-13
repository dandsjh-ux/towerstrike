// Balance regression: bot defender vs 1..5 bot strikers on every map with fixed seeds (deterministic).
// Bots use exactly the same server handlers as human players. For the full report run: npm run balance
import test from 'node:test';
import assert from 'node:assert/strict';
import { runMatch, summarize } from './sim-helpers.js';
import { MAP_IDS } from '../shared/maps.js';

const SEEDS = 6; // per map per team size => 18 matches per team size

test('bot-vs-bot matches stay balanced for every squad size', { timeout: 600000 }, () => {
  const rates = [];
  for (let n = 1; n <= 5; n++) {
    let wins = 0, total = 0, rounds = 0;
    for (const mapId of MAP_IDS) {
      for (let s = 1; s <= SEEDS; s++) {
        const r = summarize(runMatch({ nStrikers: n, seed: 1000 + s * 97 + n * 7 + mapId.length, settings: { mapId } }));
        wins += r.winner === 'defender' ? 1 : 0; total++; rounds += r.rounds;
      }
    }
    const rate = wins / total;
    rates.push(rate);
    // With 18 samples the standard error is ~0.12, so allow a generous corridor around 50%.
    assert.ok(rate >= 0.2 && rate <= 0.8, `n=${n}: defender win rate ${rate.toFixed(2)} outside [0.2, 0.8]`);
    assert.ok(rounds / total >= 3, `n=${n}: matches should usually go the distance (avg ${(rounds / total).toFixed(1)} rounds)`);
  }
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  assert.ok(avg >= 0.35 && avg <= 0.65, `overall defender win rate ${avg.toFixed(2)}`);
});
