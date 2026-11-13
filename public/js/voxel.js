// Voxel geometry builder + every model in the game, built from boxes with baked vertex colours.
import * as THREE from 'three';

const FACES = [
  { n: [0, 1, 0], c: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]], s: 1.0 },
  { n: [0, -1, 0], c: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]], s: 0.72 },
  { n: [1, 0, 0], c: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]], s: 0.9 },
  { n: [-1, 0, 0], c: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]], s: 0.9 },
  { n: [0, 0, 1], c: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]], s: 0.95 },
  { n: [0, 0, -1], c: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]], s: 0.95 },
];
const tmpC = new THREE.Color();

export class VB {
  constructor(seed = 1) { this.p = []; this.n = []; this.c = []; this.seed = seed >>> 0 || 1; }
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  // Box centred at (cx,cy,cz) with size (sx,sy,sz). skip: bitmask of faces to omit (1 top,2 bottom,4 +x,8 -x,16 +z,32 -z)
  box(cx, cy, cz, sx, sy, sz, color, jitter = 0.05, skip = 0) {
    tmpC.setHex(color);
    const j = 1 + (this.rnd() - 0.5) * 2 * jitter;
    const r = tmpC.r * j, g = tmpC.g * j, b = tmpC.b * j;
    for (let f = 0; f < 6; f++) {
      if (skip & (1 << f)) continue;
      const F = FACES[f];
      const v = F.c.map(([x, y, z]) => [cx + x * sx, cy + y * sy, cz + z * sz]);
      for (const k of [0, 1, 2, 0, 2, 3]) {
        this.p.push(v[k][0], v[k][1], v[k][2]);
        this.n.push(F.n[0], F.n[1], F.n[2]);
        this.c.push(r * F.s, g * F.s, b * F.s);
      }
    }
    return this;
  }
  // Box from min/max corners
  span(x0, y0, z0, x1, y1, z1, color, jitter, skip) { return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color, jitter, skip); }
  get empty() { return this.p.length === 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

export const MAT = {
  std: new THREE.MeshLambertMaterial({ vertexColors: true }),
  dim: new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x4a4a55 }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  ghost: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false }),
  cloak: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.18, depthWrite: false, color: 0x99ccff }),
};

export function meshOf(vb, mat = MAT.std, shadow = true) {
  const m = new THREE.Mesh(vb.geometry(), mat);
  m.castShadow = shadow; m.receiveShadow = shadow;
  return m;
}
function addTo(group, vb, mat, shadow = true) { if (!vb.empty) group.add(meshOf(vb, mat, shadow)); }

// ---------------------------------------------------------------- palette
export const C = {
  stone: 0x9a978f, stoneD: 0x6f6c66, stoneL: 0xc4c0b6, steel: 0x7b8794, steelD: 0x4a525c, dark: 0x2a2e33, black: 0x15171a,
  wood: 0x8a5a33, woodL: 0xb07c4a, plank: 0x9c6b3e, def: 0x3d8fe0, defL: 0x7cc0ff, str: 0xff7a2a, strD: 0xb4501a,
  red: 0xd23a2a, orange: 0xff8c2a, yellow: 0xf2c230, olive: 0x6b7a3a, oliveD: 0x4d5a28, green: 0x3e9a46, white: 0xeef0f2,
  ice: 0x9fdcf5, iceD: 0x5aaed6, copper: 0xc7773a, gold: 0xffcc33, brass: 0xc9a23a, cream: 0xe8dcc0, skin: 0xe0b08a,
};
const LEVEL_TRIM = [0, 0x8a6a4a, 0xd0d6de, 0xffcf40];

// ---------------------------------------------------------------- towers
// Each returns { group, head, muzzle(Object3D), spin(bool) }. Head faces -Z at yaw 0.
export function buildTower(type, level = 1) {
  const group = new THREE.Group();
  const head = new THREE.Group();
  const muzzle = new THREE.Object3D();
  const b = new VB(type.length * 97 + level), g = new VB(7), hb = new VB(11), hg = new VB(13);
  let headY = 2, spin = false;
  const pedestal = (h = 0.5, w = 2.6) => {
    b.box(0, h / 2, 0, w, h, w, C.stoneD, 0.03);
    b.box(0, h + 0.05, 0, w - 0.2, 0.1, w - 0.2, LEVEL_TRIM[level], 0.02);
    for (let i = 1; i < level; i++) b.box(-w / 2 + 0.25 + i * 0.3, h * 0.55, w / 2 + 0.01, 0.18, 0.18, 0.04, 0xffe27a, 0);
  };
  switch (type) {
    case 'sentry':
      pedestal();
      b.box(0, 1.1, 0, 1.3, 1.1, 1.3, C.steel);
      b.box(0.75, 1.0, 0, 0.3, 0.6, 0.8, C.olive);
      headY = 1.95;
      hb.box(0, 0.35, 0, 1.25, 0.7, 1.15, C.def);
      hb.box(0, 0.75, 0.1, 0.8, 0.12, 0.7, C.defL);
      hb.box(-0.26, 0.35, -0.95, 0.18, 0.18, 1.05, C.dark);
      hb.box(0.26, 0.35, -0.95, 0.18, 0.18, 1.05, C.dark);
      hg.box(0, 0.5, -0.6, 0.5, 0.12, 0.05, 0xff3030);
      muzzle.position.set(0, 0.35, -1.55);
      break;
    case 'cannon':
      pedestal();
      b.box(0, 0.85, 0, 1.9, 0.6, 1.9, C.stoneL);
      b.box(0, 1.35, 0, 1.5, 0.4, 1.5, C.stone);
      headY = 1.6;
      hb.box(0, 0.45, 0, 1.4, 0.9, 1.4, C.steelD);
      hb.box(0, 0.5, -1.05, 0.6, 0.6, 1.5, C.dark);
      hb.box(0, 0.5, -1.8, 0.75, 0.75, 0.2, C.brass);
      hb.box(0, 0.95, 0.2, 0.5, 0.15, 0.5, C.brass);
      muzzle.position.set(0, 0.5, -1.95);
      break;
    case 'frost':
      pedestal();
      b.box(0, 1.1, 0, 1.6, 1.2, 1.6, C.iceD);
      b.box(0, 2.1, 0, 1.15, 0.9, 1.15, C.ice);
      b.box(0, 2.85, 0, 0.75, 0.6, 0.75, 0xd9f4ff);
      for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) b.box(x * 0.85, 1.9, z * 0.85, 0.25, 1.0, 0.25, C.ice);
      headY = 3.75; spin = true;
      hg.box(0, 0, 0, 0.55, 1.0, 0.55, 0xa8f2ff);
      hg.box(0, 0, 0, 0.9, 0.3, 0.3, 0xd0faff);
      hg.box(0, 0, 0, 0.3, 0.3, 0.9, 0xd0faff);
      break;
    case 'tesla':
      pedestal();
      for (let i = 0; i < 6; i++) b.box(0, 0.75 + i * 0.5, 0, i % 2 ? 1.05 : 0.7, 0.35, i % 2 ? 1.05 : 0.7, i % 2 ? C.copper : C.dark);
      b.box(0, 3.75, 0, 0.35, 0.6, 0.35, C.dark);
      headY = 4.3; spin = true;
      hg.box(0, 0, 0, 0.85, 0.85, 0.85, 0x7ff8ff);
      hb.box(0, 0, 0, 1.25, 0.18, 0.18, C.copper);
      hb.box(0, 0, 0, 0.18, 0.18, 1.25, C.copper);
      break;
    case 'sniper':
      b.box(0, 0.15, 0, 2.6, 0.3, 2.6, C.stoneD);
      for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) b.box(x * 0.95, 2.35, z * 0.95, 0.28, 4.4, 0.28, C.wood);
      b.box(0, 1.6, 0.95, 2.0, 0.15, 0.15, C.woodL); b.box(0, 1.6, -0.95, 2.0, 0.15, 0.15, C.woodL);
      b.box(0.95, 3.0, 0, 0.15, 0.15, 2.0, C.woodL); b.box(-0.95, 3.0, 0, 0.15, 0.15, 2.0, C.woodL);
      b.box(0, 4.55, 0, 2.5, 0.22, 2.5, C.plank);
      b.box(0, 4.9, 1.2, 2.5, 0.5, 0.1, C.wood); b.box(1.2, 4.9, 0, 0.1, 0.5, 2.5, C.wood); b.box(-1.2, 4.9, 0, 0.1, 0.5, 2.5, C.wood);
      for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) b.box(x * 1.15, 5.45, z * 1.15, 0.12, 1.0, 0.12, C.wood);
      b.box(0, 6.0, 0, 2.8, 0.2, 2.8, 0xa8402c); b.box(0, 6.2, 0, 1.8, 0.2, 1.8, 0xc04a32);
      b.box(0, 4.55, 1.32, 2.5, 0.08, 0.06, LEVEL_TRIM[level]);
      headY = 4.75;
      hb.box(0, 0.25, 0.1, 0.55, 0.5, 0.6, C.olive);
      hb.box(0, 0.55, 0.15, 0.42, 0.35, 0.42, C.oliveD);
      hb.box(0, 0.3, -1.0, 0.12, 0.12, 1.9, C.dark);
      hb.box(0, 0.45, -0.4, 0.14, 0.14, 0.5, C.black);
      muzzle.position.set(0, 0.3, -1.95);
      break;
    case 'flamer':
      pedestal();
      b.box(0, 0.95, 0, 1.8, 0.8, 1.6, 0xb8321f);
      b.box(-0.6, 1.2, 0.75, 0.5, 1.2, 0.5, C.orange); b.box(0.6, 1.2, 0.75, 0.5, 1.2, 0.5, C.orange);
      b.box(0, 1.85, 0.75, 1.5, 0.12, 0.12, C.dark);
      headY = 1.55;
      hb.box(0, 0.3, 0, 0.95, 0.55, 0.95, 0x7a1e12);
      hb.box(0, 0.3, -0.85, 0.35, 0.35, 0.9, C.steel);
      hb.box(0, 0.3, -1.35, 0.48, 0.48, 0.15, C.black);
      hg.box(0, 0.3, -1.44, 0.2, 0.2, 0.04, 0xffa030);
      muzzle.position.set(0, 0.3, -1.45);
      break;
    case 'mortar':
      pedestal();
      b.box(0, 0.8, 0, 2.0, 0.55, 2.0, C.olive);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.box(Math.cos(a) * 1.0, 0.75, Math.sin(a) * 1.0, 0.6, 0.35, 0.45, 0xb9a77a); }
      headY = 1.15;
      hb.box(0, 0.15, 0, 1.0, 0.3, 1.0, C.oliveD);
      { const tube = new VB(5); tube.box(0, 0.75, 0, 0.6, 1.5, 0.6, C.oliveD); tube.box(0, 1.5, 0, 0.72, 0.15, 0.72, C.dark);
        const tm = meshOf(tube); tm.rotation.x = -0.55; tm.position.y = 0.2; head.add(tm); }
      muzzle.position.set(0, 1.6, -0.8);
      break;
    case 'laser':
      pedestal();
      b.box(0, 1.6, 0, 1.0, 2.1, 1.0, C.white);
      b.box(0, 1.0, 0, 1.05, 0.12, 1.05, C.red); b.box(0, 2.2, 0, 1.05, 0.12, 1.05, C.red);
      for (const s of [-1, 1]) b.box(s * 0.62, 1.6, 0, 0.18, 1.6, 0.4, 0xd9dde3);
      headY = 2.85;
      hb.box(0, 0.35, 0, 1.0, 0.65, 1.25, C.white);
      hb.box(0, 0.35, 0.2, 1.4, 0.15, 0.5, 0xd9dde3);
      hg.box(0, 0.35, -0.68, 0.42, 0.42, 0.12, 0xff2a2a);
      muzzle.position.set(0, 0.35, -0.75);
      break;
    case 'missile':
      pedestal();
      b.box(0, 0.95, 0, 1.6, 0.8, 1.6, C.steel);
      headY = 1.55;
      hb.box(0, 0.5, 0, 1.65, 1.05, 1.25, 0x56603a);
      for (const x of [-0.42, 0.42]) for (const y of [0.25, 0.75]) { hb.box(x, y, -0.66, 0.32, 0.32, 0.1, C.dark); hg.box(x, y, -0.6, 0.18, 0.18, 0.06, 0xff4030); }
      muzzle.position.set(0, 0.5, -0.8);
      break;
    case 'shieldgen':
      pedestal();
      b.box(0, 1.5, 0, 0.9, 2.0, 0.9, 0x5a7894);
      b.box(0, 3.3, 0, 1.7, 0.18, 1.7, C.steel);
      for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.box(x * 0.65, 2.6, z * 0.65, x ? 0.12 : 1.2, 0.12, z ? 0.12 : 1.2, 0x66ccff);
      headY = 3.8; spin = true;
      hg.box(0, 0, 0, 0.55, 0.55, 0.55, 0x8fe0ff);
      hb.box(0, 0, 0, 0.9, 0.08, 0.08, C.steel);
      break;
    case 'repair':
      pedestal(0.4);
      b.box(0, 1.05, 0.1, 2.2, 1.2, 1.7, C.cream);
      b.box(0, 1.8, 0.1, 2.45, 0.3, 1.95, C.green);
      b.box(0, 0.85, -0.76, 0.7, 0.9, 0.06, C.dark);
      g.box(0.65, 1.2, -0.77, 0.45, 0.13, 0.04, 0x40ff70); g.box(0.65, 1.2, -0.77, 0.13, 0.45, 0.04, 0x40ff70);
      headY = 1.95;
      hb.box(-0.8, 0.6, 0.6, 0.22, 1.2, 0.22, C.yellow);
      hb.box(-0.8, 1.2, -0.1, 0.22, 0.22, 1.6, C.yellow);
      hb.box(-0.8, 0.95, -0.8, 0.06, 0.5, 0.06, C.dark);
      hb.box(-0.8, 0.65, -0.8, 0.3, 0.15, 0.2, C.steel);
      break;
    case 'radar':
      b.box(0, 0.2, 0, 2.4, 0.4, 2.4, C.stoneD);
      for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { b.box(x * 0.75, 1.5, z * 0.75, 0.18, 2.6, 0.18, C.steel); b.box(x * 0.45, 3.4, z * 0.45, 0.16, 1.4, 0.16, C.steel); }
      for (const y of [1.0, 2.0, 3.0]) { b.box(0, y, 0.75, 1.5, 0.1, 0.1, C.steelD); b.box(0, y, -0.75, 1.5, 0.1, 0.1, C.steelD); }
      b.box(0, 4.1, 0, 1.0, 0.25, 1.0, C.steelD);
      b.box(0, 0.45, 1.22, 2.4, 0.08, 0.06, LEVEL_TRIM[level]);
      headY = 4.3; spin = true;
      hb.box(0, 0.55, -0.1, 2.0, 1.2, 0.18, C.white);
      hb.box(0, 0.55, 0.05, 1.6, 0.9, 0.12, 0xd8dde4);
      hb.box(0, 0.55, -0.6, 0.12, 0.12, 0.9, C.dark);
      hg.box(0, 0.55, -1.05, 0.2, 0.2, 0.2, 0xff4040);
      break;
    case 'goldmine':
      b.box(0, 0.35, 0, 2.8, 0.7, 2.6, 0x7d7466);
      b.box(0, 1.1, 0.4, 2.6, 0.9, 1.6, 0x8a8172); b.box(0.3, 1.7, 0.6, 1.8, 0.5, 1.0, 0x958b7b);
      b.box(-0.85, 1.05, -0.45, 0.3, 1.7, 0.3, C.wood); b.box(0.85, 1.05, -0.45, 0.3, 1.7, 0.3, C.wood);
      b.box(0, 1.95, -0.45, 2.1, 0.3, 0.35, C.wood);
      b.box(0, 0.95, -0.35, 1.4, 1.5, 0.12, C.black);
      b.box(0, 0.75, -1.05, 1.0, 0.5, 0.7, C.steelD);
      g.box(0, 1.05, -1.05, 0.8, 0.22, 0.5, C.gold); g.box(0.15, 1.2, -1.0, 0.35, 0.15, 0.3, 0xffe680);
      g.box(-0.9, 0.85, -1.1, 0.35, 0.3, 0.35, C.gold);
      b.box(0, 0.72, 1.32, 2.8, 0.08, 0.06, LEVEL_TRIM[level]);
      headY = 2.2;
      break;
    case 'spikes':
      b.box(0, 0.06, 0, 3.4, 0.12, 3.4, 0x3a3f45, 0.02);
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { b.box(i * 0.65, 0.3, j * 0.65, 0.16, 0.38, 0.16, C.steel); b.box(i * 0.65, 0.52, j * 0.65, 0.08, 0.12, 0.08, 0xd0d6dd); }
      headY = 0.5;
      break;
    case 'barricade':
      b.box(0, 0.35, 0, 3.9, 0.7, 1.1, C.stoneD);
      b.box(0, 1.05, 0, 3.7, 0.7, 0.95, C.stone);
      b.box(0, 1.75, 0, 3.5, 0.7, 0.85, C.stoneL);
      for (let i = -1.5; i <= 1.5; i += 0.75) b.box(i, 2.35, 0, 0.5, 0.5, 0.7, i % 1.5 === 0 ? C.stone : C.stoneD);
      for (let i = -1.6; i <= 1.6; i += 0.8) { b.box(i, 0.9, -0.75, 0.12, 0.12, 0.7, C.steel); }
      headY = 2.6;
      break;
    case 'mine':
      b.box(0, 0.07, 0, 0.95, 0.14, 0.95, C.oliveD);
      b.box(0, 0.17, 0, 0.6, 0.08, 0.6, C.olive);
      g.box(0, 0.24, 0, 0.18, 0.08, 0.18, 0xff2020);
      headY = 0.3;
      break;
    default:
      pedestal();
  }
  addTo(group, b, MAT.std);
  addTo(group, g, MAT.glow, false);
  head.position.y = headY;
  addTo(head, hb, MAT.std);
  addTo(head, hg, MAT.glow, false);
  head.add(muzzle);
  group.add(head);
  return { group, head, muzzle, spin };
}

// ---------------------------------------------------------------- characters
export function buildSoldier(primary = C.str, accent = 0xffffff, scale = 1, opts = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const legL = new THREE.Group(), legR = new THREE.Group(), arms = new THREE.Group();
  const lb = new VB(3), tb = new VB(5), ab = new VB(9);
  lb.box(0, -0.4, 0, 0.26, 0.8, 0.3, opts.pants || 0x3b3f45); lb.box(0, -0.78, -0.04, 0.28, 0.12, 0.38, C.black);
  const lm = meshOf(lb); legL.add(lm); const rm = meshOf(lb); legR.add(rm);
  legL.position.set(-0.17, 0.85, 0); legR.position.set(0.17, 0.85, 0);
  tb.box(0, 1.2, 0, 0.62, 0.7, 0.36, primary);
  tb.box(0, 1.25, -0.19, 0.5, 0.45, 0.06, opts.vest || 0x2f3338);
  tb.box(0, 0.88, 0, 0.64, 0.1, 0.38, C.black);
  tb.box(0, 1.78, 0, 0.42, 0.42, 0.42, opts.helmet || primary);
  tb.box(0, 1.76, -0.2, 0.34, 0.12, 0.05, 0x99e0ff);
  tb.box(0, 2.0, 0, 0.46, 0.08, 0.46, accent);
  if (opts.backpack) tb.box(0, 1.2, 0.27, 0.5, 0.55, 0.22, opts.backpack);
  ab.box(-0.38, -0.1, -0.2, 0.18, 0.18, 0.55, primary); ab.box(0.38, -0.1, -0.2, 0.18, 0.18, 0.55, primary);
  ab.box(0.1, -0.15, -0.55, 0.14, 0.2, 0.9, C.dark); ab.box(0.1, -0.05, -1.0, 0.08, 0.08, 0.3, C.black);
  arms.add(meshOf(ab)); arms.position.set(0, 1.42, 0);
  body.add(meshOf(tb), legL, legR, arms);
  root.scale.setScalar(scale);
  return { root, body, legL, legR, arms };
}

export function buildTroop(type) {
  const root = new THREE.Group();
  const parts = { root, spin: [] };
  if (type === 'grunts') { const s = buildSoldier(0x5f6b45, 0xd6c27a, 0.82, { helmet: 0x4d5a28 }); root.add(s.root); Object.assign(parts, s, { root }); }
  else if (type === 'bearer') {
    const s = buildSoldier(0x50607a, 0x9fb6d6, 1.1, { helmet: 0x3a475c });
    const sh = new VB(2); sh.box(0, 1.1, -0.65, 1.2, 1.8, 0.15, 0x8aa0bf); sh.box(0, 1.1, -0.74, 0.9, 1.4, 0.05, 0xb8c8e0); sh.box(0, 1.6, -0.75, 0.6, 0.1, 0.06, 0x3a475c);
    s.body.add(meshOf(sh)); root.add(s.root); Object.assign(parts, s, { root });
  } else if (type === 'sapper') {
    const s = buildSoldier(0x7a5a3a, 0xff4030, 0.9, { backpack: 0xc0302a, helmet: 0x5a4028 });
    root.add(s.root); Object.assign(parts, s, { root });
  } else if (type === 'drone') {
    const b = new VB(4), gl = new VB(6);
    b.box(0, 0, 0, 0.8, 0.3, 0.8, 0x3a4048); b.box(0, -0.2, -0.2, 0.25, 0.2, 0.4, C.dark);
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) b.box(x * 0.55, 0.05, z * 0.55, 0.7, 0.08, 0.08, C.steel).box(x * 0.55, 0.05, z * 0.55, 0.08, 0.08, 0.7, C.steel);
    gl.box(0, 0.05, -0.41, 0.3, 0.1, 0.02, 0xff8030);
    root.add(meshOf(b), meshOf(gl, MAT.glow, false));
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const r = new VB(8); r.box(0, 0, 0, 0.7, 0.03, 0.1, 0x222222); const m = meshOf(r, MAT.std, false); m.position.set(x * 0.8, 0.18, z * 0.8); root.add(m); parts.spin.push(m);
    }
  } else if (type === 'medic') {
    const b = new VB(4), gl = new VB(6);
    b.box(0, 0, 0, 0.9, 0.7, 0.9, C.white); b.box(0, 0.42, 0, 0.6, 0.14, 0.6, 0xd0d4da); b.box(0, -0.42, 0, 0.5, 0.14, 0.5, C.steel);
    gl.box(0, 0, -0.46, 0.5, 0.14, 0.02, 0xff3040); gl.box(0, 0, -0.46, 0.14, 0.5, 0.02, 0xff3040);
    gl.box(0, -0.55, 0, 0.35, 0.05, 0.35, 0x60ff90);
    root.add(meshOf(b), meshOf(gl, MAT.glow, false));
  } else if (type === 'mech') {
    const b = new VB(4), gl = new VB(6);
    const legL = new THREE.Group(), legR = new THREE.Group();
    const lb = new VB(3); lb.box(0, -0.8, 0, 0.45, 1.6, 0.5, 0x5a6470); lb.box(0, -1.65, -0.15, 0.7, 0.2, 1.0, C.dark);
    legL.add(meshOf(lb)); legR.add(meshOf(lb)); legL.position.set(-0.65, 1.8, 0); legR.position.set(0.65, 1.8, 0);
    b.box(0, 2.4, 0, 1.9, 1.2, 1.7, 0x6c7684); b.box(0, 3.1, 0.1, 1.2, 0.4, 1.1, 0x5a6470);
    b.box(-1.15, 2.4, -0.4, 0.4, 0.4, 1.6, C.dark); b.box(1.15, 2.4, -0.4, 0.4, 0.4, 1.6, C.dark);
    b.box(0, 2.0, 0.95, 1.0, 0.8, 0.3, C.strD);
    gl.box(0, 2.6, -0.86, 0.9, 0.15, 0.04, 0xff7030);
    root.add(meshOf(b), meshOf(gl, MAT.glow, false), legL, legR);
    parts.legL = legL; parts.legR = legR;
  }
  return parts;
}

// ---------------------------------------------------------------- base core
export function buildBase() {
  const group = new THREE.Group();
  const b = new VB(77), g = new VB(78);
  b.box(0, 0.4, 0, 9.2, 0.8, 9.2, C.stoneD, 0.02);
  for (const s of [-1, 1]) {
    b.box(s * 3.9, 2.2, 0, 1.0, 2.8, 7.0, C.stone); b.box(0, 2.2, s * 3.9, 7.0, 2.8, 1.0, C.stone);
    for (let i = -3; i <= 3; i += 1.5) { b.box(s * 3.9, 3.85, i, 1.0, 0.5, 0.7, C.stoneL); b.box(i, 3.85, s * 3.9, 0.7, 0.5, 1.0, C.stoneL); }
  }
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    b.box(x * 3.8, 3.0, z * 3.8, 1.9, 6.0, 1.9, C.stoneL);
    b.box(x * 3.8, 6.2, z * 3.8, 2.3, 0.4, 2.3, C.stoneD);
    b.box(x * 3.8, 6.8, z * 3.8, 1.6, 0.8, 1.6, C.def);
    b.box(x * 3.8, 7.4, z * 3.8, 0.9, 0.5, 0.9, C.defL);
    g.box(x * 3.8 - x * 0.96, 4.2, z * 3.8, 0.04, 0.5, 0.25, 0xffe39a);
  }
  b.box(0, 3.6, 0, 4.4, 6.4, 4.4, 0xb3ada0);
  b.box(0, 6.95, 0, 5.0, 0.35, 5.0, C.stoneD);
  for (const s of [-1, 1]) { b.box(s * 2.25, 4.2, 0, 0.1, 2.8, 1.6, C.def); b.box(0, 4.2, s * 2.25, 1.6, 2.8, 0.1, C.def); b.box(s * 2.27, 4.4, 0, 0.06, 0.8, 0.8, C.gold); }
  b.box(0, 1.5, -4.45, 2.0, 2.2, 0.2, C.wood);
  b.box(0, 7.6, 0, 2.6, 1.0, 2.6, C.steelD);
  g.box(0, 8.25, 0, 2.0, 0.15, 2.0, 0x7fd8ff);
  addTo(group, b, MAT.std); addTo(group, g, MAT.glow, false);
  // Crystal core (spins, pulses)
  const crystal = new THREE.Group();
  const cg = new VB(79);
  cg.box(0, 0, 0, 1.4, 2.4, 1.4, 0x6fd3ff); cg.box(0, 0, 0, 2.0, 1.0, 1.0, 0xa8e8ff); cg.box(0, 0, 0, 1.0, 1.0, 2.0, 0xa8e8ff); cg.box(0, 1.4, 0, 0.7, 0.6, 0.7, 0xe0f8ff); cg.box(0, -1.4, 0, 0.7, 0.6, 0.7, 0x3aa0e0);
  crystal.add(meshOf(cg, MAT.glow, false));
  crystal.position.y = 10.0;
  group.add(crystal);
  const light = new THREE.PointLight(0x6fd3ff, 30, 22, 2);
  light.position.y = 10; group.add(light);
  return { group, crystal, light };
}

// ---------------------------------------------------------------- decor pieces (added into a merged builder)
export function addTree(b, x, y, z, rnd, kind) {
  const t = kind ?? Math.floor(rnd() * 4);
  if (t === 0) { // oak
    const h = 2.2 + rnd() * 1.5;
    b.box(x, y + h / 2, z, 0.6, h, 0.6, 0x7a4a26);
    const cols = [0x3f8f35, 0x4ea33e, 0x5bb548];
    const s = 2.6 + rnd() * 1.2;
    b.box(x, y + h + s * 0.35, z, s, s * 0.7, s, cols[0]);
    b.box(x + (rnd() - 0.5), y + h + s * 0.8, z + (rnd() - 0.5), s * 0.7, s * 0.5, s * 0.7, cols[1]);
    b.box(x + (rnd() - 0.5) * 1.2, y + h + s * 0.25, z + (rnd() - 0.5) * 1.2, s * 0.6, s * 0.45, s * 0.6, cols[2]);
  } else if (t === 1) { // pine
    const h = 1.2 + rnd() * 0.8;
    b.box(x, y + h / 2, z, 0.5, h, 0.5, 0x6a3f22);
    const tiers = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < tiers; i++) { const s = 2.6 - i * 0.6; b.box(x, y + h + i * 0.9 + 0.4, z, s, 0.9, s, i % 2 ? 0x2f7a3a : 0x2a6b33); }
  } else if (t === 2) { // birch
    const h = 3 + rnd() * 1.5;
    b.box(x, y + h / 2, z, 0.45, h, 0.45, 0xe8e4d8);
    b.box(x, y + h * 0.4, z - 0.23, 0.46, 0.15, 0.02, 0x333333);
    b.box(x, y + h + 0.6, z, 2.0, 1.6, 2.0, 0x8cc84b); b.box(x + 0.3, y + h + 1.4, z - 0.2, 1.3, 1.0, 1.3, 0xa2d65a);
  } else { // round bush-tree
    const h = 1.5 + rnd();
    b.box(x, y + h / 2, z, 0.5, h, 0.5, 0x7a4a26);
    b.box(x, y + h + 0.9, z, 2.2, 1.8, 2.2, 0x4a9d3c); b.box(x, y + h + 0.9, z, 2.7, 1.1, 1.4, 0x55ad44); b.box(x, y + h + 0.9, z, 1.4, 1.1, 2.7, 0x55ad44);
    if (rnd() < 0.4) for (let i = 0; i < 4; i++) b.box(x + (rnd() - 0.5) * 2.4, y + h + 0.4 + rnd() * 1.5, z + (rnd() - 0.5) * 2.4, 0.22, 0.22, 0.22, 0xe0402a);
  }
}

export function buildWindmill() {
  const group = new THREE.Group();
  const b = new VB(31);
  for (let i = 0; i < 6; i++) { const s = 4.6 - i * 0.35; b.box(0, 0.75 + i * 1.5, 0, s, 1.5, s, i % 2 ? 0xe9e1cf : 0xddd3bd); }
  b.box(0, 9.6, 0, 2.6, 1.0, 2.6, 0xa8402c); b.box(0, 10.4, 0, 1.6, 0.6, 1.6, 0xc04a32);
  b.box(0, 1.2, -2.35, 1.2, 2.2, 0.15, C.wood); b.box(1.2, 5.5, -1.85, 0.7, 0.7, 0.1, 0x6fb8e8); b.box(-1.0, 3.5, -2.05, 0.7, 0.7, 0.1, 0x6fb8e8);
  b.box(0, 8.4, -1.7, 0.6, 0.6, 1.0, C.wood);
  addTo(group, b, MAT.std);
  const blades = new THREE.Group();
  const bb = new VB(33);
  bb.box(0, 0, 0, 0.8, 0.8, 0.5, C.wood);
  for (let i = 0; i < 4; i++) {
    const sail = new VB(34 + i);
    sail.box(0, 2.6, 0, 0.25, 5, 0.12, C.wood);
    sail.box(0.55, 3.0, 0.02, 0.9, 3.6, 0.06, i % 2 ? 0xf0ead8 : 0xe0d6c0);
    const m = meshOf(sail); m.rotation.z = (i * Math.PI) / 2; blades.add(m);
  }
  blades.add(meshOf(bb));
  blades.position.set(0, 8.4, -2.3);
  group.add(blades);
  return { group, blades };
}

export function buildSheep() {
  const root = new THREE.Group();
  const b = new VB(41);
  b.box(0, 0.75, 0, 0.8, 0.6, 1.2, 0xf4f2ec); b.box(0, 1.0, 0.1, 0.7, 0.3, 0.9, 0xffffff);
  b.box(0, 0.85, -0.72, 0.42, 0.42, 0.38, 0x2a2622); b.box(0, 1.1, -0.68, 0.46, 0.14, 0.3, 0xf4f2ec);
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) b.box(x * 0.25, 0.25, z * 0.4, 0.16, 0.5, 0.16, 0x2a2622);
  root.add(meshOf(b));
  return root;
}

export function buildFlag(color = 0xffffff) {
  const group = new THREE.Group();
  const b = new VB(51);
  b.box(0, 0.15, 0, 1.6, 0.3, 1.6, C.stoneD); b.box(0, 3.0, 0, 0.18, 5.8, 0.18, 0xdddddd); b.box(0, 5.95, 0, 0.3, 0.3, 0.3, C.gold);
  addTo(group, b, MAT.std);
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.06), new THREE.MeshLambertMaterial({ color }));
  cloth.position.set(0.85, 5.2, 0); cloth.castShadow = true;
  group.add(cloth);
  return { group, cloth };
}

// ---------------------------------------------------------------- first-person weapons & projectiles
export function buildViewWeapon(id, sleeve = C.str) {
  const group = new THREE.Group();
  // forearms + gloves holding the weapon
  const arms = new VB(77);
  arms.box(0.06, -0.2, 0.22, 0.13, 0.13, 0.45, sleeve).box(0.04, -0.13, 0.0, 0.11, 0.12, 0.12, 0x2a2e33);
  if (id !== 'pistol') arms.box(-0.12, -0.17, -0.12, 0.12, 0.12, 0.42, sleeve).box(-0.06, -0.08, -0.32, 0.1, 0.1, 0.12, 0x2a2e33);
  else arms.box(-0.09, -0.19, 0.18, 0.12, 0.12, 0.4, sleeve).box(-0.04, -0.13, -0.02, 0.1, 0.1, 0.1, 0x2a2e33);
  group.add(meshOf(arms, MAT.std, false));
  const b = new VB(id.length * 13), g = new VB(3);
  const body = { pistol: 0x3a3f46, smg: 0x2f3438, rifle: 0x4b5a3a, shotgun: 0x6a4a2e, sniper: 0x3c4a3a, rocket: 0x55603e, minigun: 0x4a4f56, railgun: 0x3a4a66, plasma: 0x4a3a66, launcher: 0x4d5a36, disruptor: 0x2e5a66 }[id] || C.dark;
  switch (id) {
    case 'pistol': b.box(0, 0, -0.15, 0.08, 0.1, 0.3, body).box(0, -0.12, -0.05, 0.07, 0.18, 0.08, C.dark); break;
    case 'smg': b.box(0, 0, -0.2, 0.09, 0.12, 0.45, body).box(0, -0.14, -0.15, 0.06, 0.2, 0.07, C.dark).box(0, 0.0, -0.5, 0.04, 0.04, 0.2, C.black).box(0, 0.08, -0.1, 0.03, 0.04, 0.15, C.dark); break;
    case 'rifle': b.box(0, 0, -0.25, 0.09, 0.13, 0.6, body).box(0, -0.15, -0.25, 0.07, 0.2, 0.09, C.dark).box(0, 0.0, -0.65, 0.05, 0.05, 0.3, C.black).box(0, 0.1, -0.2, 0.05, 0.06, 0.2, C.dark).box(0, -0.03, 0.12, 0.08, 0.12, 0.2, body); break;
    case 'shotgun': b.box(0, 0, -0.3, 0.1, 0.12, 0.7, body).box(0, 0.02, -0.75, 0.07, 0.07, 0.4, C.black).box(0, -0.07, -0.55, 0.08, 0.06, 0.25, 0x3a2a1a); break;
    case 'sniper': b.box(0, 0, -0.3, 0.09, 0.12, 0.8, body).box(0, 0.0, -0.95, 0.04, 0.04, 0.6, C.black).box(0, 0.13, -0.25, 0.07, 0.07, 0.35, C.black).box(0, -0.14, -0.2, 0.06, 0.18, 0.08, C.dark); break;
    case 'rocket': b.box(0, 0.02, -0.3, 0.18, 0.18, 1.0, body).box(0, 0.02, -0.82, 0.22, 0.22, 0.08, C.dark).box(0, -0.15, -0.2, 0.06, 0.18, 0.08, C.dark); g.box(0, 0.02, -0.86, 0.1, 0.1, 0.02, 0xff5030); break;
    case 'minigun': b.box(0, 0, -0.25, 0.16, 0.16, 0.5, body); for (const [x, y] of [[0.05, 0.05], [-0.05, 0.05], [0.05, -0.05], [-0.05, -0.05]]) b.box(x, y, -0.7, 0.04, 0.04, 0.5, C.black); break;
    case 'railgun': b.box(0, 0, -0.3, 0.1, 0.14, 0.8, body).box(0.05, 0.0, -0.8, 0.03, 0.06, 0.5, C.steel).box(-0.05, 0.0, -0.8, 0.03, 0.06, 0.5, C.steel); g.box(0, 0.0, -0.6, 0.04, 0.03, 0.6, 0x6fd3ff); break;
    case 'plasma': b.box(0, 0, -0.25, 0.11, 0.14, 0.6, body).box(0, 0.0, -0.62, 0.08, 0.08, 0.2, C.dark); g.box(0, 0.08, -0.2, 0.05, 0.03, 0.4, 0xc070ff).box(0, 0.0, -0.73, 0.05, 0.05, 0.02, 0xc070ff); break;
    case 'launcher': b.box(0, 0, -0.25, 0.14, 0.14, 0.6, body).box(0, 0.0, -0.4, 0.2, 0.2, 0.2, C.dark).box(0, 0.0, -0.65, 0.1, 0.1, 0.3, C.black); break;
    case 'disruptor': b.box(0, 0, -0.25, 0.1, 0.13, 0.6, body).box(0, 0.0, -0.62, 0.06, 0.06, 0.25, C.dark); g.box(0, 0.06, -0.3, 0.12, 0.02, 0.3, 0x40f0ff); break;
  }
  addTo(group, b, MAT.std, false); addTo(group, g, MAT.glow, false);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, { pistol: -0.32, smg: -0.6, rifle: -0.82, shotgun: -0.95, sniper: -1.25, rocket: -0.86, minigun: -0.95, railgun: -1.05, plasma: -0.75, launcher: -0.8, disruptor: -0.75 }[id] || -0.6);
  group.add(muzzle);
  group.traverse((o) => { if (o.isMesh) { o.renderOrder = 10; o.material = o.material === MAT.glow ? MAT.glow : MAT.std; } });
  return { group, muzzle };
}

export function buildProjectile(kind) {
  const b = new VB(9), g = new VB(10);
  const group = new THREE.Group();
  switch (kind) {
    case 'rocket': b.box(0, 0, 0, 0.18, 0.18, 0.7, 0x55603e); b.box(0, 0, -0.4, 0.12, 0.12, 0.15, C.red); g.box(0, 0, 0.42, 0.14, 0.14, 0.12, 0xffb040); break;
    case 'plasma': g.box(0, 0, 0, 0.32, 0.32, 0.32, 0xd090ff); g.box(0, 0, 0, 0.5, 0.12, 0.12, 0xb060ff); break;
    case 'launcher': b.box(0, 0, 0, 0.22, 0.22, 0.3, 0x4d5a36); g.box(0, 0.12, 0, 0.06, 0.03, 0.06, 0xff3020); break;
    case 'frag': b.box(0, 0, 0, 0.22, 0.26, 0.22, 0x4d5a28); b.box(0, 0.16, 0, 0.08, 0.06, 0.08, C.steel); break;
    case 'emp': b.box(0, 0, 0, 0.24, 0.24, 0.24, 0x2a3a5a); g.box(0, 0, 0, 0.26, 0.08, 0.26, 0x40e0ff); break;
    case 'smoke': b.box(0, 0, 0, 0.18, 0.32, 0.18, 0x9a9a9a); b.box(0, 0.18, 0, 0.12, 0.06, 0.12, 0x555555); break;
    case 'shell': b.box(0, 0, 0, 0.45, 0.45, 0.45, 0x222428); break;
    case 'mortar': b.box(0, 0, 0, 0.35, 0.6, 0.35, 0x3a4228); b.box(0, 0.32, 0, 0.2, 0.15, 0.2, C.brass); break;
    case 'missile': b.box(0, 0, 0, 0.16, 0.16, 0.7, 0xe8e8e8); b.box(0, 0, -0.4, 0.12, 0.12, 0.12, C.red); g.box(0, 0, 0.4, 0.12, 0.12, 0.1, 0xffb040); break;
    default: g.box(0, 0, 0, 0.2, 0.2, 0.2, 0xffffff);
  }
  addTo(group, b, MAT.std, false); addTo(group, g, MAT.glow, false);
  return group;
}

// Distinct colours for strikers
export const PLAYER_COLORS = [0xff7a2a, 0xf2c230, 0xe0407a, 0x40d0a0, 0xa070ff, 0x60b0ff, 0xff5050];
export function playerColor(id) { return PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length]; }
