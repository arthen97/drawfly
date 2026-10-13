#!/usr/bin/env python3
"""Drawfly server: real MaleCNS (stonkfly) primary, Merouter gpt-6-astra optional coach."""

from __future__ import annotations

import json
import os
import threading
import traceback
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
HOST = os.getenv("DRAWFLY_HOST", "127.0.0.1")
PORT = int(os.getenv("DRAWFLY_PORT", "8765"))
MEROUTER_BASE = os.getenv("MEROUTER_BASE_URL", "https://merouter.play.one2x.ai").rstrip("/")
GPT_MODEL = os.getenv("DRAWFLY_MODEL", "gpt-6-astra")
os.environ.setdefault("STONKFLY_DATA", str(ROOT / "data"))

_CNS = None
_CNS_ERROR = None
_SCENE_LOCK = threading.Lock()
_SCENE_LOG = []
_SCENE_SEQ = 0


def get_cns():
    global _CNS, _CNS_ERROR
    if _CNS is not None:
        return _CNS
    if _CNS_ERROR:
        return None
    try:
        from malecns_bridge import MaleCNSBridge

        if not MaleCNSBridge.ready():
            _CNS_ERROR = "graph.npz not ready — run prepare"
            return None
        _CNS = MaleCNSBridge()
        return _CNS
    except Exception as exc:  # noqa: BLE001
        _CNS_ERROR = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
        return None


def merouter_headers() -> dict[str, str]:
    service_key = os.environ.get("MEROUTER_SERVICE_KEY")
    api_key = os.environ.get("MEROUTER_API_KEY")
    if service_key:
        return {"Content-Type": "application/json", "X-Service-Key": service_key}
    if api_key:
        return {"Content-Type": "application/json", "X-Api-Key": api_key}
    raise RuntimeError("缺少 MEROUTER_SERVICE_KEY 或 MEROUTER_API_KEY")


def call_gpt6(observation: dict) -> dict:
    system = (
        "You are an optional coach for Drawfly. Prefer geometric tracing. "
        'JSON only: {"throttle":0-1,"steering":-1..1,"pen_down":bool,"finish":bool,"reason":"short"}'
    )
    body = json.dumps(
        {
            "model": GPT_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(observation, ensure_ascii=False)},
            ],
            "temperature": 1,
            "max_completion_tokens": 160,
            "response_format": {"type": "json_object"},
        }
    ).encode()
    req = urllib.request.Request(
        f"{MEROUTER_BASE}/v1/chat/completions",
        data=body,
        method="POST",
        headers=merouter_headers(),
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        raw = json.loads(resp.read().decode())
    parsed = json.loads(raw["choices"][0]["message"]["content"])

    def clamp(v, a, b):
        return max(a, min(b, float(v)))

    return {
        "throttle": clamp(parsed.get("throttle", 0), 0, 1),
        "steering": clamp(parsed.get("steering", 0), -1, 1),
        "pen_down": bool(parsed.get("pen_down", False)),
        "finish": bool(parsed.get("finish", False)),
        "reason": str(parsed.get("reason") or ""),
        "model": raw.get("model") or GPT_MODEL,
        "backend": "gpt6",
        "usage": raw.get("usage") or {},
    }


def clean_scene_command(cmd: dict) -> dict | None:
    if not isinstance(cmd, dict):
        return None
    op = cmd.get("op")
    if op not in ("set", "camera", "control", "release"):
        return None
    actor = str(cmd.get("actor") or "").strip()[:64]
    if not actor:
        return None
    out = {"actor": actor, "op": op}
    if cmd.get("target") is not None:
        out["target"] = str(cmd.get("target"))[:80]
    props = cmd.get("props")
    if isinstance(props, dict):
        out["props"] = props
    channels = cmd.get("channels")
    if isinstance(channels, list):
        out["channels"] = [str(item)[:32] for item in channels[:12]]
    if "ifRev" in cmd:
        out["ifRev"] = cmd.get("ifRev")
    return out


def append_scene_commands(origin: str, commands: list) -> list:
    global _SCENE_SEQ
    accepted = []
    with _SCENE_LOCK:
        for cmd in commands[:20]:
            cleaned = clean_scene_command(cmd)
            if cleaned is None:
                continue
            _SCENE_SEQ += 1
            item = {"seq": _SCENE_SEQ, "origin": origin[:80], "cmd": cleaned}
            _SCENE_LOG.append(item)
            accepted.append(item)
        if len(_SCENE_LOG) > 200:
            del _SCENE_LOG[:-200]
    return accepted


def scene_since(since: int) -> dict:
    with _SCENE_LOCK:
        commands = [item for item in _SCENE_LOG if item["seq"] > since]
        seq = _SCENE_SEQ
    return {"seq": seq, "commands": commands}


def decide(observation: dict, backend: str, reinforcement: str) -> dict:
    backend = (backend or "malecns").lower()
    if backend in ("malecns", "auto", "real"):
        cns = get_cns()
        if cns is not None:
            return cns.step(observation, reinforcement=reinforcement)
        if backend == "malecns":
            raise RuntimeError(_CNS_ERROR or "MaleCNS unavailable")
    return call_gpt6(observation)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            ready = False
            try:
                from malecns_bridge import MaleCNSBridge

                ready = MaleCNSBridge.ready()
            except Exception:
                ready = False
            ckpt = None
            cns = get_cns()
            if cns is not None:
                try:
                    ckpt = cns.checkpoint_info()
                except Exception:
                    ckpt = None
            self._json(
                200,
                {
                    "ok": True,
                    "malecns_ready": ready,
                    "malecns_loaded": _CNS is not None,
                    "malecns_error": _CNS_ERROR,
                    "merouter_configured": bool(
                        os.getenv("MEROUTER_SERVICE_KEY") or os.getenv("MEROUTER_API_KEY")
                    ),
                    "default_backend": "malecns" if ready else "gpt6",
                    "gpt_model": GPT_MODEL,
                    "stonkfly_data": os.environ.get("STONKFLY_DATA"),
                    "checkpoints": ckpt,
                },
            )
            return
        if path == "/api/checkpoint":
            cns = get_cns()
            if cns is None:
                self._json(503, {"error": _CNS_ERROR or "MaleCNS unavailable"})
                return
            self._json(200, cns.checkpoint_info())
            return
        if path == "/api/progress":
            prog = ROOT / "data" / "progress.json"
            if not prog.exists():
                self._json(
                    200,
                    {
                        "episodes": 0,
                        "best_acc": 0,
                        "best_likeness": 0,
                        "recent": [],
                        "note": "还没有局末成绩。打开页面让自动训练跑完至少 1 局。",
                    },
                )
                return
            try:
                self._json(200, json.loads(prog.read_text()))
            except Exception as exc:  # noqa: BLE001
                self._json(500, {"error": str(exc)})
            return
        if path == "/api/scene/commands":
            query = parse_qs(urlparse(self.path).query)
            try:
                since = int((query.get("since") or ["0"])[0])
            except ValueError:
                since = 0
            self._json(200, scene_since(since))
            return
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode() or "{}"
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {}

        if path == "/api/checkpoint/save":
            cns = get_cns()
            if cns is None:
                self._json(503, {"error": _CNS_ERROR or "MaleCNS unavailable"})
                return
            try:
                name = payload.get("name") or "trump_portrait.npz"
                self._json(200, cns.save_checkpoint(name))
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                self._json(500, {"error": str(exc)})
            return

        if path == "/api/checkpoint/load":
            cns = get_cns()
            if cns is None:
                self._json(503, {"error": _CNS_ERROR or "MaleCNS unavailable"})
                return
            try:
                name = payload.get("name") or "trump_portrait.npz"
                self._json(200, cns.load_checkpoint(name))
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                self._json(500, {"error": str(exc)})
            return

        if path == "/api/progress":
            try:
                prog_path = ROOT / "data" / "progress.json"
                prev = {}
                if prog_path.exists():
                    try:
                        prev = json.loads(prog_path.read_text())
                    except Exception:
                        prev = {}
                recent = list(prev.get("recent") or [])
                entry = payload.get("entry") or payload
                if entry:
                    recent.append(entry)
                    recent = recent[-80:]
                best_acc = max(float(prev.get("best_acc") or 0), float(entry.get("acc") or 0) / 100.0)
                best_like = max(
                    float(prev.get("best_likeness") or 0),
                    float(entry.get("like") or 0) / 100.0,
                )
                out = {
                    "episodes": int(entry.get("ep") or prev.get("episodes") or len(recent)),
                    "best_acc": round(best_acc, 4),
                    "best_likeness": round(best_like, 4),
                    "last": entry,
                    "recent": recent,
                    "updated_at": entry.get("t") or prev.get("updated_at"),
                }
                # optional paper snapshot (data URL)
                snap = payload.get("paper_png_b64")
                if snap:
                    img_dir = ROOT / "data" / "progress"
                    img_dir.mkdir(parents=True, exist_ok=True)
                    import base64

                    raw_b64 = snap.split(",", 1)[-1]
                    ep = int(entry.get("ep") or out["episodes"])
                    img_path = img_dir / f"ep_{ep:04d}.png"
                    img_path.write_bytes(base64.b64decode(raw_b64))
                    latest = img_dir / "latest.png"
                    latest.write_bytes(img_path.read_bytes())
                    out["latest_paper"] = f"/data/progress/latest.png?t={ep}"
                    out["paper_path"] = str(img_path)
                prog_path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
                self._json(200, out)
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                self._json(500, {"error": str(exc)})
            return

        if path == "/api/scene/commands":
            origin = str(payload.get("origin") or "remote")
            commands = payload.get("commands")
            if isinstance(payload.get("command"), dict):
                commands = [payload["command"]]
            if not isinstance(commands, list):
                self._json(400, {"error": "commands must be a list"})
                return
            accepted = append_scene_commands(origin, commands)
            self._json(200, {"ok": True, "accepted": accepted, "seq": _SCENE_SEQ})
            return

        if path != "/api/decide":
            self.send_error(404)
            return
        try:
            obs = payload.get("observation") or payload
            backend = payload.get("backend") or ("malecns" if get_cns() else "gpt6")
            reinforcement = payload.get("reinforcement") or "none"
            if reinforcement not in ("none", "reward", "aversive"):
                reinforcement = "none"
            result = decide(obs, backend, reinforcement)
            self._json(200, result)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self._json(500, {"error": str(exc)})

    def _json(self, status: int, payload: dict):
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args):
        print(f"[drawfly] {self.address_string()} - {fmt % args}")


def main():
    # Eager try-load so health reflects reality
    get_cns()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Drawfly → http://{HOST}:{PORT}")
    print(f"  MaleCNS ready: {get_cns() is not None} err={_CNS_ERROR}")
    print(f"  STONKFLY_DATA={os.environ.get('STONKFLY_DATA')}")
    server.serve_forever()


if __name__ == "__main__":
    main()
