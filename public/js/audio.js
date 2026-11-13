// Procedural WebAudio sound effects. Everything is synthesised: no audio files to load.
import * as THREE from 'three';

const tmpV = new THREE.Vector3(), tmpR = new THREE.Vector3();

export class Sfx {
  constructor() {
    this.ctx = null; this.master = null; this.camera = null;
    this.volume = Number(localStorage.getItem('ts_vol') ?? 0.7);
    this.last = new Map();
    this.budget = 0; this.budgetT = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }
  setVolume(v) { this.volume = v; localStorage.setItem('ts_vol', String(v)); if (this.master) this.master.gain.value = v; }
  setCamera(c) { this.camera = c; }

  // output node with distance attenuation + stereo pan
  out(pos, vol = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let v = vol;
    let pan = 0;
    if (pos && this.camera) {
      tmpV.set(pos.x, pos.y ?? 1, pos.z);
      const d = tmpV.distanceTo(this.camera.position);
      v *= 1 / (1 + Math.max(0, d - 4) / 14);
      if (v < 0.02) return null;
      tmpV.sub(this.camera.position).normalize();
      tmpR.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      pan = Math.max(-0.8, Math.min(0.8, tmpV.dot(tmpR)));
    }
    g.gain.value = v;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    return g;
  }
  noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; return s; }
  env(node, t0, a, peak, dec) { node.gain.setValueAtTime(0.0001, t0); node.gain.exponentialRampToValueAtTime(peak, t0 + a); node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec); }
  noiseHit(dest, t, { f = 1200, q = 1, type = 'bandpass', a = 0.002, d = 0.12, v = 0.8, sweepTo = null } = {}) {
    const s = this.noiseSrc(), fl = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (sweepTo) fl.frequency.exponentialRampToValueAtTime(sweepTo, t + a + d);
    this.env(g, t, a, v, d);
    s.connect(fl); fl.connect(g); g.connect(dest);
    s.start(t, Math.random()); s.stop(t + a + d + 0.05);
  }
  tone(dest, t, { f = 440, to = null, type = 'sine', a = 0.005, d = 0.2, v = 0.5 } = {}) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + d);
    this.env(g, t, a, v, d);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + d + 0.05);
  }
  play(name, pos = null, vol = 1) {
    if (!this.ctx || this.volume <= 0) return;
    const now = this.ctx.currentTime;
    const minGap = { tick: 0.03, sentry: 0.05, spikes: 0.2, hit: 0.04, troop: 0.08, laser: 0.15 }[name] ?? 0.025;
    if (now - (this.last.get(name) || 0) < minGap) return;
    if (now - this.budgetT > 0.1) { this.budgetT = now; this.budget = 0; }
    if (++this.budget > 14) return;
    this.last.set(name, now);
    const out = this.out(pos, vol);
    if (!out) return;
    const t = now + 0.005;
    switch (name) {
      case 'pistol': this.noiseHit(out, t, { f: 1800, q: 0.8, d: 0.1, v: 0.7 }); this.tone(out, t, { f: 180, to: 60, d: 0.08, v: 0.6 }); break;
      case 'smg': this.noiseHit(out, t, { f: 2400, q: 1, d: 0.06, v: 0.55 }); this.tone(out, t, { f: 220, to: 90, d: 0.05, v: 0.4 }); break;
      case 'rifle': this.noiseHit(out, t, { f: 1500, q: 0.7, d: 0.11, v: 0.75 }); this.tone(out, t, { f: 150, to: 50, d: 0.09, v: 0.6 }); break;
      case 'shotgun': this.noiseHit(out, t, { f: 900, q: 0.5, d: 0.28, v: 1 }); this.tone(out, t, { f: 110, to: 40, d: 0.2, v: 0.8 }); break;
      case 'sniper': this.noiseHit(out, t, { f: 2600, q: 0.6, d: 0.06, v: 1 }); this.noiseHit(out, t + 0.02, { f: 600, type: 'lowpass', d: 0.6, v: 0.5 }); break;
      case 'rocket': this.noiseHit(out, t, { f: 400, type: 'lowpass', a: 0.02, d: 0.5, v: 0.8, sweepTo: 2500 }); break;
      case 'minigun': this.noiseHit(out, t, { f: 2000, q: 1.2, d: 0.04, v: 0.45 }); break;
      case 'railgun': this.tone(out, t, { f: 2400, to: 120, type: 'sawtooth', d: 0.35, v: 0.35 }); this.noiseHit(out, t, { f: 3000, d: 0.15, v: 0.6 }); break;
      case 'plasma': this.tone(out, t, { f: 300, to: 1400, type: 'square', d: 0.09, v: 0.22 }); break;
      case 'launcher': this.tone(out, t, { f: 160, to: 70, d: 0.12, v: 0.8 }); this.noiseHit(out, t, { f: 500, type: 'lowpass', d: 0.15, v: 0.5 }); break;
      case 'disruptor': this.tone(out, t, { f: 900, to: 300, type: 'sawtooth', d: 0.07, v: 0.25 }); this.noiseHit(out, t, { f: 4000, q: 2, d: 0.05, v: 0.3 }); break;
      case 'dry': this.tone(out, t, { f: 1200, type: 'square', d: 0.03, v: 0.15 }); break;
      case 'reload': this.noiseHit(out, t, { f: 3000, q: 3, d: 0.05, v: 0.3 }); this.noiseHit(out, t + 0.25, { f: 2200, q: 3, d: 0.06, v: 0.35 }); break;
      case 'throw': this.noiseHit(out, t, { f: 800, q: 0.8, a: 0.02, d: 0.15, v: 0.3, sweepTo: 2000 }); break;
      case 'explosion': this.noiseHit(out, t, { f: 900, type: 'lowpass', a: 0.005, d: 0.9, v: 1.2, sweepTo: 80 }); this.tone(out, t, { f: 90, to: 30, d: 0.6, v: 0.9 }); break;
      case 'smallboom': this.noiseHit(out, t, { f: 1200, type: 'lowpass', d: 0.35, v: 0.8, sweepTo: 150 }); break;
      case 'emp': this.tone(out, t, { f: 1600, to: 60, type: 'sawtooth', d: 0.6, v: 0.4 }); this.noiseHit(out, t, { f: 3000, q: 4, d: 0.4, v: 0.4 }); break;
      case 'sentry': this.noiseHit(out, t, { f: 2600, q: 1.5, d: 0.04, v: 0.35 }); break;
      case 'cannon': this.tone(out, t, { f: 120, to: 45, d: 0.25, v: 0.8 }); this.noiseHit(out, t, { f: 700, type: 'lowpass', d: 0.25, v: 0.6 }); break;
      case 'mortar': this.tone(out, t, { f: 90, to: 50, d: 0.2, v: 0.7 }); this.noiseHit(out, t + 0.02, { f: 400, type: 'lowpass', d: 0.2, v: 0.4 }); break;
      case 'tesla': this.noiseHit(out, t, { f: 5000, q: 6, d: 0.18, v: 0.45 }); this.tone(out, t, { f: 120, type: 'sawtooth', d: 0.18, v: 0.25 }); break;
      case 'frost': this.tone(out, t, { f: 1800, to: 2600, d: 0.25, v: 0.12 }); this.tone(out, t + 0.04, { f: 2400, to: 3200, d: 0.2, v: 0.08 }); break;
      case 'snipertower': this.noiseHit(out, t, { f: 2200, q: 0.6, d: 0.08, v: 0.8 }); break;
      case 'missile': this.noiseHit(out, t, { f: 600, q: 0.7, a: 0.03, d: 0.4, v: 0.45, sweepTo: 2000 }); break;
      case 'laser': this.tone(out, t, { f: 520, to: 560, type: 'sawtooth', d: 0.15, v: 0.08 }); break;
      case 'flame': this.noiseHit(out, t, { f: 500, q: 0.4, a: 0.03, d: 0.25, v: 0.2 }); break;
      case 'core': this.tone(out, t, { f: 700, to: 400, type: 'triangle', d: 0.1, v: 0.2 }); break;
      case 'troop': this.noiseHit(out, t, { f: 2200, q: 1, d: 0.04, v: 0.25 }); break;
      case 'hit': this.tone(out, t, { f: 1800, type: 'triangle', d: 0.05, v: 0.25 }); break;
      case 'disable': this.tone(out, t, { f: 900, to: 90, type: 'sawtooth', d: 0.6, v: 0.3 }); this.noiseHit(out, t, { f: 3000, q: 3, d: 0.3, v: 0.3 }); break;
      case 'reboot': this.tone(out, t, { f: 120, to: 900, type: 'square', d: 0.5, v: 0.15 }); break;
      case 'build': this.tone(out, t, { f: 300, to: 600, type: 'triangle', d: 0.12, v: 0.3 }); this.noiseHit(out, t + 0.05, { f: 1500, q: 2, d: 0.08, v: 0.3 }); break;
      case 'sell': this.tone(out, t, { f: 600, to: 300, type: 'triangle', d: 0.15, v: 0.3 }); break;
      case 'coin': this.tone(out, t, { f: 1320, type: 'square', d: 0.06, v: 0.12 }); this.tone(out, t + 0.06, { f: 1760, type: 'square', d: 0.12, v: 0.12 }); break;
      case 'buy': this.tone(out, t, { f: 880, type: 'triangle', d: 0.08, v: 0.25 }); this.tone(out, t + 0.07, { f: 1320, type: 'triangle', d: 0.15, v: 0.25 }); break;
      case 'error': this.tone(out, t, { f: 180, type: 'square', d: 0.15, v: 0.15 }); break;
      case 'click': this.tone(out, t, { f: 1000, type: 'triangle', d: 0.03, v: 0.15 }); break;
      case 'correct': [523, 659, 784, 1047].forEach((f, i) => this.tone(out, t + i * 0.07, { f, type: 'triangle', d: 0.18, v: 0.3 })); break;
      case 'wrong': this.tone(out, t, { f: 220, type: 'sawtooth', d: 0.18, v: 0.2 }); this.tone(out, t + 0.16, { f: 160, type: 'sawtooth', d: 0.3, v: 0.2 }); break;
      case 'horn': this.tone(out, t, { f: 220, type: 'sawtooth', a: 0.05, d: 0.5, v: 0.25 }); this.tone(out, t, { f: 330, type: 'sawtooth', a: 0.05, d: 0.5, v: 0.18 }); this.tone(out, t + 0.5, { f: 440, type: 'sawtooth', a: 0.05, d: 0.7, v: 0.22 }); break;
      case 'alarm': for (let i = 0; i < 3; i++) this.tone(out, t + i * 0.3, { f: 880, to: 660, type: 'square', d: 0.25, v: 0.15 }); break;
      case 'basehit': this.tone(out, t, { f: 70, to: 40, d: 0.25, v: 0.5 }); break;
      case 'death': this.tone(out, t, { f: 400, to: 80, type: 'triangle', d: 0.5, v: 0.35 }); break;
      case 'checkpoint': [392, 523, 659, 784].forEach((f, i) => this.tone(out, t + i * 0.1, { f, type: 'square', d: 0.2, v: 0.12 })); break;
      case 'step': this.noiseHit(out, t, { f: 500, q: 1, d: 0.05, v: 0.12 }); break;
      case 'jump': this.noiseHit(out, t, { f: 700, q: 1, d: 0.08, v: 0.15 }); break;
      case 'heal': this.tone(out, t, { f: 600, to: 1200, type: 'sine', d: 0.4, v: 0.18 }); break;
      case 'shielded': this.tone(out, t, { f: 2000, to: 1500, type: 'sine', d: 0.12, v: 0.15 }); break;
      default: this.tone(out, t, { f: 600, d: 0.08, v: 0.15 });
    }
  }
  startAmbience() {
    const ctx = this.ctx;
    const s = this.noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 380; g.gain.value = 0.035;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.08; lg.gain.value = 0.02; lfo.connect(lg); lg.connect(g.gain);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(); lfo.start();
    const chirp = () => {
      if (!this.ctx) return;
      if (this.volume > 0 && Math.random() < 0.7) {
        const t = ctx.currentTime, base = 2400 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 4);
        const out = this.master;
        const gg = ctx.createGain(); gg.gain.value = 0.05; gg.connect(out);
        for (let i = 0; i < n; i++) this.tone(gg, t + i * 0.11, { f: base, to: base * (1.2 + Math.random() * 0.3), d: 0.07, v: 0.5 });
      }
      setTimeout(chirp, 3000 + Math.random() * 7000);
    };
    setTimeout(chirp, 2000);
  }
}
