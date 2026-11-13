// TowerStrike - shared game definitions (server + client).
// Every gameplay number lives here so balance tuning happens in one place.

export const GAME_NAME = 'TowerStrike';
export const TILE = 4;              // metres per logic tile
export const MAX_PLAYERS = 6;       // humans + bots per room
export const MAX_QUESTIONS = 100;   // question bank cap
export const TICK_RATE = 30;        // server simulation Hz
export const SNAP_EVERY = 2;        // snapshot every N ticks (15 Hz)
export const INTERMISSION = 8;      // seconds between rounds
export const BASE_HP = 5000;        // base core HP at 1 striker (scaled, see baseMaxHp)
// The core fights back against anyone in the plaza, and its armour shrugs off small arms (see weapon baseMult).
export const BASE_DEFENSE = { dps: 15, range: 22 };
// The core's shield only lets damage through from attackers standing in the plaza or this close to the core.
export const BASE_SHIELD_RANGE = 14;

export const PLAYER = {
  hp: 100,
  speed: 7.0,
  sprintMult: 1.45,
  jump: 7.2,
  gravity: 22,
  radius: 0.45,
  eye: 1.6,
  height: 1.8,
  spawnProtect: 3,
};

// ---------------------------------------------------------------- Towers
// kind: hitscan | shell | mortar | missile | chain | beam | flame | aura | shieldgen | repair | radar | eco | spikes | wall | mine
// place: ground (build pads beside the route) | path (traps placed on the route)
export const TOWERS = {
  sentry: {
    name: 'Sentry Gun', icon: '🔫', cost: 100, hp: 450, range: 28, dmg: 5, rate: 4, kind: 'hitscan', air: true,
    dmgType: 'kinetic', h: 3.2, place: 'ground', mode: 'first',
    desc: 'Cheap rapid-fire turret. Hits drones.',
  },
  cannon: {
    name: 'Cannon', icon: '💣', cost: 175, hp: 650, range: 32, dmg: 45, rate: 0.8, kind: 'shell', splash: 3.2, projSpeed: 32,
    dmgType: 'explosive', h: 3.0, place: 'ground', mode: 'first',
    desc: 'Leads its target with splash shells.',
  },
  frost: {
    name: 'Frost Spire', icon: '❄️', cost: 150, hp: 500, range: 15, dmg: 6, rate: 2, kind: 'aura', slow: 0.4,
    dmgType: 'cold', h: 4.2, place: 'ground', mode: 'close',
    desc: 'Pulses cold: slows and chips everyone nearby.',
  },
  tesla: {
    name: 'Tesla Coil', icon: '⚡', cost: 250, hp: 550, range: 20, dmg: 28, rate: 0.9, kind: 'chain', chains: 3, falloff: 0.7, air: true,
    dmgType: 'energy', h: 4.6, place: 'ground', mode: 'close', troopMult: 1.5,
    desc: 'Arcs lightning across up to 3 targets.',
  },
  sniper: {
    name: 'Sniper Nest', icon: '🎯', cost: 225, hp: 380, range: 60, dmg: 70, rate: 0.45, kind: 'hitscan',
    dmgType: 'kinetic', h: 6.0, place: 'ground', mode: 'strong',
    desc: 'Huge range, heavy hits. Fragile.',
  },
  flamer: {
    name: 'Flamethrower', icon: '🔥', cost: 175, hp: 750, range: 12, dmg: 5, rate: 8, kind: 'flame', burn: 5, burnTime: 3,
    dmgType: 'fire', h: 2.8, place: 'ground', mode: 'close',
    desc: 'Short-range cone that sets strikers ablaze. Tough.',
  },
  mortar: {
    name: 'Mortar', icon: '🎆', cost: 275, hp: 600, range: 50, minRange: 10, dmg: 80, rate: 0.4, kind: 'mortar', splash: 4.5, flight: 1.8,
    dmgType: 'explosive', h: 2.6, place: 'ground', mode: 'first',
    desc: 'Long-range arcing blasts. Dodgeable, cannot hit close.',
  },
  laser: {
    name: 'Laser Lance', icon: '🔆', cost: 300, hp: 550, range: 30, dmg: 12, rate: 1, kind: 'beam', ramp: 3, rampMult: 4, air: true,
    dmgType: 'energy', h: 4.0, place: 'ground', mode: 'first',
    desc: 'Continuous beam that ramps up to 4x damage.',
  },
  missile: {
    name: 'Missile Pod', icon: '🚀', cost: 275, hp: 500, range: 40, dmg: 30, rate: 0.6, salvo: 2, kind: 'missile', splash: 1.6, projSpeed: 24, air: true,
    dmgType: 'explosive', h: 3.2, place: 'ground', mode: 'air',
    desc: 'Homing salvos. Prioritises drones and troops.',
  },
  shieldgen: {
    name: 'Shield Generator', icon: '🛡️', cost: 200, hp: 600, range: 12, kind: 'shieldgen', shield: 160, shieldRegen: 15, shieldDelay: 4,
    h: 4.0, place: 'ground',
    desc: 'Projects regenerating shields onto nearby towers.',
  },
  repair: {
    name: 'Repair Bay', icon: '🔧', cost: 225, hp: 500, range: 12, kind: 'repair', heal: 18, rebootTime: 12, rebootHp: 0.4,
    h: 3.2, place: 'ground',
    desc: 'Heals nearby towers and reboots disabled ones.',
  },
  radar: {
    name: 'Radar Array', icon: '📡', cost: 150, hp: 350, range: 20, kind: 'radar', buffRange: 12, rangeBuff: 0.15,
    h: 5.0, place: 'ground',
    desc: 'Reveals cloaked strikers. +15% range to nearby towers.',
  },
  goldmine: {
    name: 'Gold Mine', icon: '💰', cost: 250, hp: 600, range: 0, kind: 'eco', income: [0, 2.5, 4, 6], max: 2,
    h: 3.0, place: 'ground',
    desc: 'Generates coins every second while online. Max 2.',
  },
  spikes: {
    name: 'Spike Trap', icon: '📌', cost: 60, hp: 300, range: 2, dmg: 18, kind: 'spikes', slow: 0.25,
    dmgType: 'kinetic', h: 0.5, place: 'path',
    desc: 'Route trap: damages and slows anyone crossing it.',
  },
  barricade: {
    name: 'Barricade', icon: '🧱', cost: 80, hp: 900, range: 0, kind: 'wall',
    h: 2.6, place: 'path',
    desc: 'Blocks a route tile until strikers knock it down.',
  },
  mine: {
    name: 'Proximity Mine', icon: '💥', cost: 90, hp: 120, range: 2.5, dmg: 130, splash: 4.5, kind: 'mine',
    dmgType: 'explosive', h: 0.4, place: 'path',
    desc: 'Hidden route charge. One blast per round.',
  },
};
export const TOWER_IDS = Object.keys(TOWERS);
export const MAX_LEVEL = 3;
export const LEVEL_MULT = [null,
  { dmg: 1, range: 1, hp: 1, rate: 1 },
  { dmg: 1.4, range: 1.1, hp: 1.35, rate: 1.1 },
  { dmg: 1.9, range: 1.2, hp: 1.75, rate: 1.2 },
];
export const UPGRADE_COST = [0, 0, 0.75, 1.15]; // fraction of base cost to reach level N
export const TARGET_MODES = ['first', 'last', 'close', 'strong', 'weak', 'air'];
export const ASSAULT_BUILD_TIME = 3; // seconds a tower placed mid-assault takes to come online

export function towerStats(type, level = 1) {
  const d = TOWERS[type];
  const m = LEVEL_MULT[level] || LEVEL_MULT[1];
  return {
    ...d,
    level,
    maxHp: Math.round(d.hp * m.hp),
    range: (d.range || 0) * m.range,
    dmg: (d.dmg || 0) * m.dmg,
    rate: (d.rate || 0) * m.rate,
    shield: (d.shield || 0) * m.dmg,
    heal: (d.heal || 0) * m.dmg,
    rebootTime: d.rebootTime ? d.rebootTime / m.rate / m.rate : 0,
    income: d.income ? d.income[level] : 0,
  };
}
export function upgradeCost(type, toLevel) { return Math.round(TOWERS[type].cost * UPGRADE_COST[toLevel]); }
export function towerInvested(type, level) {
  let c = TOWERS[type].cost;
  for (let l = 2; l <= level; l++) c += upgradeCost(type, l);
  return c;
}
export function towerBox(t) {
  const d = TOWERS[t.type];
  const half = d.kind === 'wall' ? 2.0 : d.place === 'path' ? 1.2 : 1.4;
  return { x0: t.x - half, x1: t.x + half, y0: 0, y1: d.h, z0: t.z - half, z1: t.z + half };
}

// ---------------------------------------------------------------- Defender abilities
export const ABILITIES = {
  airstrike: { name: 'Airstrike', icon: '✈️', key: 'Z', cost: 200, cd: 45, dmg: 120, radius: 6, bombs: 3, delay: 2, target: 'ground', desc: '3 bombs along the route after 2s.' },
  cryo:      { name: 'Cryo Field', icon: '🧊', key: 'X', cost: 120, cd: 30, radius: 10, duration: 10, slow: 0.6, target: 'ground', desc: 'Huge slowing field for 10s.' },
  overcharge:{ name: 'Overcharge', icon: '⏫', key: 'C', cost: 100, cd: 25, duration: 8, rateMult: 2, target: 'tower', desc: 'One tower fires twice as fast for 8s.' },
  reboot:    { name: 'Emergency Reboot', icon: '🔁', key: 'V', costFrac: 0.4, cd: 15, hpFrac: 0.5, target: 'disabled', desc: 'Bring a disabled tower back at 50% HP. Costs 40% of tower price.' },
  fortify:   { name: 'Fortify Core', icon: '🏰', key: 'F', cost: 250, cd: 60, duration: 10, dmgMult: 0.5, target: 'none', desc: 'Base takes half damage for 10s.' },
};
export const ABILITY_IDS = Object.keys(ABILITIES);

// ---------------------------------------------------------------- Striker weapons
// kind: hitscan | proj. fall: [fullDamageUntil m, minDamageFrom m, minFactor] (projectiles: by distance flown).
// baseMult: the core is armoured, so small arms do reduced damage; explosives & siege do full.
export const WEAPONS = {
  pistol:   { name: 'Sidearm', slot: 2, cost: 0, dmg: 24, rate: 3.5, mag: 12, reload: 1.2, range: 70, fall: [15, 40, 0.35], spread: 0.012, kind: 'hitscan', auto: false, towerMult: 1, baseMult: 0.5, recoil: 0.018, sound: 'pistol', desc: 'Reliable backup. Always owned.' },
  smg:      { name: 'Vector SMG', slot: 1, cost: 300, dmg: 11, rate: 12, mag: 36, reload: 1.6, range: 45, fall: [10, 26, 0.3], spread: 0.035, kind: 'hitscan', auto: true, towerMult: 0.95, baseMult: 0.5, recoil: 0.008, sound: 'smg', desc: 'Very fast fire. Best up close.' },
  rifle:    { name: 'Assault Rifle', slot: 1, cost: 450, dmg: 17, rate: 8, mag: 30, reload: 1.8, range: 85, fall: [18, 45, 0.4], spread: 0.016, kind: 'hitscan', auto: true, towerMult: 1, baseMult: 0.5, recoil: 0.012, sound: 'rifle', desc: 'Balanced all-rounder.' },
  shotgun:  { name: 'Scatter Shotgun', slot: 1, cost: 350, dmg: 10, pellets: 9, rate: 1.2, mag: 6, reload: 2.4, range: 30, fall: [8, 22, 0.2], spread: 0.085, kind: 'hitscan', auto: false, towerMult: 1.1, baseMult: 0.5, recoil: 0.06, sound: 'shotgun', desc: '9 pellets. Devastating up close.' },
  sniper:   { name: 'Longshot Sniper', slot: 1, cost: 600, dmg: 120, rate: 0.75, mag: 5, reload: 2.6, range: 220, fall: null, spread: 0.0, hipSpread: 0.05, scope: true, kind: 'hitscan', auto: false, towerMult: 0.85, baseMult: 0.35, recoil: 0.08, sound: 'sniper', desc: 'Scoped (RMB). No falloff: outrange the towers.' },
  rocket:   { name: 'Rocket Launcher', slot: 1, cost: 850, dmg: 90, splash: 4.5, splashDmg: 110, rate: 0.7, mag: 3, reload: 2.8, range: 70, fall: [25, 55, 0.5], kind: 'proj', speed: 40, gravity: 0, towerMult: 1.35, baseMult: 1.1, recoil: 0.08, sound: 'rocket', desc: 'Splash rockets. Great vs towers & base.' },
  minigun:  { name: 'Minigun', slot: 1, cost: 900, dmg: 9, rate: 22, mag: 150, reload: 4.2, range: 55, fall: [15, 36, 0.35], spread: 0.045, spinup: 0.7, moveMult: 0.72, kind: 'hitscan', auto: true, towerMult: 0.9, baseMult: 0.5, recoil: 0.004, sound: 'minigun', desc: 'Spins up, then shreds. Slows you.' },
  railgun:  { name: 'Railgun', slot: 1, cost: 1000, dmg: 180, rate: 0.55, mag: 4, reload: 3, range: 200, fall: null, spread: 0.002, pierce: true, kind: 'hitscan', auto: false, towerMult: 0.85, baseMult: 0.6, recoil: 0.1, sound: 'railgun', desc: 'Pierces every tower in a line.' },
  plasma:   { name: 'Plasma Rifle', slot: 1, cost: 750, dmg: 24, splash: 1.8, splashDmg: 12, rate: 6, mag: 30, reload: 2, range: 60, fall: [18, 40, 0.4], kind: 'proj', speed: 70, gravity: 0, auto: true, towerMult: 1.1, baseMult: 0.7, recoil: 0.01, sound: 'plasma', desc: 'Fast energy bolts with small splash.' },
  launcher: { name: 'Grenade Launcher', slot: 1, cost: 700, dmg: 30, splash: 5, splashDmg: 100, rate: 1.3, mag: 6, reload: 3.2, range: 70, kind: 'proj', speed: 30, gravity: 16, auto: false, towerMult: 1.25, baseMult: 1, recoil: 0.05, sound: 'launcher', desc: 'Arcing splash grenades. Lob over hedges.' },
  disruptor:{ name: 'EMP Disruptor', slot: 1, cost: 650, dmg: 13, rate: 7, mag: 28, reload: 2, range: 60, fall: [18, 40, 0.4], spread: 0.012, kind: 'hitscan', auto: true, towerMult: 2.0, baseMult: 0.2, recoil: 0.008, sound: 'disruptor', desc: 'Double damage to towers, weak vs base.' },
};
export const WEAPON_IDS = Object.keys(WEAPONS);
export function falloff(w, d) {
  if (!w.fall) return 1;
  const [a, b, m] = w.fall;
  if (d <= a) return 1;
  if (d >= b) return m;
  return 1 - (1 - m) * ((d - a) / (b - a));
}

// ---------------------------------------------------------------- Striker equipment (per-round consumables)
export const EQUIPMENT = {
  frag:   { name: 'Frag Grenade', icon: '💣', key: '3', cost: 75, max: 3, kind: 'throw', dmg: 120, radius: 5, fuse: 1.6, desc: 'Explosive damage to towers.' },
  emp:    { name: 'EMP Grenade', icon: '⚡', key: '4', cost: 120, max: 2, kind: 'throw', dmg: 140, radius: 6.5, stun: 5, fuse: 1.4, desc: 'Damages + stuns towers 5s, strips shields.' },
  smoke:  { name: 'Smoke Grenade', icon: '💨', key: '5', cost: 60, max: 3, kind: 'throw', radius: 6.5, duration: 9, fuse: 1.2, desc: 'Towers cannot target anyone inside.' },
  medkit: { name: 'Medkit', icon: '➕', key: '6', cost: 60, max: 3, kind: 'self', heal: 60, duration: 2, desc: 'Heal 60 HP over 2s.' },
  stim:   { name: 'Combat Stim', icon: '💉', key: '7', cost: 80, max: 2, kind: 'self', duration: 8, speedMult: 1.35, rateMult: 1.25, desc: '+35% speed, +25% fire rate for 8s.' },
  cloak:  { name: 'Cloak Device', icon: '👻', key: '8', cost: 150, max: 1, kind: 'self', duration: 7, desc: 'Invisible to towers 7s (radar reveals). Firing breaks it.' },
  dome:   { name: 'Barrier Dome', icon: '🔵', key: '9', cost: 180, max: 1, kind: 'deploy', radius: 4.5, duration: 8, desc: 'Blocks all tower fire into the dome for 8s.' },
  drone:  { name: 'Scout Drone', icon: '🛰️', key: '0', cost: 100, max: 1, kind: 'team', duration: 25, desc: 'Team sees tower ranges, HP & hidden mines for 25s.' },
};
export const EQUIP_IDS = Object.keys(EQUIPMENT);

// ---------------------------------------------------------------- Striker shields (permanent once bought)
export const SHIELDS = {
  none:     { name: 'No Shield', cost: 0, cap: 0, regen: 0, delay: 0, speedMult: 1, desc: '' },
  light:    { name: 'Light Shield', cost: 200, cap: 50, regen: 18, delay: 2.5, speedMult: 1, desc: '50 shield, quick regen.' },
  reactive: { name: 'Reactive Plating', cost: 400, cap: 75, regen: 12, delay: 3, speedMult: 1, splashResist: 0.5, desc: '75 shield, halves splash damage.' },
  heavy:    { name: 'Heavy Bulwark', cost: 450, cap: 130, regen: 10, delay: 4, speedMult: 0.9, desc: '130 shield, -10% speed.' },
  energy:   { name: 'Energy Barrier', cost: 550, cap: 95, regen: 28, delay: 3, speedMult: 1, energyResist: 0.4, desc: '95 shield, fast regen, -40% energy damage.' },
};
export const SHIELD_IDS = Object.keys(SHIELDS);

// ---------------------------------------------------------------- Support troops (bought per round, march at assault start)
export const TROOPS = {
  grunts: { name: 'Grunt Squad', icon: '🪖', cost: 120, count: 3, hp: 60, speed: 4.6, dps: 6, range: 16, baseDps: 6, desc: '3 riflemen that shoot towers.' },
  bearer: { name: 'Shield Bearer', icon: '🛡️', cost: 160, count: 1, hp: 450, speed: 3.8, dps: 0, range: 0, taunt: 12, desc: 'Tanky. Nearby towers must target it.' },
  sapper: { name: 'Sapper', icon: '🧨', cost: 140, count: 1, hp: 80, speed: 6.5, dps: 0, range: 9, blast: 320, blastR: 4, desc: 'Runs at the nearest tower and detonates.' },
  drone:  { name: 'Combat Drone', icon: '🚁', cost: 200, count: 1, hp: 130, speed: 9, dps: 11, range: 20, air: true, follow: true, baseDps: 8, desc: 'Flies with you, shoots towers. Only anti-air hits it.' },
  medic:  { name: 'Medic Bot', icon: '🩺', cost: 180, count: 1, hp: 220, speed: 7.5, dps: 0, range: 0, heal: 8, healR: 9, follow: true, desc: 'Follows you, heals strikers nearby.' },
  mech:   { name: 'Siege Mech', icon: '🤖', cost: 400, count: 1, hp: 950, speed: 2.6, dps: 24, range: 18, baseDps: 45, desc: 'Slow walker. Wrecks the base.' },
};
export const TROOP_IDS = Object.keys(TROOPS);
export const TROOP_BUY_LIMIT = 2; // purchases of each troop type per striker per round

export const ZONE_TYPES = ['smoke', 'dome', 'cryo', 'airstrike'];
// Forward checkpoints: stand within `radius` for `time` seconds while no online tower is within `clearRadius`.
export const CHECKPOINT = { radius: 5, time: 5, clearRadius: 18, teamBonus: 0.2 };

// ---------------------------------------------------------------- Economy & scoring
export const ECON = {
  defQuestion: 25,          // base coins for a correct answer
  defSpeedBonus: 12,        // extra coins for an instant answer (scales down to 0)
  defStreakStep: 3,         // +coins per streak step
  defStreakCap: 15,
  defKill: 15,              // per striker kill (not scaled: more strikers => more kills)
  defTroopKill: 6,
  defRoundBonus: 150,       // surviving a round (scaled)
  strStipend: 330,          // per-striker round start income (scaled)
  strStipendGrowth: 0.15,   // stipend grows +15% per round (late rounds get fiercer)
  defLowHpBonus: 0.5,       // quiz coins up to +50% as the base nears destruction (catch-up)
  strPassive: 3.3,          // coins / s during assault (scaled)
  strDisable: 45,           // per tower disabled, x tower level (scaled)
  strAssistFrac: 0.4,
  strBaseDmg: 0.35,         // coins per base HP removed (scaled)
  strCheckpoint: 100,       // to every striker when a checkpoint is captured (scaled)
  assaultSellPenalty: 0.7,  // sell refund multiplier during assault
};
export const POINTS = {
  defCorrect: 10, defSpeed: 5, defKill: 5, defTroopKill: 1, defRoundSurvive: 50,
  strDisable: 20, strBasePer10: 1, strCheckpoint: 15,
};
export const DIFFICULTY_MULT = { easy: 1, medium: 1.25, hard: 1.5 };

// Reward scaling with the number of strikers the defender faces.
// Defender rewards grow with each extra striker; each striker's rewards shrink so the team total grows slowly.
// Reward multipliers by number of strikers (index = strikers - 1). Tuned with test/balance-report.js so that
// bot-vs-bot matches land near a 50% defender win rate for every team size.
export const REWARD_SCALE = {
  defender: [0.78, 1.28, 1.7, 1.93, 2.2],
  striker: [1.85, 1.05, 0.84, 0.74, 0.67],
};
// Respawn-time multiplier by number of strikers ("lone wolf": small teams get back into the fight faster).
export const RESPAWN_SCALE = [0.5, 0.8, 1, 1, 1];
export function respawnMult(nStrikers) { return tableAt(RESPAWN_SCALE, nStrikers); }
// Base core HP multiplier (x BASE_HP) by number of strikers.
export const BASE_HP_SCALE = [0.75, 1.75, 2.5, 3.25, 4.0];
const tableAt = (arr, n) => arr[Math.max(0, Math.min(arr.length - 1, n - 1))];
export function defenderFactor(nStrikers, s) {
  return (s.scaleRewards ? tableAt(REWARD_SCALE.defender, nStrikers) : 1) * s.defenderRewardMult;
}
export function strikerFactor(nStrikers, s) {
  return (s.scaleRewards ? tableAt(REWARD_SCALE.striker, nStrikers) : 1) * s.strikerRewardMult;
}
export function baseMaxHp(nStrikers, s) {
  return Math.round(BASE_HP * tableAt(BASE_HP_SCALE, nStrikers) * s.baseHpMult);
}

// ---------------------------------------------------------------- Settings (rendered automatically in the lobby)
export const SETTINGS_SCHEMA = [
  { key: 'mapId', label: 'Battlefield', group: 'Match', type: 'select', def: 'meadow', options: [['meadow', 'Serpent Meadow'], ['riverbend', 'Riverbend'], ['windmill', 'Windmill Hill']] },
  { key: 'rounds', label: 'Rounds', group: 'Match', type: 'int', def: 5, min: 1, max: 10 },
  { key: 'prepTime', label: 'Prep / scout time (s)', group: 'Match', type: 'int', def: 60, min: 15, max: 300, step: 5 },
  { key: 'assaultTime', label: 'Assault time (s)', group: 'Match', type: 'int', def: 180, min: 60, max: 600, step: 10 },
  { key: 'baseHpMult', label: 'Base HP multiplier', group: 'Base & Economy', type: 'float', def: 1, min: 0.25, max: 4, step: 0.05 },
  { key: 'coreBreachCap', label: 'Core lockdown: max base damage per round (%, 0=off)', group: 'Base & Economy', type: 'int', def: 35, min: 0, max: 100, step: 5 },
  { key: 'defenderStartCoins', label: 'Defender start coins', group: 'Base & Economy', type: 'int', def: 500, min: 0, max: 5000, step: 50 },
  { key: 'strikerStartCoins', label: 'Striker start coins', group: 'Base & Economy', type: 'int', def: 500, min: 0, max: 5000, step: 50 },
  { key: 'defenderRewardMult', label: 'Defender reward x', group: 'Base & Economy', type: 'float', def: 1, min: 0.25, max: 4, step: 0.05 },
  { key: 'strikerRewardMult', label: 'Striker reward x', group: 'Base & Economy', type: 'float', def: 1, min: 0.25, max: 4, step: 0.05 },
  { key: 'scaleRewards', label: 'Scale rewards by striker count', group: 'Base & Economy', type: 'bool', def: true },
  { key: 'sellRefund', label: 'Tower sell refund', group: 'Base & Economy', type: 'float', def: 0.7, min: 0, max: 1, step: 0.05 },
  { key: 'maxTowers', label: 'Max towers', group: 'Base & Economy', type: 'int', def: 30, min: 5, max: 60 },
  { key: 'questionTime', label: 'Seconds per question', group: 'Questions', type: 'int', def: 20, min: 5, max: 120 },
  { key: 'wrongLockout', label: 'Wrong answer lockout (s)', group: 'Questions', type: 'int', def: 4, min: 0, max: 30 },
  { key: 'showCorrect', label: 'Reveal correct answer', group: 'Questions', type: 'bool', def: true },
  { key: 'shuffleOptions', label: 'Shuffle answer order', group: 'Questions', type: 'bool', def: true },
  { key: 'respawnTime', label: 'Striker respawn (s)', group: 'Combat', type: 'int', def: 5, min: 1, max: 30 },
  { key: 'strikerHpMult', label: 'Striker HP multiplier', group: 'Combat', type: 'float', def: 1, min: 0.5, max: 3, step: 0.05 },
  { key: 'towerDmgMult', label: 'Tower damage multiplier', group: 'Combat', type: 'float', def: 1, min: 0.25, max: 3, step: 0.05 },
  { key: 'towerAutoReboot', label: 'Disabled towers auto-reboot (s, 0=never)', group: 'Combat', type: 'int', def: 0, min: 0, max: 300, step: 5 },
  { key: 'allowScouting', label: 'Strikers can scout the route in prep', group: 'Combat', type: 'bool', def: true },
  { key: 'checkpoints', label: 'Forward checkpoints', group: 'Combat', type: 'bool', def: true },
  { key: 'botSkill', label: 'Bot skill', group: 'Bots', type: 'select', def: 'normal', options: [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']] },
];
export const BAN_LISTS = { bannedTowers: TOWER_IDS, bannedWeapons: WEAPON_IDS.filter((w) => w !== 'pistol'), bannedEquipment: EQUIP_IDS, bannedTroops: TROOP_IDS, bannedAbilities: ABILITY_IDS };

export function defaultSettings() {
  const s = {};
  for (const f of SETTINGS_SCHEMA) s[f.key] = f.def;
  for (const k of Object.keys(BAN_LISTS)) s[k] = [];
  return s;
}

export const PRESETS = {
  casual: { label: 'Casual', values: { rounds: 4, prepTime: 90, assaultTime: 180, defenderStartCoins: 700, strikerStartCoins: 700, questionTime: 30, wrongLockout: 2, respawnTime: 3, baseHpMult: 1, towerDmgMult: 0.85 } },
  standard: { label: 'Standard', values: { rounds: 5, prepTime: 60, assaultTime: 180, defenderStartCoins: 500, strikerStartCoins: 500, questionTime: 20, wrongLockout: 4, respawnTime: 5, baseHpMult: 1, towerDmgMult: 1 } },
  hardcore: { label: 'Hardcore', values: { rounds: 6, prepTime: 45, assaultTime: 150, defenderStartCoins: 400, strikerStartCoins: 400, questionTime: 12, wrongLockout: 6, respawnTime: 8, baseHpMult: 1.15, towerDmgMult: 1.15 } },
};

// Validate and clamp a (possibly partial) settings object from the client.
export function sanitizeSettings(input, current = defaultSettings()) {
  const out = { ...current };
  if (!input || typeof input !== 'object') return out;
  for (const f of SETTINGS_SCHEMA) {
    if (!(f.key in input)) continue;
    const v = input[f.key];
    if (f.type === 'bool') out[f.key] = !!v;
    else if (f.type === 'select') { if (f.options.some((o) => o[0] === v)) out[f.key] = v; }
    else {
      let n = Number(v);
      if (!Number.isFinite(n)) continue;
      if (f.type === 'int') n = Math.round(n);
      out[f.key] = Math.min(f.max, Math.max(f.min, n));
    }
  }
  for (const [k, valid] of Object.entries(BAN_LISTS)) {
    if (Array.isArray(input[k])) out[k] = [...new Set(input[k].filter((x) => valid.includes(x)))];
  }
  // never allow banning everything
  if (out.bannedTowers.length >= TOWER_IDS.length) out.bannedTowers = out.bannedTowers.slice(0, TOWER_IDS.length - 1);
  return out;
}
