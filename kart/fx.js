import * as THREE from "three";

/**
 * Kart particle effects: exhaust smoke and backfire, drift sparks and tyre smoke coloured by
 * charge stage, a charge ring under the kart, a burst when the charge is released, landing dust.
 *
 * Two point pools: "glow" is additive (sparks, flames), "smoke" is alpha-blended with a hard
 * toon edge so puffs read as flat cartoon clouds rather than soft photographic smoke.
 */
const STAGE_COLORS = [new THREE.Color(0xfff2b0), new THREE.Color(0x4fc3ff), new THREE.Color(0xff8a1f)];

const VERT = /* glsl */ `
  attribute float size;
  attribute vec4 tint;
  varying vec4 vTint;
  uniform float scale;
  uniform float maxSize;
  void main() {
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = size * scale / -mv.z;
    // Puffs right next to the lens would fill the screen; cap them and fade them out instead.
    vTint.a *= smoothstep(1.2, 3.0, -mv.z);
    gl_PointSize = min(px, maxSize);
    gl_Position = projectionMatrix * mv;
  }
`;
const GLOW_FRAG = /* glsl */ `
  varying vec4 vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = smoothstep(1.0, 0.0, d);
    gl_FragColor = vec4(vTint.rgb * (core * core * 1.6 + core * 0.4), core * vTint.a);
    gl_FragColor.rgb *= vTint.a;
  }
`;
const SMOKE_FRAG = /* glsl */ `
  varying vec4 vTint;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float shade = c.y > 0.12 - c.x * 0.4 ? 0.82 : 1.0;
    float edge = smoothstep(1.0, 0.86, d);
    gl_FragColor = vec4(vTint.rgb * shade, edge * vTint.a);
  }
`;

class Pool {
  constructor(scene, size, frag, blending) {
    this.n = size;
    this.pos = new Float32Array(size * 3);
    this.vel = new Float32Array(size * 3);
    this.tint = new Float32Array(size * 4);
    this.size = new Float32Array(size);
    this.life = new Float32Array(size);
    this.maxLife = new Float32Array(size);
    this.grow = new Float32Array(size);
    this.drag = new Float32Array(size);
    this.lift = new Float32Array(size);
    this.alpha0 = new Float32Array(size);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("tint", new THREE.BufferAttribute(this.tint, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 }, maxSize: { value: 120 } },
      vertexShader: VERT,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.userData.keepMaterial = true;
    scene.add(this.points);
  }

  emit(p, v, { size = 0.5, life = 0.6, color, alpha = 1, grow = 0, drag = 1, lift = 0 }) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.tint.set([color.r, color.g, color.b, alpha], i * 4);
    this.size[i] = size;
    this.life[i] = this.maxLife[i] = life;
    this.grow[i] = grow;
    this.drag[i] = drag;
    this.lift[i] = lift;
    this.alpha0[i] = alpha;
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.tint[i * 4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      for (let a = 0; a < 3; a++) {
        this.vel[i * 3 + a] *= k;
        this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
      }
      this.vel[i * 3 + 1] += this.lift[i] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.tint[i * 4 + 3] = this.alpha0[i] * Math.min(1, t * 2.5);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.tint.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }
}

function ringTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = "#fff";
  g.shadowColor = "#fff";
  g.shadowBlur = 12;
  g.lineWidth = 9;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    g.beginPath();
    g.arc(128, 128, 108, a + 0.08, a + Math.PI / 4 - 0.08);
    g.stroke();
  }
  g.lineWidth = 3;
  g.beginPath();
  g.arc(128, 128, 92, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

export function createFx(scene) {
  const glow = new Pool(scene, 2400, GLOW_FRAG, THREE.AdditiveBlending);
  const smoke = new Pool(scene, 1600, SMOKE_FRAG, THREE.NormalBlending);
  const ringTex = ringTexture();
  const ringGeo = new THREE.PlaneGeometry(1, 1);
  const shockwaves = [];
  const per = new Map();

  const v = new THREE.Vector3();
  const p = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const tmp = new THREE.Color();
  const white = new THREE.Color(0xffffff);
  const smokeGrey = new THREE.Color(0xe9ecf2);
  const exhaustGrey = new THREE.Color(0xb9bcc8);
  const flameA = new THREE.Color(0xffd36b);
  const flameB = new THREE.Color(0xff5a1a);
  const dustCol = new THREE.Color(0xd8c59a);
  const rnd = (a) => (Math.random() - 0.5) * a;

  const PIPES = [new THREE.Vector3(-0.32, 1.3, -0.8), new THREE.Vector3(0.32, 1.3, -0.8)];
  const WHEELS = [new THREE.Vector3(-0.9, 0.2, -1.0), new THREE.Vector3(0.9, 0.2, -1.0)];

  function state(kart) {
    let s = per.get(kart);
    if (!s) {
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      }));
      ring.userData.keepMaterial = true;
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.12;
      ring.visible = false;
      kart.model.root.add(ring);
      s = { exhaust: 0, smoke: 0, spark: 0, pop: 0.3, ring, wasAir: false, prevBoost: 0 };
      per.set(kart, s);
    }
    return s;
  }

  function world(kart, local, out) {
    return kart.model.chassis.localToWorld(out.copy(local));
  }

  function shockwave(kart, color, size) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      map: ringTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    m.userData.keepMaterial = true;
    m.rotation.x = -Math.PI / 2;
    m.position.copy(kart.pos).setY(kart.pos.y + 0.2);
    scene.add(m);
    shockwaves.push({ m, t: 0, size });
  }

  function burst(kart, stage) {
    const col = STAGE_COLORS[stage];
    const f = kart.forward(new THREE.Vector3());
    for (let n = 0; n < 70; n++) {
      world(kart, WHEELS[n % 2], p);
      vel.set(rnd(10), Math.random() * 6, rnd(10)).addScaledVector(f, -6 - Math.random() * 8);
      glow.emit(p, vel, { size: 0.35 + Math.random() * 0.35, life: 0.35 + Math.random() * 0.35, color: col, drag: 3, lift: -12 });
    }
    for (let n = 0; n < 12; n++) {
      world(kart, PIPES[n % 2], p);
      vel.copy(f).multiplyScalar(-4 - Math.random() * 4).add(v.set(rnd(2), rnd(1), rnd(2)));
      glow.emit(p, vel, { size: 1.0 + Math.random() * 0.8, life: 0.25, color: n % 2 ? flameA : flameB, grow: 2, drag: 4 });
    }
    shockwave(kart, col, stage === 2 ? 9 : 6);
  }

  function updateKart(kart, dt, { throttle = 1 } = {}) {
    const s = state(kart);
    const m = kart.model;
    m.root.updateMatrixWorld(true);
    const f = kart.forward(new THREE.Vector3());
    const speed = kart.speed;

    // Exhaust: idle puffs always, thicker under throttle; flames and pops while boosting.
    s.exhaust -= dt;
    if (s.exhaust <= 0) {
      s.exhaust = kart.boost > 0 ? 0.018 : 0.045 - 0.02 * throttle;
      for (const pipe of PIPES) {
        world(kart, pipe, p);
        vel.copy(f).multiplyScalar(-2 - speed * 0.15).add(v.set(rnd(0.8), 0.6 + Math.random() * 0.6, rnd(0.8)));
        vel.addScaledVector(kart.vel, 0.55);
        smoke.emit(p, vel, {
          size: 0.16 + Math.random() * 0.1, life: 0.4 + Math.random() * 0.3,
          color: exhaustGrey, alpha: 0.35 + 0.2 * throttle, grow: 0.8, drag: 2.2, lift: 0.8,
        });
        if (kart.boost > 0) {
          glow.emit(p, vel.copy(kart.vel).multiplyScalar(0.8).addScaledVector(f, -5), {
            size: 0.7 + Math.random() * 0.5, life: 0.09, color: Math.random() < 0.5 ? flameA : flameB, grow: 3, drag: 1,
          });
        }
      }
    }
    if (kart.boost > 0) {
      s.pop -= dt;
      if (s.pop <= 0) {
        s.pop = 0.12 + Math.random() * 0.25;
        for (const pipe of PIPES) {
          world(kart, pipe, p);
          for (let n = 0; n < 6; n++) {
            vel.copy(kart.vel).multiplyScalar(0.7).addScaledVector(f, -3 - Math.random() * 3).add(v.set(rnd(3), rnd(2), rnd(3)));
            glow.emit(p, vel, { size: 0.9 + Math.random() * 0.7, life: 0.14, color: n % 2 ? flameA : flameB, grow: 4, drag: 6 });
          }
          smoke.emit(p, vel.copy(kart.vel).multiplyScalar(0.5).add(v.set(0, 1, 0)), {
            size: 0.4, life: 0.5, color: exhaustGrey, alpha: 0.55, grow: 1.4, drag: 2.5, lift: 0.6,
          });
        }
        s.popped = true;
      }
    }
    if (kart.boost > 0 && s.prevBoost <= 0) s.boostStart = true;
    s.prevBoost = kart.boost;

    // Drift: sparks from the rear wheels in the stage colour, white tyre smoke, a charge ring.
    const stage = kart.stage;
    if (kart.drifting && !kart.air) {
      s.spark -= dt;
      if (s.spark <= 0) {
        s.spark = stage === 0 ? 0.03 : 0.012;
        const col = STAGE_COLORS[stage];
        const outer = WHEELS[kart.driftDir > 0 ? 0 : 1];
        for (const wheel of WHEELS) {
          const count = stage === 0 ? 1 : wheel === outer ? 3 : 2;
          world(kart, wheel, p);
          for (let n = 0; n < count; n++) {
            vel.copy(kart.vel).multiplyScalar(0.35).addScaledVector(f, -3).add(v.set(rnd(5), 2 + Math.random() * 4, rnd(5)));
            glow.emit(p, vel, {
              size: stage === 2 ? 0.42 : 0.32, life: 0.25 + Math.random() * 0.25,
              color: tmp.copy(col).lerp(white, Math.random() * 0.4), drag: 2, lift: -14,
            });
          }
        }
      }
      s.smoke -= dt;
      if (s.smoke <= 0) {
        s.smoke = 0.035;
        for (const wheel of WHEELS) {
          world(kart, wheel, p);
          vel.copy(kart.vel).multiplyScalar(0.25).add(v.set(rnd(1.5), 0.8, rnd(1.5)));
          smoke.emit(p, vel, { size: 0.4, life: 0.45 + Math.random() * 0.25, color: smokeGrey, alpha: 0.5, grow: 1.5, drag: 2.5, lift: 0.4 });
        }
      }
    }
    const ring = s.ring;
    ring.visible = kart.drifting && kart.charge > 0.2;
    if (ring.visible) {
      const pulse = 1 + Math.sin(performance.now() / 50) * 0.06;
      const fill = Math.min(1, kart.charge / 1.6);
      ring.scale.setScalar((2.8 + fill * 0.8) * pulse);
      ring.rotation.z += dt * (4 + stage * 6) * kart.driftDir;
      ring.material.color.copy(STAGE_COLORS[stage]).multiplyScalar(0.5 + fill);
      ring.material.opacity = 0.3 + fill * 0.4;
    }
    if (kart.released) {
      if (kart.released > 0) burst(kart, kart.released);
      kart.released = 0;
    }

    // Landing dust.
    if (s.wasAir && !kart.air) {
      for (let n = 0; n < 18; n++) {
        p.copy(kart.pos).add(v.set(rnd(2.5), 0.2, rnd(2.5)));
        vel.set(rnd(6), 1 + Math.random() * 2, rnd(6)).addScaledVector(kart.vel, 0.3);
        smoke.emit(p, vel, { size: 0.8, life: 0.7, color: dustCol, alpha: 0.8, grow: 2.5, drag: 3, lift: 0.2 });
      }
      shockwave(kart, white, 5);
    }
    s.wasAir = kart.air;
  }

  return {
    updateKart,
    /** Per-kart one-shot events since the last call (used for sound). */
    events(kart) {
      const s = state(kart);
      const out = { pop: !!s.popped, boostStart: !!s.boostStart };
      s.popped = s.boostStart = false;
      return out;
    },
    update(dt, height) {
      for (const pool of [glow, smoke]) {
        pool.material.uniforms.scale.value = height * 0.9;
        pool.material.uniforms.maxSize.value = height * 0.12;
      }
      glow.update(dt);
      smoke.update(dt);
      for (let n = shockwaves.length - 1; n >= 0; n--) {
        const w = shockwaves[n];
        w.t += dt;
        const k = w.t / 0.45;
        w.m.scale.setScalar(1 + k * w.size);
        w.m.material.opacity = Math.max(0, 1 - k);
        if (k >= 1) {
          scene.remove(w.m);
          w.m.material.dispose();
          shockwaves.splice(n, 1);
        }
      }
    },
  };
}
