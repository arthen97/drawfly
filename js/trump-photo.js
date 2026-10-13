/** Load photo-derived Trump strokes and build DrawEnv target. */

let cached = null;

export async function loadTrumpPhotoStrokes() {
  if (cached) return cached;
  const res = await fetch("/assets/trump-strokes.json");
  if (!res.ok) throw new Error(`trump-strokes.json HTTP ${res.status}`);
  cached = await res.json();
  return cached;
}

function densify(points, step = 0.028) {
  if (!points?.length) return [];
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  const last = points[points.length - 1];
  out.push({ x: last.x, y: last.y });
  return out;
}

/**
 * Build targetSpec from photo stroke JSON.
 * Drawing order: contours first, then dark hatches, then mid hatches.
 */
export function makeTrumpFromPhoto(data) {
  const strokesRaw = data?.strokes || [];
  const ordered = [
    ...strokesRaw.filter((s) => s.kind === "contour"),
    ...strokesRaw.filter((s) => s.kind === "hatch" && (s.pressure || 0) >= 0.65),
    ...strokesRaw.filter((s) => s.kind === "hatch" && (s.pressure || 0) < 0.65),
  ];

  const strokes = [];
  const points = [];
  const breakAfter = new Set();

  for (const s of ordered) {
    const dense = densify(s.points, s.kind === "hatch" ? 0.035 : 0.026);
    if (dense.length < 2) continue;
    strokes.push(dense);
    const pr = s.pressure ?? (s.kind === "contour" ? 0.75 : 0.5);
    for (const p of dense) {
      points.push({ x: p.x, y: p.y, pressure: pr, kind: s.kind });
    }
    breakAfter.add(points.length - 1);
  }

  return {
    strokes,
    points,
    breakAfter,
    label: "trump",
    photoDriven: true,
  };
}

/** Compare drawing canvas to precomputed pencil target → likeness 0..1 */
export function scoreLikeness(paperCanvasEl, targetImg) {
  if (!paperCanvasEl || !targetImg?.complete || !targetImg.naturalWidth) return null;
  const size = 128;
  const a = document.createElement("canvas");
  a.width = size;
  a.height = size;
  const ctx = a.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#f3ebe0";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(paperCanvasEl, 0, 0, size, size);
  const draw = ctx.getImageData(0, 0, size, size).data;

  ctx.fillStyle = "#f5f5f5";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(targetImg, 0, 0, size, size);
  const tgt = ctx.getImageData(0, 0, size, size).data;

  let err = 0;
  let n = 0;
  for (let i = 0; i < draw.length; i += 16) {
    // luminance
    const d = (draw[i] + draw[i + 1] + draw[i + 2]) / 3;
    const t = (tgt[i] + tgt[i + 1] + tgt[i + 2]) / 3;
    // focus on darker target pixels (structure)
    const w = t < 200 ? 1.5 : 0.4;
    err += w * Math.abs(d - t);
    n += w;
  }
  const mae = err / Math.max(n, 1) / 255;
  return Math.max(0, Math.min(1, 1 - mae * 1.35));
}
