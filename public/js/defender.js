// Defender: isometric command view, building, tower management, abilities and the quiz.
import * as THREE from 'three';
import { TOWERS, TOWER_IDS, towerStats, upgradeCost, towerInvested, MAX_LEVEL, ABILITIES, TARGET_MODES, TILE, ECON } from '/shared/defs.js';
import { T } from '/shared/maps.js';
import { escapeHtml as esc } from '/shared/util.js';
import { buildTower, MAT } from './voxel.js';
import { PAD_Y } from './world.js';
import { $ } from './ui.js';

const MODE_LABEL = { first: 'First', last: 'Last', close: 'Closest', strong: 'Strongest', weak: 'Weakest', air: 'Air/Troops' };
const GROUPS = [
  ['Offense', ['sentry', 'cannon', 'frost', 'tesla', 'sniper', 'flamer', 'mortar', 'laser', 'missile']],
  ['Support', ['shieldgen', 'repair', 'radar', 'goldmine']],
  ['Route traps', ['spikes', 'barricade', 'mine']],
];

export class IsoCamera {
  constructor(world) {
    this.world = world;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
    const W = world.size.W, H = world.size.H;
    this.target = new THREE.Vector3(W / 2, 0, H / 2);
    this.zoom = Math.max(W, H) * 0.3; this.zoomT = this.zoom;
    this.angle = Math.PI / 4; this.angleT = this.angle;
    this.pitch = 0.74;
    this.keys = new Set();
    this.drag = null;
    this.onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (e.type === 'keydown') { this.keys.add(k); if (k === 'q') this.angleT += Math.PI / 4; if (k === 'e') this.angleT -= Math.PI / 4; }
      else this.keys.delete(k);
    };
    this.onWheel = (e) => { if (e.target.closest && e.target.closest('.panel')) return; this.zoomT = THREE.MathUtils.clamp(this.zoomT * (e.deltaY > 0 ? 1.12 : 0.89), 14, Math.max(W, H) * 0.7); };
    this.onDown = (e) => { if (e.button === 2 || e.button === 1) { this.drag = { x: e.clientX, y: e.clientY, moved: 0 }; } };
    this.onMove = (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY; this.drag.moved += Math.abs(dx) + Math.abs(dy);
      const s = (this.zoom * 2) / window.innerHeight;
      this.pan(-dx * s, -dy * s / Math.sin(this.pitch));
    };
    this.onUp = () => { this.lastDragMoved = this.drag ? this.drag.moved : 0; this.drag = null; };
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKey);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('mousedown', this.onDown); window.addEventListener('mousemove', this.onMove); window.addEventListener('mouseup', this.onUp);
    this.ctxMenu = (e) => e.preventDefault();
    window.addEventListener('contextmenu', this.ctxMenu);
    this.update(0);
  }
  pan(rx, fz) {
    const a = this.angle;
    const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const fwd = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a));
    this.target.addScaledVector(right, rx).addScaledVector(fwd, -fz);
    this.target.x = THREE.MathUtils.clamp(this.target.x, 0, this.world.size.W);
    this.target.z = THREE.MathUtils.clamp(this.target.z, 0, this.world.size.H);
  }
  update(dt) {
    const k = this.keys;
    if (!document.activeElement || document.activeElement.tagName !== 'INPUT') {
      const sp = this.zoom * 1.4 * dt;
      let rx = 0, fz = 0;
      if (k.has('a') || k.has('arrowleft')) rx -= sp; if (k.has('d') || k.has('arrowright')) rx += sp;
      if (k.has('w') || k.has('arrowup')) fz -= sp; if (k.has('s') || k.has('arrowdown')) fz += sp;
      if (rx || fz) this.pan(rx, fz);
    }
    this.zoom += (this.zoomT - this.zoom) * Math.min(1, dt * 10 || 1);
    this.angle += (this.angleT - this.angle) * Math.min(1, dt * 8 || 1);
    const aspect = window.innerWidth / window.innerHeight;
    const c = this.cam;
    c.left = -this.zoom * aspect; c.right = this.zoom * aspect; c.top = this.zoom; c.bottom = -this.zoom;
    c.updateProjectionMatrix();
    const d = 400;
    c.position.set(this.target.x + Math.sin(this.angle) * Math.cos(this.pitch) * d, Math.sin(this.pitch) * d, this.target.z + Math.cos(this.angle) * Math.cos(this.pitch) * d);
    c.lookAt(this.target);
  }
  groundPoint(clientX, clientY, y = 0) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.cam);
    const p = new THREE.Vector3();
    return rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) ? p : null;
  }
  raycaster(clientX, clientY) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1), this.cam);
    return rc;
  }
  dispose() {
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('wheel', this.onWheel); window.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mousemove', this.onMove); window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('contextmenu', this.ctxMenu);
  }
}

export class SpectatorMode {
  constructor(ctx) {
    this.ctx = ctx;
    this.iso = new IsoCamera(ctx.world);
    this.camera = this.iso.cam;
    ctx.ents.role = 'spectator';
    $('spec-hud').classList.remove('hidden');
    $('hud-hint').textContent = 'WASD / right-drag pan · wheel zoom · Q/E rotate · Tab scoreboard';
  }
  onMe() {} onPrivate() {} onSnapshot() {}
  update(dt) { this.iso.update(dt); }
  dispose() { this.iso.dispose(); $('spec-hud').classList.add('hidden'); }
}

export class DefenderMode {
  constructor(ctx) {
    this.ctx = ctx;
    const { world, ents } = ctx;
    this.iso = new IsoCamera(world);
    this.camera = this.iso.cam;
    ents.role = 'defender';
    this.me = { coins: 0, points: 0, cds: {}, streak: 0 };
    this.sel = null;           // tower type being placed
    this.armed = null;         // ability awaiting a target
    this.selectedTower = 0;
    this.q = null; this.qState = 'wait'; this.qResult = null;
    this.ghost = null; this.ghostType = null;
    $('def-hud').classList.remove('hidden');
    $('hud-hint').textContent = 'Click a tower card, then a green pad · Click towers to manage · 1–4 answer · Z X C V F abilities · WASD/right-drag pan · Q/E rotate · wheel zoom';
    this.buildPalette();
    this.buildAbilities();
    this.renderQuestion();
    this.onMouseMove = (e) => { this.mouse = { x: e.clientX, y: e.clientY }; };
    this.onClick = (e) => this.click(e);
    this.onKey = (e) => this.key(e);
    this.onRight = (e) => { if (e.button === 2) setTimeout(() => { if ((this.iso.lastDragMoved || 0) < 6) this.cancel(); }, 0); };
    window.addEventListener('mousemove', this.onMouseMove);
    ctx.world.renderer.domElement.addEventListener('click', this.onClick);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('mouseup', this.onRight);
    this.panelT = 0;
  }
  dispose() {
    this.iso.dispose();
    window.removeEventListener('mousemove', this.onMouseMove);
    this.ctx.world.renderer.domElement.removeEventListener('click', this.onClick);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('mouseup', this.onRight);
    this.clearGhost();
    this.ctx.world.showGrid(null);
    this.ctx.ents.selectedTower = 0; this.ctx.ents.hoverTower = 0;
    $('def-hud').classList.add('hidden');
    $('tower-panel').classList.add('hidden');
  }
  get s() { return this.ctx.settings(); }

  // ------------------------------------------------------------------ palette & abilities
  buildPalette() {
    const banned = new Set(this.s.bannedTowers);
    $('palette').innerHTML = GROUPS.map(([g, ids]) => `<h4>${g}</h4>` + ids.map((id) => {
      const d = TOWERS[id];
      return `<div class="tcard ${banned.has(id) ? 'banned' : ''}" data-t="${id}" title="${esc(d.desc)}"><div class="ic">${d.icon}</div><div><div class="nm">${d.name}</div><div class="ds">${esc(d.desc)}</div></div><div class="cost">${d.cost}</div></div>`;
    }).join('')).join('');
    $('palette').querySelectorAll('[data-t]').forEach((el) => el.onclick = () => this.pick(el.dataset.t));
  }
  pick(type) {
    this.armed = null;
    this.sel = this.sel === type ? null : type;
    this.selectTower(0);
    this.refreshPalette();
    this.ctx.sfx.play('click');
  }
  refreshPalette() {
    $('palette').querySelectorAll('[data-t]').forEach((el) => {
      el.classList.toggle('sel', el.dataset.t === this.sel);
      el.classList.toggle('poor', TOWERS[el.dataset.t].cost > this.me.coins);
    });
    this.ctx.world.showGrid(this.sel ? TOWERS[this.sel].place : null);
  }
  buildAbilities() {
    const banned = new Set(this.s.bannedAbilities);
    $('abilities').innerHTML = Object.entries(ABILITIES).filter(([id]) => !banned.has(id)).map(([id, a]) =>
      `<div class="ability" data-a="${id}" title="${esc(a.name)}: ${esc(a.desc)}"><span class="key">${a.key}</span><span class="cost">${a.cost ? a.cost : '40%'}</span><div class="ic">${a.icon}</div><div class="nm">${a.name}</div><div class="cd hidden"></div></div>`).join('');
    $('abilities').querySelectorAll('[data-a]').forEach((el) => el.onclick = () => this.useAbility(el.dataset.a));
  }
  useAbility(id) {
    const a = ABILITIES[id];
    if (this.ctx.phase() !== 'assault') { this.ctx.ui.toast('Abilities work during the assault.', 'error'); this.ctx.sfx.play('error'); return; }
    if ((this.me.cds[id] || 0) > 0) { this.ctx.sfx.play('error'); return; }
    if (a.target === 'none') { this.ctx.net.send({ t: 'ability', a: id }); return; }
    if ((a.target === 'tower' || a.target === 'disabled') && this.selectedTower) {
      const t = this.ctx.ents.towers.get(this.selectedTower);
      if (t && ((a.target === 'disabled') === t.disabled)) { this.ctx.net.send({ t: 'ability', a: id, id: t.id }); return; }
    }
    this.sel = null; this.refreshPalette();
    this.armed = this.armed === id ? null : id;
    this.ctx.ui.centerMsg(this.armed ? (a.target === 'ground' ? `Click the map to call ${a.name}` : a.target === 'disabled' ? 'Click a disabled tower to reboot it' : 'Click an online tower to overcharge it') : '', 4000);
    $('abilities').querySelectorAll('[data-a]').forEach((el) => el.classList.toggle('armed', el.dataset.a === this.armed));
  }
  cancel() {
    this.sel = null; this.armed = null; this.selectTower(0); this.refreshPalette();
    $('abilities').querySelectorAll('[data-a]').forEach((el) => el.classList.remove('armed'));
    this.ctx.ui.centerMsg('');
  }

  // ------------------------------------------------------------------ input
  hoverTile() {
    if (!this.mouse) return null;
    const p = this.iso.groundPoint(this.mouse.x, this.mouse.y, PAD_Y * 0.5);
    if (!p) return null;
    const map = this.ctx.world.map;
    const tx = Math.floor(p.x / TILE), tz = Math.floor(p.z / TILE);
    if (tx < 0 || tz < 0 || tx >= map.w || tz >= map.h) return null;
    return { tx, tz, x: p.x, z: p.z, i: map.idx(tx, tz) };
  }
  pickTower(e) {
    const rc = this.iso.raycaster(e.clientX, e.clientY);
    const hits = rc.intersectObjects(this.ctx.ents.towerMeshes(), true);
    for (const h of hits) { let o = h.object; while (o && o.userData.towerId === undefined) o = o.parent; if (o) return this.ctx.ents.towers.get(o.userData.towerId); }
    const tile = this.hoverTile();
    return tile ? this.ctx.ents.towerAtTile(tile.tx, tile.tz) : null;
  }
  click(e) {
    if (e.button !== 0) return;
    const ents = this.ctx.ents, net = this.ctx.net;
    if (this.armed) {
      const a = ABILITIES[this.armed];
      if (a.target === 'ground') { const p = this.iso.groundPoint(e.clientX, e.clientY, 0); if (p) net.send({ t: 'ability', a: this.armed, x: p.x, z: p.z }); }
      else { const t = this.pickTower(e); if (t) net.send({ t: 'ability', a: this.armed, id: t.id }); else { this.ctx.sfx.play('error'); return; } }
      this.armed = null; this.ctx.ui.centerMsg('');
      $('abilities').querySelectorAll('[data-a]').forEach((el) => el.classList.remove('armed'));
      return;
    }
    if (this.sel) {
      const tile = this.hoverTile();
      if (!tile) return;
      const v = this.validTile(this.sel, tile);
      if (!v.ok) { this.ctx.ui.toast(v.msg, 'error'); this.ctx.sfx.play('error'); return; }
      net.send({ t: 'build', type: this.sel, tx: tile.tx, tz: tile.tz });
      if (!e.shiftKey && this.me.coins - TOWERS[this.sel].cost < TOWERS[this.sel].cost) { this.sel = null; this.refreshPalette(); }
      return;
    }
    const t = this.pickTower(e);
    this.selectTower(t ? t.id : 0);
  }
  key(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (['1', '2', '3', '4'].includes(k)) { this.answer(Number(k) - 1); e.preventDefault(); return; }
    for (const [id, a] of Object.entries(ABILITIES)) if (a.key.toLowerCase() === k && !this.s.bannedAbilities.includes(id)) { this.useAbility(id); return; }
    if (k === 'escape') this.cancel();
    if (k === 'u' && this.selectedTower) this.ctx.net.send({ t: 'upgrade', id: this.selectedTower });
    if ((k === 'delete' || k === 'backspace') && this.selectedTower) this.ctx.net.send({ t: 'sell', id: this.selectedTower });
  }
  validTile(type, tile) {
    const map = this.ctx.world.map, d = TOWERS[type];
    if (this.ctx.ents.towerAtTile(tile.tx, tile.tz)) return { ok: false, msg: 'Tile occupied.' };
    if (d.place === 'ground' && !map.buildable[tile.i]) return { ok: false, msg: 'Towers go on the green pads beside the route.' };
    if (d.place === 'path' && !map.trapable[tile.i]) return { ok: false, msg: 'Traps go on the route (not near spawn, checkpoints or the core).' };
    if (this.me.coins < d.cost) return { ok: false, msg: 'Not enough coins: answer questions to earn more!' };
    if (d.max && [...this.ctx.ents.towers.values()].filter((t) => t.type === type).length >= d.max) return { ok: false, msg: `Max ${d.max} ${d.name}s.` };
    return { ok: true };
  }
  clearGhost() { if (this.ghost) { this.ctx.ents.root.remove(this.ghost); this.ghost = null; this.ghostType = null; } }
  updateGhost() {
    if (!this.sel) { this.clearGhost(); return; }
    const tile = this.hoverTile();
    if (!tile) { if (this.ghost) this.ghost.visible = false; return; }
    if (this.ghostType !== this.sel) {
      this.clearGhost();
      const g = new THREE.Group();
      const m = buildTower(this.sel, 1);
      m.group.traverse((o) => { if (o.isMesh) { o.material = MAT.ghost; o.castShadow = false; } });
      g.add(m.group);
      const r = TOWERS[this.sel].range;
      if (r > 2) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.3, r, 64), new THREE.MeshBasicMaterial({ color: 0x7cff8a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1; g.add(ring);
        const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 64), new THREE.MeshBasicMaterial({ color: 0x7cff8a, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
        fill.rotation.x = -Math.PI / 2; fill.position.y = 0.09; g.add(fill);
        g.userData.ring = ring; g.userData.fill = fill;
      }
      this.ghost = g; this.ghostType = this.sel;
      this.ctx.ents.root.add(g);
    }
    const v = this.validTile(this.sel, tile);
    this.ghost.visible = true;
    const place = TOWERS[this.sel].place;
    this.ghost.position.set((tile.tx + 0.5) * TILE, place === 'path' ? 0 : PAD_Y, (tile.tz + 0.5) * TILE);
    const col = v.ok ? 0x7cff8a : 0xff5050;
    if (this.ghost.userData.ring) { this.ghost.userData.ring.material.color.setHex(col); this.ghost.userData.fill.material.color.setHex(col); }
  }

  // ------------------------------------------------------------------ tower panel
  selectTower(id) {
    this.selectedTower = id;
    this.ctx.ents.selectedTower = id;
    $('tower-panel').classList.toggle('hidden', !id);
    if (id) { this.sel = null; this.refreshPalette(); this.renderTowerPanel(); }
  }
  renderTowerPanel() {
    const t = this.ctx.ents.towers.get(this.selectedTower);
    if (!t) { this.selectTower(0); return; }
    const d = TOWERS[t.type], st = towerStats(t.type, t.level);
    const next = t.level < MAX_LEVEL && (d.place === 'ground' || t.type === 'barricade') ? upgradeCost(t.type, t.level + 1) : null;
    const nst = next ? towerStats(t.type, t.level + 1) : null;
    const assault = this.ctx.phase() === 'assault';
    const refund = Math.round(towerInvested(t.type, t.level) * this.s.sellRefund * (assault ? ECON.assaultSellPenalty : 1));
    const rebootCost = Math.round(d.cost * ABILITIES.reboot.costFrac);
    const status = t.disabled ? (t.flags & 64 ? '<span class="status" style="color:var(--muted)">Spent (re-arms next round)</span>' : '<span class="status" style="color:var(--bad)">DISABLED</span>') : t.flags & 4 ? '<span class="status" style="color:var(--gold)">Building…</span>' : t.flags & 2 ? '<span class="status" style="color:var(--shield)">EMP stunned</span>' : '<span class="status" style="color:var(--good)">Online</span>';
    const stats = [];
    stats.push(`HP <b>${Math.ceil(t.hp)}/${t.maxHp}</b>`);
    if (t.shieldMax) stats.push(`Shield <b>${Math.ceil(t.shield)}/${t.shieldMax}</b>`);
    if (st.dmg) stats.push(`Damage <b>${st.dmg.toFixed(st.dmg < 10 ? 1 : 0)}${nst ? ` → ${nst.dmg.toFixed(nst.dmg < 10 ? 1 : 0)}` : ''}</b>`);
    if (st.rate && d.kind !== 'beam') stats.push(`Rate <b>${st.rate.toFixed(2)}/s</b>`);
    if (st.range > 2) stats.push(`Range <b>${(st.range * (t.rangeMult || 1)).toFixed(0)}m</b>`);
    if (st.income) stats.push(`Income <b>${st.income}/s</b>`);
    if (st.shield) stats.push(`Projects <b>${st.shield.toFixed(0)}</b> shield`);
    if (st.heal) stats.push(`Heals <b>${st.heal.toFixed(0)}/s</b>`);
    if (d.air) stats.push('<b>Hits air</b>');
    const combat = !['shieldgen', 'repair', 'radar', 'eco', 'wall', 'spikes', 'mine', 'aura'].includes(d.kind);
    $('tower-panel').innerHTML = `<h3><span>${d.icon} ${d.name} <span class="muted small">Lv ${t.level}</span></span><button class="btn tiny ghost" data-close>✕</button></h3>${status}
      <div class="stats">${stats.map((s) => `<div>${s}</div>`).join('')}</div>
      ${combat ? `<div class="muted small">Targeting</div><div class="modes">${TARGET_MODES.filter((m) => m !== 'air' || d.air).map((m) => `<button class="btn tiny ${t.mode === m ? 'active' : ''}" data-mode="${m}">${MODE_LABEL[m]}</button>`).join('')}</div>` : ''}
      <div class="acts">
        ${next !== null ? `<button class="btn small def" data-up ${t.disabled || next > this.me.coins ? 'disabled' : ''}>Upgrade (U) ${next}💰</button>` : '<span class="muted small">Max level</span>'}
        <button class="btn small" data-sell ${t.disabled && assault ? 'disabled' : ''}>Sell +${refund}💰</button>
        ${t.disabled && !(t.flags & 64) ? `<button class="btn small" data-reboot ${(this.me.cds.reboot || 0) > 0 || rebootCost > this.me.coins || !assault ? 'disabled' : ''}>🔁 Reboot ${rebootCost}💰</button>` : ''}
        ${!t.disabled && combat ? `<button class="btn small" data-over ${(this.me.cds.overcharge || 0) > 0 || ABILITIES.overcharge.cost > this.me.coins || !assault ? 'disabled' : ''}>⏫ Overcharge</button>` : ''}
      </div>`;
    const p = $('tower-panel');
    p.querySelector('[data-close]').onclick = () => this.selectTower(0);
    p.querySelectorAll('[data-mode]').forEach((el) => el.onclick = () => this.ctx.net.send({ t: 'mode', id: t.id, mode: el.dataset.mode }));
    p.querySelector('[data-up]')?.addEventListener('click', () => this.ctx.net.send({ t: 'upgrade', id: t.id }));
    p.querySelector('[data-sell]')?.addEventListener('click', () => { this.ctx.net.send({ t: 'sell', id: t.id }); this.selectTower(0); });
    p.querySelector('[data-reboot]')?.addEventListener('click', () => this.ctx.net.send({ t: 'ability', a: 'reboot', id: t.id }));
    p.querySelector('[data-over]')?.addEventListener('click', () => this.ctx.net.send({ t: 'ability', a: 'overcharge', id: t.id }));
  }

  // ------------------------------------------------------------------ questions
  answer(i) {
    if (!this.q || this.qState !== 'active' || i >= this.q.options.length) return;
    this.ctx.net.send({ t: 'answer', id: this.q.id, choice: i });
    this.qState = 'sent'; this.q.chosen = i;
    this.renderQuestion();
  }
  renderQuestion() {
    const card = $('question-card');
    const q = this.q;
    const streak = this.me.streak ? `<span class="streak">🔥 ${this.me.streak} streak</span>` : '<span></span>';
    if (this.qState === 'lock') {
      card.innerHTML = `<div class="qc-head"><span>Quiz</span></div><div class="qc-lock">✘ Locked out <span id="qc-lock-n">${Math.ceil(this.me.lock || 0)}</span>s</div>${this.qResult ? this.resultHtml() : ''}`;
      return;
    }
    if (!q || this.qState === 'wait') { card.innerHTML = `<div class="qc-head"><span>Quiz</span>${streak}</div><div class="qc-text muted">Next question incoming…</div>${this.qResult ? this.resultHtml() : ''}`; return; }
    const opts = q.options.map((o, i) => {
      let cls = '';
      if (this.qState === 'result' && this.qResult) { if (i === this.qResult.answer) cls = 'correct'; else if (i === this.qResult.chosen) cls = 'wrong'; }
      else if (this.qState === 'sent' && i === q.chosen) cls = 'active';
      return `<button class="btn qc-opt ${cls}" data-o="${i}"><b>${i + 1}</b>${esc(o)}</button>`;
    }).join('');
    card.innerHTML = `<div class="qc-head"><span>#${q.num} · ${esc(q.category)}</span><span class="qc-diff ${q.difficulty}">${q.difficulty}</span></div>
      <div class="qc-text">${esc(q.text)}</div><div class="qc-opts">${opts}</div>
      <div class="bar qc-timer"><div class="fill" id="qc-fill"></div></div>
      <div class="qc-foot">${streak}<span>×${this.me.factor ?? 1} rewards</span></div>${this.qState === 'result' ? this.resultHtml() : ''}`;
    card.querySelectorAll('[data-o]').forEach((el) => el.onclick = () => this.answer(Number(el.dataset.o)));
  }
  resultHtml() {
    const r = this.qResult;
    if (!r) return '';
    if (r.correct) return `<div class="qc-result good">✔ Correct! +${r.coins}💰 +${r.points}★</div>`;
    return `<div class="qc-result bad">${r.timeout ? '⏱ Time up!' : '✘ Wrong'}${r.answer >= 0 && this.q && this.q.options[r.answer] ? ` · Answer: ${esc(this.q.options[r.answer])}` : ''}</div>`;
  }

  // ------------------------------------------------------------------ server messages
  onMe(me) {
    const coinsBefore = this.me.coins;
    this.me = me;
    $('def-coins').textContent = me.coins;
    $('def-points').textContent = me.points;
    $('def-mult').textContent = `rewards ×${me.factor}`;
    if (me.coins !== coinsBefore) this.refreshPalette();
    $('abilities').querySelectorAll('[data-a]').forEach((el) => {
      const cd = me.cds[el.dataset.a] || 0;
      const c = el.querySelector('.cd');
      c.classList.toggle('hidden', cd <= 0);
      c.textContent = Math.ceil(cd);
      const a = ABILITIES[el.dataset.a];
      el.style.opacity = (a.cost || 0) > me.coins || this.ctx.phase() !== 'assault' ? 0.55 : 1;
    });
    if (this.qState === 'lock') { const n = $('qc-lock-n'); if (n) n.textContent = Math.ceil(me.lock || 0); if (!me.lock) { this.qState = 'wait'; this.renderQuestion(); } }
  }
  onPrivate(e) {
    const ui = this.ctx.ui, sfx = this.ctx.sfx;
    if (e.k === 'q') {
      this.q = { id: e.id, text: e.text, options: e.options, category: e.category, difficulty: e.difficulty, time: e.time, left: e.left ?? e.time, num: e.num, at: performance.now() };
      this.qState = 'active'; this.qResult = null;
      this.renderQuestion();
      sfx.play('click');
    } else if (e.k === 'qr') {
      this.qResult = e;
      if (this.q && this.q.id === e.id) { this.q.chosen = e.chosen; }
      this.qState = 'result';
      this.renderQuestion();
      sfx.play(e.correct ? 'correct' : 'wrong');
      if (e.correct) { this.ctx.fx.float(`+${e.coins}💰`, this.iso.target.clone().setY(8), 'coin', 1.2); }
      clearTimeout(this.qT);
      this.qT = setTimeout(() => { if (this.qState === 'result') { this.qState = e.lock > 0 ? 'lock' : 'wait'; this.renderQuestion(); } }, e.correct ? 1200 : 1700);
    } else if (e.k === 'err') { ui.toast(e.msg, 'error'); sfx.play('error'); }
    else if (e.k === 'coin') { this.ctx.fx.float(`+${e.n}`, { x: e.x, y: 4, z: e.z }, 'coin', 1.0); }
  }
  update(dt) {
    this.iso.update(dt);
    this.updateGhost();
    // hover highlight
    const tile = !this.sel && this.mouse ? this.hoverTile() : null;
    const ht = tile ? this.ctx.ents.towerAtTile(tile.tx, tile.tz) : null;
    this.ctx.ents.hoverTower = ht ? ht.id : 0;
    if (this.q && this.qState === 'active') {
      const left = Math.max(0, this.q.left - (performance.now() - this.q.at) / 1000);
      const f = $('qc-fill'); if (f) f.style.width = `${(left / this.q.time) * 100}%`;
    }
    this.panelT -= dt;
    if (this.panelT <= 0 && this.selectedTower) { this.panelT = 0.25; if (!document.querySelector('#tower-panel:hover')) this.renderTowerPanel(); }
  }
}
