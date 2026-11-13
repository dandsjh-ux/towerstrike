// Visual mirror of the server state: towers, strikers, troops, projectiles, zones + event effects.
import * as THREE from 'three';
import { TOWERS, TOWER_IDS, TROOPS, TROOP_IDS, WEAPON_IDS, ZONE_TYPES, TARGET_MODES, EQUIPMENT, TILE } from '/shared/defs.js';
import { T } from '/shared/maps.js';
import { buildTower, buildSoldier, buildTroop, buildProjectile, playerColor, MAT, C, VB, meshOf } from './voxel.js';
import { PAD_Y } from './world.js';

const TOWER_SOUND = { sentry: 'sentry', sniper: 'snipertower', cannon: 'cannon', mortar: 'mortar', missile: 'missile' };
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const tmp = new THREE.Vector3();

function makeBar(w, h, color) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7, depthWrite: false }));
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, depthWrite: false }));
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(w, h * 0.45), new THREE.MeshBasicMaterial({ color: 0x6fd3ff, depthWrite: false }));
  fg.position.z = 0.01; sh.position.z = 0.02; sh.position.y = h * 0.62;
  g.add(bg, fg, sh);
  g.userData = { fg, sh, w };
  g.renderOrder = 5;
  return g;
}
function setBar(bar, frac, shieldFrac = 0) {
  const { fg, sh, w } = bar.userData;
  frac = Math.max(0, Math.min(1, frac));
  fg.scale.x = Math.max(0.001, frac); fg.position.x = -(w * (1 - frac)) / 2;
  fg.material.color.setHex(frac > 0.5 ? 0x5ee07a : frac > 0.25 ? 0xffd34d : 0xff5a5a);
  sh.visible = shieldFrac > 0;
  sh.scale.x = Math.max(0.001, shieldFrac); sh.position.x = -(w * (1 - shieldFrac)) / 2;
}
function nameSprite(text, color = '#ffffff') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = '600 30px "Chakra Petch", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,0.75)'; x.strokeText(text, 128, 32);
  x.fillStyle = color; x.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(3.2, 0.8, 1);
  s.renderOrder = 6;
  return s;
}
function setMat(group, mat) {
  group.traverse((o) => { if (o.isMesh && !o.userData.keep) { if (!o.userData.base) o.userData.base = o.material; o.material = mat === null ? o.userData.base : (o.userData.base === MAT.glow ? o.userData.base : mat); } });
}

export class Entities {
  constructor(world, fx, sfx) {
    this.world = world; this.fx = fx; this.sfx = sfx;
    this.root = new THREE.Group();
    world.scene.add(this.root);
    this.towers = new Map(); this.strikers = new Map(); this.troops = new Map(); this.projs = new Map(); this.zones = new Map();
    this.myId = 0; this.role = 'spectator'; this.fps = false;
    this.names = new Map();
    this.scout = 0; this.selectedTower = 0; this.hoverTower = 0;
    this.base = { hp: 1, max: 1, fort: 0, lock: 0 };
    this.cps = [];
    this.time = 0;
    this.rangeMat = new THREE.MeshBasicMaterial({ color: 0x7cc8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    this.rangeFill = new THREE.MeshBasicMaterial({ color: 0x7cc8ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
    this.pathDir = null;
  }
  reset() {
    for (const m of [this.towers, this.strikers, this.troops, this.projs, this.zones]) { for (const e of m.values()) this.root.remove(e.obj); m.clear(); }
    this.scout = 0; this.selectedTower = 0;
  }
  setPlayers(list) { this.names.clear(); for (const p of list) this.names.set(p.id, p.name); }
  nameOf(id) { return this.names.get(id) || `#${id}`; }

  // ------------------------------------------------------------------ snapshot
  apply(s) {
    this.base = { hp: s.b[0], max: s.b[1], fort: s.b[2], lock: s.b[3], roundDmg: s.b[4] || 0 };
    this.scout = s.sc || 0;
    this.phase = s.ph;
    this.world.setLockdown(!!s.b[3]);
    // towers
    const seenT = new Set();
    for (const w of s.w) {
      const [id, ti, tx, tz, level, hp, maxHp, shield, shieldMax, flags, yaw, target, modeIdx, rangeMult] = w;
      seenT.add(id);
      let t = this.towers.get(id);
      const type = TOWER_IDS[ti];
      if (!t || t.level !== level) { if (t) this.root.remove(t.obj); t = this.makeTower(id, type, tx, tz, level, t); this.towers.set(id, t); }
      Object.assign(t, { hp, maxHp, shield, shieldMax, flags, targetYaw: yaw, target, mode: TARGET_MODES[modeIdx], rangeMult });
      const dis = !!(flags & 1);
      if (dis !== t.disabled) { t.disabled = dis; setMat(t.model.group, dis ? MAT.dim : null); t.model.group.traverse((o) => { if (o.isMesh && o.userData.base === MAT.glow) o.visible = !dis; }); }
    }
    for (const [id, t] of this.towers) if (!seenT.has(id)) { this.root.remove(t.obj); this.towers.delete(id); }
    // strikers
    const seenA = new Set();
    for (const a of s.a) {
      const [id, x, y, z, yaw, pitch, hp, shield, shieldCap, flags, wi, maxHp, slow] = a;
      seenA.add(id);
      let e = this.strikers.get(id);
      if (!e) { e = this.makeStriker(id); this.strikers.set(id, e); e.pos.set(x, y, z); }
      const jump = e.tgt.distanceTo(tmp.set(x, y, z)) > 10;
      e.tgt.set(x, y, z);
      if (jump) e.pos.copy(e.tgt);
      Object.assign(e, { yaw, pitch, hp, shield, shieldCap, flags, weapon: WEAPON_IDS[wi], maxHp, slow });
    }
    for (const [id, e] of this.strikers) if (!seenA.has(id)) { this.root.remove(e.obj); this.strikers.delete(id); }
    // troops
    const seenR = new Set();
    for (const r of s.r) {
      const [id, ti, x, y, z, hp, maxHp, owner, target] = r;
      seenR.add(id);
      let e = this.troops.get(id);
      if (!e) { e = this.makeTroop(id, TROOP_IDS[ti], owner); this.troops.set(id, e); e.pos.set(x, y, z); }
      e.tgt.set(x, y, z);
      Object.assign(e, { hp, maxHp, target });
    }
    for (const [id, e] of this.troops) if (!seenR.has(id)) { this.root.remove(e.obj); this.troops.delete(id); }
    // zones
    const seenZ = new Set();
    for (const z of s.z) {
      const [id, ti, x, zz, r, ttl] = z;
      seenZ.add(id);
      let e = this.zones.get(id);
      if (!e) { e = this.makeZone(id, ZONE_TYPES[ti], x, zz, r); this.zones.set(id, e); }
      e.ttl = ttl;
    }
    for (const [id, e] of this.zones) if (!seenZ.has(id)) { this.root.remove(e.obj); this.zones.delete(id); }
    // checkpoints
    this.cps = s.c;
    s.c.forEach((c, i) => this.world.setCheckpoint(i, !!c[0], c[1], !!c[2]));
    for (let i = s.c.length; i < (this.world.flags || []).length; i++) this.world.setCheckpoint(i, false, 0, false, false);
    for (const e of s.e) this.event(e);
  }

  // ------------------------------------------------------------------ builders
  makeTower(id, type, tx, tz, level, old) {
    const def = TOWERS[type];
    const model = buildTower(type, level);
    const obj = new THREE.Group();
    const map = this.world.map;
    const x = (tx + 0.5) * TILE, z = (tz + 0.5) * TILE;
    const y = def.place === 'path' ? 0 : PAD_Y;
    obj.position.set(x, y, z);
    if (type === 'barricade' && map) {
      const i = map.idx(tx, tz);
      const p = map.progress[i];
      const pe = tx + 1 < map.w && map.tiles[i + 1] === T.PATH ? Math.abs(map.progress[i + 1] - p) : 0;
      const pw = tx > 0 && map.tiles[i - 1] === T.PATH ? Math.abs(map.progress[i - 1] - p) : 0;
      if (Math.max(pe, pw) > 2) obj.rotation.y = Math.PI / 2;
    }
    obj.add(model.group);
    const bar = makeBar(2.4, 0.22, 0x5ee07a);
    bar.position.y = def.h + 1.0;
    bar.visible = false;
    obj.add(bar);
    // shield bubble
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(2.1, 16, 10), new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    bubble.position.y = Math.min(def.h * 0.5, 2.2);
    bubble.scale.y = Math.max(1, def.h / 4.2);
    bubble.visible = false;
    obj.add(bubble);
    // range ring
    const ringR = def.range || 0;
    let ring = null;
    if (ringR > 2) {
      ring = new THREE.Group();
      const edge = new THREE.Mesh(new THREE.RingGeometry(ringR - 0.25, ringR, 64), this.rangeMat);
      const fill = new THREE.Mesh(new THREE.CircleGeometry(ringR, 64), this.rangeFill);
      edge.rotation.x = fill.rotation.x = -Math.PI / 2;
      ring.add(edge, fill);
      ring.position.y = 0.08 - y;
      ring.visible = false;
      ring.userData.base = ringR;
      if (def.minRange) { const mr = new THREE.Mesh(new THREE.RingGeometry(def.minRange - 0.2, def.minRange, 48), new THREE.MeshBasicMaterial({ color: 0xff6060, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false })); mr.rotation.x = -Math.PI / 2; ring.add(mr); }
      obj.add(ring);
    }
    let beam = null;
    if (type === 'laser') {
      beam = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      beam.visible = false;
      this.root.add(beam);
    }
    this.root.add(obj);
    obj.traverse((o) => { if (o.isMesh) o.userData.towerId = id; });
    const t = { id, type, tx, tz, level, x, y, z, obj, model, bar, bubble, ring, beam, disabled: false, yawNow: old ? old.yawNow : 0, built: old ? 1 : 0, fxT: Math.random(), def };
    if (!old && this.phase) { this.fx.burst(x, y + 0.5, z, 14, [0xb8a27a, 0x8f877a], 4, { life: 0.6, size: 0.25 }); }
    if (old) { this.root.remove(old.beam || new THREE.Object3D()); this.fx.burst(x, y + def.h, z, 20, [0xffe27a, 0xffffff], 5, { glow: true, life: 0.6, size: 0.12 }); }
    return t;
  }
  makeStriker(id) {
    const col = playerColor(id);
    const s = buildSoldier(col, 0xffffff, 1);
    const obj = new THREE.Group();
    obj.add(s.root);
    const tag = nameSprite(this.nameOf(id), '#ffd1ae');
    tag.position.y = 2.65;
    obj.add(tag);
    const bar = makeBar(1.4, 0.14, 0x5ee07a);
    bar.position.y = 2.3;
    obj.add(bar);
    this.root.add(obj);
    return { id, obj, model: s, tag, bar, pos: new THREE.Vector3(), tgt: new THREE.Vector3(), yaw: 0, pitch: 0, hp: 100, maxHp: 100, shield: 0, shieldCap: 0, flags: 1, walk: 0, mat: null };
  }
  makeTroop(id, type, owner) {
    const parts = buildTroop(type);
    const obj = new THREE.Group();
    obj.add(parts.root);
    const def = TROOPS[type];
    const bar = makeBar(1.0, 0.1, 0x5ee07a);
    bar.position.y = def.air ? 1.0 : type === 'mech' ? 4.0 : 2.3;
    obj.add(bar);
    this.root.add(obj);
    return { id, type, owner, obj, parts, bar, pos: new THREE.Vector3(), tgt: new THREE.Vector3(), hp: def.hp, maxHp: def.hp, walk: 0, yaw: 0 };
  }
  makeZone(id, type, x, z, r) {
    const obj = new THREE.Group();
    obj.position.set(x, 0, z);
    if (type === 'dome') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      obj.add(m);
      this.sfx.play('heal', { x, z });
    } else if (type === 'cryo') {
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.28, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.1; obj.add(m);
      this.fx.ring(x, 0.2, z, r, 0x9fe8ff, 0.7);
      this.sfx.play('frost', { x, z });
    } else if (type === 'airstrike') {
      const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.4, r, 40), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.12; obj.add(m);
    }
    this.root.add(obj);
    return { id, type, obj, x, z, r, ttl: 1, t: 0 };
  }

  // ------------------------------------------------------------------ queries
  entityPos(id) {
    const s = this.strikers.get(id);
    if (s) return tmp.set(s.pos.x, s.pos.y + 1.1, s.pos.z).clone();
    const r = this.troops.get(id);
    if (r) return tmp.set(r.pos.x, r.pos.y + (TROOPS[r.type].air ? 0 : 1), r.pos.z).clone();
    return null;
  }
  towerMuzzle(t) { t.obj.updateMatrixWorld(true); return t.model.muzzle.getWorldPosition(new THREE.Vector3()); }
  towerTop(t) { return v3(t.x, t.y + t.def.h * 0.85, t.z); }
  towerMeshes() { const out = []; for (const t of this.towers.values()) out.push(t.obj); return out; }
  towerAtTile(tx, tz) { for (const t of this.towers.values()) if (t.tx === tx && t.tz === tz) return t; return null; }

  // ------------------------------------------------------------------ events
  event(e) {
    const fx = this.fx, sfx = this.sfx;
    switch (e.k) {
      case 'tf': {
        const t = this.towers.get(e.i); if (!t) break;
        const m = this.towerMuzzle(t);
        const to = v3(e.x, e.y, e.z);
        if (t.type === 'sniper') { fx.beam(m, to, 0xfff0b0, 0.08, 0.12); fx.muzzle(m); }
        else { fx.tracer(m, to, 0xffe08a, 0.06); fx.muzzle(m); }
        fx.impact(to, 0xffc080);
        sfx.play(TOWER_SOUND[t.type] || 'sentry', t);
        break;
      }
      case 'tc': {
        const t = this.towers.get(e.i); if (!t) break;
        const pts = [this.towerTop(t), ...e.pts.map((p) => v3(p[0], p[1], p[2]))];
        fx.lightning(pts);
        fx.flash(t.x, t.y + t.def.h, t.z, 0x7ff8ff, 25, 0.15);
        sfx.play('tesla', t);
        break;
      }
      case 'fp': {
        const t = this.towers.get(e.i); if (!t) break;
        fx.ring(t.x, 0.3, t.z, TOWERS.frost.range * (t.rangeMult || 1), 0x9fe8ff, 0.6);
        fx.burst(t.x, t.y + 3.7, t.z, 8, [0xbff4ff, 0xffffff], 5, { glow: true, life: 0.6, size: 0.12, g: 2 });
        sfx.play('frost', t, 0.6);
        break;
      }
      case 'tp': {
        const t = this.towers.get(e.i);
        const kind = e.kind;
        const obj = buildProjectile(kind === 'missile' ? 'missile' : kind === 'mortar' ? 'mortar' : 'shell');
        this.root.add(obj);
        const from = t && kind !== 'missile' ? this.towerMuzzle(t) : v3(e.fx, e.fy, e.fz);
        if (kind === 'missile') { obj.position.copy(from); this.projs.set(e.id, { id: e.id, obj, kind, tg: e.tg, sp: e.sp, delay: e.dl || 0, life: 6, smokeT: 0 }); }
        else this.projs.set(e.id, { id: e.id, obj, kind, from, to: v3(e.tx, e.ty, e.tz), t: 0, d: Math.max(0.05, e.d), life: e.d + 1 });
        if (t) { fx.muzzle(from, 0xffc060); sfx.play(TOWER_SOUND[t.type] || 'cannon', t); }
        break;
      }
      case 'pp': {
        const kind = e.e || e.w;
        const obj = buildProjectile(kind);
        obj.position.set(e.x, e.y, e.z);
        this.root.add(obj);
        const p = { id: e.id, obj, kind, player: true, vel: v3(e.vx, e.vy, e.vz), g: e.g, life: 8, rest: false, smokeT: 0 };
        this.projs.set(e.id, p);
        if (e.p !== this.myId || !this.fps) {
          if (e.e) sfx.play('throw', { x: e.x, z: e.z });
          else sfx.play(kind, { x: e.x, y: e.y, z: e.z });
        }
        break;
      }
      case 'bx': {
        if (e.id && this.projs.has(e.id)) { const p = this.projs.get(e.id); this.root.remove(p.obj); this.projs.delete(e.id); }
        const kind = e.kind;
        if (kind === 'smoke') { fx.smokePuffs(e.x, e.z, e.r); sfx.play('smallboom', e, 0.4); break; }
        const big = ['rocket', 'launcher', 'frag', 'mortar', 'shell', 'airstrike', 'mine', 'sapper', 'emp'].includes(kind);
        fx.explosion(e.x, e.y, e.z, kind === 'plasma' ? 1.2 : e.r, kind);
        sfx.play(kind === 'emp' ? 'emp' : big ? 'explosion' : 'smallboom', e, kind === 'airstrike' ? 1.4 : 1);
        if (big) fx.shake(kind === 'airstrike' ? 0.6 : 0.25);
        break;
      }
      case 'pf': {
        const own = e.p === this.myId && this.fps;
        const o = v3(e.o[0], e.o[1] - 0.25, e.o[2]);
        for (const h of e.h) {
          const hp = v3(h[0], h[1], h[2]);
          if (!own) fx.tracer(o, hp, e.w === 'railgun' ? 0x6fd3ff : 0xfff0a0, 0.06);
          if (!own) fx.impact(hp, h[3] ? 0xffd080 : 0xc8b090, false);
        }
        if (e.w === 'railgun' && !own) fx.beam(o, v3(e.h[0][0], e.h[0][1], e.h[0][2]), 0x6fd3ff, 0.12, 0.3);
        if (!own) sfx.play(e.w, { x: o.x, y: o.y, z: o.z }, 0.8);
        break;
      }
      case 'rf': {
        const r = this.troops.get(e.id); if (!r) break;
        const from = v3(r.pos.x, r.pos.y + (TROOPS[r.type].air ? 0 : r.type === 'mech' ? 2.4 : 1.3), r.pos.z);
        fx.tracer(from, v3(e.x, e.y, e.z), r.type === 'mech' ? 0xff9040 : 0xfff0a0, 0.08);
        fx.impact(v3(e.x, e.y, e.z), 0xffd080);
        sfx.play('troop', from, 0.6);
        break;
      }
      case 'cf': {
        const b = this.world.base;
        if (!b) break;
        const from = v3(this.world.map.base.x, 10, this.world.map.base.z);
        fx.beam(from, v3(e.x, e.y, e.z), 0x6fd3ff, 0.14, 0.12);
        sfx.play('core', from, 0.5);
        break;
      }
      case 'td': {
        const t = this.towers.get(e.i); if (!t) break;
        if (e.spent) break;
        fx.burst(t.x, t.y + t.def.h * 0.6, t.z, 30, [0xffd060, 0xffffff, 0xff8030], 7, { glow: true, life: 0.6, size: 0.14 });
        fx.burst(t.x, t.y + t.def.h * 0.6, t.z, 16, [0x444444, 0x666666, 0x2a2a2a], 5, { life: 1.2, size: 0.25 });
        fx.flash(t.x, t.y + 2, t.z, 0xffa040, 40, 0.3);
        sfx.play('disable', t);
        break;
      }
      case 'tr': {
        const t = this.towers.get(e.i); if (!t) break;
        fx.burst(t.x, t.y + t.def.h * 0.6, t.z, 26, [0x60ff90, 0xffffff], 6, { glow: true, life: 0.7, size: 0.14 });
        fx.ring(t.x, t.y + 0.2, t.z, 4, 0x60ff90, 0.6);
        sfx.play('reboot', t);
        break;
      }
      case 'tb': this.sfx.play('build', { x: (e.tx + 0.5) * TILE, z: (e.tz + 0.5) * TILE }); break;
      case 'ts': { const t = this.towers.get(e.i); if (t) { fx.burst(t.x, t.y + 1, t.z, 20, [0xb8a27a, 0x8f877a], 5, { life: 0.8, size: 0.3 }); sfx.play('sell', t); } break; }
      case 'kill': {
        const s = this.strikers.get(e.v);
        const col = playerColor(e.v);
        fx.burst(e.x, 1, e.z, 26, [col, 0x3b3f45, 0xe0b08a, 0x2a2e33], 6, { life: 1.4, size: 0.22 });
        if (s) sfx.play('death', s.pos);
        break;
      }
      case 'rk': {
        const col = { grunts: 0x5f6b45, bearer: 0x8aa0bf, sapper: 0xc0302a, drone: 0x3a4048, medic: 0xeeeeee, mech: 0x6c7684 }[e.type] || 0x777777;
        fx.burst(e.x, (e.y || 0) + 1, e.z, e.type === 'mech' ? 50 : 18, [col, 0x333333, 0xff9040], e.type === 'mech' ? 8 : 5, { life: 1.2, size: e.type === 'mech' ? 0.4 : 0.2 });
        if (e.type === 'mech' || e.type === 'drone') { fx.explosion(e.x, (e.y || 0) + 1, e.z, 2.5, 'shell'); sfx.play('smallboom', e); }
        break;
      }
      case 'sp': { const s = this.strikers.get(e.p); if (s) { fx.beam(v3(s.tgt.x, 30, s.tgt.z), v3(s.tgt.x, 0, s.tgt.z), playerColor(e.p), 0.8, 0.5); } break; }
      case 'cp': sfx.play('checkpoint'); break;
      case 'ab': {
        if (e.a === 'airstrike') { this.spawnPlane(e.bombs); sfx.play('alarm', { x: e.x, z: e.z }); }
        else if (e.a === 'overcharge') { const t = this.towers.get(e.i); if (t) { fx.burst(t.x, t.y + t.def.h, t.z, 24, [0xff4040, 0xffd060], 6, { glow: true, life: 0.7, size: 0.14 }); sfx.play('reboot', t); } }
        else if (e.a === 'fortify') { this.world.flashDome(); sfx.play('reboot', this.world.map.base); }
        break;
      }
      case 'bh': { this.world.flashDome(); const b = this.world.map.base; if (Math.random() < 0.5) fx.burst(b.x + (Math.random() - 0.5) * 7, 2 + Math.random() * 6, b.z + (Math.random() - 0.5) * 7, 4, [0xffd080, 0xaaaaaa], 4, { life: 0.5, size: 0.15 }); sfx.play('basehit', b, 0.6); break; }
      case 'lock': sfx.play('alarm'); break;
      case 'eq': {
        const s = this.strikers.get(e.p); if (!s) break;
        if (e.e === 'medkit') { fx.burst(s.pos.x, s.pos.y + 1, s.pos.z, 14, [0x60ff90, 0xffffff], 2, { glow: true, life: 0.8, size: 0.12, g: -2 }); sfx.play('heal', s.pos); }
        if (e.e === 'stim') { fx.burst(s.pos.x, s.pos.y + 1, s.pos.z, 12, [0xff60c0, 0xffffff], 3, { glow: true, life: 0.5, size: 0.1 }); }
        if (e.e === 'cloak') { fx.burst(s.pos.x, s.pos.y + 1, s.pos.z, 20, [0x99ccff, 0xffffff], 3, { glow: true, life: 0.6, size: 0.1 }); }
        if (e.e === 'drone') { sfx.play('missile', s.pos, 0.6); }
        break;
      }
      default: break;
    }
  }
  spawnPlane(bombs) {
    if (!bombs || !bombs.length) return;
    const vb = new VB(66);
    vb.box(0, 0, 0, 1.6, 1.2, 7, 0x5a6470).box(0, 0, 0.5, 9, 0.25, 1.8, 0x4a525c).box(0, 0.9, 3.0, 0.2, 1.6, 1.2, 0x4a525c).box(0, 0, -3.8, 0.9, 0.9, 0.8, 0x2a2e33).box(0, 0.4, -1.6, 1.0, 0.5, 1.4, 0x6fb8e8);
    const m = meshOf(vb);
    const a = bombs[0], b = bombs[bombs.length - 1];
    const dir = v3(b[0] - a[0], 0, b[1] - a[1]); if (dir.lengthSq() < 0.01) dir.set(1, 0, 0); dir.normalize();
    const start = v3(a[0] - dir.x * 120, 38, a[1] - dir.z * 120);
    m.position.copy(start);
    m.lookAt(start.clone().add(dir));
    m.rotateY(Math.PI);
    this.root.add(m);
    this.planes = this.planes || [];
    this.planes.push({ m, dir, life: 6 });
  }

  // ------------------------------------------------------------------ per-frame
  update(dt, camera) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 14);
    const now = this.time;
    const camPos = camera.position;
    const isDef = this.role === 'defender' || this.role === 'spectator';
    // towers
    for (const t of this.towers.values()) {
      const head = t.model.head;
      if (t.model.spin) head.rotation.y += dt * (t.disabled ? 0 : t.type === 'radar' ? 1.2 : 1.6);
      else if (!t.disabled) {
        let d = t.targetYaw - t.yawNow;
        while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        t.yawNow += d * Math.min(1, dt * 10);
        head.rotation.y = t.yawNow - t.obj.rotation.y;
      }
      head.rotation.x = t.disabled ? 0.35 : 0;
      // building animation
      const building = !!(t.flags & 4);
      t.model.group.scale.y = building ? 0.3 + 0.7 * ((now * 0.8) % 1) : Math.min(1, t.model.group.scale.y + dt * 3);
      // bubbles & bars
      const sm = t.shieldMax || 0;
      t.bubble.visible = !!(sm > 0 && t.shield > 1 && !t.disabled);
      if (t.bubble.visible) t.bubble.material.opacity = 0.05 + 0.12 * (t.shield / sm) + (t.flags & 2 ? 0 : 0);
      const near = camPos.distanceTo(t.obj.position) < 34;
      const showBar = (t.hp < t.maxHp || t.shield > 0 || t.disabled) && (isDef || this.scout || near) || t.id === this.selectedTower;
      t.bar.visible = !!(showBar && !(t.type === 'mine' && this.role === 'striker' && !this.scout));
      if (t.bar.visible) { setBar(t.bar, t.hp / t.maxHp, sm ? t.shield / sm : 0); t.bar.quaternion.copy(camera.quaternion); }
      if (t.ring) {
        const show = t.id === this.selectedTower || t.id === this.hoverTower || (this.scout > 0 && !t.disabled) || (this.showAllRanges && !t.disabled);
        t.ring.visible = !!show;
        if (show) { const sc = t.rangeMult || 1; t.ring.scale.set(sc, 1, sc); }
      }
      // mines are stealthy for strikers
      if (t.type === 'mine') {
        const dist = this.myPos ? this.myPos.distanceTo(t.obj.position) : 0;
        t.obj.visible = !!(this.role !== 'striker' || this.scout > 0 || dist < 9 || (t.flags & 64));
        if (t.flags & 64) t.model.group.visible = false;
      }
      // status particles
      t.fxT -= dt;
      if (t.fxT <= 0) {
        t.fxT = 0.18;
        const top = t.y + t.def.h * 0.8;
        if (t.disabled && !(t.flags & 64)) { this.fx.part(this.fx.solid, { x: t.x + (Math.random() - 0.5), y: top, z: t.z + (Math.random() - 0.5), vy: 1.4, vx: 0.3, color: 0x3a3a3a, size: 0.5, grow: 1.5, life: 1.6, g: -0.5, drag: 0.6 }); if (Math.random() < 0.3) this.fx.burst(t.x, top, t.z, 2, [0xffd060, 0xffffff], 3, { glow: true, life: 0.3, size: 0.08 }); }
        if (t.flags & 2) this.fx.burst(t.x, top, t.z, 3, [0x6fd3ff, 0xffffff], 3, { glow: true, life: 0.3, size: 0.08 });
        if (t.flags & 8) this.fx.burst(t.x, top, t.z, 2, [0xff4040, 0xffa040], 2, { glow: true, life: 0.4, size: 0.1, g: -3 });
        if (t.flags & 32) this.fx.burst(t.x, top, t.z, 3, [0x60ff90], 2, { glow: true, life: 0.5, size: 0.1, g: -3 });
        if (t.type === 'goldmine' && !t.disabled && Math.random() < 0.3) this.fx.burst(t.x, t.y + 1.2, t.z - 1, 1, [0xffe680], 1.5, { glow: true, life: 0.6, size: 0.1, g: -2 });
      }
      // continuous weapons
      const tgtPos = t.target && !t.disabled ? this.entityPos(t.target) : null;
      if (t.beam) {
        t.beam.visible = !!tgtPos;
        if (tgtPos) {
          const m = this.towerMuzzle(t);
          const len = m.distanceTo(tgtPos);
          t.beam.position.copy(m).add(tgtPos).multiplyScalar(0.5);
          t.beam.lookAt(tgtPos);
          const w = 0.12 + 0.06 * Math.sin(now * 40);
          t.beam.scale.set(w, w, len);
          if (Math.random() < 0.3) this.fx.impact(tgtPos, 0xff6040);
          this.sfx.play('laser', t, 0.5);
        }
      }
      if (t.type === 'flamer' && tgtPos) { this.fx.flame(this.towerMuzzle(t), tgtPos); this.sfx.play('flame', t, 0.6); }
      if (t.type === 'spikes' && t.target && !t.disabled && Math.random() < 0.2) this.fx.burst(t.x, 0.4, t.z, 2, [0xff4040], 2, { life: 0.3, size: 0.08 });
    }
    // strikers
    for (const s of this.strikers.values()) {
      const prev = tmp.copy(s.pos);
      s.pos.lerp(s.tgt, k);
      const speed = prev.distanceTo(s.pos) / Math.max(dt, 1e-3);
      const alive = !!(s.flags & 1);
      const me = s.id === this.myId && this.fps;
      s.obj.visible = !!(alive && !me);
      s.obj.position.copy(s.pos);
      s.obj.rotation.y = s.yaw;
      s.walk += speed * dt * 1.6;
      const sw = Math.min(1, speed / 3) * Math.sin(s.walk);
      s.model.legL.rotation.x = sw * 0.7; s.model.legR.rotation.x = -sw * 0.7;
      s.model.arms.rotation.x = -s.pitch * 0.8;
      const ghost = !!(s.flags & 2), cloak = !!(s.flags & 4), prot = !!(s.flags & 64);
      const want = cloak ? MAT.cloak : ghost ? MAT.ghost : null;
      if (s.mat !== want) { s.mat = want; setMat(s.model.root, want); }
      s.bar.visible = !!(alive && !ghost && (isDef || camPos.distanceTo(s.pos) < 40) && !(cloak && this.role === 'defender'));
      if (s.bar.visible) { setBar(s.bar, s.hp / (s.maxHp || 100), s.shieldCap ? s.shield / s.shieldCap : 0); s.bar.quaternion.copy(camera.quaternion); }
      s.tag.visible = !!(alive && !(cloak && this.role === 'defender'));
      if (prot && alive && Math.random() < 0.2) this.fx.burst(s.pos.x, s.pos.y + 1, s.pos.z, 1, [0x9fe8ff], 1, { glow: true, life: 0.4, size: 0.1, g: -2 });
      if ((s.flags & 16) && alive && Math.random() < 0.5) this.fx.burst(s.pos.x, s.pos.y + 1, s.pos.z, 1, [0xff8a2a, 0xffd34d], 1.5, { glow: true, life: 0.4, size: 0.15, g: -4 });
      if ((s.flags & 32) && alive && Math.random() < 0.15) this.fx.burst(s.pos.x, s.pos.y + 0.3, s.pos.z, 1, [0xbff4ff], 1, { glow: true, life: 0.5, size: 0.08, g: 0 });
    }
    // troops
    for (const r of this.troops.values()) {
      const prev = tmp.copy(r.pos);
      r.pos.lerp(r.tgt, k);
      const dx = r.pos.x - prev.x, dz = r.pos.z - prev.z;
      const speed = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
      if (speed > 0.3) r.yaw = Math.atan2(-dx, -dz);
      if (r.target && r.target !== -1) { const t = this.towers.get(r.target); if (t) r.yaw = Math.atan2(-(t.x - r.pos.x), -(t.z - r.pos.z)); }
      if (r.target === -1) { const b = this.world.map.base; r.yaw = Math.atan2(-(b.x - r.pos.x), -(b.z - r.pos.z)); }
      r.obj.position.copy(r.pos);
      const def = TROOPS[r.type];
      if (def.air || def.follow) r.obj.position.y += Math.sin(now * 3 + r.id) * 0.15;
      r.obj.rotation.y = r.yaw;
      r.walk += speed * dt * 1.8;
      const p = r.parts;
      if (p.legL) { const sw = Math.min(1, speed / 2) * Math.sin(r.walk); p.legL.rotation.x = sw * 0.6; p.legR.rotation.x = -sw * 0.6; }
      for (const sp of p.spin) sp.rotation.y += dt * 40;
      r.bar.visible = !!(r.hp < r.maxHp && (isDef || camPos.distanceTo(r.pos) < 40));
      if (r.bar.visible) { setBar(r.bar, r.hp / r.maxHp); r.bar.quaternion.copy(camera.quaternion); }
      if (r.type === 'medic' && Math.random() < 0.1) this.fx.burst(r.pos.x, r.pos.y - 0.5, r.pos.z, 1, [0x60ff90], 1, { glow: true, life: 0.6, size: 0.1, g: -1 });
    }
    // projectiles
    for (const [id, p] of this.projs) {
      p.life -= dt;
      if (p.life <= 0) { this.root.remove(p.obj); this.projs.delete(id); continue; }
      if (p.player) {
        if (!p.rest) {
          p.vel.y -= p.g * dt;
          p.obj.position.addScaledVector(p.vel, dt);
          if (p.obj.position.y <= 0.15 && ['frag', 'emp', 'smoke'].includes(p.kind)) {
            p.obj.position.y = 0.15; p.vel.y = -p.vel.y * 0.3; p.vel.x *= 0.55; p.vel.z *= 0.55;
            if (Math.abs(p.vel.y) < 1.2) p.rest = true;
          }
          if (p.vel.lengthSq() > 1) p.obj.lookAt(tmp.copy(p.obj.position).add(p.vel));
        }
        p.smokeT -= dt;
        if (p.smokeT <= 0 && (p.kind === 'rocket')) { p.smokeT = 0.02; this.fx.part(this.fx.solid, { x: p.obj.position.x, y: p.obj.position.y, z: p.obj.position.z, color: 0xaaaaaa, size: 0.3, grow: 2, life: 0.8, g: -0.5, vy: 0.3 }); }
        if (p.kind === 'plasma' && Math.random() < 0.6) this.fx.part(this.fx.glow, { x: p.obj.position.x, y: p.obj.position.y, z: p.obj.position.z, color: 0xb060ff, size: 0.18, life: 0.2, g: 0 });
      } else if (p.kind === 'missile') {
        if (p.delay > 0) { p.delay -= dt; continue; }
        const tg = this.entityPos(p.tg);
        if (tg) p.last = tg;
        const goal = p.last || p.obj.position;
        const d = tmp.copy(goal).sub(p.obj.position);
        const len = d.length();
        if (len > 0.5) { p.obj.position.addScaledVector(d.normalize(), Math.min(len, p.sp * dt)); p.obj.lookAt(goal); p.obj.rotateY(Math.PI); }
        p.smokeT -= dt;
        if (p.smokeT <= 0) { p.smokeT = 0.03; this.fx.part(this.fx.solid, { x: p.obj.position.x, y: p.obj.position.y, z: p.obj.position.z, color: 0xcccccc, size: 0.22, grow: 2, life: 0.7, g: -0.5 }); }
      } else {
        p.t += dt;
        const f = Math.min(1, p.t / p.d);
        const dist = p.from.distanceTo(p.to);
        const peak = p.kind === 'mortar' ? 8 + dist * 0.3 : 1 + dist * 0.06;
        p.obj.position.lerpVectors(p.from, p.to, f);
        p.obj.position.y += Math.sin(f * Math.PI) * peak;
        if (f >= 1) { this.root.remove(p.obj); this.projs.delete(id); }
      }
    }
    // zones
    for (const z of this.zones.values()) {
      z.t += dt;
      if (z.type === 'smoke' && Math.random() < dt * 12) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * z.r;
        this.fx.part(this.fx.solid, { x: z.x + Math.cos(a) * d, y: 0.5 + Math.random() * 2, z: z.z + Math.sin(a) * d, vx: (Math.random() - 0.5) * 0.5, vy: 0.3, color: Math.random() < 0.5 ? 0xdedede : 0xc4c4c4, size: 1.8 + Math.random() * 1.4, grow: 0.5, life: 2.2, g: 0, drag: 0.8 });
      }
      if (z.type === 'cryo' && Math.random() < dt * 20) { const a = Math.random() * Math.PI * 2, d = Math.random() * z.r; this.fx.part(this.fx.glow, { x: z.x + Math.cos(a) * d, y: 0.2, z: z.z + Math.sin(a) * d, vy: 1.2, color: 0xbff4ff, size: 0.12, life: 0.8, g: 0 }); }
      if (z.type === 'airstrike') { z.obj.children[0].material.opacity = 0.4 + 0.4 * Math.sin(z.t * 18); }
      if (z.type === 'dome') { z.obj.children[0].material.opacity = 0.14 + 0.06 * Math.sin(z.t * 5); }
    }
    if (this.planes) for (let i = this.planes.length - 1; i >= 0; i--) {
      const pl = this.planes[i]; pl.life -= dt;
      pl.m.position.addScaledVector(pl.dir, dt * 70);
      if (pl.life <= 0) { this.root.remove(pl.m); this.planes.splice(i, 1); }
    }
  }
}
