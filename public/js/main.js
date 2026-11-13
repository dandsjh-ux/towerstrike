// TowerStrike client entry point: wires networking, UI, world and the role-specific controllers.
import * as THREE from 'three';
import { TOWERS, TOWER_IDS } from '/shared/defs.js';
import { escapeHtml as esc } from '/shared/util.js';
import { Net } from './net.js';
import { UI, $ } from './ui.js';
import { World } from './world.js';
import { FX } from './fx.js';
import { Sfx } from './audio.js';
import { Entities } from './entities.js';
import { DefenderMode, SpectatorMode } from './defender.js';
import { StrikerMode } from './striker.js';
import { detectTouch } from './touch.js';

const net = new Net();
const sfx = new Sfx();
const ui = new UI(net, sfx);
let world;
try { world = new World($('gl')); }
catch (e) { $('loading-text').textContent = 'WebGL is not available in this browser. TowerStrike needs a WebGL-capable browser.'; throw e; }
const fx = new FX(world.scene, $('float-layer'));
const ents = new Entities(world, fx, sfx);

let myId = 0, room = null, mode = null, modeRole = null, lastSnap = null, startMsg = null;
const ctx = {
  world, ents, fx, sfx, net, ui,
  settings: () => (room ? room.settings : startMsg ? startMsg.settings : {}),
  phase: () => (lastSnap ? lastSnap.ph : 'prep'),
  paused: () => !!(lastSnap && lastSnap.pa),
  myId: () => myId,
  touch: detectTouch(),
};
document.body.classList.toggle('touch', ctx.touch);
ctx.mode = () => mode;
window.__ts = ctx; // handy for debugging in the console

// ------------------------------------------------------------------ background camera
world.loadMap('meadow');
const titleCam = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.5, 2000);
let orbitT = 0;
function orbitCamera(dt) {
  orbitT += dt * 0.04;
  const W = world.size.W, H = world.size.H;
  const r = Math.max(W, H) * 0.75;
  titleCam.position.set(W / 2 + Math.cos(orbitT) * r, 70, H / 2 + Math.sin(orbitT) * r);
  titleCam.lookAt(W / 2, 0, H / 2);
  titleCam.aspect = window.innerWidth / window.innerHeight;
  titleCam.updateProjectionMatrix();
}

// ------------------------------------------------------------------ role modes
function roleOf(id) { const p = (startMsg?.players || room?.players || []).find((x) => x.id === id); return p ? p.role : 'spectator'; }
function setMode(role) {
  if (mode && modeRole === role) return;
  if (mode) mode.dispose();
  ents.fps = false;
  modeRole = role;
  mode = role === 'defender' ? new DefenderMode(ctx) : role === 'striker' ? new StrikerMode(ctx) : new SpectatorMode(ctx);
  sfx.setCamera(mode.camera);
  world.setViewMode(role === 'striker' ? 'fps' : 'iso');
  document.body.dataset.role = role;
}
function clearMode() { if (mode) mode.dispose(); mode = null; modeRole = null; document.exitPointerLock?.(); world.setViewMode('title'); document.body.dataset.role = ''; }

// ------------------------------------------------------------------ HUD helpers
const PHASE_LABEL = { prep: 'PREP', assault: 'ASSAULT', intermission: 'ROUND OVER', over: 'MATCH OVER' };
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function updateTopbar(s) {
  $('tb-round').textContent = `Round ${s.rd}/${s.nr}`;
  const pill = $('tb-phase');
  pill.textContent = PHASE_LABEL[s.ph] || s.ph;
  pill.className = 'phase-pill ' + s.ph;
  const timer = $('tb-timer');
  timer.textContent = fmtTime(s.ti);
  timer.classList.toggle('low', s.ph === 'assault' && s.ti <= 15);
  const [hp, max, fort, lock, roundDmg] = s.b;
  $('tb-base-fill').style.width = `${(hp / max) * 100}%`;
  $('tb-base-num').textContent = `${hp.toLocaleString()}${fort ? ' 🛡' : ''}`;
  $('tb-lock').classList.toggle('hidden', !lock);
  const cap = ctx.settings().coreBreachCap || 0;
  const capEl = $('tb-base-round');
  if (cap && s.ph === 'assault' && !lock) { const at = Math.max(0, (hp + (roundDmg || 0) - (max * cap) / 100) / max); capEl.style.left = `${at * 100}%`; capEl.style.display = ''; }
  else capEl.style.display = 'none';
  $('pause-overlay').classList.toggle('hidden', !s.pa);
}
function name(id) { return esc(ents.nameOf(id)); }
function hudEvents(s) {
  const myRole = modeRole;
  for (const e of s.e) {
    switch (e.k) {
      case 'kill': ui.feed(`💀 <span class="str">${name(e.v)}</span> eliminated by ${esc(TOWERS[e.by]?.name || (e.by === 'airstrike' ? 'Airstrike' : e.by === 'core' ? 'the Core' : e.by === 'mine' ? 'a mine' : 'defences'))}`, ''); break;
      case 'td': {
        if (e.spent) { ui.feed('💥 A proximity mine detonated', 'def'); break; }
        const t = ents.towers.get(e.i);
        ui.feed(`⚡ ${e.by ? `<span class="str">${name(e.by)}</span>` : 'Strikers'} disabled ${esc(t ? TOWERS[t.type].name : 'a tower')}`, '');
        break;
      }
      case 'tr': { const t = ents.towers.get(e.i); ui.feed(`🔁 ${esc(t ? TOWERS[t.type].name : 'Tower')} back online`, 'def'); break; }
      case 'cp': ui.feed(`🚩 Checkpoint ${e.i + 1} captured!`, 'gold'); if (myRole === 'striker') ui.banner(`CHECKPOINT ${e.i + 1}`, 'Forward respawn & resupply unlocked', 'str', 1800); break;
      case 'msg': ui.feed(esc(e.text), e.cls === 'defender' ? 'def' : e.cls === 'striker' ? 'str' : 'gold'); break;
      case 'lock': ui.banner('CORE LOCKDOWN', 'The core sealed itself for the rest of this round', 'gold', 2600); break;
      case 'ab': if (e.a === 'airstrike') ui.feed('✈ Airstrike inbound!', 'def'); if (e.a === 'fortify') ui.feed('🏰 Core fortified!', 'def'); break;
      case 'ph':
        if (e.ph === 'prep') {
          ui.banner(`ROUND ${e.rd}`, myRole === 'defender' ? 'Build & answer: the assault begins soon' : myRole === 'striker' ? 'Scout the route & gear up (B)' : 'Prep phase', myRole === 'striker' ? 'str' : 'def', 2800);
          $('round-summary').classList.add('hidden');
          sfx.play('horn');
        }
        if (e.ph === 'assault') { ui.banner('ASSAULT!', myRole === 'striker' ? 'Clear the towers. Breach the core.' : myRole === 'defender' ? 'Hold the line!' : '', 'str', 2200); sfx.play('horn'); }
        break;
      case 're': {
        const pct = Math.round((e.hp / e.max) * 100);
        $('round-summary').innerHTML = `<h2>Round ${e.rd} complete</h2><p>Core holds at <b>${pct}%</b> (${e.hp.toLocaleString()} HP)</p><p class="muted">${e.disabled}/${e.towers} towers were disabled · all towers reboot next round</p>`;
        $('round-summary').classList.remove('hidden');
        setTimeout(() => $('round-summary').classList.add('hidden'), 6000);
        break;
      }
      default: break;
    }
  }
}

// ------------------------------------------------------------------ network
net.on('open', () => {
  $('conn-status').classList.add('hidden');
  if (net.session) net.send({ t: 'resume', code: net.session.code, token: net.session.token });
  else if (!ui.screen || ui.screen === 'title') ui.show('title');
});
// Another tab/device resumed this seat: stop here and offer to take it back.
net.on('replaced', () => {
  clearMode(); document.exitPointerLock?.();
  ui.modal('<h2>Playing in another window</h2><p>Your seat was taken over by another tab or device. Only one can play at a time.</p><button class="btn primary big" id="btn-play-here">Play here instead</button>');
  $('btn-play-here').onclick = () => { ui.closeModal(); net.connect(); };
});
net.on('close', () => { if (ui.screen && ui.screen !== 'title') $('conn-status').classList.remove('hidden'); });
// Our seat is gone (e.g. removed after a long disconnect): rejoin the same room by name automatically.
net.on('resumeFailed', () => {
  const s = net.session;
  const name = localStorage.getItem('ts_name');
  net.clearSession();
  if (s && s.code && name) { ui.toast(`Rejoining room ${s.code}…`); net.send({ t: 'join', code: s.code, name }); }
  else ui.show('title');
});
net.on('welcome', (m) => {
  myId = m.id; ui.myId = myId; ents.myId = myId;
  net.saveSession({ code: m.code, token: m.token });
  history.replaceState(null, '', `${location.pathname}?room=${m.code}`);
  $('title-error').textContent = '';
});
net.on('room', (m) => {
  const prevMap = room?.settings?.mapId;
  room = m;
  ui.room = m;
  ents.setPlayers(m.players);
  if (m.state === 'lobby') {
    if (ui.screen !== 'lobby') { clearMode(); ents.reset(); fx.clear(); ui.show('lobby'); }
    ui.renderLobby(m);
    if (m.settings.mapId !== prevMap) world.loadMap(m.settings.mapId);
  }
  if (ui.screen === 'lobby' && m.state !== 'lobby') ui.renderLobby(m);
  if (!$('host-panel').classList.contains('hidden')) ui.renderHostPanel(room, lastSnap);
  document.body.classList.toggle('is-host', m.hostId === myId);
});
net.on('start', (m) => {
  startMsg = m;
  const fresh = ui.screen !== 'game';
  if (fresh) { ents.reset(); fx.clear(); lastSnap = null; $('killfeed').innerHTML = ''; }
  world.loadMap(m.mapId);
  ents.setPlayers(m.players);
  ui.show('game');
  setMode(roleOf(myId));
  if (fresh) {
    const r = modeRole;
    ui.banner(r === 'defender' ? 'YOU ARE THE DEFENDER' : r === 'striker' ? 'YOU ARE A STRIKER' : 'SPECTATING', r === 'defender' ? 'Answer questions → build towers → protect the core' : r === 'striker' ? 'Break through the towers and shatter the core' : '', r === 'defender' ? 'def' : 'str', 3200);
  }
});
net.on('s', (m) => {
  lastSnap = m;
  if (ui.screen !== 'game') return;
  ents.apply(m);
  updateTopbar(m);
  hudEvents(m);
  if (mode && mode.onSnapshot) mode.onSnapshot(m);
  if (!$('scoreboard').classList.contains('hidden')) ui.renderScoreboard(m, room);
});
net.on('p', (m) => { for (const e of m.e) { if (mode) mode.onPrivate(e); if (e.k === 'err' && modeRole !== 'defender') ui.toast(e.msg, 'error'); } });
net.on('me', (m) => { if (mode && m.role === modeRole) mode.onMe(m); });
net.on('chat', (m) => ui.addChat(m));
net.on('error', (m) => { if (m.fatal && !net.session) ui.show('title'); ui.toast(m.msg, 'error'); if (ui.screen === 'title' || !ui.screen) $('title-error').textContent = m.msg; sfx.play('error'); });
// Removed by the host: back to the title with the room code filled in, so Join puts you straight back in.
net.on('kicked', (m) => {
  const code = net.session?.code || room?.code || '';
  net.clearSession();
  clearMode(); ents.reset(); fx.clear(); lastSnap = null; startMsg = null;
  ui.show('title');
  $('code-input').value = code;
  $('title-error').textContent = `You were removed from room ${code}${m.reason ? ` (${m.reason})` : ''}. Press Join to rejoin.`;
});
net.on('over', (m) => { clearMode(); ui.renderResults(m.results, room); ui.show('results'); sfx.play(m.results.winner === 'defender' ? 'correct' : 'explosion'); });
net.on('lobby', () => { clearMode(); ents.reset(); fx.clear(); lastSnap = null; ui.show('lobby'); if (room) ui.renderLobby(room); });
net.on('qreport', (m) => {
  ui.renderQReport(m);
  if (m.count) ui.toast(`✔ ${m.count} questions now in ${ui.bankLabel(m.round || 0)}${m.errorCount ? ` (${m.errorCount} skipped)` : ''}.`, 'good');
});
net.on('qbank', (m) => { document.exitPointerLock?.(); ui.openEditor(m); });

// ------------------------------------------------------------------ global keys
window.addEventListener('keydown', (e) => {
  if (ui.screen !== 'game') return;
  if (e.key === 'Enter') {
    if (ui.chatOpen) ui.closeChat(true); else ui.openChat();
    e.preventDefault(); return;
  }
  if (ui.chatOpen) { if (e.key === 'Escape') ui.closeChat(false); return; }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'Tab') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); ui.renderScoreboard(lastSnap, room); }
  if (e.key.toLowerCase() === 'h' && room && room.hostId === myId) {
    const hp = $('host-panel');
    hp.classList.toggle('hidden');
    if (!hp.classList.contains('hidden')) { document.exitPointerLock?.(); ui.renderHostPanel(room, lastSnap); }
  }
  if (e.key.toLowerCase() === 'm') { sfx.setVolume(sfx.volume > 0 ? 0 : 0.7); ui.toast(sfx.volume ? '🔊 Sound on' : '🔇 Muted'); }
});
window.addEventListener('keyup', (e) => { if (e.key === 'Tab') $('scoreboard').classList.add('hidden'); });
$('btn-host-panel').onclick = () => { const hp = $('host-panel'); hp.classList.toggle('hidden'); if (!hp.classList.contains('hidden')) ui.renderHostPanel(room, lastSnap); };
document.addEventListener('pointerdown', () => sfx.init(), { once: true });
document.addEventListener('keydown', () => sfx.init(), { once: true });
setInterval(() => net.ping(), 5000);

// ------------------------------------------------------------------ render loop
let last = performance.now();
let firstFrame = true;
function step(dt, render = true) {
  world.update(dt);
  if (ui.screen === 'game' && mode) {
    mode.update(dt);
    ents.update(dt, mode.camera);
    fx.update(dt, mode.camera);
    if (!render) return;
    if (mode.render) mode.render(world.renderer, world.scene);
    else world.renderer.render(world.scene, mode.camera);
  } else {
    orbitCamera(dt);
    fx.update(dt, titleCam);
    if (render) world.renderer.render(world.scene, titleCam);
  }
}
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt, true);
  if (firstFrame) { firstFrame = false; const l = $('loading'); l.style.opacity = 0; setTimeout(() => l.classList.add('hidden'), 400); }
}
// Background tabs get no animation frames; keep simulating effects so transient visuals don't pile up.
setInterval(() => {
  const now = performance.now();
  if (now - last < 400) return;
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  step(dt, false);
}, 250);
ctx.step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) step(dt, true); last = performance.now(); };
net.connect();
frame();
