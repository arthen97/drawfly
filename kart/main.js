import * as THREE from "three";
import { SAMPLES, buildTrackMeshes, createTrackData } from "./track.js";
import { Kart, TUNE, aiInput, emptyInput } from "./kart.js";
import { loadAssets } from "./assets.js";
import { buildKartModel } from "./kart-model.js";
import { toonify } from "./toon.js";
import { createPost } from "./post.js";
import { createFx } from "./fx.js";
import { createAudio } from "./audio.js";

const LAPS = 3;
const STEP = 1 / 120;
const $ = (id) => document.getElementById(id);

// ① Renderer, scene, camera, light: the stage every frame is drawn on.
const canvas = $("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
const post = createPost(renderer);
const audio = createAudio();

const TIPS = [
  "Tip: hold Shift through a corner until the sparks turn orange for a Super Turbo.",
  "Tip: hit the boost pad just before a hazard-striped ramp for a huge jump.",
  "Tip: drifting fills the blue bar; a full bar earns a nitro for Space.",
  "Tip: yellow chevron pads give a free boost. Hit them dead centre.",
];
$("loadTip").textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
const assets = await loadAssets(renderer, (p) => {
  $("loadPct").textContent = `${Math.round(p * 100)}%`;
  $("loadFill").style.width = `${p * 100}%`;
});

// The HDRI is the sky you see; toon materials ignore image-based light, so lights below do the shading.
const scene = new THREE.Scene();
scene.background = assets.sky.background;
scene.backgroundBlurriness = 0.03;
scene.fog = new THREE.Fog(0xc9d8e4, 120, 420);

const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 900);
// Sky/ground bounce fills the shadow band; the sun decides where the light band ends.
scene.add(new THREE.HemisphereLight(0xd6e8ff, 0x6b7a4a, 1.25));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
scene.add(sun, sun.target);

// ② Track: one spline with height turned into road, embankments, kicker, walls, tyres, billboards, trees.
const track = createTrackData();
const trackFx = buildTrackMeshes(scene, track, assets);
toonify(scene);
const particles = createFx(scene);

// ③ Karts: the player and three AI share one class; each gets its own Kenney body and stickers.
const roster = [
  { name: "You", avatar: "avatar-you", color: 0x7b61ff, skill: null, body: "oobi", number: 1, sponsor: "decal-turbo-noodle",
    line: "Rookie sensation · Turbo Noodle Racing" },
  { name: "Dao", avatar: "avatar-dao", color: 0xe0559f, skill: 0.98, body: "oodi", number: 7, sponsor: "decal-dao-motors",
    line: "Drift queen · Dao Motors" },
  { name: "Bazzi", avatar: "avatar-bazzi", color: 0xffc83a, skill: 0.95, body: "ooli", number: 3, sponsor: "decal-bazzi-oil",
    line: "Fearless rocket · Bazzi Oil" },
  { name: "Marid", avatar: "avatar-marid", color: 0x3fc1a9, skill: 0.92, body: "oopi", number: 8, sponsor: "decal-nitro-fizz",
    line: "Cool-headed tactician · Nitro Fizz" },
];
const gridSlot = (k) => ({ index: -6 - Math.floor(k / 2) * 7, lane: k % 2 ? 3 : -3 });
const karts = roster.map((r, k) => {
  const kart = new Kart({ name: r.name, color: r.color, track, model: buildKartModel(assets, r), startIndex: gridSlot(k).index, lane: gridSlot(k).lane });
  kart.skill = r.skill;
  kart.info = r;
  kart.avatar = r.avatar;
  kart.aiLane = [-2, 2, -1, 1][k];
  scene.add(kart.model.root);
  return kart;
});
const player = karts[0];

// ④ Input: keys become the same input object the AI produces.
const keys = new Set();
const GAME_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight", "Enter"];
addEventListener("keydown", (e) => {
  audio.unlock();
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === "KeyM") toggleSound();
  if (state.phase === "title") return titleKey(e.code);
  if (state.phase === "intro" && (e.code === "Enter" || e.code === "Space" || e.code === "Escape")) return startCountdown();
  if (e.code === "KeyR" && state.phase === "race") recover(player);
  if (state.phase === "done" && e.code === "Enter") startCountdown();
  if ((state.phase === "done" || state.phase === "race") && e.code === "Escape") showTitle();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
addEventListener("pointerdown", () => audio.unlock());

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

// ⑤ Phases: title (attract mode) → intro (one shot per racer) → countdown → race → done.
const state = { phase: "loading", clock: 0, countdown: 0, results: [], intro: 0, attract: 0 };
const setMode = (m) => (document.body.className = `mode-${m}`);

function placeOnGrid() {
  karts.forEach((k, n) => {
    const { index, lane } = gridSlot(n);
    k.reset(index, lane);
  });
}

function showTitle() {
  state.phase = "title";
  state.attract = 0;
  setMode("title");
  ui.panel.hidden = true;
  ui.banner.textContent = "";
  $("help").hidden = true;
  karts.forEach((k, n) => k.reset(gridSlot(n).index + 60 + n * 9, (n % 2 ? 2 : -2)));
  audio.music("title");
}

const INTRO_ORDER = [3, 2, 1, 0];
const SHOT = 2.6;
const FLYOVER = 2.4;
function startIntro() {
  placeOnGrid();
  state.phase = "intro";
  state.intro = 0;
  state.introShown = -1;
  setMode("intro");
  ui.panel.hidden = true;
  audio.music("race");
}

function startCountdown() {
  placeOnGrid();
  state.phase = "countdown";
  state.countdown = 3.5;
  state.lastBeep = 4;
  state.clock = 0;
  state.results = [];
  setMode("race");
  ui.banner.textContent = "";
  ui.panel.hidden = true;
  ui.podium.hidden = true;
  boardOrder = "";
  updateCamera(0, true);
  audio.music("race");
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
  if (state.phase === "title") {
    for (const k of karts) k.step(aiInput(k, (k.skill ?? 0.96) * 0.97), dt);
    for (let a = 0; a < karts.length; a++) for (let b = a + 1; b < karts.length; b++) Kart.bump(karts[a], karts[b]);
    return;
  }
  if (state.phase === "intro") {
    state.intro += dt;
    if (state.intro > INTRO_ORDER.length * SHOT + FLYOVER) startCountdown();
    return;
  }
  if (state.phase === "countdown") {
    state.countdown -= dt;
    const n = Math.ceil(state.countdown - 0.5);
    if (n < state.lastBeep) {
      state.lastBeep = n;
      if (n <= 3) audio.beep(n <= 0);
      ui.banner.classList.remove("pulse");
      void ui.banner.offsetWidth;
      ui.banner.classList.add("pulse");
    }
    if (state.countdown <= 0) state.phase = "race";
    return;
  }
  if (state.phase !== "race" && state.phase !== "done") return;
  state.clock += dt;

  for (const k of karts) {
    let input;
    if (k.finished != null) input = aiInput(k, 0.6);
    else if (k === player && state.phase === "race") input = playerInput(dt);
    else input = aiInput(k, k.skill ?? 0.9);
    if (k === player) state.throttle = input.throttle;
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
  ui.banner.textContent = place === 1 ? "WINNER!" : `P${place}`;
  ui.panelTitle.textContent = `Finished · ${formatTime(player.finished)}`;
  ui.panelBody.innerHTML = "<kbd>Enter</kbd> race again · <kbd>Esc</kbd> main menu";
  ui.podium.innerHTML = state.results
    .slice(0, 3)
    .map((k, n) => `<figure class="p${n + 1}"><img src="${avatarUrl(k)}" alt="" /><figcaption>${n + 1}. ${k.name}</figcaption></figure>`)
    .join("");
  ui.podium.hidden = false;
  ui.panel.hidden = false;
  audio.music("victory");
}

// ⑥ Cameras. Chase cam in the race; cinematic cuts in the title; one orbit shot per racer in the intro.
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const focus = new THREE.Vector3();
const tmpF = new THREE.Vector3();
const tmpR = new THREE.Vector3();
const ease = (t) => t * t * (3 - 2 * t);

function chaseTarget(kart, outPos, outLook) {
  const f = kart.forward(tmpF);
  // Leading the target by vel/14 cancels the steady lag of the exponential follow below.
  outPos.copy(kart.pos).addScaledVector(f, -6.8).addScaledVector(kart.vel, 1 / 14).setY(kart.pos.y + 3.4);
  outLook.copy(kart.pos).addScaledVector(f, 6).setY(kart.pos.y + 1.3);
}

/** Aim so `subject` sits right of centre by `share` of the view width (menus and cards live on the left). */
const camDir = new THREE.Vector3();
const camSide = new THREE.Vector3();
function frameRight(from, subject, lift, share) {
  camDir.subVectors(subject, from).setY(0);
  const dist = camDir.length();
  camSide.crossVectors(camDir, THREE.Object3D.DEFAULT_UP).normalize();
  const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * dist;
  camLook.copy(subject).addScaledVector(camSide, -halfW * share).setY(subject.y + lift);
}

function updateCamera(dt, snap = false) {
  if (window.kartGame?.cameraOverride) {
    window.kartGame.cameraOverride(camera, player);
    return;
  }
  let fov = 64;
  if (state.phase === "title") {
    // Attract mode: a new angle on a new racer every 4.5 s.
    const shot = Math.floor(state.attract / 4.5);
    const t = (state.attract % 4.5) / 4.5;
    const kart = karts[shot % karts.length];
    const f = kart.forward(tmpF);
    const r = kart.right(tmpR);
    const style = shot % 3;
    const p = kart.pos;
    if (style === 0) camPos.copy(p).addScaledVector(r, 8.5).addScaledVector(f, 4 - t * 7).setY(p.y + 1.5);
    else if (style === 1) camPos.copy(p).addScaledVector(f, 12 - t * 3).addScaledVector(r, -3).setY(p.y + 2.0);
    else camPos.copy(p).addScaledVector(f, -12).addScaledVector(r, 4 * Math.sin(t * 3)).setY(p.y + 6 - t * 2);
    frameRight(camPos, p, 0.9, 0.28);
    focus.copy(p);
    fov = 46;
    camera.fov = fov;
  } else if (state.phase === "intro") {
    const i = Math.floor(state.intro / SHOT);
    if (i < INTRO_ORDER.length) {
      // Each racer: a low orbit that sweeps from a front three-quarter to the other side.
      const kart = karts[INTRO_ORDER[i]];
      const t = ease((state.intro % SHOT) / SHOT);
      const f = kart.forward(tmpF);
      const r = kart.right(tmpR);
      const side = i % 2 ? 1 : -1;
      const a = side * (1.0 - t * 1.5);
      const radius = 8 - t * 1.6;
      camPos.copy(kart.pos).addScaledVector(f, Math.cos(a) * radius).addScaledVector(r, Math.sin(a) * radius)
        .setY(kart.pos.y + 1.3 + t * 0.5);
      frameRight(camPos, kart.pos, 1.15, 0.2);
      focus.copy(kart.pos);
      fov = 42 - t * 6;
    } else {
      // Grid flyover: from high in front of the grid, swooping down into the chase cam.
      const t = ease(Math.min(1, (state.intro - INTRO_ORDER.length * SHOT) / FLYOVER));
      const f = player.forward(tmpF);
      const from = player.pos.clone().addScaledVector(f, -34).addScaledVector(player.right(tmpR), 16).setY(player.pos.y + 15);
      const lookFrom = player.pos.clone().addScaledVector(f, 14);
      chaseTarget(player, camPos, camLook);
      camPos.lerpVectors(from, camPos, t);
      camLook.lerpVectors(lookFrom, camLook, t);
      focus.copy(player.pos);
      fov = THREE.MathUtils.lerp(55, 64, t);
    }
    camera.fov = fov;
  } else {
    const want = new THREE.Vector3();
    const look = new THREE.Vector3();
    chaseTarget(player, want, look);
    const k = snap ? 1 : 1 - Math.exp(-dt * 14);
    camPos.lerp(want, k);
    camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * (player.air ? 8 : 18)));
    focus.copy(player.pos);
    fov = 64 + (player.boost > 0 ? 8 : 0) + player.speed * 0.12;
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    if (snap) camera.fov = fov;
  }
  camera.position.copy(camPos);
  if (state.phase !== "title" && player.bumped > 0) camera.position.y += Math.sin(player.bumped * 60) * 0.12;
  if (state.phase !== "title" && player.landed > 0) camera.position.y -= Math.sin((player.landed / 0.35) * Math.PI) * 0.25;
  camera.lookAt(camLook);
  camera.updateProjectionMatrix();

  sun.position.copy(focus).add(new THREE.Vector3(40, 70, -30));
  sun.target.position.copy(focus);
}

// ⑦ HUD and menus: plain DOM on top of the canvas.
const ui = {
  lap: $("lap"), pos: $("pos"), time: $("time"), speed: $("speed"), gauge: $("gauge"), nitro: $("nitro"),
  drift: $("drift"), charge: $("charge"), turbo: $("turbo"), banner: $("banner"),
  panel: $("panel"), panelTitle: $("panelTitle"), panelBody: $("panelBody"), podium: $("podium"),
  board: $("board"), map: $("map"), meAvatar: $("meAvatar"), meName: $("meName"),
};

const avatarUrl = (k) => `./assets/tex/${k.avatar}.webp`;
const avatarImg = new Map(karts.map((k) => {
  const img = new Image();
  img.src = avatarUrl(k);
  return [k, img];
}));
const hex = (c) => `#${c.toString(16).padStart(6, "0")}`;
ui.meAvatar.src = avatarUrl(player);
ui.meAvatar.style.borderColor = hex(player.color);
ui.meName.textContent = player.name;
const boardRows = new Map(karts.map((k) => {
  const li = document.createElement("li");
  li.className = k === player ? "me" : "";
  li.style.setProperty("--ring", hex(k.color));
  li.innerHTML = `<span class="rank"></span><img src="${avatarUrl(k)}" alt="" /><span class="name">${k.name}</span>`;
  ui.board.append(li);
  return [k, li];
}));
let boardOrder = "";

// Title screen: menu, roster strip, track card with a height-shaded map.
const menu = [...document.querySelectorAll("#menu button")];
let menuSel = 0;
function selectMenu(n) {
  menuSel = (n + menu.length) % menu.length;
  menu.forEach((b, i) => b.classList.toggle("sel", i === menuSel));
}
function activate(act) {
  audio.unlock();
  audio.click();
  if (act === "start") startIntro();
  if (act === "help") $("help").hidden = !$("help").hidden;
  if (act === "sound") toggleSound();
}
function titleKey(code) {
  if (!$("help").hidden) {
    if (code === "Escape" || code === "Enter") $("help").hidden = true;
    return;
  }
  if (code === "ArrowDown" || code === "KeyS") { selectMenu(menuSel + 1); audio.click(); }
  if (code === "ArrowUp" || code === "KeyW") { selectMenu(menuSel - 1); audio.click(); }
  if (code === "Enter" || code === "Space") activate(menu[menuSel].dataset.act);
}
menu.forEach((b, i) => {
  b.addEventListener("pointerenter", () => selectMenu(i));
  b.addEventListener("click", () => activate(b.dataset.act));
});
$("help").addEventListener("click", () => ($("help").hidden = true));
function toggleSound() {
  audio.muted = !audio.muted;
  $("soundLabel").textContent = `SOUND: ${audio.muted ? "OFF" : "ON"}`;
  $("sound").textContent = audio.muted ? "✕" : "♪";
}
$("sound").addEventListener("click", (e) => {
  e.stopPropagation();
  audio.unlock();
  toggleSound();
});

$("roster").innerHTML = roster.map((r, n) =>
  `<div class="racer${n === 0 ? " you" : ""}" style="--c:${hex(r.color)}"><img src="./assets/tex/${r.avatar}.webp" alt="" /><b>#${r.number}</b><span>${r.name}</span></div>`
).join("");
const maxRise = Math.max(...track.P.map((p) => p.y));
$("tcLength").textContent = `${(track.length / 1000).toFixed(2)} km`;
$("tcRise").textContent = `${maxRise.toFixed(1)} m`;
$("tcJumps").textContent = track.kickers.length;
$("tcPads").textContent = track.pads.length;

const bounds = track.P.reduce(
  (b, p) => ({
    minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x),
    minZ: Math.min(b.minZ, p.z), maxZ: Math.max(b.maxZ, p.z),
  }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
);
function mapper(w, h, pad) {
  const s = Math.min((w - pad * 2) / (bounds.maxX - bounds.minX), (h - pad * 2) / (bounds.maxZ - bounds.minZ));
  const ox = (w - (bounds.maxX - bounds.minX) * s) / 2;
  const oz = (h - (bounds.maxZ - bounds.minZ) * s) / 2;
  return (p) => [ox + (p.x - bounds.minX) * s, oz + (p.z - bounds.minZ) * s];
}
{
  const c = $("tcMap").getContext("2d");
  const to = mapper(520, 260, 14);
  c.lineCap = c.lineJoin = "round";
  c.lineWidth = 16;
  c.strokeStyle = "#1b1530";
  c.beginPath();
  for (let i = 0; i <= SAMPLES; i += 4) c.lineTo(...to(track.P[i % SAMPLES]));
  c.stroke();
  c.lineWidth = 9;
  for (let i = 0; i < SAMPLES; i += 4) {
    const h = track.P[i].y / maxRise;
    c.strokeStyle = `hsl(${200 - h * 170}, 95%, ${62 - h * 8}%)`;
    c.beginPath();
    c.moveTo(...to(track.P[i]));
    c.lineTo(...to(track.P[(i + 5) % SAMPLES]));
    c.stroke();
  }
  const [sx, sy] = to(track.P[0]);
  c.fillStyle = "#fff";
  c.fillRect(sx - 3, sy - 11, 6, 22);
}

const introUi = { card: $("introCard"), avatar: $("introAvatar"), num: $("introNum"), name: $("introName"),
  pos: $("introPos"), line: $("introLine"), sponsor: $("introSponsor") };
function updateIntroCard() {
  const i = Math.floor(state.intro / SHOT);
  if (i === state.introShown) return;
  state.introShown = i;
  if (i >= INTRO_ORDER.length) {
    introUi.card.classList.remove("show");
    introUi.card.style.visibility = "hidden";
    return;
  }
  const n = INTRO_ORDER[i];
  const r = roster[n];
  introUi.card.style.visibility = "visible";
  introUi.card.style.setProperty("--c", hex(r.color));
  introUi.avatar.src = `./assets/tex/${r.avatar}.webp`;
  introUi.num.textContent = r.number;
  introUi.name.textContent = n === 0 ? "YOU" : r.name.toUpperCase();
  introUi.pos.textContent = `GRID P${n + 1}`;
  introUi.line.textContent = r.line;
  introUi.sponsor.src = `./assets/tex/${r.sponsor}.webp`;
  introUi.card.classList.remove("show");
  void introUi.card.offsetWidth;
  introUi.card.classList.add("show");
  audio.whoosh();
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(2).padStart(5, "0")}`;
}

const mapCtx = ui.map.getContext("2d");
const toMap = mapper(220, 220, 8);
function drawMap() {
  const c = mapCtx;
  c.clearRect(0, 0, ui.map.width, ui.map.height);
  c.lineWidth = 7;
  c.strokeStyle = "rgba(255,255,255,0.85)";
  c.beginPath();
  for (let i = 0; i <= SAMPLES; i += 6) c.lineTo(...toMap(track.P[i % SAMPLES]));
  c.stroke();
  for (const k of [...karts].reverse()) {
    const [x, y] = toMap(k.pos);
    const r = k === player ? 11 : 8.5;
    c.fillStyle = hex(k.color);
    c.beginPath();
    c.arc(x, y, r + 2, 0, Math.PI * 2);
    c.fill();
    const img = avatarImg.get(k);
    if (img.complete && img.naturalWidth) {
      c.save();
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.clip();
      c.drawImage(img, x - r * 1.25, y - r * 1.25, r * 2.5, r * 2.5);
      c.restore();
    }
  }
}

let lastStage = 0;
function turboPopup(stage) {
  ui.turbo.textContent = stage === 2 ? "SUPER TURBO!" : "MINI TURBO!";
  ui.turbo.style.color = stage === 2 ? "#ff8a1f" : "#4fc3ff";
  ui.turbo.classList.remove("go");
  void ui.turbo.offsetWidth;
  ui.turbo.classList.add("go");
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

  const stage = player.stage;
  const on = player.drifting && player.charge > 0.1;
  ui.charge.classList.toggle("on", on);
  ui.charge.classList.toggle("s1", stage === 1);
  ui.charge.classList.toggle("s2", stage === 2);
  ui.charge.style.setProperty("--fill", stage === 0 ? player.charge / 0.7 : stage === 1 ? (player.charge - 0.7) / 0.9 : 1);
  ui.drift.style.opacity = on ? 1 : 0;
  ui.drift.textContent = stage === 2 ? "MAX!" : stage === 1 ? "TURBO" : "DRIFT";
  ui.drift.style.color = stage === 2 ? "#ff8a1f" : stage === 1 ? "#4fc3ff" : "#fff";
  if (stage > lastStage) audio.chime(stage);
  lastStage = stage;

  const sig = order.map((k) => `${k.name}${k.finished != null}`).join();
  if (sig !== boardOrder) {
    boardOrder = sig;
    order.forEach((k, n) => {
      const li = boardRows.get(k);
      li.querySelector(".rank").textContent = n + 1;
      li.classList.toggle("done", k.finished != null);
      ui.board.append(li);
    });
  }
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
  post.setSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

const fx = { blur: 0, lines: 0 };
let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = THREE.MathUtils.clamp((now - last) / 1000, 0, 0.1);
  last = now;
  acc += dt;
  while (acc >= STEP) {
    simulate(STEP);
    acc -= STEP;
  }
  if (state.phase === "title") state.attract += dt;
  for (const k of karts) k.syncModel(dt);

  const released = player.released;
  const racing = state.phase === "race" || state.phase === "done" || state.phase === "countdown";
  for (const k of karts) {
    const featured = state.phase === "intro" && karts[INTRO_ORDER[Math.floor(state.intro / SHOT)]] === k;
    const throttle = state.phase === "intro" || state.phase === "countdown"
      ? (featured ? 0.6 + 0.4 * Math.sin(now / 90) : 0.3)
      : k === player ? state.throttle ?? 1 : 1;
    particles.updateKart(k, dt, { throttle });
  }
  if (racing && released > 0) {
    turboPopup(released);
    camera.fov += 6;
    audio.whoosh();
  }
  const ev = particles.events(player);
  if (racing && ev.boostStart && !released) audio.whoosh();
  if (racing && ev.pop) audio.pop();
  particles.update(dt, renderer.domElement.height);

  updateCamera(dt);
  if (state.phase === "intro") updateIntroCard();
  if (racing) updateHud();
  audio.engine({
    speed: player.speed, throttle: racing ? state.throttle ?? 0 : 0.3, boost: player.boost > 0,
    drifting: player.drifting && !player.air, stage: player.stage,
    active: racing || state.phase === "intro",
  });
  trackFx.update(now / 1000, dt);

  // Speed feel: blur ramps in with speed, boosting adds full blur and light streaks.
  const subject = racing ? player : null;
  const boosting = subject && subject.boost > 0 ? 1 : 0;
  const wantBlur = subject ? Math.max(boosting, THREE.MathUtils.clamp((subject.speed - 20) / 30, 0, 1) * 0.3) : 0;
  fx.blur += (wantBlur - fx.blur) * Math.min(1, dt * 6);
  fx.lines += (boosting - fx.lines) * Math.min(1, dt * (boosting ? 10 : 4));
  post.render(scene, camera, { blur: fx.blur * 0.9, lines: fx.lines, time: now / 1000 });
  requestAnimationFrame(frame);
}

showTitle();
updateCamera(0, true);
requestAnimationFrame(frame);
$("loader").classList.add("gone");

window.kartGame = { karts, player, track, state, startRace: startCountdown, startIntro, showTitle, scene, camera, renderer, THREE, post, fx, audio, particles, cameraOverride: null };
