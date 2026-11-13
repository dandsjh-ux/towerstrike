// Visual effects: voxel particles, tracers, beams, lightning, explosions, flashes and floating text.
import * as THREE from 'three';

const MAX_P = 3500;
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

class ParticlePool {
  constructor(scene, additive) {
    const mat = additive
      ? new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
      : new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.95 });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX_P);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.p = [];
    this.additive = additive;
  }
  add(o) { if (this.p.length < MAX_P) this.p.push(o); else this.p[Math.floor(Math.random() * MAX_P)] = o; }
  update(dt) {
    const arr = this.p;
    let n = 0;
    for (let i = 0; i < arr.length; i++) {
      const q = arr[i];
      q.life -= dt;
      if (q.life <= 0) continue;
      q.vy -= q.g * dt;
      const dr = Math.pow(q.drag, dt);
      q.vx *= dr; q.vy *= dr; q.vz *= dr;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < q.floor) { q.y = q.floor; q.vy *= -0.3; q.vx *= 0.6; q.vz *= 0.6; }
      const f = q.life / q.max;
      // additive particles fade via colour; solid ones (smoke/debris) shrink away instead of turning black
      const tail = this.additive ? 1 : Math.min(1, f * 3.5);
      const s = q.size * (q.grow ? (1 + (1 - f) * q.grow) : (0.3 + 0.7 * f)) * tail;
      tmpP.set(q.x, q.y, q.z);
      q.rot += q.spin * dt;
      tmpQ.setFromAxisAngle(UP, q.rot);
      tmpS.setScalar(s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.mesh.setMatrixAt(n, tmpM);
      const fade = this.additive && q.fade ? f : 1;
      tmpC.setRGB(q.r * fade, q.gC * fade, q.b * fade);
      this.mesh.setColorAt(n, tmpC);
      arr[n] = q;
      n++;
    }
    arr.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class FX {
  constructor(scene, floatLayer) {
    this.scene = scene;
    this.solid = new ParticlePool(scene, false);
    this.glow = new ParticlePool(scene, true);
    // tracers
    this.maxLines = 400;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxLines * 6), 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.maxLines * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.lineList = [];
    // beams (stretched boxes)
    this.beamGeo = new THREE.BoxGeometry(1, 1, 1);
    this.beams = [];
    // shock rings
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.8, 1, 32);
    // flash lights
    this.lights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffa040, 0, 18, 2); scene.add(l); this.lights.push({ l, t: 0 }); }
    this.floatLayer = floatLayer;
    this.floaters = [];
    this.shakeAmt = 0;
  }
  clear() {
    this.solid.p.length = 0; this.glow.p.length = 0; this.lineList.length = 0;
    for (const b of this.beams) this.scene.remove(b.m);
    this.beams = [];
    for (const r of this.rings) this.scene.remove(r.m);
    this.rings = [];
    for (const f of this.floaters) f.el.remove();
    this.floaters = [];
  }
  part(pool, o) {
    tmpC.setHex(o.color ?? 0xffffff);
    pool.add({ x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, g: o.g ?? 9, drag: o.drag ?? 0.6, life: o.life ?? 1, max: o.life ?? 1,
      size: o.size ?? 0.2, grow: o.grow || 0, r: tmpC.r, gC: tmpC.g, b: tmpC.b, fade: o.fade ?? true, floor: o.floor ?? -50, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 6 });
  }
  burst(x, y, z, n, color, speed = 6, opt = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.2) * Math.PI * 0.6;
      const s = speed * (0.4 + Math.random() * 0.8);
      const col = Array.isArray(color) ? color[Math.floor(Math.random() * color.length)] : color;
      this.part(opt.glow ? this.glow : this.solid, { x, y, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + (opt.up || 2), vz: Math.sin(a) * Math.cos(e) * s, color: col, size: opt.size ?? 0.2, life: (opt.life ?? 0.7) * (0.6 + Math.random() * 0.8), g: opt.g ?? 14, drag: opt.drag ?? 0.5, floor: opt.floor ?? 0.02, grow: opt.grow });
    }
  }
  tracer(a, b, color = 0xffe08a, life = 0.07) { this.lineList.push({ a: a.clone ? a.clone() : new THREE.Vector3(a.x, a.y, a.z), b: b.clone ? b.clone() : new THREE.Vector3(b.x, b.y, b.z), color: new THREE.Color(color), life, max: life }); }
  lightning(points, color = 0x9ff8ff, life = 0.18) {
    for (let k = 0; k < 2; k++) for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      let prev = new THREE.Vector3(a.x, a.y, a.z);
      const segs = 6;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const p = new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
        if (s < segs) p.add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2));
        this.lineList.push({ a: prev, b: p.clone(), color: new THREE.Color(color), life, max: life });
        prev = p;
      }
    }
    for (const p of points.slice(1)) this.burst(p.x, p.y, p.z, 6, [0x9ff8ff, 0xffffff], 4, { glow: true, life: 0.3, size: 0.12 });
  }
  beam(a, b, color, width = 0.18, life = 0.06) {
    const m = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const va = new THREE.Vector3(a.x, a.y, a.z), vb = new THREE.Vector3(b.x, b.y, b.z);
    const len = va.distanceTo(vb);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.lookAt(vb);
    m.scale.set(width, width, len);
    this.scene.add(m);
    this.beams.push({ m, life, max: life, width });
  }
  ring(x, y, z, radius, color = 0xffffff, life = 0.5) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
    this.scene.add(m);
    this.rings.push({ m, life, max: life, radius });
  }
  flash(x, y, z, color = 0xffa040, intensity = 60, life = 0.25) {
    const L = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    L.l.position.set(x, y, z); L.l.color.setHex(color); L.l.intensity = intensity; L.t = life; L.max = life; L.i0 = intensity;
  }
  muzzle(p, color = 0xffd070) {
    this.burst(p.x, p.y, p.z, 3, [color, 0xffffff], 2, { glow: true, life: 0.06, size: 0.12, g: 0, up: 0 });
  }
  impact(p, color = 0xffe0a0, big = false) {
    this.burst(p.x, p.y, p.z, big ? 10 : 5, [color, 0xffffff], big ? 7 : 5, { glow: true, life: 0.25, size: 0.09 });
    this.burst(p.x, p.y, p.z, big ? 4 : 2, [0x777777, 0x555555], 3, { life: 0.5, size: 0.12 });
  }
  explosion(x, y, z, r = 4, kind = 'shell') {
    const emp = kind === 'emp';
    const fireCols = emp ? [0x6fd3ff, 0xbff4ff, 0x4aa8ff] : kind === 'plasma' ? [0xd090ff, 0xffffff, 0xb060ff] : [0xffd34d, 0xff8a2a, 0xff5020, 0xffffff];
    const n = Math.min(70, 14 + r * 8);
    this.burst(x, y + 0.3, z, n, fireCols, r * 2.2, { glow: true, life: 0.55, size: 0.35 + r * 0.04, g: 4, drag: 0.25 });
    if (!emp && kind !== 'plasma') {
      this.burst(x, y + 0.3, z, Math.floor(n * 0.6), [0x3a3a3a, 0x5a5550, 0x7a6a55], r * 2.5, { life: 1.4, size: 0.22, g: 16, drag: 0.6 });
      for (let i = 0; i < Math.min(14, r * 3); i++) this.part(this.solid, { x: x + (Math.random() - 0.5) * r, y: y + 0.5, z: z + (Math.random() - 0.5) * r, vx: (Math.random() - 0.5) * 1.5, vy: 1.5 + Math.random() * 2, vz: (Math.random() - 0.5) * 1.5, color: 0x6a6a6a, size: 0.9 + Math.random() * 0.8, grow: 2.2, life: 1.6 + Math.random(), g: -0.4, drag: 0.5 });
    }
    this.ring(x, Math.max(0.1, y - 0.2), z, r * 1.2, emp ? 0x6fd3ff : 0xffb060, 0.45);
    this.flash(x, y + 1.5, z, emp ? 0x6fd3ff : 0xffa040, 40 + r * 12, 0.3);
  }
  smokePuffs(x, z, r) {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r;
      this.part(this.solid, { x: x + Math.cos(a) * d, y: 0.6 + Math.random() * 2.5, z: z + Math.sin(a) * d, vx: (Math.random() - 0.5) * 0.6, vy: 0.25, vz: (Math.random() - 0.5) * 0.6, color: Math.random() < 0.5 ? 0xd8d8d8 : 0xbdbdbd, size: 1.6 + Math.random() * 1.6, grow: 0.6, life: 1.6 + Math.random() * 1.2, g: 0, drag: 0.8 });
    }
  }
  flame(a, b) {
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
      const len = d.length(); d.normalize();
      const s = 9 + Math.random() * 6;
      this.part(this.glow, { x: a.x, y: a.y, z: a.z, vx: d.x * s + (Math.random() - 0.5) * 2.5, vy: d.y * s + (Math.random() - 0.2) * 2, vz: d.z * s + (Math.random() - 0.5) * 2.5, color: [0xffd34d, 0xff8a2a, 0xff4020][Math.floor(Math.random() * 3)], size: 0.35, grow: 1.6, life: Math.min(0.6, len / s + 0.1), g: -2, drag: 0.7 });
    }
  }
  float(text, pos, cls = 'dmg', life = 1.1) {
    if (this.floaters.length > 40) { const f = this.floaters.shift(); f.el.remove(); }
    const el = document.createElement('div');
    el.className = 'floater ' + cls;
    el.textContent = text;
    this.floatLayer.appendChild(el);
    this.floaters.push({ el, pos: new THREE.Vector3(pos.x, pos.y, pos.z), life, max: life, vy: 1.2 });
  }
  shake(a) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }
  update(dt, camera) {
    this.solid.update(dt);
    this.glow.update(dt);
    // tracers
    const pos = this.lines.geometry.attributes.position, col = this.lines.geometry.attributes.color;
    let n = 0;
    const L = this.lineList;
    for (let i = 0; i < L.length && n < this.maxLines; i++) {
      const t = L[i];
      t.life -= dt;
      if (t.life <= 0) continue;
      const f = t.life / t.max;
      pos.setXYZ(n * 2, t.a.x, t.a.y, t.a.z); pos.setXYZ(n * 2 + 1, t.b.x, t.b.y, t.b.z);
      col.setXYZ(n * 2, t.color.r * f, t.color.g * f, t.color.b * f); col.setXYZ(n * 2 + 1, t.color.r * f, t.color.g * f, t.color.b * f);
      L[n] = t; n++;
    }
    L.length = n;
    this.lines.geometry.setDrawRange(0, n * 2);
    pos.needsUpdate = true; col.needsUpdate = true;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]; b.life -= dt;
      if (b.life <= 0) { this.scene.remove(b.m); b.m.material.dispose(); this.beams.splice(i, 1); continue; }
      const f = b.life / b.max; b.m.material.opacity = f; b.m.scale.x = b.m.scale.y = b.width * (0.5 + 0.5 * f);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.life -= dt;
      if (r.life <= 0) { this.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); continue; }
      const f = 1 - r.life / r.max; r.m.scale.setScalar(0.3 + f * r.radius); r.m.material.opacity = 1 - f;
    }
    for (const L2 of this.lights) { if (L2.t > 0) { L2.t -= dt; L2.l.intensity = Math.max(0, L2.i0 * (L2.t / L2.max)); } else L2.l.intensity = 0; }
    // floaters
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      if (f.life <= 0) { f.el.remove(); this.floaters.splice(i, 1); continue; }
      f.pos.y += f.vy * dt;
      tmpP.copy(f.pos).project(camera);
      if (tmpP.z > 1 || tmpP.z < -1) { f.el.style.opacity = 0; continue; }
      f.el.style.opacity = Math.min(1, f.life / f.max * 2);
      f.el.style.transform = `translate(-50%,-50%) translate(${((tmpP.x + 1) / 2) * w}px, ${((1 - tmpP.y) / 2) * h}px)`;
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
  }
}
