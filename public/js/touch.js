// Touch controls for phones & tablets: striker joystick/look/buttons, and iso-camera gestures.
import { $ } from './ui.js';

// Touch UI when the primary pointer is a finger (phones/tablets). Override with ?touch=1 / ?touch=0.
export function detectTouch() {
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1' || q === '0') { try { localStorage.setItem('ts_touch', q); } catch { /* ignore */ } }
  let saved = null;
  try { saved = localStorage.getItem('ts_touch'); } catch { /* ignore */ }
  if (saved === '1') return true;
  if (saved === '0') return false;
  return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) && navigator.maxTouchPoints > 0;
}

const LOOK_SENS = 0.0058; // radians per CSS pixel of finger drag

// ---------------------------------------------------------------------------- striker
export class StrikerTouch {
  constructor(mode) {
    this.m = mode;
    this.move = { x: 0, y: 0, active: false };
    this.sprint = false; this.jump = false;
    const root = document.createElement('div');
    root.className = 'touch-ui';
    root.innerHTML = `
      <div class="t-look"></div>
      <div class="t-move"><div class="t-stick-base hidden"><div class="t-stick"></div></div><div class="t-move-hint">Move</div></div>
      <button class="t-btn t-fire" data-b="fire" aria-label="Fire">🔫</button>
      <button class="t-btn t-aim" data-b="aim" aria-label="Aim">🎯</button>
      <button class="t-btn t-jump" data-b="jump" aria-label="Jump">⤒</button>
      <button class="t-btn t-reload" data-b="reload" aria-label="Reload">⟳</button>
      <button class="t-btn t-sprint" data-b="sprint" aria-label="Sprint">🏃</button>
      <button class="t-btn small t-swap" data-b="swap" aria-label="Swap weapon">⇄</button>
      <button class="t-btn small t-shop" data-b="shop" aria-label="Shop">🛒</button>
      <button class="t-btn small t-full" data-b="full" aria-label="Fullscreen">⛶</button>
      <div class="t-rotate">↻ Turn your device sideways to play</div>`;
    $('str-hud').appendChild(root);
    this.root = root;
    this.base = root.querySelector('.t-stick-base');
    this.stick = root.querySelector('.t-stick');
    this.look = new Map(); // pointerId -> last {x,y}

    // look anywhere on the right side (and while holding fire)
    const lookZone = root.querySelector('.t-look');
    lookZone.addEventListener('pointerdown', (e) => this.lookStart(e));
    // dynamic joystick on the left side
    const moveZone = root.querySelector('.t-move');
    moveZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      moveZone.setPointerCapture(e.pointerId);
      this.moveId = e.pointerId;
      this.center = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`; this.base.style.top = `${e.clientY}px`;
      this.base.classList.remove('hidden');
      this.move = { x: 0, y: 0, active: true };
      this.stick.style.transform = 'translate(-50%,-50%)';
    });
    moveZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.moveId) return;
      const R = 52;
      let dx = e.clientX - this.center.x, dy = e.clientY - this.center.y;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      const dead = 0.12;
      const mx = dx / R, my = dy / R, mag = Math.hypot(mx, my);
      this.move = mag < dead ? { x: 0, y: 0, active: true } : { x: mx, y: my, active: true };
      this.stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    const endMove = (e) => { if (e.pointerId !== this.moveId) return; this.moveId = null; this.move = { x: 0, y: 0, active: false }; this.base.classList.add('hidden'); };
    moveZone.addEventListener('pointerup', endMove);
    moveZone.addEventListener('pointercancel', endMove);

    for (const b of root.querySelectorAll('[data-b]')) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.press(b.dataset.b, e, b); });
      b.addEventListener('pointerup', (e) => this.release(b.dataset.b, e, b));
      b.addEventListener('pointercancel', (e) => this.release(b.dataset.b, e, b));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    // the fire button doubles as a look pad, so you can aim while shooting
    const fire = root.querySelector('.t-fire');
    fire.addEventListener('pointermove', (e) => this.lookMove(e));
    // gear: tap the slot in the equipment bar
    this.onEquip = (e) => { const el = e.target.closest('[data-e]'); if (el) { e.preventDefault(); this.m.useEquip(el.dataset.e); } };
    $('equip-bar').addEventListener('pointerdown', this.onEquip);
    this.onWinMove = (e) => this.lookMove(e);
    this.onWinUp = (e) => this.look.delete(e.pointerId);
    window.addEventListener('pointermove', this.onWinMove);
    window.addEventListener('pointerup', this.onWinUp);
    window.addEventListener('pointercancel', this.onWinUp);
  }
  lookStart(e) {
    e.preventDefault();
    this.look.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  lookMove(e) {
    const last = this.look.get(e.pointerId);
    if (!last) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last.x = e.clientX; last.y = e.clientY;
    const m = this.m;
    if (m.shopOpen || !m.alive) return;
    const s = LOOK_SENS * (m.sens / 0.0022) * (m.scoped() ? 0.35 : m.rmb ? 0.7 : 1);
    m.yaw -= dx * s;
    m.pitch = Math.max(-1.5, Math.min(1.5, m.pitch - dy * s));
  }
  press(b, e, el) {
    const m = this.m;
    el.classList.add('down');
    switch (b) {
      case 'fire': m.mouseDown = true; m.clicked = true; this.look.set(e.pointerId, { x: e.clientX, y: e.clientY }); el.setPointerCapture?.(e.pointerId); break;
      case 'aim': m.rmb = !m.rmb; el.classList.toggle('on', m.rmb); break;
      case 'jump': this.jump = true; break;
      case 'reload': m.reload(); break;
      case 'sprint': this.sprint = !this.sprint; el.classList.toggle('on', this.sprint); break;
      case 'swap': m.cycleWeapon(1); break;
      case 'shop': m.toggleShop(); break;
      case 'full': {
        const d = document.documentElement;
        if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
        else document.exitFullscreen?.();
        break;
      }
      default: break;
    }
  }
  release(b, e, el) {
    el.classList.remove('down');
    if (b === 'fire') { this.m.mouseDown = false; this.look.delete(e.pointerId); }
    if (b === 'jump') this.jump = false;
  }
  syncButtons() {
    this.root.querySelector('.t-aim').classList.toggle('on', !!this.m.rmb);
  }
  dispose() {
    window.removeEventListener('pointermove', this.onWinMove);
    window.removeEventListener('pointerup', this.onWinUp);
    window.removeEventListener('pointercancel', this.onWinUp);
    $('equip-bar').removeEventListener('pointerdown', this.onEquip);
    this.root.remove();
  }
}

// ---------------------------------------------------------------------------- iso camera gestures
// One finger drags the map; two fingers pinch to zoom and twist to rotate. Taps still reach the game as clicks.
export function attachIsoTouch(iso, canvas) {
  const pts = new Map();
  let pinch = null;
  iso.touchMoved = 0;
  const down = (e) => {
    if (e.pointerType !== 'touch') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) iso.touchMoved = 0;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), zoom: iso.zoomT, angle: iso.angleT };
    }
  };
  const move = (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    iso.touchMoved += Math.abs(dx) + Math.abs(dy);
    if (pts.size === 1) {
      const s = (iso.zoom * 2) / window.innerHeight;
      iso.pan(-dx * s, -dy * s / Math.sin(iso.pitch));
    } else if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      const W = iso.world.size.W, H = iso.world.size.H;
      iso.zoomT = Math.max(14, Math.min(Math.max(W, H) * 0.7, pinch.zoom * (pinch.d / Math.max(20, d))));
      iso.angleT = pinch.angle - (ang - pinch.ang);
      iso.touchMoved += 50;
    }
  };
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
  canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
}
