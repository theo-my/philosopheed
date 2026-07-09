# Philosopheed 📜

**A dashboard of recent publications in philosophy's top journals.**
Live at: https://theo-my.github.io/philosopheed/

Philosopheed tracks ~66 journals — the 29 of the **de Bruin (2023) *Synthese* meta-ranking**
(plus the journals from the **Leiter 2022 poll** it omits) and curated specialist sets for
**ethics & political philosophy**, **philosophy of science**, and **philosophy of technology & AI**.
Deep archive back to **2000** for the 26 top-ranked journals; five-year windows for the rest.
~57,000 papers at launch, growing daily.

## Features

- **By venue** — journals as ranked cards (de Bruin PCA by default; one click switches to the
  Leiter 2022 poll ordering), with per-journal volume sparklines and expandable paper lists.
- **By topic** — the same papers pivoted into 16 heuristic topic groups.
- **Specialist modes** — ethics, phil science, phil tech/AI journal sets with field rankings.
- **3D view** — journals as floating panes on a rank-ordered shelf (Three.js): orbit, zoom,
  click a pane to fly to it and browse; re-ranking animates the re-shelving.
- **Special issues** — grouped and badged where detectable from issue metadata / title patterns.
- **Search** — client-side over titles and authors in the current mode and window.
- **Time controls** — 30 d / 90 d / 12 mo / 5 yr / single-year scrubber back to 2000.
- Abstracts appear on click (where publishers deposit them); every paper links to its DOI.

## Architecture

Everything is static — GitHub Pages serves it, the browser does the work.

```
GitHub Actions (daily, 06:00 UTC)                       the site (this repo, Pages)
  scripts/harvest.py --update                             index.html + js/ + css/ + vendor/
    ├─ CrossRef REST API by ISSN (canonical)              reads:
    ├─ publisher RSS feeds (freshness + abstracts)          data/journals.json  registry+rankings
    ├─ topic tagging, special-issue detection               data/recent.json    last 12 months
    └─ writes data/, commits                                data/years/Y.json   browse+search rows
                                                            data/shards/J/Y.json  full records
                                                            data/stats.json     per-journal counts
```

No server, no API keys, no build step. Vendored libraries: Three.js 0.170, MiniSearch 7.

## Adding or deepening a journal

1. Add an entry to `data/journals.json` (id, name, publisher, ISSNs, optional RSS URL,
   `modes`, `tier`, `backfill_from`, rankings). `scripts/resolve_issns.py` shows how to
   find the CrossRef-indexed ISSN.
2. Run `python3 scripts/harvest.py --backfill <id>` and commit `data/`.
3. Done — the daily Action keeps it fresh. To deepen an existing journal's archive,
   lower its `backfill_from`, then `--backfill <id> --force`.

## Local development

```bash
python3 -m http.server 8791     # serve the repo root
python3 scripts/harvest.py --update            # incremental harvest
python3 scripts/harvest.py --rebuild           # regenerate derived JSON from shards
scripts/progress.sh                             # backfill progress
node scripts/screenshot.mjs /tmp/shots          # headless verification (needs playwright)
```

## Data notes & caveats

- **Rankings**: de Bruin, B. (2023), "Ranking philosophy journals: a meta-ranking and a new
  survey ranking," *Synthese* 202:188 ([doi](https://doi.org/10.1007/s11229-023-04342-9)) —
  PCA variant canonical, arithmetic-mean kept as data. Leiter 2022 "Best 'general' philosophy
  journals" poll; Leiter 2022 moral/political specialist poll for the ethics mode. Provenance
  and full transcriptions: `research/`.
- **Abstract coverage ≈ 55%** of recent papers — Springer/Cambridge deposit abstracts to
  CrossRef; Wiley/OUP/Chicago often don't (RSS patches some). Missing abstracts show honestly.
- **Topics are keyword heuristics** — multiple tags allowed, imperfect by design.
- **Special-issue detection is best-effort** — issue metadata + title patterns; continuous-
  publishing journals (e.g. Springer's) rarely expose issue structure.
- **Front matter and book reviews are filtered** by CrossRef type + title patterns; review
  formats vary by publisher and era, so occasional strays survive.
- *Journal of Political Philosophy* ceased 2026-01-01 (kept, marked ceased); its successor
  *Political Philosophy* (OLH) and P&PA's sibling *Free & Equal* are tracked.

---

Built by Curly (Freshie), Theo Murray's agent, as a Fable 5 one-shot · spec in `SPEC.md`.
