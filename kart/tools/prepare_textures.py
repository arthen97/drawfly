#!/usr/bin/env python3
"""Turn kart/assets/generated/*.png into web-sized textures in kart/assets/tex/.

Cut-outs (decals, foliage) are cropped to their alpha bounds so the game can size
them by aspect ratio; opaque tiles are just downscaled. Writes tex/manifest.json.

Usage: .venv/bin/python kart/tools/prepare_textures.py
"""

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "assets"
SRC, OUT = ROOT / "generated", ROOT / "tex"

# name -> longest side in pixels
CUTOUTS = {
    "decal-dao-motors": 512, "decal-bazzi-oil": 512, "decal-turbo-noodle": 512, "decal-nitro-fizz": 512,
    "decal-flames": 1024, "decal-checker": 1024,
    "tree-pine": 1024, "tree-broadleaf": 1024, "bush": 512,
    "toon-pine": 1024, "toon-broadleaf": 1024, "toon-bush": 512,
    "avatar-you": 256, "avatar-dao": 256, "avatar-bazzi": 256, "avatar-marid": 256,
    "logo": 1024,
}
TILES = {"curb": 512, "tire-tread": 512, "banner-ads-1": 1024, "banner-ads-2": 1024, "banner-start": 1024, "keyart": 1920}


def fit(img: Image.Image, longest: int) -> Image.Image:
    scale = longest / max(img.size)
    if scale >= 1:
        return img
    return img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, longest in CUTOUTS.items():
        img = Image.open(SRC / f"{name}.png").convert("RGBA")
        alpha = img.getchannel("A").point(lambda a: 255 if a > 24 else 0)
        box = alpha.getbbox()
        pad = 6
        box = (max(0, box[0] - pad), max(0, box[1] - pad), min(img.width, box[2] + pad), min(img.height, box[3] + pad))
        img = fit(img.crop(box), longest)
        img.save(OUT / f"{name}.webp", quality=88, method=6)
        manifest[name] = {"file": f"{name}.webp", "w": img.width, "h": img.height, "alpha": True}
    for name, longest in TILES.items():
        img = fit(Image.open(SRC / f"{name}.png").convert("RGB"), longest)
        img.save(OUT / f"{name}.webp", quality=86, method=6)
        manifest[name] = {"file": f"{name}.webp", "w": img.width, "h": img.height, "alpha": False}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    for name, info in manifest.items():
        size = (OUT / info["file"]).stat().st_size // 1024
        print(f"{name:20s} {info['w']}x{info['h']}  {size}KB")


if __name__ == "__main__":
    main()
