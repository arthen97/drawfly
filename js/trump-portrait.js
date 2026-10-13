/** Stylized Trump pencil-portrait guide (line art in paper coords [-1,1]). */

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function densify(stroke, step = 0.035) {
  if (stroke.length < 2) return stroke.map(([x, y]) => ({ x, y }));
  const out = [];
  for (let i = 0; i < stroke.length - 1; i++) {
    const [x0, y0] = stroke[i];
    const [x1, y1] = stroke[i + 1];
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: lerp(x0, x1, t), y: lerp(y0, y1, t) });
    }
  }
  const [lx, ly] = stroke[stroke.length - 1];
  out.push({ x: lx, y: ly });
  return out;
}

/**
 * Drawing-order strokes for a recognizable caricature silhouette.
 * mode: "face" | "hair" | "trump"
 */
export function makeTrumpPortrait(mode = "trump") {
  const hair = [
    [
      [-0.42, 0.18], [-0.55, 0.35], [-0.58, 0.52], [-0.48, 0.68], [-0.28, 0.78],
      [-0.05, 0.82], [0.18, 0.78], [0.38, 0.68], [0.52, 0.52], [0.55, 0.35],
      [0.48, 0.18], [0.42, 0.05],
    ],
    [
      [-0.38, 0.22], [-0.42, 0.4], [-0.3, 0.58], [-0.08, 0.66], [0.12, 0.64],
      [0.3, 0.54], [0.4, 0.38], [0.38, 0.2],
    ],
    [[-0.2, 0.55], [-0.05, 0.48]],
    [[0.0, 0.58], [0.15, 0.5]],
    [[0.18, 0.52], [0.32, 0.42]],
  ];
  const face = [
    [
      [-0.4, 0.12], [-0.48, -0.05], [-0.5, -0.28], [-0.42, -0.48], [-0.28, -0.6],
      [-0.1, -0.66], [0.08, -0.66], [0.26, -0.6], [0.4, -0.48], [0.48, -0.28],
      [0.46, -0.05], [0.38, 0.12],
    ],
    [[-0.32, 0.12], [-0.22, 0.16], [-0.1, 0.14]],
    [[0.08, 0.14], [0.2, 0.16], [0.32, 0.12]],
    [[-0.3, 0.02], [-0.22, 0.05], [-0.12, 0.02], [-0.22, -0.01], [-0.3, 0.02]],
    [[0.1, 0.02], [0.2, 0.05], [0.3, 0.02], [0.2, -0.01], [0.1, 0.02]],
    [[-0.02, 0.08], [-0.06, -0.08], [0.0, -0.16], [0.08, -0.08], [0.04, 0.06]],
    [[-0.22, -0.28], [-0.1, -0.32], [0.02, -0.3], [0.14, -0.32], [0.24, -0.28]],
    [[-0.14, -0.36], [0.0, -0.4], [0.14, -0.36]],
  ];
  const rest = [
    [[-0.48, 0.0], [-0.56, -0.08], [-0.54, -0.22], [-0.46, -0.28]],
    [[0.46, 0.0], [0.54, -0.08], [0.52, -0.22], [0.44, -0.28]],
    [[-0.28, -0.62], [-0.38, -0.78], [-0.22, -0.82], [-0.08, -0.7]],
    [[0.26, -0.62], [0.36, -0.78], [0.2, -0.82], [0.06, -0.7]],
    [[-0.04, -0.7], [0.0, -0.78], [0.04, -0.7], [0.0, -0.92], [-0.04, -0.7]],
    [[-0.38, -0.12], [-0.28, -0.2]],
    [[-0.4, -0.18], [-0.3, -0.26]],
    [[-0.4, -0.24], [-0.3, -0.32]],
    [[0.28, -0.12], [0.38, -0.2]],
    [[0.3, -0.18], [0.4, -0.26]],
    [[0.3, -0.24], [0.4, -0.32]],
  ];

  let raw;
  if (mode === "hair") raw = hair;
  else if (mode === "face") raw = face;
  else raw = [...hair, ...face, ...rest];

  const strokes = raw.map((s) => densify(s, 0.032));
  const points = [];
  const breakAfter = new Set();
  for (const stroke of strokes) {
    for (const p of stroke) points.push(p);
    if (points.length) breakAfter.add(points.length - 1);
  }
  return { strokes, points, breakAfter, label: mode };
}
