// AIL LABS — Botanica CGI layer.
// One WebGL scene per public page, mounted inside that page's hero stage, plus scroll/pointer reactions.
// Presentation only: never touches forms, catalog data, lead gate or promo logic. If WebGL is
// unavailable the page keeps its CSS look; with prefers-reduced-motion each scene renders one still frame.
import * as THREE from '/vendor/three/three.module.min.js';

const C = {
  forest: 0x0f2a23, moss: 0x21493c, leaf: 0x5fa883, sage: 0xa9d3b8,
  champagne: 0xd4b77c, champagne2: 0xecdcb4, ivory: 0xf7f2e8, blush: 0xe8bfae,
};
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches || innerWidth < 720;
const page = (location.pathname.replace(/\/+$/, '').split('/').pop() || 'index').replace(/\.html$/, '') || 'index';
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = t => 1 - Math.pow(1 - clamp(t), 3);
const easeBack = t => { t = clamp(t); const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

/* ───────────────────────── Shared materials & helpers ───────────────────────── */

function glass(opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.06, transmission: 1, thickness: 0.8, ior: 1.46,
    clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.25, transparent: true, ...opts,
  });
}
const metal = (color = C.champagne, roughness = 0.26) => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness, envMapIntensity: 1.3 });
const satin = (color, roughness = 0.38) => new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.6, sheenColor: new THREE.Color(C.champagne2), envMapIntensity: 1.1 });

let dotTexture;
function dot() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(c); dotTexture.colorSpace = THREE.SRGBColorSpace;
  return dotTexture;
}
function sparkles(count, spread, color = C.champagne2, size = 0.05, opacity = 0.75) {
  const g = new THREE.BufferGeometry(), p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { p[i * 3] = rand(-spread[0], spread[0]); p[i * 3 + 1] = rand(-spread[1], spread[1]); p[i * 3 + 2] = rand(-spread[2], spread[2]); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: dot(), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
}

// Studio environment: dark forest room lit by ivory, champagne and sage softboxes (reflections carry the palette).
function studioEnvironment(renderer) {
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshBasicMaterial({ color: 0x0c241e, side: THREE.BackSide })));
  const box = (color, intensity, w, h, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...look); room.add(m);
  };
  box(C.ivory, 7, 6, 4, [0, 7, 4], [0, 0, 0]);
  box(C.champagne, 4.5, 3, 8, [-8, 1, 2], [0, 0, 0]);
  box(C.sage, 3.2, 3, 8, [8, 0, -2], [0, 0, 0]);
  box(C.ivory, 2.4, 10, 1.2, [0, -3, 8], [0, 0, 0]);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(room, 0.03);
  pm.dispose();
  return rt.texture;
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(C.ivory, C.forest, 0.55));
  const key = new THREE.DirectionalLight(C.champagne2, 2.2); key.position.set(3, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(C.sage, 1.6); rim.position.set(-4, 1.5, -3); scene.add(rim);
}

// Seam-free icosphere: Three's polyhedron geometry is non-indexed, so weld it before smooth normals.
function icosphere(detail) {
  const src = new THREE.IcosahedronGeometry(1, detail), pos = src.attributes.position.array;
  const map = new Map(), verts = [], index = [];
  for (let i = 0; i < pos.length; i += 3) {
    const key = `${Math.round(pos[i] * 1e4)},${Math.round(pos[i + 1] * 1e4)},${Math.round(pos[i + 2] * 1e4)}`;
    let id = map.get(key);
    if (id === undefined) { id = verts.length / 3; map.set(key, id); verts.push(pos[i], pos[i + 1], pos[i + 2]); }
    index.push(id);
  }
  src.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(index); g.computeVertexNormals();
  return g;
}

/* ───────────────────────── Scenes (one per page) ───────────────────────── */

// HOME — "Serum Droplet": a living glass droplet with a champagne core, orbited by pollen.
function sceneDroplet(ctx) {
  const { scene, camera } = ctx;
  camera.position.set(0, 0, 6.2);
  const group = new THREE.Group(); scene.add(group);
  const geo = icosphere(coarse ? 22 : 40);
  const base = geo.attributes.position.array.slice();
  const drop = new THREE.Mesh(geo, glass({
    color: 0xffffff, thickness: 0.9, iridescence: 1, iridescenceIOR: 1.28, iridescenceThicknessRange: [120, 520],
    attenuationColor: new THREE.Color(0xeaf5ee), attenuationDistance: 6, roughness: 0.02, ior: 1.33, specularIntensity: 1,
  }));
  drop.scale.setScalar(1.18); group.add(drop);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 3), new THREE.MeshPhysicalMaterial({ color: C.champagne, metalness: 1, roughness: 0.18, emissive: C.champagne, emissiveIntensity: 0.12, clearcoat: 1 }));
  group.add(core);
  const leafCore = new THREE.Mesh(new THREE.TorusKnotGeometry(0.5, 0.022, 200, 10, 2, 3), metal(C.champagne2, 0.18)); group.add(leafCore);
  const sats = [0, 1, 2].map(i => { const m = new THREE.Mesh(icosphere(4), glass({ color: 0xf6efe0, thickness: 0.5, iridescence: 0.5 })); m.scale.setScalar(0.16 + i * 0.05); scene.add(m); return m; });
  const ringCount = coarse ? 520 : 1300, rp = new Float32Array(ringCount * 3), seeds = [];
  for (let i = 0; i < ringCount; i++) { seeds.push([rand(0, Math.PI * 2), rand(1.6, 2.2), rand(-0.14, 0.14), rand(0.12, 0.35)]); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const ring = new THREE.Points(rg, new THREE.PointsMaterial({ color: C.champagne2, size: 0.045, map: dot(), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.rotation.set(1.15, 0.2, 0.35); group.add(ring);
  const dust = sparkles(coarse ? 120 : 260, [5, 3.4, 2], C.sage, 0.035, 0.5); scene.add(dust);
  let energy = 0;
  return {
    update(t, dt, s) {
      const a = 0.06 + energy * 0.08, arr = geo.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = base[i], y = base[i + 1], z = base[i + 2];
        const d = 1 + a * (Math.sin(3.1 * x + 1.3 * t) * Math.cos(2.6 * y + 1.05 * t) + 0.55 * Math.sin(4.2 * z + 1.7 * t + 2.1 * x) + 0.3 * Math.sin(6 * y - 2.2 * t));
        arr[i] = x * d; arr[i + 1] = y * d; arr[i + 2] = z * d;
      }
      geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
      energy += ((Math.abs(s.vx) + Math.abs(s.vy)) * 6 - energy) * Math.min(1, dt * 3); energy = clamp(energy, 0, 1.4);
      group.rotation.y += dt * 0.18; group.rotation.x = s.py * 0.35; group.rotation.z = -s.px * 0.18;
      group.position.set(s.px * 0.25, 0.42 + Math.sin(t * 0.8) * 0.06 - s.scroll * 0.4, 0);
      const sc = 1 - s.scroll * 0.12; group.scale.setScalar(sc);
      core.rotation.set(t * 0.4, t * 0.6, 0); leafCore.rotation.set(t * 0.25, -t * 0.35, t * 0.1);
      sats.forEach((m, i) => { const k = t * (0.35 + i * 0.12) + i * 2.1; m.position.set(Math.cos(k) * (1.75 + i * 0.18), 0.42 + Math.sin(k * 1.3) * 0.55, Math.sin(k) * 1.3); });
      for (let i = 0; i < ringCount; i++) { const [ph, r, h, sp] = seeds[i], k = ph + t * sp; rp[i * 3] = Math.cos(k) * r; rp[i * 3 + 1] = h + Math.sin(k * 3 + ph) * 0.05; rp[i * 3 + 2] = Math.sin(k) * r; }
      rg.attributes.position.needsUpdate = true;
      dust.rotation.y = t * 0.02;
    },
  };
}

// CATALOG — "Vial Carousel": the product forms (vial, ampoule, dropper, jar) orbit a lit plinth; drag to spin.
function sceneCarousel(ctx) {
  const { scene, camera, canvas } = ctx;
  camera.position.set(0, 2.2, 10.2); camera.lookAt(0, 0.35, 0);
  const lathe = pts => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 56);
  const liquids = [C.sage, C.champagne, C.blush, 0xf3ead8, C.leaf].map(c => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.18, transmission: 0.55, thickness: 0.6, clearcoat: 0.6, transparent: true, envMapIntensity: 1 }));
  const shell = glass({ thickness: 0.3, roughness: 0.04, side: THREE.DoubleSide });
  const amber = glass({ color: 0xe7c48a, attenuationColor: new THREE.Color(0xb8844a), attenuationDistance: 0.6, thickness: 0.4 });
  const gold = metal(C.champagne, 0.22), pearl = satin(C.ivory, 0.3), rubber = satin(C.moss, 0.55);
  const makers = [
    () => { const g = new THREE.Group();
      g.add(new THREE.Mesh(lathe([[0, 0], [0.34, 0], [0.37, 0.04], [0.37, 1.18], [0.3, 1.3], [0.19, 1.36], [0.19, 1.46], [0, 1.46]]), shell));
      const l = new THREE.Mesh(lathe([[0, 0.03], [0.33, 0.03], [0.33, 0.82], [0, 0.82]]), liquids[0]); g.add(l);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.24, 40), gold); cap.position.y = 1.5; g.add(cap);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 32), pearl); top.position.y = 1.64; g.add(top); return g; },
    () => { const g = new THREE.Group();
      g.add(new THREE.Mesh(lathe([[0, 0], [0.22, 0], [0.25, 0.05], [0.25, 0.92], [0.2, 1.02], [0.09, 1.14], [0.07, 1.22], [0.11, 1.32], [0.09, 1.5], [0.04, 1.6], [0, 1.6]]), shell));
      g.add(new THREE.Mesh(lathe([[0, 0.04], [0.22, 0.04], [0.22, 0.7], [0, 0.7]]), liquids[1]));
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 10, 40), gold); band.rotation.x = Math.PI / 2; band.position.y = 1.2; g.add(band); return g; },
    () => { const g = new THREE.Group();
      g.add(new THREE.Mesh(lathe([[0, 0], [0.4, 0], [0.44, 0.06], [0.44, 0.92], [0.34, 1.1], [0.16, 1.16], [0.16, 1.26], [0, 1.26]]), amber));
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.22, 36), gold); collar.position.y = 1.34; g.add(collar);
      const bulb = new THREE.Mesh(lathe([[0, 0], [0.15, 0], [0.17, 0.12], [0.14, 0.38], [0.08, 0.5], [0, 0.52]]), rubber); bulb.position.y = 1.44; g.add(bulb); return g; },
    () => { const g = new THREE.Group();
      g.add(new THREE.Mesh(lathe([[0, 0], [0.58, 0], [0.62, 0.05], [0.62, 0.5], [0.58, 0.56], [0, 0.56]]), shell));
      g.add(new THREE.Mesh(lathe([[0, 0.05], [0.56, 0.05], [0.56, 0.42], [0, 0.42]]), liquids[3]));
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.63, 0.63, 0.26, 56), gold); lid.position.y = 0.7; g.add(lid); return g; },
  ];
  const count = coarse ? 7 : 9, R = coarse ? 2.05 : 2.3, ring = new THREE.Group(); scene.add(ring);
  const items = [];
  for (let i = 0; i < count; i++) {
    const m = makers[i % makers.length](), holder = new THREE.Group();
    m.traverse(o => { if (liquids.includes(o.material)) o.material = liquids[i % liquids.length]; });
    m.position.y = -0.75; holder.add(m);
    const a = (i / count) * Math.PI * 2; holder.position.set(Math.sin(a) * R, 0, Math.cos(a) * R);
    ring.add(holder); items.push({ holder, a, phase: rand(0, 6) });
  }
  // Plinth: glowing disc + soft halo
  const halo = document.createElement('canvas'); halo.width = halo.height = 256;
  const hg = halo.getContext('2d'), grd = hg.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, 'rgba(236,220,180,.55)'); grd.addColorStop(0.45, 'rgba(95,168,131,.22)'); grd.addColorStop(1, 'rgba(15,42,35,0)');
  hg.fillStyle = grd; hg.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(halo); tex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.8; scene.add(floor);
  const orbit = new THREE.Mesh(new THREE.TorusGeometry(R, 0.006, 6, 180), new THREE.MeshBasicMaterial({ color: C.champagne, transparent: true, opacity: 0.45 }));
  orbit.rotation.x = Math.PI / 2; orbit.position.y = -0.78; scene.add(orbit);
  const fx = sparkles(coarse ? 90 : 200, [5, 2.5, 3], C.champagne2, 0.04, 0.6); fx.position.y = 0.8; scene.add(fx);
  let spin = 0, vel = 0.25, drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX }; });
  addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointermove', e => { if (!drag) return; vel = clamp((e.clientX - drag.x) * 0.06, -4, 4); drag.x = e.clientX; });
  return {
    update(t, dt, s) {
      if (!drag) vel += (0.22 - vel) * Math.min(1, dt * 0.9);
      spin += vel * dt; ring.rotation.y = spin + s.px * 0.25;
      ring.rotation.x = 0.08 + s.py * 0.06;
      for (const it of items) {
        const world = it.a + ring.rotation.y, front = Math.max(0, Math.cos(world));
        const k = 1 + Math.pow(front, 6) * 0.22;
        it.holder.scale.setScalar(k);
        it.holder.position.y = Math.sin(t * 1.1 + it.phase) * 0.06 + Math.pow(front, 6) * 0.18;
        it.holder.rotation.y = -ring.rotation.y + Math.sin(t * 0.5 + it.phase) * 0.25 + t * 0.2;
      }
      fx.rotation.y = -t * 0.04;
      camera.position.y = 2.2 - s.scroll * 0.9; camera.lookAt(0, 0.35, 0);
    },
  };
}

// PRIVATE LABEL — "Formulation": a molecular helix assembles itself from scattered ingredients; tap to reformulate.
function sceneMolecule(ctx) {
  const { scene, camera, canvas } = ctx;
  camera.position.set(0, 0, 8.4);
  const root = new THREE.Group(); scene.add(root);
  const N = coarse ? 28 : 42, atoms = [], bonds = [];
  const kinds = [
    { mat: new THREE.MeshPhysicalMaterial({ color: C.ivory, roughness: 0.22, clearcoat: 1, sheen: 0.5, sheenColor: new THREE.Color(C.champagne2) }), r: 0.2 },
    { mat: metal(C.champagne, 0.2), r: 0.14 },
    { mat: new THREE.MeshPhysicalMaterial({ color: C.leaf, roughness: 0.3, clearcoat: 1, emissive: C.leaf, emissiveIntensity: 0.08 }), r: 0.16 },
    { mat: glass({ color: 0xe9f5ee, thickness: 0.4, iridescence: 0.6 }), r: 0.24 },
  ];
  const push = (kind, target) => { const id = atoms.length; atoms.push({ kind, target, start: new THREE.Vector3().randomDirection().multiplyScalar(rand(3.5, 6)), delay: rand(0, 1.4) }); return id; };
  const len = coarse ? 4.4 : 5.2;
  for (let i = 0; i < N; i++) {
    const a = i * 0.52, y = (i / (N - 1) - 0.5) * len;
    const b = push(0, new THREE.Vector3(Math.cos(a) * 1.05, y, Math.sin(a) * 1.05));
    if (i % 2 === 0) { const o = push(1, new THREE.Vector3(Math.cos(a) * 1.75, y + 0.08, Math.sin(a) * 1.75)); bonds.push([b, o]); }
    else if (i % 3 === 0) { const n = push(2, new THREE.Vector3(Math.cos(a + 0.5) * 1.6, y - 0.1, Math.sin(a + 0.5) * 1.6)); bonds.push([b, n]); }
    if (i % 7 === 3) { const g = push(3, new THREE.Vector3(Math.cos(a - 0.6) * 2.25, y, Math.sin(a - 0.6) * 2.25)); bonds.push([b, g]); }
  }
  // Backbone: link consecutive backbone atoms
  const backbone = atoms.map((a, i) => a.kind === 0 ? i : -1).filter(i => i >= 0);
  for (let i = 1; i < backbone.length; i++) bonds.push([backbone[i - 1], backbone[i]]);
  const meshes = kinds.map((k, ki) => {
    const n = atoms.filter(a => a.kind === ki).length;
    const m = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 3), k.mat, Math.max(n, 1)); m.count = n; root.add(m); return m;
  });
  const bondMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xcdb98e, metalness: 0.7, roughness: 0.3 }), bonds.length);
  root.add(bondMesh);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.008, 8, 200), new THREE.MeshBasicMaterial({ color: C.champagne, transparent: true, opacity: 0.4 }));
  halo.rotation.x = Math.PI / 2.2; scene.add(halo);
  const halo2 = halo.clone(); halo2.scale.setScalar(0.82); halo2.rotation.set(Math.PI / 1.9, 0.5, 0); halo2.material = new THREE.MeshBasicMaterial({ color: C.sage, transparent: true, opacity: 0.3 }); scene.add(halo2);
  const fx = sparkles(coarse ? 120 : 240, [5, 3.5, 3], C.sage, 0.04, 0.55); scene.add(fx);
  const pos = atoms.map(() => new THREE.Vector3()), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
  let born = 0;
  canvas.addEventListener('click', () => { atoms.forEach(a => { a.start.randomDirection().multiplyScalar(rand(3.5, 6)); a.delay = rand(0, 1); }); born = ctx.time; });
  return {
    update(t, dt, s) {
      const local = t - born, counters = [0, 0, 0, 0], prog = [];
      atoms.forEach((a, i) => {
        const p = easeBack((local - a.delay) / 1.6); prog[i] = p;
        pos[i].lerpVectors(a.start, a.target, p);
        if (p >= 0.999) pos[i].y += Math.sin(t * 1.4 + i * 0.4) * 0.025;
        const r = kinds[a.kind].r * (0.4 + 0.6 * clamp(p * 1.3));
        m4.compose(pos[i], q.identity(), sc.setScalar(r));
        meshes[a.kind].setMatrixAt(counters[a.kind]++, m4);
      });
      meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; });
      bonds.forEach(([a, b], i) => {
        const p = Math.min(prog[a], prog[b]), d = v.subVectors(pos[b], pos[a]), L = d.length();
        q.setFromUnitVectors(up, d.normalize());
        const mid = pos[a].clone().add(pos[b]).multiplyScalar(0.5);
        m4.compose(mid, q, sc.set(clamp(p * 1.2), L * clamp((p - 0.6) * 2.5), clamp(p * 1.2)));
        bondMesh.setMatrixAt(i, m4);
      });
      bondMesh.instanceMatrix.needsUpdate = true;
      root.rotation.y = t * 0.22 + s.px * 0.6; root.rotation.x = s.py * 0.3; root.rotation.z = 0.32;
      root.position.y = -s.scroll * 0.6;
      halo.rotation.z = t * 0.1; halo2.rotation.z = -t * 0.14; fx.rotation.y = t * 0.03;
    },
  };
}

// PROCUREMENT — "Supply Network": a dotted globe with inbound sourcing lanes and outbound distribution lanes.
function sceneGlobe(ctx) {
  const { scene, camera } = ctx;
  camera.position.set(0, 0, 7.4);
  const R = 1.45, outer = new THREE.Group(), inner = new THREE.Group(); outer.add(inner); scene.add(outer);
  const ll = (lat, lon, r = R) => { const p = (90 - lat) * Math.PI / 180, th = (lon + 180) * Math.PI / 180; return new THREE.Vector3(-r * Math.sin(p) * Math.cos(th), r * Math.cos(p), r * Math.sin(p) * Math.sin(th)); };
  inner.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 64, 48), new THREE.MeshPhysicalMaterial({ color: 0x1d4f41, roughness: 0.5, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.25, emissive: 0x0f2a23, emissiveIntensity: 0.4 })));
  const n = coarse ? 2600 : 5200, dp = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963; dp[i * 3] = Math.cos(th) * r * R; dp[i * 3 + 1] = y * R; dp[i * 3 + 2] = Math.sin(th) * r * R; }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  inner.add(new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xcdebd8, size: 0.04, map: dot(), transparent: true, opacity: 0.9, depthWrite: false })));
  const gridMat = new THREE.MeshBasicMaterial({ color: C.champagne, transparent: true, opacity: 0.18, depthWrite: false });
  [-60, -30, 0, 30, 60].forEach(lat => { const r = R * Math.cos(lat * Math.PI / 180) * 1.003; const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0035, 4, 160), gridMat); m.rotation.x = Math.PI / 2; m.position.y = R * Math.sin(lat * Math.PI / 180); inner.add(m); });
  [0, 45, 90, 135].forEach(lon => { const m = new THREE.Mesh(new THREE.TorusGeometry(R * 1.003, 0.0035, 4, 200), gridMat); m.rotation.y = lon * Math.PI / 180; inner.add(m); });
  // Fresnel atmosphere
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.16, 64, 48), new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { c: { value: new THREE.Color(C.sage) } },
    vertexShader: 'varying vec3 vN;varying vec3 vV;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'uniform vec3 c;varying vec3 vN;varying vec3 vV;void main(){float f=pow(1.-abs(dot(vN,vV)),2.2);gl_FragColor=vec4(c,f*.75);}',
  }));
  scene.add(atmo);
  // Generic Indonesia hub (no address or city shown) and lanes
  const hub = ll(-4, 113);
  const inbound = [[37.57, 126.98], [23.13, 113.26], [31.23, 121.47], [35.68, 139.69], [48.86, 2.35], [19.07, 72.88], [1.35, 103.82]];
  const outbound = [[-6.2, 106.8], [-7.25, 112.75], [-5.14, 119.4], [0.03, 109.3], [-1.27, 116.8], [3.59, 98.67], [-8.65, 115.2], [1.47, 124.84], [-2.53, 140.7], [-0.95, 100.35], [-3.7, 128.18]];
  const lanes = [];
  const lane = (from, to, color, h) => {
    const mid = from.clone().add(to).multiplyScalar(0.5); const lift = R + from.distanceTo(to) * h;
    mid.normalize().multiplyScalar(lift);
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const geo = new THREE.TubeGeometry(curve, 64, 0.007, 6, false);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    geo.setDrawRange(0, 0); inner.add(mesh);
    const pulse = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pulse.scale.setScalar(0.13); inner.add(pulse);
    lanes.push({ curve, geo, total: geo.index.count, pulse, delay: lanes.length * 0.18, speed: rand(0.18, 0.3), off: Math.random() });
  };
  inbound.forEach(p => lane(ll(p[0], p[1]), hub, C.champagne, 0.55));
  outbound.forEach(p => lane(hub, ll(p[0], p[1]), C.sage, 0.6));
  const hubDot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 16), new THREE.MeshBasicMaterial({ color: C.champagne2 })); hubDot.position.copy(hub); inner.add(hubDot);
  const rings = [0, 1, 2].map(() => { const r = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.075, 48), new THREE.MeshBasicMaterial({ color: C.champagne, transparent: true, side: THREE.DoubleSide, depthWrite: false })); r.position.copy(hub.clone().multiplyScalar(1.002)); r.lookAt(hub.clone().multiplyScalar(2)); inner.add(r); return r; });
  inner.quaternion.setFromUnitVectors(hub.clone().normalize(), new THREE.Vector3(-0.12, 0.12, 1).normalize());
  const stars = sparkles(coarse ? 120 : 260, [6, 4, 3], C.champagne2, 0.03, 0.5); stars.position.z = -2; scene.add(stars);
  return {
    update(t, dt, s) {
      outer.rotation.y = Math.sin(t * 0.18) * 0.22 + s.px * 0.45; outer.rotation.x = s.py * 0.25;
      outer.position.y = 0.15 - s.scroll * 0.5;
      lanes.forEach(l => {
        const p = ease((t - 0.4 - l.delay) / 1.6); l.geo.setDrawRange(0, Math.floor(l.total * p / 3) * 3);
        const k = (t * l.speed + l.off) % 1; l.pulse.position.copy(l.curve.getPoint(k)); l.pulse.material.opacity = p * Math.sin(k * Math.PI);
      });
      rings.forEach((r, i) => { const k = (t * 0.5 + i / 3) % 1; r.scale.setScalar(1 + k * 4); r.material.opacity = (1 - k) * 0.8; });
      stars.rotation.y = t * 0.01;
    },
  };
}

// COMPLIANCE — "Verification Crystal": a faceted crystal passed by a scanning light, on a hex lattice.
function sceneCrystal(ctx) {
  const { scene, camera } = ctx;
  camera.position.set(0, 1.1, 7.2); camera.lookAt(0, 0.1, 0);
  const g = new THREE.Group(); scene.add(g);
  const cg = new THREE.OctahedronGeometry(1, 0); cg.scale(1, 1.55, 1);
  const crystal = new THREE.Mesh(cg, glass({ color: 0xf6efe2, thickness: 2, iridescence: 0.9, iridescenceIOR: 1.35, flatShading: true, attenuationColor: new THREE.Color(C.champagne2), attenuationDistance: 3 }));
  g.add(crystal);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), new THREE.MeshPhysicalMaterial({ color: C.champagne, metalness: 1, roughness: 0.15, emissive: C.champagne, emissiveIntensity: 0.25, flatShading: true }));
  core.scale.y = 1.5; g.add(core);
  const shell = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(2.05, 1)), new THREE.LineBasicMaterial({ color: C.sage, transparent: true, opacity: 0.22 }));
  g.add(shell);
  const orbits = [[2.35, C.champagne, 0.5], [2.65, C.sage, -0.35], [2.95, C.champagne2, 0.25]].map(([r, c, sp], i) => {
    const o = new THREE.Group(); o.rotation.set(Math.PI / 2 + (i - 1) * 0.35, i * 0.6, 0);
    o.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 6, 220), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45 })));
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: c })); bead.position.x = r; o.add(bead);
    g.add(o); return { o, sp };
  });
  // Scanning plane
  const scan = new THREE.Mesh(new THREE.CircleGeometry(2.7, 96), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { c: { value: new THREE.Color(C.champagne2) }, a: { value: 1 } },
    vertexShader: 'varying vec2 vU;void main(){vU=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform vec3 c;uniform float a;varying vec2 vU;void main(){float d=distance(vU,vec2(.5))*2.;float ring=smoothstep(.62,.7,d)*smoothstep(1.,.72,d);float fill=(1.-d)*.12;gl_FragColor=vec4(c,(ring*.55+fill)*a);}',
  }));
  scan.rotation.x = -Math.PI / 2; g.add(scan);
  // Verification wave
  const wave = new THREE.Mesh(new THREE.TorusGeometry(1, 0.01, 6, 160), new THREE.MeshBasicMaterial({ color: C.sage, transparent: true, depthWrite: false }));
  wave.rotation.x = Math.PI / 2; g.add(wave);
  // Hex lattice floor
  const hexes = [], hexGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.03, 6);
  for (let q = -9; q <= 9; q++) for (let r = -9; r <= 9; r++) {
    const x = 0.36 * (q + r / 2) * 1.04, z = 0.36 * r * 0.866 * 1.04; const d = Math.hypot(x, z);
    if (d < 3.6) hexes.push([x, z, d]);
  }
  const lattice = new THREE.InstancedMesh(hexGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.4, roughness: 0.4 }), hexes.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color(), deep = new THREE.Color(0x1c4537), glow = new THREE.Color(C.champagne);
  hexes.forEach(([x, z], i) => { m4.makeTranslation(x, 0, z); lattice.setMatrixAt(i, m4); lattice.setColorAt(i, deep); });
  lattice.position.y = -2.25; g.add(lattice);
  return {
    update(t, dt, s) {
      crystal.rotation.y = t * 0.35; core.rotation.y = -t * 0.8; shell.rotation.y = -t * 0.08; shell.rotation.x = t * 0.05;
      orbits.forEach(({ o, sp }) => { o.rotation.z += dt * sp; });
      const cyc = (t * 0.32) % 1, y = -1.9 + ease(cyc) * 3.8; scan.position.y = y;
      scan.scale.setScalar(0.45 + 0.55 * (1 - Math.abs(y) / 2.2)); scan.material.uniforms.a.value = Math.sin(cyc * Math.PI);
      crystal.material.emissive.setHex(C.champagne); crystal.material.emissiveIntensity = Math.max(0, 0.18 - Math.abs(y) * 0.08);
      const wk = (t * 0.32 + 0.1) % 1; wave.scale.setScalar(1 + wk * 3); wave.material.opacity = (1 - wk) * 0.6; wave.position.y = -2.2;
      hexes.forEach(([, , d], i) => { const p = Math.max(0, 1 - Math.abs(d - wk * 4) * 1.6); lattice.setColorAt(i, col.copy(deep).lerp(glow, p * 0.6)); });
      lattice.instanceColor.needsUpdate = true;
      g.rotation.y = s.px * 0.4; g.rotation.x = s.py * 0.15; g.position.y = 0.15 - s.scroll * 0.5;
    },
  };
}

// ABOUT — "Botanical Growth": a stem grows, leaves unfurl and a champagne bloom opens; tap to regrow.
function sceneBotanical(ctx) {
  const { scene, camera, canvas } = ctx;
  camera.position.set(0, 0.1, 7.6);
  const plant = new THREE.Group(); scene.add(plant);
  const stem = (pts, radius) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    const geo = new THREE.TubeGeometry(curve, 220, radius, 10, false);
    const mesh = new THREE.Mesh(geo, satin(0x3f7d5f, 0.45)); plant.add(mesh);
    return { curve, geo, mesh, total: geo.index.count };
  };
  const main = stem([[0, -2.6, 0], [0.35, -1.6, 0.2], [-0.25, -0.4, -0.1], [0.3, 0.8, 0.15], [-0.05, 1.9, 0]], 0.05);
  const b1 = stem([[0.05, -0.9, 0.05], [0.7, -0.3, 0.3], [1.25, 0.25, 0.1]], 0.028);
  const b2 = stem([[0.12, 0.35, 0.05], [-0.6, 0.85, -0.2], [-1.1, 1.35, 0]], 0.025);
  // Leaf geometry: bezier outline, cupped along its width
  const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.bezierCurveTo(0.28, 0.18, 0.32, 0.62, 0, 1); shape.bezierCurveTo(-0.32, 0.62, -0.28, 0.18, 0, 0);
  const leafGeo = new THREE.ShapeGeometry(shape, 18); const lp = leafGeo.attributes.position;
  for (let i = 0; i < lp.count; i++) { const x = lp.getX(i), y = lp.getY(i); lp.setZ(i, x * x * 1.6 - Math.sin(y * Math.PI) * 0.06); }
  leafGeo.computeVertexNormals();
  const leafMats = [C.leaf, 0x7dbb98, 0x4f9673].map(c => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.42, side: THREE.DoubleSide, sheen: 0.8, sheenColor: new THREE.Color(C.sage), clearcoat: 0.4, transmission: 0.12, thickness: 0.2 }));
  const leaves = [];
  const addLeaves = (s, n, size, start, tOff) => {
    for (let i = 0; i < n; i++) {
      const u = start + (i / n) * (0.92 - start), p = s.curve.getPoint(u), tan = s.curve.getTangent(u);
      const pivot = new THREE.Group(); pivot.position.copy(p);
      const leaf = new THREE.Mesh(leafGeo, leafMats[i % 3]); pivot.add(leaf);
      const side = i % 2 ? 1 : -1;
      pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
      pivot.rotateY(i * 2.4); leaf.rotation.z = side * 0.95;
      plant.add(pivot); leaves.push({ pivot, leaf, at: tOff + u, size: size * rand(0.8, 1.15), side, ph: rand(0, 6) });
    }
  };
  addLeaves(main, coarse ? 9 : 13, 0.62, 0.08, 0);
  addLeaves(b1, 4, 0.42, 0.25, 0.35);
  addLeaves(b2, 4, 0.4, 0.25, 0.6);
  // Bloom: pearl petals around a champagne heart
  const bloom = new THREE.Group(); bloom.position.copy(main.curve.getPoint(1)); plant.add(bloom);
  const petalGeo = new THREE.SphereGeometry(0.22, 24, 16); petalGeo.scale(0.55, 0.18, 1);
  const petals = [];
  for (let i = 0; i < 9; i++) { const pv = new THREE.Group(); pv.rotation.y = (i / 9) * Math.PI * 2; const pm = new THREE.Mesh(petalGeo, new THREE.MeshPhysicalMaterial({ color: 0xf7efe0, roughness: 0.3, sheen: 1, sheenColor: new THREE.Color(C.blush), clearcoat: 0.6 })); pm.position.z = 0.22; pv.add(pm); bloom.add(pv); petals.push(pv); }
  const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 3), new THREE.MeshPhysicalMaterial({ color: C.champagne, metalness: 1, roughness: 0.2, emissive: C.champagne, emissiveIntensity: 0.3 })); bloom.add(heart);
  const budsAt = [b1.curve.getPoint(1), b2.curve.getPoint(1)].map(p => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 3), metal(C.champagne2, 0.2)); m.position.copy(p); plant.add(m); return m; });
  const spores = sparkles(coarse ? 90 : 180, [3.2, 3, 1.6], C.champagne2, 0.045, 0.7); scene.add(spores);
  const sp = spores.geometry.attributes.position;
  let born = 0; canvas.addEventListener('click', () => { born = ctx.time; });
  return {
    update(t, dt, s) {
      const g = (t - born) / 5.2;
      [[main, 0], [b1, 0.3], [b2, 0.55]].forEach(([st, off]) => { const p = ease((g - off) / (off ? 0.55 : 0.85)); st.geo.setDrawRange(0, Math.floor(st.total * p / 3) * 3); });
      const wind = s.px * 0.25 + Math.sin(t * 0.7) * 0.06;
      leaves.forEach(l => { const k = easeBack((g * 1.05 - l.at * 0.85) / 0.35); l.pivot.scale.setScalar(Math.max(0.0001, k * l.size)); l.leaf.rotation.x = Math.sin(t * 1.3 + l.ph) * 0.12 + wind * l.side; });
      const bp = easeBack((g - 0.95) / 0.5);
      bloom.scale.setScalar(Math.max(0.0001, bp));
      petals.forEach((pv, i) => { pv.children[0].rotation.x = -0.15 - bp * 0.55 + Math.sin(t * 1.2 + i) * 0.04; });
      budsAt.forEach((b, i) => b.scale.setScalar(Math.max(0.0001, easeBack((g - 0.85 - i * 0.1) / 0.4))));
      plant.rotation.y = Math.sin(t * 0.25) * 0.5 + s.px * 0.5; plant.rotation.z = wind * 0.25; plant.rotation.x = s.py * 0.12;
      plant.position.y = 0.1 - s.scroll * 0.5;
      for (let i = 0; i < sp.count; i++) { let y = sp.getY(i) + dt * (0.12 + (i % 5) * 0.03); if (y > 3) y = -3; sp.setY(i, y); sp.setX(i, sp.getX(i) + Math.sin(t + i) * dt * 0.05); }
      sp.needsUpdate = true;
    },
  };
}

// CONTACT — "Liquid Ripple": a calm forest-green liquid surface that answers the pointer; tap to drop a ripple.
function sceneRipple(ctx) {
  const { scene, camera, canvas } = ctx;
  camera.position.set(0, 3.2, 5.6); camera.lookAt(0, -0.2, 0);
  scene.fog = new THREE.Fog(0x0f2a23, 4.5, 9.5);
  const seg = coarse ? 64 : 104, geo = new THREE.PlaneGeometry(18, 12, Math.round(seg * 1.4), seg); geo.rotateX(-Math.PI / 2);
  const surface = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0x27604f, roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04, iridescence: 0.4, envMapIntensity: 1.8 }));
  surface.position.y = -0.9; scene.add(surface);
  const P = geo.attributes.position, base = P.array.slice();
  const drops = [];
  const add = (x, z, amp) => { drops.push({ x, z, amp, born: ctx.time }); if (drops.length > 7) drops.shift(); };
  const bubble = new THREE.Mesh(icosphere(coarse ? 5 : 7), glass({ color: 0xf6efe0, thickness: 1.2, iridescence: 0.85, iridescenceIOR: 1.3 }));
  bubble.scale.setScalar(0.62); scene.add(bubble);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.012, 8, 120), metal(C.champagne, 0.2)); scene.add(halo);
  const halo2 = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.006, 8, 120), new THREE.MeshBasicMaterial({ color: C.sage, transparent: true, opacity: 0.55 })); scene.add(halo2);
  const fx = sparkles(coarse ? 70 : 150, [5, 1.6, 3], C.champagne2, 0.04, 0.6); fx.position.y = 0.8; scene.add(fx);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.9), hit = new THREE.Vector3();
  const toWater = e => { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.ray.intersectPlane(plane, hit); };
  let last = 0;
  canvas.addEventListener('pointermove', e => { if (ctx.time - last < 0.16) return; last = ctx.time; if (toWater(e)) add(hit.x, hit.z, 0.09); });
  canvas.addEventListener('click', e => { if (toWater(e)) add(hit.x, hit.z, 0.32); });
  let auto = 0;
  return {
    update(t, dt, s) {
      if (t > auto) { auto = t + rand(1.6, 2.8); add(rand(-3, 3), rand(-2.5, 1.5), rand(0.12, 0.22)); }
      while (drops.length && t - drops[0].born > 5.5) drops.shift();
      for (let i = 0; i < P.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        let y = Math.sin(x * 0.7 + t * 0.6) * 0.04 + Math.cos(z * 0.9 - t * 0.5) * 0.035;
        for (const d of drops) {
          const age = t - d.born, dist = Math.hypot(x - d.x, z - d.z), front = age * 1.9;
          if (dist < front + 0.4) y += d.amp * Math.exp(-age * 0.85) * Math.exp(-Math.max(0, dist - front) * 3) * Math.sin(dist * 4.2 - age * 7.5) / (1 + dist * 0.6);
        }
        P.array[i * 3 + 1] = y;
      }
      P.needsUpdate = true; geo.computeVertexNormals();
      const by = 0.55 + Math.sin(t * 1.1) * 0.16;
      bubble.position.set(s.px * 0.5, by, 0); bubble.rotation.y = t * 0.3;
      halo.position.copy(bubble.position); halo.rotation.set(Math.PI / 2 + Math.sin(t * 0.7) * 0.25, 0, t * 0.4);
      halo2.position.copy(bubble.position); halo2.rotation.set(Math.PI / 2.4, t * 0.3, 0);
      fx.rotation.y = t * 0.02;
      camera.position.x = s.px * 0.6; camera.position.y = 3.2 - s.py * 0.3 - s.scroll * 0.6; camera.lookAt(0, -0.2, 0);
    },
  };
}

const SCENES = {
  index: [sceneDroplet, 'Serum droplet · interaktif'],
  catalog: [sceneCarousel, 'Product orbit · geser'],
  'private-label': [sceneMolecule, 'Formulation · ketuk'],
  procurement: [sceneGlobe, 'Supply network'],
  compliance: [sceneCrystal, 'Verification scan'],
  about: [sceneBotanical, 'Botanical growth · ketuk'],
  contact: [sceneRipple, 'Liquid ripple · sentuh'],
};

/* ───────────────────────── Stage runtime ───────────────────────── */

function mountStage() {
  const entry = SCENES[page];
  if (!entry) return;
  const stage = page === 'index' ? document.querySelector('.hero-panel[data-hero-3d]') : document.querySelector('main>.card:first-child');
  if (!stage) return;
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'bt-canvas'; canvas.setAttribute('aria-hidden', 'true');
  if (page !== 'index') stage.classList.add('bt-stage');
  page === 'index' ? stage.prepend(canvas) : stage.append(canvas);
  const hint = document.createElement('div'); hint.className = 'bt-hint'; hint.textContent = entry[1]; hint.setAttribute('aria-hidden', 'true');
  stage.append(hint);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { canvas.remove(); hint.remove(); stage.classList.remove('bt-stage'); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.5 : 1.8));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  scene.environment = studioEnvironment(renderer);
  addLights(scene);
  const ctx = { scene, camera, canvas, renderer, time: 0 };
  const sceneApi = entry[0](ctx);
  const baseZ = camera.position.z;

  const state = { px: 0, py: 0, tx: 0, ty: 0, vx: 0, vy: 0, scroll: 0 };
  stage.addEventListener('pointermove', e => { const r = stage.getBoundingClientRect(); state.tx = ((e.clientX - r.left) / r.width) * 2 - 1; state.ty = ((e.clientY - r.top) / r.height) * 2 - 1; });
  stage.addEventListener('pointerleave', () => { state.tx = 0; state.ty = 0; });
  if (!coarse && page !== 'index') addEventListener('pointermove', e => { if (stage.matches(':hover')) return; state.tx = (e.clientX / innerWidth) * 2 - 1; state.ty = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    // Keep the subject framed on narrow stages by pulling the camera back
    camera.position.z = baseZ * (camera.aspect < 1 ? Math.min(1.7, 1 / Math.max(camera.aspect, 0.55)) : 1);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas); resize();

  let visible = true, running = false, last = performance.now(), t = 0, raf = 0;
  const frame = now => {
    raf = 0; if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt; ctx.time = t;
    const k = Math.min(1, dt * 4), ox = state.px, oy = state.py;
    state.px += (state.tx - state.px) * k; state.py += (state.ty - state.py) * k;
    state.vx = state.px - ox; state.vy = state.py - oy;
    const r = stage.getBoundingClientRect(); state.scroll = clamp(-r.top / Math.max(1, r.height));
    sceneApi.update(t, dt, state);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  const start = () => { if (running || reduced || !visible || document.hidden) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); };
  const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; visible ? start() : stop(); }, { rootMargin: '80px' }).observe(stage);
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); stop(); stage.classList.remove('bt-live'); });

  // First frame: a composed still (also the reduced-motion frame)
  t = reduced ? 6 : 0.016; ctx.time = t;
  sceneApi.update(t, 0.016, state); renderer.render(scene, camera);
  requestAnimationFrame(() => stage.classList.add('bt-live'));
  start();
}

/* ───────────────────────── Page reactions: progress, reveal, tilt ───────────────────────── */

function mountChrome() {
  const body = document.body;
  const bar = document.createElement('div'); bar.className = 'bt-progress'; bar.setAttribute('aria-hidden', 'true'); body.append(bar);
  let ticking = false;
  const onScroll = () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.setProperty('--bt-p', max > 0 ? (scrollY / max).toFixed(4) : 0);
      body.classList.toggle('bt-scrolled', scrollY > 12);
    });
  };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  if (!reduced && 'IntersectionObserver' in window) {
    const sel = page === 'index'
      ? '.section-head,.about-copy,.about-aside,.category,.feature,.step,.compliance>div,.compliance-card,.cta,.contact-grid>div,#hero-following-stats .stat'
      : 'main>section>*,main section .grid>*:not(script)';
    const targets = [...document.querySelectorAll(sel)].filter(el => !el.closest('#ailLeadGate,#ail-promo-popup-root')).slice(0, 80);
    const groups = new Map();
    targets.forEach(el => { const n = groups.get(el.parentElement) || 0; groups.set(el.parentElement, n + 1); el.style.setProperty('--bt-delay', Math.min(n, 6) * 80 + 'ms'); el.classList.add('bt-reveal'); });
    const io = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('bt-in'); io.unobserve(en.target); } }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    targets.forEach(el => io.observe(el));
    document.documentElement.classList.add('bt-ready');
    // Safety net: never leave content hidden
    setTimeout(() => targets.forEach(el => { const r = el.getBoundingClientRect(); if (r.top < innerHeight) el.classList.add('bt-in'); }), 2500);
  }

  if (!reduced && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const tiltSel = page === 'index' ? '.category,.feature,.step,.compliance-card' : 'main section .card .card,main section .rounded-2xl.border';
    document.querySelectorAll(tiltSel).forEach(el => {
      if (el.querySelector('input,select,textarea,form') || el.closest('form') || el.offsetWidth > 720) return;
      el.classList.add('bt-tilt');
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.classList.add('bt-tilting');
        el.style.setProperty('--bt-rx', ((0.5 - y) * 7).toFixed(2) + 'deg'); el.style.setProperty('--bt-ry', ((x - 0.5) * 9).toFixed(2) + 'deg');
        el.style.setProperty('--bt-lift', '-4px'); el.style.setProperty('--bt-gx', x * 100 + '%'); el.style.setProperty('--bt-gy', y * 100 + '%'); el.style.setProperty('--bt-glare', '1');
      });
      el.addEventListener('pointerleave', () => { el.classList.remove('bt-tilting'); ['--bt-rx', '--bt-ry', '--bt-lift', '--bt-glare'].forEach(k => el.style.removeProperty(k)); });
    });
  }
}

const boot = () => {
  try { mountChrome(); } catch (e) { console.warn('[AIL CGI] chrome', e); }
  try { mountStage(); } catch (e) { console.warn('[AIL CGI] stage', e); }
};
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
