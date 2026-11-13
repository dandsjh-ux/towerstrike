// Authoritative TowerStrike simulation. Pure logic: no sockets, so it can run headless for tests & balance sims.
import {
  TOWERS, TOWER_IDS, towerStats, upgradeCost, towerInvested, towerBox, MAX_LEVEL, TARGET_MODES, ASSAULT_BUILD_TIME, LEVEL_MULT,
  ABILITIES, WEAPONS, WEAPON_IDS, EQUIPMENT, SHIELDS, TROOPS, TROOP_IDS, TROOP_BUY_LIMIT, ZONE_TYPES, CHECKPOINT,
  ECON, POINTS, DIFFICULTY_MULT, PLAYER, INTERMISSION, defenderFactor, strikerFactor, baseMaxHp, respawnMult, falloff, BASE_DEFENSE, BASE_SHIELD_RANGE,
} from '../shared/defs.js';
import { buildMap, slideMove, mapBalance, T } from '../shared/maps.js';
import { rayAABB, pointAABBDist, mulberry32, dist, round2, round1, clamp } from '../shared/util.js';
import { QuestionDeck } from './questions.js';
import { BotStriker, BotDefender } from './bots.js';

const SUPPORT_KINDS = new Set(['shieldgen', 'repair', 'radar', 'eco', 'wall']);
const r1 = round1, r2 = round2;

export class Game {
  constructor({ settings, players, questions, seed }) {
    this.s = settings;
    this.map = buildMap(settings.mapId);
    this.seed = seed ?? ((Date.now() * 2654435761) >>> 0);
    this.rng = mulberry32(this.seed);
    this.time = 0; this.tick = 0; this.paused = false;
    this.phase = 'prep'; this.round = 0; this.timer = 0;
    this.events = []; this.privEvents = new Map();
    this.nextId = 1000;
    this.towers = new Map(); this.occupied = new Map(); this.blocked = new Set();
    this.troops = new Map(); this.troopQueue = [];
    this.projs = new Map(); this.zones = new Map();
    this.strikers = new Map(); this.benched = new Map();
    this.defender = null; this.botDef = null; this.bots = new Map();
    this.deck = new QuestionDeck(questions, this.rng, settings.shuffleOptions);
    this.checkpoints = settings.checkpoints ? this.map.checkpoints.map((c) => ({ ...c, captured: false, cap: 0 })) : [];
    this.scoutUntil = 0;
    this.over = false; this.winner = null;
    this.roundLog = [];
    this.baseHitAcc = 0;
    for (const p of players) {
      if (p.role === 'striker') this.addStriker(p);
      else if (p.role === 'defender') this.setDefender(p);
    }
    const n = Math.max(1, this.strikers.size);
    const hp = Math.round(baseMaxHp(n, settings) * mapBalance(this.map, n).hp);
    this.base = { hp, max: hp, fortifyUntil: 0 };
    this.updateFactors();
    if (this.defender) this.defender.coins = Math.round(settings.defenderStartCoins * defenderFactor(n, { ...settings, defenderRewardMult: 1 }) * mapBalance(this.map, n).def);
    this.startPrep();
  }

  // ------------------------------------------------------------------ helpers
  rand(a = 0, b = 1) { return a + (b - a) * this.rng(); }
  ev(e) { this.events.push(e); }
  priv(pid, e) { if (!this.privEvents.has(pid)) this.privEvents.set(pid, []); this.privEvents.get(pid).push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }
  drainPrivate() { const p = this.privEvents; this.privEvents = new Map(); return p; }
  updateFactors() {
    const n = Math.max(1, this.strikers.size);
    this.nStrikers = n;
    this.dFactor = defenderFactor(n, this.s) * mapBalance(this.map, n).def;
    this.sFactor = strikerFactor(n, this.s);
  }
  msg(text, cls = '') { this.ev({ k: 'msg', text, cls }); }
  award(pid, coins, points = 0) {
    const a = this.strikers.get(pid);
    const who = a || (this.defender && this.defender.id === pid ? this.defender : null);
    if (!who) return;
    who.coins += coins; who.points += points;
    who.stats.coinsEarned += coins;
  }
  isDefender(pid) { return !!this.defender && this.defender.id === pid; }
  inZone(x, z, type) {
    for (const zn of this.zones.values()) if (zn.type === type && (x - zn.x) ** 2 + (z - zn.z) ** 2 <= zn.r * zn.r) return true;
    return false;
  }
  towerActive(t) { return !t.disabled && this.time >= t.buildUntil && this.time >= t.stunUntil; }
  // The core shield blocks damage from attackers outside the plaza.
  canHitBase(x, z) { return this.map.inPlaza(x, z) || pointAABBDist({ x, y: 1, z }, this.map.base.box) <= BASE_SHIELD_RANGE; }
  yawToward(fx, fz, tx, tz) { return Math.atan2(-(tx - fx), -(tz - fz)); }

  // ------------------------------------------------------------------ roster
  makeStriker(p) {
    const maxHp = Math.round(PLAYER.hp * this.s.strikerHpMult);
    const a = {
      id: p.id, name: p.name, isBot: !!p.isBot,
      x: this.map.spawn.x, y: 0, z: this.map.spawn.z, yaw: 0, pitch: 0, vx: 0, vz: 0,
      hp: maxHp, maxHp, shield: 0, shieldType: 'none', shieldsOwned: new Set(['none']),
      alive: true, ghost: false, respawnAt: 0, deathsRound: 0, protectUntil: 0,
      coins: this.s.strikerStartCoins, points: 0,
      owned: new Set(['pistol']), primary: null, weapon: 'pistol',
      mag: { pistol: WEAPONS.pistol.mag }, reloadUntil: 0, reloadW: null, lastShot: -9,
      equip: Object.fromEntries(Object.keys(EQUIPMENT).map((k) => [k, 0])),
      troopBuys: {},
      effects: { stimUntil: 0, cloakUntil: 0, burnUntil: 0, burnDps: 0, slowUntil: 0, slowMult: 1, healUntil: 0, healRate: 0 },
      lastHurt: -99, lastPosT: 0, lastCorrection: -9, hurtAcc: 0, hurtX: 0, hurtZ: 0, hurtT: 0,
      stats: { disables: 0, baseDmg: 0, towerDmg: 0, deaths: 0, checkpoints: 0, coinsEarned: 0, shots: 0, hits: 0 },
    };
    return a;
  }
  addStriker(p) {
    let a = this.benched.get(p.id);
    if (a) { this.benched.delete(p.id); a.name = p.name; }
    else a = this.makeStriker(p);
    this.strikers.set(p.id, a);
    if (p.isBot) this.bots.set(p.id, new BotStriker(this, a, this.s.botSkill));
    if (this.round > 0) {
      if (this.phase === 'assault') { a.alive = false; a.respawnAt = this.time + 2; }
      else this.resetStriker(a, this.phase === 'prep');
    }
    return a;
  }
  removeStriker(id) {
    const a = this.strikers.get(id);
    if (!a) return;
    this.strikers.delete(id);
    this.bots.delete(id);
    if (!a.isBot) this.benched.set(id, a);
    for (const r of this.troops.values()) if (r.owner === id && TROOPS[r.type].follow) this.killTroop(r, false);
  }
  setDefender(p) {
    if (!this.defender) {
      this.defender = {
        id: p.id, name: p.name, isBot: !!p.isBot, coins: 0, points: 0, streak: 0, bestStreak: 0,
        q: null, nextQAt: 0, lockUntil: 0, qNum: 0, cds: {}, abilityUses: 0,
        stats: { correct: 0, wrong: 0, timeouts: 0, kills: 0, troopKills: 0, coinsEarned: 0, built: 0 },
      };
    } else {
      this.defender.id = p.id; this.defender.name = p.name; this.defender.isBot = !!p.isBot;
      this.defender.q = null; this.defender.nextQAt = this.time + 1;
    }
    this.botDef = p.isBot ? new BotDefender(this, this.defender, this.s.botSkill) : null;
  }
  clearDefender() { if (this.defender) { this.defender.id = -1; this.defender.q = null; } this.botDef = null; }

  // ------------------------------------------------------------------ phases
  startPrep() {
    this.round++;
    this.phase = 'prep';
    this.timer = this.s.prepTime;
    this.updateFactors();
    for (const t of this.towers.values()) this.resetTower(t);
    this.troops.clear(); this.troopQueue = []; this.projs.clear(); this.zones.clear();
    for (const c of this.checkpoints) { c.captured = false; c.cap = 0; }
    this.scoutUntil = 0;
    this.roundBaseDmg = 0; this.locked = false;
    for (const a of this.strikers.values()) {
      if (this.round > 1) this.award(a.id, Math.round(ECON.strStipend * (1 + ECON.strStipendGrowth * (this.round - 2)) * this.sFactor));
      a.troopBuys = {};
      this.resetStriker(a, true);
    }
    if (this.defender && this.round === 1) this.defender.nextQAt = this.time + 2;
    this.ev({ k: 'ph', ph: 'prep', rd: this.round });
    for (const b of this.bots.values()) b.onPhase('prep');
    if (this.botDef) this.botDef.onPhase('prep');
  }
  startAssault() {
    this.phase = 'assault';
    this.timer = this.s.assaultTime;
    let k = 0;
    for (const a of this.strikers.values()) {
      this.resetStriker(a, false);
      a.protectUntil = this.time + PLAYER.spawnProtect;
      for (const [type, n] of Object.entries(a.troopBuys)) {
        for (let i = 0; i < n * TROOPS[type].count; i++) this.troopQueue.push({ type, owner: a.id, at: this.time + 1 + 0.7 * k++ });
      }
    }
    this.troopQueue.sort((x, y) => x.at - y.at);
    this.ev({ k: 'ph', ph: 'assault', rd: this.round });
    for (const b of this.bots.values()) b.onPhase('assault');
    if (this.botDef) this.botDef.onPhase('assault');
  }
  endRound() {
    const survived = this.base.hp > 0;
    if (survived && this.defender) {
      this.award(this.defender.id, Math.round(ECON.defRoundBonus * this.dFactor), POINTS.defRoundSurvive);
    }
    const disabled = [...this.towers.values()].filter((t) => t.disabled && !t.spent).length;
    this.roundLog.push({ round: this.round, baseHp: Math.round(this.base.hp), baseMax: this.base.max, towers: this.towers.size, disabled });
    this.ev({ k: 're', rd: this.round, hp: Math.round(this.base.hp), max: this.base.max, disabled, towers: this.towers.size });
    if (this.round >= this.s.rounds) return this.endMatch('defender');
    this.phase = 'intermission';
    this.timer = INTERMISSION;
    this.ev({ k: 'ph', ph: 'intermission', rd: this.round });
  }
  endMatch(winner) {
    if (this.over) return;
    if (winner === 'strikers' && this.roundLog.length < this.round) {
      this.roundLog.push({ round: this.round, baseHp: 0, baseMax: this.base.max, towers: this.towers.size, disabled: [...this.towers.values()].filter((t) => t.disabled).length });
    }
    this.over = true; this.winner = winner; this.phase = 'over';
    this.ev({ k: 'ph', ph: 'over', rd: this.round, winner });
  }
  skipPhase() {
    if (this.phase === 'prep') this.startAssault();
    else if (this.phase === 'assault') this.endRound();
    else if (this.phase === 'intermission') this.startPrep();
  }
  addTime(sec) { if (this.phase !== 'over') this.timer = clamp(this.timer + sec, 1, 3600); }

  spawnPoint(forRespawn) {
    let best = null;
    if (forRespawn) for (const c of this.checkpoints) if (c.captured && (!best || c.prog > best.prog)) best = c;
    const cx = best ? best.x : this.map.spawn.x, cz = best ? best.z : this.map.spawn.z;
    for (let i = 0; i < 12; i++) {
      const x = cx + this.rand(-2.5, 2.5), z = cz + this.rand(-2.5, 2.5);
      if (this.map.canWalk(x, z, 0.5, this.blocked)) return { x, z };
    }
    return { x: cx, z: cz };
  }
  resetStriker(a, prep) {
    const p = this.spawnPoint(false);
    a.alive = true; a.hp = a.maxHp; a.shield = SHIELDS[a.shieldType].cap;
    a.ghost = prep; a.x = p.x; a.z = p.z; a.y = 0; a.vx = 0; a.vz = 0;
    a.deathsRound = 0; a.reloadUntil = 0; a.reloadW = null;
    for (const w of a.owned) a.mag[w] = WEAPONS[w].mag;
    a.effects = { stimUntil: 0, cloakUntil: 0, burnUntil: 0, burnDps: 0, slowUntil: 0, slowMult: 1, healUntil: 0, healRate: 0 };
    const first = this.map.route[1];
    a.yaw = this.yawToward(a.x, a.z, first.x, first.z);
    a.lastPosT = this.time;
    this.priv(a.id, { k: 'tp', x: r2(a.x), y: 0, z: r2(a.z), yaw: r2(a.yaw) });
  }
  respawn(a) {
    const p = this.spawnPoint(true);
    a.alive = true; a.hp = a.maxHp; a.shield = SHIELDS[a.shieldType].cap;
    a.x = p.x; a.z = p.z; a.y = 0; a.vx = 0; a.vz = 0;
    a.protectUntil = this.time + PLAYER.spawnProtect;
    a.reloadUntil = 0; a.reloadW = null;
    for (const w of a.owned) a.mag[w] = WEAPONS[w].mag;
    a.effects = { stimUntil: 0, cloakUntil: 0, burnUntil: 0, burnDps: 0, slowUntil: 0, slowMult: 1, healUntil: 0, healRate: 0 };
    const np = this.map.nearestOnPath(a.x, a.z);
    const ahead = this.map.pointAt(Math.min(this.map.pathLen, np.prog + 8));
    a.yaw = this.yawToward(a.x, a.z, ahead.x, ahead.z);
    a.lastPosT = this.time;
    this.priv(a.id, { k: 'tp', x: r2(a.x), y: 0, z: r2(a.z), yaw: r2(a.yaw) });
    this.ev({ k: 'sp', p: a.id });
  }

  // ------------------------------------------------------------------ main loop
  step(dt) {
    if (this.over || this.paused) return;
    this.time += dt; this.tick++;
    this.timer -= dt;
    for (const b of this.bots.values()) b.update(dt);
    if (this.botDef) this.botDef.update(dt);
    const ph = this.phase;
    if (ph === 'prep' || ph === 'assault') { this.updateQuestions(); this.updateEco(dt); }
    this.updateStrikers(dt);
    if (ph === 'assault') {
      this.updateTowers(dt);
      this.updateTroops(dt);
      this.updateProjectiles(dt);
      this.updateZones(dt);
      this.updateCheckpoints(dt);
      for (const a of this.strikers.values()) {
        const inc = ECON.strPassive * this.sFactor * dt;
        a.coins += inc; a.stats.coinsEarned += inc;
      }
      if (this.baseHitAcc > 0) { this.ev({ k: 'bh', d: Math.round(this.baseHitAcc) }); this.baseHitAcc = 0; }
      if (this.base.hp <= 0) { this.base.hp = 0; this.endMatch('strikers'); return; }
      if (this.timer <= 0) this.endRound();
    } else if (ph === 'prep') {
      if (this.timer <= 0) this.startAssault();
    } else if (ph === 'intermission') {
      if (this.timer <= 0) this.startPrep();
    }
  }

  // ------------------------------------------------------------------ questions & economy
  updateQuestions() {
    const d = this.defender;
    if (!d || d.id < 0) return;
    if (!d.q && this.time >= d.nextQAt) {
      const q = this.deck.next();
      d.q = { ...q, sentAt: this.time, deadline: this.time + this.s.questionTime };
      d.qNum++;
      this.priv(d.id, { k: 'q', id: q.uid, text: q.q, options: q.options, category: q.category, difficulty: q.difficulty, time: this.s.questionTime, num: d.qNum });
      if (this.botDef) this.botDef.onQuestion(d.q);
    } else if (d.q && this.time > d.q.deadline) {
      d.streak = 0; d.stats.timeouts++;
      this.priv(d.id, { k: 'qr', id: d.q.uid, correct: false, timeout: true, answer: this.s.showCorrect ? d.q.answer : -1, chosen: -1, coins: 0, points: 0, streak: 0, lock: 0 });
      d.q = null; d.nextQAt = this.time + 1.5;
    }
  }
  onAnswer(qid, choice) {
    const d = this.defender;
    if (!d || !d.q || d.q.uid !== qid || this.time < d.lockUntil) return;
    if (!Number.isInteger(choice) || choice < 0 || choice >= d.q.options.length) return;
    const q = d.q;
    const correct = choice === q.answer;
    let coins = 0, points = 0, lock = 0;
    if (correct) {
      const frac = clamp(1 - (this.time - q.sentAt) / this.s.questionTime, 0, 1);
      const dm = DIFFICULTY_MULT[q.difficulty] || 1;
      const streakBonus = Math.min(d.streak * ECON.defStreakStep, ECON.defStreakCap);
      const lowHp = 1 + ECON.defLowHpBonus * (1 - this.base.hp / this.base.max);
      coins = Math.round((ECON.defQuestion * dm + ECON.defSpeedBonus * frac + streakBonus) * this.dFactor * lowHp);
      points = Math.round(POINTS.defCorrect * dm + POINTS.defSpeed * frac);
      d.streak++; d.bestStreak = Math.max(d.bestStreak, d.streak);
      d.stats.correct++;
      this.award(d.id, coins, points);
    } else {
      d.streak = 0; d.stats.wrong++;
      lock = this.s.wrongLockout;
      d.lockUntil = this.time + lock;
    }
    this.priv(d.id, { k: 'qr', id: q.uid, correct, answer: (correct || this.s.showCorrect) ? q.answer : -1, chosen: choice, coins, points, streak: d.streak, lock });
    d.q = null;
    d.nextQAt = this.time + (correct ? 1.4 : Math.max(1.8, lock));
  }
  updateEco(dt) {
    const d = this.defender;
    if (!d) return;
    for (const t of this.towers.values()) {
      if (t.st.kind !== 'eco' || !this.towerActive(t)) continue;
      t.ecoAcc = (t.ecoAcc || 0) + t.st.income * dt;
      if (t.ecoAcc >= 5) {
        t.ecoAcc -= 5;
        d.coins += 5; d.stats.coinsEarned += 5;
        if (d.id >= 0) this.priv(d.id, { k: 'coin', n: 5, x: r1(t.x), z: r1(t.z) });
      }
    }
  }

  // ------------------------------------------------------------------ strikers
  updateStrikers(dt) {
    const now = this.time;
    for (const a of this.strikers.values()) {
      if (!a.alive) {
        if (this.phase === 'assault' && now >= a.respawnAt) this.respawn(a);
        continue;
      }
      if (a.reloadW && now >= a.reloadUntil) { a.mag[a.reloadW] = WEAPONS[a.reloadW].mag; a.reloadW = null; }
      if (this.phase !== 'assault') continue;
      const e = a.effects;
      if (e.burnUntil > now) this.hurtStriker(a, e.burnDps * dt, 'fire', null, false, 'flamer', true);
      if (!a.alive) continue;
      if (e.healUntil > now) a.hp = Math.min(a.maxHp, a.hp + e.healRate * dt);
      const sh = SHIELDS[a.shieldType];
      if (sh.cap > 0 && now - a.lastHurt > sh.delay) a.shield = Math.min(sh.cap, a.shield + sh.regen * dt);
      if (a.hurtAcc > 0 && now - a.hurtT > 0.2) {
        this.priv(a.id, { k: 'hurt', d: Math.round(a.hurtAcc), x: r1(a.hurtX), z: r1(a.hurtZ) });
        a.hurtAcc = 0; a.hurtT = now;
      }
    }
  }
  hurtStriker(a, dmg, dmgType, src, splash, cause, ignoreDome = false) {
    if (!a.alive || a.ghost || this.time < a.protectUntil || dmg <= 0) return false;
    if (!ignoreDome && this.inZone(a.x, a.z, 'dome')) return false;
    const sh = SHIELDS[a.shieldType];
    if (splash && sh.splashResist) dmg *= 1 - sh.splashResist;
    if (dmgType === 'energy' && sh.energyResist) dmg *= 1 - sh.energyResist;
    a.lastHurt = this.time;
    if (a.shield > 0) { const ab = Math.min(a.shield, dmg); a.shield -= ab; dmg -= ab; }
    a.hp -= dmg;
    a.hurtAcc += dmg; if (src) { a.hurtX = src.x; a.hurtZ = src.z; }
    if (a.hp <= 0) { this.killStriker(a, cause); return true; }
    return false;
  }
  killStriker(a, cause) {
    a.alive = false; a.hp = 0; a.shield = 0;
    a.deathsRound++; a.stats.deaths++;
    a.respawnAt = this.time + (this.s.respawnTime + Math.min(7, a.deathsRound - 1)) * respawnMult(this.nStrikers);
    a.effects.cloakUntil = 0;
    if (this.defender) {
      this.award(this.defender.id, ECON.defKill, POINTS.defKill);
      this.defender.stats.kills++;
    }
    this.ev({ k: 'kill', v: a.id, by: cause || 'tower', x: r1(a.x), z: r1(a.z) });
    this.priv(a.id, { k: 'dead', by: cause || 'tower', respawn: r1(a.respawnAt - this.time) });
  }

  onState(a, m) {
    if (this.paused || !a.alive) return;
    const x = Number(m.x), y = Number(m.y), z = Number(m.z);
    if (![x, y, z].every(Number.isFinite)) return;
    const now = this.time;
    const dtc = Math.max(0.1, now - a.lastPosT);
    const maxSpeed = PLAYER.speed * PLAYER.sprintMult * 1.35 * 1.3;
    const moved = Math.hypot(x - a.x, z - a.z);
    let ok = moved <= maxSpeed * dtc + 2.5 && this.map.canWalk(x, z, 0.3, this.blocked);
    if (ok && this.phase === 'prep' && !this.s.allowScouting && !this.map.inSpawn(x, z)) ok = false;
    if (!ok) {
      if (now - a.lastCorrection > 0.4) {
        a.lastCorrection = now;
        this.priv(a.id, { k: 'tp', x: r2(a.x), y: r2(a.y), z: r2(a.z), soft: 1 });
      }
      a.lastPosT = now;
      return;
    }
    const vdt = Math.max(0.033, now - a.lastPosT);
    a.vx = a.vx * 0.5 + ((x - a.x) / vdt) * 0.5;
    a.vz = a.vz * 0.5 + ((z - a.z) / vdt) * 0.5;
    a.x = x; a.z = z; a.y = clamp(y, 0, 6);
    if (Number.isFinite(m.yaw)) a.yaw = m.yaw;
    if (Number.isFinite(m.pitch)) a.pitch = clamp(m.pitch, -1.6, 1.6);
    a.lastPosT = now;
  }

  canShop(a) {
    if (this.phase === 'prep' || this.phase === 'intermission') return true;
    if (this.phase !== 'assault' || !a.alive) return false;
    if (this.map.inSpawn(a.x, a.z)) return true;
    return this.checkpoints.some((c) => c.captured && Math.hypot(c.x - a.x, c.z - a.z) < 7);
  }
  onBuy(a, item) {
    if (typeof item !== 'string') return;
    const [cat, id] = item.split(':');
    const fail = (msg) => { this.priv(a.id, { k: 'buy', ok: false, item, msg }); return false; };
    if (!this.canShop(a)) return fail('Shop only in spawn, at captured checkpoints, or during prep.');
    let cost = 0;
    if (cat === 'w') {
      const w = WEAPONS[id];
      if (!w || this.s.bannedWeapons.includes(id)) return fail('Not available.');
      if (a.owned.has(id)) { a.primary = id; a.weapon = id; return true; }
      cost = w.cost;
      if (a.coins < cost) return fail('Not enough coins.');
      a.coins -= cost; a.owned.add(id); a.mag[id] = w.mag;
      if (w.slot === 1) a.primary = id;
      a.weapon = id;
    } else if (cat === 'e') {
      const e = EQUIPMENT[id];
      if (!e || this.s.bannedEquipment.includes(id)) return fail('Not available.');
      if (a.equip[id] >= e.max) return fail('Carrying the maximum.');
      cost = e.cost;
      if (a.coins < cost) return fail('Not enough coins.');
      a.coins -= cost; a.equip[id]++;
    } else if (cat === 's') {
      const sh = SHIELDS[id];
      if (!sh || id === 'none') return fail('Not available.');
      if (!a.shieldsOwned.has(id)) {
        cost = sh.cost;
        if (a.coins < cost) return fail('Not enough coins.');
        a.coins -= cost; a.shieldsOwned.add(id);
      }
      a.shieldType = id; a.shield = sh.cap;
    } else if (cat === 't') {
      const d = TROOPS[id];
      if (!d || this.s.bannedTroops.includes(id)) return fail('Not available.');
      if ((a.troopBuys[id] || 0) >= TROOP_BUY_LIMIT) return fail(`Max ${TROOP_BUY_LIMIT} per round.`);
      cost = d.cost;
      if (a.coins < cost) return fail('Not enough coins.');
      a.coins -= cost; a.troopBuys[id] = (a.troopBuys[id] || 0) + 1;
      if (this.phase === 'assault') for (let i = 0; i < d.count; i++) this.troopQueue.push({ type: id, owner: a.id, at: this.time + 0.5 + i * 0.5 });
      this.troopQueue.sort((x, y) => x.at - y.at);
    } else return fail('Unknown item.');
    this.priv(a.id, { k: 'buy', ok: true, item, cost });
    return true;
  }
  onSwitch(a, w) {
    if (!a.owned.has(w)) return;
    if (a.weapon !== w) { a.weapon = w; a.reloadW = null; a.reloadUntil = 0; }
    if (WEAPONS[w].slot === 1) a.primary = w;
  }
  onReload(a) {
    const w = WEAPONS[a.weapon];
    if (!a.alive || a.reloadW || a.mag[a.weapon] >= w.mag) return;
    a.reloadW = a.weapon; a.reloadUntil = this.time + w.reload;
  }
  onFire(a, m) {
    if (this.phase !== 'assault' || this.paused || !a.alive || a.ghost) return;
    const id = m.w;
    const w = WEAPONS[id];
    if (!w || !a.owned.has(id)) return;
    if (a.weapon !== id) this.onSwitch(a, id);
    if (a.reloadW) { if (this.time < a.reloadUntil) return; a.mag[a.reloadW] = WEAPONS[a.reloadW].mag; a.reloadW = null; }
    const rateMult = a.effects.stimUntil > this.time ? EQUIPMENT.stim.rateMult : 1;
    if (this.time - a.lastShot < (1 / (w.rate * rateMult)) * 0.7) return;
    if ((a.mag[id] || 0) <= 0) return;
    a.mag[id]--; a.lastShot = this.time;
    a.effects.cloakUntil = 0;
    a.protectUntil = Math.min(a.protectUntil, this.time);
    a.stats.shots++;
    const eye = { x: a.x, y: a.y + PLAYER.eye, z: a.z };
    let o = eye;
    if (Array.isArray(m.o) && m.o.length === 3 && m.o.every(Number.isFinite)) {
      const co = { x: m.o[0], y: m.o[1], z: m.o[2] };
      if (Math.hypot(co.x - eye.x, co.y - eye.y, co.z - eye.z) < 3) o = co;
    }
    let dirs = Array.isArray(m.d) && Array.isArray(m.d[0]) ? m.d : [m.d];
    dirs = dirs.slice(0, w.pellets || 1).filter((d) => Array.isArray(d) && d.length === 3 && d.every(Number.isFinite)).map((d) => {
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      return { x: d[0] / l, y: d[1] / l, z: d[2] / l };
    });
    if (!dirs.length) return;
    if (w.kind === 'proj') {
      const d = dirs[0];
      const pid = this.nextId++;
      const p = { id: pid, kind: 'pproj', owner: a.id, plaza: this.canHitBase(a.x, a.z), w: id, x: o.x + d.x * 0.8, y: o.y + d.y * 0.8, z: o.z + d.z * 0.8, vx: d.x * w.speed, vy: d.y * w.speed, vz: d.z * w.speed, g: w.gravity || 0, ttl: w.range / w.speed + 1.5 };
      this.projs.set(pid, p);
      this.ev({ k: 'pp', id: pid, p: a.id, w: id, x: r2(p.x), y: r2(p.y), z: r2(p.z), vx: r2(p.vx), vy: r2(p.vy), vz: r2(p.vz), g: p.g });
      return;
    }
    const hits = [];
    let dmgDone = 0, disabled = false;
    for (const d of dirs) {
      const res = this.traceShot(o, d, w.range, !!w.pierce);
      for (const h of res) {
        const fo = falloff(w, h.t);
        if (h.tower) {
          const before = h.tower.disabled;
          dmgDone += this.damageTower(h.tower, w.dmg * w.towerMult * fo, a.id);
          if (!before && h.tower.disabled) disabled = true;
        } else if (h.base) {
          if (this.canHitBase(a.x, a.z)) dmgDone += this.damageBase(w.dmg * w.baseMult * fo, a.id);
          else this.priv(a.id, { k: 'shielded' });
        }
      }
      const last = res[res.length - 1];
      hits.push([r1(o.x + d.x * last.t), r1(o.y + d.y * last.t), r1(o.z + d.z * last.t), last.tower || last.base ? 1 : 0]);
    }
    if (dmgDone > 0) { a.stats.hits++; this.priv(a.id, { k: 'hm', d: Math.round(dmgDone), dis: disabled ? 1 : 0 }); }
    this.ev({ k: 'pf', p: a.id, w: id, o: [r1(o.x), r1(o.y), r1(o.z)], h: hits });
  }
  traceShot(o, d, range, pierce) {
    const hits = [];
    for (const t of this.towers.values()) {
      const tt = rayAABB(o, d, towerBox(t));
      if (tt >= 0 && tt <= range) hits.push({ t: tt, tower: t });
    }
    const tb = rayAABB(o, d, this.map.base.box);
    if (tb >= 0 && tb <= range) hits.push({ t: tb, base: true });
    if (d.y < -1e-4) { const tg = -o.y / d.y; if (tg <= range) hits.push({ t: tg, ground: true }); }
    hits.sort((p, q) => p.t - q.t);
    const out = [];
    for (const h of hits) { out.push(h); if (!pierce || h.base || h.ground) break; }
    if (!out.length) out.push({ t: range, none: true });
    return out;
  }
  onEquip(a, m) {
    if (this.phase !== 'assault' || this.paused || !a.alive || a.ghost) return;
    const id = m.e, e = EQUIPMENT[id];
    if (!e || !(a.equip[id] > 0)) return;
    const now = this.time;
    a.equip[id]--;
    if (e.kind === 'throw') {
      let d = Array.isArray(m.d) && m.d.length === 3 && m.d.every(Number.isFinite) ? { x: m.d[0], y: m.d[1], z: m.d[2] } : { x: -Math.sin(a.yaw), y: 0.2, z: -Math.cos(a.yaw) };
      const l = Math.hypot(d.x, d.y, d.z) || 1; d = { x: d.x / l, y: d.y / l, z: d.z / l };
      const pid = this.nextId++;
      const p = { id: pid, kind: 'throw', owner: a.id, plaza: this.canHitBase(a.x, a.z), e: id, x: a.x + d.x * 0.6, y: a.y + PLAYER.eye - 0.2, z: a.z + d.z * 0.6, vx: d.x * 19, vy: d.y * 19 + 3.5, vz: d.z * 19, g: 20, fuse: e.fuse, rest: false };
      this.projs.set(pid, p);
      this.ev({ k: 'pp', id: pid, p: a.id, e: id, x: r2(p.x), y: r2(p.y), z: r2(p.z), vx: r2(p.vx), vy: r2(p.vy), vz: r2(p.vz), g: p.g });
    } else if (id === 'medkit') { a.effects.healUntil = now + e.duration; a.effects.healRate = e.heal / e.duration; }
    else if (id === 'stim') { a.effects.stimUntil = now + e.duration; }
    else if (id === 'cloak') { a.effects.cloakUntil = now + e.duration; }
    else if (id === 'dome') { this.addZone('dome', a.x, a.z, e.radius, e.duration, { owner: a.id }); }
    else if (id === 'drone') { this.scoutUntil = now + e.duration; this.msg(`${a.name} launched a Scout Drone: tower intel revealed!`, 'striker'); }
    this.ev({ k: 'eq', p: a.id, e: id });
  }

  // ------------------------------------------------------------------ defender actions
  onBuild(type, tx, tz) {
    const d = this.defender;
    const fail = (msg) => { if (d && d.id >= 0) this.priv(d.id, { k: 'err', msg }); return null; };
    if (!d) return null;
    if (this.phase !== 'prep' && this.phase !== 'assault' && this.phase !== 'intermission') return fail('Cannot build now.');
    const def = TOWERS[type];
    if (!def || this.s.bannedTowers.includes(type)) return fail('That tower is not allowed.');
    if (!Number.isInteger(tx) || !Number.isInteger(tz) || tx < 0 || tz < 0 || tx >= this.map.w || tz >= this.map.h) return fail('Out of bounds.');
    const i = this.map.idx(tx, tz);
    if (this.occupied.has(i)) return fail('Tile occupied.');
    if (def.place === 'ground' && !this.map.buildable[i]) return fail('Build next to the route on grass pads.');
    if (def.place === 'path' && !this.map.trapable[i]) return fail('Traps go on the route (not near spawn, checkpoints or base).');
    if (this.towers.size >= this.s.maxTowers) return fail(`Tower limit reached (${this.s.maxTowers}).`);
    if (def.max && [...this.towers.values()].filter((t) => t.type === type).length >= def.max) return fail(`Max ${def.max} ${def.name}s.`);
    if (d.coins < def.cost) return fail('Not enough coins.');
    const c = this.map.tileCenter(tx, tz);
    if (def.kind === 'wall') {
      for (const a of this.strikers.values()) if (a.alive && Math.abs(a.x - c.x) < 2.6 && Math.abs(a.z - c.z) < 2.6) return fail('A striker is standing there.');
      for (const r of this.troops.values()) if (!TROOPS[r.type].air && Math.abs(r.x - c.x) < 2.6 && Math.abs(r.z - c.z) < 2.6) return fail('Troops are standing there.');
    }
    d.coins -= def.cost;
    const id = this.nextId++;
    const t = {
      id, type, tx, tz, x: c.x, z: c.z, tile: i, level: 1, st: towerStats(type, 1),
      hp: 0, shield: 0, shieldMax: 0, disabled: false, spent: false, stunUntil: 0, overUntil: 0,
      buildUntil: this.time + (this.phase === 'assault' ? ASSAULT_BUILD_TIME : 0.4),
      cd: 0, yaw: 0, target: 0, mode: def.mode || 'first', invested: def.cost, armed: true,
      dmgBy: new Map(), lastHurt: -99, disabledAt: 0, rangeMult: 1, beamOn: 0, beamT: 0, rebooting: false,
    };
    t.hp = t.st.maxHp;
    this.towers.set(id, t);
    this.occupied.set(i, id);
    if (def.kind === 'wall') this.blocked.add(i);
    d.stats.built++;
    this.ev({ k: 'tb', i: id, type, tx, tz });
    return t;
  }
  onUpgrade(id) {
    const d = this.defender, t = this.towers.get(id);
    if (!d || !t) return;
    const fail = (msg) => { if (d.id >= 0) this.priv(d.id, { k: 'err', msg }); };
    if (t.level >= MAX_LEVEL) return fail('Already max level.');
    if (t.disabled) return fail('Reboot the tower before upgrading.');
    if (TOWERS[t.type].place === 'path' && t.type !== 'barricade') return fail('Traps cannot be upgraded.');
    const cost = upgradeCost(t.type, t.level + 1);
    if (d.coins < cost) return fail('Not enough coins.');
    d.coins -= cost;
    const frac = t.hp / t.st.maxHp;
    t.level++; t.st = towerStats(t.type, t.level); t.invested += cost;
    t.hp = Math.max(1, t.st.maxHp * Math.min(1, frac + 0.25));
    this.ev({ k: 'tu', i: id, lv: t.level });
  }
  onSell(id) {
    const d = this.defender, t = this.towers.get(id);
    if (!d || !t) return;
    if (t.disabled && this.phase === 'assault') { if (d.id >= 0) this.priv(d.id, { k: 'err', msg: 'Disabled towers cannot be sold mid-assault.' }); return; }
    const refund = Math.round(t.invested * this.s.sellRefund * (this.phase === 'assault' ? ECON.assaultSellPenalty : 1));
    d.coins += refund;
    this.towers.delete(id); this.occupied.delete(t.tile); this.blocked.delete(t.tile);
    this.ev({ k: 'ts', i: id, refund });
  }
  onMode(id, mode) {
    const t = this.towers.get(id);
    if (t && TARGET_MODES.includes(mode)) t.mode = mode;
  }
  onAbility(m) {
    const d = this.defender;
    if (!d) return;
    const id = m.a, def = ABILITIES[id];
    const fail = (msg) => { if (d.id >= 0) this.priv(d.id, { k: 'err', msg }); return false; };
    if (!def || this.s.bannedAbilities.includes(id)) return fail('Ability not allowed.');
    if (this.phase !== 'assault') return fail('Abilities only work during the assault.');
    if ((d.cds[id] || 0) > this.time) return fail('Still cooling down.');
    let cost = def.cost || 0;
    let t = null;
    if (def.target === 'tower' || def.target === 'disabled') {
      t = this.towers.get(m.id);
      if (!t) return fail('Select a tower.');
      if (def.target === 'disabled' && (!t.disabled || t.spent)) return fail('That tower is not disabled.');
      if (def.target === 'tower' && !this.towerActive(t)) return fail('Tower must be online.');
      if (id === 'reboot') cost = Math.round(TOWERS[t.type].cost * def.costFrac);
    }
    if (def.target === 'ground' && !(Number.isFinite(m.x) && Number.isFinite(m.z) && this.map.inBounds(m.x, m.z))) return fail('Pick a spot on the map.');
    if (d.coins < cost) return fail('Not enough coins.');
    if (id === 'reboot' && t.st.kind === 'wall') {
      for (const a of this.strikers.values()) if (a.alive && Math.abs(a.x - t.x) < 2.6 && Math.abs(a.z - t.z) < 2.6) return fail('A striker is standing in the gap.');
    }
    d.coins -= cost; d.cds[id] = this.time + def.cd; d.abilityUses++;
    if (id === 'airstrike') {
      const np = this.map.nearestOnPath(m.x, m.z);
      const a = this.map.pointAt(Math.max(0, np.prog - 5)), b = this.map.pointAt(Math.min(this.map.pathLen, np.prog + 5));
      const bombs = [[a.x, a.z], [np.x, np.z], [b.x, b.z]];
      this.addZone('airstrike', np.x, np.z, def.radius, def.delay + 0.2, { at: this.time + def.delay, bombs });
      this.ev({ k: 'ab', a: id, x: r1(np.x), z: r1(np.z), bombs: bombs.map(([x, z]) => [r1(x), r1(z)]) });
    } else if (id === 'cryo') {
      this.addZone('cryo', m.x, m.z, def.radius, def.duration, {});
      this.ev({ k: 'ab', a: id, x: r1(m.x), z: r1(m.z) });
    } else if (id === 'overcharge') {
      t.overUntil = this.time + def.duration;
      this.ev({ k: 'ab', a: id, i: t.id });
    } else if (id === 'reboot') {
      this.rebootTower(t, def.hpFrac);
      this.ev({ k: 'ab', a: id, i: t.id });
    } else if (id === 'fortify') {
      this.base.fortifyUntil = this.time + def.duration;
      this.ev({ k: 'ab', a: id });
    }
    return true;
  }

  // ------------------------------------------------------------------ towers
  resetTower(t) {
    t.disabled = false; t.spent = false; t.hp = t.st.maxHp; t.shield = 0; t.stunUntil = 0; t.overUntil = 0;
    t.armed = true; t.dmgBy = new Map(); t.target = 0; t.cd = 0; t.beamOn = 0; t.beamT = 0; t.buildUntil = Math.min(t.buildUntil, this.time);
    if (t.st.kind === 'wall') this.blocked.add(t.tile);
  }
  rebootTower(t, hpFrac) {
    t.disabled = false; t.spent = false; t.hp = t.st.maxHp * hpFrac; t.shield = 0; t.dmgBy = new Map(); t.lastHurt = this.time;
    if (t.st.kind === 'wall') this.blocked.add(t.tile);
    this.ev({ k: 'tr', i: t.id });
  }
  damageTower(t, dmg, srcPid, opts = {}) {
    if (t.disabled || dmg <= 0) return 0;
    const before = dmg;
    if (t.shield > 0) { const ab = Math.min(t.shield, dmg); t.shield -= ab; dmg -= ab; }
    t.hp -= dmg; t.lastHurt = this.time;
    t.dmgBy.set(srcPid, (t.dmgBy.get(srcPid) || 0) + before);
    const a = this.strikers.get(srcPid);
    if (a) a.stats.towerDmg += before;
    if (t.hp <= 0) this.disableTower(t, srcPid);
    return before;
  }
  disableTower(t, srcPid) {
    t.disabled = true; t.hp = 0; t.shield = 0; t.disabledAt = this.time; t.target = 0; t.beamOn = 0;
    if (t.st.kind === 'wall') this.blocked.delete(t.tile);
    const killer = this.strikers.get(srcPid);
    const lvl = t.level;
    if (killer) {
      this.award(killer.id, Math.round(ECON.strDisable * lvl * this.sFactor), POINTS.strDisable * lvl);
      killer.stats.disables++;
    }
    for (const [pid, dmg] of t.dmgBy) {
      if (pid === srcPid || dmg < t.st.maxHp * 0.15) continue;
      if (this.strikers.has(pid)) this.award(pid, Math.round(ECON.strDisable * lvl * this.sFactor * ECON.strAssistFrac), Math.round(POINTS.strDisable * lvl * 0.4));
    }
    for (const r of this.towers.values()) if (r.rebootTarget === t.id) r.rebootProg = 0;
    this.ev({ k: 'td', i: t.id, by: srcPid });
  }
  damageBase(dmg, srcPid) {
    if (this.base.hp <= 0 || dmg <= 0 || this.locked) return 0;
    if (this.base.fortifyUntil > this.time) dmg *= ABILITIES.fortify.dmgMult;
    dmg = Math.min(dmg, this.base.hp);
    const cap = this.s.coreBreachCap > 0 ? this.base.max * this.s.coreBreachCap / 100 : Infinity;
    if (this.roundBaseDmg + dmg >= cap && this.base.hp - dmg > 0) {
      dmg = Math.max(0, cap - this.roundBaseDmg);
      this.locked = true;
      this.ev({ k: 'lock' });
      this.msg(`🔒 Core lockdown! The base sealed itself after losing ${this.s.coreBreachCap}% this round.`, 'defender');
    }
    this.roundBaseDmg += dmg;
    this.base.hp -= dmg;
    this.baseHitAcc += dmg;
    const a = this.strikers.get(srcPid);
    if (a) {
      a.stats.baseDmg += dmg;
      a.coins += dmg * ECON.strBaseDmg * this.sFactor;
      a.stats.coinsEarned += dmg * ECON.strBaseDmg * this.sFactor;
      a.points += dmg * POINTS.strBasePer10 / 10;
    }
    return dmg;
  }

  collectTargets() {
    const now = this.time;
    const radars = [];
    for (const t of this.towers.values()) if (t.st.kind === 'radar' && this.towerActive(t)) radars.push(t);
    const list = [];
    for (const a of this.strikers.values()) {
      if (!a.alive || a.ghost || now < a.protectUntil) continue;
      if (this.map.inSpawn(a.x, a.z)) continue;
      if (this.inZone(a.x, a.z, 'smoke') || this.inZone(a.x, a.z, 'dome')) continue;
      const cloaked = a.effects.cloakUntil > now;
      const revealed = cloaked && radars.some((r) => dist(r.x, r.z, a.x, a.z) <= r.st.range);
      list.push({ ent: a, striker: true, x: a.x, y: a.y + 1.0, z: a.z, air: false, cloaked, revealed, prog: this.map.progressAt(a.x, a.z), hp: a.hp + a.shield, vx: a.vx, vz: a.vz, taunt: 0 });
    }
    for (const r of this.troops.values()) {
      if (!r.alive) continue;
      if (this.inZone(r.x, r.z, 'smoke') || this.inZone(r.x, r.z, 'dome')) continue;
      const d = TROOPS[r.type];
      list.push({ ent: r, striker: false, x: r.x, y: r.y + (d.air ? 0 : 0.8), z: r.z, air: !!d.air, cloaked: false, prog: d.air ? this.map.nearestOnPath(r.x, r.z).prog : this.map.progressAt(r.x, r.z), hp: r.hp, vx: r.vx, vz: r.vz, taunt: d.taunt || 0 });
    }
    return list;
  }
  pickTarget(cands, mode, t) {
    let best = null, bestS = -Infinity;
    for (const c of cands) {
      let s;
      switch (mode) {
        case 'last': s = -c.prog; break;
        case 'close': s = -dist(c.x, c.z, t.x, t.z); break;
        case 'strong': s = c.hp; break;
        case 'weak': s = -c.hp; break;
        case 'air': s = (c.air ? 1e6 : !c.striker ? 1e5 : 0) + c.prog; break;
        default: s = c.prog;
      }
      if (s > bestS) { bestS = s; best = c; }
    }
    return best;
  }
  slowTarget(c, amount, dur) {
    const e = c.striker ? c.ent.effects : c.ent;
    const now = this.time;
    const mult = 1 - amount;
    if (e.slowUntil > now) e.slowMult = Math.min(e.slowMult, mult); else e.slowMult = mult;
    e.slowUntil = Math.max(e.slowUntil, now + dur);
  }
  damageTarget(c, dmg, dmgType, t, splash = false) {
    dmg *= this.s.towerDmgMult;
    if (c.striker) return this.hurtStriker(c.ent, dmg, dmgType, t, splash, t ? t.type : 'tower');
    if (t && t.st.troopMult) dmg *= t.st.troopMult;
    return this.hurtTroop(c.ent, dmg);
  }
  towerSplash(x, y, z, radius, dmg, dmgType, srcTower, cause) {
    const targets = this.collectTargets();
    for (const c of targets) {
      if (c.air) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d > radius) continue;
      const f = 1 - 0.6 * (d / radius);
      if (c.striker) this.hurtStriker(c.ent, dmg * f * this.s.towerDmgMult, dmgType, srcTower || { x, z }, true, cause);
      else this.hurtTroop(c.ent, dmg * f * this.s.towerDmgMult);
    }
  }

  updateTowers(dt) {
    const now = this.time;
    for (const t of this.towers.values()) { t.shieldMax = 0; t.rangeMult = 1; t.rebooting = false; }
    const supports = [];
    for (const t of this.towers.values()) if (this.towerActive(t) && (t.st.kind === 'shieldgen' || t.st.kind === 'radar' || t.st.kind === 'repair')) supports.push(t);
    for (const g of supports) {
      const buffR = TOWERS.radar.buffRange * LEVEL_MULT[g.level].range;
      for (const t of this.towers.values()) {
        if (t === g) continue;
        const d = dist(t.x, t.z, g.x, g.z);
        if (g.st.kind === 'shieldgen' && d <= g.st.range && TOWERS[t.type].place === 'ground') t.shieldMax = Math.max(t.shieldMax, g.st.shield);
        if (g.st.kind === 'radar' && d <= buffR) t.rangeMult = Math.max(t.rangeMult, 1 + TOWERS.radar.rangeBuff);
      }
    }
    for (const t of this.towers.values()) {
      if (t.disabled || t.shieldMax <= 0) { t.shield = 0; continue; }
      if (t.shield > t.shieldMax) t.shield = t.shieldMax;
      if (now - t.lastHurt > TOWERS.shieldgen.shieldDelay) t.shield = Math.min(t.shieldMax, t.shield + TOWERS.shieldgen.shieldRegen * dt * (t.shieldMax / TOWERS.shieldgen.shield));
    }
    for (const r of supports) {
      if (r.st.kind !== 'repair') continue;
      for (const t of this.towers.values()) {
        if (t === r || t.disabled || t.hp >= t.st.maxHp || now - t.lastHurt < 1.5) continue;
        if (dist(t.x, t.z, r.x, r.z) <= r.st.range) t.hp = Math.min(t.st.maxHp, t.hp + r.st.heal * dt);
      }
      let tgt = r.rebootTarget ? this.towers.get(r.rebootTarget) : null;
      if (!tgt || !tgt.disabled || tgt.spent) {
        tgt = null; r.rebootTarget = null; r.rebootProg = 0;
        let bd = Infinity;
        for (const t of this.towers.values()) {
          if (t === r || !t.disabled || t.spent) continue;
          if ([...this.towers.values()].some((o) => o !== r && o.rebootTarget === t.id)) continue;
          const d = dist(t.x, t.z, r.x, r.z);
          if (d <= r.st.range && d < bd) { bd = d; tgt = t; }
        }
        if (tgt) r.rebootTarget = tgt.id;
      }
      if (tgt) {
        if (tgt.st.kind === 'wall' && [...this.strikers.values()].some((a) => a.alive && Math.abs(a.x - tgt.x) < 2.6 && Math.abs(a.z - tgt.z) < 2.6)) continue;
        tgt.rebooting = true;
        r.rebootProg = (r.rebootProg || 0) + dt;
        if (r.rebootProg >= r.st.rebootTime) { this.rebootTower(tgt, TOWERS.repair.rebootHp); r.rebootTarget = null; r.rebootProg = 0; }
      }
    }
    if (this.s.towerAutoReboot > 0) {
      for (const t of this.towers.values()) if (t.disabled && !t.spent && now - t.disabledAt >= this.s.towerAutoReboot) {
        if (t.st.kind === 'wall' && [...this.strikers.values()].some((a) => a.alive && Math.abs(a.x - t.x) < 2.6 && Math.abs(a.z - t.z) < 2.6)) continue;
        this.rebootTower(t, 0.5);
      }
    }
    const targets = this.collectTargets();
    for (const t of this.towers.values()) {
      if (!this.towerActive(t) || SUPPORT_KINDS.has(t.st.kind)) { t.target = 0; continue; }
      this.towerCombat(t, targets, dt);
    }
    this.coreDefense(targets, dt);
  }
  // The base core zaps the nearest visible intruder (it cannot be disabled).
  coreDefense(targets, dt) {
    const box = this.map.base.box;
    let best = null, bd = BASE_DEFENSE.range;
    for (const c of targets) {
      if (c.cloaked && !c.revealed) continue;
      const d = pointAABBDist({ x: c.x, y: c.y, z: c.z }, box);
      if (d < bd) { bd = d; best = c; }
    }
    this.coreTarget = best ? best.ent.id : 0;
    if (!best) return;
    const dmg = BASE_DEFENSE.dps * dt * this.s.towerDmgMult;
    if (best.striker) this.hurtStriker(best.ent, dmg, 'energy', { x: this.map.base.x, z: this.map.base.z }, false, 'core');
    else this.hurtTroop(best.ent, dmg);
    this.coreFireT = (this.coreFireT || 0) - dt;
    if (this.coreFireT <= 0) { this.coreFireT = 0.3; this.ev({ k: 'cf', x: r1(best.x), y: r1(best.y), z: r1(best.z) }); }
  }

  towerCombat(t, targets, dt) {
    const st = t.st, now = this.time;
    const over = t.overUntil > now ? ABILITIES.overcharge.rateMult : 1;
    const k = st.kind;
    if (k === 'spikes') {
      let any = 0;
      for (const c of targets) {
        if (c.air || Math.abs(c.x - t.x) > 2.2 || Math.abs(c.z - t.z) > 2.2) continue;
        this.damageTarget(c, st.dmg * dt, 'kinetic', t); this.slowTarget(c, st.slow, 0.4); any = c.ent.id;
      }
      t.target = any; return;
    }
    if (k === 'mine') {
      if (!t.armed) return;
      const trig = targets.find((c) => !c.air && dist(c.x, c.z, t.x, t.z) <= st.range && !(c.cloaked && !c.revealed));
      if (!trig) return;
      t.armed = false; t.spent = true; t.disabled = true; t.hp = 0;
      this.towerSplash(t.x, 0.5, t.z, st.splash, st.dmg, 'explosive', t, 'mine');
      this.ev({ k: 'bx', x: r1(t.x), y: 0.5, z: r1(t.z), r: st.splash, kind: 'mine' });
      this.ev({ k: 'td', i: t.id, by: 0, spent: 1 });
      return;
    }
    const range = st.range * t.rangeMult;
    const minR = st.minRange || 0;
    const cands = [];
    for (const c of targets) {
      if (c.cloaked && !c.revealed) continue;
      if (c.air && !st.air) continue;
      if (k === 'aura' && c.air) continue;
      const d = dist(c.x, c.z, t.x, t.z);
      if (d > range || d < minR) continue;
      cands.push(c);
    }
    if (k === 'aura') {
      t.cd -= dt * over;
      if (t.cd > 0) return;
      if (!cands.length) { t.cd = 0; t.target = 0; return; }
      for (const c of cands) { this.damageTarget(c, st.dmg, 'cold', t); this.slowTarget(c, st.slow, 1.0); }
      t.target = cands[0].ent.id;
      t.cd = 1 / st.rate;
      this.ev({ k: 'fp', i: t.id });
      return;
    }
    if (!cands.length) { t.target = 0; t.beamOn = 0; t.beamT = 0; t.cd = Math.max(0, t.cd - dt); return; }
    let pool = cands;
    const taunters = cands.filter((c) => c.taunt > 0 && dist(c.x, c.z, t.x, t.z) <= c.taunt);
    if (taunters.length) pool = taunters;
    const pick = this.pickTarget(pool, t.mode, t);
    t.target = pick.ent.id;
    t.yaw = this.yawToward(t.x, t.z, pick.x, pick.z);
    if (k === 'beam') {
      if (t.beamOn !== pick.ent.id) { t.beamOn = pick.ent.id; t.beamT = 0; }
      t.beamT += dt * over;
      const ramp = 1 + (st.rampMult - 1) * Math.min(1, t.beamT / st.ramp);
      this.damageTarget(pick, st.dmg * ramp * dt * over, 'energy', t);
      return;
    }
    if (k === 'flame') {
      const dps = st.dmg * st.rate * over;
      const fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw);
      for (const c of cands) {
        if (c.air) continue;
        const dx = c.x - t.x, dz = c.z - t.z, dd = Math.hypot(dx, dz) || 1;
        if ((dx * fx + dz * fz) / dd < 0.82) continue;
        this.damageTarget(c, dps * dt, 'fire', t);
        if (c.striker && c.ent.alive) { c.ent.effects.burnUntil = now + st.burnTime; c.ent.effects.burnDps = st.burn * this.s.towerDmgMult; }
        else if (!c.striker) { c.ent.burnUntil = now + st.burnTime; c.ent.burnDps = st.burn; }
      }
      return;
    }
    t.cd -= dt * over;
    if (t.cd > 0) return;
    t.cd = Math.max(0, t.cd) + 1 / st.rate;
    const top = TOWERS[t.type].h;
    if (k === 'hitscan') {
      this.damageTarget(pick, st.dmg, st.dmgType, t);
      this.ev({ k: 'tf', i: t.id, x: r1(pick.x), y: r1(pick.y), z: r1(pick.z) });
    } else if (k === 'shell' || k === 'mortar') {
      const d = dist(t.x, t.z, pick.x, pick.z);
      const dur = k === 'shell' ? d / st.projSpeed : st.flight;
      const lead = k === 'shell' ? dur : 0;
      let tx = pick.x + (pick.vx || 0) * lead, tz = pick.z + (pick.vz || 0) * lead;
      if (!this.map.canWalk(tx, tz, 0.1)) { tx = pick.x; tz = pick.z; }
      const id = this.nextId++;
      this.projs.set(id, { id, kind: 'tshell', src: t.id, cause: t.type, x: tx, y: 0.3, z: tz, t1: now + dur, dmg: st.dmg, splash: st.splash, tk: k });
      this.ev({ k: 'tp', i: t.id, id, kind: k, fx: r1(t.x), fy: top, fz: r1(t.z), tx: r1(tx), ty: 0.3, tz: r1(tz), d: r2(dur) });
    } else if (k === 'missile') {
      for (let s = 0; s < (st.salvo || 1); s++) {
        const id = this.nextId++;
        const p = { id, kind: 'tmissile', src: t.id, cause: t.type, x: t.x + (s - 0.5), y: top, z: t.z, tgt: pick.ent.id, troop: !pick.striker, lx: pick.x, ly: pick.y, lz: pick.z, speed: st.projSpeed, dmg: st.dmg, splash: st.splash, ttl: 4, delay: s * 0.18 };
        this.projs.set(id, p);
        this.ev({ k: 'tp', i: t.id, id, kind: 'missile', fx: r1(p.x), fy: top, fz: r1(p.z), tg: pick.ent.id, sp: st.projSpeed, dl: p.delay });
      }
    } else if (k === 'chain') {
      const hit = [pick];
      const pts = [[r1(pick.x), r1(pick.y), r1(pick.z)]];
      this.damageTarget(pick, st.dmg, 'energy', t);
      let last = pick, dmg = st.dmg;
      for (let j = 1; j < (st.chains || 1); j++) {
        dmg *= st.falloff;
        let nb = null, nd = 8;
        for (const c of targets) {
          if (hit.includes(c) || (c.cloaked && !c.revealed)) continue;
          const d = Math.hypot(c.x - last.x, c.z - last.z);
          if (d < nd) { nd = d; nb = c; }
        }
        if (!nb) break;
        hit.push(nb); pts.push([r1(nb.x), r1(nb.y), r1(nb.z)]);
        this.damageTarget(nb, dmg, 'energy', t);
        last = nb;
      }
      this.ev({ k: 'tc', i: t.id, pts });
    }
  }

  // ------------------------------------------------------------------ troops
  spawnTroop(type, owner) {
    const d = TROOPS[type];
    const sp = this.spawnPoint(false);
    const id = this.nextId++;
    const r = {
      id, type, owner, x: sp.x, z: sp.z, y: d.air ? 4.5 : (d.follow ? 1.2 : 0), hp: d.hp, maxHp: d.hp, alive: true, wp: 1,
      lane: this.rand(-2, 2), slowUntil: 0, slowMult: 1, burnUntil: 0, burnDps: 0, vx: 0, vz: 0, fireT: 0, target: 0, side: this.rand() < 0.5 ? -1 : 1,
    };
    this.troops.set(id, r);
    return r;
  }
  hurtTroop(r, dmg) {
    if (!r.alive || dmg <= 0) return false;
    r.hp -= dmg;
    if (r.hp <= 0) { this.killTroop(r, true); return true; }
    return false;
  }
  killTroop(r, bounty) {
    if (!r.alive) return;
    r.alive = false;
    this.troops.delete(r.id);
    this.ev({ k: 'rk', id: r.id, x: r1(r.x), y: r1(r.y), z: r1(r.z), type: r.type });
    if (bounty && this.defender) {
      this.award(this.defender.id, ECON.defTroopKill, POINTS.defTroopKill);
      this.defender.stats.troopKills++;
    }
  }
  nearestTower(x, z, range, filter) {
    let best = null, bd = range;
    for (const t of this.towers.values()) {
      if (t.disabled || (filter && !filter(t))) continue;
      const d = dist(x, z, t.x, t.z);
      if (d <= bd) { bd = d; best = t; }
    }
    return best;
  }
  updateTroops(dt) {
    const now = this.time;
    while (this.troopQueue.length && this.troopQueue[0].at <= now) {
      const q = this.troopQueue.shift();
      if (this.strikers.has(q.owner)) this.spawnTroop(q.type, q.owner);
    }
    const route = this.map.route;
    for (const r of [...this.troops.values()]) {
      const d = TROOPS[r.type];
      if (r.burnUntil > now) { this.hurtTroop(r, r.burnDps * dt); if (!r.alive) continue; }
      const slow = r.slowUntil > now ? r.slowMult : 1;
      // Targets
      let tgt = null;
      if (r.type === 'sapper') {
        const near = this.nearestTower(r.x, r.z, d.range, (t) => t.st.kind !== 'mine' && t.st.kind !== 'spikes');
        if (near) {
          this.killTroop(r, false);
          for (const t of this.towers.values()) {
            if (t.disabled) continue;
            const dd = dist(t.x, t.z, near.x, near.z);
            if (t === near || dd <= d.blastR) this.damageTower(t, t === near ? d.blast : d.blast * 0.5, r.owner);
          }
          this.ev({ k: 'bx', x: r1(near.x), y: 1, z: r1(near.z), r: d.blastR, kind: 'sapper' });
          continue;
        }
      } else if (d.dps > 0) {
        tgt = this.nearestTower(r.x, r.z, d.range, (t) => t.st.kind !== 'mine');
      }
      // Movement
      let gx, gz, follow = false;
      if (d.follow) {
        const o = this.strikers.get(r.owner);
        if (o && o.alive && !o.ghost) {
          follow = true;
          gx = o.x + Math.cos(o.yaw) * 2.2 * r.side; gz = o.z - Math.sin(o.yaw) * 2.2 * r.side;
        }
      }
      if (!follow) {
        const wpi = Math.min(r.wp, route.length - 1);
        const p = route[wpi], prev = route[Math.max(0, wpi - 1)];
        let px = 0, pz = 0;
        const sl = Math.hypot(p.x - prev.x, p.z - prev.z);
        if (sl > 0 && wpi < route.length - 1) { px = -(p.z - prev.z) / sl; pz = (p.x - prev.x) / sl; }
        gx = p.x + px * r.lane; gz = p.z + pz * r.lane;
      }
      const stop = tgt && (r.type === 'grunts' || r.type === 'mech');
      const baseD = pointAABBDist({ x: r.x, y: 1, z: r.z }, this.map.base.box);
      const atBase = baseD <= Math.max(6, d.range * 0.6);
      if (!stop && !(atBase && !follow)) {
        const dx = gx - r.x, dz = gz - r.z, dd = Math.hypot(dx, dz);
        if (dd > 0.6) {
          const step = Math.min(dd, d.speed * slow * dt);
          const mx = (dx / dd) * step, mz = (dz / dd) * step;
          if (d.air || d.follow) { r.x = clamp(r.x + mx, 1, this.map.w * 4 - 1); r.z = clamp(r.z + mz, 1, this.map.h * 4 - 1); }
          else {
            const np = slideMove(this.map, r.x, r.z, mx, mz, 0.4, this.blocked);
            const movedBy = Math.hypot(np.x - r.x, np.z - r.z);
            r.x = np.x; r.z = np.z;
            if (!tgt && movedBy < step * 0.3) {
              // Blocked (barricade): shoot the nearest wall
              tgt = this.nearestTower(r.x, r.z, Math.max(d.range, 8), (t) => t.st.kind === 'wall');
            }
          }
          r.vx = mx / dt; r.vz = mz / dt;
        } else { r.vx = 0; r.vz = 0; }
        if (!follow && dd < 2.5 && r.wp < route.length - 1) r.wp++;
      } else { r.vx = 0; r.vz = 0; }
      // Attack
      if (tgt && d.dps > 0) {
        this.damageTower(tgt, d.dps * dt, r.owner);
        r.target = tgt.id;
        r.fireT -= dt;
        if (r.fireT <= 0) { r.fireT = 0.4; this.ev({ k: 'rf', id: r.id, x: r1(tgt.x), y: r1(TOWERS[tgt.type].h * 0.6), z: r1(tgt.z) }); }
      } else if ((d.baseDps || 0) > 0 && baseD <= Math.max(8, d.range)) {
        this.damageBase(d.baseDps * dt, r.owner);
        r.target = -1;
        r.fireT -= dt;
        if (r.fireT <= 0) { r.fireT = 0.4; this.ev({ k: 'rf', id: r.id, x: r1(this.map.base.x), y: 5, z: r1(this.map.base.z) }); }
      } else r.target = 0;
      if (d.heal) {
        for (const a of this.strikers.values()) if (a.alive && dist(a.x, a.z, r.x, r.z) <= d.healR) a.hp = Math.min(a.maxHp, a.hp + d.heal * dt);
      }
    }
  }

  // ------------------------------------------------------------------ projectiles & zones
  updateProjectiles(dt) {
    const now = this.time;
    for (const p of [...this.projs.values()]) {
      if (p.kind === 'tshell') {
        if (now >= p.t1) {
          this.projs.delete(p.id);
          const src = this.towers.get(p.src);
          this.towerSplash(p.x, p.y, p.z, p.splash, p.dmg, 'explosive', src || { x: p.x, z: p.z }, p.cause);
          this.ev({ k: 'bx', id: p.id, x: r1(p.x), y: 0.3, z: r1(p.z), r: p.splash, kind: p.tk });
        }
      } else if (p.kind === 'tmissile') {
        if (p.delay > 0) { p.delay -= dt; continue; }
        p.ttl -= dt;
        const tg = p.troop ? this.troops.get(p.tgt) : this.strikers.get(p.tgt);
        if (tg && tg.alive && !(tg.effects && tg.effects.cloakUntil > now)) {
          p.lx = tg.x; p.ly = (tg.y || 0) + (p.troop && TROOPS[tg.type].air ? 0 : 1); p.lz = tg.z;
        }
        const dx = p.lx - p.x, dy = p.ly - p.y, dz = p.lz - p.z, dd = Math.hypot(dx, dy, dz);
        const step = p.speed * dt;
        if (dd <= Math.max(1.2, step) || p.ttl <= 0) {
          this.projs.delete(p.id);
          const src = this.towers.get(p.src) || { x: p.x, z: p.z };
          // direct hit (also hits air) + small splash
          if (tg && tg.alive && dd <= 2) {
            if (p.troop) this.hurtTroop(tg, p.dmg * this.s.towerDmgMult);
            else this.hurtStriker(tg, p.dmg * this.s.towerDmgMult, 'explosive', src, false, p.cause);
          }
          this.towerSplash(p.lx, p.ly, p.lz, p.splash, p.dmg * 0.4, 'explosive', src, p.cause);
          this.ev({ k: 'bx', id: p.id, x: r1(p.lx), y: r1(p.ly), z: r1(p.lz), r: p.splash, kind: 'missile' });
        } else { p.x += (dx / dd) * step; p.y += (dy / dd) * step; p.z += (dz / dd) * step; }
      } else if (p.kind === 'pproj') {
        p.ttl -= dt;
        p.vy -= p.g * dt;
        const sp = Math.hypot(p.vx, p.vy, p.vz);
        const d = { x: p.vx / sp, y: p.vy / sp, z: p.vz / sp };
        const len = sp * dt;
        const res = this.traceShot(p, d, len, false)[0];
        p.flown = (p.flown || 0) + (res.none ? len : res.t);
        if (!res.none || p.ttl <= 0) {
          const t = res.none ? 0 : res.t;
          const hx = p.x + d.x * t, hy = Math.max(0.05, p.y + d.y * t), hz = p.z + d.z * t;
          this.projs.delete(p.id);
          this.playerExplode(p, hx, hy, hz, res.tower || null, !!res.base);
        } else { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
      } else if (p.kind === 'throw') {
        p.fuse -= dt;
        if (!p.rest) {
          p.vy -= p.g * dt;
          let nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
          for (const t of this.towers.values()) {
            const b = towerBox(t);
            if (nx > b.x0 && nx < b.x1 && nz > b.z0 && nz < b.z1 && ny < b.y1) { p.vx *= -0.35; p.vz *= -0.35; nx = p.x; nz = p.z; break; }
          }
          const bb = this.map.base.box;
          if (nx > bb.x0 && nx < bb.x1 && nz > bb.z0 && nz < bb.z1 && ny < bb.y1) { p.vx *= -0.35; p.vz *= -0.35; nx = p.x; nz = p.z; }
          if (ny <= 0.15) { ny = 0.15; p.vy = -p.vy * 0.3; p.vx *= 0.55; p.vz *= 0.55; if (Math.abs(p.vy) < 1.2) { p.rest = true; p.vy = 0; } }
          p.x = nx; p.y = ny; p.z = nz;
        }
        if (p.fuse <= 0) { this.projs.delete(p.id); this.playerExplode(p, p.x, p.y, p.z, null, false); }
      }
    }
  }
  playerExplode(p, x, y, z, directTower, directBase) {
    const now = this.time;
    let kind, radius, splashDmg = 0, towerMult = 1, baseMult = 1, direct = 0;
    if (p.kind === 'throw') {
      const e = EQUIPMENT[p.e];
      kind = p.e; radius = e.radius; splashDmg = e.dmg || 0;
      if (p.e === 'smoke') {
        this.addZone('smoke', x, z, e.radius, e.duration, {});
        this.ev({ k: 'bx', id: p.id, x: r1(x), y: r1(y), z: r1(z), r: radius, kind });
        return;
      }
    } else {
      const w = WEAPONS[p.w];
      const fo = falloff(w, p.flown || 0);
      kind = p.w; radius = w.splash || 1; splashDmg = (w.splashDmg || 0) * fo; towerMult = w.towerMult; baseMult = w.baseMult; direct = w.dmg * fo;
    }
    let dealt = 0, disabled = false;
    if (directTower && direct) {
      const before = directTower.disabled;
      dealt += this.damageTower(directTower, direct * towerMult, p.owner);
      if (!before && directTower.disabled) disabled = true;
    }
    const baseOk = !!p.plaza;
    if (directBase && direct && baseOk) dealt += this.damageBase(direct * baseMult, p.owner);
    if (directBase && !baseOk) this.priv(p.owner, { k: 'shielded' });
    if (splashDmg > 0) {
      for (const t of this.towers.values()) {
        const dd = pointAABBDist({ x, y, z }, towerBox(t));
        if (dd > radius) continue;
        const f = 1 - 0.5 * (dd / radius);
        if (kind === 'emp') { t.stunUntil = Math.max(t.stunUntil, now + EQUIPMENT.emp.stun); t.shield = 0; }
        if (t.disabled) continue;
        dealt += this.damageTower(t, splashDmg * f * towerMult, p.owner);
        if (t.disabled) disabled = true;
      }
      const bd = pointAABBDist({ x, y, z }, this.map.base.box);
      if (bd <= radius && kind !== 'emp' && baseOk) dealt += this.damageBase(splashDmg * (1 - 0.5 * bd / radius) * baseMult, p.owner);
    }
    if (dealt > 0) this.priv(p.owner, { k: 'hm', d: Math.round(dealt), dis: disabled ? 1 : 0 });
    this.ev({ k: 'bx', id: p.id, x: r1(x), y: r1(y), z: r1(z), r: radius, kind });
  }
  addZone(type, x, z, r, dur, extra) {
    const id = this.nextId++;
    this.zones.set(id, { id, type, x, z, r, until: this.time + dur, ...extra });
    return id;
  }
  updateZones(dt) {
    const now = this.time;
    for (const zn of [...this.zones.values()]) {
      if (zn.type === 'cryo') {
        for (const a of this.strikers.values()) if (a.alive && (a.x - zn.x) ** 2 + (a.z - zn.z) ** 2 <= zn.r * zn.r) this.slowTarget({ striker: true, ent: a }, ABILITIES.cryo.slow, 0.3);
        for (const r of this.troops.values()) if (!TROOPS[r.type].air && (r.x - zn.x) ** 2 + (r.z - zn.z) ** 2 <= zn.r * zn.r) this.slowTarget({ striker: false, ent: r }, ABILITIES.cryo.slow, 0.3);
      }
      if (zn.type === 'airstrike' && !zn.done && now >= zn.at) {
        zn.done = true;
        const ab = ABILITIES.airstrike;
        for (const [bx, bz] of zn.bombs) {
          this.towerSplash(bx, 0.5, bz, ab.radius, ab.dmg, 'explosive', { x: bx, z: bz }, 'airstrike');
          this.ev({ k: 'bx', x: r1(bx), y: 0.5, z: r1(bz), r: ab.radius, kind: 'airstrike' });
        }
      }
      if (now >= zn.until) this.zones.delete(zn.id);
    }
  }
  updateCheckpoints(dt) {
    for (const [i, c] of this.checkpoints.entries()) {
      if (c.captured) continue;
      let n = 0;
      for (const a of this.strikers.values()) if (a.alive && !a.ghost && Math.hypot(a.x - c.x, a.z - c.z) <= CHECKPOINT.radius) n++;
      c.contested = [...this.towers.values()].some((t) => !t.disabled && t.st.place === 'ground' && t.st.kind !== 'eco' && dist(t.x, t.z, c.x, c.z) <= CHECKPOINT.clearRadius);
      const contested = c.contested;
      if (n > 0 && !contested) c.cap += dt * (1 + CHECKPOINT.teamBonus * (n - 1)) / CHECKPOINT.time;
      else c.cap = Math.max(0, c.cap - dt / 8);
      if (c.cap >= 1) {
        c.captured = true; c.cap = 1;
        for (const a of this.strikers.values()) {
          this.award(a.id, Math.round(ECON.strCheckpoint * this.sFactor), POINTS.strCheckpoint);
          if (Math.hypot(a.x - c.x, a.z - c.z) <= 6) a.stats.checkpoints++;
        }
        this.ev({ k: 'cp', i });
        this.msg(`Checkpoint ${i + 1} captured! Strikers now respawn there and can resupply.`, 'striker');
      }
    }
  }

  // ------------------------------------------------------------------ input routing
  input(pid, m) {
    if (this.over || !m || typeof m !== 'object') return;
    const a = this.strikers.get(pid);
    if (a && a.isBot) return;
    const def = this.isDefender(pid) && !this.defender.isBot;
    if (this.paused && m.t !== 'st') return;
    switch (m.t) {
      case 'st': if (a) this.onState(a, m); break;
      case 'fire': if (a) this.onFire(a, m); break;
      case 'reload': if (a) this.onReload(a); break;
      case 'switch': if (a) this.onSwitch(a, m.w); break;
      case 'buy': if (a) this.onBuy(a, m.item); break;
      case 'equip': if (a) this.onEquip(a, m); break;
      case 'build': if (def) this.onBuild(m.type, m.tx, m.tz); break;
      case 'upgrade': if (def) this.onUpgrade(m.id); break;
      case 'sell': if (def) this.onSell(m.id); break;
      case 'mode': if (def) this.onMode(m.id, m.mode); break;
      case 'ability': if (def) this.onAbility(m); break;
      case 'answer': if (def) this.onAnswer(m.id, m.choice); break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ serialisation
  snapshot() {
    const now = this.time;
    const a = [], r = [], w = [], c = [], z = [];
    for (const s of this.strikers.values()) {
      let f = 0;
      if (s.alive) f |= 1; if (s.ghost) f |= 2; if (s.effects.cloakUntil > now) f |= 4; if (s.effects.stimUntil > now) f |= 8;
      if (s.effects.burnUntil > now) f |= 16; if (s.effects.slowUntil > now) f |= 32; if (now < s.protectUntil) f |= 64;
      a.push([s.id, r2(s.x), r2(s.y), r2(s.z), r2(s.yaw), r2(s.pitch), Math.ceil(s.hp), Math.ceil(s.shield), SHIELDS[s.shieldType].cap, f, WEAPON_IDS.indexOf(s.weapon), s.maxHp, s.effects.slowUntil > now ? r2(s.effects.slowMult) : 1]);
    }
    for (const t of this.troops.values()) r.push([t.id, TROOP_IDS.indexOf(t.type), r1(t.x), r1(t.y), r1(t.z), Math.ceil(t.hp), t.maxHp, t.owner, t.target]);
    for (const t of this.towers.values()) {
      let f = 0;
      if (t.disabled) f |= 1; if (now < t.stunUntil) f |= 2; if (now < t.buildUntil) f |= 4; if (t.overUntil > now) f |= 8;
      if (t.armed) f |= 16; if (t.rebooting) f |= 32; if (t.spent) f |= 64;
      w.push([t.id, TOWER_IDS.indexOf(t.type), t.tx, t.tz, t.level, Math.ceil(t.hp), t.st.maxHp, Math.ceil(t.shield), Math.round(t.shieldMax), f, r2(t.yaw), t.target, TARGET_MODES.indexOf(t.mode), r2(t.rangeMult)]);
    }
    for (const cp of this.checkpoints) c.push([cp.captured ? 1 : 0, r2(cp.cap), cp.contested ? 1 : 0]);
    for (const zn of this.zones.values()) z.push([zn.id, ZONE_TYPES.indexOf(zn.type), r1(zn.x), r1(zn.z), zn.r, r1(zn.until - now)]);
    return {
      t: 's', tm: r2(now), ph: this.phase, rd: this.round, nr: this.s.rounds, ti: r1(Math.max(0, this.timer)), pa: this.paused ? 1 : 0,
      b: [Math.ceil(this.base.hp), this.base.max, this.base.fortifyUntil > now ? 1 : 0, this.locked ? 1 : 0, Math.round(this.roundBaseDmg || 0)], sc: this.scoutUntil > now ? r1(this.scoutUntil - now) : 0,
      df: r2(this.dFactor), sf: r2(this.sFactor),
      a, r, w, c, z, e: this.drainEvents(),
    };
  }
  meState(pid) {
    const now = this.time;
    const a = this.strikers.get(pid);
    if (a) {
      return {
        t: 'me', role: 'striker', coins: Math.floor(a.coins), points: Math.floor(a.points), owned: [...a.owned], primary: a.primary, weapon: a.weapon,
        mag: a.mag, reloading: a.reloadW ? r1(a.reloadUntil - now) : 0, equip: a.equip, shield: a.shieldType, shields: [...a.shieldsOwned],
        troops: a.troopBuys, alive: a.alive, respawn: a.alive ? 0 : r1(Math.max(0, a.respawnAt - now)), shop: this.canShop(a),
        stim: a.effects.stimUntil > now ? r1(a.effects.stimUntil - now) : 0, cloak: a.effects.cloakUntil > now ? r1(a.effects.cloakUntil - now) : 0,
        prot: now < a.protectUntil ? 1 : 0, factor: r2(this.sFactor),
      };
    }
    if (this.isDefender(pid)) {
      const d = this.defender;
      const cds = {};
      for (const k of Object.keys(ABILITIES)) cds[k] = Math.max(0, r1((d.cds[k] || 0) - now));
      return {
        t: 'me', role: 'defender', coins: Math.floor(d.coins), points: Math.floor(d.points), streak: d.streak, cds, towers: this.towers.size,
        factor: r2(this.dFactor), lock: Math.max(0, r1(d.lockUntil - now)), q: d.q ? d.q.uid : 0, correct: d.stats.correct, wrong: d.stats.wrong,
        qLeft: d.q ? r1(Math.max(0, d.q.deadline - now)) : 0,
      };
    }
    return { t: 'me', role: 'spectator' };
  }
  // A fresh question payload for a (re)connecting defender
  currentQuestionFor(pid) {
    const d = this.defender;
    if (!this.isDefender(pid) || !d.q) return null;
    return { k: 'q', id: d.q.uid, text: d.q.q, options: d.q.options, category: d.q.category, difficulty: d.q.difficulty, time: this.s.questionTime, left: r1(d.q.deadline - this.time), num: d.qNum };
  }
  results() {
    const players = [];
    if (this.defender) {
      const d = this.defender;
      players.push({ ...d.stats, id: d.id, name: d.name, role: 'defender', isBot: d.isBot, points: Math.floor(d.points), coinsEarned: Math.floor(d.stats.coinsEarned), bestStreak: d.bestStreak });
    }
    for (const a of [...this.strikers.values(), ...this.benched.values()]) {
      players.push({ ...a.stats, id: a.id, name: a.name, role: 'striker', isBot: a.isBot, points: Math.floor(a.points), coinsEarned: Math.floor(a.stats.coinsEarned), towerDmg: Math.round(a.stats.towerDmg), baseDmg: Math.round(a.stats.baseDmg), accuracy: a.stats.shots ? Math.round((a.stats.hits / a.stats.shots) * 100) : 0 });
    }
    return { winner: this.winner, rounds: this.round, totalRounds: this.s.rounds, baseHp: Math.ceil(this.base.hp), baseMax: this.base.max, roundLog: this.roundLog, players, nStrikers: this.nStrikers, dFactor: this.dFactor, sFactor: this.sFactor };
  }
}
