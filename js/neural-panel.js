/** Satoru-style neural telemetry panel: retina + DNp20 gauges + KC bars. */

export class NeuralPanel {
  constructor({ retina, gauges, kc, meta }) {
    this.retina = retina; // <img> or <canvas>
    this.gauges = gauges; // canvas
    this.kc = kc; // canvas
    this.meta = meta; // pre/div
    this.last = null;
    this.historyL = [];
    this.historyR = [];
    this.historyKc = [];
  }

  update(neural, retinaB64) {
    if (!neural) return;
    this.last = neural;
    if (retinaB64 && this.retina) {
      this.retina.src = `data:image/png;base64,${retinaB64}`;
    }
    this.historyL.push(neural.left_hz || 0);
    this.historyR.push(neural.right_hz || 0);
    this.historyKc.push(neural.KC_spikes || 0);
    if (this.historyL.length > 48) {
      this.historyL.shift();
      this.historyR.shift();
      this.historyKc.shift();
    }
    this._drawGauges(neural);
    this._drawKc(neural);
    if (this.meta) {
      const m = neural.memory || {};
      this.meta.textContent = [
        `DNp20 ${neural.side || "?"}  L ${Number(neural.left_hz || 0).toFixed(1)}Hz  R ${Number(neural.right_hz || 0).toFixed(1)}Hz`,
        `KC ${neural.KC_spikes || 0}  total ${neural.total_spikes || 0}  gate ${neural.gate_spikes || 0}`,
        `DAN+ ${neural.reward_spikes || 0}  DAN− ${neural.aversive_spikes || 0}  stim ${neural.stimulus || "none"}`,
        `Δw mean ${m.mean_efficacy ?? "—"}  changed ${m.changed_edges ?? "—"} / ${m.plastic_edges ?? "—"}`,
      ].join("\n");
    }
  }

  _drawGauges(n) {
    const c = this.gauges;
    if (!c) return;
    const ctx = c.getContext("2d");
    const w = c.width;
    const h = c.height;
    ctx.fillStyle = "#14110e";
    ctx.fillRect(0, 0, w, h);

    const maxHz = 40;
    const drawBar = (x, val, color, label) => {
      const bw = 36;
      const bh = Math.min(h - 34, (val / maxHz) * (h - 34));
      ctx.fillStyle = "#2a241c";
      ctx.fillRect(x, 18, bw, h - 34);
      ctx.fillStyle = color;
      ctx.fillRect(x, h - 16 - bh, bw, bh);
      ctx.fillStyle = "#9a8f80";
      ctx.font = "11px IBM Plex Mono, monospace";
      ctx.fillText(label, x + 8, h - 3);
      ctx.fillStyle = "#f2ebe1";
      ctx.font = "bold 12px IBM Plex Mono, monospace";
      ctx.fillText(`${val.toFixed(0)}`, x + 4, 14);
    };
    drawBar(16, n.left_hz || 0, "#3f9f82", "L");
    drawBar(62, n.right_hz || 0, "#d17a45", "R");

    // sparkline
    const plot = (arr, color, y0, amp = 28) => {
      if (arr.length < 2) return;
      const max = Math.max(...arr, 1);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      arr.forEach((v, i) => {
        const x = 118 + (i / (arr.length - 1)) * (w - 130);
        const y = y0 - (v / max) * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    plot(this.historyL, "#3f9f82", 42, 26);
    plot(this.historyR, "#d17a45", 78, 26);
    plot(this.historyKc, "#9fd6c4", 118, 22);

    ctx.fillStyle = "#9a8f80";
    ctx.font = "10px IBM Plex Mono, monospace";
    ctx.fillText("DNp20 L/R Hz · KC spikes", 118, 14);
    const side = n.side || "?";
    ctx.fillStyle = side === "L" ? "#3f9f82" : side === "R" ? "#d17a45" : "#f2ebe1";
    ctx.font = "bold 14px IBM Plex Mono, monospace";
    ctx.fillText(String(side), w - 40, 18);
  }

  _drawKc(n) {
    const c = this.kc;
    if (!c) return;
    const ctx = c.getContext("2d");
    const w = c.width;
    const h = c.height;
    ctx.fillStyle = "#14110e";
    ctx.fillRect(0, 0, w, h);
    const bins = n.kc_bins || [];
    if (!bins.length) {
      ctx.fillStyle = "#9a8f80";
      ctx.font = "11px IBM Plex Mono, monospace";
      ctx.fillText("KC bins — waiting for MaleCNS", 8, 22);
      return;
    }
    const max = Math.max(...bins, 1);
    const bw = w / bins.length;
    bins.forEach((v, i) => {
      const t = v / max;
      const bh = t * (h - 14);
      ctx.fillStyle = `rgb(${40 + t * 50}, ${100 + t * 140}, ${110 + t * 90})`;
      ctx.fillRect(i * bw, h - bh - 4, Math.max(1.5, bw - 0.4), bh);
    });
    ctx.fillStyle = "#9a8f80";
    ctx.font = "10px IBM Plex Mono, monospace";
    ctx.fillText(`Kenyon cells ×${bins.length} (sampled)`, 6, 12);
  }
}
