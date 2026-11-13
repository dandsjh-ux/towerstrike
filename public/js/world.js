// Scene, lighting, sky and the voxel battlefield for a map.
import * as THREE from 'three';
import { TILE } from '/shared/defs.js';
import { buildMap, T } from '/shared/maps.js';
import { makeNoise2D, mulberry32 } from '/shared/util.js';
import { VB, MAT, meshOf, addTree, buildBase, buildWindmill, buildSheep, buildFlag, C } from './voxel.js';

export const PAD_Y = 0.25; // grass / build pads sit slightly above the route

export class World {
  constructor(canvas) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.fog = new THREE.Fog(0xcfe6f5, 140, 460);
    this.scene.fog = this.fog;
    this.hemi = new THREE.HemisphereLight(0xd6ecff, 0x557a33, 1.35);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d6, 2.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.makeSky());
    this.mapGroup = new THREE.Group();
    this.scene.add(this.mapGroup);
    this.time = 0;
    this.map = null;
    this.sheep = []; this.clouds = []; this.windmills = []; this.flags = [];
    window.addEventListener('resize', () => this.resize());
  }

  makeSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x3d8ff0) }, mid: { value: new THREE.Color(0xa9d6ff) }, bot: { value: new THREE.Color(0xe9f5ff) }, sunDir: { value: new THREE.Vector3(-0.45, 0.75, 0.3).normalize() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunDir; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h,0.0,1.0), 0.6)) : mix(mid, bot, clamp(-h*4.0,0.0,1.0));
        float s = max(dot(normalize(vP), sunDir), 0.0); c += vec3(1.0,0.95,0.8) * (pow(s, 600.0) * 1.6 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0); }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    this.sky = m;
    return m;
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  clearMap() {
    this.mapGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.scene.remove(this.mapGroup);
    this.mapGroup = new THREE.Group();
    this.scene.add(this.mapGroup);
    this.sheep = []; this.clouds = []; this.windmills = []; this.flags = [];
  }

  // Terrain height (top surface) at world x,z
  heightAt(x, z) {
    if (!this.hmap) return 0;
    const ix = Math.floor(x), iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= this.hw || iz >= this.hh) return PAD_Y;
    return this.hmap[iz * this.hw + ix];
  }

  loadMap(mapId) {
    if (this.map && this.map.id === mapId) return this.map;
    this.clearMap();
    const map = buildMap(mapId);
    this.map = map;
    const W = map.w * TILE, H = map.h * TILE;
    this.size = { W, H };
    const rng = mulberry32(map.def.seed);
    const noise = makeNoise2D(map.def.seed);
    const noise2 = makeNoise2D(map.def.seed + 17);
    // ---- heightmap (1 m cells)
    this.hw = W; this.hh = H;
    const hm = new Float32Array(W * H);
    const tileOf = (x, z) => map.tiles[Math.floor(z / TILE) * map.w + Math.floor(x / TILE)];
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const ti = Math.floor(z / TILE) * map.w + Math.floor(x / TILE);
      const t = map.tiles[ti];
      let h;
      if (t === T.PATH || t === T.SPAWN || t === T.PLAZA || t === T.BASE) h = 0;
      else if (t === T.WATER) h = -1.0;
      else if (map.buildable[ti] || t === T.DECOR) h = PAD_Y;
      else {
        // smooth distance to the nearest build pad / route
        const d = map.distWalk[ti];
        const ramp = Math.max(0, Math.min(1, (d - 3.2) / 3));
        const n = noise(x * 0.035, z * 0.035, 3);
        h = PAD_Y + Math.round(ramp * Math.max(0, n - 0.32) * 9 * 2) / 2;
      }
      hm[z * W + x] = h;
    }
    // shoreline: grass next to water dips a little
    this.hmap = hm;
    // ---- terrain geometry
    const b = new VB(map.def.seed);
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const i = z * W + x;
      const h = hm[i];
      const ti = Math.floor(z / TILE) * map.w + Math.floor(x / TILE);
      const t = map.tiles[ti];
      const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
      const n1 = noise2(x * 0.15, z * 0.15, 2);
      let col;
      if (t === T.PATH) {
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => { const tt = tileOf(Math.min(W - 1, Math.max(0, x + dx)), Math.min(H - 1, Math.max(0, z + dz))); return tt !== T.PATH && tt !== T.SPAWN && tt !== T.PLAZA && tt !== T.BASE; });
        col = edge ? 0x8f8a63 : n1 > 0.62 ? 0xa48a62 : n1 < 0.3 ? 0xc9a873 : 0xbb9a66;
        if (b.rnd() < 0.04) col = 0x9c9488;
      } else if (t === T.SPAWN) col = ((x >> 1) + (z >> 1)) % 2 ? 0x7d93ab : 0x8ea3b9;
      else if (t === T.PLAZA || t === T.BASE) col = ((x >> 1) + (z >> 1)) % 2 ? 0xbcb6a6 : 0xaba595;
      else if (t === T.WATER) col = 0x4c7a6a;
      else if (map.buildable[ti]) col = (tx + tz) % 2 ? (n1 > 0.5 ? 0x77c24e : 0x6fba47) : (n1 > 0.5 ? 0x6cb646 : 0x66ae42);
      else {
        const hy = h - PAD_Y;
        col = n1 > 0.66 ? 0x82c653 : n1 < 0.3 ? 0x5aa23c : 0x6db849;
        if (hy > 2.5) col = n1 > 0.5 ? 0x8cc35a : 0x7fb84f;
      }
      // neighbours' minimum height => how deep the column's sides go
      let minN = h;
      if (x > 0) minN = Math.min(minN, hm[i - 1]); if (x < W - 1) minN = Math.min(minN, hm[i + 1]);
      if (z > 0) minN = Math.min(minN, hm[i - W]); if (z < H - 1) minN = Math.min(minN, hm[i + W]);
      const skipSide = (nh) => nh >= h;
      let skip = 2; // no bottom
      if (x < W - 1 && skipSide(hm[i + 1])) skip |= 4; if (x > 0 && skipSide(hm[i - 1])) skip |= 8;
      if (z < H - 1 && skipSide(hm[i + W])) skip |= 16; if (z > 0 && skipSide(hm[i - W])) skip |= 32;
      const bottom = Math.min(minN, h - 0.2);
      const isGrass = t === T.GRASS || t === T.DECOR;
      if (isGrass && h - bottom > 0.35) {
        b.span(x, bottom, z, x + 1, h - 0.2, z + 1, 0x8a6a45, 0.06, skip | 1);
        b.span(x, h - 0.2, z, x + 1, h, z + 1, col, 0.03, skip);
      } else b.span(x, bottom, z, x + 1, h, z + 1, col, 0.03, skip);
    }
    // world edge skirt
    b.span(-40, -2, -40, W + 40, -0.6, H + 40, 0x5d9e3e, 0.02, 0);
    const terrain = meshOf(b, MAT.std, false);
    terrain.receiveShadow = true;
    this.mapGroup.add(terrain);
    this.terrain = terrain;

    // ---- water surfaces
    const waterMat = new THREE.MeshLambertMaterial({ color: 0x4aa3d8, transparent: true, opacity: 0.78 });
    this.waterMat = waterMat;
    const wvb = new VB(5);
    for (let tz = 0; tz < map.h; tz++) for (let tx = 0; tx < map.w; tx++) if (map.tiles[tz * map.w + tx] === T.WATER) wvb.span(tx * TILE, -0.35, tz * TILE, (tx + 1) * TILE, -0.15, (tz + 1) * TILE, 0xffffff, 0, 2);
    if (!wvb.empty) { const wm = new THREE.Mesh(wvb.geometry(), waterMat); this.mapGroup.add(wm); }

    // ---- decor (merged)
    const d = new VB(map.def.seed + 1);
    const isRoute = (t) => t === T.PATH || t === T.SPAWN || t === T.PLAZA || t === T.BASE;
    // fences / walls along the route
    for (let tz = 0; tz < map.h; tz++) for (let tx = 0; tx < map.w; tx++) {
      const t = map.tiles[tz * map.w + tx];
      if (!isRoute(t) || t === T.BASE) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx, nz = tz + dz;
        if (nx < 0 || nz < 0 || nx >= map.w || nz >= map.h) continue;
        const nt = map.tiles[nz * map.w + nx];
        if (isRoute(nt)) continue;
        // edge line
        const ex = dx === 1 ? (tx + 1) * TILE - 0.2 : dx === -1 ? tx * TILE + 0.2 : null;
        const ez = dz === 1 ? (tz + 1) * TILE - 0.2 : dz === -1 ? tz * TILE + 0.2 : null;
        const alongX = ex === null;
        const s0 = alongX ? tx * TILE : tz * TILE;
        if (t === T.PATH) {
          for (let s = 0; s < TILE; s += 2) {
            const px = alongX ? s0 + s + 0.15 : ex, pz = alongX ? ez : s0 + s + 0.15;
            d.box(px, 0.6, pz, 0.22, 1.2, 0.22, 0x7a5232, 0.08);
          }
          const cx = alongX ? s0 + TILE / 2 : ex, cz = alongX ? ez : s0 + TILE / 2;
          d.box(cx, 0.85, cz, alongX ? TILE : 0.1, 0.12, alongX ? 0.1 : TILE, 0xa0703f, 0.05);
          d.box(cx, 0.45, cz, alongX ? TILE : 0.1, 0.12, alongX ? 0.1 : TILE, 0x9a6a3a, 0.05);
        } else if (t === T.PLAZA) {
          const cx = alongX ? s0 + TILE / 2 : ex, cz = alongX ? ez : s0 + TILE / 2;
          d.box(cx, 0.45, cz, alongX ? TILE : 0.5, 0.9, alongX ? 0.5 : TILE, 0x9a958c, 0.06);
          d.box(cx, 0.95, cz, alongX ? TILE - 0.4 : 0.35, 0.1, alongX ? 0.35 : TILE - 0.4, 0xc2bdb2, 0.03);
        } else if (t === T.SPAWN) {
          const cx = alongX ? s0 + TILE / 2 : ex, cz = alongX ? ez : s0 + TILE / 2;
          d.box(cx, 0.6, cz, alongX ? TILE : 0.3, 1.2, alongX ? 0.3 : TILE, 0x5b6f86, 0.04);
          d.box(cx, 1.25, cz, alongX ? TILE : 0.35, 0.1, alongX ? 0.35 : TILE, C.str, 0.02);
        }
      }
    }
    // trees, bushes, rocks, flowers, grass tufts
    for (let tz = 0; tz < map.h; tz++) for (let tx = 0; tx < map.w; tx++) {
      const ti = tz * map.w + tx;
      const t = map.tiles[ti];
      const cx = tx * TILE, cz = tz * TILE;
      if (t === T.GRASS && !map.buildable[ti]) {
        const dist = map.distWalk[ti];
        const nTree = rng() < Math.min(0.75, 0.12 + (dist - 3) * 0.12) ? 1 + (rng() < 0.3 ? 1 : 0) : 0;
        for (let k = 0; k < nTree; k++) {
          const x = cx + 0.8 + rng() * 2.4, z = cz + 0.8 + rng() * 2.4;
          addTree(d, x, this.heightAt(x, z), z, rng);
        }
        if (rng() < 0.25) { const x = cx + rng() * 4, z = cz + rng() * 4, s = 0.5 + rng() * 0.9; d.box(x, this.heightAt(x, z) + s * 0.3, z, s * 1.3, s * 0.7, s, rng() < 0.5 ? 0x8d8b85 : 0x9e9b93, 0.08); }
        if (rng() < 0.35) { const x = cx + rng() * 4, z = cz + rng() * 4; d.box(x, this.heightAt(x, z) + 0.45, z, 1.2, 0.9, 1.1, 0x4f9c3c, 0.1).box(x + 0.3, this.heightAt(x, z) + 0.75, z, 0.8, 0.6, 0.8, 0x5bae45, 0.1); }
      }
      if (t === T.GRASS || t === T.DECOR) {
        const nFlowers = map.buildable[ti] ? (rng() < 0.3 ? 2 : 0) : Math.floor(rng() * 7);
        const fc = [0xffffff, 0xffe14d, 0xff6b8a, 0xb07cff, 0xff9a3c, 0x7fd8ff][Math.floor(rng() * 6)];
        for (let k = 0; k < nFlowers; k++) {
          const x = cx + rng() * 4, z = cz + rng() * 4;
          if (map.buildable[ti] && Math.abs(x - cx - 2) < 1.6 && Math.abs(z - cz - 2) < 1.6) continue;
          const y = this.heightAt(x, z);
          d.box(x, y + 0.15, z, 0.06, 0.3, 0.06, 0x3c8a2c, 0).box(x, y + 0.33, z, 0.18, 0.12, 0.18, fc, 0.1);
        }
        const nTuft = map.buildable[ti] ? 2 : 5;
        for (let k = 0; k < nTuft; k++) {
          const x = cx + rng() * 4, z = cz + rng() * 4;
          if (map.buildable[ti] && Math.abs(x - cx - 2) < 1.5 && Math.abs(z - cz - 2) < 1.5) continue;
          const y = this.heightAt(x, z);
          d.box(x, y + 0.2, z, 0.1, 0.4, 0.1, 0x5aa83c, 0.15).box(x + 0.12, y + 0.15, z + 0.05, 0.08, 0.3, 0.08, 0x6cbc48, 0.15);
        }
      }
      if (t === T.WATER && rng() < 0.3) { const x = cx + rng() * 4, z = cz + rng() * 4; d.box(x, -0.13, z, 0.7, 0.04, 0.7, 0x3f9a3a, 0.1); if (rng() < 0.3) d.box(x + 0.1, -0.06, z, 0.14, 0.08, 0.14, 0xff8ab0, 0); }
      if (t === T.PATH && rng() < 0.12) { const x = cx + 0.3 + rng() * 3.4, z = cz + 0.3 + rng() * 3.4; d.box(x, 0.05, z, 0.3, 0.1, 0.25, 0x8f877a, 0.1); }
    }
    // landmarks
    for (const lm of map.def.landmarks || []) {
      const x = (lm.tx + 1) * TILE, z = (lm.tz + 1) * TILE;
      if (lm.type === 'windmill') {
        const wmill = buildWindmill();
        wmill.group.position.set(x, PAD_Y, z);
        wmill.group.rotation.y = Math.PI * 0.25;
        this.mapGroup.add(wmill.group);
        this.windmills.push(wmill);
        for (let k = 0; k < 5; k++) { const hx = x + 4 + rng() * 3, hz = z - 3 + rng() * 6; d.box(hx, PAD_Y + 0.5, hz, 1.4, 1.0, 1.0, 0xe6c35a, 0.06).box(hx, PAD_Y + 0.5, hz, 1.42, 0.12, 1.02, 0xb8923a, 0); }
      }
    }
    // spawn gate
    {
      const sp = map.def.spawn;
      const gx = (sp[2] + 1) * TILE, z0 = sp[1] * TILE, z1 = (sp[3] + 1) * TILE;
      d.box(gx, 3, z0 + 0.5, 1, 6, 1, 0x5b6f86).box(gx, 3, z1 - 0.5, 1, 6, 1, 0x5b6f86).box(gx, 6.3, (z0 + z1) / 2, 1.2, 0.8, z1 - z0, 0x4a5c72);
      d.box(gx + 0.62, 5.1, (z0 + z1) / 2, 0.06, 1.4, (z1 - z0) * 0.6, C.str, 0.02);
    }
    const decor = meshOf(d, MAT.std, true);
    this.mapGroup.add(decor);

    // ---- base core
    this.base = buildBase();
    this.base.group.position.set(map.base.x, 0, map.base.z);
    this.mapGroup.add(this.base.group);
    const domeMat = new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(8.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    this.dome.position.set(map.base.x, 0, map.base.z);
    this.mapGroup.add(this.dome);
    this.domeFlash = 0; this.locked = false;

    // ---- checkpoint flags
    this.flags = map.checkpoints.map((c) => {
      const f = buildFlag(0xffffff);
      f.group.position.set(c.x + 3.2, 0, c.z + 3.2);
      const ring = new THREE.Mesh(new THREE.RingGeometry(4.6, 5.0, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, 0.04, c.z);
      const fill = new THREE.Mesh(new THREE.CircleGeometry(4.6, 40, 0, 0.001), new THREE.MeshBasicMaterial({ color: C.str, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      fill.rotation.x = -Math.PI / 2; fill.position.set(c.x, 0.05, c.z);
      this.mapGroup.add(f.group, ring, fill);
      return { ...f, ring, fill, prog: -1, captured: false, enabled: true };
    });

    // ---- clouds
    for (let i = 0; i < 14; i++) {
      const cb = new VB(100 + i);
      const n = 3 + Math.floor(rng() * 4);
      for (let k = 0; k < n; k++) cb.box((rng() - 0.5) * 14, (rng() - 0.5) * 2, (rng() - 0.5) * 8, 6 + rng() * 8, 2 + rng() * 2, 4 + rng() * 6, 0xffffff, 0.03);
      const m = new THREE.Mesh(cb.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.92, emissive: 0x9ab0c0 }));
      m.position.set(rng() * (W + 200) - 100, 55 + rng() * 25, rng() * (H + 200) - 100);
      m.userData.speed = 1.5 + rng() * 2;
      m.visible = this.viewMode !== 'iso';
      this.mapGroup.add(m);
      this.clouds.push(m);
    }
    // ---- sheep
    const grassTiles = [];
    for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === T.GRASS && !map.buildable[i] && map.distWalk[i] >= 4) grassTiles.push(i);
    for (let k = 0; k < Math.min(10, grassTiles.length); k++) {
      const ti = grassTiles[Math.floor(rng() * grassTiles.length)];
      const s = buildSheep();
      const x = (ti % map.w + 0.5) * TILE, z = (Math.floor(ti / map.w) + 0.5) * TILE;
      s.position.set(x, this.heightAt(x, z), z);
      s.userData = { heading: rng() * Math.PI * 2, walk: 0, timer: rng() * 3, rng: mulberry32(k + 5) };
      this.mapGroup.add(s);
      this.sheep.push(s);
    }
    // ---- build-grid overlay (defender)
    this.grid = { ground: this.makeGrid(map, map.buildable, 0x7cff8a), path: this.makeGrid(map, map.trapable, 0xffc040) };
    this.grid.ground.visible = false; this.grid.path.visible = false;
    this.mapGroup.add(this.grid.ground, this.grid.path);

    // ---- sun / shadow camera covers the whole field
    const cx = W / 2, cz = H / 2;
    this.sun.position.set(cx - 70, 120, cz + 50);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    const ext = Math.max(W, H) * 0.62;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 10; sc.far = 400;
    sc.updateProjectionMatrix();
    this.sky.position.set(cx, 0, cz);
    return map;
  }

  makeGrid(map, mask, color) {
    const vb = new VB(3);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const tx = i % map.w, tz = Math.floor(i / map.w);
      const y = map.tiles[i] === T.PATH ? 0.03 : PAD_Y + 0.03;
      const x0 = tx * TILE + 0.2, z0 = tz * TILE + 0.2, x1 = (tx + 1) * TILE - 0.2, z1 = (tz + 1) * TILE - 0.2, e = 0.22;
      vb.span(x0 + e, y, z0 + e, x1 - e, y + 0.02, z1 - e, 0x3a7a3a, 0, 2 | 4 | 8 | 16 | 32);
      vb.span(x0, y + 0.01, z0, x1, y + 0.03, z0 + e, color, 0, 2 | 4 | 8 | 16 | 32).span(x0, y + 0.01, z1 - e, x1, y + 0.03, z1, color, 0, 2 | 4 | 8 | 16 | 32);
      vb.span(x0, y + 0.01, z0, x0 + e, y + 0.03, z1, color, 0, 2 | 4 | 8 | 16 | 32).span(x1 - e, y + 0.01, z0, x1, y + 0.03, z1, color, 0, 2 | 4 | 8 | 16 | 32);
    }
    const m = new THREE.Mesh(vb.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }));
    m.renderOrder = 2;
    return m;
  }
  showGrid(kind) {
    if (!this.grid) return;
    this.grid.ground.visible = kind === 'ground';
    this.grid.path.visible = kind === 'path';
  }

  setCheckpoint(i, captured, prog, contested, enabled = true) {
    const f = this.flags[i];
    if (!f) return;
    f.group.visible = f.ring.visible = !!enabled;
    f.fill.visible = !!(enabled && !captured && prog > 0);
    if (f.captured !== captured) { f.captured = captured; f.cloth.material.color.setHex(captured ? C.str : 0xffffff); }
    f.ring.material.color.setHex(captured ? C.str : contested ? 0xff4040 : 0xffffff);
    if (Math.abs(f.prog - prog) > 0.01) {
      f.prog = prog;
      f.fill.geometry.dispose();
      f.fill.geometry = new THREE.CircleGeometry(4.6, 40, Math.PI / 2, Math.max(0.001, prog * Math.PI * 2));
    }
  }
  // 'iso' (defender/spectator, far orthographic camera): no fog, no clouds in the way. 'fps'/'title': atmospheric.
  setViewMode(kind) {
    this.viewMode = kind;
    this.scene.fog = kind === 'iso' ? null : this.fog;
    for (const c of this.clouds) c.visible = kind !== 'iso';
  }
  flashDome() { this.domeFlash = 1; }
  setLockdown(on) { this.locked = on; }

  update(dt) {
    this.time += dt;
    const t = this.time;
    for (const w of this.windmills) w.blades.rotation.z += dt * 0.6;
    if (this.base) {
      this.base.crystal.rotation.y += dt * 0.8;
      this.base.crystal.position.y = 10 + Math.sin(t * 1.6) * 0.25;
      this.base.light.intensity = 26 + Math.sin(t * 3) * 6;
      this.domeFlash = Math.max(0, this.domeFlash - dt * 2.5);
      const m = this.dome.material;
      m.color.setHex(this.locked ? 0xffd34d : 0x6fd3ff);
      m.opacity = (this.locked ? 0.22 : 0.05) + this.domeFlash * 0.35;
    }
    if (this.waterMat) this.waterMat.opacity = 0.74 + Math.sin(t * 1.3) * 0.04;
    const W = this.size ? this.size.W : 160;
    for (const c of this.clouds) { c.position.x += c.userData.speed * dt; if (c.position.x > W + 120) c.position.x = -120; }
    for (const s of this.sheep) {
      const u = s.userData;
      u.timer -= dt;
      if (u.timer <= 0) { u.walk = u.rng() < 0.5 ? 1 : 0; u.heading += (u.rng() - 0.5) * 2.4; u.timer = 2 + u.rng() * 4; }
      if (u.walk) {
        const nx = s.position.x - Math.sin(u.heading) * dt * 0.9, nz = s.position.z - Math.cos(u.heading) * dt * 0.9;
        const tt = this.map.tileType(nx, nz);
        const ti = this.map.tileAt(nx, nz);
        if (tt === T.GRASS && ti >= 0 && !this.map.buildable[ti]) { s.position.x = nx; s.position.z = nz; } else { u.heading += Math.PI * 0.7; }
        s.position.y = this.heightAt(s.position.x, s.position.z) + Math.abs(Math.sin(t * 8)) * 0.08;
      }
      s.rotation.y = u.heading;
    }
    for (const f of this.flags) f.cloth.rotation.y = Math.sin(t * 2 + f.group.position.x) * 0.25;
  }
}
