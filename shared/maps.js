// Battlefield layouts. Strikers are confined to the route (PATH/SPAWN/PLAZA tiles);
// towers go on build pads that hug the route; traps go on the route itself.
import { TILE } from './defs.js';

export const T = { GRASS: 0, PATH: 1, SPAWN: 2, PLAZA: 3, BASE: 4, WATER: 5, DECOR: 6 };

// Waypoints are tile-corner coordinates: the route is 2 tiles (8 m) wide centred on the polyline.
export const MAPS = {
  meadow: {
    name: 'Serpent Meadow',
    desc: 'A long winding trail through open grassland.',
    w: 40, h: 30, seed: 1337,
    waypoints: [[2, 5], [12, 5], [12, 15], [5, 15], [5, 25], [20, 25], [20, 8], [30, 8], [30, 20], [33, 20]],
    spawn: [0, 2, 1, 7],
    plaza: [33, 17, 38, 22],
    water: [{ e: [24.5, 16.5, 1.4, 3.0] }, { e: [35, 27, 3.5, 1.6] }, { e: [16, 1.5, 3, 1.2] }],
    landmarks: [{ type: 'windmill', tx: 34, tz: 3 }],
  },
  riverbend: {
    name: 'Riverbend',
    desc: 'Twin streams split the plains into tight switchbacks.',
    w: 40, h: 30, seed: 4242,
    waypoints: [[2, 24], [10, 24], [10, 6], [22, 6], [22, 24], [31, 24], [31, 10], [34, 10]],
    spawn: [0, 21, 1, 26],
    plaza: [34, 7, 39, 12],
    water: [{ r: [15, 10, 16, 29] }, { r: [26, 0, 27, 19] }, { e: [4, 13, 1.8, 2.5] }],
    landmarks: [{ type: 'windmill', tx: 4, tz: 2 }],
  },
  windmill: {
    name: 'Windmill Hill',
    desc: 'A spiral climb toward a base in the heart of the hill.',
    w: 38, h: 28, seed: 9001,
    waypoints: [[2, 3], [33, 3], [33, 23], [7, 23], [7, 12], [19, 12]],
    spawn: [0, 0, 1, 5],
    plaza: [19, 9, 24, 14],
    water: [{ e: [13, 17, 2.4, 1.3] }],
    landmarks: [{ type: 'windmill', tx: 28, tz: 17 }],
    checkpoints: [0.33, 0.6],
    // Per-team-size map balance (index = strikers - 1): the spiral lets big teams hit towers from several
    // route segments at once, so the defender gets a little more here. Tuned with test/balance-report.js.
    balance: { def: [0.97, 1.03, 1.07, 1.11, 1.15], hp: [1, 1.04, 1.07, 1.1, 1.12] },
  },
};
export const MAP_IDS = Object.keys(MAPS);

const cache = new Map();

export function buildMap(id) {
  if (cache.has(id)) return cache.get(id);
  const def = MAPS[id] || MAPS.meadow;
  const { w, h } = def;
  const n = w * h;
  const tiles = new Uint8Array(n);
  const progress = new Float32Array(n);
  const idx = (x, z) => z * w + x;

  // Route polyline in world units
  const pts = def.waypoints.map(([x, z]) => ({ x: x * TILE, z: z * TILE }));
  const segs = [];
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    segs.push({ a, b, len, start: acc });
    acc += len;
  }
  const pathLen = acc;

  function nearestOnPath(x, z) {
    let best = { d: Infinity, prog: 0, x: 0, z: 0 };
    for (const s of segs) {
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
      let t = ((x - s.a.x) * dx + (z - s.a.z) * dz) / (s.len * s.len);
      t = Math.max(0, Math.min(1, t));
      const px = s.a.x + dx * t, pz = s.a.z + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best.d - 1e-6) best = { d, prog: s.start + s.len * t, x: px, z: pz };
    }
    return best;
  }
  function pointAt(prog) {
    for (const s of segs) {
      if (prog <= s.start + s.len) {
        const t = (prog - s.start) / s.len;
        return { x: s.a.x + (s.b.x - s.a.x) * t, z: s.a.z + (s.b.z - s.a.z) * t };
      }
    }
    return { ...pts[pts.length - 1] };
  }

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const cx = (x + 0.5) * TILE, cz = (z + 0.5) * TILE;
      const np = nearestOnPath(cx, cz);
      if (np.d < TILE - 1e-6) { tiles[idx(x, z)] = T.PATH; progress[idx(x, z)] = np.prog; }
    }
  }
  const fillRect = (r, type) => {
    for (let z = r[1]; z <= r[3]; z++) for (let x = r[0]; x <= r[2]; x++) if (x >= 0 && z >= 0 && x < w && z < h) tiles[idx(x, z)] = type;
  };
  fillRect(def.spawn, T.SPAWN);
  fillRect(def.plaza, T.PLAZA);
  for (let z = def.spawn[1]; z <= def.spawn[3]; z++) for (let x = def.spawn[0]; x <= def.spawn[2]; x++) progress[idx(x, z)] = 0;
  for (let z = def.plaza[1]; z <= def.plaza[3]; z++) for (let x = def.plaza[0]; x <= def.plaza[2]; x++) progress[idx(x, z)] = pathLen + 4;

  // Base core: 2x2 tiles in the middle of the plaza
  const bcx = (def.plaza[0] + def.plaza[2] + 1) / 2, bcz = (def.plaza[1] + def.plaza[3] + 1) / 2;
  const base = { x: bcx * TILE, z: bcz * TILE, half: TILE, height: 11 };
  base.box = { x0: base.x - base.half, x1: base.x + base.half, y0: 0, y1: base.height, z0: base.z - base.half, z1: base.z + base.half };
  for (let z = bcz - 1; z <= bcz; z++) for (let x = bcx - 1; x <= bcx; x++) tiles[idx(x, z)] = T.BASE;

  const isRoute = (t) => t === T.PATH || t === T.SPAWN || t === T.PLAZA || t === T.BASE;

  // Chebyshev distance to the route (BFS, 8-neighbour)
  const distWalk = new Int16Array(n).fill(999);
  const distSpawn = new Int16Array(n).fill(999);
  const bfs = (field, pred) => {
    const q = [];
    for (let i = 0; i < n; i++) if (pred(tiles[i])) { field[i] = 0; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % w, z = (i / w) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const j = idx(nx, nz);
        if (field[j] > field[i] + 1) { field[j] = field[i] + 1; q.push(j); }
      }
    }
  };
  bfs(distWalk, isRoute);
  bfs(distSpawn, (t) => t === T.SPAWN);

  // Water (rectangles r:[x0,z0,x1,z1] or ellipses e:[cx,cz,rx,rz] in tile units), keeping a shore by the route
  for (const wtr of def.water || []) {
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      let inside = false;
      if (wtr.r) inside = x >= wtr.r[0] && x <= wtr.r[2] && z >= wtr.r[1] && z <= wtr.r[3];
      else { const [cx, cz, rx, rz] = wtr.e; const dx = (x + 0.5 - cx) / rx, dz = (z + 0.5 - cz) / rz; inside = dx * dx + dz * dz <= 1; }
      const i = idx(x, z);
      if (inside && tiles[i] === T.GRASS && distWalk[i] > 1) tiles[i] = T.WATER;
    }
  }
  for (const lm of def.landmarks || []) {
    for (let z = lm.tz; z <= lm.tz + 1; z++) for (let x = lm.tx; x <= lm.tx + 1; x++) if (tiles[idx(x, z)] === T.GRASS) tiles[idx(x, z)] = T.DECOR;
  }

  // Checkpoints (forward rally points) along the route
  const checkpoints = (def.checkpoints || [0.36, 0.7]).map((f) => { const p = pointAt(pathLen * f); return { x: p.x, z: p.z, prog: pathLen * f }; });

  const buildable = new Uint8Array(n);
  const trapable = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (tiles[i] === T.GRASS && distWalk[i] <= 3 && distSpawn[i] > 3) buildable[i] = 1;
    if (tiles[i] === T.PATH && progress[i] > 30 && progress[i] < pathLen - 2) {
      const x = i % w, z = (i / w) | 0;
      const cx = (x + 0.5) * TILE, cz = (z + 0.5) * TILE;
      if (checkpoints.every((c) => Math.hypot(c.x - cx, c.z - cz) > 7)) trapable[i] = 1;
    }
  }

  const sp = def.spawn;
  const spawn = { x: ((sp[0] + sp[2] + 1) / 2) * TILE, z: ((sp[1] + sp[3] + 1) / 2) * TILE, rect: sp };
  // Route used by AI: spawn -> waypoints -> base
  const route = [{ x: spawn.x, z: spawn.z }, ...pts, { x: base.x, z: base.z }];

  const map = {
    id: MAPS[id] ? id : 'meadow', def, name: def.name, w, h, tiles, progress, distWalk, distSpawn, buildable, trapable,
    pts, pathLen, base, spawn, route, checkpoints,
    idx,
    inBounds(x, z) { return x >= 0 && z >= 0 && x < w * TILE && z < h * TILE; },
    tileAt(x, z) {
      const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
      if (tx < 0 || tz < 0 || tx >= w || tz >= h) return -1;
      return tz * w + tx;
    },
    tileType(x, z) { const i = this.tileAt(x, z); return i < 0 ? -1 : tiles[i]; },
    progressAt(x, z) { const i = this.tileAt(x, z); if (i < 0) return 0; const t = tiles[i]; return (t === T.PATH || t === T.PLAZA) ? progress[i] : 0; },
    inSpawn(x, z) { return this.tileType(x, z) === T.SPAWN; },
    inPlaza(x, z) { return this.tileType(x, z) === T.PLAZA; },
    walkableTile(i, blocked) {
      if (i < 0) return false;
      const t = tiles[i];
      if (!(t === T.PATH || t === T.SPAWN || t === T.PLAZA)) return false;
      return !(blocked && blocked.has(i));
    },
    // Circle-ish walk test at (x,z) radius r against static tiles and blocked (barricade) tiles
    canWalk(x, z, r = 0.45, blocked = null) {
      return this.walkableTile(this.tileAt(x - r, z - r), blocked) && this.walkableTile(this.tileAt(x + r, z - r), blocked)
        && this.walkableTile(this.tileAt(x - r, z + r), blocked) && this.walkableTile(this.tileAt(x + r, z + r), blocked);
    },
    nearestOnPath,
    pointAt,
    tileCenter(tx, tz) { return { x: (tx + 0.5) * TILE, z: (tz + 0.5) * TILE }; },
  };
  cache.set(id, map);
  return map;
}

export function mapBalance(map, nStrikers) {
  const b = map.def.balance;
  const at = (arr) => (arr ? arr[Math.max(0, Math.min(arr.length - 1, nStrikers - 1))] : 1);
  return { def: at(b && b.def), hp: at(b && b.hp) };
}

// Slide-move helper used by the client FPS controller, the server validator and bots.
export function slideMove(map, x, z, dx, dz, r, blocked) {
  let nx = x + dx, nz = z + dz;
  if (map.canWalk(nx, nz, r, blocked)) return { x: nx, z: nz };
  if (map.canWalk(nx, z, r, blocked)) return { x: nx, z };
  if (map.canWalk(x, nz, r, blocked)) return { x, z: nz };
  return { x, z };
}
