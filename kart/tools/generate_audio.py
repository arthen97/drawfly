#!/usr/bin/env python3
"""Generate the kart soundtrack with merouter music models (eleven-music-v1 by default).

Usage: MEROUTER_SERVICE_KEY=... python3 kart/tools/generate_audio.py [name ...]
MP3s land in kart/assets/audio/; prompts.json records exactly what was asked.
"""

import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = os.getenv("MEROUTER_BASE_URL", "https://merouter.play.one2x.ai").rstrip("/")
MODEL = os.getenv("KART_MUSIC_MODEL", "eleven-music-v1")
OUT = Path(__file__).resolve().parent.parent / "assets" / "audio"

STYLE = "instrumental only, no vocals, crisp modern mix, punchy drums, bright synth leads, anime racing game soundtrack"

JOBS = {
    "music-title": dict(duration=60, prompt=(
        f"Title screen theme for a colourful cartoon kart racing game: heroic catchy main melody, rising synth brass, "
        f"driving four-on-the-floor beat at 150 BPM, festive and commercial, loops cleanly back to the start, {STYLE}")),
    "music-race": dict(duration=120, prompt=(
        f"High-energy eurobeat / J-pop style race music for a cartoon kart racer: fast 165 BPM, slap bass, "
        f"arpeggiated synths, electric guitar stabs, constant momentum without breakdowns, loops seamlessly, {STYLE}")),
    "music-victory": dict(duration=15, prompt=(
        f"Short triumphant victory fanfare after winning a kart race: brass and synth flourish, cymbal swell, "
        f"joyful resolving final chord, {STYLE}")),
}


def generate(name: str) -> str:
    job = JOBS[name]
    path = OUT / f"{name}.mp3"
    if path.exists() and not os.environ.get("KART_AUDIO_FORCE"):
        return f"{name}: exists, skipped"
    body = {"model": MODEL, "prompt": job["prompt"], "duration": job["duration"]}
    start = time.time()
    for attempt in range(3):
        try:
            subprocess.run(
                ["curl", "-sS", "--fail", "--max-time", "900", f"{BASE}/v1/music/generations",
                 "-H", "Content-Type: application/json",
                 "-H", f"X-Service-Key: {os.environ['MEROUTER_SERVICE_KEY']}",
                 "--data-binary", "@-", "-o", str(path)],
                input=json.dumps(body).encode(), capture_output=True, check=True,
            )
            break
        except Exception as exc:
            path.unlink(missing_ok=True)
            if attempt == 2:
                return f"{name}: FAILED {exc}"
            time.sleep(5)
    return f"{name}: {path.stat().st_size // 1024}KB in {time.time() - start:.0f}s"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    names = sys.argv[1:] or list(JOBS)
    with ThreadPoolExecutor(max_workers=3) as pool:
        for line in pool.map(generate, names):
            print(line, flush=True)
    log = OUT / "prompts.json"
    record = json.loads(log.read_text()) if log.exists() else {}
    for name in names:
        record[name] = {"model": MODEL, **JOBS[name]}
    log.write_text(json.dumps(record, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
