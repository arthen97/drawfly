#!/usr/bin/env python3
"""Generate kart decals, billboard foliage and tileable textures with merouter gpt-image-2.5.

Usage: MEROUTER_SERVICE_KEY=... python3 kart/tools/generate_images.py [name ...]
Images land in kart/assets/generated/; prompts.json records exactly what was asked.
"""

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = os.getenv("MEROUTER_BASE_URL", "https://merouter.play.one2x.ai").rstrip("/")
MODEL = os.getenv("KART_IMAGE_MODEL", "gpt-image-2.5-sunburst")
OUT = Path(__file__).resolve().parent.parent / "assets" / "generated"

STICKER = (
    "isolated on a fully transparent background, flat vinyl racing decal, crisp edges, "
    "thin white sticker outline, no drop shadow, no mockup, no background"
)
FOLIAGE = (
    "photorealistic, centered, whole plant visible from base to top, soft overcast daylight, "
    "isolated on a fully transparent background, no ground, no shadow, no pot"
)
TILE = (
    "seamless tileable texture, top-down orthographic flat scan, even diffuse lighting, "
    "fills the entire frame edge to edge, no perspective, no border, no text"
)

JOBS = {
    "decal-dao-motors": dict(size="1024x1024", transparent=True, prompt=(
        f"Racing sponsor sticker logo reading 'DAO MOTORS', bold chrome italic wordmark with a red stylized wing emblem, {STICKER}")),
    "decal-bazzi-oil": dict(size="1024x1024", transparent=True, prompt=(
        f"Motor oil racing sponsor sticker reading 'BAZZI OIL', yellow and black, glossy oil drop emblem, {STICKER}")),
    "decal-turbo-noodle": dict(size="1024x1024", transparent=True, prompt=(
        f"Fun racing sponsor sticker reading 'TURBO NOODLE', red and white, steaming noodle bowl with a lightning bolt, {STICKER}")),
    "decal-nitro-fizz": dict(size="1024x1024", transparent=True, prompt=(
        f"A single glossy racing sponsor sticker reading 'NITRO FIZZ', bold italic letters, orange and blue, {STICKER}")),
    "decal-flames": dict(size="1536x1024", transparent=True, prompt=(
        f"Long horizontal hot-rod racing flames graphic for the side of a kart, orange to yellow gradient with dark red outline, flames pointing right, {STICKER}")),
    "decal-checker": dict(size="1536x1024", transparent=True, prompt=(
        f"Horizontal racing stripe decal: a band of black and white checkered flag squares that fades into speed streaks on the right, {STICKER}")),
    "tree-pine": dict(size="1024x1536", transparent=True, prompt=(
        f"A single tall green pine tree with a straight brown trunk, {FOLIAGE}")),
    "tree-broadleaf": dict(size="1024x1536", transparent=True, prompt=(
        f"A single round leafy green deciduous tree with a short trunk, {FOLIAGE}")),
    "bush": dict(size="1024x1024", transparent=True, prompt=(
        f"A single dense round green garden shrub, {FOLIAGE}")),
    "curb": dict(size="1024x1024", transparent=False, prompt=(
        "Motorsport race track kerb: exactly two red and two white painted concrete blocks arranged left to right as vertical stripes, "
        f"worn paint, rubber tire marks, fine grit, {TILE}")),
    "tire-tread": dict(size="1024x1024", transparent=False, prompt=(
        f"Black rubber go-kart racing tire tread pattern with shallow grooves and fine rubber grain, {TILE}")),
    "banner-ads-1": dict(size="1536x1024", transparent=False, prompt=(
        "Trackside advertising billboard artwork for a cartoon kart racing game, three fictional sponsor logos 'NITRO FIZZ', "
        "'DAO MOTORS' and 'BAZZI OIL' side by side on a glossy blue background with white speed lines, flat graphic design, "
        "fills the entire frame, no frame, no perspective, no people")),
    "banner-ads-2": dict(size="1536x1024", transparent=False, prompt=(
        "Trackside advertising billboard artwork for a cartoon kart racing game, big 'TURBO NOODLE' logo with a steaming noodle "
        "bowl and lightning bolt on a bright red background with yellow halftone burst, flat graphic design, fills the entire "
        "frame, no frame, no perspective, no people")),
    "banner-start": dict(size="1536x1024", transparent=False, prompt=(
        "Race start finish gantry banner reading 'START · FINISH' in huge bold italic white letters on black, checkered flag "
        "blocks on both ends, yellow accent stripes, flat graphic design, fills the entire frame, no frame, no perspective")),
}


def generate(name: str) -> str:
    job = JOBS[name]
    if (OUT / f"{name}.png").exists() and not os.environ.get("KART_IMAGE_FORCE"):
        return f"{name}: exists, skipped"
    body = {"model": MODEL, "prompt": job["prompt"], "size": job["size"], "n": 1}
    if job["transparent"]:
        body["background"] = "transparent"
    start = time.time()
    for attempt in range(3):
        try:
            out = subprocess.run(
                ["curl", "-sS", "--fail", "--max-time", "300", f"{BASE}/v1/images/generations",
                 "-H", "Content-Type: application/json",
                 "-H", f"X-Service-Key: {os.environ['MEROUTER_SERVICE_KEY']}",
                 "--data-binary", "@-"],
                input=json.dumps(body).encode(), capture_output=True, check=True,
            ).stdout
            data = json.loads(out)["data"][0]
            break
        except Exception as exc:
            if attempt == 2:
                return f"{name}: FAILED {exc}"
            time.sleep(3)
    path = OUT / f"{name}.png"
    if data.get("b64_json"):
        path.write_bytes(base64.b64decode(data["b64_json"]))
    else:
        urllib.request.urlretrieve(data["url"], path)
    return f"{name}: {path.stat().st_size // 1024}KB in {time.time() - start:.0f}s"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    names = sys.argv[1:] or list(JOBS)
    with ThreadPoolExecutor(max_workers=5) as pool:
        for line in pool.map(generate, names):
            print(line, flush=True)
    log = OUT / "prompts.json"
    record = json.loads(log.read_text()) if log.exists() else {}
    for name in names:
        record[name] = {"model": MODEL, **JOBS[name]}
    log.write_text(json.dumps(record, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
