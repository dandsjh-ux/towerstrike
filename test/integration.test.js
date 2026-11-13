// End-to-end: real server process, real WebSocket clients, full lobby -> match -> results flow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';
import { buildMap, T } from '../shared/maps.js';
import { towerBox, PLAYER } from '../shared/defs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let proc, port;

test.before(async () => {
  proc = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: '0', HOST: '127.0.0.1' } });
  port = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not start')), 10000);
    proc.stdout.on('data', (d) => { const m = /localhost:(\d+)/.exec(String(d)); if (m) { clearTimeout(to); resolve(Number(m[1])); } });
    proc.on('exit', (c) => reject(new Error(`server exited ${c}`)));
  });
});
test.after(() => { proc?.kill(); });

class Client {
  constructor(name) {
    this.name = name; this.msgs = []; this.waiters = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', (d) => { const m = JSON.parse(String(d)); this.msgs.push(m); this.waiters = this.waiters.filter((w) => !w(m)); });
  }
  open() { return new Promise((r) => this.ws.once('open', r)); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(pred, ms = 6000, label = '') {
    const found = this.msgs.find(pred);
    if (found) { this.msgs.splice(this.msgs.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error(`${this.name}: timeout waiting ${label}`)), ms);
      this.waiters.push((m) => { if (pred(m)) { clearTimeout(to); this.msgs.splice(this.msgs.indexOf(m), 1); resolve(m); return true; } return false; });
    });
  }
  waitPriv(k, ms, extra = () => true) { return this.wait((m) => m.t === 'p' && m.e.some((e) => e.k === k && extra(e)), ms, `priv ${k}`).then((m) => m.e.find((e) => e.k === k && extra(e))); }
  latestRoom() { return [...this.msgs].reverse().find((m) => m.t === 'room'); }
  close() { this.ws.close(); }
}

test('health and static endpoints', async () => {
  const h = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(await h.text(), 'ok');
  const idx = await fetch(`http://127.0.0.1:${port}/`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(idx.status, 200);
  assert.match(await idx.text(), /TowerStrike/);
  const three = await fetch(`http://127.0.0.1:${port}/vendor/three/three.module.js`);
  assert.equal(three.status, 200);
  const shared = await fetch(`http://127.0.0.1:${port}/shared/defs.js`);
  assert.equal(shared.status, 200);
  const trav = await fetch(`http://127.0.0.1:${port}/shared/..%2Fpackage.json`);
  assert.equal(trav.status, 404, 'no path traversal');
  const csv = await fetch(`http://127.0.0.1:${port}/sample-questions.csv`);
  assert.match(await csv.text(), /^question,option_a/);
});

test('full multiplayer flow: 6 players, roles, CSV upload, host controls, combat, results', async () => {
  const host = new Client('host');
  await host.open();
  host.send({ t: 'create', name: 'Host' });
  const w = await host.wait((m) => m.t === 'welcome');
  const code = w.code;
  assert.match(code, /^[A-Z0-9]{4}$/);

  // 5 more players join; a 7th is turned away
  const others = [];
  for (let i = 0; i < 5; i++) {
    const c = new Client(`p${i}`); await c.open();
    c.send({ t: 'join', code, name: `P${i}` });
    c.welcome = await c.wait((m) => m.t === 'welcome');
    others.push(c);
  }
  const extra = new Client('extra'); await extra.open();
  extra.send({ t: 'join', code, name: 'Late' });
  const full = await extra.wait((m) => m.t === 'error');
  assert.match(full.msg, /full/i);
  extra.close();
  const bad = new Client('bad'); await bad.open();
  bad.send({ t: 'join', code: 'ZZZZ', name: 'x' });
  assert.match((await bad.wait((m) => m.t === 'error')).msg, /not found/i);
  bad.close();

  // only the host may change settings
  others[0].send({ t: 'settings', settings: { rounds: 2 } });
  assert.match((await others[0].wait((m) => m.t === 'error')).msg, /host/i);

  // roles: host defends, P0..P3 strike, P4 spectates
  const ids = others.map((c) => c.welcome.id);
  for (let i = 0; i < 4; i++) host.send({ t: 'role', id: ids[i], role: 'striker' });
  host.send({ t: 'role', id: ids[4], role: 'spectator' });
  host.send({ t: 'role', id: w.id, role: 'defender' });
  host.send({ t: 'settings', settings: { prepTime: 15, assaultTime: 60, rounds: 2, questionTime: 30 } });

  // CSV upload: 3 good rows + 1 bad
  host.send({ t: 'questions', name: 'class.csv', csv: 'question,a,b,c,d,answer\nOnly question 1?,yes,no,,,A\nOnly question 2?,yes,no,,,A\nOnly question 3?,yes,no,,,A\nbroken,1,,,,A' });
  const rep = await host.wait((m) => m.t === 'qreport');
  assert.equal(rep.count, 3);
  assert.equal(rep.errorCount, 1);
  await new Promise((r) => setTimeout(r, 200));
  const room = host.latestRoom();
  assert.equal(room.qInfo.count, 3);
  assert.equal(room.players.filter((p) => p.role === 'striker').length, 4);
  assert.equal(room.settings.prepTime, 15);

  host.send({ t: 'start' });
  const starts = await Promise.all([host, ...others].map((c) => c.wait((m) => m.t === 'start')));
  assert.ok(starts.every((s) => s.mapId === 'meadow'));
  assert.equal(starts[0].nStrikers, 4);

  // snapshots flow to everyone
  const snap = await others[4].wait((m) => m.t === 's');
  assert.equal(snap.ph, 'prep');
  assert.equal(snap.a.length, 4);

  // defender gets a question from the uploaded bank, without the answer
  const q = await host.waitPriv('q', 5000);
  assert.match(q.text, /^Only question/);
  assert.equal(q.answer, undefined);
  host.send({ t: 'answer', id: q.id, choice: q.options.indexOf('yes') });
  const qr = await host.waitPriv('qr', 3000);
  assert.equal(qr.correct, true);
  assert.ok(qr.coins > 0);

  // defender builds next to the route; the tower appears in everyone's snapshot
  const map = buildMap('meadow');
  let pad = null, stand = null;
  for (let i = 0; i < map.tiles.length && !pad; i++) {
    if (map.tiles[i] !== T.PATH || map.progress[i] < 10 || map.progress[i] > 40) continue;
    const x = i % map.w, z = (i / map.w) | 0;
    for (const [dx, dz] of [[0, 1], [0, -1]]) { const j = map.idx(x + dx, z + dz); if (map.buildable[j]) { pad = { tx: x + dx, tz: z + dz }; stand = map.tileCenter(x, z); break; } }
  }
  host.send({ t: 'build', type: 'barricade', tx: pad.tx, tz: pad.tz });
  assert.match((await host.waitPriv('err', 3000)).msg, /route/i, 'trap rejected on a pad');
  host.send({ t: 'build', type: 'sentry', tx: pad.tx, tz: pad.tz });
  const withTower = await others[0].wait((m) => m.t === 's' && m.w.length === 1, 3000, 'tower in snapshot');
  const towerId = withTower.w[0][0];

  // a striker trying to leave the route is snapped back
  const striker = others[0];
  striker.send({ t: 'st', x: map.base.x, y: 0, z: map.base.z, yaw: 0, pitch: 0 });
  await striker.waitPriv('tp', 3000);

  // host pause / resume / add time / skip into the assault
  host.send({ t: 'host', cmd: 'pause' });
  const paused = await striker.wait((m) => m.t === 's' && m.pa === 1);
  host.send({ t: 'host', cmd: 'time', sec: 30 });
  const t1 = (await striker.wait((m) => m.t === 's' && m.pa === 1 && m.ti > paused.ti + 20)).ti;
  assert.ok(t1 > paused.ti + 20);
  host.send({ t: 'host', cmd: 'resume' });
  host.send({ t: 'host', cmd: 'skip' });
  await striker.wait((m) => m.t === 's' && m.ph === 'assault', 4000, 'assault');

  // striker walks up to the tower and shoots it
  const tp = await striker.waitPriv('tp', 3000);
  let pos = { x: tp.x, z: tp.z };
  for (let k = 0; k < 120; k++) {
    const dx = stand.x - pos.x, dz = stand.z - pos.z, d = Math.hypot(dx, dz);
    if (d < 0.5) break;
    const stepLen = Math.min(d, 0.35);
    pos = { x: pos.x + (dx / d) * stepLen, z: pos.z + (dz / d) * stepLen };
    striker.send({ t: 'st', x: pos.x, y: 0, z: pos.z, yaw: 0, pitch: 0 });
    await new Promise((r) => setTimeout(r, 50));
  }
  const c = map.tileCenter(pad.tx, pad.tz);
  const box = towerBox({ type: 'sentry', x: c.x, z: c.z });
  const o = [pos.x, PLAYER.eye, pos.z];
  for (let k = 0; k < 6; k++) {
    striker.send({ t: 'fire', w: 'pistol', o, d: [c.x - o[0], (box.y0 + box.y1) / 2 - o[1], c.z - o[2]] });
    await new Promise((r) => setTimeout(r, 320));
  }
  const hm = await striker.waitPriv('hm', 3000);
  assert.ok(hm.d > 0, 'hit marker with damage');
  const hurt = await striker.wait((m) => m.t === 's' && m.w.some((x) => x[0] === towerId && x[5] < x[6]), 3000, 'tower damaged');
  assert.ok(hurt);

  // spectator -> striker mid-match, coins granted, kick
  host.send({ t: 'role', id: ids[4], role: 'striker' });
  const restart = await others[4].wait((m) => m.t === 'start' && m.players.find((p) => p.id === ids[4]).role === 'striker');
  assert.ok(restart);
  host.send({ t: 'host', cmd: 'coins', id: ids[1], amount: 500 });
  const me = await others[1].wait((m) => m.t === 'me' && m.coins >= 500, 3000, 'granted coins');
  assert.ok(me.coins >= 500);
  host.send({ t: 'kick', id: ids[3] });
  await others[3].wait((m) => m.t === 'kicked');

  // reconnect with the session token resumes the seat
  const token = others[2].welcome.token;
  others[2].close();
  await new Promise((r) => setTimeout(r, 200));
  const again = new Client('again'); await again.open();
  again.send({ t: 'resume', code, token });
  const w2 = await again.wait((m) => m.t === 'welcome');
  assert.equal(w2.id, ids[2]);
  await again.wait((m) => m.t === 'start');

  // end match -> results -> back to lobby
  host.send({ t: 'host', cmd: 'end' });
  const over = await again.wait((m) => m.t === 'over', 4000, 'results');
  assert.ok(over.results.players.length >= 4);
  host.send({ t: 'lobby' });
  await again.wait((m) => m.t === 'lobby');
  for (const cl of [host, ...others, again]) cl.close();
});
