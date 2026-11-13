// A game room: lobby, roles, host controls, question bank and the realtime game loop.
import crypto from 'node:crypto';
import { Game } from './game.js';
import { defaultSettings, sanitizeSettings, MAX_PLAYERS, TICK_RATE, SNAP_EVERY, PRESETS, MAX_QUESTIONS, SETTINGS_SCHEMA } from '../shared/defs.js';
import { parseQuestionCSV, validateQuestions } from '../shared/csv.js';
import { DEFAULT_QUESTIONS } from './questions.js';

// Settings that can't change once a match has started.
const LOCKED_IN_GAME = new Set(['mapId', 'checkpoints', 'baseHpMult', 'defenderStartCoins', 'strikerStartCoins', 'strikerHpMult']);
const BOT_NAMES = ['Bolt', 'Rook', 'Viper', 'Sarge', 'Nova', 'Echo', 'Tank', 'Pixel', 'Blitz', 'Ghost'];

export class Room {
  constructor(code, { onEmpty } = {}) {
    this.code = code;
    this.players = new Map();
    this.hostId = null;
    this.settings = defaultSettings();
    this.questions = null;          // main bank (null = built-in quiz)
    this.bankName = 'Built-in quiz (general knowledge)';
    this.roundBanks = new Map();    // round -> { name, questions }: optional per-round banks
    this.state = 'lobby';
    this.game = null;
    this.timer = null;
    this.results = null;
    this.chatLog = [];
    this.nextPid = 1;
    this.departed = new Map(); // lower-case name -> { id, role } of humans who left/were kicked, so they can rejoin
    this.onEmpty = onEmpty || (() => {});
    this.emptySince = null;
    this.lastLoop = 0; this.acc = 0; this.tickN = 0;
  }

  // ------------------------------------------------------------------ membership
  get size() { return this.players.size; }
  humans() { return [...this.players.values()].filter((p) => !p.isBot); }
  connectedHumans() { return this.humans().filter((p) => p.connected); }
  cleanName(name) {
    let n = String(name || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16);
    if (!n) n = 'Player';
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    let out = n, i = 2;
    while (taken.has(out.toLowerCase())) out = `${n}${i++}`;
    return out;
  }
  defaultRole() {
    const roles = [...this.players.values()].map((p) => p.role);
    if (this.state !== 'lobby') return 'spectator';
    if (!roles.includes('defender')) return 'defender';
    return 'striker';
  }
  addPlayer(name, ws) {
    const raw = String(name || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16) || 'Player';
    const key = raw.toLowerCase();
    // 1) Same name as an offline seat (e.g. rejoining from another tab/device without the token): reclaim it.
    const offline = [...this.players.values()].find((x) => !x.isBot && !x.connected && x.name.toLowerCase() === key);
    if (offline) { this.reconnect(offline.token, ws); return { player: offline, rejoined: true }; }
    if (this.size >= MAX_PLAYERS) return { error: `Room is full (max ${MAX_PLAYERS} players including bots).` };
    // 2) A player who left or was kicked earlier: same id (so match progress is restored) and previous role.
    const prev = this.departed.get(key);
    const p = { id: prev ? prev.id : this.nextPid++, name: this.cleanName(raw), token: crypto.randomBytes(16).toString('hex'), ws, role: this.defaultRole(), isBot: false, connected: true, joinedAt: Date.now() };
    this.players.set(p.id, p);
    if (prev) { this.departed.delete(key); this.restoreRole(p, prev.role); }
    if (!this.hostId || !this.players.get(this.hostId) || !this.players.get(this.hostId).connected) this.hostId = p.id;
    this.emptySince = null;
    return { player: p, rejoined: !!prev };
  }
  restoreRole(p, role) {
    const defTaken = [...this.players.values()].some((x) => x !== p && x.role === 'defender');
    if (this.state !== 'game' || !this.game) { p.role = role === 'defender' && defTaken ? 'striker' : role; return; }
    if (role === 'striker') { p.role = 'striker'; this.game.addStriker(p); }
    else if (role === 'defender' && !defTaken) { p.role = 'defender'; this.game.setDefender(p); }
    else p.role = 'spectator';
  }
  announceJoin(p, rejoined = false) { if (rejoined) { this.sysChat(`${p.name} rejoined${p.role !== 'spectator' ? ` as ${p.role}` : ''}.`); return; } this.sysChat(`${p.name} joined${p.role !== 'spectator' ? ` as ${p.role}` : ' (spectating until the host assigns a role)'}.`); }
  addBot(role) {
    if (this.size >= MAX_PLAYERS) return { error: 'Room is full.' };
    if (role === 'defender' && [...this.players.values()].some((p) => p.role === 'defender')) {
      const cur = [...this.players.values()].find((p) => p.role === 'defender');
      cur.role = 'striker';
    }
    const used = new Set([...this.players.values()].map((p) => p.name));
    const base = BOT_NAMES.find((n) => !used.has(`${n} (bot)`)) || `Bot${this.nextPid}`;
    const p = { id: this.nextPid++, name: `${base} (bot)`, token: null, ws: null, role: role === 'defender' ? 'defender' : 'striker', isBot: true, connected: true };
    this.players.set(p.id, p);
    if (this.game) {
      if (p.role === 'striker') this.game.addStriker(p);
    }
    return { player: p };
  }
  reconnect(token, ws) {
    const p = [...this.players.values()].find((x) => x.token && x.token === token);
    if (!p) return null;
    if (p.ws && p.ws !== ws) { try { p.ws.close(4000, 'Replaced by a new connection'); } catch { /* ignore */ } }
    p.ws = ws; p.connected = true; p.discAt = null;
    this.emptySince = null;
    if (!this.players.get(this.hostId)?.connected) this.hostId = p.id;
    return p;
  }
  disconnect(p) {
    p.connected = false; p.ws = null; p.discAt = Date.now();
    if (this.state === 'lobby') {
      setTimeout(() => { if (!p.connected && this.players.has(p.id) && this.state === 'lobby') { this.removePlayer(p.id, 'disconnected'); } }, 60000);
    }
    if (this.hostId === p.id) setTimeout(() => this.ensureHost(), 8000);
    if (!this.connectedHumans().length) this.emptySince = Date.now();
    this.broadcastLobby();
  }
  ensureHost() {
    const h = this.players.get(this.hostId);
    if (h && h.connected) return;
    const next = this.connectedHumans().sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next && next.id !== this.hostId) {
      this.hostId = next.id;
      this.sysChat(`${next.name} is now the host.`);
      this.broadcastLobby();
    }
  }
  removePlayer(id, reason = '') {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (!p.isBot) {
      this.departed.set(p.name.toLowerCase(), { id: p.id, role: p.role });
      if (this.departed.size > 40) this.departed.delete(this.departed.keys().next().value);
    }
    if (this.game) {
      if (p.role === 'striker') this.game.removeStriker(id);
      if (p.role === 'defender' && this.game.isDefender(id)) this.game.clearDefender();
    }
    if (p.ws) { try { p.ws.send(JSON.stringify({ t: 'kicked', reason })); p.ws.close(4001, reason || 'Removed'); } catch { /* ignore */ } }
    if (!p.isBot) this.sysChat(`${p.name} left${reason ? ` (${reason})` : ''}.`);
    if (this.hostId === id) { this.hostId = null; this.ensureHost(); }
    if (!this.connectedHumans().length) { this.emptySince = Date.now(); }
    this.broadcastLobby();
  }

  // ------------------------------------------------------------------ messaging
  send(p, obj) {
    if (!p || !p.ws || !p.connected || p.ws.readyState !== 1) return;
    try { p.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch { /* ignore */ }
  }
  broadcast(obj) {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (const p of this.players.values()) this.send(p, s);
  }
  sysChat(text) { this.chat(null, text); }
  chat(p, text) {
    const msg = { t: 'chat', from: p ? p.name : null, role: p ? p.role : 'system', text: String(text).slice(0, 220), ts: Date.now() };
    this.chatLog.push(msg);
    if (this.chatLog.length > 60) this.chatLog.shift();
    this.broadcast(msg);
  }
  lobbyState() {
    return {
      t: 'room', code: this.code, hostId: this.hostId, state: this.state,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, role: p.role, isBot: p.isBot, connected: p.connected })),
      settings: this.settings, qInfo: this.qInfo(), maxPlayers: MAX_PLAYERS,
      paused: this.game ? this.game.paused : false,
    };
  }
  broadcastLobby() { this.broadcast(this.lobbyState()); }
  welcome(p) {
    this.send(p, { t: 'welcome', id: p.id, token: p.token, code: this.code });
    this.send(p, this.lobbyState());
    for (const m of this.chatLog.slice(-20)) this.send(p, m);
    if (this.state === 'game' && this.game) {
      this.send(p, this.startMsg());
      this.send(p, this.game.meState(p.id));
      const q = this.game.currentQuestionFor(p.id);
      if (q) this.send(p, { t: 'p', e: [q] });
    }
    if (this.state === 'results' && this.results) this.send(p, { t: 'over', results: this.results });
  }

  // ------------------------------------------------------------------ question banks
  qInfo() {
    const list = this.questions || DEFAULT_QUESTIONS;
    return {
      source: this.questions ? 'custom' : 'default', name: this.bankName, count: list.length,
      categories: [...new Set(list.map((q) => q.category))].slice(0, 12),
      rounds: [...this.roundBanks].sort((a, b) => a[0] - b[0]).map(([round, b]) => ({ round, name: b.name, count: b.questions.length })),
      current: this.game && this.state === 'game' ? this.game.round : 0,
    };
  }
  bankFor(round) { const rb = this.roundBanks.get(round); return rb ? rb.questions : this.questions; }
  // target: 0 = main bank, N = round N, 'now' = current round (live from the next question), 'next' = next round
  resolveTarget(target) {
    const live = this.game && this.state === 'game';
    if (target === 'now') return live ? this.game.round : 1;
    if (target === 'next') return live ? this.game.round + 1 : 1;
    const n = Math.round(Number(target) || 0);
    return Math.max(0, Math.min(10, n));
  }
  setBank(target, questions, name) {
    const round = this.resolveTarget(target);
    const label = String(name || 'Custom questions').replace(/[^\p{L}\p{N} .\-()_]/gu, '').slice(0, 60) || 'Custom questions';
    if (round === 0) {
      this.questions = questions;
      this.bankName = questions ? label : 'Built-in quiz (general knowledge)';
    } else if (questions) this.roundBanks.set(round, { name: label, questions });
    else this.roundBanks.delete(round);
    const g = this.state === 'game' ? this.game : null;
    const live = !!g && (round === g.round || (round === 0 && !this.roundBanks.has(g.round)));
    if (live) g.setDeck(this.bankFor(g.round));
    const where = round === 0 ? 'the main question bank' : `round ${round}`;
    if (questions) this.sysChat(`📚 Host loaded ${questions.length} questions ("${label}") for ${where}${live ? ', live from the next question' : ''}.`);
    else this.sysChat(`📚 ${round === 0 ? 'Main bank reset to the built-in quiz' : `Round ${round} now uses the main bank`}.`);
    this.broadcastLobby();
    return round;
  }
  // A host who is also the defender must not open the answer key mid-match.
  canSeeAnswers(p) { return !(this.state === 'game' && this.game && this.game.isDefender(p.id)); }

  // ------------------------------------------------------------------ message handling
  handle(p, m) {
    const isHost = p.id === this.hostId;
    const err = (msg) => this.send(p, { t: 'error', msg });
    switch (m.t) {
      case 'chat': {
        const now = Date.now();
        if (now - (p.lastChat || 0) < 600) return;
        p.lastChat = now;
        const text = String(m.text || '').trim();
        if (text) this.chat(p, text);
        return;
      }
      case 'settings': {
        if (!isHost) return err('Only the host can change settings.');
        let incoming = m.settings || {};
        if (m.preset && PRESETS[m.preset]) incoming = { ...PRESETS[m.preset].values };
        if (this.state === 'game') { incoming = { ...incoming }; for (const k of LOCKED_IN_GAME) delete incoming[k]; }
        const next = sanitizeSettings(incoming, this.settings);
        Object.assign(this.settings, next); // in place: a running game sees live-safe changes
        this.broadcastLobby();
        return;
      }
      case 'role': {
        if (!isHost) return err('Only the host can assign roles.');
        return this.setRole(m.id, m.role);
      }
      case 'addBot': {
        if (!isHost) return err('Only the host can add bots.');
        const r = this.addBot(m.role);
        if (r.error) return err(r.error);
        this.broadcastLobby();
        return;
      }
      case 'kick': {
        if (!isHost) return err('Only the host can kick.');
        if (m.id === p.id) return err('You cannot kick yourself.');
        this.removePlayer(m.id, 'kicked by host');
        return;
      }
      case 'transferHost': {
        if (!isHost) return;
        const t = this.players.get(m.id);
        if (t && !t.isBot && t.connected) { this.hostId = t.id; this.sysChat(`${t.name} is now the host.`); this.broadcastLobby(); }
        return;
      }
      case 'questions': { // CSV upload any time (lobby or mid-match) for the main bank or a specific round
        if (!isHost) return err('Only the host can upload questions.');
        const csv = String(m.csv || '');
        if (csv.length > 400000) return err('File too large (max ~400 KB).');
        const res = parseQuestionCSV(csv, MAX_QUESTIONS);
        const round = res.questions.length ? this.setBank(m.target ?? 0, res.questions, m.name) : this.resolveTarget(m.target ?? 0);
        this.send(p, { t: 'qreport', round, count: res.questions.length, errors: res.errors, errorCount: res.errorCount, truncated: res.truncated, total: res.total });
        return;
      }
      case 'setQuestions': { // saved from the in-browser editor
        if (!isHost) return err('Only the host can edit questions.');
        const res = validateQuestions(m.questions);
        if (!res.questions.length) return err(res.errors[0] || 'Add at least one complete question.');
        const round = this.setBank(m.target ?? 0, res.questions, m.name);
        this.send(p, { t: 'qreport', round, count: res.questions.length, errors: res.errors, errorCount: res.errors.length, truncated: false, total: res.questions.length });
        return;
      }
      case 'resetQuestions': { // target 0: back to the built-in quiz; target N: round N falls back to the main bank
        if (!isHost) return;
        this.setBank(m.target ?? 0, null);
        return;
      }
      case 'getQuestions': { // full bank (with answers) for the host's editor
        if (!isHost) return err('Only the host can view the answer key.');
        if (!this.canSeeAnswers(p)) return err('You are the defender: the answer key stays hidden during the match.');
        const round = this.resolveTarget(m.target ?? 0);
        const rb = round ? this.roundBanks.get(round) : null;
        const list = rb ? rb.questions : round ? null : this.questions;
        const name = rb ? rb.name : round ? `Round ${round} questions` : this.questions ? this.bankName : 'My questions';
        this.send(p, { t: 'qbank', round, name, questions: list || this.questions || DEFAULT_QUESTIONS });
        return;
      }
      case 'start': {
        if (!isHost) return err('Only the host can start.');
        if (this.state === 'game') return;
        return this.startGame(p);
      }
      case 'host': {
        if (!isHost) return err('Host only.');
        return this.hostCommand(p, m);
      }
      case 'lobby': {
        if (!isHost) return;
        this.toLobby();
        return;
      }
      default:
        if (this.state === 'game' && this.game) this.game.input(p.id, m);
    }
  }

  setRole(id, role) {
    const p = this.players.get(id);
    if (!p || !['defender', 'striker', 'spectator'].includes(role) || p.role === role) return;
    const old = p.role;
    const curDef = [...this.players.values()].find((x) => x.role === 'defender' && x.id !== id);
    if (this.state !== 'game') {
      if (role === 'defender' && curDef) curDef.role = old === 'defender' ? 'striker' : old;
      p.role = role;
      this.broadcastLobby();
      return;
    }
    const g = this.game;
    if (role === 'defender') {
      // swap seats: the current defender takes p's old role
      if (old === 'striker') g.removeStriker(p.id);
      p.role = 'defender';
      g.setDefender(p);
      if (curDef) {
        curDef.role = old;
        if (old === 'striker') g.addStriker(curDef);
        if (curDef.isBot && old !== 'striker') this.players.delete(curDef.id);
      }
      this.sysChat(`${p.name} now commands the defence.`);
    } else if (old === 'defender') {
      p.role = role;
      g.clearDefender();
      if (role === 'striker') g.addStriker(p);
      this.sysChat(`The defence has no commander! Host: assign a defender or a bot.`);
    } else {
      if (old === 'striker') g.removeStriker(p.id);
      p.role = role;
      if (role === 'striker') g.addStriker(p);
    }
    this.broadcastLobby();
    for (const x of this.players.values()) if (!x.isBot) { this.send(x, this.startMsg()); this.send(x, g.meState(x.id)); }
    const q = g.currentQuestionFor(p.id);
    if (q) this.send(p, { t: 'p', e: [q] });
  }

  hostCommand(p, m) {
    const g = this.game;
    const err = (msg) => this.send(p, { t: 'error', msg });
    if (!g || this.state !== 'game') return err('No match running.');
    switch (m.cmd) {
      case 'pause': g.paused = true; this.sysChat('⏸ Host paused the game.'); break;
      case 'resume': g.paused = false; this.lastLoop = performance.now(); this.sysChat('▶ Game resumed.'); break;
      case 'skip': g.skipPhase(); this.sysChat('⏭ Host skipped the phase.'); break;
      case 'time': { const s = Math.max(-300, Math.min(300, Number(m.sec) || 0)); g.addTime(s); this.sysChat(`⏱ Host ${s >= 0 ? 'added' : 'removed'} ${Math.abs(s)}s.`); break; }
      case 'coins': {
        const amt = Math.max(-5000, Math.min(5000, Math.round(Number(m.amount) || 0)));
        const target = this.players.get(m.id);
        if (!target) return err('No such player.');
        const s = g.strikers.get(target.id);
        if (s) s.coins = Math.max(0, s.coins + amt);
        else if (g.isDefender(target.id)) g.defender.coins = Math.max(0, g.defender.coins + amt);
        else return err('Player has no coin balance.');
        this.sysChat(`💰 Host ${amt >= 0 ? 'granted' : 'removed'} ${Math.abs(amt)} coins ${amt >= 0 ? 'to' : 'from'} ${target.name}.`);
        break;
      }
      case 'baseHp': {
        const pct = Math.max(-50, Math.min(50, Number(m.pct) || 0));
        g.base.hp = Math.max(1, Math.min(g.base.max, g.base.hp + g.base.max * pct / 100));
        this.sysChat(`🏰 Host adjusted base HP by ${pct}%.`);
        break;
      }
      case 'botDefender': {
        const cur = [...this.players.values()].find((x) => x.role === 'defender');
        if (cur && !cur.isBot) cur.role = 'spectator';
        if (cur && cur.isBot) return;
        if (this.size >= MAX_PLAYERS && !cur) return err('Room full.');
        const r = this.addBot('defender');
        if (r.error) return err(r.error);
        g.setDefender(r.player);
        this.sysChat('🤖 A bot took command of the defence.');
        this.broadcastLobby();
        for (const x of this.players.values()) if (!x.isBot) { this.send(x, this.startMsg()); this.send(x, g.meState(x.id)); }
        break;
      }
      case 'end': this.finish('aborted'); return;
      case 'lobby': this.toLobby(); return;
      default: return err('Unknown command.');
    }
    this.broadcastLobby();
  }

  // ------------------------------------------------------------------ match lifecycle
  startMsg() {
    const g = this.game;
    return {
      t: 'start', mapId: g.map.id, settings: this.settings, round: g.round,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, role: p.role, isBot: p.isBot })),
      baseMax: g.base.max, dFactor: g.dFactor, sFactor: g.sFactor, nStrikers: g.nStrikers,
    };
  }
  startGame(p) {
    const list = [...this.players.values()];
    const defs = list.filter((x) => x.role === 'defender');
    const strs = list.filter((x) => x.role === 'striker');
    if (defs.length !== 1) return this.send(p, { t: 'error', msg: 'Assign exactly one Defender (a player or a bot).' });
    if (strs.length < 1) return this.send(p, { t: 'error', msg: 'Assign at least one Striker (a player or a bot).' });
    this.game = new Game({ settings: this.settings, players: list.map((x) => ({ id: x.id, name: x.name, role: x.role, isBot: x.isBot })), questions: this.bankFor(1), questionsForRound: (r) => this.bankFor(r) });
    this.state = 'game';
    this.results = null;
    this.broadcast(this.startMsg());
    this.broadcastLobby();
    for (const x of list) if (!x.isBot) this.send(x, this.game.meState(x.id));
    this.lastLoop = performance.now(); this.acc = 0; this.tickN = 0;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.loop(), 1000 / TICK_RATE);
    this.sysChat(`⚔ Match started on ${this.game.map.name}: ${strs.length} striker${strs.length > 1 ? 's' : ''} vs 1 defender.`);
  }
  loop() {
    const g = this.game;
    if (!g) return;
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastLoop) / 1000);
    this.lastLoop = now;
    const step = 1 / TICK_RATE;
    this.acc += dt;
    let n = 0;
    while (this.acc >= step && n < 5) { g.step(step); this.acc -= step; n++; }
    if (n >= 5) this.acc = 0;
    this.tickN++;
    const priv = g.drainPrivate();
    for (const [pid, evs] of priv) { const p = this.players.get(pid); if (p && !p.isBot) this.send(p, { t: 'p', e: evs }); }
    if (this.tickN % SNAP_EVERY === 0 || g.over) this.broadcast(g.snapshot());
    if (this.tickN % 6 === 0) for (const p of this.players.values()) if (!p.isBot && p.connected) this.send(p, g.meState(p.id));
    if (g.over) this.finish(g.winner);
  }
  finish(winner) {
    clearInterval(this.timer); this.timer = null;
    if (!this.game) return;
    if (!this.game.over) { this.game.over = true; this.game.winner = winner; }
    this.results = this.game.results();
    this.results.winner = winner;
    this.results.mapName = this.game.map.name;
    this.state = 'results';
    this.broadcast({ t: 'over', results: this.results });
    this.broadcastLobby();
    const msg = winner === 'defender' ? '🛡 The base held! Defender wins.' : winner === 'strikers' ? '💥 The core has fallen! Strikers win.' : 'Match ended by host.';
    this.sysChat(msg);
  }
  toLobby() {
    clearInterval(this.timer); this.timer = null;
    this.game = null; this.state = 'lobby';
    for (const p of this.players.values()) if (!p.isBot && !p.connected) this.players.delete(p.id);
    this.broadcast({ t: 'lobby' });
    this.broadcastLobby();
  }
  destroy() { clearInterval(this.timer); this.timer = null; }
}
