import * as THREE from "three";
import { DecalGeometry } from "../js/vendor/jsm/geometries/DecalGeometry.js";

/** Kenney karts are ~1.4 m long; the physics kart is ~2.6 m. */
export const KART_SCALE = 1.8;

/**
 * The Kenney karts colour everything through one 512² palette texture, so their UVs
 * cannot carry real detail. Instead the shader reads the palette colour per pixel and
 * decides what the surface is made of: near-black grey is tyre rubber (tread texture),
 * low-saturation grey is metal (Poly Haven metal plate), anything colourful is lacquered
 * paint under a clearcoat. Detail is projected in object space (triplanar), so it sticks
 * to the part and turns with spinning wheels.
 */
function surfaceMaterial(assets, { clearcoat }) {
  const tread = assets.generated["tire-tread"];
  const plate = assets.metal.map;
  const plateRough = assets.metal.roughnessMap;
  const mat = new THREE.MeshPhysicalMaterial({
    map: assets.karts.oobi.getObjectByProperty("isMesh", true).material.map,
    roughness: 0.32,
    metalness: 0,
    clearcoat,
    clearcoatRoughness: 0.06,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tTread: { value: tread },
      tPlate: { value: plate },
      tPlateRough: { value: plateRough },
    });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNrm;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjPos = position;\nvObjNrm = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vObjPos;
varying vec3 vObjNrm;
uniform sampler2D tTread;
uniform sampler2D tPlate;
uniform sampler2D tPlateRough;
vec4 triplanar(sampler2D t, vec3 p, vec3 w) {
  return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
}`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
vec3 paletteRGB = diffuseColor.rgb;
float hi = max(paletteRGB.r, max(paletteRGB.g, paletteRGB.b));
float lo = min(paletteRGB.r, min(paletteRGB.g, paletteRGB.b));
float sat = hi > 0.0 ? (hi - lo) / hi : 0.0;
float lum = dot(paletteRGB, vec3(0.2126, 0.7152, 0.0722));
float grey = 1.0 - smoothstep(0.24, 0.34, sat);
float rubberK = grey * (1.0 - smoothstep(0.05, 0.09, lum));
float metalK = grey * (1.0 - rubberK) * (1.0 - smoothstep(0.5, 0.7, lum));
float paintK = 1.0 - rubberK - metalK;
vec3 tw = pow(abs(normalize(vObjNrm)), vec3(4.0));
tw /= dot(tw, vec3(1.0));
vec3 treadRGB = triplanar(tTread, vObjPos * 3.5, tw).rgb;
vec3 plateRGB = triplanar(tPlate, vObjPos * 2.5, tw).rgb;
float plateR = triplanar(tPlateRough, vObjPos * 2.5, tw).r;
diffuseColor.rgb = mix(diffuseColor.rgb, treadRGB * 1.4, rubberK);
diffuseColor.rgb *= mix(vec3(1.0), 0.45 + plateRGB * 1.6, metalK);`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor = roughnessFactor * paintK + 0.88 * rubberK + (0.22 + 0.5 * plateR) * metalK;`
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.9, metalK);`
      )
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
material.clearcoat *= paintK;
#endif`
      );
  };
  mat.customProgramCacheKey = () => `kart-surface-${clearcoat > 0}`;
  return mat;
}

function decalMaterial(map, flip = false) {
  let tex = map;
  if (flip) {
    tex = map.clone();
    tex.repeat.x = -1;
    tex.offset.x = 1;
    tex.needsUpdate = true;
  }
  return new THREE.MeshPhysicalMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.04,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
}

function numberTexture(number, color) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  g.beginPath();
  g.arc(128, 128, 124, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(128, 128, 100, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#111111";
  g.font = "italic 900 150px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(number), 128, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.aspect = 1;
  return t;
}

const DIRS = {
  left: { from: new THREE.Vector3(1, 0, 0), euler: new THREE.Euler(0, Math.PI / 2, 0) },
  right: { from: new THREE.Vector3(-1, 0, 0), euler: new THREE.Euler(0, -Math.PI / 2, 0) },
  top: { from: new THREE.Vector3(0, 1, 0), euler: new THREE.Euler(-Math.PI / 2, Math.PI, 0, "YXZ") },
  back: { from: new THREE.Vector3(0, 0, -1), euler: new THREE.Euler(0, Math.PI, 0) },
  front: { from: new THREE.Vector3(0, 0, 1), euler: new THREE.Euler(0, 0, 0) },
};

/**
 * Sticks one decal onto the body: a ray from outside finds the surface, DecalGeometry
 * clips the body triangles inside a box there, and faces turned away from the sticker
 * are dropped so it never shows through on the inside.
 */
function stick(target, { dir, at, width, map, flip }) {
  const d = DIRS[dir];
  const origin = new THREE.Vector3(...at).addScaledVector(d.from, 3);
  const hit = new THREE.Raycaster(origin, d.from.clone().negate(), 0, 6).intersectObject(target, false)[0];
  if (!hit) return null;
  const size = new THREE.Vector3(width, width / (map.userData.aspect || 1), 0.3);
  const geo = new DecalGeometry(target, hit.point, d.euler, size);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const keep = { position: [], normal: [], uv: [] };
  for (let t = 0; t < pos.count; t += 3) {
    let facing = 0;
    for (let k = t; k < t + 3; k++) facing += nrm.getX(k) * d.from.x + nrm.getY(k) * d.from.y + nrm.getZ(k) * d.from.z;
    if (facing / 3 < 0.25) continue;
    for (let k = t; k < t + 3; k++) {
      keep.position.push(pos.getX(k), pos.getY(k), pos.getZ(k));
      keep.normal.push(nrm.getX(k), nrm.getY(k), nrm.getZ(k));
      keep.uv.push(uv.getX(k), uv.getY(k));
    }
  }
  const clean = new THREE.BufferGeometry();
  clean.setAttribute("position", new THREE.Float32BufferAttribute(keep.position, 3));
  clean.setAttribute("normal", new THREE.Float32BufferAttribute(keep.normal, 3));
  clean.setAttribute("uv", new THREE.Float32BufferAttribute(keep.uv, 2));
  clean.applyMatrix4(target.matrixWorld.clone().invert());
  const mesh = new THREE.Mesh(clean, decalMaterial(map, flip));
  mesh.renderOrder = 2;
  target.add(mesh);
  return mesh;
}

const shared = new WeakMap();
function materialsFor(assets) {
  if (!shared.has(assets)) {
    shared.set(assets, {
      body: surfaceMaterial(assets, { clearcoat: 1 }),
      driver: surfaceMaterial(assets, { clearcoat: 0 }),
    });
  }
  return shared.get(assets);
}

/**
 * One racer's kart: Kenney model + real-texture shader + decals + spark/flame effects.
 * spec = { body: "oobi", color, number, sponsor: "decal-dao-motors" }
 */
export function buildKartModel(assets, spec) {
  const mats = materialsFor(assets);
  const kenney = assets.karts[spec.body].clone(true);
  kenney.updateMatrixWorld(true);
  let body = null;
  const wheels = [];
  kenney.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (o.name.startsWith("kart-")) body = o;
    o.material = o.name === "character" ? mats.driver : mats.body;
  });
  for (const name of ["wheel-front-left", "wheel-front-right", "wheel-back-left", "wheel-back-right"]) {
    const w = kenney.getObjectByName(name);
    w.rotation.order = "YXZ";
    wheels.push({ node: w, front: name.includes("front") });
  }

  const driver = kenney.getObjectByName("character");
  const gen = assets.generated;
  const number = numberTexture(spec.number, spec.color);
  const decals = [
    { on: body, dir: "left", at: [0, 0.32, 0.42], width: 0.5, map: gen["decal-flames"] },
    { on: body, dir: "right", at: [0, 0.32, 0.42], width: 0.5, map: gen["decal-flames"], flip: true },
    { on: body, dir: "left", at: [0, 0.22, 0.02], width: 0.3, map: gen[spec.sponsor] },
    { on: body, dir: "right", at: [0, 0.22, 0.02], width: 0.3, map: gen[spec.sponsor] },
    { on: body, dir: "top", at: [0, 0, 0.6], width: 0.3, map: number },
    { on: body, dir: "back", at: [0, 0.4, 0], width: 0.62, map: gen["decal-checker"] },
    { on: body, dir: "front", at: [0, 0.3, 0], width: 0.42, map: gen["decal-nitro-fizz"] },
    { on: driver, dir: "back", at: [0, 0.95, 0], width: 0.5, map: gen[spec.sponsor] },
    { on: driver, dir: "left", at: [0, 0.95, 0.02], width: 0.32, map: number },
    { on: driver, dir: "right", at: [0, 0.95, 0.02], width: 0.32, map: number },
  ];
  kenney.updateMatrixWorld(true);
  const placed = decals.map(({ on, ...d }) => stick(on, d)).filter(Boolean).length;

  kenney.scale.setScalar(KART_SCALE);
  const chassis = new THREE.Group();
  chassis.add(kenney);
  const root = new THREE.Group();
  root.add(chassis);

  const sparkMat = new THREE.MeshBasicMaterial({
    color: 0x4fc3ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sparks = [-0.5, 0.5].map((x) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), sparkMat);
    s.position.set(x, 0.18, -0.95);
    root.add(s);
    return s;
  });
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.24, 1.3, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xff7a18, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0.55, -1.65);
  chassis.add(flame);

  return { root, chassis, wheels, sparks, sparkMat, flame, decals: placed };
}
