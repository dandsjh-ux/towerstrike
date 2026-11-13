// Striker: first-person controller, weapons, gear, shop and HUD.
import * as THREE from 'three';
import { WEAPONS, WEAPON_IDS, EQUIPMENT, EQUIP_IDS, SHIELDS, SHIELD_IDS, TROOPS, TROOP_IDS, TROOP_BUY_LIMIT, PLAYER, TOWERS, TILE, towerBox, falloff } from '/shared/defs.js';
import { slideMove, T } from '/shared/maps.js';
import { escapeHtml as esc } from '/shared/util.js';
import { buildViewWeapon, playerColor } from './voxel.js';
import { $ } from './ui.js';
import { StrikerTouch } from './touch.js';

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

export class StrikerMode {
  constructor(ctx) {
    this.ctx = ctx;
    const { world, ents } = ctx;
    ents.role = 'striker'; ents.fps = true;
    this.map = world.map;
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 1200);
    this.baseFov = 75;
    this.vmScene = new THREE.Scene();
    this.vmScene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 2.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(1, 2, 1); this.vmScene.add(dl);
    this.vmCam = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 10);
    this.pos = v3(this.map.spawn.x, 0, this.map.spawn.z);
    this.vel = v3(0, 0, 0);
    this.yaw = 0; this.pitch = 0; this.recoil = 0;
    this.onGround = true;
    this.keys = new Set(); this.mouseDown = false; this.rmb = false;
    this.me = { coins: 0, owned: ['pistol'], weapon: 'pistol', mag: { pistol: 12 }, equip: {}, shield: 'none', shields: ['none'], troops: {}, alive: true };
    this.weapon = 'pistol';
    this.mag = { pistol: WEAPONS.pistol.mag };
    this.reloadUntil = 0; this.reloadStart = 0; this.lastShot = -9; this.spin = 0;
    this.vm = null; this.vmId = null; this.bob = 0; this.kick = 0;
    this.sendT = 0; this.stepT = 0;
    this.sens = Number(localStorage.getItem('ts_sens') || 0.0022);
    this.shopOpen = false; this.shopTab = 'w';
    this.nade = 'frag'; // selected grenade (G throws it, T cycles)
    this.myState = null;
    this.dead = false;
    this.alive = true;
    $('str-hud').classList.remove('hidden');
    $('hud-hint').textContent = '';
    this.minimap = $('minimap').getContext('2d');
    this.buildMinimapBase();
    this.setWeapon('pistol', true);
    this.renderEquip();
    // input
    const canvas = world.renderer.domElement;
    this.onLockClick = () => { if (!this.shopOpen && !ctx.ui.chatOpen) canvas.requestPointerLock?.(); };
    $('click-to-play').onclick = this.onLockClick;
    canvas.addEventListener('click', this.onLockClick);
    this.onMouseMove = (e) => {
      if (document.pointerLockElement !== canvas) return;
      const s = this.sens * (this.scoped() ? 0.35 : this.rmb ? 0.7 : 1);
      this.yaw -= e.movementX * s;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * s, -1.5, 1.5);
    };
    this.onMouseDown = (e) => {
      if (document.pointerLockElement !== canvas) return;
      if (e.button === 0) { this.mouseDown = true; this.clicked = true; }
      if (e.button === 2) this.rmb = true;
    };
    this.onMouseUp = (e) => { if (e.button === 0) this.mouseDown = false; if (e.button === 2) this.rmb = false; };
    this.onKeyDown = (e) => this.keyDown(e);
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onWheel = (e) => { if (document.pointerLockElement === canvas) this.cycleWeapon(e.deltaY > 0 ? 1 : -1); };
    this.onLockChange = () => this.updateLockUi();
    this.ctxMenu = (e) => e.preventDefault();
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('contextmenu', this.ctxMenu);
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.touch = ctx.touch ? new StrikerTouch(this) : null;
    if (this.touch) canvas.removeEventListener('click', this.onLockClick);
    this.updateLockUi();
  }
  dispose() {
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.ctxMenu);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.touch?.dispose();
    this.ctx.world.renderer.domElement.removeEventListener('click', this.onLockClick);
    document.exitPointerLock?.();
    this.ctx.ents.fps = false;
    $('str-hud').classList.add('hidden');
    $('shop').classList.add('hidden');
  }
  get s() { return this.ctx.settings(); }
  // Touch devices have no pointer lock: on-screen controls are always "live".
  locked() { return !!this.touch || document.pointerLockElement === this.ctx.world.renderer.domElement; }
  updateLockUi() {
    $('click-to-play').classList.toggle('hidden', this.locked() || this.shopOpen || this.ctx.ui.chatOpen || this.ctx.ui.screen !== 'game');
  }
  scoped() { return this.rmb && WEAPONS[this.weapon].scope && this.alive; }

  // ------------------------------------------------------------------ input
  keyDown(e) {
    if (e.target.tagName === 'INPUT') return;
    this.keys.add(e.code);
    const k = e.code;
    if (k === 'KeyB') { this.toggleShop(); e.preventDefault(); return; }
    if (k === 'KeyR') this.reload();
    if (k === 'Digit1') { const prim = this.me.primary && this.me.owned.includes(this.me.primary) ? this.me.primary : this.me.owned.find((w) => WEAPONS[w].slot === 1); if (prim) this.switchTo(prim); }
    if (k === 'Digit2') this.switchTo('pistol');
    if (k === 'KeyG') this.throwGrenade();
    if (k === 'KeyT') this.cycleGrenade();
    const eqKey = EQUIP_IDS.find((id) => `Digit${EQUIPMENT[id].key}` === k);
    if (eqKey) this.useEquip(eqKey);
    if (k === 'Space') e.preventDefault();
    if (k === 'Escape' && this.shopOpen) this.toggleShop(false);
  }
  switchTo(w) {
    if (!this.me.owned.includes(w) || w === this.weapon) return;
    this.setWeapon(w);
    this.ctx.net.send({ t: 'switch', w });
  }
  cycleWeapon(dir) {
    const owned = WEAPON_IDS.filter((w) => this.me.owned.includes(w));
    if (owned.length < 2) return;
    const i = owned.indexOf(this.weapon);
    this.switchTo(owned[(i + dir + owned.length) % owned.length]);
  }
  setWeapon(w, force = false) {
    if (!force && w === this.weapon && this.vm) return;
    this.weapon = w;
    this.reloadUntil = 0; this.spin = 0;
    if (this.mag[w] === undefined) this.mag[w] = this.me.mag?.[w] ?? WEAPONS[w].mag;
    if (this.vm) this.vmScene.remove(this.vm.group);
    this.vm = buildViewWeapon(w, playerColor(this.ctx.myId()));
    this.vm.group.position.set(0.24, -0.24, -0.5);
    this.vm.group.scale.setScalar(0.8);
    this.vmScene.add(this.vm.group);
    this.vmSwitch = 0.3;
    this.renderWeaponHud();
  }
  reload() {
    const w = WEAPONS[this.weapon];
    if (this.reloadUntil || this.mag[this.weapon] >= w.mag || !this.alive) return;
    this.reloadStart = performance.now() / 1000; this.reloadUntil = this.reloadStart + w.reload;
    this.ctx.net.send({ t: 'reload' });
    this.ctx.sfx.play('reload');
  }
  // Grenades: G throws the selected one, T (or the touch swap button) cycles frag -> EMP -> smoke.
  grenadeIds() { return EQUIP_IDS.filter((id) => EQUIPMENT[id].kind === 'throw' && !this.s.bannedEquipment.includes(id)); }
  selectedGrenade() {
    const ids = this.grenadeIds();
    if (!ids.length) return null;
    if (!ids.includes(this.nade)) this.nade = ids[0];
    if (!(this.me.equip?.[this.nade] > 0)) { const have = ids.find((id) => this.me.equip?.[id] > 0); if (have) this.nade = have; }
    return this.nade;
  }
  cycleGrenade() {
    const ids = this.grenadeIds();
    if (!ids.length) return;
    const cur = this.selectedGrenade();
    const order = ids.map((_, i) => ids[(ids.indexOf(cur) + 1 + i) % ids.length]);
    this.nade = order.find((id) => this.me.equip?.[id] > 0) || order[0];
    this.ctx.ui.centerMsg(`${EQUIPMENT[this.nade].icon} ${EQUIPMENT[this.nade].name} ready (${this.me.equip?.[this.nade] || 0})`, 900);
    this.renderEquip();
  }
  throwGrenade() {
    const id = this.selectedGrenade();
    if (!id) { this.ctx.ui.centerMsg('Grenades are disabled in this match'); return; }
    this.useEquip(id);
  }
  useEquip(id) {
    if (!this.alive) return;
    if (this.ctx.phase() !== 'assault') { this.ctx.ui.centerMsg('Gear is usable once the assault begins'); return; }
    if (!(this.me.equip[id] > 0)) { this.ctx.ui.centerMsg(`No ${EQUIPMENT[id].name} (buy in shop: B)`); this.ctx.sfx.play('dry'); return; }
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch + 0.12, this.yaw, 0, 'YXZ'));
    this.ctx.net.send({ t: 'equip', e: id, d: [dir.x, dir.y, dir.z] });
    this.me.equip[id]--;
    if (EQUIPMENT[id].kind === 'throw') this.nade = id;
    this.renderEquip();
    if (EQUIPMENT[id].kind === 'throw') { this.ctx.sfx.play('throw'); this.kick = 0.5; }
  }

  // ------------------------------------------------------------------ shooting
  tryFire(now) {
    const ui = this.ctx.ui;
    const w = WEAPONS[this.weapon];
    if (!this.alive || !this.locked() || this.shopOpen) return;
    const ph = this.ctx.phase();
    if (ph !== 'assault') { if (this.clicked) ui.centerMsg(ph === 'prep' ? 'Scouting: weapons go hot when the assault begins' : 'Hold fire'); return; }
    if (this.reloadUntil) return;
    if (w.spinup) { this.spin = Math.min(w.spinup, this.spin + 1 / 60); if (this.spin < w.spinup) return; }
    const stim = this.myFlags() & 8 ? EQUIPMENT.stim.rateMult : 1;
    if (now - this.lastShot < 1 / (w.rate * stim)) return;
    if (!w.auto && !this.clicked && !this.touch) return; // on touch, holding fire repeats semi-autos at their rate
    if ((this.mag[this.weapon] || 0) <= 0) { this.ctx.sfx.play('dry'); this.reload(); return; }
    this.clicked = false;
    if (this.touch) this.aimAssist();
    this.lastShot = now;
    this.mag[this.weapon]--;
    const cam = this.camera;
    const origin = cam.position.clone();
    const moving = Math.hypot(this.vel.x, this.vel.z) > 1;
    let spread = w.spread || 0;
    if (w.scope) spread = this.scoped() ? 0 : w.hipSpread;
    else spread *= (this.rmb ? 0.55 : 1) * (moving ? 1.35 : 1) * (this.onGround ? 1 : 2);
    const dirs = [];
    const n = w.pellets || 1;
    for (let i = 0; i < n; i++) {
      const e = new THREE.Euler(this.pitch + this.recoil + (Math.random() - 0.5) * 2 * spread, this.yaw + (Math.random() - 0.5) * 2 * spread, 0, 'YXZ');
      dirs.push(new THREE.Vector3(0, 0, -1).applyEuler(e));
    }
    this.ctx.net.send({ t: 'fire', w: this.weapon, o: [origin.x, origin.y, origin.z], d: n > 1 ? dirs.map((d) => [d.x, d.y, d.z]) : [dirs[0].x, dirs[0].y, dirs[0].z] });
    // local visuals
    const muzzle = this.muzzleWorld();
    if (w.kind === 'hitscan') {
      for (const d of dirs) {
        const hit = this.localTrace(origin, d, w.range);
        this.ctx.fx.tracer(muzzle, hit.p, this.weapon === 'railgun' ? 0x6fd3ff : 0xfff0a0, 0.05);
        this.ctx.fx.impact(hit.p, hit.target ? 0xffd080 : 0xc8b090, this.weapon === 'sniper' || this.weapon === 'railgun');
        if (this.weapon === 'railgun') this.ctx.fx.beam(muzzle, hit.p, 0x6fd3ff, 0.1, 0.25);
        if (hit.target === 'base' && !this.inShieldRange()) this.ctx.world.flashDome();
      }
    }
    this.ctx.fx.muzzle(muzzle, this.weapon === 'plasma' ? 0xc070ff : 0xffd070);
    this.ctx.sfx.play(this.weapon);
    this.recoil += w.recoil * (this.rmb ? 0.6 : 1);
    this.kick = Math.min(1, this.kick + w.recoil * 6 + 0.15);
    this.renderWeaponHud();
    if (this.mag[this.weapon] <= 0) this.reload();
  }
  // Gentle aim assist for thumbs: nudge toward a tower (or the core) that's already almost under the crosshair.
  aimAssist() {
    const eye = this.camera.position;
    let best = null, bestA = 0.075;
    const consider = (x, y, z) => {
      const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z, hd = Math.hypot(dx, dz);
      if (hd > 90) return;
      let dyaw = Math.atan2(-dx, -dz) - this.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2; while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const dp = Math.atan2(dy, hd) - this.pitch;
      const a = Math.hypot(dyaw, dp);
      if (a < bestA) { bestA = a; best = { dyaw, dp }; }
    };
    for (const t of this.ctx.ents.towers.values()) if (!t.disabled && t.obj.visible) consider(t.x, t.y + t.def.h * 0.5, t.z);
    if (this.inShieldRange()) consider(this.map.base.x, 4, this.map.base.z);
    if (best) { this.yaw += best.dyaw * 0.55; this.pitch += best.dp * 0.55; }
  }
  inShieldRange() {
    const m = this.map;
    if (m.inPlaza(this.pos.x, this.pos.z)) return true;
    const b = m.base.box;
    const dx = Math.max(b.x0 - this.pos.x, 0, this.pos.x - b.x1), dz = Math.max(b.z0 - this.pos.z, 0, this.pos.z - b.z1);
    return Math.hypot(dx, dz) <= 14;
  }
  muzzleWorld() {
    const c = this.camera;
    return c.position.clone().add(new THREE.Vector3(0.22, -0.2, -0.9).applyQuaternion(c.quaternion));
  }
  localTrace(o, d, range) {
    let best = { t: range, target: null };
    for (const t of this.ctx.ents.towers.values()) {
      const b = towerBox({ type: t.type, x: t.x, z: t.z });
      const tt = rayBox(o, d, b);
      if (tt >= 0 && tt < best.t) best = { t: tt, target: 'tower', tower: t };
    }
    const bt = rayBox(o, d, this.map.base.box);
    if (bt >= 0 && bt < best.t) best = { t: bt, target: 'base' };
    if (d.y < -1e-4) { const tg = -o.y / d.y; if (tg < best.t) best = { t: tg, target: null }; }
    best.p = o.clone().addScaledVector(d, best.t);
    return best;
  }

  // ------------------------------------------------------------------ movement
  blockedTiles() {
    const set = new Set();
    for (const t of this.ctx.ents.towers.values()) if (t.type === 'barricade' && !t.disabled) set.add(this.map.idx(t.tx, t.tz));
    return set;
  }
  myFlags() { return this.myState ? this.myState[9] : 1; }
  move(dt) {
    const k = this.keys;
    const paused = this.ctx.paused();
    const input = !paused && this.alive && this.locked() && !this.ctx.ui.chatOpen && !this.shopOpen;
    const tm = this.touch && this.touch.move.active ? this.touch.move : null;
    const fwd = tm ? (input ? -tm.y : 0) : (input && (k.has('KeyW') || k.has('ArrowUp')) ? 1 : 0) - (input && (k.has('KeyS') || k.has('ArrowDown')) ? 1 : 0);
    const str = tm ? (input ? tm.x : 0) : (input && (k.has('KeyD') || k.has('ArrowRight')) ? 1 : 0) - (input && (k.has('KeyA') || k.has('ArrowLeft')) ? 1 : 0);
    const w = WEAPONS[this.weapon];
    let speed = PLAYER.speed * (SHIELDS[this.me.shield]?.speedMult || 1);
    const sprint = input && (k.has('ShiftLeft') || (this.touch && this.touch.sprint)) && fwd > 0.4 && !this.mouseDown && !this.rmb;
    if (sprint) speed *= PLAYER.sprintMult;
    if (w.moveMult && (this.mouseDown || this.spin > 0)) speed *= w.moveMult;
    if (this.rmb) speed *= 0.65;
    const f = this.myFlags();
    if (f & 8) speed *= EQUIPMENT.stim.speedMult;
    if (f & 32 && this.myState) speed *= this.myState[12] || 1;
    const wish = new THREE.Vector3(str, 0, -fwd);
    if (wish.lengthSq() > 1) wish.normalize(); // analog stick keeps partial speeds; keyboard diagonals are capped
    if (wish.lengthSq() > 0) wish.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const accel = this.onGround ? 60 : 14;
    const target = wish.multiplyScalar(speed);
    const dvx = target.x - this.vel.x, dvz = target.z - this.vel.z;
    const dl = Math.hypot(dvx, dvz);
    if (dl > 0) { const a = Math.min(dl, accel * dt); this.vel.x += (dvx / dl) * a; this.vel.z += (dvz / dl) * a; }
    if (input && (k.has('Space') || (this.touch && this.touch.jump)) && this.onGround) { this.vel.y = PLAYER.jump; this.onGround = false; this.ctx.sfx.play('jump'); }
    this.vel.y -= PLAYER.gravity * dt;
    const np = slideMove(this.map, this.pos.x, this.pos.z, this.vel.x * dt, this.vel.z * dt, PLAYER.radius, this.blockedTiles());
    if (Math.abs(np.x - (this.pos.x + this.vel.x * dt)) > 1e-4) this.vel.x = 0;
    if (Math.abs(np.z - (this.pos.z + this.vel.z * dt)) > 1e-4) this.vel.z = 0;
    this.pos.x = np.x; this.pos.z = np.z;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) { if (!this.onGround && this.vel.y < -6) this.ctx.sfx.play('step'); this.pos.y = 0; this.vel.y = 0; this.onGround = true; }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 1) {
      this.bob += dt * hs * 1.3;
      this.stepT -= dt * hs;
      if (this.stepT <= 0) { this.stepT = sprint ? 3.2 : 2.6; this.ctx.sfx.play('step'); }
    }
  }

  // ------------------------------------------------------------------ server messages
  onMe(me) {
    const prevOwned = this.me.owned ? this.me.owned.length : 0;
    this.me = me;
    if (me.weapon !== this.weapon && me.owned.includes(me.weapon) && performance.now() / 1000 - this.lastShot > 0.5) this.setWeapon(me.weapon);
    for (const w of me.owned) if (this.mag[w] === undefined) this.mag[w] = me.mag[w];
    const now = performance.now() / 1000;
    if (!this.reloadUntil && now - this.lastShot > 0.6) for (const w of me.owned) this.mag[w] = me.mag[w];
    if (me.owned.length !== prevOwned && this.shopOpen) this.renderShop();
    $('str-coins').textContent = me.coins;
    $('str-points').textContent = me.points;
    $('str-shop-hint').textContent = me.shop ? '🛒 Shop open: press B' : '';
    this.renderEquip();
    if (this.shopOpen) this.refreshShopAffordability();
    this.alive = me.alive;
    $('respawn').classList.toggle('hidden', me.alive);
    if (!me.alive) $('respawn').innerHTML = `ELIMINATED<small>Respawning in ${Math.ceil(me.respawn)}s ${this.respawnNote || ''}</small>`;
  }
  onPrivate(e) {
    const ui = this.ctx.ui, sfx = this.ctx.sfx, fx = this.ctx.fx;
    switch (e.k) {
      case 'tp':
        if (e.soft && this.pos.distanceTo(v3(e.x, e.y, e.z)) < 1.2) break;
        this.pos.set(e.x, e.y || 0, e.z); this.vel.set(0, 0, 0);
        if (e.yaw !== undefined && !e.soft) { this.yaw = e.yaw; this.pitch = 0; }
        break;
      case 'hm': {
        const el = $('hitmarker');
        el.classList.remove('show', 'kill'); void el.offsetWidth;
        el.classList.add('show'); if (e.dis) el.classList.add('kill');
        sfx.play('hit');
        if (e.dis) { ui.centerMsg('TOWER DISABLED', 1200); }
        break;
      }
      case 'hurt': {
        const ang = Math.atan2(e.x - this.pos.x, e.z - this.pos.z);
        const rel = ang - Math.atan2(-Math.sin(this.yaw), -Math.cos(this.yaw));
        const i = document.createElement('i');
        i.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
        $('dmg-dir').appendChild(i);
        setTimeout(() => i.remove(), 900);
        fx.shake(Math.min(0.3, e.d / 60));
        break;
      }
      case 'dead': this.respawnNote = `(killed by ${e.by})`; sfx.play('death'); break;
      case 'buy':
        if (e.ok) { sfx.play('buy'); if (e.item.startsWith('w:')) { const w = e.item.slice(2); this.mag[w] = WEAPONS[w].mag; this.setWeapon(w); } }
        else { ui.toast(e.msg || 'Cannot buy that.', 'error'); sfx.play('error'); }
        break;
      case 'shielded': ui.centerMsg('🛡 Core shield: get inside the plaza to damage the core', 1600); this.ctx.world.flashDome(); sfx.play('shielded'); break;
      default: break;
    }
  }
  onSnapshot(s) {
    this.myState = s.a.find((a) => a[0] === this.ctx.myId()) || null;
    if (this.myState) {
      const [, , , , , , hp, shield, cap, flags, , maxHp] = this.myState;
      $('str-hp').style.width = `${(hp / (maxHp || 100)) * 100}%`;
      $('str-hp').classList.toggle('low', hp / (maxHp || 100) < 0.35);
      $('str-hp-num').textContent = hp;
      $('str-shield').style.width = cap ? `${(shield / cap) * 100}%` : '0%';
      $('str-shield-num').textContent = cap ? shield : '–';
      const st = [];
      if (flags & 2) st.push('<span>👁 Scouting</span>');
      if (flags & 64) st.push('<span>🛡 Spawn protection</span>');
      if (flags & 4) st.push('<span>👻 Cloaked</span>');
      if (flags & 8) st.push('<span>💉 Stim</span>');
      if (flags & 16) st.push('<span>🔥 Burning</span>');
      if (flags & 32) st.push('<span>❄ Slowed</span>');
      $('str-status').innerHTML = st.join('');
      if (this.lastHp !== undefined && hp < this.lastHp) this.ctx.fx.shake(0.05);
      this.lastHp = hp;
    }
    this.objective(s);
  }
  objective(s) {
    let text;
    const ph = s.ph;
    if (ph === 'prep') text = this.s.allowScouting ? '👁 Scout the route & shop (B). Towers are offline.' : '🛒 Shop (B) and plan: the gate opens soon.';
    else if (ph === 'assault') {
      const next = (s.c || []).findIndex((c) => !c[0]);
      if (s.b[3]) text = '🔒 Core locked down: disable towers & survive for next round';
      else if (this.inShieldRange()) text = '💥 Attack the core!';
      else if (next >= 0 && this.s.checkpoints) text = `⚔ Clear towers · capture checkpoint ${next + 1}${s.c[next][2] ? ' (towers nearby)' : ''} · reach the core`;
      else text = '⚔ Push to the core plaza';
    } else if (ph === 'intermission') text = 'Round over: regroup';
    else text = '';
    $('objective').textContent = text;
  }

  // ------------------------------------------------------------------ HUD
  renderWeaponHud() {
    const w = WEAPONS[this.weapon];
    $('str-wname').textContent = w.name;
    $('str-mag').textContent = this.mag[this.weapon] ?? 0;
    $('str-magmax').textContent = w.mag;
    const prim = this.me.owned.filter((x) => WEAPONS[x].slot === 1);
    $('str-slots').innerHTML = `<span class="${WEAPONS[this.weapon].slot === 1 ? 'on' : ''}">1 ${prim.length ? WEAPONS[this.me.primary || prim[0]]?.name || '' : '—'}</span><span class="${this.weapon === 'pistol' ? 'on' : ''}">2 Sidearm</span>`;
    $('scope').classList.toggle('hidden', !this.scoped());
    $('crosshair').classList.toggle('hidden', this.scoped());
  }
  renderEquip() {
    const banned = new Set(this.s.bannedEquipment);
    const sel = this.selectedGrenade();
    this.touch?.syncNade();
    $('equip-bar').innerHTML = EQUIP_IDS.filter((id) => !banned.has(id)).map((id) => {
      const n = this.me.equip?.[id] || 0;
      return `<div class="eq ${n ? '' : 'empty'} ${id === sel ? 'sel' : ''}" data-e="${id}" title="${EQUIPMENT[id].name}"><span class="k">${EQUIPMENT[id].key}</span>${EQUIPMENT[id].icon}<span class="n">${n}</span></div>`;
    }).join('');
  }
  toggleShop(force) {
    const open = force ?? !this.shopOpen;
    if (open && !this.me.shop) { this.ctx.ui.centerMsg('Shop: in prep, in spawn, or at a captured checkpoint', 1600); this.ctx.sfx.play('error'); return; }
    this.shopOpen = open;
    $('shop').classList.toggle('hidden', !open);
    if (open) { document.exitPointerLock?.(); this.renderShop(); }
    this.updateLockUi();
  }
  renderShop() {
    const me = this.me, s = this.s;
    const tabs = [['w', 'Weapons'], ['s', 'Shields'], ['e', 'Gear'], ['t', 'Support troops']];
    let items = '';
    if (this.shopTab === 'w') items = WEAPON_IDS.filter((id) => id !== 'pistol' && !s.bannedWeapons.includes(id)).map((id) => {
      const w = WEAPONS[id]; const owned = me.owned.includes(id);
      const dps = Math.round(w.dmg * (w.pellets || 1) * w.rate + (w.splashDmg || 0) * w.rate * 0.5);
      return this.itemHtml(`w:${id}`, w.name, w.cost, w.desc, `~${dps} DPS · ${w.mag} mag · ${w.kind === 'proj' ? 'projectile' : w.fall ? `full dmg to ${w.fall[0]}m` : 'no falloff'} · tower ×${w.towerMult} · core ×${w.baseMult}`, owned, owned ? (this.weapon === id ? 'Equipped' : 'Equip') : 'Buy', this.weapon === id);
    }).join('');
    if (this.shopTab === 's') items = SHIELD_IDS.filter((id) => id !== 'none').map((id) => {
      const sh = SHIELDS[id]; const owned = me.shields.includes(id);
      return this.itemHtml(`s:${id}`, sh.name, sh.cost, sh.desc, `${sh.cap} shield · regen ${sh.regen}/s after ${sh.delay}s`, owned, owned ? (me.shield === id ? 'Equipped' : 'Equip') : 'Buy', me.shield === id);
    }).join('');
    if (this.shopTab === 'e') items = EQUIP_IDS.filter((id) => !s.bannedEquipment.includes(id)).map((id) => {
      const e = EQUIPMENT[id]; const n = me.equip[id] || 0;
      return this.itemHtml(`e:${id}`, `${e.icon} ${e.name}`, e.cost, e.desc, `Key ${e.key} · carrying ${n}/${e.max}`, false, n >= e.max ? 'Full' : 'Buy', false, n >= e.max);
    }).join('');
    if (this.shopTab === 't') items = TROOP_IDS.filter((id) => !s.bannedTroops.includes(id)).map((id) => {
      const t = TROOPS[id]; const n = me.troops[id] || 0;
      return this.itemHtml(`t:${id}`, `${t.icon} ${t.name}`, t.cost, t.desc, `${t.count > 1 ? `${t.count} units · ` : ''}${Math.round(t.hp * (me.buff?.hp || 1))} HP · ${n}/${TROOP_BUY_LIMIT} this round · ${this.ctx.phase() === 'assault' ? 'deploys now' : 'marches at assault start'}`, false, n >= TROOP_BUY_LIMIT ? 'Limit' : 'Buy', false, n >= TROOP_BUY_LIMIT);
    }).join('');
    $('shop').innerHTML = `<div class="shop-head"><h2>Armory</h2><div class="row gap"><span class="coins" style="color:var(--gold);font-weight:700;font-size:1.2em">💰 ${me.coins}</span>
      <label class="small muted">Sensitivity <input type="range" min="0.0006" max="0.006" step="0.0002" value="${this.sens}" id="sens"></label>
      <button class="btn small" id="shop-close">Close (B)</button></div></div>
      <div class="shop-tabs">${tabs.map(([k, l]) => `<button class="btn small ${this.shopTab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="shop-grid">${items}</div>
      <p class="muted small">Weapons & shields are yours for the whole match. Gear and troops are per round. Rewards ×${me.factor} (scaled by squad size).${me.buff && me.buff.hp > 1 ? ` Round buff: strikers and troops have +${Math.round((me.buff.hp - 1) * 100)}% HP and +${Math.round((me.buff.dmg - 1) * 100)}% damage.` : ''}</p>`;
    const sh = $('shop');
    sh.querySelectorAll('[data-tab]').forEach((el) => el.onclick = () => { this.shopTab = el.dataset.tab; this.renderShop(); });
    sh.querySelectorAll('[data-buy]').forEach((el) => el.onclick = () => {
      const item = el.dataset.buy;
      if (item.startsWith('w:') && me.owned.includes(item.slice(2))) { this.switchTo(item.slice(2)); this.ctx.net.send({ t: 'buy', item }); setTimeout(() => this.renderShop(), 100); return; }
      this.ctx.net.send({ t: 'buy', item });
    });
    $('shop-close').onclick = () => this.toggleShop(false);
    $('sens').oninput = (e) => { this.sens = Number(e.target.value); localStorage.setItem('ts_sens', String(this.sens)); };
  }
  itemHtml(item, name, cost, desc, stats, owned, label, equipped, disabled = false) {
    return `<div class="sitem ${owned ? 'owned' : ''} ${equipped ? 'equipped' : ''}" data-cost="${owned ? 0 : cost}"><div class="top"><span>${esc(name)}</span><span class="cost">${owned ? '✔' : cost}</span></div><div class="ds">${esc(desc)}</div><div class="st">${esc(stats)}</div><button class="btn small ${owned ? '' : 'primary'}" data-buy="${item}" ${disabled || equipped ? 'disabled' : ''}>${label}</button></div>`;
  }
  refreshShopAffordability() {
    $('shop').querySelectorAll('.sitem').forEach((el) => { const c = Number(el.dataset.cost); const b = el.querySelector('button'); if (c > this.me.coins && !b.disabled) b.classList.add('poor'); el.style.opacity = c > this.me.coins ? 0.55 : 1; });
    const c = $('shop').querySelector('.coins'); if (c) c.textContent = `💰 ${this.me.coins}`;
  }

  // ------------------------------------------------------------------ minimap
  buildMinimapBase() {
    const map = this.map, W = map.w, H = map.h;
    const c = document.createElement('canvas');
    const scale = Math.floor(200 / Math.max(W, H));
    c.width = W * scale; c.height = H * scale;
    const x = c.getContext('2d');
    for (let tz = 0; tz < H; tz++) for (let tx = 0; tx < W; tx++) {
      const i = tz * W + tx, t = map.tiles[i];
      x.fillStyle = t === T.PATH ? '#c9a873' : t === T.SPAWN ? '#7d93ab' : t === T.PLAZA ? '#bcb6a6' : t === T.BASE ? '#3d8fe0' : t === T.WATER ? '#4aa3d8' : map.buildable[i] ? '#5fae42' : '#3f7f2f';
      x.fillRect(tx * scale, tz * scale, scale, scale);
    }
    this.mmBase = c; this.mmScale = scale;
  }
  drawMinimap() {
    const ctx = this.minimap, s = this.mmScale / TILE;
    const cw = 220;
    ctx.clearRect(0, 0, cw, cw);
    const ox = (cw - this.mmBase.width) / 2, oy = (cw - this.mmBase.height) / 2;
    ctx.globalAlpha = 0.9; ctx.drawImage(this.mmBase, ox, oy); ctx.globalAlpha = 1;
    const ents = this.ctx.ents;
    for (const t of ents.towers.values()) {
      if (t.type === 'mine' && !ents.scout) continue;
      ctx.fillStyle = t.disabled ? '#555' : '#ff4040';
      const r = TOWERS[t.type].place === 'path' ? 2 : 3;
      ctx.fillRect(ox + t.x * s - r, oy + t.z * s - r, r * 2, r * 2);
    }
    (this.map.checkpoints || []).forEach((c, i) => {
      if (!this.s.checkpoints) return;
      const st = ents.cps[i];
      ctx.strokeStyle = st && st[0] ? '#ff8a3d' : '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ox + c.x * s, oy + c.z * s, 5, 0, Math.PI * 2); ctx.stroke();
    });
    for (const r of ents.troops.values()) { ctx.fillStyle = '#ffd34d'; ctx.fillRect(ox + r.pos.x * s - 1.5, oy + r.pos.z * s - 1.5, 3, 3); }
    for (const a of ents.strikers.values()) {
      if (a.id === this.ctx.myId() || !(a.flags & 1)) continue;
      ctx.fillStyle = '#' + playerColor(a.id).toString(16).padStart(6, '0');
      ctx.beginPath(); ctx.arc(ox + a.pos.x * s, oy + a.pos.z * s, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // me
    const px = ox + this.pos.x * s, pz = oy + this.pos.z * s;
    ctx.save(); ctx.translate(px, pz); ctx.rotate(-this.yaw);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const now = performance.now() / 1000;
    if (this.reloadUntil && now >= this.reloadUntil) { this.mag[this.weapon] = WEAPONS[this.weapon].mag; this.reloadUntil = 0; this.renderWeaponHud(); }
    this.move(dt);
    if (this.mouseDown || this.clicked) this.tryFire(now); else this.spin = Math.max(0, this.spin - dt);
    this.clicked = false;
    this.recoil = Math.max(0, this.recoil - dt * 0.35 - this.recoil * dt * 6);
    // camera
    const cam = this.camera;
    const bobY = this.onGround ? Math.sin(this.bob * 2) * 0.05 : 0;
    const shake = this.ctx.fx.shakeAmt;
    cam.position.set(this.pos.x + (Math.random() - 0.5) * shake * 0.3, this.pos.y + PLAYER.eye + bobY + (this.alive ? 0 : -1.2), this.pos.z + (Math.random() - 0.5) * shake * 0.3);
    cam.rotation.set(this.pitch + this.recoil, this.yaw, this.alive ? 0 : 0.4, 'YXZ');
    const fovT = this.scoped() ? 22 : this.rmb ? 62 : (this.keys.has('ShiftLeft') && Math.hypot(this.vel.x, this.vel.z) > 7.5 ? 82 : this.baseFov);
    cam.fov += (fovT - cam.fov) * Math.min(1, dt * 14);
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
    this.vmCam.aspect = cam.aspect; this.vmCam.updateProjectionMatrix();
    // viewmodel
    if (this.vm) {
      this.kick = Math.max(0, this.kick - dt * 7);
      this.vmSwitch = Math.max(0, (this.vmSwitch || 0) - dt);
      const reloading = this.reloadUntil > 0;
      const g = this.vm.group;
      const ads = this.rmb && !WEAPONS[this.weapon].scope;
      g.position.set(ads ? 0.0 : 0.24, (ads ? -0.15 : -0.24) + Math.sin(this.bob * 2) * 0.012 - (reloading ? 0.18 : 0) - this.vmSwitch, -0.5 + this.kick * 0.08);
      g.rotation.set(this.kick * 0.15 + (reloading ? -0.5 : 0), Math.sin(this.bob) * 0.015, reloading ? 0.3 : 0);
      g.visible = !this.scoped() && this.alive;
    }
    const rb = $('str-reload');
    rb.classList.toggle('on', this.reloadUntil > 0);
    if (this.reloadUntil) rb.firstElementChild.style.width = `${((now - this.reloadStart) / (this.reloadUntil - this.reloadStart)) * 100}%`;
    $('str-mag').textContent = this.mag[this.weapon] ?? 0;
    $('scope').classList.toggle('hidden', !this.scoped());
    $('crosshair').classList.toggle('hidden', this.scoped() || !this.alive);
    const spreadPx = 6 + ((WEAPONS[this.weapon].spread || 0) * (this.rmb ? 0.55 : 1) + Math.hypot(this.vel.x, this.vel.z) * 0.004 + this.recoil) * 500;
    const ch = $('crosshair').children;
    ch[0].style.top = `${-spreadPx - 8}px`; ch[1].style.top = `${spreadPx}px`; ch[2].style.left = `${-spreadPx - 8}px`; ch[3].style.left = `${spreadPx}px`;
    // network
    this.sendT -= dt;
    if (this.sendT <= 0 && !this.ctx.paused()) {
      this.sendT = 0.05;
      this.ctx.net.send({ t: 'st', x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2), yaw: +this.yaw.toFixed(3), pitch: +this.pitch.toFixed(3) });
    }
    this.ctx.ents.myPos = this.pos;
    this.drawMinimap();
    this.updateLockUi();
  }
  render(renderer, scene) {
    renderer.autoClear = true;
    renderer.render(scene, this.camera);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.vmScene, this.vmCam);
    renderer.autoClear = true;
  }
}

function rayBox(o, d, b) {
  let tmin = 0, tmax = Infinity;
  for (const [oa, da, a0, a1] of [[o.x, d.x, b.x0, b.x1], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z0, b.z1]]) {
    if (Math.abs(da) < 1e-9) { if (oa < a0 || oa > a1) return -1; continue; }
    let t1 = (a0 - oa) / da, t2 = (a1 - oa) / da;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}
