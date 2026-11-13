# TowerStrike

A multiplayer (up to 6) HTML5 / three.js voxel **Tower Defense × FPS** mashup.

One **Defender** commands the towers from an isometric view and earns coins by answering quiz questions.
Up to five **Strikers** fight in first person along a fenced route across a green plain, disabling towers
and pushing into the plaza to shatter the crystal core. Towers always come back online at the start of each
round; the core never regenerates.

## Quick start

```bash
npm install
npm start          # http://localhost:3000
npm test           # 43 tests: rules, maps, CSV, real WebSocket match, balance regression
npm run balance    # full bot-vs-bot balance report (all maps × 1-5 strikers)
```

Open the page, enter a name, **Create Game**, and share the invite link or 4-letter room code.
No players handy? Use **+ Bot Striker** / **+ Bot Defender** in the lobby.

## Deploy to Render

The repo includes a Blueprint (`render.yaml`).

1. Push this folder to a GitHub/GitLab repo.
2. In Render: **New → Blueprint**, pick the repo, and apply. It creates one Node web service with
   `npm ci --omit=dev` / `npm start` and a `/healthz` health check.
3. Open the service URL. WebSockets run on the same origin (`wss://…/ws`) automatically.

Manual alternative: **New → Web Service**, Runtime *Node*, Build `npm ci --omit=dev`, Start `npm start`, Health
check path `/healthz`. Render provides `PORT`; the server reads it.

Notes:
- Rooms live in memory, so run **one instance** (don't scale horizontally). Restarting or redeploying ends running matches.
- Render's free plan sleeps after inactivity; the first visit after that takes a few seconds to wake up.
- Static files are gzipped and three.js is served from `node_modules` (no CDN dependency). Google Fonts is
  the only external request, with system-font fallback.

## How a match flows

Each round has a **Prep** phase followed by an **Assault**:

| Phase | Defender | Strikers |
|---|---|---|
| **Prep** (default 60 s) | Build/upgrade towers, answer questions | Scout the route as ghosts (towers are offline), shop for gear and troops |
| **Assault** (default 180 s) | Keep answering, build (3 s construction), use abilities | Fight down the route, disable towers, capture checkpoints, breach the core |
| **Intermission** (8 s) | Round summary; all disabled towers reboot | |

- **Strikers win** by destroying the core. **The defender wins** by surviving every round.
- Towers are **disabled, never destroyed**: at 0 HP they go dark for the rest of the round (unless a Repair Bay or
  Emergency Reboot brings them back), then return at full health next round.
- The **core never regenerates**. Its shield only lets damage through from strikers inside its plaza (or within
  14 m), so you must clear the route first. **Core lockdown** seals it after losing 35% of max HP in a single
  round (host-configurable), so a win takes several successful assaults.
- **Checkpoints** (2 per map): stand on the ring with no online tower within 18 m to capture it. Captured
  checkpoints become forward respawn points and resupply shops for the rest of the round.

## Controls

**Defender (isometric):** click a tower card and then a green pad (traps go *on* the route) · click a tower to
upgrade (`U`), sell (`Del`), retarget, reboot or overcharge · `1`–`4` answer · `Z` Airstrike, `X` Cryo Field,
`C` Overcharge, `V` Emergency Reboot, `F` Fortify Core · `WASD`/arrows or right-drag to pan · wheel zoom · `Q`/`E` rotate · `Esc` cancel.

**Striker (first person):** `WASD` move, `Shift` sprint, `Space` jump, mouse aim, `LMB` fire, `RMB` aim/scope,
`R` reload, `1`/`2` primary/sidearm (wheel cycles), `G` throw the selected grenade, `T` switch grenade (frag / EMP / smoke),
`3`–`0` gear, `B` shop. On touch devices the 💣 button throws and 🔄 switches grenade; tap any gear slot to use it.

**Everyone:** `Enter` chat · `Tab` scoreboard · `M` mute · `H` host panel (host only).

## Host controls

**Lobby:** assign roles (Defender / Striker / Spectator), add or remove bots, kick, transfer host, presets
(Casual / Standard / Hardcore), 24 match settings, ban any tower, weapon, gear, troop or ability, and upload or edit question banks (main + per round).

**In-match host panel (`H`):** pause/resume, skip phase, ±30 s, core HP ±10%, grant or remove coins per player,
reassign roles live (swap the defender, promote spectators, add bot strikers), hand the defence to a bot,
upload or edit the question bank for this or the next round, edit live settings, end the match, or return everyone to the lobby.

Settings include: map, rounds, prep/assault length, core HP multiplier, lockdown %, start coins, reward
multipliers, reward scaling on/off, sell refund, tower cap, seconds per question, wrong-answer lockout,
reveal answers, shuffle options, respawn time, striker HP, tower damage, tower auto-reboot, scouting on/off,
checkpoints on/off, and bot skill.

## Disconnects and rejoining

- **Dropped connection or page refresh:** the client reconnects automatically and resumes the same seat
  (role, coins, weapons, stats). Seats are held for the whole match, and for 60 s in the lobby.
- **Seat already gone** (e.g. a long lobby disconnect): the client rejoins the same room by name automatically.
- **Kicked by the host:** the player lands on the title screen with the room code filled in; pressing **Join**
  puts them back in their old seat with their previous role and match progress. The host can kick again if needed.
- **New browser or device:** join with the room code and the **same name** to reclaim your offline seat.
- Each browser tab is a separate player. If the same seat is opened elsewhere, the old window stops and offers
  "Play here instead" (no tug-of-war between tabs).

## Question banks (fully customisable, CSV or in-browser editor)

The host (teacher) controls exactly which questions the defender gets, round by round:

- **Main bank:** used for every round that has no bank of its own. Starts as the 52-question built-in quiz.
- **Per-round banks:** give any round its own set (e.g. Round 1 = times tables, Round 2 = fractions). Rounds switch
  bank automatically when their prep phase starts.
- **Upload any time:** in the lobby (per bank), or mid-match from the host panel (`H`) with **CSV → this round**
  (live from the very next question) or **CSV → next round**.
- **Editor:** every bank has an **Edit** button: change question text, options (2–4), the correct answer,
  category and difficulty; add or delete questions; import a CSV into it; export it as CSV; **Save & use**.
- Up to 100 questions per bank. A host who is also the defender can still upload, but can't open the answer
  key mid-match.

Download the template from the lobby (`/sample-questions.csv`; it contains the 52 built-in questions).

```
question,option_a,option_b,option_c,option_d,answer,category,difficulty
What is 7 × 8?,54,56,64,48,B,Maths,easy
Capital of France?,Paris,Rome,,,A,Geography,medium
```

- `answer` may be a letter (A–D), a number (1–4) or the exact option text. Options C/D are optional (true/false works).
- `difficulty`: easy / medium / hard (or 1–3), worth ×1 / ×1.25 / ×1.5 coins. Header names are flexible;
  comma, semicolon and tab separated files all work. Bad rows are skipped and reported.
- Answers never leave the server until the defender has answered. Faster answers and streaks pay more;
  wrong answers trigger a short lockout.

## Content

**16 towers** (3 levels each): Sentry Gun, Cannon, Frost Spire, Tesla Coil, Sniper Nest, Flamethrower,
Mortar, Laser Lance, Missile Pod, Shield Generator, Repair Bay, Radar Array, Gold Mine, plus route traps:
Spike Trap, Barricade, Proximity Mine. Per-tower targeting: First / Last / Closest / Strongest / Weakest / Air.
The defender may own at most **2-3 of each tower type** (shown as `n/max` on the card), so the way to get stronger is to
**upgrade** (up to level 3; each level costs more than the last).

**5 defender abilities:** Airstrike, Cryo Field, Overcharge, Emergency Reboot, Fortify Core.

**11 weapons:** Sidearm, Vector SMG, Assault Rifle, Scatter Shotgun, Longshot Sniper (scoped), Rocket
Launcher, Minigun (spin-up), Railgun (pierces), Plasma Rifle, Grenade Launcher (arcing), EMP Disruptor (×2 vs towers).
Damage falls off with range, so strikers must step inside tower range to fight efficiently.

**8 gear items:** Frag, EMP (stuns towers, strips shields), Smoke (towers can't target inside), Medkit, Combat
Stim, Cloak (radar reveals it), Barrier Dome (blocks all tower fire), Scout Drone (team sees ranges, HP and hidden mines).

**4 shields:** Light, Reactive (halves splash), Heavy Bulwark, Energy Barrier (resists Tesla/Laser).

**6 support troops:** Grunt Squad, Shield Bearer (taunts towers), Sapper (suicide charge), Combat Drone
(flying, follows you), Medic Bot, Siege Mech. Each striker can buy up to **6 of each troop type per round**.

**Round buffs:** every striker-side unit (players, bots and troops) automatically gets +8% HP and +6% damage for each
round after the first, mimicking difficulty progression (announced at the start of each prep phase).

**3 maps:** Serpent Meadow, Riverbend, Windmill Hill: voxel plains with ponds, streams, trees, flowers,
wandering sheep, drifting clouds and a working windmill.

## Reward scaling and balance

The defender earns more the more strikers they face, and each striker's share shrinks as the squad grows
(team income still rises). Values are in `shared/defs.js`:

| Strikers | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Defender rewards × | 0.78 | 1.28 | 1.70 | 1.93 | 2.20 |
| Each striker's rewards × | 1.85 | 1.05 | 0.84 | 0.74 | 0.67 |
| Core HP (× 5,000) | 0.75 | 1.75 | 2.50 | 3.25 | 4.00 |
| Respawn time × | 0.5 | 0.8 | 1 | 1 | 1 |

These were tuned with a headless simulation. Bots drive the same server handlers as humans (buying, aiming
with error, answering ~72% correctly at human-like speed, building by route coverage). Final report: 40 matches
per cell, 600 total, `npm run balance 40`:

| Defender win rate | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Serpent Meadow | 0.53 | 0.38 | 0.53 | 0.47 | 0.55 |
| Riverbend | 0.57 | 0.55 | 0.57 | 0.53 | 0.45 |
| Windmill Hill | 0.70 | 0.38 | 0.55 | 0.40 | 0.38 |

Overall 0.50 (mean deviation from 50%: 0.07); matches average 4.8 of 5 rounds. Problems found and fixed
during tuning:
- **Out-ranging:** no damage falloff let strikers dismantle towers from 70 m → added falloff (projectiles too).
- **Defender snowball** at 5 strikers → smaller kill bounty and a gentler, explicit scaling table.
- **One-push wins** → core lockdown cap per round, plus catch-up mechanics: escalating striker stipends and
  up to +50% quiz coins for the defender as the core weakens.
- **Windmill Hill** long sightlines favoured big squads → later checkpoints and a small per-map balance table.
- **Bot hoarding** skewed solo matches → bots now spend like players.

Bots are a proxy for equal-skill humans. Real groups vary, so the host has reward multipliers, core HP,
tower damage and lockdown % to fine-tune.

## Architecture

```
server/index.js    HTTP static host (gzip, ETag) + WebSocket endpoint /ws, heartbeats, rate limiting
server/room.js     lobby, roles, host commands, CSV upload, 30 Hz fixed-step loop, 15 Hz snapshots, reconnect
server/game.js     authoritative simulation: towers, strikers, troops, projectiles, zones, economy, quiz
server/bots.js     bot strikers and bot defender (also used for balance simulation)
server/questions.js built-in question bank + no-repeat deck
shared/            defs (all numbers), maps (route generation, collision), csv parser, util; used by both sides
public/js/         three.js client: world (voxel terrain), voxel models, entities, fx, audio (synthesised),
                   defender (iso), striker (FPS), ui, net, main
test/              node:test suites + balance report
```

The server is authoritative: it validates movement against the route, fire rate, ammo, ownership and shop
location, runs hit detection against tower hitboxes, and never sends quiz answers early. Clients predict
their own movement and effects, and interpolate everything else.
