#!/usr/bin/env python3
"""One-off helper: resolve ISSNs for journals not covered by the research files.

Queries the CrossRef journals API by title and prints candidates with
publisher and total DOI counts so a human can confirm the right match.
CrossRef is the harvester's canonical source, so the ISSN CrossRef itself
indexes a journal under is exactly the one we want in the registry.
"""
import json
import sys
import time

import requests

MAILTO = "mintlabjhu@gmail.com"  # polite-pool contact
API = "https://api.crossref.org/journals"

QUERIES = [
    "Metaphilosophy",
    "Southern Journal of Philosophy",
    "Res Philosophica",
    "Dialectica",
    "Philosophia",
    "Thought: A Journal of Philosophy",
    "Philosophy",  # CUP's Philosophy (Royal Institute)
    "International Philosophical Quarterly",
    "Review of Metaphysics",
    "Proceedings of the Aristotelian Society",
    "Ergo an Open Access Journal of Philosophy",
    "Philosophical Perspectives",
    "The Monist",
    "Philosophical Topics",
    "Free & Equal",
    "Political Philosophy",
]


def main():
    session = requests.Session()
    session.headers["User-Agent"] = f"philosopheed-setup (mailto:{MAILTO})"
    out = {}
    for q in QUERIES:
        try:
            r = session.get(API, params={"query": q, "rows": 5}, timeout=60)
            r.raise_for_status()
            items = r.json()["message"]["items"]
        except Exception as e:  # noqa: BLE001 — report and continue
            print(f"!! {q}: {e}")
            continue
        cands = []
        for it in items:
            cands.append({
                "title": it.get("title"),
                "publisher": it.get("publisher"),
                "issn": it.get("ISSN", []),
                "total_dois": it.get("counts", {}).get("total-dois"),
                "current_dois": it.get("counts", {}).get("current-dois"),
            })
        out[q] = cands
        time.sleep(0.5)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    sys.exit(main())
