import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { PaperCanvas } from "./paper-canvas.js";
import { buildDrosophila } from "./drosophila.js";
import { SceneControl, asBool, asNumber, asVec3, objectBinding, parseColor } from "./scene-control.js";

/** Realistic atelier: desk, lamp, paper texture, fly gripping graphite pencil, orbit camera. */
export class FlyViz {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.ctrl = { throttle: 0, steering: 0, pen_down: false, pressure: 0.5, actionLabel: "HOLD" };
    this.followFly = false;
    this.autoOrbit = false;
    this.brainFocus = false;
    this._inkLen = 0;
    this.neural = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x0d0b09, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x12100e, 0.045);
    this.stage = new SceneControl();
    this._registerFog();

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 60);
    this.camera.position.set(2.4, 2.1, 3.2);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 0.55;
    this.controls.maxDistance = 9;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 0.35, 0);
    this.controls.update();

    this._lights();
    this._buildAtelier();
    this.paperDraw = new PaperCanvas(1024);
    this.paper = this._buildPaper();
    this.fly = buildDrosophila(THREE, { mat: (c, o) => this._mat(c, o) });
    this.scene.add(this.fly.root);
    this.watch("fly", this.fly.root, {
      kind: "fly",
      channels: ["position", "rotation", "visible"],
      hint: "果蝇整体。占有 position 后，纸面仿真不再搬走它。",
    });
    this._registerFlyControl();
    this.neurons = this._buildNeuronsFallback();
    this.scene.add(this.neurons.group);
    this._registerBrain(this.neurons.group);
    this._registerCamera();

    this.targetGroup = new THREE.Group();
    this.targetGroup.visible = false; // ghost lives on paper texture
    this.scene.add(this.targetGroup);

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    requestAnimationFrame(() => {
      this.resize();
      this.render();
    });
    this.resize();
  }

  watch(id, object, extra = {}) {
    object.name = id;
    this.stage.register(objectBinding(id, object, extra));
    return object;
  }

  _registerFog() {
    const fog = this.scene.fog;
    this.stage.register({
      id: "fog",
      kind: "fog",
      hint: "远处雾。density 越大，背景越早消失。",
      channels: ["color", "density"],
      get: (channel) => {
        if (channel === "density") return Math.round(fog.density * 10000) / 10000;
        return `#${fog.color.getHexString()}`;
      },
      set: (channel, value) => {
        if (channel === "density") fog.density = asNumber(value, 0, 0.2);
        else fog.color.set(parseColor(value));
      },
    });
  }

  _registerCamera() {
    const camera = this.camera;
    const controls = this.controls;
    this.stage.register({
      id: "camera",
      kind: "camera",
      hint: "镜头。preset: desk 画桌, top 俯视, side 侧视, brain 脑图。rotation 不开放，用 target 看向一点。",
      channels: ["position", "target", "fov", "follow", "orbit", "preset"],
      get: (channel) => {
        if (channel === "position") return camera.position.toArray().map((n) => Math.round(n * 10000) / 10000);
        if (channel === "target") return controls.target.toArray().map((n) => Math.round(n * 10000) / 10000);
        if (channel === "fov") return camera.fov;
        if (channel === "follow") return this.followFly;
        if (channel === "orbit") return this.autoOrbit;
        return this.brainFocus ? "brain" : null;
      },
      set: (channel, value) => {
        if (channel === "position") {
          const v = asVec3(value);
          camera.position.set(v[0], v[1], v[2]);
        } else if (channel === "target") {
          const v = asVec3(value);
          controls.target.set(v[0], v[1], v[2]);
        } else if (channel === "fov") {
          camera.fov = asNumber(value, 20, 80);
          camera.updateProjectionMatrix();
        } else if (channel === "follow") {
          this.followFly = asBool(value);
        } else if (channel === "orbit") {
          this.autoOrbit = asBool(value);
        } else if (channel === "preset") {
          if (!["desk", "top", "side", "brain"].includes(value)) throw new Error("preset 取 desk、top、side、brain");
          this.setViewPreset(value);
        }
        controls.update();
      },
      after: (props, actor, stage) => {
        if (!props.preset) return;
        if (props.preset === "brain") {
          stage.give("camera", ["position", "target"], "sim");
          stage.give("camera", ["follow"], actor);
          return;
        }
        stage.give("camera", ["position"], actor);
        if (!this.followFly) stage.give("camera", ["target"], actor);
      },
    });
  }

  _registerFlyControl() {
    this.stage.register({
      id: "fly.control",
      kind: "control",
      hint: "果蝇操纵量。占有后，决策循环不再改这一项，翅膀和力度用你写下的值。",
      channels: ["throttle", "steering", "pen_down", "pressure"],
      get: (channel) => this.ctrl[channel],
      set: (channel, value) => {
        if (channel === "pen_down") this.ctrl.pen_down = asBool(value);
        else if (channel === "steering") this.ctrl.steering = asNumber(value, -1, 1);
        else this.ctrl[channel] = asNumber(value, 0, 1);
      },
    });
  }

  _registerBrain(group) {
    this.watch("brain", group, {
      kind: "brain",
      channels: ["position", "rotation", "scale", "visible"],
      hint: "脑图。占有 position 或 scale 后，它不再黏在果蝇身上。",
    });
  }

  _mat(color, o = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: o.roughness ?? 0.55,
      metalness: o.metalness ?? 0.04,
      transparent: !!o.transparent,
      opacity: o.opacity ?? 1,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.emissiveIntensity ?? 0,
    });
  }

  _lights() {
    const lit = {
      kind: "light",
      channels: ["color", "intensity", "position"],
    };
    this.ambient = this.watch("ambient", new THREE.AmbientLight(0x6a5c4c, 0.35), {
      kind: "light",
      channels: ["color", "intensity"],
      hint: "环境光。没有方向，只抬亮暗部。",
    });
    this.scene.add(this.ambient);

    this.sun = this.watch("sun", new THREE.DirectionalLight(0xffe6c8, 1.15), {
      ...lit,
      hint: "主光。position 是光来的方向。",
    });
    this.sun.position.set(4.5, 7, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 20;
    this.sun.shadow.camera.left = -5;
    this.sun.shadow.camera.right = 5;
    this.sun.shadow.camera.top = 5;
    this.sun.shadow.camera.bottom = -5;
    this.scene.add(this.sun);

    this.lampLight = this.watch("lamp", new THREE.SpotLight(0xffd7a8, 2.2, 12, 0.55, 0.45, 1), {
      ...lit,
      hint: "台灯。占有 intensity 后，呼吸闪烁停在你写的亮度。",
    });
    this.lampLight.position.set(-1.6, 2.35, 0.8);
    this.lampLight.target.position.set(0, 0.02, 0);
    this.lampLight.castShadow = true;
    this.scene.add(this.lampLight, this.lampLight.target);

    this.rim = this.watch("rim", new THREE.PointLight(0xd17a45, 0.55, 8), {
      ...lit,
      hint: "轮廓补光。占有 intensity 后不再随飞行动作变亮。",
    });
    this.rim.position.set(1.2, 1.2, -1.4);
    this.scene.add(this.rim);

    this.fill = this.watch("fill", new THREE.DirectionalLight(0xa8c4e8, 0.35), {
      ...lit,
      hint: "冷色补光。",
    });
    this.fill.position.set(-3, 2.5, -2);
    this.scene.add(this.fill);
  }

  _buildAtelier() {
    // floorboards
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      this._mat(0x2a2218, { roughness: 0.92 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.55;
    floor.receiveShadow = true;
    this.scene.add(this.watch("floor", floor, { hint: "地板。" }));

    // desk
    const deskTop = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 0.1, 2.6),
      this._mat(0x5a4030, { roughness: 0.7 })
    );
    deskTop.position.y = -0.08;
    deskTop.castShadow = true;
    deskTop.receiveShadow = true;
    this.scene.add(this.watch("desk", deskTop, { hint: "桌面。" }));

    for (const [i, [x, z]] of [[-1.4, -1.05], [1.4, -1.05], [-1.4, 1.05], [1.4, 1.05]].entries()) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.07, 0.55, 10),
        this._mat(0x3a2a1e, { roughness: 0.85 })
      );
      leg.position.set(x, -0.35, z);
      leg.castShadow = true;
      this.scene.add(this.watch(`desk.leg.${i}`, leg, { hint: "桌腿。" }));
    }

    // back wall shelf
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 5),
      this._mat(0x1a1612, { roughness: 0.95 })
    );
    wall.position.set(0, 1.6, -3.2);
    this.scene.add(this.watch("wall", wall, { hint: "后墙。" }));

    // desk lamp
    const lampBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.18, 0.05, 20),
      this._mat(0x2c2a28, { metalness: 0.4, roughness: 0.35 })
    );
    lampBase.position.set(-1.55, -0.02, 0.85);
    this.scene.add(this.watch("lamp.base", lampBase, { hint: "台灯底座。" }));
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1.1, 10),
      this._mat(0x3a3834, { metalness: 0.5, roughness: 0.4 })
    );
    arm.position.set(-1.55, 0.55, 0.85);
    arm.rotation.z = 0.35;
    this.scene.add(this.watch("lamp.arm", arm, { hint: "台灯灯臂。" }));
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.32, 24, 1, true),
      this._mat(0xc4a574, { roughness: 0.6, emissive: 0xffc888, emissiveIntensity: 0.15 })
    );
    shade.position.set(-1.25, 1.15, 0.75);
    shade.rotation.z = 0.5;
    this.scene.add(this.watch("lamp.shade", shade, { hint: "台灯灯罩。" }));

    // pencil cup
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.08, 0.22, 16),
      this._mat(0x6b4a32, { roughness: 0.75 })
    );
    cup.position.set(1.35, 0.04, 0.95);
    cup.castShadow = true;
    this.scene.add(this.watch("cup", cup, { hint: "笔筒。" }));

    // reference photo frame — real Trump official portrait
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.78, 0.04),
      this._mat(0x1f1a14, { roughness: 0.6 })
    );
    frame.position.set(1.35, 0.48, -0.95);
    frame.rotation.y = -0.35;
    frame.castShadow = true;
    this.scene.add(this.watch("frame", frame, { hint: "桌上相框。" }));

    const texLoader = new THREE.TextureLoader();
    texLoader.load("/assets/trump-1024.jpg", (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const photo = new THREE.Mesh(
        new THREE.PlaneGeometry(0.52, 0.66),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 })
      );
      photo.position.set(1.35, 0.48, -0.925);
      photo.rotation.y = -0.35;
      this.trumpPhoto = photo;
      this.scene.add(this.watch("photo.frame", photo, { hint: "相框里的肖像。" }));
    });

    // large reference plate behind paper (easy to see)
    texLoader.load("/assets/trump-1024.jpg", (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(0.95, 1.2),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 })
      );
      board.position.set(-1.55, 0.75, -0.35);
      board.rotation.y = 0.55;
      this.scene.add(this.watch("photo.board", board, { hint: "桌后的大参考图。" }));
    });

    // clip / binder on paper corner
    const clip = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.04, 0.08),
      this._mat(0x888480, { metalness: 0.7, roughness: 0.3 })
    );
    clip.position.set(-0.92, 0.04, -0.95);
    this.scene.add(this.watch("clip", clip, { hint: "纸角夹子。" }));
  }

  _buildPaper() {
    this.paperTex = new THREE.CanvasTexture(this.paperDraw.canvas);
    this.paperTex.colorSpace = THREE.SRGBColorSpace;
    this.paperTex.anisotropy = 8;

    const g = new THREE.Group();
    const sheetMat = new THREE.MeshStandardMaterial({
      map: this.paperTex,
      roughness: 0.92,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 2.05), sheetMat);
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.y = 0.022;
    sheet.receiveShadow = true;
    g.add(sheet);

    const under = new THREE.Mesh(
      new THREE.BoxGeometry(2.12, 0.016, 2.12),
      this._mat(0xe8dcc8, { roughness: 0.95 })
    );
    under.position.y = 0.006;
    under.receiveShadow = true;
    g.add(under);

    this.scene.add(g);
    this.watch("paper", g, {
      kind: "paper",
      channels: ["position", "rotation", "scale", "visible"],
      hint: "整张纸。画面在贴图上，移动的是纸这个组。",
    });
    this.paperMesh = sheet;
    return g;
  }


  _buildNeuronsFallback() {
    const count = 1400;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sides = new Float32Array(count);
    const base = new Float32Array(count);
    const roles = new Float32Array(count); // 0=KC, 1=DNpL, 2=DNpR, 3=DAN
    for (let i = 0; i < count; i++) {
      base[i] = Math.random();
      let role = 0;
      let side = 0;
      if (i < 70) {
        role = 1;
        side = -1; // DNp20 L
      } else if (i < 140) {
        role = 2;
        side = 1; // DNp20 R
      } else if (i < 200) {
        role = 3;
        side = Math.random() < 0.5 ? -1 : 1; // DAN
      } else {
        role = 0;
        side = Math.random() < 0.5 ? -1 : 1; // KC cloud
      }
      roles[i] = role;
      sides[i] = side;
      const a = Math.random() * Math.PI * 2;
      if (role === 0) {
        const r = 0.12 + Math.random() * 0.38;
        positions[i * 3] = side * (0.14 + Math.random() * 0.28) + Math.cos(a) * r * 0.42;
        positions[i * 3 + 1] = 0.32 + Math.random() * 0.42;
        positions[i * 3 + 2] = -0.04 + Math.sin(a) * r * 0.42;
        colors.set([0.2, 0.75, 0.55], i * 3);
      } else if (role === 1 || role === 2) {
        positions[i * 3] = side * (0.34 + Math.random() * 0.1);
        positions[i * 3 + 1] = 0.22 + Math.random() * 0.18;
        positions[i * 3 + 2] = 0.16 + Math.random() * 0.12;
        colors.set(role === 1 ? [0.25, 1.0, 0.75] : [1.0, 0.55, 0.2], i * 3);
      } else {
        positions[i * 3] = (Math.random() - 0.5) * 0.32;
        positions[i * 3 + 1] = 0.52 + Math.random() * 0.16;
        positions[i * 3 + 2] = -0.12 + Math.random() * 0.14;
        colors.set([0.9, 0.65, 1.0], i * 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.038,
        vertexColors: true,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      })
    );
    const group = new THREE.Group();
    group.scale.setScalar(1.55);
    group.add(points);

    // lobe shells — bright enough to read as L/R brain
    const shellL = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 20, 14),
      this._mat(0x3f9f82, { transparent: true, opacity: 0.22, roughness: 0.15, emissive: 0x1a5a45, emissiveIntensity: 0.55 })
    );
    shellL.position.set(-0.22, 0.42, 0.02);
    shellL.scale.set(1.15, 0.9, 1.05);
    const shellR = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 20, 14),
      this._mat(0xd17a45, { transparent: true, opacity: 0.22, roughness: 0.15, emissive: 0x6a3010, emissiveIntensity: 0.55 })
    );
    shellR.position.set(0.22, 0.42, 0.02);
    shellR.scale.set(1.15, 0.9, 1.05);
    group.add(shellL, shellR);

    // DNp20 motor readout markers (big glowing orbs)
    const orbGeo = new THREE.SphereGeometry(0.055, 12, 10);
    const orbL = new THREE.Mesh(
      orbGeo,
      this._mat(0x3f9f82, { emissive: 0x3f9f82, emissiveIntensity: 1.2, transparent: true, opacity: 0.95 })
    );
    orbL.position.set(-0.38, 0.3, 0.22);
    const orbR = new THREE.Mesh(
      orbGeo,
      this._mat(0xd17a45, { emissive: 0xd17a45, emissiveIntensity: 1.2, transparent: true, opacity: 0.95 })
    );
    orbR.position.set(0.38, 0.3, 0.22);
    group.add(orbL, orbR);

    // sparse axon-like links for motion cues
    const linkPos = new Float32Array(180);
    for (let i = 0; i < 30; i++) {
      const sx = (Math.random() - 0.5) * 0.35;
      const sy = 0.35 + Math.random() * 0.25;
      const sz = (Math.random() - 0.5) * 0.25;
      const ex = (sx < 0 ? -1 : 1) * (0.32 + Math.random() * 0.08);
      const ey = 0.25 + Math.random() * 0.12;
      const ez = 0.18 + Math.random() * 0.06;
      const o = i * 6;
      linkPos[o] = sx; linkPos[o + 1] = sy; linkPos[o + 2] = sz;
      linkPos[o + 3] = ex; linkPos[o + 4] = ey; linkPos[o + 5] = ez;
    }
    const linkGeo = new THREE.BufferGeometry();
    linkGeo.setAttribute("position", new THREE.BufferAttribute(linkPos, 3));
    const links = new THREE.LineSegments(
      linkGeo,
      new THREE.LineBasicMaterial({
        color: 0x9fd6c4,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    group.add(links);

    return { group, points, colors, sides, base, roles, geo, shellL, shellR, orbL, orbR, links };
  }

  setViewPreset(name) {
    const c = this.controls;
    const brain = this.neurons?.group?.position || new THREE.Vector3(0, 0.45, 0);
    this.brainFocus = name === "brain";
    if (name === "top") {
      this.camera.position.set(0.01, 3.6, 0.01);
      c.target.set(0, 0.02, 0);
    } else if (name === "side") {
      this.camera.position.set(3.4, 1.2, 0.2);
      c.target.set(0, 0.2, 0);
    } else if (name === "brain") {
      // gallery-style close-up on real MaleCNS soma cloud
      this.camera.position.set(brain.x + 1.35, brain.y + 0.85, brain.z + 1.55);
      c.target.set(brain.x, brain.y + 0.35, brain.z);
      this.followFly = true;
      this.controls.minDistance = 0.35;
      this.controls.maxDistance = 12;
      if (this.stage.simCan("fog", "density")) this.scene.fog.density = 0.018;
      this.renderer.toneMappingExposure = 1.25;
    } else if (name === "desk") {
      this.camera.position.set(1.8, 1.35, 2.4);
      c.target.set(0, 0.15, 0);
      if (this.stage.simCan("fog", "density")) this.scene.fog.density = 0.045;
      this.renderer.toneMappingExposure = 1.05;
      this.controls.minDistance = 0.55;
      this.controls.maxDistance = 9;
    } else {
      this.camera.position.set(2.4, 2.1, 3.2);
      c.target.set(0, 0.35, 0);
    }
    c.update();
  }

  setNeural(neural) {
    this.neural = neural || null;
  }

  setControl(ctrl) {
    this.stage.writeSim("fly.control", {
      throttle: ctrl.throttle,
      steering: ctrl.steering,
      pen_down: ctrl.pen_down,
      pressure: ctrl.pressure,
    });
    if (ctrl.actionLabel) this.ctrl.actionLabel = ctrl.actionLabel;
  }

  resetPaper(strokes) {
    this.paperDraw.clear();
    this.paperDraw.drawPhotoUnderlay();
    this.paperDraw.drawGhost(strokes);
    this.paperTex.needsUpdate = true;
    this._inkLen = 0;
  }

  syncEnv(envState) {
    const { pose, ink, strokes } = envState;
    if (this.stage.simCan("fly", "position")) {
      this.fly.root.position.x = pose.x;
      this.fly.root.position.z = -pose.y;
      const press = pose.pressure ?? (pose.penDown ? 0.55 : 0);
      this.fly.root.position.y = 0.11 - press * 0.006;
    }
    if (this.stage.simCan("fly", "rotation")) {
      this.fly.root.rotation.y = pose.heading - Math.PI / 2;
    }
    const press = pose.pressure ?? (pose.penDown ? 0.55 : 0);

    const tipDown = pose.penDown ? 0.7 : 0.5;
    this.fly.pencil.position.set(0.015, -0.02 - press * 0.01, 0.16);
    this.fly.pencil.rotation.set(tipDown, 0.06, -1.2 - press * 0.06);
    if (this.fly.pen?.material) {
      this.fly.pen.material.emissiveIntensity = pose.penDown ? 0.4 : 0;
    }
    this.fly.gripPencil?.(press);

    if (ink && ink.length > this._inkLen) {
      for (let i = this._inkLen; i < ink.length; i++) {
        const pt = ink[i];
        const pr = pt.pressure ?? press ?? 0.5;
        this.paperDraw.stampInk(pt, pr, i > this._inkLen || this._inkLen > 0);
      }
      this._inkLen = ink.length;
      this.paperTex.needsUpdate = true;
    } else if (ink && ink.length === 0 && this._inkLen > 0) {
      this.resetPaper(strokes);
    } else if (!pose.penDown) {
      this.paperDraw.liftPen();
    }

    if (this.stage.simCan("brain", "position")) {
      this.neurons.group.position.copy(this.fly.root.position);
      if (this.neurons.real) {
        this.neurons.group.position.y += 0.95;
        this.neurons.group.position.x += 0.15;
      } else {
        this.neurons.group.position.y += 0.38;
      }
    }
    if (this.neurons.real && this.stage.simCan("brain", "scale")) {
      this.neurons.group.scale.setScalar(this.brainFocus ? 1.35 : 0.85);
    }
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = Math.max(parent?.clientWidth || this.canvas.clientWidth || 800, 320);
    const h = Math.max(parent?.clientHeight || 480, 320);
    this.canvas.width = w * Math.min(devicePixelRatio || 1, 2);
    this.canvas.height = h * Math.min(devicePixelRatio || 1, 2);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.stage.flush();
    const t = this.clock.elapsedTime;
    const thr = this.ctrl.throttle || 0;
    const steer = this.ctrl.steering || 0;
    const energy = 0.15 + thr * 0.7 + Math.abs(steer) * 0.25;
    const press = this.ctrl.pressure || (this.ctrl.pen_down ? 0.5 : 0);

    const flap = Math.sin(t * (18 + energy * 28)) * (0.12 + energy * 0.22);
    const bL = this.fly.wingL.userData.baseRot || { x: 0, y: 0, z: 0 };
    const bR = this.fly.wingR.userData.baseRot || { x: 0, y: 0, z: 0 };
    this.fly.wingL.rotation.x = bL.x + flap;
    this.fly.wingR.rotation.x = bR.x - flap;
    this.fly.setLocomotion?.(t, thr);

    const n = this.neural || {};
    const leftHz = Number(n.left_hz || 0);
    const rightHz = Number(n.right_hz || 0);
    const kc = Number(n.KC_spikes || 0);
    const total = Number(n.total_spikes || 1);
    const leftAct = 0.15 + Math.min(1, leftHz / 30) * 0.85;
    const rightAct = 0.15 + Math.min(1, rightHz / 30) * 0.85;
    const kcAct = 0.12 + Math.min(1, kc / Math.max(total * 0.05, 1)) * 0.9;
    const danAct =
      0.1 +
      Math.min(1, ((n.reward_spikes || 0) + (n.aversive_spikes || 0)) / 80) * 0.9;

    const cols = this.neurons.colors;
      const pulse = 0.55 + 0.45 * Math.sin(t * 14);
      for (let i = 0; i < this.neurons.sides.length; i++) {
        const role = this.neurons.roles?.[i] ?? 0;
        const f = 0.35 + 0.65 * Math.sin(t * 14 + this.neurons.base[i] * 18);
        let g = 0.25;
        if (role === 1) g = leftAct * f;
        else if (role === 2) g = rightAct * f;
        else if (role === 3) g = danAct * f;
        else g = kcAct * f * (0.45 + 0.55 * this.neurons.base[i]);
        if (role === 1) cols.set([0.1 + g * 0.35, 0.55 + g * 0.45, 0.45 + g * 0.45], i * 3);
        else if (role === 2) cols.set([0.65 + g * 0.35, 0.3 + g * 0.35, 0.08 + g * 0.15], i * 3);
        else if (role === 3) cols.set([0.7 + g * 0.3, 0.4 + g * 0.35, 0.9 + g * 0.1], i * 3);
        else cols.set([0.15 + g * 0.35, 0.55 + g * 0.45, 0.4 + g * 0.4], i * 3);
      }
      this.neurons.geo.attributes.color.needsUpdate = true;
      this.neurons.points.material.size = 0.028 + energy * 0.02 + kcAct * 0.022 + pulse * 0.008;
      this.neurons.group.visible = true;
      if (this.neurons.shellL) {
        this.neurons.shellL.material.opacity = 0.14 + leftAct * 0.28;
        this.neurons.shellR.material.opacity = 0.14 + rightAct * 0.28;
        this.neurons.shellL.material.emissiveIntensity = 0.35 + leftAct * 1.1;
        this.neurons.shellR.material.emissiveIntensity = 0.35 + rightAct * 1.1;
      }
      if (this.neurons.orbL) {
        const sL = 0.7 + leftAct * 1.6;
        const sR = 0.7 + rightAct * 1.6;
        this.neurons.orbL.scale.setScalar(sL);
        this.neurons.orbR.scale.setScalar(sR);
        this.neurons.orbL.material.emissiveIntensity = 0.6 + leftAct * 2.2;
        this.neurons.orbR.material.emissiveIntensity = 0.6 + rightAct * 2.2;
      }
    if (this.neurons.links) {
      this.neurons.links.material.opacity = 0.18 + kcAct * 0.45 + energy * 0.2;
    }

    if (this.stage.simCan("rim", "intensity")) {
      this.rim.intensity = 0.4 + energy * 0.5 + press * 0.3;
    }
    if (this.stage.simCan("lamp", "intensity")) {
      this.lampLight.intensity = 2.0 + Math.sin(t * 1.7) * 0.08;
    }

    if (this.followFly && this.stage.simCan("camera", "target")) {
      const look = this.neurons.group.position.clone();
      look.y += this.brainFocus ? 0.35 : 0.22;
      this.controls.target.lerp(look, 0.1);
    }

    if (this.autoOrbit && !this.followFly && this.stage.simCan("camera", "position")) {
      const look = this.controls.target.clone();
      const ang = t * 0.12;
      this.camera.position.x = look.x + Math.sin(ang) * 3.0;
      this.camera.position.z = look.z + Math.cos(ang) * 3.0;
      this.camera.position.y = 1.8 + Math.sin(t * 0.25) * 0.12;
    }

    this.controls.update();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
