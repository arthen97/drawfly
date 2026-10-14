# Kart asset credits

| What | Source | License |
|---|---|---|
| `hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr` | [Poly Haven](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) | CC0 |
| `textures/asphalt_02`, `aerial_grass_rock`, `concrete_wall_004`, `metal_plate` | [Poly Haven](https://polyhaven.com/textures) | CC0 |
| `models/polyhaven/old_tyre` | [Poly Haven](https://polyhaven.com/a/old_tyre) | CC0 |
| `models/kenney/kart-*.glb` + `Textures/colormap.png` | [Kenney Car Kit](https://kenney.nl/assets/car-kit) | CC0 |
| `tex/*.webp` (decals, foliage incl. `toon-*`, racer `avatar-*`, `logo`, `keyart`, curb, tread, billboards) | Generated with `gpt-image-2.5-sunburst` via merouter; prompts in `generated/prompts.json` | Original, project-owned |

| `audio/music-title.mp3`, `music-race.mp3`, `music-victory.mp3` | Generated with `eleven-music-v1` via merouter; prompts in `audio/prompts.json` | Original, project-owned |

Engine, drift, boost, backfire and countdown sounds are synthesized live with Web Audio (`audio.js`).

Regenerate music: `MEROUTER_SERVICE_KEY=... python3 kart/tools/generate_audio.py [name ...]`.
Regenerate images: `MEROUTER_SERVICE_KEY=... python3 kart/tools/generate_images.py [name ...]`,
then `.venv/bin/python kart/tools/prepare_textures.py`. All sponsor names are fictional.
