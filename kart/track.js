import * as THREE from "../js/vendor/three.module.js";

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
  return { curve, P, T, R, segment, length: segment * SAMPLES };
}

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

/** Quads between neighbouring samples; corners are (sideOffset, height). */
function ribbon(track, { a, b, colorAt, step = 1 }) {
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  const put = (i, [off, y]) => {
    const p = track.P[wrap(i)];
    const r = track.R[wrap(i)];
    pos.push(p.x + r.x * off, y, p.z + r.z * off);
    col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < SAMPLES; i += step) {
    c.set(colorAt(i));
    const j = i + step;
    put(i, a); put(i, b); put(j, a);
    put(i, b); put(j, b); put(j, a);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
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

export function buildTrackMeshes(scene, track) {
  const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({ color: 0x5fb84a, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const road = new THREE.Mesh(
    ribbon(track, { a: [-ROAD_HALF, 0.02], b: [ROAD_HALF, 0.02], colorAt: () => 0x4b5059 }),
    paint
  );
  road.receiveShadow = true;
  scene.add(road);

  scene.add(new THREE.Mesh(
    ribbon(track, {
      a: [-0.18, 0.03], b: [0.18, 0.03],
      colorAt: (i) => (i % 14 < 7 ? 0xffffff : 0x4b5059),
    }),
    paint
  ));

  for (const side of [-1, 1]) {
    const inner = side * ROAD_HALF;
    const outer = side * (ROAD_HALF + CURB);
    scene.add(new THREE.Mesh(
      ribbon(track, {
        a: [Math.min(inner, outer), 0.04], b: [Math.max(inner, outer), 0.04],
        colorAt: (i) => (i % 10 < 5 ? 0xe53935 : 0xffffff),
      }),
      paint
    ));
    const wall = new THREE.Mesh(
      ribbon(track, {
        a: [side * WALL, 0], b: [side * WALL, 1.1], step: 3,
        colorAt: (i) => (i % 12 < 6 ? 0x1e63d6 : 0xf5f5f5),
      }),
      paint
    );
    wall.castShadow = true;
    scene.add(wall);
  }

  const startLine = new THREE.Group();
  const tile = new THREE.PlaneGeometry(1, 1);
  const black = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const p0 = track.P[0];
  const yaw0 = Math.atan2(track.T[0].x, track.T[0].z);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < ROAD_HALF * 2; col++) {
      const sq = new THREE.Mesh(tile, (row + col) % 2 ? black : white);
      sq.rotation.x = -Math.PI / 2;
      sq.position.set(col - ROAD_HALF + 0.5, 0.05, row - 1);
      startLine.add(sq);
    }
  }
  startLine.position.copy(p0);
  startLine.rotation.y = yaw0;
  scene.add(startLine);

  const padMat = new THREE.MeshStandardMaterial({ color: 0xffd400, emissive: 0xff9900, emissiveIntensity: 0.6 });
  for (const pad of BOOST_PADS) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 5), padMat);
    const p = track.P[pad.i];
    const r = track.R[pad.i];
    mesh.position.set(p.x + r.x * pad.lat, 0.06, p.z + r.z * pad.lat);
    mesh.rotation.set(-Math.PI / 2, 0, Math.atan2(track.T[pad.i].x, track.T[pad.i].z));
    scene.add(mesh);
  }

  const rand = seeded(7);
  const spots = [];
  while (spots.length < 160) {
    const i = Math.floor(rand() * SAMPLES);
    const side = rand() < 0.5 ? -1 : 1;
    const off = side * (WALL + 4 + rand() * 30);
    const p = track.P[i].clone().addScaledVector(track.R[i], off);
    let clear = true;
    for (let k = 0; k < SAMPLES; k += 3) {
      if (track.P[k].distanceToSquared(p) < (WALL + 3) ** 2) {
        clear = false;
        break;
      }
    }
    if (clear) spots.push({ p, s: 0.8 + rand() * 0.9 });
  }
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.35, 0.45, 2.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x7a4b2a }),
    spots.length
  );
  const crowns = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.2, 5, 7),
    new THREE.MeshStandardMaterial({ color: 0x2e8b3d, roughness: 0.9 }),
    spots.length
  );
  const m = new THREE.Matrix4();
  spots.forEach(({ p, s }, k) => {
    m.makeScale(s, s, s).setPosition(p.x, 1.1 * s, p.z);
    trunks.setMatrixAt(k, m);
    m.makeScale(s, s, s).setPosition(p.x, 4.2 * s, p.z);
    crowns.setMatrixAt(k, m);
  });
  trunks.castShadow = true;
  crowns.castShadow = true;
  scene.add(trunks, crowns);
}
