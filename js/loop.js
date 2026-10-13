import * as THREE from "./vendor/three.module.js";
import { DrawEnv } from "./env.js";
import { FlyViz } from "./fly-viz.js";
import { DemoStore, pickPaper } from "./demo.js";
import { Curriculum, gradeDrawing } from "./curriculum.js";
import { NeuralPanel } from "./neural-panel.js";
import { loadTrumpPhotoStrokes, scoreLikeness } from "./trump-photo.js";
import { setTrumpPhotoPack } from "./env.js";

const view = document.getElementById("view");
const ui = {
  status: document.getElementById("statusPill"),
  shape: document.getElementById("shape"),
  auto: document.getElementById("auto"),
  train: document.getElementById("train"),
  backend: document.getElementById("backend"),
  mode: document.getElementById("mode"),
  follow: document.getElementById("follow"),
  autoOrbit: document.getElementById("autoOrbit"),
  btnStep: document.getElementById("btnStep"),
  btnReset: document.getElementById("btnReset"),
  btnSave: document.getElementById("btnSave"),
  btnLoad: document.getElementById("btnLoad"),
  btnRec: document.getElementById("btnRec"),
  btnClearDemo: document.getElementById("btnClearDemo"),
  btnViewDesk: document.getElementById("btnViewDesk"),
  btnViewTop: document.getElementById("btnViewTop"),
  btnViewSide: document.getElementById("btnViewSide"),
  btnViewBrain: document.getElementById("btnViewBrain"),
  obsOut: document.getElementById("obsOut"),
  neuralOut: document.getElementById("neuralOut"),
  trainOut: document.getElementById("trainOut"),
  gradeOut: document.getElementById("gradeOut"),
  retinaImg: document.getElementById("retinaImg"),
  gaugeCanvas: document.getElementById("neuralGauges"),
  kcCanvas: document.getElementById("kcBars"),
  neuralMeta: document.getElementById("neuralMeta"),
  hudAction: document.getElementById("hudAction"),
  hudReward: document.getElementById("hudReward"),
  hudCover: document.getElementById("hudCover"),
  hudBarL: document.getElementById("hudBarL"),
  hudBarR: document.getElementById("hudBarR"),
  hudHzL: document.getElementById("hudHzL"),
  hudHzR: document.getElementById("hudHzR"),
  hudNeuralMeta: document.getElementById("hudNeuralMeta"),
  pbEp: document.getElementById("pbEp"),
  pbLike: document.getElementById("pbLike"),
  pbBest: document.getElementById("pbBest"),
  pbCover: document.getElementById("pbCover"),
  pbBar: document.getElementById("pbBar"),
  pbNote: document.getElementById("pbNote"),
  pbList: document.getElementById("pbList"),
  camHint: document.getElementById("camHint"),
  paperPreview: document.getElementById("paperPreview"),
  statAction: document.getElementById("statAction"),
  statReason: document.getElementById("statReason"),
  statR: document.getElementById("statR"),
  statCover: document.getElementById("statCover"),
  statOff: document.getElementById("statOff"),
  statSteps: document.getElementById("statSteps"),
  statPress: document.getElementById("statPress"),
  statHatch: document.getElementById("statHatch"),
  statDemo: document.getElementById("statDemo"),
  statAcc: document.getElementById("statAcc"),
  statLevel: document.getElementById("statLevel"),
  curveCanvas: document.getElementById("accCurve"),
};

const curriculum = new Curriculum();
const env = new DrawEnv(curriculum.level.shape);
const demos = new DemoStore();
const neuralPanel = new NeuralPanel({
  retina: ui.retinaImg,
  gauges: ui.gaugeCanvas,
  kc: ui.kcCanvas,
  meta: ui.neuralMeta,
});
let viz = null;
try {
  viz = new FlyViz(view);
} catch (err) {
  console.error("WebGL init failed", err);
  ui.status.textContent = `WebGL failed: ${err.message}`;
}

const sceneOrigin = sessionStorage.getItem("drawfly-origin") || crypto.randomUUID();
sessionStorage.setItem("drawfly-origin", sceneOrigin);
let sceneCursor = 0;
let scenePulling = false;

function sceneSubmit(cmd) {
  if (!viz?.stage) return { ok: false, error: "scene not ready" };
  const result = viz.stage.submit(cmd, { flush: true });
  const commands = Array.isArray(cmd) ? cmd : [cmd];
  fetch("/api/scene/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin: sceneOrigin, commands }),
  }).catch(() => {});
  return result;
}

async function pullScene() {
  if (!viz?.stage || scenePulling) return;
  scenePulling = true;
  try {
    const res = await fetch(`/api/scene/commands?since=${sceneCursor}`);
    if (!res.ok) return;
    const data = await res.json();
    sceneCursor = Number(data.seq || sceneCursor);
    for (const item of data.commands || []) {
      if (item.origin === sceneOrigin) continue;
      viz.stage.submit(item.cmd, { flush: true });
    }
  } catch {
    // The page still controls the local scene when the command log is down.
  } finally {
    scenePulling = false;
  }
}

window.drawfly = {
  submit: sceneSubmit,
  catalog: () => viz?.stage.catalog() ?? [],
  snapshot: () => viz?.stage.snapshot() ?? null,
  schema: () => viz?.stage.schema() ?? null,
  release: (cmd) => sceneSubmit({ ...cmd, op: "release" }),
};

let busy = false;
let lastCtrl = { throttle: 0, steering: 0, pen_down: false, pressure: 0.5, finish: false };
let lastReason = "";
let lastRewardSign = "none";
let lastTs = performance.now();
let lastDecide = 0;
let episode = 0;
let bestAcc = 0;
let history = [];
let pendingReset = null;
let nextIsTest = false;
let lastGrade = null;
let pencilTargetImg = null;

function ensurePencilTarget() {
  if (pencilTargetImg) return pencilTargetImg;
  pencilTargetImg = new Image();
  pencilTargetImg.src = "/assets/trump-pencil-target.png";
  return pencilTargetImg;
}

// human drawing on paper
let dragging = false;
let lastPick = null;
let humanPressure = 0.55;

function drawCurve() {
  const c = ui.curveCanvas;
  if (!c) return;
  const ctx = c.getContext("2d");
  const w = c.width;
  const h = c.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#1a1612";
  ctx.fillRect(0, 0, w, h);
  const train = curriculum.trainAcc.slice(-60);
  const test = curriculum.testAcc.slice(-30);
  const pass = curriculum.level.pass;
  ctx.strokeStyle = "#3f9f82";
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, h - pass * h);
  ctx.lineTo(w, h - pass * h);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const plot = (arr, color) => {
    if (arr.length < 2) return;
    ctx.strokeStyle = color;
    ctx.beginPath();
    arr.forEach((v, i) => {
      const x = (i / (arr.length - 1)) * (w - 4) + 2;
      const y = h - v * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  plot(train, "#d17a45");
  plot(test, "#9fd6c4");
}

function updateNeuralHud(neural) {
  if (!neural) return;
  const l = Number(neural.left_hz || 0);
  const r = Number(neural.right_hz || 0);
  const maxHz = 40;
  if (ui.hudBarL) ui.hudBarL.style.width = `${Math.min(100, (l / maxHz) * 100)}%`;
  if (ui.hudBarR) ui.hudBarR.style.width = `${Math.min(100, (r / maxHz) * 100)}%`;
  if (ui.hudHzL) ui.hudHzL.textContent = l.toFixed(0);
  if (ui.hudHzR) ui.hudHzR.textContent = r.toFixed(0);
  if (ui.hudNeuralMeta) {
    ui.hudNeuralMeta.textContent = `KC ${neural.KC_spikes || 0} · side ${neural.side || "—"} · spikes ${neural.total_spikes || 0}`;
  }
}

function updateProgressBoard(live = {}) {
  const bestLike = Math.max(
    bestAcc,
    ...history.map((h) => (h.like || 0) / 100),
    lastGrade?.likeness || 0
  );
  if (ui.pbEp) ui.pbEp.textContent = String(episode);
  if (ui.pbLike) {
    ui.pbLike.textContent = lastGrade
      ? `${((lastGrade.likeness || 0) * 100).toFixed(0)}%`
      : "—";
  }
  if (ui.pbBest) ui.pbBest.textContent = `${(bestLike * 100).toFixed(0)}%`;
  if (ui.pbCover) ui.pbCover.textContent = `${live.cover ?? 0}%`;
  const strokeN = Math.max(1, live.strokeN || 1);
  const goalFrac = Math.min(1, (live.goalIdx || 0) / strokeN);
  if (ui.pbBar) ui.pbBar.style.width = `${Math.round(goalFrac * 100)}%`;
  if (ui.pbNote) {
    if (!episode && !(live.steps > 0)) {
      ui.pbNote.textContent = "等待第一局结束… 每步 MaleCNS ~0.2s，一局可能要几分钟";
    } else if (!lastGrade) {
      ui.pbNote.textContent = `本局进行中 · 步数 ${live.steps || 0} · 笔触 ${live.goalIdx || 0}/${strokeN} · 覆盖 ${live.cover ?? 0}%`;
    } else {
      ui.pbNote.textContent = `上局 acc ${(lastGrade.accuracy * 100).toFixed(0)}% · likeness ${((lastGrade.likeness || 0) * 100).toFixed(0)}% · 历史最佳 ${(bestLike * 100).toFixed(0)}%`;
    }
  }
  if (ui.pbList) {
    ui.pbList.innerHTML = history
      .slice(-6)
      .reverse()
      .map(
        (h) =>
          `<li>#${h.ep} ${h.kind} · like ${h.like}% · acc ${h.acc}% · cover ${h.cover}%</li>`
      )
      .join("");
  }
}

async function reportProgress(entry) {
  try {
    let paper_png_b64 = null;
    if (viz?.paperDraw?.canvas) {
      paper_png_b64 = viz.paperDraw.canvas.toDataURL("image/png");
    }
    const res = await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry, paper_png_b64 }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.latest_paper && ui.paperPreview) {
      // keep live preview; also allow status hint
      ui.status.textContent = `progress saved · ep${entry.ep} like ${entry.like}%`;
    }
  } catch (err) {
    console.warn("progress report failed", err);
  }
}

async function loadServerProgress() {
  try {
    const data = await fetch("/api/progress").then((r) => r.json());
    if (Array.isArray(data.recent) && data.recent.length) {
      history.length = 0;
      for (const h of data.recent.slice(-40)) history.push(h);
      episode = Number(data.episodes || history.length || 0);
      bestAcc = Number(data.best_acc || 0);
      if (history.length) {
        const last = history[history.length - 1];
        lastGrade = {
          accuracy: (last.acc || 0) / 100,
          likeness: (last.like || 0) / 100,
          coverage: (last.cover || 0) / 100,
        };
      }
      updateProgressBoard({ cover: Math.round((lastGrade?.coverage || 0) * 100) });
      if (ui.pbNote) {
        ui.pbNote.textContent = `已恢复 ${episode} 局记录 · 最佳 likeness ${((data.best_likeness || 0) * 100).toFixed(0)}%`;
      }
    }
  } catch {
    /* ignore */
  }
}

function syncUi(obs, result) {
  const cover = Math.round((result?.coverage ?? obs.coverage) * 100);
  const sum = curriculum.summary();
  ui.obsOut.textContent = JSON.stringify(obs, null, 2);
  ui.hudAction.textContent = summarizeCtrl(lastCtrl);
  ui.hudReward.textContent = lastGrade
    ? `acc ${(lastGrade.accuracy * 100).toFixed(0)}%`
    : `R ${env.episodeReward.toFixed(2)}`;
  ui.hudCover.textContent = `cover ${cover}%`;
  ui.statAction.textContent = summarizeCtrl(lastCtrl);
  ui.statReason.textContent = lastReason || "—";
  ui.statR.textContent = env.episodeReward.toFixed(3);
  ui.statCover.textContent = `${cover}%`;
  ui.statOff.textContent = String(env.offInk);
  ui.statSteps.textContent = String(env.stepCount);
  if (ui.statPress) ui.statPress.textContent = env.pressure.toFixed(2);
  if (ui.statHatch) ui.statHatch.textContent = env.hatchScore.toFixed(2);
  if (ui.statDemo) ui.statDemo.textContent = String(demos.count);
  if (ui.statAcc) {
    ui.statAcc.textContent = lastGrade
      ? `${(lastGrade.accuracy * 100).toFixed(1)}%`
      : `${(sum.train_acc_recent * 100).toFixed(1)}%`;
  }
  if (ui.statLevel) {
    ui.statLevel.textContent = `Lv${sum.level} ${sum.name}`;
  }
  updateProgressBoard({
    cover,
    goalIdx: obs.goal?.index ?? 0,
    strokeN: env.strokes?.length || 1,
    steps: env.stepCount,
  });
  if (ui.trainOut) {
    ui.trainOut.textContent = JSON.stringify(
      {
        level: `Lv${sum.level} ${sum.name}`,
        pass: `${Math.round(sum.pass * 100)}%`,
        train_acc: `${(sum.train_acc_recent * 100).toFixed(1)}%`,
        test_acc: `${(sum.test_acc_recent * 100).toFixed(1)}%`,
        progress: `${sum.trained_at_level}/${sum.train_need}`,
        best_acc: `${(bestAcc * 100).toFixed(1)}%`,
        episode,
        desc: sum.desc,
      },
      null,
      2
    );
  }
  if (ui.gradeOut) {
    ui.gradeOut.textContent = JSON.stringify(
      {
        last: lastGrade,
        recent: sum.trials.slice(-6),
      },
      null,
      2
    );
  }
  drawCurve();
}

function summarizeCtrl(c) {
  if (c.finish) return "FINISH";
  const bits = [];
  if (c.throttle > 0.15) bits.push(`FWD ${(c.throttle * 100) | 0}%`);
  if (c.steering < -0.15) bits.push("LEFT");
  if (c.steering > 0.15) bits.push("RIGHT");
  bits.push(c.pen_down ? `PEN↓ p${(c.pressure ?? 0).toFixed(1)}` : "PEN↑");
  return bits.join(" · ") || "HOLD";
}

function pushViz(result) {
  if (viz) {
    viz.setControl({
      throttle: lastCtrl.throttle,
      steering: lastCtrl.steering,
      pen_down: lastCtrl.pen_down,
      pressure: lastCtrl.pressure,
      actionLabel: summarizeCtrl(lastCtrl),
    });
    viz.syncEnv({
      pose: {
        x: env.x,
        y: env.y,
        heading: env.heading,
        penDown: env.penDown,
        pressure: env.pressure,
      },
      ink: env.ink,
      target: env.target,
      strokes: env.strokes,
      covered: env.covered,
    });
    if (ui.paperPreview && viz.paperDraw?.canvas) {
      ui.paperPreview.src = viz.paperDraw.canvas.toDataURL("image/jpeg", 0.72);
    }
  }
  syncUi(env.observe(), result || env._result(0, "sync"));
}

async function decide(obs) {
  const res = await fetch("/api/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      backend: ui.backend?.value || "malecns",
      reinforcement: lastRewardSign,
      observation: obs,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function blendImitation(cns, imit, mix = 0.65) {
  if (!imit) return cns;
  if (!cns) return imit;
  return {
    throttle: cns.throttle * (1 - mix) + imit.throttle * mix,
    steering: cns.steering * (1 - mix) + imit.steering * mix,
    pen_down: mix > 0.5 ? imit.pen_down : cns.pen_down,
    pressure: (cns.pressure ?? 0.5) * (1 - mix) + imit.pressure * mix,
    finish: cns.finish || imit.finish,
    reason: `hybrid ${mix.toFixed(2)} · ${imit.reason}`,
    model: `${cns.model || "cns"}+imitation`,
    backend: "hybrid",
    neural: cns.neural,
  };
}

async function saveCheckpoint() {
  const res = await fetch("/api/checkpoint/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "trump_portrait.npz" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  ui.status.textContent = `saved ${data.path}`;
  return data;
}

async function loadCheckpoint() {
  const res = await fetch("/api/checkpoint/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "trump_portrait.npz" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  ui.status.textContent = `loaded ${data.path}`;
  return data;
}

async function onEpisodeEnd(result) {
  episode += 1;
  const like = scoreLikeness(viz?.paperDraw?.canvas, ensurePencilTarget());
  const grade = gradeDrawing(env, { likeness: like });
  lastGrade = grade;
  bestAcc = Math.max(bestAcc, grade.accuracy);
  const wasTest = env.isTest;
  const pass = 0.55; // photo likeness is harder; gate lower than contour-only

  if (wasTest) {
    const leveled = curriculum.recordTest(grade.accuracy, {
      cover: grade.coverage,
      likeness: grade.likeness,
      shape: env.shape,
    });
    if (leveled) {
      ui.status.textContent = `LEVEL UP → Lv${curriculum.level.id} ${curriculum.level.name}`;
    }
  } else {
    curriculum.recordTrain(grade.accuracy, {
      cover: grade.coverage,
      likeness: grade.likeness,
      shape: env.shape,
    });
  }

  lastRewardSign = grade.accuracy >= pass ? "reward" : "aversive";
  try {
    await decide(env.observe());
  } catch {
    /* ignore */
  }
  lastRewardSign = "none";

  history.push({
    ep: episode,
    kind: wasTest ? "test" : "train",
    acc: +(grade.accuracy * 100).toFixed(1),
    like: +((grade.likeness || 0) * 100).toFixed(1),
    cover: +(grade.coverage * 100).toFixed(1),
    steps: env.stepCount,
    t: new Date().toISOString(),
  });
  if (history.length > 40) history.shift();
  await reportProgress(history[history.length - 1]);
  syncUi(env.observe(), result);
  updateProgressBoard({
    cover: Math.round(grade.coverage * 100),
    steps: env.stepCount,
    goalIdx: env.strokes?.length || 0,
    strokeN: env.strokes?.length || 1,
  });
  if (ui.status) {
    ui.status.textContent = `photo-likeness ${((grade.likeness || 0) * 100).toFixed(0)}% · acc ${(grade.accuracy * 100).toFixed(0)}% · ep${episode}`;
  }

  if (ui.train?.checked && ui.backend.value === "malecns" && episode % 3 === 0) {
    try {
      await saveCheckpoint();
    } catch (err) {
      console.warn("checkpoint save failed", err);
    }
  }

  nextIsTest = !wasTest && episode % 8 === 0;

  if (ui.train?.checked && ui.mode?.value !== "demo") {
    clearTimeout(pendingReset);
    pendingReset = setTimeout(() => {
      reset();
      if (ui.auto.checked) decisionStep();
    }, 900);
  }
}

async function decisionStep() {
  if (busy || env.done) return;
  if (ui.mode?.value === "demo") return;
  busy = true;
  ui.status.textContent = `${ui.mode?.value || ui.backend.value} running…`;
  const obs = env.observe();
  try {
    const mode = ui.mode?.value || "malecns";
    let data;
    if (mode === "imitation") {
      data = demos.imitate(obs) || {
        throttle: 0.4,
        steering: 0,
        pen_down: false,
        pressure: 0.4,
        finish: false,
        reason: "no demos yet — record first",
        backend: "imitation",
      };
    } else {
      data = await decide(obs);
      data.pressure = data.pressure ?? (data.pen_down ? 0.55 : 0.2);
      if (mode === "hybrid") {
        data = blendImitation(data, demos.imitate(obs), demos.count > 20 ? 0.7 : 0.35);
      }
    }
    lastCtrl = {
      throttle: Number(data.throttle ?? 0),
      steering: Number(data.steering ?? 0),
      pen_down: Boolean(data.pen_down),
      pressure: Number(data.pressure ?? 0.5),
      finish: Boolean(data.finish),
    };
    lastReason = data.reason || "";
    ui.status.textContent = `${data.backend || "?"} · ${data.model || ""} · ep${episode}`;
    if (data.neural) {
      ui.neuralOut.textContent = JSON.stringify(
        {
          side: data.neural.side,
          left_hz: data.neural.left_hz,
          right_hz: data.neural.right_hz,
          KC_spikes: data.neural.KC_spikes,
          total_spikes: data.neural.total_spikes,
          memory: data.neural.memory,
        },
        null,
        2
      );
      neuralPanel.update(data.neural, data.retina_png_b64);
      if (viz) viz.setNeural(data.neural);
      updateNeuralHud(data.neural);
    } else {
      ui.neuralOut.textContent = JSON.stringify(
        { backend: data.backend, demos: demos.count },
        null,
        2
      );
    }
  } catch (err) {
    console.error(err);
    ui.status.textContent = `error: ${err.message}`;
    const herr = obs.heading_error_deg || 0;
    lastCtrl = {
      throttle: 0.7,
      steering: Math.max(-1, Math.min(1, -herr / 45)),
      pen_down: (obs.nearest_target_distance || 1) < 0.12,
      pressure: 0.5,
      finish: false,
    };
    lastReason = "local fallback";
  } finally {
    busy = false;
  }

  // Multi-substep physics for smoother high-precision tracing
  let result;
  for (let s = 0; s < 3; s++) {
    result = env.step(lastCtrl);
    if (result.done) break;
  }
  lastRewardSign = "none";
  pushViz(result);
  if (result.done) await onEpisodeEnd(result);
}

function reset(shape) {
  clearTimeout(pendingReset);
  // Showcase: always Trump portrait with photo underlay
  const shapeFinal = "trump";
  if (ui.shape) ui.shape.value = shapeFinal;

  let opts = { isTest: false };
  if (nextIsTest) {
    opts = {
      isTest: true,
      transform: {
        scale: 0.94 + Math.random() * 0.1,
        rot: (Math.random() - 0.5) * 0.2,
        dx: (Math.random() - 0.5) * 0.05,
        dy: (Math.random() - 0.5) * 0.05,
      },
    };
    nextIsTest = false;
  }
  env.reset(shapeFinal, opts);
  lastCtrl = { throttle: 0, steering: 0, pen_down: false, pressure: 0.7, finish: false };
  lastReason = "";
  lastRewardSign = "none";
  if (viz) viz.resetPaper(env.strokes);
  pushViz();
  if (opts.isTest) ui.status.textContent = `TEST · Trump portrait`;
  else ui.status.textContent = `Trump portrait · photo + pencil`;
}

function humanStepTo(pick) {
  if (!pick || env.done) return;
  const dx = pick.x - env.x;
  const dy = pick.y - env.y;
  const dist = Math.hypot(dx, dy);
  const want = Math.atan2(dy, dx);
  let herr = want - env.heading;
  while (herr > Math.PI) herr -= Math.PI * 2;
  while (herr < -Math.PI) herr += Math.PI * 2;
  const ctrl = {
    throttle: Math.min(1, dist / 0.06),
    steering: Math.max(-1, Math.min(1, herr / ((24 * Math.PI) / 180))),
    pen_down: dragging,
    pressure: humanPressure,
    finish: false,
  };
  const obs = env.observe();
  demos.push(obs, ctrl);
  lastCtrl = ctrl;
  lastReason = demos.recording ? "human demo" : "human draw";
  const result = env.step(ctrl);
  if (result.reward > 0.05) lastRewardSign = "reward";
  else if (result.reward < -0.05) lastRewardSign = "aversive";
  else lastRewardSign = "none";
  pushViz(result);
  if (result.done) onEpisodeEnd(result);
}

// pointer drawing on paper (demo / assist)
view.addEventListener("pointerdown", (e) => {
  if (!viz) return;
  if (ui.mode?.value !== "demo" && !e.shiftKey) return;
  const pick = pickPaper(viz.camera, view, e.clientX, e.clientY, THREE);
  if (!pick) return;
  dragging = true;
  view.setPointerCapture(e.pointerId);
  viz.controls.enabled = false;
  lastPick = pick;
  // teleport near start for demo convenience
  if (ui.mode?.value === "demo") {
    env.x = pick.x;
    env.y = pick.y;
  }
  humanStepTo(pick);
});

view.addEventListener("pointermove", (e) => {
  if (!dragging || !viz) return;
  humanPressure = e.pressure > 0.05 ? Math.min(1, 0.25 + e.pressure * 0.9) : humanPressure;
  if (e.buttons === 1 && e.shiftKey) humanPressure = Math.min(1, humanPressure + 0.02);
  const pick = pickPaper(viz.camera, view, e.clientX, e.clientY, THREE);
  if (!pick) return;
  if (lastPick && Math.hypot(pick.x - lastPick.x, pick.y - lastPick.y) < 0.012) return;
  lastPick = pick;
  humanStepTo(pick);
});

function endDrag(e) {
  if (!dragging) return;
  dragging = false;
  lastPick = null;
  if (viz) viz.controls.enabled = true;
  env.penDown = false;
  env.pressure = 0;
  if (viz) viz.paperDraw.liftPen();
}

view.addEventListener("pointerup", endDrag);
view.addEventListener("pointercancel", endDrag);

ui.shape.addEventListener("change", () => reset(ui.shape.value));
ui.btnReset.addEventListener("click", () => reset(ui.shape.value));
ui.btnStep.addEventListener("click", () => {
  ui.auto.checked = false;
  decisionStep();
});
ui.btnSave?.addEventListener("click", () => {
  saveCheckpoint().catch((err) => {
    ui.status.textContent = `save failed: ${err.message}`;
  });
});
ui.btnLoad?.addEventListener("click", () => {
  loadCheckpoint()
    .then(() => reset(ui.shape.value))
    .catch((err) => {
      ui.status.textContent = `load failed: ${err.message}`;
    });
});
ui.btnRec?.addEventListener("click", () => {
  if (demos.recording) {
    demos.stop();
    ui.btnRec.textContent = "开始示范";
    ui.status.textContent = `demo saved · samples ${demos.count}`;
    ui.mode.value = demos.count > 10 ? "hybrid" : "demo";
  } else {
    ui.mode.value = "demo";
    ui.auto.checked = false;
    demos.start();
    ui.btnRec.textContent = "结束示范";
    ui.status.textContent = "recording — drag on paper to draw";
  }
  syncUi(env.observe());
});
ui.btnClearDemo?.addEventListener("click", () => {
  demos.clear();
  syncUi(env.observe());
  ui.status.textContent = "demos cleared";
});
ui.btnViewDesk?.addEventListener("click", () => sceneSubmit({ actor: "ui", op: "camera", props: { preset: "desk" } }));
ui.btnViewTop?.addEventListener("click", () => sceneSubmit({ actor: "ui", op: "camera", props: { preset: "top" } }));
ui.btnViewSide?.addEventListener("click", () => sceneSubmit({ actor: "ui", op: "camera", props: { preset: "side" } }));
ui.btnViewBrain?.addEventListener("click", () => {
  sceneSubmit({ actor: "ui", op: "camera", props: { preset: "brain" } });
  if (ui.follow) ui.follow.checked = true;
  if (ui.camHint) ui.camHint.textContent = "MaleCNS 真实 soma 点云 · 彩虹=位置 · 青=KC · 绿/橙=DNp20";
});
ui.follow?.addEventListener("change", () => {
  sceneSubmit({ actor: "ui", op: "camera", props: { follow: ui.follow.checked } });
});
ui.autoOrbit?.addEventListener("change", () => {
  sceneSubmit({ actor: "ui", op: "camera", props: { orbit: ui.autoOrbit.checked } });
});

async function boot() {
  try {
    const h = await fetch("/api/health").then((r) => r.json());
    if (h.malecns_ready) {
      ui.status.textContent = "loading Trump photo strokes…";
      ui.backend.value = "malecns";
    } else {
      ui.status.textContent = `MaleCNS unavailable · ${h.malecns_error || "use gpt6"}`;
      ui.backend.value = "gpt6";
    }
  } catch (err) {
    ui.status.textContent = `health failed: ${err.message}`;
  }

  try {
    const pack = await loadTrumpPhotoStrokes();
    setTrumpPhotoPack(pack);
    ensurePencilTarget();
    ui.status.textContent = `photo strokes ${pack.strokes?.length || 0} · likeness mode`;
  } catch (err) {
    console.error(err);
    ui.status.textContent = `stroke pack failed: ${err.message}`;
  }

  if (ui.shape) ui.shape.value = "trump";
  if (ui.train) ui.train.checked = true;
  if (ui.mode) ui.mode.value = "malecns";
  curriculum.levelIdx = 4;
  curriculum.save();
  await loadServerProgress();
  reset();
  viz?.setViewPreset("desk");
  pullScene();
  setInterval(pullScene, 400);
  setTimeout(() => {
    if (viz) viz.resetPaper(env.strokes);
    pushViz();
    decisionStep();
  }, 500);
}

function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;
  if (viz) {
    viz.update(dt);
    viz.render();
    if (ui.follow) ui.follow.checked = viz.followFly;
    if (ui.autoOrbit) ui.autoOrbit.checked = viz.autoOrbit;
  }
  const interval = ui.backend.value === "malecns" ? 1800 : 900;
  const agentMode = ui.mode?.value !== "demo";
  if (ui.auto.checked && agentMode && !env.done && !busy && ts - lastDecide > interval) {
    lastDecide = ts;
    decisionStep();
  }
  requestAnimationFrame(frame);
}

window.addEventListener("error", (e) => {
  ui.status.textContent = `JS: ${e.message}`;
});
window.addEventListener("unhandledrejection", (e) => {
  ui.status.textContent = `Promise: ${e.reason?.message || e.reason}`;
});

boot();
requestAnimationFrame(frame);
