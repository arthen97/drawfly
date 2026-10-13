/** MaleCNS soma point-cloud — connectome-gallery style brain viz. */

function roleColor(role, x, y, z) {
  // Spectral by AP (z) for bulk cells — same vibe as Janelia/Neuroglancer gallery renders
  if (role === 0) return [0.25, 0.95, 0.75]; // KC mint
  if (role === 1) return [0.2, 1.0, 0.55]; // DNp20 L
  if (role === 2) return [1.0, 0.45, 0.15]; // DNp20 R
  if (role === 3) return [0.85, 0.55, 1.0]; // DAN
  if (role === 4) return [0.35, 0.65, 1.0]; // visual/optic
  if (role === 5) return [1.0, 0.85, 0.25]; // descending
  const t = Math.max(0, Math.min(1, (z + 1) * 0.5));
  // soft rainbow
  const h = 0.55 + t * 0.45;
  const s = 0.65;
  const v = 0.85;
  return hsv(h % 1, s, v);
}

function hsv(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const m = i % 6;
  if (m === 0) return [v, t, p];
  if (m === 1) return [q, v, p];
  if (m === 2) return [p, v, t];
  if (m === 3) return [p, q, v];
  if (m === 4) return [t, p, v];
  return [v, p, q];
}

export async function loadMaleCnsBrain(THREE, { mat } = {}) {
  const meta = await fetch("/assets/malecns-soma.json").then((r) => r.json());
  const buf = await fetch("/assets/malecns-soma.bin").then((r) => r.arrayBuffer());
  const data = new Float32Array(buf);
  const n = meta.count || data.length / 4;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const baseColors = new Float32Array(n * 3);
  const roles = new Float32Array(n);
  const phases = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const x = data[o];
    const y = data[o + 1];
    const z = data[o + 2];
    const role = data[o + 3];
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    roles[i] = role;
    phases[i] = Math.random();
    const c = roleColor(role, x, y, z);
    colors.set(c, i * 3);
    baseColors.set(c, i * 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.022,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
  );

  const group = new THREE.Group();
  group.add(points);

  // translucent CNS shell silhouette
  if (mat) {
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 28, 20),
      mat(0x1a4038, {
        transparent: true,
        opacity: 0.07,
        roughness: 0.9,
        emissive: 0x0a2820,
        emissiveIntensity: 0.3,
      })
    );
    shell.scale.set(1.35, 0.95, 1.05);
    shell.position.y = 0.25;
    group.add(shell);
  }

  // DNp20 readout orbs at real soma centroids
  const orbGeo = new THREE.SphereGeometry(0.045, 14, 12);
  let orbL = null;
  let orbR = null;
  const findCentroid = (role) => {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let c = 0;
    for (let i = 0; i < n; i++) {
      if (roles[i] !== role) continue;
      sx += positions[i * 3];
      sy += positions[i * 3 + 1];
      sz += positions[i * 3 + 2];
      c += 1;
    }
    if (!c) return null;
    return new THREE.Vector3(sx / c, sy / c, sz / c);
  };
  const cL = findCentroid(1);
  const cR = findCentroid(2);
  if (cL && mat) {
    orbL = new THREE.Mesh(
      orbGeo,
      mat(0x3f9f82, { emissive: 0x3f9f82, emissiveIntensity: 1.4, transparent: true, opacity: 0.95 })
    );
    orbL.position.copy(cL);
    group.add(orbL);
  }
  if (cR && mat) {
    orbR = new THREE.Mesh(
      orbGeo,
      mat(0xd17a45, { emissive: 0xd17a45, emissiveIntensity: 1.4, transparent: true, opacity: 0.95 })
    );
    orbR.position.copy(cR);
    group.add(orbR);
  }

  group.scale.setScalar(0.95);

  return {
    group,
    points,
    geo,
    colors,
    baseColors,
    roles,
    phases,
    orbL,
    orbR,
    meta,
    count: n,
  };
}

/** Drive glow from live MaleCNS telemetry (engineered mapping for viz). */
export function updateMaleCnsBrain(brain, neural, t, energy = 0.3) {
  if (!brain) return;
  const n = neural || {};
  const leftHz = Number(n.left_hz || 0);
  const rightHz = Number(n.right_hz || 0);
  const kc = Number(n.KC_spikes || 0);
  const total = Math.max(1, Number(n.total_spikes || 1));
  const leftAct = 0.2 + Math.min(1, leftHz / 28) * 0.8;
  const rightAct = 0.2 + Math.min(1, rightHz / 28) * 0.8;
  const kcAct = 0.15 + Math.min(1, kc / Math.max(total * 0.04, 1)) * 0.95;
  const danAct =
    0.12 + Math.min(1, ((n.reward_spikes || 0) + (n.aversive_spikes || 0)) / 70) * 0.9;
  const pop = 0.25 + Math.min(1, total / 8000) * 0.75;

  const cols = brain.colors;
  const base = brain.baseColors;
  const roles = brain.roles;
  const phases = brain.phases;
  const wave = (Math.sin(t * 2.2) + 1) * 0.5;

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    const flicker = 0.55 + 0.45 * Math.sin(t * 16 + phases[i] * 20);
    let g = pop * flicker * (0.45 + 0.55 * wave);
    if (role === 0) g = kcAct * flicker;
    else if (role === 1) g = leftAct * flicker;
    else if (role === 2) g = rightAct * flicker;
    else if (role === 3) g = danAct * flicker;
    else if (role === 4) g = (0.35 + pop * 0.65) * flicker;
    else if (role === 5) g = (0.3 + energy * 0.7) * flicker;
    const bi = i * 3;
    cols[bi] = Math.min(1.4, base[bi] * (0.25 + g * 1.15));
    cols[bi + 1] = Math.min(1.4, base[bi + 1] * (0.25 + g * 1.15));
    cols[bi + 2] = Math.min(1.4, base[bi + 2] * (0.25 + g * 1.15));
  }
  brain.geo.attributes.color.needsUpdate = true;
  brain.points.material.size = 0.016 + kcAct * 0.018 + energy * 0.01 + pop * 0.008;

  if (brain.orbL) {
    brain.orbL.scale.setScalar(0.8 + leftAct * 1.8);
    brain.orbL.material.emissiveIntensity = 0.5 + leftAct * 2.4;
  }
  if (brain.orbR) {
    brain.orbR.scale.setScalar(0.8 + rightAct * 1.8);
    brain.orbR.material.emissiveIntensity = 0.5 + rightAct * 2.4;
  }
}
