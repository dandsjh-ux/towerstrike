// Small math / helper library shared by server and client.

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
export function dist(ax, az, bx, bz) { return Math.sqrt(dist2(ax, az, bx, bz)); }
export function dist3(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
export function angleWrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
export function round2(v) { return Math.round(v * 100) / 100; }
export function round1(v) { return Math.round(v * 10) / 10; }

// Deterministic PRNG (mulberry32)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// Smooth value noise (2D), deterministic per seed.
export function makeNoise2D(seed) {
  const rng = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  shuffle(p, rng);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = rng();
  const fade = (t) => t * t * (3 - 2 * t);
  function v(ix, iz) { return vals[perm[(ix & 255) + perm[iz & 255]]]; }
  function noise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = fade(x - ix), fz = fade(z - iz);
    const a = v(ix, iz), b = v(ix + 1, iz), c = v(ix, iz + 1), d = v(ix + 1, iz + 1);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  }
  return function fbm(x, z, oct = 3) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) { sum += noise(x * freq, z * freq) * amp; norm += amp; amp *= 0.5; freq *= 2; }
    return sum / norm;
  };
}

// Ray vs axis-aligned box. Returns entry distance t (>=0) or -1.
// o, d: {x,y,z}; box: {x0,y0,z0,x1,y1,z1}
export function rayAABB(o, d, b) {
  let tmin = 0, tmax = Infinity;
  for (const [oa, da, a0, a1] of [[o.x, d.x, b.x0, b.x1], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z0, b.z1]]) {
    if (Math.abs(da) < 1e-9) {
      if (oa < a0 || oa > a1) return -1;
    } else {
      let t1 = (a0 - oa) / da, t2 = (a1 - oa) / da;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// Distance from point to AABB (3D). 0 if inside.
export function pointAABBDist(p, b) {
  const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1);
  const dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
  const dz = Math.max(b.z0 - p.z, 0, p.z - b.z1);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function normalize3(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

export function randomCode(len = 4, rng = Math.random) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(rng() * chars.length)];
  return s;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
