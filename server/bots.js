// Server-side AI. Bots drive the exact same Game handlers as humans (onBuy/onFire/onBuild/onAnswer...),
// which is what makes the headless balance simulation meaningful.
import { TOWERS, WEAPONS, EQUIPMENT, SHIELDS, TROOPS, ABILITIES, PLAYER, TILE, towerBox, upgradeCost, MAX_LEVEL } from '../shared/defs.js';
import { slideMove, T } from '../shared/maps.js';
import { dist, pointAABBDist } from '../shared/util.js';

const STRIKER_SKILL = {
  easy: { aim: 0.075, react: 0.55, troops: 0.3, gear: 0.5 },
  normal: { aim: 0.045, react: 0.35, troops: 0.6, gear: 0.8 },
  hard: { aim: 0.028, react: 0.2, troops: 0.85, gear: 1 },
};
const PERSONALITIES = {
  rifleman: ['rifle', 'rocket', 'railgun'],
  rusher: ['smg', 'minigun', 'plasma'],
  demo: ['rifle', 'launcher', 'rocket'],
  marksman: ['rifle', 'sniper', 'railgun'],
  tech: ['smg', 'disruptor', 'plasma'],
};

// Distance a bot tries to close to before holding position and trading fire.
export function engageRange(w) {
  if (!w.fall) return w.kind === 'proj' ? 32 : 50;
  return w.fall[0] * 1.15;
}
function gauss(rng) { return (rng() + rng() + rng() - 1.5) * 1.15; }

export class BotStriker {
  constructor(g, a, skill = 'normal') {
    this.g = g; this.a = a;
    this.S = STRIKER_SKILL[skill] || STRIKER_SKILL.normal;
    const keys = Object.keys(PERSONALITIES);
    this.style = keys[Math.floor(g.rng() * keys.length)];
    this.lane = g.rand(-2.2, 2.2);
    this.wp = null; this.target = null; this.thinkT = 0; this.strafeT = 0; this.strafe = 0;
    this.shopped = false; this.usedDrone = false; this.engageT = 0;
    // cumulative progress of each route node
    const r = g.map.route;
    this.routeProg = r.map((p) => g.map.nearestOnPath(p.x, p.z).prog);
    this.routeProg[0] = -1; this.routeProg[r.length - 1] = g.map.pathLen + 20;
  }
  onPhase(ph) {
    if (ph === 'prep') { this.shopped = false; this.wp = null; this.target = null; }
    if (ph === 'assault') { this.wp = null; this.target = null; this.usedDrone = false; }
  }
  shop() {
    const g = this.g, a = this.a, S = this.S;
    const buy = (item) => g.onBuy(a, item);
    const reserve = 120;
    const prefs = PERSONALITIES[this.style].filter((w) => !g.s.bannedWeapons.includes(w));
    const primaries = [...a.owned].filter((w) => WEAPONS[w].slot === 1);
    if (!primaries.length) {
      for (const w of [...prefs, 'rifle', 'smg'].filter((x) => !g.s.bannedWeapons.includes(x))) { if (a.coins >= WEAPONS[w].cost) { buy('w:' + w); break; } }
    }
    if (a.shieldType === 'none' && a.coins >= SHIELDS.light.cost) buy('s:light');
    // Upgrade weapon along the style ladder
    const best = (a.primary && prefs.indexOf(a.primary)) ?? -1;
    for (let i = prefs.length - 1; i > best; i--) {
      const w = prefs[i];
      if (!a.owned.has(w) && a.coins - WEAPONS[w].cost >= reserve) { buy('w:' + w); break; }
    }
    if (a.shieldType === 'light') {
      const up = this.style === 'tech' ? 'energy' : this.style === 'demo' ? 'reactive' : 'heavy';
      if (a.coins >= SHIELDS[up].cost + 200) buy('s:' + up);
    }
    // Consumables, then support troops, spending down to a small reserve
    const gear = [['medkit', 1], ['emp', 1], ['frag', 1], ['medkit', 2], ['emp', 2], ['smoke', 1], ['frag', 2], ['stim', 1], ['dome', 1], ['medkit', 3]];
    for (const [e, n] of gear) {
      if (g.rng() > S.gear || g.s.bannedEquipment.includes(e)) continue;
      while (a.equip[e] < n && a.coins - EQUIPMENT[e].cost >= reserve) if (!buy('e:' + e)) break;
    }
    if (g.strikers.size >= 2 && a.equip.drone === 0 && a.coins >= 400 && g.rng() < 0.4 && !g.s.bannedEquipment.includes('drone')) buy('e:drone');
    if (g.rng() < S.troops || a.coins > 1500) {
      const order = ['mech', 'bearer', 'grunts', 'sapper', 'drone', 'medic', 'grunts', 'mech', 'bearer', 'sapper']
        .filter((t) => !g.s.bannedTroops.includes(t));
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(g.rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      for (const t of order) if (a.coins - TROOPS[t].cost >= reserve) buy('t:' + t);
    }
    if (a.primary) g.onSwitch(a, a.primary);
  }
  nextWaypoint() {
    const np = this.g.map.nearestOnPath(this.a.x, this.a.z);
    const prog = this.g.map.inPlaza(this.a.x, this.a.z) ? this.g.map.pathLen + 5 : np.prog;
    for (let i = 1; i < this.routeProg.length; i++) if (this.routeProg[i] > prog + 2) return i;
    return this.routeProg.length - 1;
  }
  move(dx, dz, speedMul, dt) {
    const g = this.g, a = this.a;
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) { a.vx = 0; a.vz = 0; return; }
    const e = a.effects;
    let sp = PLAYER.speed * SHIELDS[a.shieldType].speedMult * speedMul;
    if (e.slowUntil > g.time) sp *= e.slowMult;
    if (e.stimUntil > g.time) sp *= EQUIPMENT.stim.speedMult;
    if (WEAPONS[a.weapon].moveMult) sp *= WEAPONS[a.weapon].moveMult;
    const step = Math.min(l, sp * dt);
    const np = slideMove(g.map, a.x, a.z, (dx / l) * step, (dz / l) * step, PLAYER.radius, g.blocked);
    a.vx = (np.x - a.x) / dt; a.vz = (np.z - a.z) / dt;
    a.x = np.x; a.z = np.z; a.lastPosT = g.time;
  }
  think() {
    const g = this.g, a = this.a;
    const w = WEAPONS[a.weapon];
    let best = null, bestS = Infinity;
    for (const t of g.towers.values()) {
      if (t.disabled || t.st.kind === 'mine') continue;
      const d = dist(a.x, a.z, t.x, t.z);
      const maxR = Math.min(60, a.owned.has('sniper') || a.owned.has('railgun') ? 70 : 48);
      if (d > maxR) continue;
      const threat = !['shieldgen', 'repair', 'radar', 'eco', 'wall', 'spikes'].includes(t.st.kind) && t.st.range * t.rangeMult + 3 >= d;
      let s = d - (threat ? 14 : 0) + (t.hp / t.st.maxHp) * 6;
      if (t.st.kind === 'repair' || t.st.kind === 'shieldgen') s -= 6;
      if (t.st.kind === 'wall') s -= d < 10 ? 20 : -20;
      if (s < bestS) { bestS = s; best = t; }
    }
    this.target = best;
    // weapon choice
    if (best) {
      const d = dist(a.x, a.z, best.x, best.z);
      let want = a.primary || 'pistol';
      if (d > 38) for (const lw of ['railgun', 'sniper']) if (a.owned.has(lw)) { want = lw; break; }
      if (d < 12 && a.owned.has('shotgun')) want = 'shotgun';
      if (want !== a.weapon) g.onSwitch(a, want);
    } else if (a.primary && a.weapon !== a.primary) g.onSwitch(a, a.primary);
    // gear usage
    const now = g.time;
    const hpFrac = (a.hp + a.shield) / (a.maxHp + SHIELDS[a.shieldType].cap);
    const underFire = now - a.lastHurt < 0.6;
    if (a.hp < a.maxHp * 0.45 && a.equip.medkit > 0 && a.effects.healUntil < now) g.onEquip(a, { e: 'medkit' });
    if (!this.usedDrone && a.equip.drone > 0) { g.onEquip(a, { e: 'drone' }); this.usedDrone = true; }
    if (underFire && hpFrac < 0.55) {
      if (a.equip.dome > 0) g.onEquip(a, { e: 'dome' });
      else if (a.equip.smoke > 0) g.onEquip(a, { e: 'smoke', d: [0, -1, 0] });
    }
    if (best) {
      const d = dist(a.x, a.z, best.x, best.z);
      if (d < 24 && d > 4) {
        const cluster = [...g.towers.values()].filter((t) => !t.disabled && dist(t.x, t.z, best.x, best.z) < 7).length;
        const throwAt = (e) => {
          const dx = best.x - a.x, dz = best.z - a.z, l = Math.hypot(dx, dz) || 1;
          g.onEquip(a, { e, d: [dx / l, 0.12 + d / 120, dz / l] });
        };
        if (a.equip.emp > 0 && (cluster >= 2 || best.hp > 450)) throwAt('emp');
        else if (a.equip.frag > 0 && (cluster >= 2 || best.hp > 300)) throwAt('frag');
        if (a.equip.stim > 0 && a.effects.stimUntil < now && g.rng() < 0.3) g.onEquip(a, { e: 'stim' });
      }
    }
  }
  shootAt(px, py, pz) {
    const g = this.g, a = this.a, w = WEAPONS[a.weapon];
    if (a.reloadW) return;
    if ((a.mag[a.weapon] || 0) <= 0) { g.onReload(a); return; }
    const rateMult = a.effects.stimUntil > g.time ? EQUIPMENT.stim.rateMult : 1;
    if (g.time - a.lastShot < 1 / (w.rate * rateMult)) return;
    const o = { x: a.x, y: a.y + PLAYER.eye, z: a.z };
    let dx = px - o.x, dy = py - o.y, dz = pz - o.z;
    const hd = Math.hypot(dx, dz);
    if (w.kind === 'proj' && w.gravity) dy += 0.5 * w.gravity * (hd / w.speed) ** 2;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, hd);
    a.yaw = yaw; a.pitch = pitch;
    const err = this.S.aim + (w.spread || 0) * 0.6;
    const n = w.pellets || 1;
    const dirs = [];
    for (let i = 0; i < n; i++) {
      const sp = n > 1 ? w.spread : 0;
      const y2 = yaw + gauss(g.rng) * err + (g.rng() - 0.5) * sp * 2;
      const p2 = pitch + gauss(g.rng) * err * 0.7 + (g.rng() - 0.5) * sp * 2;
      dirs.push([-Math.sin(y2) * Math.cos(p2), Math.sin(p2), -Math.cos(y2) * Math.cos(p2)]);
    }
    g.onFire(a, { w: a.weapon, o: [o.x, o.y, o.z], d: n > 1 ? dirs : dirs[0] });
  }
  update(dt) {
    const g = this.g, a = this.a;
    if (g.phase === 'prep') {
      if (!this.shopped && g.s.prepTime - g.timer > 1) { this.shop(); this.shopped = true; }
      return;
    }
    if (g.phase !== 'assault') return;
    if (!a.alive) { this.wp = null; this.target = null; return; }
    if (this.wp === null) this.wp = this.nextWaypoint();
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = this.S.react * (0.7 + g.rng() * 0.6); this.think(); }
    const t = this.target && !this.target.disabled ? this.target : null;
    const route = g.map.route;
    const base = g.map.base;
    const w = WEAPONS[a.weapon];
    const effR = engageRange(w);
    if (t) {
      const d = dist(a.x, a.z, t.x, t.z);
      const box = towerBox(t);
      this.shootAt(t.x, (box.y0 + box.y1) / 2, t.z);
      if (d > effR || (t.st.kind === 'wall' && d > 6)) this.advance(dt, 0.9);
      else this.strafeMove(dt);
      return;
    }
    const bd = pointAABBDist({ x: a.x, y: 1.5, z: a.z }, base.box);
    if (g.canHitBase(a.x, a.z) && bd < effR + 6 && !g.locked) {
      // Swap to the weapon that hurts the armoured core most
      let bestW = a.weapon, bestV = -1;
      for (const id of a.owned) {
        const ww = WEAPONS[id];
        const v = (ww.dmg * (ww.pellets || 1) + (ww.splashDmg || 0)) * ww.baseMult * ww.rate * (a.mag[id] > 0 ? 1 : 0.5);
        if (v > bestV) { bestV = v; bestW = id; }
      }
      if (bestW !== a.weapon) g.onSwitch(a, bestW);
      this.shootAt(base.x + g.rand(-2, 2), 4 + g.rand(-1.5, 2), base.z + g.rand(-2, 2));
      if (bd > 10) this.advance(dt, 0.8); else this.strafeMove(dt);
      return;
    }
    this.advance(dt, 1);
  }
  advance(dt, mul) {
    const g = this.g, a = this.a, route = g.map.route;
    const i = Math.min(this.wp, route.length - 1);
    const p = route[i], prev = route[Math.max(0, i - 1)];
    const sl = Math.hypot(p.x - prev.x, p.z - prev.z) || 1;
    const lane = i < route.length - 1 ? this.lane : 0;
    const gx = p.x + (-(p.z - prev.z) / sl) * lane, gz = p.z + ((p.x - prev.x) / sl) * lane;
    const dx = gx - a.x, dz = gz - a.z;
    if (Math.hypot(dx, dz) < 2.2 && this.wp < route.length - 1) this.wp++;
    if (!this.target) a.yaw = Math.atan2(-dx, -dz);
    this.move(dx, dz, mul, dt);
  }
  strafeMove(dt) {
    const g = this.g, a = this.a;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeT = 0.5 + g.rng() * 0.9; this.strafe = g.rng() < 0.3 ? 0 : g.rng() < 0.5 ? -1 : 1; }
    if (!this.strafe) { a.vx = 0; a.vz = 0; return; }
    const rx = Math.cos(a.yaw) * this.strafe, rz = -Math.sin(a.yaw) * this.strafe;
    this.move(rx, rz, 0.6, dt);
  }
}

// ----------------------------------------------------------------------------- Defender bot
const DEF_SKILL = {
  easy: { acc: 0.55, ansMin: 6, ansMax: 12, think: 2.5, abil: 0.4 },
  normal: { acc: 0.72, ansMin: 4, ansMax: 9, think: 1.5, abil: 0.8 },
  hard: { acc: 0.88, ansMin: 2.5, ansMax: 6, think: 0.8, abil: 1 },
};
const BUILD_PLAN = ['sentry', 'cannon', 'sentry', 'frost', 'tesla', 'sentry', 'repair', 'flamer', 'sniper', 'shieldgen', 'goldmine', 'mortar',
  'laser', 'missile', 'cannon', 'barricade', 'spikes', 'tesla', 'radar', 'mine', 'sentry', 'flamer', 'laser', 'repair', 'mortar',
  'shieldgen', 'sniper', 'goldmine', 'missile', 'mine', 'spikes', 'cannon', 'tesla', 'laser'];

export class BotDefender {
  constructor(g, d, skill = 'normal') {
    this.g = g; this.d = d;
    this.S = DEF_SKILL[skill] || DEF_SKILL.normal;
    this.planI = 0; this.thinkT = 1; this.qid = 0; this.answerAt = 0;
    const m = g.map;
    this.pathTiles = [];
    for (let i = 0; i < m.tiles.length; i++) {
      const t = m.tiles[i];
      if (t === T.PATH || t === T.PLAZA) {
        const x = i % m.w, z = (i / m.w) | 0;
        const c = m.tileCenter(x, z);
        this.pathTiles.push({ x: c.x, z: c.z, w: 1 + 1.5 * Math.min(1, m.progress[i] / m.pathLen) + (t === T.PLAZA ? 1 : 0) });
      }
    }
    this.buildTiles = [];
    for (let i = 0; i < m.tiles.length; i++) if (m.buildable[i]) this.buildTiles.push(i);
    this.trapTiles = [];
    for (let i = 0; i < m.tiles.length; i++) if (m.trapable[i]) this.trapTiles.push(i);
  }
  onPhase() {}
  onQuestion(q) {
    this.qid = q.uid; this.correct = q.answer; this.nOpts = q.options.length;
    this.answerAt = this.g.time + this.S.ansMin + this.g.rng() * (this.S.ansMax - this.S.ansMin);
  }
  update(dt) {
    const g = this.g;
    if (this.qid && g.time >= this.answerAt && g.time >= this.d.lockUntil) {
      let choice = this.correct;
      if (g.rng() > this.S.acc) choice = (this.correct + 1 + Math.floor(g.rng() * (this.nOpts - 1))) % this.nOpts;
      const id = this.qid; this.qid = 0;
      g.onAnswer(id, choice);
    }
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = this.S.think;
    if (g.phase === 'prep' || g.phase === 'assault') this.build();
    if (g.phase === 'assault' && g.rng() < this.S.abil) this.abilities();
  }
  coverage(cx, cz, range, cover) {
    let s = 0;
    const r2 = range * range;
    for (let i = 0; i < this.pathTiles.length; i++) {
      const p = this.pathTiles[i];
      const dx = p.x - cx, dz = p.z - cz;
      if (dx * dx + dz * dz <= r2) s += p.w / (1 + 0.4 * cover[i]);
    }
    return s;
  }
  coverMap() {
    const cover = new Float32Array(this.pathTiles.length);
    for (const t of this.g.towers.values()) {
      if (t.st.place !== 'ground' || ['shieldgen', 'repair', 'radar', 'eco'].includes(t.st.kind)) continue;
      const r2 = t.st.range * t.st.range;
      this.pathTiles.forEach((p, i) => { if ((p.x - t.x) ** 2 + (p.z - t.z) ** 2 <= r2) cover[i]++; });
    }
    return cover;
  }
  pickTile(type) {
    const g = this.g, m = g.map, def = TOWERS[type];
    const free = (i) => !g.occupied.has(i);
    if (def.place === 'path') {
      const cands = this.trapTiles.filter(free).map((i) => {
        let near = 0;
        const c = m.tileCenter(i % m.w, (i / m.w) | 0);
        for (const t of g.towers.values()) if (t.st.place === 'ground' && dist(t.x, t.z, c.x, c.z) < 18) near++;
        return { i, s: near + m.progress[i] / m.pathLen * 3 + g.rng() * 1.5 };
      }).sort((a, b) => b.s - a.s);
      if (!cands.length) return null;
      const i = cands[0].i;
      return { tx: i % m.w, tz: (i / m.w) | 0 };
    }
    const tiles = this.buildTiles.filter(free);
    if (!tiles.length) return null;
    let best = null, bestS = -Infinity;
    if (['shieldgen', 'repair', 'radar'].includes(def.kind)) {
      for (const i of tiles) {
        const c = m.tileCenter(i % m.w, (i / m.w) | 0);
        let s = 0;
        for (const t of g.towers.values()) {
          if (t.st.place !== 'ground' || t.type === type) continue;
          if (dist(t.x, t.z, c.x, c.z) <= def.range) s += TOWERS[t.type].cost;
        }
        s += g.rng() * 30;
        if (s > bestS) { bestS = s; best = i; }
      }
    } else if (def.kind === 'eco') {
      for (const i of tiles) {
        const c = m.tileCenter(i % m.w, (i / m.w) | 0);
        const s = m.distWalk[i] * 10 - m.nearestOnPath(c.x, c.z).prog / 40 + g.rng() * 4;
        if (s > bestS) { bestS = s; best = i; }
      }
    } else {
      const cover = this.coverMap();
      const range = Math.min(def.range, 30);
      for (const i of tiles) {
        const c = m.tileCenter(i % m.w, (i / m.w) | 0);
        if (def.minRange && m.distWalk[i] < 2) continue;
        const s = this.coverage(c.x, c.z, range, cover) * (0.9 + g.rng() * 0.2);
        if (s > bestS) { bestS = s; best = i; }
      }
    }
    if (best === null) return null;
    return { tx: best % m.w, tz: (best / m.w) | 0 };
  }
  // Upgrade the weakest, most valuable tower we can afford. Returns true if one was upgraded.
  tryUpgrade(reserve) {
    const g = this.g, d = this.d;
    const ups = [...g.towers.values()].filter((t) => !t.disabled && t.level < MAX_LEVEL && t.st.place === 'ground' && t.st.kind !== 'eco')
      .sort((a, b) => a.level - b.level || TOWERS[b.type].cost - TOWERS[a.type].cost);
    for (const t of ups) {
      if (d.coins - upgradeCost(t.type, t.level + 1) >= reserve) { g.onUpgrade(t.id); return true; }
    }
    return false;
  }
  build() {
    const g = this.g, d = this.d;
    const reserve = g.phase === 'assault' ? 90 : 0;
    // Upgrade when the field is reasonably full
    if (g.towers.size >= 7 && d.coins > 300 + reserve && this.tryUpgrade(reserve)) return;
    if (g.towers.size >= g.s.maxTowers) { this.tryUpgrade(reserve); return; }
    for (let tries = 0; tries < BUILD_PLAN.length; tries++) {
      const type = BUILD_PLAN[this.planI % BUILD_PLAN.length];
      const def = TOWERS[type];
      const count = [...g.towers.values()].filter((t) => t.type === type).length;
      if (g.s.bannedTowers.includes(type) || (def.max && count >= def.max)) { this.planI++; continue; }
      if (d.coins - reserve < def.cost) return;
      const tile = this.pickTile(type);
      this.planI++;
      if (tile && g.onBuild(type, tile.tx, tile.tz)) return;
    }
    // Every tower type is at its cap (or has no valid pad): pour the coins into upgrades instead.
    this.tryUpgrade(reserve);
  }
  abilities() {
    const g = this.g, d = this.d, now = g.time;
    const ready = (id) => (d.cds[id] || 0) <= now && !g.s.bannedAbilities.includes(id);
    const alive = [...g.strikers.values()].filter((a) => a.alive && !g.map.inSpawn(a.x, a.z));
    // Reboot valuable towers
    if (ready('reboot')) {
      const dis = [...g.towers.values()].filter((t) => t.disabled && !t.spent && TOWERS[t.type].cost >= 175)
        .sort((a, b) => TOWERS[b.type].cost * b.level - TOWERS[a.type].cost * a.level)[0];
      if (dis && d.coins >= Math.round(TOWERS[dis.type].cost * ABILITIES.reboot.costFrac) + 60) {
        const nearStriker = alive.some((a) => dist(a.x, a.z, dis.x, dis.z) < 12);
        if (!nearStriker || g.rng() < 0.3) { g.onAbility({ a: 'reboot', id: dis.id }); return; }
      }
    }
    if (ready('airstrike') && d.coins >= ABILITIES.airstrike.cost + 80) {
      for (const a of alive) {
        const near = alive.filter((b) => dist(a.x, a.z, b.x, b.z) < 8).length + [...g.troops.values()].filter((r) => dist(a.x, a.z, r.x, r.z) < 8).length;
        if (near >= 2) { g.onAbility({ a: 'airstrike', x: a.x, z: a.z }); return; }
      }
    }
    if (ready('fortify') && g.base.hp < g.base.max * 0.7 && d.coins >= ABILITIES.fortify.cost + 50) {
      const atBase = alive.some((a) => g.map.inPlaza(a.x, a.z)) || [...g.troops.values()].some((r) => r.target === -1);
      if (atBase) { g.onAbility({ a: 'fortify' }); return; }
    }
    if (ready('cryo') && d.coins >= ABILITIES.cryo.cost + 100) {
      for (const a of alive) {
        const near = alive.filter((b) => dist(a.x, a.z, b.x, b.z) < 10).length;
        if (near >= 2 || g.map.inPlaza(a.x, a.z)) { g.onAbility({ a: 'cryo', x: a.x, z: a.z }); return; }
      }
    }
    if (ready('overcharge') && d.coins >= ABILITIES.overcharge.cost + 200) {
      const t = [...g.towers.values()].find((t) => g.towerActive(t) && t.target && t.level >= 2);
      if (t) g.onAbility({ a: 'overcharge', id: t.id });
    }
  }
}
