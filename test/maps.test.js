import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, MAP_IDS, T } from '../shared/maps.js';
import { TILE } from '../shared/defs.js';

for (const id of MAP_IDS) {
  test(`map ${id}: route connects spawn to the core plaza`, () => {
    const m = buildMap(id);
    const walk = (i) => [T.PATH, T.SPAWN, T.PLAZA].includes(m.tiles[i]);
    const start = m.tileAt(m.spawn.x, m.spawn.z);
    const seen = new Set([start]);
    const q = [start];
    while (q.length) {
      const i = q.shift(), x = i % m.w, z = (i / m.w) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= m.w || nz >= m.h) continue;
        const j = m.idx(nx, nz);
        if (!seen.has(j) && walk(j)) { seen.add(j); q.push(j); }
      }
    }
    const plaza = [...m.tiles.keys()].filter((i) => m.tiles[i] === T.PLAZA);
    assert.ok(plaza.length > 0);
    for (const i of plaza) assert.ok(seen.has(i), 'plaza reachable');
    const all = [...m.tiles.keys()].filter(walk);
    assert.equal(seen.size, all.length, 'no isolated route pockets');
  });

  test(`map ${id}: corridors never merge (forced single route)`, () => {
    const m = buildMap(id);
    for (let i = 0; i < m.tiles.length; i++) {
      if (m.tiles[i] !== T.PATH) continue;
      const x = i % m.w, z = (i / m.w) | 0;
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const j = m.idx(x + dx, z + dz);
        if (x + dx >= m.w || z + dz >= m.h || m.tiles[j] !== T.PATH) continue;
        assert.ok(Math.abs(m.progress[i] - m.progress[j]) <= 3 * TILE, `adjacent route tiles ${i},${j} belong to different stretches`);
      }
    }
  });

  test(`map ${id}: enough build pads and trap tiles, none on the route`, () => {
    const m = buildMap(id);
    let pads = 0, traps = 0;
    for (let i = 0; i < m.tiles.length; i++) {
      if (m.buildable[i]) { pads++; assert.equal(m.tiles[i], T.GRASS); assert.ok(m.distSpawn[i] > 3, 'no towers hugging spawn'); }
      if (m.trapable[i]) { traps++; assert.equal(m.tiles[i], T.PATH); }
    }
    assert.ok(pads > 300, `pads ${pads}`);
    assert.ok(traps > 80, `traps ${traps}`);
    assert.ok(m.pathLen > 250 && m.pathLen < 450, `length ${m.pathLen}`);
  });

  test(`map ${id}: walk collision keeps strikers on the route`, () => {
    const m = buildMap(id);
    assert.ok(m.canWalk(m.spawn.x, m.spawn.z));
    for (let i = 0; i < m.tiles.length; i++) {
      const x = (i % m.w + 0.5) * TILE, z = (((i / m.w) | 0) + 0.5) * TILE;
      const t = m.tiles[i];
      if (t === T.GRASS || t === T.WATER || t === T.BASE) assert.equal(m.canWalk(x, z), false);
    }
    assert.equal(m.canWalk(m.base.x, m.base.z), false, 'the core is solid');
    for (const c of m.checkpoints) assert.ok(m.canWalk(c.x, c.z), 'checkpoints are on the route');
  });
}
