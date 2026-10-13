/** Satoru-style curriculum for drawing: level-up when held-out accuracy ≥ threshold. */

export const LEVELS = [
  {
    id: 1,
    name: "直线",
    shape: "line",
    pass: 0.85,
    trainMin: 40,
    desc: "水平线 · 写完再打分",
  },
  {
    id: 2,
    name: "圆",
    shape: "circle",
    pass: 0.8,
    trainMin: 60,
    desc: "闭合圆周 · 未见图变换测试",
  },
  {
    id: 3,
    name: "脸廓",
    shape: "face",
    pass: 0.78,
    trainMin: 80,
    desc: "椭圆脸廓 + 短排线",
  },
  {
    id: 4,
    name: "发型",
    shape: "hair",
    pass: 0.75,
    trainMin: 100,
    desc: "特朗普发型外轮廓",
  },
  {
    id: 5,
    name: "肖像",
    shape: "trump",
    pass: 0.75,
    trainMin: 120,
    desc: "完整线稿肖像 · 目标 ≈85%",
  },
];

const STORAGE = "drawfly_curriculum_v1";

export class Curriculum {
  constructor() {
    this.levelIdx = 0;
    this.trainAcc = [];
    this.testAcc = [];
    this.trials = [];
    this.trainedAtLevel = 0;
    this.load();
  }

  get level() {
    return LEVELS[Math.min(this.levelIdx, LEVELS.length - 1)];
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.levelIdx = d.levelIdx || 0;
      this.trainAcc = d.trainAcc || [];
      this.testAcc = d.testAcc || [];
      this.trials = d.trials || [];
      this.trainedAtLevel = d.trainedAtLevel || 0;
    } catch {
      /* ignore */
    }
  }

  save() {
    localStorage.setItem(
      STORAGE,
      JSON.stringify({
        levelIdx: this.levelIdx,
        trainAcc: this.trainAcc.slice(-200),
        testAcc: this.testAcc.slice(-80),
        trials: this.trials.slice(-40),
        trainedAtLevel: this.trainedAtLevel,
      })
    );
  }

  recordTrain(acc, meta = {}) {
    this.trainedAtLevel += 1;
    this.trainAcc.push(acc);
    if (this.trainAcc.length > 500) this.trainAcc.shift();
    this.trials.push({
      t: Date.now(),
      kind: "train",
      acc: +acc.toFixed(3),
      level: this.level.id,
      ...meta,
    });
    if (this.trials.length > 40) this.trials.shift();
    this.save();
  }

  recordTest(acc, meta = {}) {
    this.testAcc.push(acc);
    if (this.testAcc.length > 80) this.testAcc.shift();
    this.trials.push({
      t: Date.now(),
      kind: "test",
      acc: +acc.toFixed(3),
      level: this.level.id,
      ...meta,
    });
    this.save();
    return this.maybeLevelUp();
  }

  recentTrainMean(n = 50) {
    const slice = this.trainAcc.slice(-n);
    if (!slice.length) return 0;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  recentTestMean(n = 20) {
    const slice = this.testAcc.slice(-n);
    if (!slice.length) return 0;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  maybeLevelUp() {
    const lv = this.level;
    if (this.levelIdx >= LEVELS.length - 1) return false;
    if (this.trainedAtLevel < lv.trainMin) return false;
    const mean = this.recentTestMean(12);
    if (mean >= lv.pass) {
      this.levelIdx += 1;
      this.trainedAtLevel = 0;
      this.save();
      return true;
    }
    return false;
  }

  summary() {
    const lv = this.level;
    return {
      level: lv.id,
      name: lv.name,
      shape: lv.shape,
      pass: lv.pass,
      desc: lv.desc,
      trained_at_level: this.trainedAtLevel,
      train_need: lv.trainMin,
      train_acc_recent: +this.recentTrainMean(50).toFixed(3),
      test_acc_recent: +this.recentTestMean(12).toFixed(3),
      trials: this.trials.slice(-12),
      curve_train: this.trainAcc.slice(-60).map((v) => +v.toFixed(3)),
      curve_test: this.testAcc.slice(-30).map((v) => +v.toFixed(3)),
    };
  }
}

/**
 * Grade ink vs target strokes — satoru-style post-write check.
 * For photo-driven Trump, blends coverage with tonal likeness when provided.
 */
export function gradeDrawing(env, { likeness = null } = {}) {
  const target = env.target;
  const covered = env.covered;
  const ink = env.ink;
  if (!target.length) return { accuracy: 0, coverage: 0, order: 0, clean: 0, likeness: 0 };

  const coverage = covered.filter(Boolean).length / target.length;

  let orderHits = 0;
  let orderN = 0;
  let expect = 0;
  const tol = env.tol * 1.25;
  for (const p of ink) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < target.length; i++) {
      const d = Math.hypot(p.x - target[i].x, p.y - target[i].y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD <= tol) {
      orderN += 1;
      if (best >= expect - 4) {
        orderHits += 1;
        expect = Math.max(expect, best);
      }
    }
  }
  const order = orderN ? orderHits / orderN : 0;
  const clean = ink.length ? Math.max(0, 1 - env.offInk / Math.max(1, ink.length)) : 0;
  const like = likeness == null ? coverage : Math.max(0, Math.min(1, likeness));

  // photo-driven: weight likeness higher
  const photo = Boolean(env.targetSpec?.photoDriven);
  const accuracy = photo
    ? coverage * 0.35 + order * 0.15 + clean * 0.1 + like * 0.4
    : coverage * 0.55 + order * 0.25 + clean * 0.2;

  return {
    accuracy: Math.max(0, Math.min(1, accuracy)),
    coverage,
    order,
    clean,
    likeness: like,
    off_ink: env.offInk,
    steps: env.stepCount,
    photo_driven: photo,
  };
}
