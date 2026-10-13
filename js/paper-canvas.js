/** Paper sheet: Trump photo underlay + highly visible pencil ink. */

export class PaperCanvas {
  constructor(size = 1024) {
    this.size = size;
    this.canvas = document.createElement("canvas");
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext("2d");
    this.lastInk = null;
    this.photo = null;
    this.photoReady = false;
    this._loadPhoto();
    this.clear();
  }

  _loadPhoto() {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      this.photo = img;
      this.photoReady = true;
      // redraw base if empty episode
      if (!this.lastInk && this._strokesCache) {
        this.clear();
        this.drawPhotoUnderlay();
        this.drawGhost(this._strokesCache);
      }
    };
    img.src = "/assets/trump-1024.jpg";
  }

  clear() {
    const { ctx, size } = this;
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, "#f7f1e6");
    g.addColorStop(0.5, "#f0e6d6");
    g.addColorStop(1, "#e9dcc8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    // light tooth
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 16) {
      const n = (Math.random() - 0.5) * 8;
      d[i] = Math.min(255, Math.max(0, d[i] + n));
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n * 0.9));
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n * 0.7));
    }
    ctx.putImageData(img, 0, 0);
    this.lastInk = null;
  }

  /** Draw official portrait faded + pencil target guide. */
  drawPhotoUnderlay() {
    if (!this.photoReady || !this.photo) return;
    const { ctx, size } = this;
    const img = this.photo;
    const pad = size * 0.08;
    const box = size - pad * 2;
    const ir = img.width / img.height;
    let dw = box;
    let dh = box / ir;
    if (dh > box) {
      dh = box;
      dw = box * ir;
    }
    const dx = (size - dw) / 2;
    const dy = (size - dh) / 2 - size * 0.02;
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#f3ebe0";
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    // pencil-style target (from photo decomposition) as faint guide
    if (!this._pencilGuide) {
      this._pencilGuide = new Image();
      this._pencilGuide.src = "/assets/trump-pencil-target.png";
    }
    if (this._pencilGuide.complete && this._pencilGuide.naturalWidth) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.drawImage(this._pencilGuide, 0, 0, size, size);
      ctx.restore();
    }
  }

  xy(p) {
    const s = this.size;
    return {
      x: ((p.x + 1) * 0.5) * (s - 1),
      y: (1 - (p.y + 1) * 0.5) * (s - 1),
    };
  }

  drawGhost(strokes) {
    this._strokesCache = strokes;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = "rgba(40, 30, 22, 0.45)";
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash([4, 5]);
    for (const stroke of strokes || []) {
      if (!stroke?.length) continue;
      ctx.beginPath();
      stroke.forEach((p, i) => {
        const q = this.xy(p);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.stroke();
    }
    ctx.restore();
    ctx.setLineDash([]);
  }

  stampInk(p, pressure = 0.7, continuous = true) {
    const { ctx } = this;
    const q = this.xy(p);
    const pr = Math.max(0.15, Math.min(1, pressure));
    // bold visible graphite
    const width = 2.2 + pr * 7.5;
    const alpha = 0.55 + pr * 0.4;

    ctx.save();
    ctx.strokeStyle = `rgba(18, 14, 10, ${alpha})`;
    ctx.fillStyle = `rgba(18, 14, 10, ${alpha})`;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (continuous && this.lastInk) {
      ctx.beginPath();
      ctx.moveTo(this.lastInk.x, this.lastInk.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      const steps = Math.max(1, Math.floor(Math.hypot(q.x - this.lastInk.x, q.y - this.lastInk.y) / 1.5));
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const x = this.lastInk.x + (q.x - this.lastInk.x) * t + (Math.random() - 0.5) * width * 0.35;
        const y = this.lastInk.y + (q.y - this.lastInk.y) * t + (Math.random() - 0.5) * width * 0.35;
        ctx.globalAlpha = alpha * 0.35;
        ctx.beginPath();
        ctx.arc(x, y, width * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.arc(q.x, q.y, width * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    this.lastInk = q;
  }

  liftPen() {
    this.lastInk = null;
  }
}
