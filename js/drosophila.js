/**
 * Anatomically structured Drosophila melanogaster (adult) — fresh build.
 * Hierarchy follows real tagmata & limb joints (not a reskin of the old blob fly).
 *
 * Scale: body length ≈ 0.36 world units (readable on paper; proportions entomological).
 * Skeleton:
 *   root → thorax
 *     head → eyes, antennae (scape→pedicel→funiculus→arista), proboscis, ocelli
 *     prothorax → forelegs (coxa→trochanter→femur→tibia→tarsomeres×5→pretarsus)
 *     mesothorax → wings, midlegs, notum/scutellum
 *     metathorax → halteres, hindlegs
 *     abdomen → tergites T1–T7 + genitalia tip
 *   pencil gripped by prothoracic pretarsi
 */

export function buildDrosophila(THREE, { mat } = {}) {
  const mkMat =
    mat ||
    ((color, o = {}) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: o.roughness ?? 0.55,
        metalness: o.metalness ?? 0.04,
        transparent: !!o.transparent,
        opacity: o.opacity ?? 1,
        emissive: o.emissive ?? 0x000000,
        emissiveIntensity: o.emissiveIntensity ?? 0,
        side: o.side ?? THREE.FrontSide,
      }));

  const M = {
    cuticle: mkMat(0x2a1c12, { roughness: 0.48 }),
    cuticleLite: mkMat(0x3d2a1c, { roughness: 0.52 }),
    thorax: mkMat(0x241810, { roughness: 0.42 }),
    abdomenDark: mkMat(0x1a120c, { roughness: 0.5 }),
    abdomenBand: mkMat(0x4a3420, { roughness: 0.55 }),
    eye: mkMat(0xc41810, {
      roughness: 0.18,
      metalness: 0.12,
      emissive: 0x4a0808,
      emissiveIntensity: 0.35,
    }),
    eyeFacet: mkMat(0x8a1008, { roughness: 0.25, metalness: 0.2 }),
    wing: mkMat(0xe8dcc8, { transparent: true, opacity: 0.28, roughness: 0.12, side: THREE.DoubleSide }),
    vein: mkMat(0x6a5a48, { roughness: 0.6 }),
    arista: mkMat(0x1a1410, { roughness: 0.7 }),
    haltere: mkMat(0x3a2a20, { roughness: 0.45 }),
    claw: mkMat(0x0e0a08, { roughness: 0.35 }),
    pulvillus: mkMat(0x5a4030, { roughness: 0.7 }),
    bristle: mkMat(0x100c0a, { roughness: 0.8 }),
  };

  const S = 1.0; // global scale factor on anatomical units (mm-ish → world)

  function seg(mat, r0, r1, len, radial = 8) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0 * S, r1 * S, len * S, radial), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  function ball(mat, r, segs = 14) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r * S, segs, segs - 2), mat);
    m.castShadow = true;
    return m;
  }

  /** Joint group: pivot at proximal end; child mesh centered along +Y. */
  function joint(len, mesh) {
    const g = new THREE.Group();
    mesh.position.y = (len * S) / 2;
    g.add(mesh);
    g.userData.length = len * S;
    return g;
  }

  // ——— Legs: coxa → trochanter → femur → tibia → tarsomeres (5) → pretarsus ———
  function buildLeg(side, pair /* 'fore'|'mid'|'hind' */) {
    const s = side; // -1 left, +1 right
    const root = new THREE.Group();
    root.userData = { side: s, pair };

    // lengths (relative anatomical ratios for Drosophila)
    const L =
      pair === "fore"
        ? { coxa: 0.028, tro: 0.012, fem: 0.07, tib: 0.068, tar: [0.018, 0.014, 0.012, 0.011, 0.01] }
        : pair === "mid"
          ? { coxa: 0.03, tro: 0.012, fem: 0.078, tib: 0.074, tar: [0.02, 0.015, 0.013, 0.012, 0.011] }
          : { coxa: 0.032, tro: 0.013, fem: 0.085, tib: 0.082, tar: [0.022, 0.016, 0.014, 0.012, 0.011] };

    const coxa = joint(L.coxa, seg(M.cuticle, 0.011, 0.01, L.coxa, 7));
    const trochanter = joint(L.tro, seg(M.cuticleLite, 0.009, 0.0085, L.tro, 6));
    const femur = joint(L.fem, seg(M.cuticle, 0.01, 0.008, L.fem, 8));
    const tibia = joint(L.tib, seg(M.cuticleLite, 0.0075, 0.006, L.tib, 7));

    // tibial bristles (macrochaetae suggestion)
    for (let i = 0; i < 3; i++) {
      const b = seg(M.bristle, 0.0012, 0.0006, 0.02, 3);
      b.position.set(s * 0.006, L.tib * S * (0.3 + i * 0.2), 0.004);
      b.rotation.z = s * 0.9;
      tibia.add(b);
    }

    let tip = tibia;
    const tarsomeres = [];
    for (let i = 0; i < 5; i++) {
      const tLen = L.tar[i];
      const t = joint(tLen, seg(M.cuticle, 0.0055 - i * 0.0004, 0.005 - i * 0.0004, tLen, 6));
      tip.add(t);
      t.position.y = tip.userData.length;
      tip = t;
      tarsomeres.push(t);
    }

    // pretarsus: claws + pulvilli
    const pretarsus = new THREE.Group();
    pretarsus.position.y = tip.userData.length;
    const clawL = new THREE.Mesh(new THREE.ConeGeometry(0.0035 * S, 0.014 * S, 5), M.claw);
    clawL.position.set(-0.004 * S, 0.006 * S, 0.002 * S);
    clawL.rotation.z = 0.55;
    clawL.rotation.x = 0.4;
    const clawR = clawL.clone();
    clawR.position.x = 0.004 * S;
    clawR.rotation.z = -0.55;
    const pulv = ball(M.pulvillus, 0.0045, 8);
    pulv.scale.set(1.4, 0.45, 1.1);
    pulv.position.y = 0.002 * S;
    pretarsus.add(clawL, clawR, pulv);
    tip.add(pretarsus);

    coxa.add(trochanter);
    trochanter.position.y = coxa.userData.length;
    trochanter.add(femur);
    femur.position.y = trochanter.userData.length;
    femur.add(tibia);
    tibia.position.y = femur.userData.length;

    root.add(coxa);

    // resting articulation (Drosophila stance; forelegs reach forward for pencil)
    if (pair === "fore") {
      root.position.set(s * 0.038, -0.01, 0.055);
      coxa.rotation.set(0.55, s * 0.15, s * 0.85);
      femur.rotation.set(0.95, 0, s * 0.25);
      tibia.rotation.set(1.15, 0, -s * 0.15);
      tarsomeres[0].rotation.x = 0.35;
    } else if (pair === "mid") {
      root.position.set(s * 0.042, -0.012, 0.005);
      coxa.rotation.set(0.35, 0, s * 0.55);
      femur.rotation.set(0.55, 0, s * 0.1);
      tibia.rotation.set(0.35, 0, 0);
    } else {
      root.position.set(s * 0.04, -0.01, -0.05);
      coxa.rotation.set(0.25, -s * 0.1, s * 0.5);
      femur.rotation.set(0.65, 0, s * 0.05);
      tibia.rotation.set(0.45, 0, 0);
    }

    root.userData.joints = { coxa, trochanter, femur, tibia, tarsomeres, pretarsus };
    root.userData.base = {
      coxa: coxa.rotation.clone(),
      femur: femur.rotation.clone(),
      tibia: tibia.rotation.clone(),
    };
    return root;
  }

  // ——— Antenna: scape → pedicel → funiculus → arista ———
  function buildAntenna(side) {
    const s = side;
    const ant = new THREE.Group();
    ant.position.set(s * 0.022, 0.042, 0.055);
    const scape = joint(0.014, seg(M.cuticleLite, 0.005, 0.0045, 0.014, 6));
    const pedicel = joint(0.012, seg(M.cuticle, 0.0045, 0.004, 0.012, 6));
    const funiculus = joint(0.02, seg(M.cuticleLite, 0.004, 0.0035, 0.02, 6));
    // arista (feathery — approximated as thin stem + lateral hairs)
    const arista = new THREE.Group();
    const stem = seg(M.arista, 0.0012, 0.0008, 0.055, 4);
    stem.position.y = 0.028 * S;
    arista.add(stem);
    for (let i = 0; i < 7; i++) {
      const hair = seg(M.arista, 0.0006, 0.0003, 0.012, 3);
      hair.position.set(s * (0.004 + (i % 2) * 0.002), 0.012 * S + i * 0.006 * S, 0);
      hair.rotation.z = s * (0.9 + i * 0.05);
      arista.add(hair);
    }
    scape.add(pedicel);
    pedicel.position.y = scape.userData.length;
    pedicel.add(funiculus);
    funiculus.position.y = pedicel.userData.length;
    funiculus.add(arista);
    arista.position.y = funiculus.userData.length;
    ant.add(scape);
    scape.rotation.set(-0.55, s * 0.35, s * 0.25);
    return ant;
  }

  // ——— Wing with longitudinal veins ———
  function buildWing(side) {
    const s = side;
    const wing = new THREE.Group();
    const shape = new THREE.Shape();
    // Drosophila wing outline (approximate planform)
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.02, 0.04, 0.08, 0.09, 0.16, 0.1);
    shape.bezierCurveTo(0.24, 0.105, 0.3, 0.09, 0.34, 0.06);
    shape.bezierCurveTo(0.37, 0.03, 0.36, -0.01, 0.32, -0.035);
    shape.bezierCurveTo(0.24, -0.06, 0.12, -0.05, 0.04, -0.025);
    shape.bezierCurveTo(0.01, -0.01, 0, -0.005, 0, 0);
    const geo = new THREE.ShapeGeometry(shape, 24);
    const membrane = new THREE.Mesh(geo, M.wing.clone());
    membrane.rotation.x = -Math.PI / 2;
    membrane.rotation.z = s > 0 ? 0 : Math.PI;
    if (s < 0) membrane.scale.x = -1;
    wing.add(membrane);

    // veins as thin boxes along span
    const veinPaths = [
      [0.02, 0.02, 0.3, 0.04], // Costa / L1
      [0.02, 0.0, 0.28, -0.005], // L2/3
      [0.03, -0.015, 0.22, -0.03], // L4
      [0.04, -0.025, 0.16, -0.04], // L5
    ];
    for (const [x0, z0, x1, z1] of veinPaths) {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      const v = seg(M.vein, 0.0012, 0.001, len, 4);
      v.position.set(s * ((x0 + x1) / 2), 0.001, (z0 + z1) / 2);
      v.rotation.z = Math.PI / 2;
      v.rotation.y = Math.atan2(dz, s * dx);
      wing.add(v);
    }

    wing.position.set(s * 0.02, 0.055, -0.01);
    wing.rotation.z = s * 0.08;
    wing.rotation.y = s * 0.15;
    wing.rotation.x = 0.05;
    wing.userData.baseRot = { x: 0.05, y: s * 0.15, z: s * 0.08 };
    return wing;
  }

  function buildHaltere(side) {
    const s = side;
    const h = new THREE.Group();
    const stalk = seg(M.haltere, 0.0025, 0.002, 0.035, 5);
    stalk.rotation.z = Math.PI / 2;
    stalk.position.x = s * 0.018;
    const knob = ball(M.haltere, 0.008, 10);
    knob.position.x = s * 0.038;
    h.add(stalk, knob);
    h.position.set(s * 0.03, 0.03, -0.06);
    h.rotation.y = s * 0.4;
    h.rotation.z = s * 0.35;
    return h;
  }

  // ——— Assemble ———
  const root = new THREE.Group();
  const thorax = new THREE.Group();
  thorax.position.y = 0.02;
  root.add(thorax);

  // Mesothoracic notum (scutum) + scutellum
  const scutum = ball(M.thorax, 0.07, 18);
  scutum.scale.set(1.05, 0.78, 1.15);
  thorax.add(scutum);
  const scutellum = ball(M.cuticleLite, 0.032, 12);
  scutellum.position.set(0, 0.02, -0.075);
  scutellum.scale.set(0.9, 0.55, 0.7);
  thorax.add(scutellum);

  // ——— Head ———
  const head = new THREE.Group();
  head.position.set(0, 0.02, 0.095);
  const capsule = ball(M.cuticleLite, 0.048, 16);
  capsule.scale.set(1.05, 0.95, 0.9);
  head.add(capsule);

  // Compound eyes (large lateral)
  const eyeL = ball(M.eye, 0.032, 16);
  eyeL.position.set(-0.038, 0.005, 0.012);
  eyeL.scale.set(0.85, 1.05, 1.15);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.038;
  head.add(eyeL, eyeR);
  // facet suggestion (small bumps)
  for (const eye of [eyeL, eyeR]) {
    for (let i = 0; i < 8; i++) {
      const f = ball(M.eyeFacet, 0.004, 6);
      const a = (i / 8) * Math.PI * 2;
      f.position.set(Math.cos(a) * 0.022 * S, Math.sin(a) * 0.018 * S, 0.02 * S);
      eye.add(f);
    }
  }

  // Ocelli triangle on vertex
  for (const [x, z] of [
    [0, 0.02],
    [-0.01, 0.008],
    [0.01, 0.008],
  ]) {
    const o = ball(M.eyeFacet, 0.004, 6);
    o.position.set(x, 0.04, z);
    head.add(o);
  }

  // Proboscis (rostrum + haustellum + labellum)
  const proboscis = new THREE.Group();
  const rostrum = seg(M.cuticle, 0.008, 0.007, 0.03, 7);
  rostrum.rotation.x = 1.1;
  rostrum.position.set(0, -0.01, 0.035);
  const labellum = ball(M.pulvillus, 0.01, 8);
  labellum.position.set(0, -0.028, 0.055);
  labellum.scale.set(1.2, 0.7, 1.0);
  proboscis.add(rostrum, labellum);
  head.add(proboscis);

  const antennaL = buildAntenna(-1);
  const antennaR = buildAntenna(1);
  head.add(antennaL, antennaR);
  thorax.add(head);

  // ——— Legs ———
  const foreL = buildLeg(-1, "fore");
  const foreR = buildLeg(1, "fore");
  const midL = buildLeg(-1, "mid");
  const midR = buildLeg(1, "mid");
  const hindL = buildLeg(-1, "hind");
  const hindR = buildLeg(1, "hind");
  thorax.add(foreL, foreR, midL, midR, hindL, hindR);

  // ——— Wings & halteres ———
  const wingL = buildWing(-1);
  const wingR = buildWing(1);
  const haltereL = buildHaltere(-1);
  const haltereR = buildHaltere(1);
  thorax.add(wingL, wingR, haltereL, haltereR);

  // ——— Abdomen: T1–T7 ———
  const abdomen = new THREE.Group();
  abdomen.position.set(0, 0.0, -0.095);
  for (let i = 0; i < 7; i++) {
    const t = ball(i % 2 === 0 ? M.abdomenDark : M.abdomenBand, 0.042 - i * 0.003, 14);
    t.scale.set(0.95 - i * 0.02, 0.72, 0.85);
    t.position.z = -0.028 * i;
    t.position.y = -0.005 * Math.min(i, 3);
    abdomen.add(t);
  }
  const tip = ball(M.abdomenDark, 0.018, 10);
  tip.position.set(0, -0.008, -0.21);
  tip.scale.set(0.8, 0.6, 1.1);
  abdomen.add(tip);
  thorax.add(abdomen);

  // Thoracic macrochaetae (dorsal bristles)
  for (const [x, z] of [
    [-0.025, 0.02],
    [0.025, 0.02],
    [-0.02, -0.02],
    [0.02, -0.02],
    [0, 0.04],
  ]) {
    const b = seg(M.bristle, 0.0015, 0.0005, 0.035, 3);
    b.position.set(x, 0.055, z);
    b.rotation.x = -0.5;
    thorax.add(b);
  }

  // ——— Pencil gripped by prothoracic pretarsi ———
  const pencil = new THREE.Group();
  const wood = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011 * S, 0.011 * S, 0.34 * S, 12),
    mkMat(0xd4a574, { roughness: 0.55 })
  );
  wood.rotation.z = Math.PI / 2;
  wood.castShadow = true;
  const tipWood = new THREE.Mesh(
    new THREE.ConeGeometry(0.011 * S, 0.038 * S, 10),
    mkMat(0x2a2218, { roughness: 0.4 })
  );
  tipWood.rotation.z = -Math.PI / 2;
  tipWood.position.x = 0.19 * S;
  const graphite = new THREE.Mesh(
    new THREE.ConeGeometry(0.004 * S, 0.018 * S, 8),
    mkMat(0x111111, { roughness: 0.3, metalness: 0.25, emissive: 0x222222, emissiveIntensity: 0 })
  );
  graphite.rotation.z = -Math.PI / 2;
  graphite.position.x = 0.214 * S;
  const ferrule = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012 * S, 0.012 * S, 0.03 * S, 10),
    mkMat(0xb0b0b0, { metalness: 0.8, roughness: 0.35 })
  );
  ferrule.rotation.z = Math.PI / 2;
  ferrule.position.x = -0.145 * S;
  const eraser = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011 * S, 0.011 * S, 0.024 * S, 10),
    mkMat(0xe8a0a0, { roughness: 0.85 })
  );
  eraser.rotation.z = Math.PI / 2;
  eraser.position.x = -0.17 * S;
  pencil.add(wood, tipWood, graphite, ferrule, eraser);
  // held ahead of head, between fore tarsi
  pencil.position.set(0.015, -0.02, 0.16);
  pencil.rotation.set(0.55, 0.06, -1.2);
  root.add(pencil);

  // Pose forelegs onto pencil shaft
  function gripPencil(press = 0) {
    const g = 0.08 + press * 0.12;
    const jL = foreL.userData.joints;
    const jR = foreR.userData.joints;
    jL.femur.rotation.x = 0.95 + g;
    jL.tibia.rotation.x = 1.2 + g * 0.4;
    jL.tarsomeres[0].rotation.x = 0.45 + g;
    jR.femur.rotation.x = 0.95 + g;
    jR.tibia.rotation.x = 1.15 + g * 0.4;
    jR.tarsomeres[0].rotation.x = 0.4 + g;
    // curl claws inward
    jL.pretarsus.rotation.z = -0.3 - g;
    jR.pretarsus.rotation.z = 0.3 + g;
  }
  gripPencil(0);

  root.position.y = 0.11;
  root.userData.anatomical = true;

  return {
    root,
    head,
    thorax,
    abdomen,
    wingL,
    wingR,
    haltereL,
    haltereR,
    eyeL,
    eyeR,
    antennaL,
    antennaR,
    foreL,
    foreR,
    legs: [foreL, foreR, midL, midR, hindL, hindR],
    // compat aliases used by fly-viz
    armL: foreL,
    armR: foreR,
    gripL: foreL,
    gripR: foreR,
    pencil,
    pen: graphite,
    tip: tipWood,
    gripPencil,
    setLocomotion(t, thr = 0) {
      const walk = thr * 0.35;
      [midL, midR, hindL, hindR].forEach((leg, i) => {
        const j = leg.userData.joints;
        const phase = t * 9 + i * 1.7;
        const swing = Math.sin(phase) * (0.12 + walk);
        j.femur.rotation.x = leg.userData.base.femur.x + swing;
        j.tibia.rotation.x = leg.userData.base.tibia.x - swing * 0.6;
      });
      // haltere oscillation
      haltereL.rotation.x = Math.sin(t * 40) * 0.35;
      haltereR.rotation.x = Math.sin(t * 40 + Math.PI) * 0.35;
      // antennae micro-motion
      antennaL.rotation.y = Math.sin(t * 2.2) * 0.08;
      antennaR.rotation.y = Math.sin(t * 2.2 + 1) * -0.08;
    },
  };
}
