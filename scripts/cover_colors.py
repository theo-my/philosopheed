#!/usr/bin/env python3
"""Finalize per-journal colours.

1. Springer journals: sample the real cover image (media.springernature.com)
   and extract the dominant chromatic colour.
2. Other journals: take research/cover-colors.json (worker-researched).
3. De-duplicate publisher clusters: journals sharing a colour get stable
   per-journal hue/lightness variations so every journal is visually distinct.
Writes the "color" field into data/journals.json.
"""
import colorsys
import io
import json
from collections import Counter
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
reg = json.loads((ROOT / "data/journals.json").read_text())
worker = json.loads((ROOT / "research/cover-colors.json").read_text())

SPRINGER_IDS = {  # journal id -> springer journal number (from RSS URLs)
    "phil-studies": 11098, "synthese": 11229, "erkenntnis": 10670,
    "philosophia": 11406, "etmp": 10677, "j-ethics": 10892, "ejps": 13194,
    "bio-phil": 10539, "found-phys": 10701, "jgps": 10838, "phil-tech": 13347,
    "minds-machines": 11023, "eit": 10676, "ai-soc": 146, "see": 11948,
    "ai-ethics": 43681, "dig-soc": 44206,
}


def dominant_chromatic(img: Image.Image) -> str | None:
    img = img.convert("RGB").resize((60, 80))
    counts = Counter()
    for r, g, b in img.getdata():
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if s < 0.25 or l < 0.12 or l > 0.88:   # skip greys/whites/blacks
            continue
        counts[(round(h * 24), round(l * 5), round(s * 3))] += 1
    if not counts:
        return None
    (hq, lq, sq), _ = counts.most_common(1)[0]
    r, g, b = colorsys.hls_to_rgb(hq / 24, min(0.62, max(0.28, lq / 5)), max(0.45, sq / 3))
    return "#{:02x}{:02x}{:02x}".format(int(r * 255), int(g * 255), int(b * 255))


colors = {}
for jid, num in SPRINGER_IDS.items():
    try:
        r = requests.get(f"https://media.springernature.com/w153/springer-static/cover-hires/journal/{num}", timeout=30)
        r.raise_for_status()
        hexv = dominant_chromatic(Image.open(io.BytesIO(r.content)))
        if hexv:
            colors[jid] = hexv
            print(f"sampled {jid}: {hexv}")
            continue
    except Exception as e:  # noqa: BLE001
        print(f"sample failed {jid}: {e}")

for j in reg["journals"]:
    if j["id"] not in colors:
        colors[j["id"]] = worker[j["id"]]["hex"]

# de-duplicate: same hex shared by >1 journal → vary hue/lightness stably
by_hex = Counter(colors.values())
seen: dict[str, int] = {}
for j in reg["journals"]:
    jid = j["id"]
    hexv = colors[jid]
    if by_hex[hexv] > 1:
        k = seen.get(hexv, 0)
        seen[hexv] = k + 1
        r, g, b = (int(hexv[i:i + 2], 16) / 255 for i in (1, 3, 5))
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        h = (h + (k * 0.061)) % 1.0                    # walk the hue wheel
        l = min(0.6, max(0.26, l + ((k % 3) - 1) * 0.08))
        r, g, b = colorsys.hls_to_rgb(h, l, max(0.4, s))
        colors[jid] = "#{:02x}{:02x}{:02x}".format(int(r * 255), int(g * 255), int(b * 255))

assert len(set(colors.values())) == len(colors), "collision survived"
for j in reg["journals"]:
    j["color"] = colors[j["id"]]
(ROOT / "data/journals.json").write_text(json.dumps(reg, ensure_ascii=False, indent=1))
print(f"wrote {len(colors)} colours, all distinct")
