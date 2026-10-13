import * as THREE from "three";
import { GLTFLoader } from "../js/vendor/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "../js/vendor/jsm/loaders/RGBELoader.js";

const BASE = new URL("./assets/", import.meta.url);
const at = (path) => new URL(path, BASE).href;

export const KART_BODIES = ["oobi", "oodi", "ooli", "oopi", "oozi"];

/** Every texture, model and the HDRI, loaded once before the race is built. */
export async function loadAssets(renderer, onProgress = () => {}) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, done, total) => onProgress(done / total);
  const texLoader = new THREE.TextureLoader(manager);
  const gltfLoader = new GLTFLoader(manager);
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const tex = (path, { srgb = false, repeat = true } = {}) =>
    texLoader.loadAsync(at(path)).then((t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      return t;
    });
  const pbr = (dir, name, extra = []) =>
    Promise.all([
      tex(`textures/${dir}/${name}_diff_1k.jpg`, { srgb: true }),
      tex(`textures/${dir}/${name}_nor_gl_1k.jpg`),
      tex(`textures/${dir}/${name}_rough_1k.jpg`),
      ...extra.map((e) => tex(`textures/${dir}/${name}_${e}_1k.jpg`)),
    ]).then(([map, normalMap, roughnessMap, metalnessMap]) =>
      metalnessMap ? { map, normalMap, roughnessMap, metalnessMap } : { map, normalMap, roughnessMap }
    );

  const manifest = await fetch(at("tex/manifest.json")).then((r) => r.json());
  const generated = {};
  const genJobs = Object.entries(manifest).map(async ([name, info]) => {
    const t = await tex(`tex/${info.file}`, { srgb: true, repeat: !info.alpha });
    t.userData.aspect = info.w / info.h;
    generated[name] = t;
  });

  const hdrJob = new RGBELoader(manager)
    .loadAsync(at("hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr"))
    .then((hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      return { background: hdr, environment: env };
    });

  const kartJobs = KART_BODIES.map((id) =>
    gltfLoader.loadAsync(at(`models/kenney/kart-${id}.glb`)).then((g) => [id, g.scene])
  );
  const tyreJob = gltfLoader.loadAsync(at("models/polyhaven/old_tyre/old_tyre_1k.gltf")).then((g) => {
    let mesh = null;
    g.scene.traverse((o) => { if (o.isMesh) mesh = o; });
    return mesh;
  });

  const [sky, asphalt, grass, concrete, metal, karts, tyre] = await Promise.all([
    hdrJob,
    pbr("asphalt_02", "asphalt_02"),
    pbr("aerial_grass_rock", "aerial_grass_rock"),
    pbr("concrete_wall_004", "concrete_wall_004"),
    pbr("metal_plate", "metal_plate", ["metal"]),
    Promise.all(kartJobs).then(Object.fromEntries),
    tyreJob,
    ...genJobs,
  ]);
  return { sky, asphalt, grass, concrete, metal, karts, tyre, generated };
}
