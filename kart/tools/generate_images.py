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

AVATAR = (
    "anime cel-shaded character portrait, 3D rendered as 2D toon style, head and shoulders, wearing a glossy white "
    "racing helmet with the visor open and a racing suit collar, bold clean dark outlines, flat two-tone cel shadows, "
    "crisp rim light, vibrant saturated colors, centered inside a circular badge with a thick colored ring, "
    "isolated on a fully transparent background, no text, no letters"
)
TOON_FOLIAGE = (
    "anime background art style, cel-shaded with flat two-tone shading, clean dark outline, Studio Ghibli inspired, "
    "centered, whole plant visible from base to top, isolated on a fully transparent background, no ground, no shadow"
)

JOBS = {
    "logo": dict(size="1536x1024", transparent=True, prompt=(
        "Commercial video game logo reading 'TURBO KART' in huge bold italic chrome-and-candy-red 3D letters with a thick "
        "dark outline, a checkered flag swoosh and orange speed flames behind the words, small subtitle ribbon reading "
        "'GRAND PRIX', glossy highlights, anime racing game style, centered, isolated on a fully transparent background")),
    "keyart": dict(size="1536x1024", transparent=False, prompt=(
        "Key art for a cel-shaded anime kart racing game: four cute round-headed alien racers in white helmets (purple, "
        "pink, yellow, teal) drifting side by side out of a banked corner toward the viewer, sparks and blue drift trails, "
        "speed lines, tyre barriers, a sunny sky with big clouds, dynamic low camera angle, vibrant commercial poster "
        "illustration, 3D rendered as 2D toon style, leave the upper third fairly open sky, no text, no logo")),
    "avatar-you": dict(size="1024x1024", transparent=True, prompt=(
        f"Cute round-headed lavender purple alien kart racer with two small rounded ears on top of the head, big glossy black eyes, "
        f"a confident grin, purple ring, {AVATAR}")),
    "avatar-dao": dict(size="1024x1024", transparent=True, prompt=(
        f"Cute round-headed pink alien kart racer with sharp determined eyes and a smirk, magenta ring, {AVATAR}")),
    "avatar-bazzi": dict(size="1024x1024", transparent=True, prompt=(
        f"Cute round-headed yellow alien kart racer with happy closed crescent eyes and a big smile, golden yellow ring, {AVATAR}")),
    "avatar-marid": dict(size="1024x1024", transparent=True, prompt=(
        f"Cute round-headed teal mint alien kart racer with big round sparkling eyes and a shy smile, teal ring, {AVATAR}")),
    "toon-pine": dict(size="1024x1536", transparent=True, prompt=(
        f"A single tall stylized pine tree with layered dark green foliage tiers and a straight brown trunk, {TOON_FOLIAGE}")),
    "toon-broadleaf": dict(size="1024x1536", transparent=True, prompt=(
        f"A single round fluffy stylized green tree with clumped leaf masses and a short brown trunk, {TOON_FOLIAGE}")),
    "toon-bush": dict(size="1024x1024", transparent=True, prompt=(
        f"A single round fluffy stylized green bush with clumped leaf masses, {TOON_FOLIAGE}")),
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
