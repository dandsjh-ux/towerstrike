// Rules of the authoritative simulation, driven exactly like the network layer drives it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { sanitizeSettings, defaultSettings, defenderFactor, strikerFactor, baseMaxHp, TOWERS, WEAPONS, towerBox, PLAYER, INTERMISSION } from '../shared/defs.js';
import { T } from '../shared/maps.js';
import { runMatch } from './sim-helpers.js';

function newGame(settings = {}, nStrikers = 2) {
  const s = sanitizeSettings({ prepTime: 15, ...settings }, defaultSettings());
  const players = [{ id: 1, name: 'Def', role: 'defender' }];
  for (let i = 0; i < nStrikers; i++) players.push({ id: 2 + i, name: `S${i}`, role: 'striker' });
  return new Game({ settings: s, players, questions: null, seed: 42 });
}
const run = (g, sec, dt = 1 / 30) => { for (let t = 0; t < sec; t += dt) g.step(dt); };
const privOf = (g, pid) => g.drainPrivate().get(pid) || [];
// A build pad that touches the route mid-way, plus a standing spot on the route next to it.
function padNearRoute(g, minProg = 90) {
  const m = g.map;
  for (let i = 0; i < m.tiles.length; i++) {
    if (m.tiles[i] !== T.PATH || m.progress[i] < minProg) continue;
    const x = i % m.w, z = (i / m.w) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = m.idx(x + dx, z + dz);
      if (m.buildable[j] && !g.occupied.has(j)) { const c = m.tileCenter(x, z); return { tx: x + dx, tz: z + dz, stand: { x: c.x, z: c.z }, pathTile: i }; }
    }
  }
  throw new Error('no pad');
}
function place(a, x, z) { a.x = x; a.z = z; a.y = 0; a.lastPosT = 0; }
function aimAt(a, p) {
  const o = { x: a.x, y: a.y + PLAYER.eye, z: a.z };
  const d = [p.x - o.x, p.y - o.y, p.z - o.z];
  return { o: [o.x, o.y, o.z], d };
}

test('towers are disabled (never destroyed) and come back fully each round', () => {
  const g = newGame();
  g.defender.coins = 5000;
  const p = padNearRoute(g);
  const t = g.onBuild('sentry', p.tx, p.tz);
  assert.ok(t, 'built');
  g.startAssault();
  g.damageTower(t, 99999, 2);
  assert.equal(t.disabled, true);
  assert.ok(g.towers.has(t.id), 'tower still exists');
  const snap = g.snapshot();
  assert.equal(snap.w.find((w) => w[0] === t.id)[9] & 1, 1, 'snapshot flags disabled');
  g.endRound();
  run(g, INTERMISSION + 0.5);
  assert.equal(g.phase, 'prep');
  assert.equal(t.disabled, false);
  assert.equal(t.hp, t.st.maxHp);
});

test('the core never regenerates between rounds', () => {
  const g = newGame();
  g.startAssault();
  g.damageBase(500, 2);
  const left = g.base.hp;
  assert.equal(left, g.base.max - 500);
  g.endRound();
  run(g, INTERMISSION + 20);
  assert.equal(g.round, 2);
  assert.equal(g.base.hp, left);
});

test('build rules: pads for towers, route for traps, coins, occupancy, caps and bans', () => {
  const g = newGame({ bannedTowers: ['laser'] });
  const m = g.map;
  g.defender.coins = 100000;
  const p = padNearRoute(g);
  const pt = p.pathTile, px = pt % m.w, pz = (pt / m.w) | 0;
  assert.equal(g.onBuild('sentry', px, pz), null, 'tower on route rejected');
  assert.equal(g.onBuild('spikes', p.tx, p.tz), null, 'trap on pad rejected');
  assert.ok(g.onBuild('sentry', p.tx, p.tz), 'tower on pad ok');
  assert.equal(g.onBuild('cannon', p.tx, p.tz), null, 'occupied');
  assert.equal(g.onBuild('laser', 0, 0), null, 'banned');
  const trap = [...m.trapable.keys()].find((i) => m.trapable[i]);
  assert.ok(g.onBuild('spikes', trap % m.w, (trap / m.w) | 0), 'trap on route ok');
  let mines = 0;
  for (let i = 0; i < m.tiles.length && mines < 3; i++) if (m.buildable[i] && !g.occupied.has(i)) { if (g.onBuild('goldmine', i % m.w, (i / m.w) | 0)) mines++; else break; }
  assert.equal(mines, 2, 'gold mine cap');
  g.defender.coins = 10;
  const p2 = padNearRoute(g, 150);
  assert.equal(g.onBuild('sentry', p2.tx, p2.tz), null, 'not enough coins');
});

test('rewards scale with squad size: defender earns more, each striker less, core is tougher', () => {
  const s = defaultSettings();
  for (let n = 1; n < 5; n++) {
    assert.ok(defenderFactor(n + 1, s) > defenderFactor(n, s));
    assert.ok(strikerFactor(n + 1, s) < strikerFactor(n, s));
    assert.ok(baseMaxHp(n + 1, s) > baseMaxHp(n, s));
    assert.ok(strikerFactor(n + 1, s) * (n + 1) > strikerFactor(n, s) * n, 'team income still grows');
  }
  const g1 = newGame({}, 1), g5 = newGame({}, 5);
  assert.ok(g5.dFactor > g1.dFactor && g5.sFactor < g1.sFactor && g5.base.max > g1.base.max);
  assert.ok(g5.defender.coins > g1.defender.coins, 'scaled starting budget');
  const flat = newGame({ scaleRewards: false }, 5);
  assert.equal(flat.dFactor, 1); assert.equal(flat.sFactor, 1);
});

test('quiz: answers stay server-side, correct pays, wrong locks out, timeouts count', () => {
  const g = newGame({ questionTime: 10, wrongLockout: 4 }, 3);
  run(g, 2.5);
  let ev = privOf(g, 1);
  const q = ev.find((e) => e.k === 'q');
  assert.ok(q, 'question sent');
  assert.ok(!('answer' in q), 'answer never sent to the client');
  const coins0 = g.defender.coins;
  g.onAnswer(q.id, g.defender.q.answer);
  ev = privOf(g, 1);
  const res = ev.find((e) => e.k === 'qr');
  assert.equal(res.correct, true);
  assert.ok(g.defender.coins - coins0 >= Math.round(25 * g.dFactor), 'scaled coins');
  run(g, 1.6);
  const q2 = privOf(g, 1).find((e) => e.k === 'q');
  const wrong = (g.defender.q.answer + 1) % g.defender.q.options.length;
  g.onAnswer(q2.id, wrong);
  const r2 = privOf(g, 1).find((e) => e.k === 'qr');
  assert.equal(r2.correct, false);
  assert.equal(g.defender.streak, 0);
  assert.ok(g.defender.lockUntil > g.time);
  run(g, 2);
  assert.equal(g.defender.q, null, 'no new question during lockout');
  run(g, 3);
  const q3 = privOf(g, 1).find((e) => e.k === 'q');
  assert.ok(q3);
  run(g, 10.5);
  const r3 = privOf(g, 1).find((e) => e.k === 'qr');
  assert.equal(r3.timeout, true);
  g.onAnswer(q3.id, 0);
  assert.equal(g.defender.stats.timeouts, 1);
});

test('striker fire is validated: phase, ownership, rate limit, magazine and reload', () => {
  const g = newGame();
  g.defender.coins = 5000;
  const p = padNearRoute(g);
  const t = g.onBuild('cannon', p.tx, p.tz);
  const a = g.strikers.get(2);
  place(a, p.stand.x, p.stand.z);
  const box = towerBox(t);
  const shot = aimAt(a, { x: t.x, y: (box.y0 + box.y1) / 2, z: t.z });
  g.onFire(a, { w: 'pistol', ...shot });
  assert.equal(t.hp, t.st.maxHp, 'no shooting during prep');
  g.startAssault();
  place(a, p.stand.x, p.stand.z); a.protectUntil = 0;
  g.onFire(a, { w: 'rifle', ...shot });
  assert.equal(t.hp, t.st.maxHp, 'unowned weapon ignored');
  g.onFire(a, { w: 'pistol', ...shot });
  const afterOne = t.hp;
  assert.ok(afterOne < t.st.maxHp, 'hit registers');
  g.onFire(a, { w: 'pistol', ...shot });
  assert.equal(t.hp, afterOne, 'rate limited within the same instant');
  assert.equal(a.mag.pistol, WEAPONS.pistol.mag - 1);
  for (let i = 0; i < 20; i++) { g.time += 0.3; g.onFire(a, { w: 'pistol', ...shot }); }
  assert.equal(a.mag.pistol, 0, 'cannot exceed the magazine');
  g.onReload(a);
  run(g, WEAPONS.pistol.reload + 0.1);
  assert.equal(a.mag.pistol, WEAPONS.pistol.mag);
  const hm = privOf(g, 2).filter((e) => e.k === 'hm');
  assert.ok(hm.length >= 1, 'hit markers sent');
});

test('strikers are confined to the route; teleports and off-route positions are corrected', () => {
  const g = newGame();
  g.startAssault();
  const a = g.strikers.get(2);
  const x0 = a.x, z0 = a.z;
  g.time += 0.1;
  g.onState(a, { x: x0 + 0.5, y: 0, z: z0, yaw: 0, pitch: 0 });
  assert.equal(a.x, x0 + 0.5, 'small legal move accepted');
  g.time += 0.1;
  g.onState(a, { x: a.x + 60, y: 0, z: a.z });
  assert.equal(a.x, x0 + 0.5, 'teleport rejected');
  const grass = [...g.map.tiles.keys()].find((i) => g.map.tiles[i] === T.GRASS && g.map.distWalk[i] === 1);
  const c = g.map.tileCenter(grass % g.map.w, (grass / g.map.w) | 0);
  g.time += 5;
  g.onState(a, { x: c.x, y: 0, z: c.z });
  assert.notEqual(a.x, c.x, 'leaving the route rejected');
  assert.ok(privOf(g, 2).some((e) => e.k === 'tp'), 'client told to snap back');
});

test("core shield: damage only counts from inside the plaza; lockdown caps a round's damage", () => {
  const g = newGame({ coreBreachCap: 35 });
  g.startAssault();
  const a = g.strikers.get(2);
  a.protectUntil = 0;
  const b = g.map.base;
  // outside: stand on the route far from the plaza
  const far = g.map.pointAt(g.map.pathLen * 0.6);
  place(a, far.x, far.z);
  g.onFire(a, { w: 'pistol', ...aimAt(a, { x: b.x, y: 4, z: b.z }) });
  assert.equal(g.base.hp, g.base.max, 'shielded from afar');
  // inside the plaza
  const pl = g.map.def.plaza;
  place(a, (pl[0] + 0.5) * 4, (pl[1] + 0.5) * 4);
  g.time += 1;
  g.onFire(a, { w: 'pistol', ...aimAt(a, { x: b.x, y: 4, z: b.z }) });
  assert.ok(g.base.hp < g.base.max, 'damage from the plaza');
  for (let i = 0; i < 2000 && !g.locked; i++) g.damageBase(50, 2);
  assert.equal(g.locked, true);
  assert.ok(g.base.max - g.base.hp <= g.base.max * 0.35 + 1, 'capped at 35%');
  const hp = g.base.hp;
  g.damageBase(500, 2);
  assert.equal(g.base.hp, hp, 'locked down');
  g.endRound(); run(g, INTERMISSION + 0.5);
  assert.equal(g.locked, false, 'lockdown lifts next round');
});

test('barricades block the route until knocked down', () => {
  const g = newGame();
  g.defender.coins = 5000;
  const m = g.map;
  const i = [...m.trapable.keys()].find((k) => m.trapable[k] && m.progress[k] > 100);
  const c = m.tileCenter(i % m.w, (i / m.w) | 0);
  const t = g.onBuild('barricade', i % m.w, (i / m.w) | 0);
  assert.ok(t);
  assert.equal(m.canWalk(c.x, c.z, 0.3, g.blocked), false);
  g.startAssault();
  g.damageTower(t, 99999, 2);
  assert.equal(m.canWalk(c.x, c.z, 0.3, g.blocked), true);
});

test('checkpoints capture only once nearby towers are cleared, then become respawn points', () => {
  const g = newGame({}, 1);
  g.defender.coins = 5000;
  const cp = g.checkpoints[0];
  const m = g.map;
  let tower = null;
  for (let k = 0; k < m.tiles.length && !tower; k++) {
    if (!m.buildable[k]) continue;
    const c = m.tileCenter(k % m.w, (k / m.w) | 0);
    if (Math.hypot(c.x - cp.x, c.z - cp.z) < 15) tower = g.onBuild('sentry', k % m.w, (k / m.w) | 0);
  }
  assert.ok(tower, 'tower near checkpoint');
  g.startAssault();
  const a = g.strikers.get(2);
  const hold = () => { a.alive = true; a.hp = 999; place(a, cp.x, cp.z); };
  for (let i = 0; i < 300; i++) { hold(); g.step(1 / 30); }
  assert.equal(cp.captured, false, 'contested by an online tower');
  g.damageTower(tower, 99999, 2);
  for (let i = 0; i < 240; i++) { hold(); g.step(1 / 30); }
  assert.equal(cp.captured, true);
  const sp = g.spawnPoint(true);
  assert.ok(Math.hypot(sp.x - cp.x, sp.z - cp.z) < 5, 'respawns at the checkpoint');
});

test('shop: open in prep and in spawn, closed out on the route during the assault', () => {
  const g = newGame();
  const a = g.strikers.get(2);
  assert.equal(g.onBuy(a, 'w:smg'), true);
  assert.ok(a.owned.has('smg'));
  g.startAssault();
  assert.equal(g.onBuy(a, 'e:medkit'), true, 'buy in spawn');
  const far = g.map.pointAt(g.map.pathLen * 0.5);
  place(a, far.x, far.z);
  assert.equal(g.onBuy(a, 'e:frag'), false, 'no shopping mid-route');
});

test('support troops deploy at assault start and fight towers', () => {
  const g = newGame();
  g.defender.coins = 5000;
  const a = g.strikers.get(2);
  a.coins = 5000;
  assert.equal(g.onBuy(a, 't:grunts'), true);
  assert.equal(g.onBuy(a, 't:mech'), true);
  const first = padNearRoute(g, 20);
  const t = g.onBuild('barricade', ...(() => { const m = g.map; const i = [...m.trapable.keys()].find((k) => m.trapable[k]); return [i % m.w, (i / m.w) | 0]; })());
  g.startAssault();
  let maxTroops = 0;
  for (let i = 0; i < 30 * 40; i++) { g.step(1 / 30); maxTroops = Math.max(maxTroops, g.troops.size); }
  assert.equal(maxTroops, 4, '3 grunts + 1 mech');
  assert.ok(t.disabled || t.hp < t.st.maxHp, 'troops attacked the barricade blocking them');
  assert.ok(first);
});

test('settings are sanitised and clamped', () => {
  const s = sanitizeSettings({ rounds: 999, prepTime: -5, mapId: 'nope', scaleRewards: 0, bannedWeapons: ['rifle', 'pistol', 'bogus'], coreBreachCap: 40 });
  assert.equal(s.rounds, 10);
  assert.equal(s.prepTime, 15);
  assert.equal(s.mapId, 'meadow');
  assert.equal(s.scaleRewards, false);
  assert.deepEqual(s.bannedWeapons, ['rifle']);
  assert.equal(s.coreBreachCap, 40);
});

test('a full bot match always ends with a winner and sensible stats', () => {
  const g = runMatch({ nStrikers: 3, seed: 99 });
  assert.ok(g.over);
  assert.ok(['defender', 'strikers'].includes(g.winner));
  const r = g.results();
  assert.equal(r.players.length, 4);
  assert.ok(r.players.find((p) => p.role === 'defender').correct > 0, 'bot defender answered questions');
  assert.ok(r.players.filter((p) => p.role === 'striker').reduce((s, p) => s + p.disables, 0) > 0, 'strikers disabled towers');
});

test('results report whole-number coins and points', () => {
  const g = runMatch({ nStrikers: 2, seed: 5 });
  for (const p of g.results().players) {
    assert.ok(Number.isInteger(p.coinsEarned), `${p.name} coins ${p.coinsEarned}`);
    assert.ok(Number.isInteger(p.points));
  }
});
