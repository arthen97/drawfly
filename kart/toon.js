import * as THREE from "three";

/**
 * "3D rendered as 2D": light is snapped to a few flat bands (gradient map), every surface
 * gets a crisp anime rim light, and outlines come from the post pass (post.js).
 */

let gradient = null;
export function toonGradient() {
  if (gradient) return gradient;
  const bands = [0.42, 0.68, 1.0, 1.0];
  const data = new Uint8Array(bands.length * 4);
  bands.forEach((b, k) => data.set([b * 255, b * 255, b * 255, 255], k * 4));
  gradient = new THREE.DataTexture(data, bands.length, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

/** GLSL injected right before outgoingLight is summed; `extra` may add more emissive terms. */
export const RIM_GLSL = `
vec3 toonView = normalize(vViewPosition);
float toonRim = 1.0 - max(dot(normal, toonView), 0.0);
totalEmissiveRadiance += diffuseColor.rgb * smoothstep(0.62, 0.68, toonRim) * toonRimStrength;
`;

export function withRim(material, strength = 0.55, extra = "") {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.toonRimStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float toonRimStrength;")
      .replace("#include <aomap_fragment>", `#include <aomap_fragment>\n${RIM_GLSL}\n${extra}`);
  };
  return material;
}

const COPY = [
  "map", "normalMap", "normalScale", "color", "emissive", "emissiveMap", "emissiveIntensity", "alphaTest",
  "transparent", "opacity", "side", "vertexColors", "polygonOffset", "polygonOffsetFactor", "polygonOffsetUnits",
  "depthWrite", "alphaMap",
];

/** A MeshToonMaterial that looks like the given standard/physical material, minus reflections. */
export function toToon(source, rim = 0.45) {
  const params = { gradientMap: toonGradient() };
  for (const key of COPY) if (source[key] !== undefined && source[key] !== null) params[key] = source[key];
  const toon = withRim(new THREE.MeshToonMaterial(params), rim);
  toon.name = source.name;
  return toon;
}

/** Swaps every standard material under `root` for its toon twin (shared materials stay shared). */
export function toonify(root) {
  const done = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.material || o.userData.keepMaterial) return;
    const swap = (m) => {
      if (!m.isMeshStandardMaterial) return m;
      if (!done.has(m)) done.set(m, toToon(m));
      return done.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}
