import * as THREE from "three";
import { mergeGeometries } from "../js/vendor/jsm/utils/BufferGeometryUtils.js";

export const SAMPLES = 900;
export const ROAD_HALF = 7.5;
export const CURB = 1.2;
export const WALL = 11.5;

const CONTROL = [
  [0, 0], [70, -6], [128, -40], [150, -100], [122, -160], [60, -178],
  [20, -150], [-10, -110], [-58, -118], [-112, -150], [-160, -112],
  [-168, -40], [-130, 18], [-70, 40],
];

const UP = new THREE.Vector3(0, 1, 0);

/** Centerline samples: P = point, T = travel direction, R = driver's right. */
export function createTrackData() {
  const curve = new THREE.CatmullRomCurve3(
    CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    "centripetal"
  );
  const P = [];
  const T = [];
  const R = [];
  for (let i = 0; i < SAMPLES; i++) {
    const u = i / SAMPLES;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).setY(0).normalize();
    P.push(p);
    T.push(t);
    R.push(new THREE.Vector3().crossVectors(t, UP).normalize());
  }
  const segment = P[0].distanceTo(P[1]);
  const track = { curve, P, T, R, segment, length: segment * SAMPLES };

  // Hard corners get a tyre barrier in front of the outside wall, so the solid edge moves in there.
  track.wallRight = new Float32Array(SAMPLES).fill(WALL);
  track.wallLeft = new Float32Array(SAMPLES).fill(WALL);
  track.tyres = [];
  for (let i = 0; i < SAMPLES; i++) {
    const bend = bendAt(track, i);
    if (Math.abs(bend) < 0.5) continue;
    const side = -Math.sign(bend);
    track.tyres.push({ i, side });
    const edge = side > 0 ? track.wallRight : track.wallLeft;
    for (let k = -1; k <= 1; k++) edge[wrap(i + k)] = WALL - TYRE_DEPTH;
  }
  return track;
}

const TYRE_SCALE = 1.6;
const TYRE_DEPTH = 0.6 * TYRE_SCALE;

export function wrap(i) {
  return ((i % SAMPLES) + SAMPLES) % SAMPLES;
}

/** Nearest centerline sample and signed distance to the right of it. */
export function project(track, pos, hint = null) {
  let best = 0;
  let bestD = Infinity;
  const scan = (i) => {
    const p = track.P[wrap(i)];
    const d = (pos.x - p.x) ** 2 + (pos.z - p.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = wrap(i);
    }
  };
  if (hint == null) {
    for (let i = 0; i < SAMPLES; i++) scan(i);
  } else {
    for (let k = -40; k <= 40; k++) scan(hint + k);
  }
  const p = track.P[best];
  const r = track.R[best];
  const lat = (pos.x - p.x) * r.x + (pos.z - p.z) * r.z;
  return { i: best, lat };
}

/**
 * Quads between neighbouring samples; corners are (sideOffset, height).
 * UVs: u runs a→b over [0, uSpan], v runs along the track at one unit per vTile metres.
 */
function ribbon(track, { a, b, step = 1, uSpan = 1, vTile = 4, keep = () => true }) {
  const pos = [];
  const uv = [];
  const put = (i, [off, y], u) => {
    const p = track.P[wrap(i)];
    const r = track.R[wrap(i)];
    pos.push(p.x + r.x * off, y, p.z + r.z * off);
    uv.push(u * uSpan, (i * track.segment) / vTile);
  };
  for (let i = 0; i < SAMPLES; i += step) {
    if (!keep(i)) continue;
    const j = i + step;
    put(i, a, 0); put(i, b, 1); put(j, a, 0);
    put(i, b, 1); put(j, b, 1); put(j, a, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/** How hard the track turns around sample i: signed, positive when bending to the driver's right. */
export function bendAt(track, i, reach = 12) {
  const a = track.T[wrap(i - reach)];
  const b = track.T[wrap(i + reach)];
  const angle = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  return angle * Math.sign(b.clone().sub(a).dot(track.R[wrap(i)]) || 1);
}

/**
 * Two crossed upright planes, base at y = 0: the classic cheap tree. Each plane is doubled
 * back-to-back (front faces only) so both sides get the same rounded, upward-leaning normals.
 */
function crossedPlanes(w, h) {
  const one = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
  const geo = mergeGeometries([0, 1, 2, 3].map((k) => one.clone().rotateY((k * Math.PI) / 2)));
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  for (let k = 0; k < p.count; k++) {
    const v = new THREE.Vector3(p.getX(k), w * 0.6, p.getZ(k)).normalize();
    n.setXYZ(k, v.x, v.y, v.z);
  }
  return geo;
}

function farFromTrack(track, p, clearance) {
  for (let k = 0; k < SAMPLES; k += 3) {
    if (track.P[k].distanceToSquared(p) < clearance ** 2) return false;
  }
  return true;
}

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

export const BOOST_PADS = [
  { i: 70, lat: 0 },
  { i: 330, lat: -3 },
  { i: 610, lat: 3 },
];

function canvasTexture(w, h, draw, { repeat = false } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Boost pads: a glowing panel whose chevrons scroll forward, a pulsing halo, and two
 * crossed curtains of light rising off the pad. All unlit and additive, animated per frame.
 */
function buildBoostPads(scene, track) {
  const arrows = canvasTexture(128, 128, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#ff7a00");
    bg.addColorStop(1, "#ffb300");
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#fff6c2";
    g.beginPath();
    g.moveTo(w * 0.5, h * 0.12);
    g.lineTo(w * 0.92, h * 0.55);
    g.lineTo(w * 0.72, h * 0.55);
    g.lineTo(w * 0.5, h * 0.33);
    g.lineTo(w * 0.28, h * 0.55);
    g.lineTo(w * 0.08, h * 0.55);
    g.closePath();
    g.fill();
  }, { repeat: true });
  arrows.repeat.set(1, 2.5);
  const halo = canvasTexture(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    r.addColorStop(0, "rgba(255,210,90,1)");
    r.addColorStop(1, "rgba(255,120,0,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
  const beams = canvasTexture(256, 256, (g, w, h) => {
    const rand = seeded(11);
    for (let k = 0; k < 26; k++) {
      const x = rand() * w;
      const bw = 2 + rand() * 7;
      const y0 = rand() * h;
      const len = 40 + rand() * 120;
      const grad = g.createLinearGradient(0, y0, 0, y0 + len);
      grad.addColorStop(0, "rgba(255,240,180,0)");
      grad.addColorStop(0.5, `rgba(255,${190 + rand() * 60},80,${0.5 + rand() * 0.5})`);
      grad.addColorStop(1, "rgba(255,240,180,0)");
      g.fillStyle = grad;
      g.fillRect(x, y0, bw, len);
      g.fillRect(x, y0 - h, bw, len);
    }
  }, { repeat: true });
  const fade = canvasTexture(4, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#000");
    grad.addColorStop(1, "#fff");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  fade.colorSpace = THREE.NoColorSpace;

  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false };
  const panelMat = new THREE.MeshBasicMaterial({ map: arrows, toneMapped: false });
  const haloMat = new THREE.MeshBasicMaterial({ map: halo, ...additive, opacity: 0.7 });
  const beamMat = new THREE.MeshBasicMaterial({ map: beams, alphaMap: fade, side: THREE.DoubleSide, ...additive });

  for (const pad of BOOST_PADS) {
    const { i, lat } = pad;
    const group = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(3, 5), panelMat);
    panel.rotation.x = -Math.PI / 2;
    panel.position.y = 0.06;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 7.5), haloMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.08;
    group.add(panel, glow);
    for (const turn of [0, Math.PI / 2]) {
      const curtain = new THREE.Mesh(new THREE.PlaneGeometry(turn ? 3 : 5, 2.6), beamMat);
      curtain.position.y = 1.3;
      curtain.rotation.y = turn;
      group.add(curtain);
    }
    const p = track.P[i];
    const r = track.R[i];
    group.position.set(p.x + r.x * lat, 0, p.z + r.z * lat);
    group.rotation.y = Math.atan2(track.T[i].x, track.T[i].z);
    panel.rotation.z = Math.PI;
    scene.add(group);
  }

  return {
    update(time, dt) {
      arrows.offset.y -= dt * 2.4;
      beams.offset.y -= dt * 0.9;
      haloMat.opacity = 0.55 + 0.3 * Math.sin(time * 9);
    },
  };
}

const BILLBOARDS = [
  { i: 40, side: 1, tex: "banner-ads-1" },
  { i: 150, side: -1, tex: "banner-ads-2" },
  { i: 265, side: 1, tex: "banner-ads-1" },
  { i: 400, side: -1, tex: "banner-ads-2" },
  { i: 520, side: 1, tex: "banner-ads-2" },
  { i: 690, side: -1, tex: "banner-ads-1" },
  { i: 800, side: 1, tex: "banner-ads-2" },
];

/** Where a point `lat` metres to the right of sample i sits, and which way faces the road. */
function beside(track, i, lat) {
  const p = track.P[wrap(i)].clone().addScaledVector(track.R[wrap(i)], lat);
  const n = track.R[wrap(i)].clone().multiplyScalar(-Math.sign(lat));
  return { p, yaw: Math.atan2(n.x, n.z) };
}

export function buildTrackMeshes(scene, track, assets) {
  const { asphalt, grass, concrete, metal, generated: gen } = assets;

  // Ground: Poly Haven aerial grass, tiled every 12 m.
  grass.map.repeat.set(75, 75);
  grass.normalMap.repeat.set(75, 75);
  grass.roughnessMap.repeat.set(75, 75);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({ ...grass, color: 0xb4d48c, normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 0.4 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Road: asphalt, one texture tile per 5 m in both directions.
  const road = new THREE.Mesh(
    ribbon(track, { a: [-ROAD_HALF, 0.02], b: [ROAD_HALF, 0.02], uSpan: (ROAD_HALF * 2) / 5, vTile: 5 }),
    new THREE.MeshStandardMaterial({ ...asphalt, color: 0xb8b8b8, side: THREE.DoubleSide })
  );
  road.receiveShadow = true;
  scene.add(road);

  const linePaint = new THREE.MeshStandardMaterial({
    color: 0xf4f4ef, roughness: 0.55, roughnessMap: asphalt.roughnessMap, normalMap: asphalt.normalMap,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  const centre = new THREE.Mesh(
    ribbon(track, { a: [-0.18, 0.03], b: [0.18, 0.03], uSpan: 0.07, vTile: 5, keep: (i) => i % 14 < 7 }),
    linePaint
  );
  centre.receiveShadow = true;
  scene.add(centre);

  // Curbs: generated red/white kerb texture, stripes turned to run across the road.
  const curbTex = gen.curb;
  curbTex.center.set(0.5, 0.5);
  curbTex.rotation = Math.PI / 2;
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7, normalMap: concrete.normalMap });
  // Walls: Poly Haven concrete, 1.1 m high, one tile per 2.2 m.
  const wallMat = new THREE.MeshStandardMaterial({
    ...concrete, color: new THREE.Color(1.7, 1.7, 1.7), envMapIntensity: 1.6, side: THREE.DoubleSide,
  });
  for (const side of [-1, 1]) {
    const inner = side * ROAD_HALF;
    const outer = side * (ROAD_HALF + CURB);
    const curb = new THREE.Mesh(
      ribbon(track, { a: [Math.min(inner, outer), 0.04], b: [Math.max(inner, outer), 0.04], vTile: 4 }),
      curbMat
    );
    curb.receiveShadow = true;
    scene.add(curb);
    const wall = new THREE.Mesh(
      ribbon(track, { a: [side * WALL, 0], b: [side * WALL, 1.1], step: 2, uSpan: 0.5, vTile: 2.2 }),
      wallMat
    );
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  }

  // Start line and boost pads.
  const startLine = new THREE.Group();
  const tile = new THREE.PlaneGeometry(1, 1);
  const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < ROAD_HALF * 2; col++) {
      const sq = new THREE.Mesh(tile, (row + col) % 2 ? black : white);
      sq.rotation.x = -Math.PI / 2;
      sq.position.set(col - ROAD_HALF + 0.5, 0.05, row - 1);
      sq.receiveShadow = true;
      startLine.add(sq);
    }
  }
  startLine.position.copy(track.P[0]);
  startLine.rotation.y = Math.atan2(track.T[0].x, track.T[0].z);
  scene.add(startLine);

  const pads = buildBoostPads(scene, track);

  // Start/finish gantry: steel posts and the generated START · FINISH banner.
  const steel = new THREE.MeshStandardMaterial({ ...metal, color: 0x9aa3ad, metalness: 1 });
  const gantry = new THREE.Group();
  const span = (ROAD_HALF + CURB + 0.8) * 2;
  for (const x of [-span / 2, span / 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 10, 0.5), steel);
    post.position.set(x, 5, 0);
    post.castShadow = true;
    gantry.add(post);
  }
  const startTex = gen["banner-start"];
  startTex.wrapT = THREE.ClampToEdgeWrapping;
  startTex.repeat.set(1, 0.35);
  startTex.offset.set(0, 0.53);
  const bannerH = span / ((startTex.userData.aspect || 1.5) / 0.35);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, bannerH + 0.4, 0.3), steel);
  beam.position.y = 7.5;
  beam.castShadow = true;
  const startFace = new THREE.MeshStandardMaterial({ map: startTex, roughness: 0.5 });
  for (const z of [-0.16, 0.16]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(span - 0.2, bannerH), startFace);
    face.position.set(0, 7.5, z);
    if (z < 0) face.rotation.y = Math.PI;
    gantry.add(face);
  }
  gantry.add(beam);
  gantry.position.copy(track.P[0]);
  gantry.rotation.y = Math.atan2(track.T[0].x, track.T[0].z);
  scene.add(gantry);

  // Sponsor billboards behind the wall, on steel legs.
  for (const b of BILLBOARDS) {
    const { p, yaw } = beside(track, b.i, b.side * (WALL + 2.5));
    const tex = gen[b.tex];
    const w = 8;
    const h = w / (tex.userData.aspect || 1.5);
    const board = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }));
    face.position.set(0, 1.6 + h / 2, 0.08);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.12), steel);
    back.position.set(0, 1.6 + h / 2, 0);
    back.castShadow = true;
    board.add(face, back);
    for (const x of [-w / 3, w / 3]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.7, 0.22), steel);
      leg.position.set(x, 0.85, -0.05);
      leg.castShadow = true;
      board.add(leg);
    }
    board.position.copy(p);
    board.rotation.y = yaw;
    scene.add(board);
  }

  // Tyre barriers: Poly Haven old tyre, stacked against the outside wall of every hard corner.
  const stacks = track.tyres.map(({ i, side }) => beside(track, i, side * (WALL - TYRE_DEPTH / 2)).p);
  const HIGH = 2;
  const thick = 0.165 * TYRE_SCALE;
  const tyreMesh = assets.tyre;
  const tyres = new THREE.InstancedMesh(tyreMesh.geometry, tyreMesh.material, stacks.length * HIGH);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(TYRE_SCALE, TYRE_SCALE, TYRE_SCALE);
  stacks.forEach((p, k) => {
    for (let h = 0; h < HIGH; h++) {
      q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, k * 1.7 + h * 2.3));
      m.compose(new THREE.Vector3(p.x, thick / 2 + h * thick, p.z), q, s);
      tyres.setMatrixAt(k * HIGH + h, m);
    }
  });
  tyres.castShadow = true;
  tyres.receiveShadow = true;
  scene.add(tyres);

  // Foliage: generated photo cut-outs on crossed planes, alpha-tested so shadows keep the silhouette.
  const rand = seeded(7);
  const kinds = [
    { tex: gen["toon-pine"] || gen["tree-pine"], h: 11, count: 110, near: WALL + 5, far: 45 },
    { tex: gen["toon-broadleaf"] || gen["tree-broadleaf"], h: 8.5, count: 70, near: WALL + 5, far: 45 },
    { tex: gen["toon-bush"] || gen.bush, h: 2.2, count: 120, near: WALL + 2, far: 14 },
  ];
  for (const kind of kinds) {
    const spots = [];
    let tries = 0;
    while (spots.length < kind.count && tries++ < kind.count * 30) {
      const i = Math.floor(rand() * SAMPLES);
      const side = rand() < 0.5 ? -1 : 1;
      const off = side * (kind.near + rand() * kind.far);
      const p = track.P[i].clone().addScaledVector(track.R[i], off);
      if (farFromTrack(track, p, kind.near - 1)) spots.push({ p, s: 0.75 + rand() * 0.5, yaw: rand() * Math.PI });
    }
    const w = kind.h * (kind.tex.userData.aspect || 1);
    const mesh = new THREE.InstancedMesh(
      crossedPlanes(w, kind.h),
      new THREE.MeshStandardMaterial({ map: kind.tex, alphaTest: 0.5, roughness: 0.9 }),
      spots.length
    );
    spots.forEach(({ p, s: k, yaw }, n) => {
      q.setFromAxisAngle(UP, yaw);
      m.compose(p, q, new THREE.Vector3(k, k, k));
      mesh.setMatrixAt(n, m);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  return { update: pads.update };
}
