// Headless match runner used by tests and the balance report.
import { Game } from '../server/game.js';
import { defaultSettings, sanitizeSettings } from '../shared/defs.js';

export function makePlayers(nStrikers, { humanDefender = false } = {}) {
  const players = [{ id: 1, name: humanDefender ? 'Def' : 'BotDef', role: 'defender', isBot: !humanDefender }];
  for (let i = 0; i < nStrikers; i++) players.push({ id: 2 + i, name: `Bot${i + 1}`, role: 'striker', isBot: true });
  return players;
}

export function runMatch({ nStrikers = 2, seed = 1, settings = {}, dt = 1 / 20, maxTime = 7200, onTick = null } = {}) {
  const s = sanitizeSettings(settings, defaultSettings());
  const g = new Game({ settings: s, players: makePlayers(nStrikers), questions: null, seed });
  let guard = 0;
  while (!g.over && g.time < maxTime) {
    g.step(dt);
    g.drainEvents(); g.drainPrivate();
    if (onTick) onTick(g);
    if (++guard > maxTime / dt + 10) break;
  }
  return g;
}

export function summarize(g) {
  const r = g.results();
  const strikers = r.players.filter((p) => p.role === 'striker');
  const def = r.players.find((p) => p.role === 'defender');
  return {
    winner: r.winner,
    rounds: r.rounds,
    baseFrac: r.baseHp / r.baseMax,
    perRound: r.roundLog.map((l) => +(l.baseHp / l.baseMax).toFixed(2)),
    towers: g.towers.size,
    disables: strikers.reduce((s, p) => s + p.disables, 0),
    deaths: strikers.reduce((s, p) => s + p.deaths, 0),
    defCoins: def ? def.coinsEarned : 0,
    strCoins: strikers.reduce((s, p) => s + p.coinsEarned, 0) / Math.max(1, strikers.length),
    kills: def ? def.kills : 0,
  };
}
