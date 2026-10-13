import * as THREE from "../js/vendor/three.module.js";
import { SAMPLES, buildTrackMeshes, createTrackData } from "./track.js";
import { Kart, TUNE, aiInput, emptyInput } from "./kart.js";

const LAPS = 3;
const STEP = 1 / 120;

// ① Renderer, scene, camera, light: the stage every frame is drawn on.
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x8fd3ff, 80, 260);

const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 600);
scene.add(new THREE.HemisphereLight(0xdff3ff, 0x4a7a3a, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
scene.add(sun, sun.target);

// ② Track: one spline turned into road, curbs, walls, pads, trees.
const track = createTrackData();
buildTrackMeshes(scene, track);

// ③ Karts: the player and three AI share one class.
const roster = [
  { name: "你", color: 0xff3b30, skill: null },
  { name: "Dao", color: 0x2f80ff, skill: 0.98 },
  { name: "Bazzi", color: 0xffcc00, skill: 0.95 },
  { name: "Marid", color: 0x34c759, skill: 0.92 },
];
const karts = roster.map((r, k) => {
  const kart = new Kart({
    name: r.name,
    color: r.color,
    track,
    startIndex: -6 - Math.floor(k / 2) * 7,
    lane: k % 2 ? 3 : -3,
  });
  kart.skill = r.skill;
  kart.aiLane = [-2, 2, -1, 1][k];
  scene.add(kart.model.root);
  return kart;
});
const player = karts[0];

// ④ Input: keys become the same input object the AI produces.
const keys = new Set();
const GAME_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight"];
addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.code === "KeyR" && state.phase === "race") recover(player);
  if (e.code === "Enter" && state.phase !== "race" && state.phase !== "countdown") startRace();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

let steerSmooth = 0;
function playerInput(dt) {
  const input = emptyInput();
  const left = keys.has("ArrowLeft") || keys.has("KeyA");
  const right = keys.has("ArrowRight") || keys.has("KeyD");
  const want = (right ? 1 : 0) - (left ? 1 : 0);
  steerSmooth += (want - steerSmooth) * Math.min(1, dt * 10);
  input.steer = steerSmooth;
  input.throttle = keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0;
  input.brake = keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0;
  input.drift = keys.has("ShiftLeft") || keys.has("ShiftRight");
  input.nitro = keys.has("Space");
  return input;
}

function recover(kart) {
  const i = kart.idx;
  const lap = kart.progress - i;
  kart.reset(i, 0);
  kart.progress = lap + i;
}

// ⑤ Race state: countdown, laps, ranking, finish.
const state = { phase: "title", clock: 0, countdown: 0, results: [] };

function startRace() {
  karts.forEach((k, n) => {
    k.reset(-6 - Math.floor(n / 2) * 7, n % 2 ? 3 : -3);
  });
  state.phase = "countdown";
  state.countdown = 3.5;
  state.clock = 0;
  state.results = [];
  ui.banner.textContent = "";
  ui.panel.hidden = true;
}

function ranking() {
  return [...karts].sort((a, b) => {
    if (a.finished != null && b.finished != null) return a.finished - b.finished;
    if (a.finished != null) return -1;
    if (b.finished != null) return 1;
    return b.progress - a.progress;
  });
}

function simulate(dt) {
  if (state.phase === "countdown") {
    state.countdown -= dt;
    if (state.countdown <= 0) state.phase = "race";
    return;
  }
  if (state.phase !== "race" && state.phase !== "done") return;
  state.clock += dt;

  for (const k of karts) {
    let input;
    if (k.finished != null) {
      input = aiInput(k, 0.6);
    } else if (k === player && state.phase === "race") {
      input = playerInput(dt);
    } else {
      input = aiInput(k, k.skill ?? 0.9);
    }
    k.step(input, dt);
    if (k.finished == null && k.lap >= LAPS) {
      k.finished = state.clock;
      state.results.push(k);
      if (k === player) finishRace();
    }
  }
  for (let a = 0; a < karts.length; a++) {
    for (let b = a + 1; b < karts.length; b++) Kart.bump(karts[a], karts[b]);
  }
}

function finishRace() {
  state.phase = "done";
  const place = state.results.indexOf(player) + 1;
  ui.banner.textContent = place === 1 ? "冠军！" : `第 ${place} 名`;
  ui.panelTitle.textContent = `完成 · ${formatTime(player.finished)}`;
  ui.panelBody.textContent = "按 Enter 再来一局";
  ui.panel.hidden = false;
}

// ⑥ Chase camera: follows behind, widens its lens when boosting.
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const tmpF = new THREE.Vector3();
function updateCamera(dt, snap = false) {
  const f = player.forward(tmpF);
  const want = player.pos.clone().addScaledVector(f, -6.5).setY(2.8);
  const look = player.pos.clone().addScaledVector(f, 4).setY(1.2);
  const k = snap ? 1 : 1 - Math.exp(-dt * 14);
  camPos.lerp(want, k);
  camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 18));
  camera.position.copy(camPos);
  if (player.bumped > 0) camera.position.y += Math.sin(player.bumped * 60) * 0.12;
  camera.lookAt(camLook);
  const fov = 64 + (player.boost > 0 ? 8 : 0) + player.speed * 0.12;
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();

  sun.position.copy(player.pos).add(new THREE.Vector3(30, 60, 20));
  sun.target.position.copy(player.pos);
}

// ⑦ HUD: plain DOM on top of the canvas.
const ui = {
  lap: document.getElementById("lap"),
  pos: document.getElementById("pos"),
  time: document.getElementById("time"),
  speed: document.getElementById("speed"),
  gauge: document.getElementById("gauge"),
  nitro: document.getElementById("nitro"),
  drift: document.getElementById("drift"),
  banner: document.getElementById("banner"),
  panel: document.getElementById("panel"),
  panelTitle: document.getElementById("panelTitle"),
  panelBody: document.getElementById("panelBody"),
  board: document.getElementById("board"),
  map: document.getElementById("map"),
};

function formatTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(2).padStart(5, "0")}`;
}

const mapCtx = ui.map.getContext("2d");
const bounds = track.P.reduce(
  (b, p) => ({
    minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x),
    minZ: Math.min(b.minZ, p.z), maxZ: Math.max(b.maxZ, p.z),
  }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
);
function toMap(p) {
  const w = ui.map.width - 16;
  const h = ui.map.height - 16;
  const s = Math.min(w / (bounds.maxX - bounds.minX), h / (bounds.maxZ - bounds.minZ));
  return [8 + (p.x - bounds.minX) * s, 8 + (p.z - bounds.minZ) * s];
}
function drawMap() {
  const c = mapCtx;
  c.clearRect(0, 0, ui.map.width, ui.map.height);
  c.lineWidth = 7;
  c.strokeStyle = "rgba(255,255,255,0.85)";
  c.beginPath();
  for (let i = 0; i <= SAMPLES; i += 6) {
    const [x, y] = toMap(track.P[i % SAMPLES]);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
  for (const k of [...karts].reverse()) {
    const [x, y] = toMap(k.pos);
    c.fillStyle = `#${k.color.toString(16).padStart(6, "0")}`;
    c.beginPath();
    c.arc(x, y, k === player ? 6 : 4.5, 0, Math.PI * 2);
    c.fill();
  }
}

function updateHud() {
  const order = ranking();
  const lap = Math.min(LAPS, Math.max(1, player.lap + 1));
  ui.lap.textContent = `${lap}/${LAPS}`;
  ui.pos.textContent = `${order.indexOf(player) + 1}/${karts.length}`;
  ui.time.textContent = formatTime(state.clock);
  ui.speed.textContent = Math.round(player.speed * 3.6);
  ui.gauge.style.width = `${Math.min(100, player.gauge * 100)}%`;
  ui.nitro.textContent = "N".repeat(player.nitro) + "·".repeat(TUNE.maxNitro - player.nitro);
  ui.drift.style.opacity = player.drifting ? 1 : 0;
  ui.drift.style.color = player.charge > 1.6 ? "#ff8a1f" : player.charge > 0.7 ? "#4fc3ff" : "#fff";
  ui.board.innerHTML = order
    .map((k, n) => `<li class="${k === player ? "me" : ""}">${n + 1}. ${k.name}${k.finished != null ? " ✓" : ""}</li>`)
    .join("");
  if (state.phase === "countdown") {
    const n = Math.ceil(state.countdown - 0.5);
    ui.banner.textContent = n > 0 ? String(n) : "GO!";
  } else if (state.phase === "race" && state.clock < 1) {
    ui.banner.textContent = "GO!";
  } else if (state.phase === "race") {
    ui.banner.textContent = "";
  }
  drawMap();
}

// ⑧ Loop: physics in fixed steps, drawing once per screen refresh.
function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= STEP) {
    simulate(STEP);
    acc -= STEP;
  }
  for (const k of karts) k.syncModel(dt);
  updateCamera(dt);
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

updateCamera(0, true);
ui.panelTitle.textContent = "跑跑卡丁车 · Three.js";
ui.panelBody.textContent = "按 Enter 开始";
ui.panel.hidden = false;
requestAnimationFrame(frame);

window.kartGame = { karts, player, track, state, startRace };
