/** Continuous paper-plane drawing environment (real env layer). */

import { makeTrumpPortrait } from "./trump-portrait.js";
import { makeTrumpFromPhoto } from "./trump-photo.js";

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/** Optional photo-derived stroke pack set by boot(). */
let photoPack = null;
export function setTrumpPhotoPack(data) {
  photoPack = data;
}

export function makeTarget(shape, n = 96) {
  if (shape === "trump" && photoPack) {
    return makeTrumpFromPhoto(photoPack);
  }
  if (shape === "trump" || shape === "hair" || shape === "face") {
    return makeTrumpPortrait(shape === "trump" ? "trump" : shape);
  }

  const pts = [];
  if (shape === "line") {
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      pts.push({ x: -0.7 + 1.4 * u, y: 0 });
    }
  } else if (shape === "square") {
    const c = [
      [-0.55, -0.55], [0.55, -0.55], [0.55, 0.55], [-0.55, 0.55], [-0.55, -0.55],
    ];
    for (let s = 0; s < 4; s++) {
      const [x0, y0] = c[s];
      const [x1, y1] = c[s + 1];
      const seg = Math.floor(n / 4);
      for (let i = 0; i < seg; i++) {
        const u = i / seg;
        pts.push({ x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u });
      }
    }
  } else if (shape === "heart") {
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const x = 16 * Math.sin(t) ** 3;
      const y =
        13 * Math.cos(t) -
        5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) -
        Math.cos(4 * t);
      pts.push({ x: x / 28, y: -y / 28 + 0.05 });
    }
  } else {
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 - Math.PI / 2;
      pts.push({ x: Math.cos(t) * 0.55, y: Math.sin(t) * 0.55 });
    }
  }

  const breakAfter = new Set([pts.length - 1]);
  return {
    strokes: [pts],
    points: pts,
    breakAfter,
    label: shape,
    closed: shape !== "square",
  };
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function nearestOnTarget(pos, targetSpec) {
  const target = targetSpec.points;
  const breaks = targetSpec.breakAfter || new Set();
  let best = Infinity;
  let idx = 0;
  let tangent = { x: 1, y: 0 };
  for (let i = 0; i < target.length; i++) {
    const d = dist(pos, target[i]);
    if (d < best) {
      best = d;
      idx = i;
      let nxt = i + 1;
      if (breaks.has(i) || nxt >= target.length) {
        nxt = i > 0 && !breaks.has(i - 1) ? i - 1 : i;
        if (nxt === i) {
          tangent = { x: 1, y: 0 };
          continue;
        }
        const tx = target[i].x - target[nxt].x;
        const ty = target[i].y - target[nxt].y;
        const len = Math.hypot(tx, ty) || 1;
        tangent = { x: tx / len, y: ty / len };
      } else {
        const tx = target[nxt].x - target[i].x;
        const ty = target[nxt].y - target[i].y;
        const len = Math.hypot(tx, ty) || 1;
        tangent = { x: tx / len, y: ty / len };
      }
    }
  }
  return { distance: best, index: idx, tangent, point: target[idx] };
}

export class DrawEnv {
  constructor(shape = "trump") {
    this.paperHalf = 1.0;
    this.forwardStep = 0.028;
    this.turnRad = (18 * Math.PI) / 180;
    this.tol = 0.048;
    this.reset(shape);
  }

  maxSteps() {
    if (this.shape === "line") return 180;
    if (this.shape === "circle" || this.shape === "square") return 360;
    if (this.shape === "face" || this.shape === "hair") return 600;
    // photo-driven portrait needs many strokes
    return this.shape === "trump" ? 1400 : 400;
  }

  reset(shape = this.shape, opts = {}) {
    this.shape = shape;
    this.targetSpec = makeTarget(shape, 120);
    // held-out test: slight warp like satoru's unseen fonts
    if (opts.transform) {
      const { scale = 1, rot = 0, dx = 0, dy = 0 } = opts.transform;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const map = (p) => ({
        x: (p.x * c - p.y * s) * scale + dx,
        y: (p.x * s + p.y * c) * scale + dy,
      });
      this.targetSpec.points = this.targetSpec.points.map(map);
      this.targetSpec.strokes = this.targetSpec.strokes.map((st) => st.map(map));
    }
    this.target = this.targetSpec.points;
    this.strokes = this.targetSpec.strokes;
    this.covered = new Array(this.target.length).fill(false);
    this.penDown = false;
    this.pressure = 0;
    this.ink = [];
    this.stroke = null;
    this.strokeLen = 0;
    this.hatchScore = 0;
    this.episodeReward = 0;
    this.stepCount = 0;
    this.offInk = 0;
    this.done = false;
    this.lastReward = 0;
    this.boundaryHits = 0;
    this.isTest = Boolean(opts.isTest);

    const p0 = this.target[0];
    const p1 = this.target[Math.min(1, this.target.length - 1)];
    this.x = p0.x;
    this.y = p0.y;
    this.heading = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  }

  observe() {
    const near = nearestOnTarget({ x: this.x, y: this.y }, this.targetSpec);
    const coveredN = this.covered.filter(Boolean).length;
    const coverage = coveredN / this.target.length;
    const headingDeg = (this.heading * 180) / Math.PI;

    // Stroke-order goal: next uncovered + small lookahead (precision tracing)
    let hint = this.covered.findIndex((c) => !c);
    if (hint < 0) hint = Math.min(near.index, this.target.length - 1);
    const look = Math.min(this.target.length - 1, hint + 3);
    // don't jump across stroke breaks
    let goalIdx = hint;
    for (let i = hint; i <= look; i++) {
      goalIdx = i;
      if (this.targetSpec.breakAfter.has(i)) break;
    }
    const goal = this.target[goalIdx];
    const toGoal = Math.atan2(goal.y - this.y, goal.x - this.x);
    let herrGoal = toGoal - this.heading;
    while (herrGoal > Math.PI) herrGoal -= Math.PI * 2;
    while (herrGoal < -Math.PI) herrGoal += Math.PI * 2;

    // blend tangent of nearest with goal heading (favor goal for order)
    const want = Math.atan2(near.tangent.y, near.tangent.x);
    let herrTan = want - this.heading;
    while (herrTan > Math.PI) herrTan -= Math.PI * 2;
    while (herrTan < -Math.PI) herrTan += Math.PI * 2;
    const herr = herrGoal * 0.7 + herrTan * 0.3;

    // denser preview for retina
    const preview = [];
    for (const stroke of this.strokes) {
      if (preview.length) preview.push(null);
      const stride = Math.max(1, Math.floor(stroke.length / 18));
      for (let i = 0; i < stroke.length; i += stride) {
        preview.push({
          x: +stroke[i].x.toFixed(3),
          y: +stroke[i].y.toFixed(3),
        });
      }
    }

    const inkPreview = this.ink
      .filter((_, i) => i % Math.max(1, Math.floor(this.ink.length / 40) || 1) === 0)
      .slice(-40)
      .map((p) => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3) }));

    return {
      shape: this.shape,
      pose: {
        x: +this.x.toFixed(3),
        y: +this.y.toFixed(3),
        heading_deg: +headingDeg.toFixed(1),
      },
      pen_down: this.penDown,
      pressure: +this.pressure.toFixed(2),
      hatch_score: +this.hatchScore.toFixed(3),
      nearest_target_distance: +near.distance.toFixed(3),
      goal_distance: +Math.hypot(goal.x - this.x, goal.y - this.y).toFixed(3),
      heading_error_deg: +((herr * 180) / Math.PI).toFixed(1),
      heading_to_goal_deg: +((herrGoal * 180) / Math.PI).toFixed(1),
      tangent: {
        x: +near.tangent.x.toFixed(3),
        y: +near.tangent.y.toFixed(3),
      },
      goal: { x: +goal.x.toFixed(3), y: +goal.y.toFixed(3), index: goalIdx },
      goal_pressure: +(goal.pressure ?? 0.6).toFixed(2),
      coverage: +coverage.toFixed(3),
      uncovered_hint_index: hint,
      target_preview: preview,
      ink_preview: inkPreview,
      ink_points: this.ink.length,
      boundary_hits: this.boundaryHits,
      step: this.stepCount,
      episode_reward: +this.episodeReward.toFixed(3),
      done: this.done,
      budget_left: Math.max(0, this.maxSteps() - this.stepCount),
      target_points: this.target.length,
    };
  }

  step(ctrl) {
    if (this.done) return this._result(0, "done");

    const throttle = clamp(Number(ctrl.throttle ?? 0), 0, 1);
    const steering = clamp(Number(ctrl.steering ?? 0), -1, 1);
    const penDown = Boolean(ctrl.pen_down);
    const finish = Boolean(ctrl.finish);
    const pressure = clamp(Number(ctrl.pressure ?? (penDown ? 0.55 : 0)), 0, 1);

    this.penDown = penDown;
    this.pressure = penDown ? pressure : 0;
    this.heading += steering * this.turnRad;
    // heavier pressure → slightly slower glide (pencil dig-in)
    const stepScale = this.forwardStep * throttle * (1 - this.pressure * 0.25);
    const dx = Math.cos(this.heading) * stepScale;
    const dy = Math.sin(this.heading) * stepScale;
    this.x = clamp(this.x + dx, -this.paperHalf + 0.02, this.paperHalf - 0.02);
    this.y = clamp(this.y + dy, -this.paperHalf + 0.02, this.paperHalf - 0.02);

    let boundary = false;
    if (Math.abs(this.x) > this.paperHalf - 0.03 || Math.abs(this.y) > this.paperHalf - 0.03) {
      boundary = true;
      this.boundaryHits += 1;
    }

    let reward = -0.01;
    if (boundary) reward -= 0.05;

    if (this.penDown && throttle > 0.05) {
      const p = { x: this.x, y: this.y, pressure: this.pressure };
      this.ink.push(p);
      if (!this.stroke) {
        this.stroke = [p];
        this.strokeLen = 0;
      } else {
        const prev = this.stroke[this.stroke.length - 1];
        this.strokeLen += Math.hypot(p.x - prev.x, p.y - prev.y);
        this.stroke.push(p);
      }

      const near = nearestOnTarget(p, this.targetSpec);
      if (near.distance <= this.tol) {
        if (!this.covered[near.index]) {
          this.covered[near.index] = true;
          // mid pressure preferred on contour; light ok on hatch strokes
          const pressBonus = 1 - Math.abs(this.pressure - 0.55) * 0.5;
          reward += 0.35 * pressBonus;
        } else {
          reward -= 0.02;
        }
        const j = near.index + 1;
        if (
          j < this.covered.length &&
          !this.targetSpec.breakAfter.has(near.index) &&
          !this.covered[j] &&
          near.distance < this.tol * 0.7
        ) {
          this.covered[j] = true;
          reward += 0.12;
        }

        // short parallel hatch reward: brief stroke, light-mid pressure, on-target
        if (this.strokeLen > 0.04 && this.strokeLen < 0.18 && this.pressure > 0.25 && this.pressure < 0.7) {
          const hatch = 0.08;
          this.hatchScore += hatch;
          reward += hatch;
        }
      } else {
        this.offInk += 1;
        reward -= 0.08 + this.pressure * 0.04; // hard press off-line hurts more
      }
    } else if (!this.penDown) {
      // reward clean lift after a short hatch
      if (this.stroke && this.strokeLen > 0.04 && this.strokeLen < 0.2) {
        reward += 0.05;
        this.hatchScore += 0.05;
      }
      this.stroke = null;
      this.strokeLen = 0;
    }

    this.stepCount += 1;
    const coverage = this.covered.filter(Boolean).length / this.target.length;
    const doneCover = this.shape === "trump" ? 0.72 : 0.92;

    if (finish || coverage >= doneCover || this.stepCount >= this.maxSteps()) {
      this.done = true;
      reward += coverage * 2.5 + Math.min(1.2, this.hatchScore);
      if (coverage < 0.35) reward -= 1.0;
      else if (coverage > 0.55) reward += 0.8;
    }

    this.lastReward = reward;
    this.episodeReward += reward;
    return this._result(reward, finish ? "finish" : "step");
  }

  _result(reward, kind) {
    return {
      reward,
      kind,
      coverage: this.covered.filter(Boolean).length / this.target.length,
      done: this.done,
      pose: {
        x: this.x,
        y: this.y,
        heading: this.heading,
        penDown: this.penDown,
        pressure: this.pressure,
      },
      ink: this.ink,
      covered: this.covered,
      target: this.target,
      strokes: this.strokes,
    };
  }
}
