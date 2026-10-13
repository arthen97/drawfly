"""Real MaleCNS bridge via stonkfly neural stack.

Maps draw-env paper observation -> RGB retina frame -> FlyController.observe
-> DNp20 L/R decode -> continuous throttle/steering/pen_down.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor" / "stonkfly"
DATA = Path(os.environ.get("STONKFLY_DATA", ROOT / "data")).resolve()

# Ensure stonkfly package + data root are visible before import.
os.environ.setdefault("STONKFLY_DATA", str(DATA))
if str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))


@dataclass
class DrawSettings:
    neural_ms: float = 200.0
    neural_bin_ms: float = 10.0
    pulse_ms: float = 120.0
    pulse_current: float = 20.0
    decoder_threshold_hz: float = 1.5
    learning: bool = True


class MaleCNSBridge:
    def __init__(self, settings: DrawSettings | None = None):
        if not (DATA / "graph.npz").exists():
            raise RuntimeError(
                "MaleCNS graph missing. Run: "
                "STONKFLY_DATA=./data python -m stonkfly prepare "
                "(from vendor/stonkfly with venv)"
            )
        # Import after STONKFLY_DATA is set so GRAPH resolves under ./data
        from stonkfly.config import Settings as SFSettings
        from stonkfly.neural.controller import FlyController

        # Reuse stonkfly Settings fields the controller needs; ignore trading fields.
        base = SFSettings(
            learning=True,
            neural_ms=200,
            decoder_threshold_hz=1.5,
            interval_seconds=60,
        )
        self.settings = settings or DrawSettings()
        # Override timing on a mutable copy via object.__setattr__ on frozen dataclass — use simple namespace instead
        self.ctrl_settings = type(
            "S",
            (),
            {
                "neural_ms": self.settings.neural_ms,
                "neural_bin_ms": self.settings.neural_bin_ms,
                "pulse_ms": self.settings.pulse_ms,
                "pulse_current": self.settings.pulse_current,
                "decoder_threshold_hz": self.settings.decoder_threshold_hz,
                "learning": self.settings.learning,
            },
        )()
        self.controller = FlyController(self.ctrl_settings)
        self._last = None
        self.checkpoint_dir = Path(os.environ.get("DRAWFLY_CKPT", ROOT / "data" / "checkpoints"))
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        default = self.checkpoint_dir / "trump_portrait.npz"
        if default.exists():
            try:
                self.controller.restore(default)
                print(f"[malecns] restored checkpoint {default}")
            except Exception as exc:  # noqa: BLE001
                print(f"[malecns] checkpoint restore failed: {exc}")

    def save_checkpoint(self, name: str = "trump_portrait.npz") -> dict:
        path = self.checkpoint_dir / name
        self.controller.save(path)
        return {"ok": True, "path": str(path), "bytes": path.stat().st_size}

    def load_checkpoint(self, name: str = "trump_portrait.npz") -> dict:
        path = self.checkpoint_dir / name
        if not path.exists():
            raise FileNotFoundError(f"checkpoint missing: {path}")
        self.controller.restore(path)
        return {"ok": True, "path": str(path)}

    def checkpoint_info(self) -> dict:
        files = sorted(self.checkpoint_dir.glob("*.npz"))
        return {
            "dir": str(self.checkpoint_dir),
            "files": [{"name": f.name, "bytes": f.stat().st_size} for f in files],
        }

    @staticmethod
    def ready() -> bool:
        return (DATA / "graph.npz").exists() and (DATA / "annotations.feather").exists()

    def render_rgb(self, observation: dict, size: int = 96) -> np.ndarray:
        """Paint a compact retina image of the paper world for MaleCNS visual inputs."""
        import base64
        from io import BytesIO

        img = Image.new("RGB", (size, size), (18, 16, 14))
        draw = ImageDraw.Draw(img)

        def xy(p):
            x = int((float(p["x"]) + 1) * 0.5 * (size - 1))
            y = int((1 - (float(p["y"]) + 1) * 0.5) * (size - 1))
            return x, y

        preview = observation.get("target_preview") or []
        if preview:
            seg = []
            for p in preview:
                if p is None:
                    if len(seg) >= 2:
                        draw.line(seg, fill=(110, 100, 88), width=1)
                    seg = []
                    continue
                seg.append(xy(p))
            if len(seg) >= 2:
                draw.line(seg, fill=(110, 100, 88), width=1)

        ink = observation.get("ink_preview") or []
        if len(ink) >= 2:
            draw.line([xy(p) for p in ink], fill=(40, 32, 24), width=2)

        goal = observation.get("goal")
        if goal:
            gx, gy = xy(goal)
            draw.ellipse([gx - 3, gy - 3, gx + 3, gy + 3], outline=(63, 200, 140), width=1)

        cover = float(observation.get("coverage") or 0)
        draw.rectangle([4, 4, 4 + int((size - 8) * cover), 9], fill=(63, 159, 130))

        herr = float(observation.get("heading_error_deg") or 0)
        if herr > 0:
            draw.rectangle([size - 9, 18, size - 2, size - 18], fill=(209, 122, 69))
        elif herr < 0:
            draw.rectangle([2, 18, 9, size - 18], fill=(47, 159, 130))

        pose = observation.get("pose") or {"x": 0, "y": 0, "heading_deg": 0}
        px, py = xy({"x": pose["x"], "y": pose["y"]})
        dist = float(observation.get("goal_distance") or observation.get("nearest_target_distance") or 1)
        glow = max(0, min(255, int(255 * (1 - min(dist, 0.35) / 0.35))))
        draw.ellipse([px - 3, py - 3, px + 3, py + 3], fill=(glow, glow // 2, 40))
        rad = np.deg2rad(float(pose.get("heading_deg") or 0))
        hx = int(px + 9 * np.cos(rad))
        hy = int(py - 9 * np.sin(rad))
        draw.line([px, py, hx, hy], fill=(242, 235, 225), width=2)
        if observation.get("pen_down"):
            draw.rectangle([size - 13, size - 13, size - 3, size - 3], fill=(63, 159, 130))

        arr = np.asarray(img, dtype=np.uint8)
        buf = BytesIO()
        img.save(buf, format="PNG")
        self._last_retina_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return arr

    def step(self, observation: dict, reinforcement: str = "none") -> dict:
        rgb = self.render_rgb(observation)
        raw = self.controller.observe(rgb, reinforcement)
        side = raw["side"]
        diff = float(raw["difference_hz"])
        left = float(raw["left_hz"])
        right = float(raw["right_hz"])
        energy = min(1.0, (left + right) / 18.0)

        herr = float(
            observation.get("heading_to_goal_deg")
            or observation.get("heading_error_deg")
            or 0
        )
        dist = float(
            observation.get("goal_distance")
            or observation.get("nearest_target_distance")
            or 1
        )
        cover = float(observation.get("coverage") or 0)
        budget = float(observation.get("budget_left") or 99)

        # Pure pursuit toward stroke-order goal
        steer_geom = max(-1.0, min(1.0, -herr / 28.0))
        cns_bias = 0.0
        if side == "BUY":
            cns_bias = min(0.22, 0.05 + abs(diff) / 22.0)
        elif side == "SELL":
            cns_bias = -min(0.22, 0.05 + abs(diff) / 22.0)
        steering = max(-1.0, min(1.0, 0.9 * steer_geom + 0.1 * cns_bias))

        align = max(0.0, 1.0 - abs(herr) / 45.0)
        # crawl when close/aligned for higher coverage precision
        if dist < 0.08 and align > 0.7:
            throttle = 0.35 + 0.25 * energy
        elif dist > 0.25:
            throttle = 0.55 + 0.35 * align
        else:
            throttle = 0.3 + 0.5 * align * (0.6 + 0.4 * energy)

        pen_tol = 0.14
        pen_down = dist < pen_tol and abs(herr) < 48
        # keep drawing visibly once on the path
        if dist < 0.2 and abs(herr) < 55 and cover < 0.95:
            pen_down = True
        pressure = float(observation.get("goal_pressure") or (0.65 + 0.3 * align)) if pen_down else 0.15
        if pen_down:
            throttle = max(throttle, 0.5)

        cover_done = 0.86 if observation.get("shape") in ("line", "circle") else 0.8
        if observation.get("shape") in ("trump", "hair", "face"):
            cover_done = 0.74
        finish = bool(cover > cover_done or budget < 4)

        # KC activity fingerprint for UI (downsample plastic memory)
        mem = raw.get("memory") or {}
        b = self.controller.brain
        kc_idx = b.circuit["kc"]
        kc_counts = raw.get("KC_spikes") or 0
        # sample 64 KC bins from rate_kc or counts
        counts = b.counts
        if counts is not None and len(kc_idx):
            sample_n = min(64, len(kc_idx))
            step = max(1, len(kc_idx) // sample_n)
            kc_bins = [int(counts[kc_idx[i]]) for i in range(0, len(kc_idx), step)][:64]
        else:
            kc_bins = [0] * 32

        out = {
            "throttle": float(throttle),
            "steering": float(steering),
            "pen_down": bool(pen_down),
            "pressure": pressure,
            "finish": finish,
            "reason": (
                f"pursuit goal herr={herr:.1f} dist={dist:.3f} "
                f"DNp20 {side} Δ={diff:.2f}"
            ),
            "model": "MaleCNS-v1.2 / goal-pursuit+DNp20",
            "backend": "malecns",
            "retina_png_b64": getattr(self, "_last_retina_b64", None),
            "neural": {
                "side": side,
                "left_hz": left,
                "right_hz": right,
                "difference_hz": diff,
                "gate_spikes": int(raw.get("gate_spikes") or 0),
                "total_spikes": int(raw.get("total_spikes") or 0),
                "KC_spikes": int(kc_counts),
                "reward_spikes": int(raw.get("reward_spikes") or 0),
                "aversive_spikes": int(raw.get("aversive_spikes") or 0),
                "kc_bins": kc_bins,
                "memory": {
                    "mean_efficacy": mem.get("mean_efficacy"),
                    "changed_edges": mem.get("changed_edges"),
                    "plastic_edges": mem.get("plastic_edges"),
                    "minimum_efficacy": mem.get("minimum_efficacy"),
                },
                "brain_ms": float(raw.get("brain_ms") or 0),
                "compute_seconds": float(raw.get("compute_seconds") or 0),
                "stimulus": raw.get("stimulus"),
                "spike_sha256": raw.get("spike_sha256"),
            },
            "usage": {"prompt_tokens": 0, "completion_tokens": 0},
        }
        self._last = out
        return out
