import * as THREE from "three";
import { ROAD_HALF, SAMPLES, heightAt, project, wrap } from "./track.js";
import { KART_SCALE } from "./kart-model.js";

export const TUNE = {
  accel: 24,
  brake: 38,
  coast: 5,
  maxSpeed: 30,
  boostSpeed: 44,
  grassFactor: 0.55,
  turn: 2.1,
  grip: 9,
  driftGrip: 3.6,
  driftTurn: 1.25,
  driftMinSpeed: 13,
  gaugePerSecond: 0.22,
  nitroTime: 2.2,
  maxNitro: 2,
  gravity: 30,
  airSteer: 0.35,
};

const KART_RADIUS = 1.0;

export function emptyInput() {
  return { throttle: 0, brake: 0, steer: 0, drift: false, nitro: false };
}

const WHEEL_RADIUS = 0.21 * KART_SCALE;

export class Kart {
  /** `model` comes from buildKartModel(): this class only moves it, never builds it. */
  constructor({ name, color, track, model, startIndex = 0, lane = 0 }) {
    this.name = name;
    this.color = color;
    this.track = track;
    this.model = model;
    this.reset(startIndex, lane);
  }

  reset(index, lane = 0) {
    const i = wrap(index);
    const t = this.track;
    this.pos = t.P[i].clone().addScaledVector(t.R[i], lane);
    this.vy = 0;
    this.air = false;
    this.airTime = 0;
    this.landed = 0;
    this.yaw = Math.atan2(t.T[i].x, t.T[i].z);
    this.vel = new THREE.Vector3();
    this.idx = i;
    this.progress = index;
    this.lat = lane;
    this.drifting = false;
    this.driftDir = 0;
    this.charge = 0;
    this.gauge = 0;
    this.nitro = 0;
    this.boost = 0;
    this.bumped = 0;
    this.prevNitro = false;
    this.finished = null;
    this.wheelSpin = 0;
    this.steerShown = 0;
    this.released = 0;
  }

  get speed() {
    return this.vel.length();
  }

  get lap() {
    return Math.floor(this.progress / SAMPLES);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  right(out = new THREE.Vector3()) {
    return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  step(input, dt) {
    const f = this.forward();
    const r = this.right();
    let vf = this.vel.dot(f);
    const onGrass = Math.abs(this.lat) > ROAD_HALF + 1.2;

    if (!this.drifting && input.drift && Math.abs(input.steer) > 0.3 && vf > TUNE.driftMinSpeed) {
      this.drifting = true;
      this.driftDir = Math.sign(input.steer);
      this.charge = 0;
    } else if (this.drifting && (!input.drift || this.speed < TUNE.driftMinSpeed * 0.6)) {
      this.endDrift();
    }

    const steer = this.drifting ? this.driftDir * 0.6 + input.steer * 0.4 : input.steer;
    this.steerShown = steer;
    const grip = Math.min(1, Math.abs(vf) / 8) * Math.sign(vf || 1) * (this.air ? TUNE.airSteer : 1);
    this.yaw -= steer * TUNE.turn * (this.drifting ? TUNE.driftTurn : 1) * grip * dt;

    this.forward(f);
    this.right(r);

    const moving = this.vel.length();
    if (moving > 0.01 && !this.air) {
      const reversing = this.vel.dot(f) < 0 && !this.drifting;
      const aim = reversing ? this.yaw + Math.PI : this.yaw;
      const now = Math.atan2(this.vel.x, this.vel.z);
      const slip = Math.atan2(Math.sin(aim - now), Math.cos(aim - now));
      const traction = this.drifting ? TUNE.driftGrip : TUNE.grip;
      const dir = now + slip * (1 - Math.exp(-traction * dt));
      const scrub = 1 - Math.abs(Math.sin(slip)) * (this.drifting ? 0.25 : 0.8) * dt;
      this.vel.set(Math.sin(dir), 0, Math.cos(dir)).multiplyScalar(moving * scrub);
    }

    let top = this.boost > 0 ? TUNE.boostSpeed : TUNE.maxSpeed;
    if (onGrass && this.boost <= 0) top *= TUNE.grassFactor;

    vf = this.vel.dot(f);
    let dv = 0;
    const push = (this.air ? 0 : input.throttle * TUNE.accel) + (this.boost > 0 ? 40 : 0);
    if (this.speed < top) dv += push * dt;
    if (input.brake > 0) dv -= input.brake * TUNE.brake * dt;
    if (!this.air) dv -= TUNE.gravity * 0.3 * this.track.slope[this.idx] * this.track.T[this.idx].dot(f) * dt;
    if (input.throttle === 0 && input.brake === 0) dv -= Math.sign(vf) * Math.min(Math.abs(vf), TUNE.coast * dt);
    if (vf + dv < -8) dv = -8 - vf;
    this.vel.addScaledVector(f, dv);

    const total = this.vel.length();
    if (total > top) this.vel.multiplyScalar(Math.max(top, total - (total - top) * Math.min(1, 2 * dt)) / total);

    if (this.drifting) {
      const hard = input.steer * this.driftDir > 0.2;
      this.charge += dt * (hard ? 1.5 : 0.6);
      this.gauge += dt * TUNE.gaugePerSecond;
    } else {
      this.gauge += dt * 0.012 * Math.min(1, vf / TUNE.maxSpeed);
    }
    if (this.gauge >= 1) {
      this.gauge -= 1;
      this.nitro = Math.min(TUNE.maxNitro, this.nitro + 1);
    }

    if (input.nitro && !this.prevNitro && this.nitro > 0 && this.boost < 0.3) {
      this.nitro -= 1;
      this.boost = TUNE.nitroTime;
    }
    this.prevNitro = input.nitro;
    this.boost = Math.max(0, this.boost - dt);
    this.bumped = Math.max(0, this.bumped - dt);

    this.pos.addScaledVector(this.vel, dt);
    this.collideTrack();
    this.followGround(dt);
  }

  /**
   * Vertical motion. On the ground the kart rides the road; when the road drops away faster
   * than gravity could pull the kart down (a crest or a kicker lip) it takes off and flies.
   */
  followGround(dt) {
    const ground = heightAt(this.track, this.idx, this.along);
    this.landed = Math.max(0, this.landed - dt);
    if (this.air) {
      this.vy -= TUNE.gravity * dt;
      this.pos.y += this.vy * dt;
      this.airTime += dt;
      if (this.pos.y <= ground) {
        if (this.vy < -5) this.landed = 0.35;
        this.pos.y = ground;
        this.vy = 0;
        this.air = false;
      }
      return;
    }
    // Ballistic height next step vs the road: leave the ground only when the road falls away clearly.
    const fall = this.pos.y + this.vy * dt - TUNE.gravity * dt * dt;
    if (ground < fall - 0.04 && this.speed > 8) {
      this.air = true;
      this.airTime = 0;
      const lip = this.track.kickers.some(({ to }) => Math.abs(wrap(this.idx - to + 2) - 2) <= 2);
      if (lip) this.vy = Math.max(this.vy, 3 + this.speed * 0.22);
      this.vy -= TUNE.gravity * dt;
      this.pos.y += this.vy * dt;
    } else {
      this.vy = THREE.MathUtils.lerp(this.vy, (ground - this.pos.y) / dt, 0.5);
      this.pos.y = ground;
    }
  }

  /** Drift charge stage: 0 none, 1 blue (mini boost), 2 orange (full boost). */
  get stage() {
    return !this.drifting ? 0 : this.charge > 1.6 ? 2 : this.charge > 0.7 ? 1 : 0;
  }

  endDrift() {
    this.released = this.stage;
    if (this.charge > 1.6) this.boost = Math.max(this.boost, 1.0);
    else if (this.charge > 0.7) this.boost = Math.max(this.boost, 0.5);
    this.drifting = false;
    this.charge = 0;
  }

  collideTrack() {
    const t = this.track;
    const { i, lat, along } = project(t, this.pos, this.idx);
    this.along = along;
    let delta = i - this.idx;
    if (delta > SAMPLES / 2) delta -= SAMPLES;
    if (delta < -SAMPLES / 2) delta += SAMPLES;
    this.progress += delta;
    this.idx = i;
    this.lat = lat;

    const limit = (lat > 0 ? t.wallRight[i] : t.wallLeft[i]) - KART_RADIUS;
    if (Math.abs(lat) > limit) {
      const n = t.R[i];
      const side = Math.sign(lat);
      this.pos.addScaledVector(n, (limit - Math.abs(lat)) * side);
      const into = this.vel.dot(n) * side;
      if (into > 0) {
        this.vel.addScaledVector(n, -into * side * 1.3);
        this.vel.multiplyScalar(Math.max(0.6, 1 - into * 0.02));
        if (into > 3) {
          this.charge = 0;
          this.bumped = 0.25;
        }
      }
      const along = Math.atan2(t.T[i].x, t.T[i].z);
      let turn = Math.atan2(Math.sin(along - this.yaw), Math.cos(along - this.yaw));
      if (Math.abs(turn) > Math.PI / 2) turn -= Math.sign(turn) * Math.PI;
      this.yaw += turn * 0.08;
      this.lat = limit * side;
    }

    if (this.air) return;
    for (const pad of t.pads) {
      let d = Math.abs(i - pad.i);
      d = Math.min(d, SAMPLES - d);
      if (d < 3 && Math.abs(lat - pad.lat) < 1.8) this.boost = Math.max(this.boost, 0.9);
    }
  }

  /** Pushes two karts apart and trades part of their velocity. */
  static bump(a, b) {
    const dx = b.pos.x - a.pos.x;
    const dz = b.pos.z - a.pos.z;
    const dist = Math.hypot(dx, dz);
    const min = KART_RADIUS * 2.2;
    if (dist >= min || dist === 0) return;
    const nx = dx / dist;
    const nz = dz / dist;
    const push = (min - dist) / 2;
    a.pos.x -= nx * push; a.pos.z -= nz * push;
    b.pos.x += nx * push; b.pos.z += nz * push;
    const rel = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
    if (rel < 0) {
      a.vel.x += nx * rel * 0.5; a.vel.z += nz * rel * 0.5;
      b.vel.x -= nx * rel * 0.5; b.vel.z -= nz * rel * 0.5;
    }
  }

  syncModel(dt) {
    const m = this.model;
    m.root.position.copy(this.pos);
    const slide = this.drifting ? this.driftDir * 0.15 : 0;
    m.root.rotation.order = "YXZ";
    m.root.rotation.y = this.yaw + slide;
    const along = this.track.T[this.idx].dot(this.forward());
    const pitch = this.air
      ? -Math.atan2(this.vy, Math.max(4, this.speed)) * 0.7
      : -Math.atan(this.track.slope[this.idx] * along);
    m.root.rotation.x = THREE.MathUtils.lerp(m.root.rotation.x, pitch, this.air ? 0.08 : 0.3);
    const vl = this.vel.dot(this.right());
    m.chassis.rotation.z = THREE.MathUtils.lerp(m.chassis.rotation.z, -vl * 0.02, 0.2);
    m.chassis.position.y = (this.bumped > 0 ? Math.sin(this.bumped * 40) * 0.08 : 0)
      - (this.landed > 0 ? Math.sin((this.landed / 0.35) * Math.PI) * 0.18 : 0);

    this.wheelSpin += (this.vel.dot(this.forward()) * dt) / WHEEL_RADIUS;
    const lock = this.drifting ? this.driftDir * 0.25 : -this.steerShown * 0.45;
    for (const w of m.wheels) {
      w.node.rotation.x = this.wheelSpin;
      if (w.front) w.node.rotation.y = THREE.MathUtils.lerp(w.node.rotation.y, lock, Math.min(1, dt * 12));
    }

    const show = this.drifting && this.charge > 0.25;
    for (const s of m.sparks) {
      s.visible = show;
      s.scale.setScalar(0.6 + Math.random() * 0.8);
    }
    m.sparkMat.color.set(this.charge > 1.6 ? 0xff8a1f : 0x4fc3ff);
    m.flame.visible = false;
  }
}

/** The AI presses the same buttons a player does. */
export function aiInput(kart, skill = 1) {
  const t = kart.track;
  const ahead = wrap(kart.idx + 12 + Math.floor(kart.speed * 0.5));
  const target = t.P[ahead].clone().addScaledVector(t.R[ahead], kart.aiLane || 0);
  const to = target.sub(kart.pos).setY(0).normalize();
  const f = kart.forward();
  const cross = f.z * to.x - f.x * to.z;
  const angle = Math.atan2(-cross, f.dot(to));

  const far = wrap(kart.idx + 45);
  const bend = Math.acos(Math.min(1, t.T[kart.idx].dot(t.T[far])));

  const input = emptyInput();
  input.steer = THREE.MathUtils.clamp(angle * 2.4, -1, 1);
  input.throttle = bend > 0.9 && kart.speed > 22 * skill ? 0.4 : skill;
  input.drift = kart.drifting ? bend > 0.25 : bend > 0.55 && kart.speed > 16;
  input.nitro = kart.nitro > 0 && bend < 0.2;
  return input;
}
