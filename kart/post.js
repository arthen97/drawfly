import * as THREE from "three";

/**
 * One full-screen pass after the scene render:
 *  - ink outlines from depth discontinuities (the "2D" line art),
 *  - radial motion blur toward the vanishing point, stronger with speed and boost,
 *  - anime speed lines / light streaks that flicker in from the screen edges while boosting,
 *  - a little chromatic split and colour grading so the frame reads like cel animation.
 */
const fragmentShader = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float blur;
uniform float lines;
uniform float time;
uniform vec2 center;
uniform float inkWidth;
varying vec2 vUv;

float viewDepth(vec2 uv) {
  return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
}

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }

void main() {
  vec2 toCenter = vUv - center;
  float fromCenter = length(toCenter * vec2(resolution.x / resolution.y, 1.0));

  // Radial blur: centre stays sharp, edges smear along the direction of travel.
  float k = blur * smoothstep(0.12, 0.75, fromCenter);
  vec3 col = vec3(0.0);
  float split = k * 0.006;
  for (int i = 0; i < 12; i++) {
    vec2 uv = vUv - toCenter * (k * 0.075 * float(i) / 11.0);
    col.r += texture2D(tColor, uv + toCenter * split).r;
    col.g += texture2D(tColor, uv).g;
    col.b += texture2D(tColor, uv - toCenter * split).b;
  }
  col /= 12.0;

  // Ink: relative Laplacian of view depth is ~0 on planes and spikes at silhouettes and creases.
  vec2 px = inkWidth / resolution;
  float c = viewDepth(vUv);
  float lap = viewDepth(vUv + vec2(px.x, 0.0)) + viewDepth(vUv - vec2(px.x, 0.0))
            + viewDepth(vUv + vec2(0.0, px.y)) + viewDepth(vUv - vec2(0.0, px.y)) - 4.0 * c;
  float ink = smoothstep(0.02, 0.06, abs(lap) / c) * (1.0 - smoothstep(60.0, 140.0, c));
  ink *= 1.0 - k;
  col = mix(col, vec3(0.06, 0.05, 0.1), ink);

  // Speed lines: thin radial streaks in random angular slots, re-rolled 14 times a second.
  vec2 p = toCenter * vec2(resolution.x / resolution.y, 1.0);
  float slots = 140.0;
  float a = (atan(p.y, p.x) / 6.2831853 + 0.5) * slots;
  float id = floor(a);
  float roll = hash(id + floor(time * 14.0) * 31.7);
  float width = 0.08 + 0.25 * hash(id * 3.1);
  float thin = 1.0 - smoothstep(0.0, width, abs(fract(a) - 0.5));
  float reach = 0.42 + 0.35 * hash(id * 7.7 + floor(time * 14.0));
  float streak = step(0.78, roll) * thin * smoothstep(reach, reach + 0.25, fromCenter);
  col += vec3(0.85, 0.95, 1.0) * streak * lines * 0.85;

  // Grade: a touch more saturation, warm boost vignette.
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, 1.18);
  col += vec3(1.0, 0.45, 0.1) * lines * 0.18 * smoothstep(0.55, 1.1, fromCenter);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createPost(renderer) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const depthTexture = new THREE.DepthTexture(size.x, size.y);
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
    depthTexture,
  });
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: target.texture },
      tDepth: { value: depthTexture },
      resolution: { value: size.clone() },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 900 },
      blur: { value: 0 },
      lines: { value: 0 },
      time: { value: 0 },
      center: { value: new THREE.Vector2(0.5, 0.56) },
      inkWidth: { value: 1 },
    },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const postScene = new THREE.Scene();
  postScene.add(quad);
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const u = material.uniforms;

  return {
    uniforms: u,
    setSize() {
      renderer.getDrawingBufferSize(size);
      target.setSize(size.x, size.y);
      u.resolution.value.copy(size);
      u.inkWidth.value = Math.max(1.5, size.y / 480);
    },
    render(scene, camera, { blur, lines, time }) {
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
      u.blur.value = blur;
      u.lines.value = lines;
      u.time.value = time;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCamera);
    },
  };
}
