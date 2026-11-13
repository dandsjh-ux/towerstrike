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
