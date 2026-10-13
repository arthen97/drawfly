/** Human demonstration capture + nearest-neighbor imitation for drawing controls. */

const STORAGE_KEY = "drawfly_trump_demos_v1";

export class DemoStore {
  constructor() {
    this.demos = [];
    this.recording = false;
    this.current = null;
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.demos = raw ? JSON.parse(raw) : [];
    } catch {
      this.demos = [];
    }
  }

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.demos.slice(-12)));
  }

  clear() {
    this.demos = [];
    localStorage.removeItem(STORAGE_KEY);
  }

  start() {
    this.recording = true;
    this.current = { t0: performance.now(), samples: [] };
  }

  stop() {
    this.recording = false;
    if (this.current?.samples?.length > 8) {
      this.demos.push(this.current);
      this.save();
    }
    this.current = null;
  }

  push(obs, action) {
    if (!this.recording || !this.current) return;
    this.current.samples.push({
      x: obs.pose?.x ?? 0,
      y: obs.pose?.y ?? 0,
      h: obs.pose?.heading_deg ?? 0,
      d: obs.nearest_target_distance ?? 1,
      e: obs.heading_error_deg ?? 0,
      c: obs.coverage ?? 0,
      throttle: action.throttle,
      steering: action.steering,
      pen_down: !!action.pen_down,
      pressure: action.pressure ?? 0.55,
      finish: !!action.finish,
    });
  }

  get count() {
    return this.demos.reduce((n, d) => n + d.samples.length, 0);
  }

  /** k-NN imitation over recorded pose/error features */
  imitate(obs, k = 8) {
    const pool = [];
    for (const demo of this.demos) {
      for (const s of demo.samples) pool.push(s);
    }
    if (!pool.length) return null;

    const qx = obs.pose?.x ?? 0;
    const qy = obs.pose?.y ?? 0;
    const qh = (obs.pose?.heading_deg ?? 0) / 180;
    const qd = obs.nearest_target_distance ?? 1;
    const qe = (obs.heading_error_deg ?? 0) / 90;

    const scored = pool.map((s) => {
      const dh = ((s.h / 180) - qh);
      const dist =
        (s.x - qx) ** 2 * 4 +
        (s.y - qy) ** 2 * 4 +
        dh ** 2 * 0.6 +
        (s.d - qd) ** 2 * 2 +
        ((s.e / 90) - qe) ** 2 * 0.4;
      return { s, dist };
    });
    scored.sort((a, b) => a.dist - b.dist);
    const top = scored.slice(0, Math.min(k, scored.length));
    const wsum = top.reduce((a, t) => a + 1 / (t.dist + 1e-4), 0);
    let throttle = 0;
    let steering = 0;
    let pressure = 0;
    let pen = 0;
    for (const t of top) {
      const w = 1 / (t.dist + 1e-4) / wsum;
      throttle += t.s.throttle * w;
      steering += t.s.steering * w;
      pressure += (t.s.pressure ?? 0.55) * w;
      pen += t.s.pen_down ? w : 0;
    }
    return {
      throttle: Math.max(0, Math.min(1, throttle)),
      steering: Math.max(-1, Math.min(1, steering)),
      pen_down: pen > 0.45,
      pressure: Math.max(0.05, Math.min(1, pressure)),
      finish: false,
      reason: `imitation k=${top.length} n=${pool.length}`,
      model: "human-demo-knn",
      backend: "imitation",
    };
  }
}

/** Project NDC mouse onto paper plane y=0.02 */
export function pickPaper(camera, canvas, clientX, clientY, THREE) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.02);
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(plane, hit)) return null;
  // world x,z -> paper x,y
  const x = hit.x;
  const y = -hit.z;
  if (Math.abs(x) > 1.05 || Math.abs(y) > 1.05) return null;
  return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
}
