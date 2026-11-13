import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';

const fakeWs = () => ({ readyState: 1, sent: [], send(m) { this.sent.push(m); }, close() { this.readyState = 3; } });

test('lobby: a removed player rejoins with the same id and role', () => {
  const r = new Room('TEST');
  r.addPlayer('Host', fakeWs());
  const a = r.addPlayer('Ana', fakeWs()).player;
  assert.equal(a.role, 'striker');
  r.setRole(a.id, 'defender');
  r.removePlayer(a.id, 'disconnected');
  assert.equal(r.players.has(a.id), false);
  const back = r.addPlayer('ana', fakeWs());
  assert.equal(back.rejoined, true);
  assert.equal(back.player.id, a.id);
  assert.equal(back.player.role, 'defender');
});

test('an offline seat is reclaimed by name instead of creating a duplicate', () => {
  const r = new Room('TEST');
  r.addPlayer('Host', fakeWs());
  const b = r.addPlayer('Ben', fakeWs()).player;
  r.disconnect(b);
  const again = r.addPlayer('Ben', fakeWs());
  assert.equal(again.player.id, b.id);
  assert.equal(again.player.connected, true);
  assert.equal(r.players.size, 2, 'no "Ben2" duplicate');
});

test('a full room still accepts a returning offline player', () => {
  const r = new Room('TEST');
  r.addPlayer('Host', fakeWs());
  for (let i = 0; i < 4; i++) r.addBot('striker');
  const c = r.addPlayer('Cat', fakeWs()).player;
  r.disconnect(c);
  assert.ok(r.addPlayer('Dan', fakeWs()).error, 'room is full for newcomers');
  assert.equal(r.addPlayer('Cat', fakeWs()).player.id, c.id);
});

const csvOf = (prefix, n) => ['question,a,b,answer', ...Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}?,yes,no,A`)].join('\n');
const lastSent = (ws, t) => ws.sent.map((s) => JSON.parse(s)).filter((m) => m.t === t).pop();

test('question banks: main + per-round banks, switched automatically each round and live mid-match', () => {
  const r = new Room('BANK');
  const hostWs = fakeWs();
  const host = r.addPlayer('Teacher', hostWs).player;
  r.addBot('defender'); r.addBot('striker');
  r.setRole(host.id, 'spectator');
  r.handle(host, { t: 'questions', csv: csvOf('Main', 5), name: 'main' });
  r.handle(host, { t: 'questions', csv: csvOf('Fractions', 4), name: 'fractions', target: 2 });
  r.handle(host, { t: 'setQuestions', target: 3, name: 'edited', questions: [{ q: 'Edited?', options: ['x', '', 'y', ''], answer: 2, category: 'C', difficulty: 'hard' }, { q: '', options: [] }] });
  const info = r.qInfo();
  assert.equal(info.count, 5);
  assert.deepEqual(info.rounds.map((b) => [b.round, b.count]), [[2, 4], [3, 1]]);
  assert.equal(r.roundBanks.get(3).questions[0].options[r.roundBanks.get(3).questions[0].answer], 'y', 'editor answer maps through blank options');
  r.handle(host, { t: 'start' });
  const g = r.game;
  try {
    assert.match(g.deck.next().q, /^Main/, 'round 1 uses the main bank');
    g.skipPhase(); g.skipPhase(); g.skipPhase(); // prep -> assault -> intermission -> round 2 prep
    assert.equal(g.round, 2);
    assert.match(g.deck.next().q, /^Fractions/, 'round 2 switched to its own bank');
    r.handle(host, { t: 'questions', csv: csvOf('Live', 3), name: 'live', target: 'now' });
    assert.match(g.deck.next().q, /^Live/, 'mid-match upload is live immediately');
    assert.equal(lastSent(hostWs, 'qreport').round, 2);
    r.handle(host, { t: 'questions', csv: csvOf('Next', 2), name: 'next', target: 'next' });
    assert.ok(r.roundBanks.has(3) && r.roundBanks.get(3).name === 'next');
    g.skipPhase(); g.skipPhase(); g.skipPhase();
    assert.match(g.deck.next().q, /^Next/, 'queued bank used next round');
    r.handle(host, { t: 'resetQuestions', target: 3 });
    assert.match(g.deck.next().q, /^Main/, 'clearing the round falls back to the main bank live');
    // the editor gets the full bank (with answers) for the host...
    r.handle(host, { t: 'getQuestions', target: 0 });
    const bank = lastSent(hostWs, 'qbank');
    assert.equal(bank.questions.length, 5);
    assert.equal(typeof bank.questions[0].answer, 'number');
  } finally { r.destroy(); }
});

test('a host who is also the defender cannot open the answer key mid-match', () => {
  const r = new Room('KEY');
  const ws = fakeWs();
  const host = r.addPlayer('Teacher', ws).player; // defender by default
  r.addBot('striker');
  r.handle(host, { t: 'start' });
  try {
    r.handle(host, { t: 'getQuestions', target: 0 });
    assert.equal(lastSent(ws, 'qbank'), undefined);
    assert.match(lastSent(ws, 'error').msg, /defender/i);
    r.handle(host, { t: 'questions', csv: csvOf('Ok', 2), target: 'now' });
    assert.equal(lastSent(ws, 'qreport').count, 2, 'uploading still works');
  } finally { r.destroy(); }
});
