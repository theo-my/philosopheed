# Philosopheed — Specification

*A client-side dashboard of recent (and archived) publications in philosophy's top journals.*
*Repo: `theo-my/philosopheed` · Hosted on GitHub Pages · Spec v1, 2026-07-09 (Curly-4e5c)*

---

## 1. Concept

Philosopheed answers "what's being published in philosophy right now?" at a glance, ranked by journal quality. Default view: the 29 journals of the **de Bruin (2023) meta-ranking** (*Synthese* 202:188, DOI 10.1007/s11229-023-04342-9), ordered by its PCA meta-rank, showing the last 12 months. One click re-ranks by the **Leiter 2022 poll**. Specialist modes (Ethics, Philosophy of Science, Philosophy of Technology/AI) swap in field-specific journal sets. A 3D mode renders journals as navigable floating panes in space. Deep archive back to 2000 for the top-20 general journals.

**Design principles (agreed):**
- Title + authors are the primary data; everything else degrades gracefully when missing.
- Abstracts appear **only on interaction** (click-to-expand / popover), never in the browse surface.
- All rendering, filtering, ranking, and search happen client-side. No server, no keys in the browser.
- Extensible: adding a journal or deepening its archive is a one-line config change + one script run.

## 2. Architecture

```
GitHub Actions (daily cron, 06:00 UTC)
  └─ harvest.py  — for each journal in journals.json:
       1. RSS feed (freshest items, best abstracts where publishers provide them)
       2. CrossRef REST API by ISSN (canonical: DOI, authors, dates, volume/issue, backfill)
       3. merge + dedupe by DOI → normalise → write/update JSON shards
  └─ commit & push → GitHub Pages redeploys automatically

Static site (root of repo, .nojekyll, no build step)
  ├─ index.html + app JS (vanilla) — 2D dashboard
  ├─ 3D mode — Three.js (vendored, not CDN)
  ├─ search — MiniSearch (vendored), per-year lazy-loaded indexes
  └─ data/
       ├─ journals.json          — the registry (§4) + both ranking tables
       ├─ recent.json            — last 12 months, all journals, titles/authors only (~2-4 MB)
       ├─ shards/{journal}/{year}.json   — full records incl. abstracts, lazy-loaded
       └─ index/{year}.json      — prebuilt search-index shards, lazy-loaded
```

- **One-time backfill** (`harvest.py --backfill`) runs on the Shack or via manually-triggered Action; the daily cron only fetches deltas (CrossRef `from-index-date` + RSS).
- **Adding a journal later**: add one entry to `journals.json`, run `harvest.py --backfill <id>`, commit. Changing `backfill_from` and re-running deepens an existing journal's archive. (Requested: easy future backfill — this is the mechanism.)
- Est. corpus at launch: **~55-70k papers** (Synthese and Phil Studies dominate). Browse views load only `recent.json`; archive/search shards load on demand.

## 3. Data model

Paper record: `doi, title, authors[], journal_id, published (print + online dates), volume, issue, pages, abstract?, topics[], special_issue?, url` — `url` is the DOI link (`https://doi.org/...`), always present and clickable regardless of paywall.

Journal registry entry: `id, name, publisher, issn[], rss_url?, rankings {debruin_pca, debruin_am, leiter2022, leiter_mp2022}, modes[] (general/ethics/philsci/philtech), tier (deep|standard), backfill_from, active (false for ceased journals), notes`.

**Topics** (agreed: heuristic + PhilPapers, no LLM): rule-based keyword matching on title+abstract against a fixed taxonomy — *ethics & moral philosophy; political philosophy; epistemology; metaphysics; mind & cognitive science; language; logic; philosophy of science; technology & AI; aesthetics; history of philosophy; religion; action & agency; social & feminist philosophy; metaphilosophy* — plus the journal's own subject as a prior for specialist venues. PhilPapers category enrichment is a v2 pass (needs API key + bulk-rate care). Papers can carry multiple topics; unmatched papers fall into "general/unclassified" honestly.

**Special issues** (best-effort, agreed): group papers sharing journal+volume+issue; badge the group as a special issue when (a) the publisher RSS/issue metadata carries an issue title, or (b) the issue contains an editorial/introduction whose title matches "special issue / topical collection / symposium on X" patterns. Where undetectable, papers simply appear ungrouped — no fabricated groupings.

## 4. Journal registry (~64 journals) — FOR SIGN-OFF

**Tier legend**: `deep` = backfill from 2000-01-01 · `std` = last 5 years. Ranks: dB = de Bruin PCA / L = Leiter 2022 odds poll / MP = Leiter moral-political 2022.

### General (default view) — de Bruin 29 + 5 Leiter-only

| Journal | dB | L | Tier |
|---|---|---|---|
| Noûs | 1 | 2 | deep |
| Philosophical Studies | 2 | 7 | deep |
| Philosophy & Phenomenological Research | 3 | 3 | deep |
| Synthese | 4 | 11 | deep |
| Mind | 5 | 4 | deep |
| Australasian Journal of Philosophy | 6 | 6 | deep |
| Philosophical Review | 7 | 1 | deep |
| Journal of Philosophy | 8 | 5 | deep |
| Pacific Philosophical Quarterly | 9 | 16= | deep |
| Erkenntnis | 10 | 14= | deep |
| Philosophical Quarterly | 11 | 9 | deep |
| European Journal of Philosophy | 12 | 16= | deep |
| Canadian Journal of Philosophy | 13 | 12= | deep |
| Philosophical Issues | 14 | 24 | deep |
| Inquiry | 15 | 20 | deep |
| Journal of the APA | 16 | 19 | deep* |
| Philosophers' Imprint | 17 | 8 | deep |
| Analysis | 18 | 10 | deep |
| American Philosophical Quarterly | 19 | 18 | deep |
| Ratio | 20 | 25= | deep |
| Metaphilosophy | 21 | — | std |
| Southern Journal of Philosophy | 22 | — | std |
| Res Philosophica | 23 | — | std |
| Dialectica | 24 | — | std |
| Philosophia | 25 | — | std |
| Thought | 26 | 23 | std |
| Philosophy | 27 | — | std |
| International Philosophical Quarterly | 28 | — | std |
| Review of Metaphysics | 29 | — | std |
| Proceedings of the Aristotelian Society | — | 12= | deep |
| Ergo | — | 14= | deep* |
| Philosophical Perspectives | — | 21 | std |
| The Monist | — | 22 | std |
| Philosophical Topics | — | 25= | std |

*\* Journal of the APA launched 2015 — "deep" is moot; harvest takes whatever exists.*

Under the de Bruin ranking, the 5 Leiter-only journals appear in an "unranked in de Bruin" band at the bottom (and vice versa for Leiter's view of dB-only journals). The toggle re-sorts using each table's own ranks — no synthetic cross-fill.

### Ethics mode (adds to general core) — Leiter MP 2022 Groups 1-3 + field consensus

Ethics (MP 1) · Philosophy & Public Affairs (MP 2) · Journal of Moral Philosophy (MP 4) · Utilitas (MP 5) · Economics & Philosophy (MP 6) · Journal of Ethics and Social Philosophy (MP 7) · Politics, Philosophy & Economics (MP 8) · Ethical Theory and Moral Practice · The Journal of Ethics · Journal of Applied Philosophy · **Political Philosophy** (OLH — successor to J. Political Philosophy, which ceased 2026-01-01) · *[borderline, see §6]* Bioethics · Journal of Medical Ethics — all `std`.
**Journal of Political Philosophy** (MP 3) included as `active: false` with 5-year archive — its recent record still matters even though it ceased.

### Philosophy of Science mode

BJPS · Philosophy of Science · Synthese† · Studies in History and Philosophy of Science · European Journal for Philosophy of Science · Erkenntnis† · Biology & Philosophy · Journal for General Philosophy of Science · *[borderline]* Foundations of Physics · Perspectives on Science — all `std` (†already deep via general list).
Publisher moves handled in config: BJPS→Chicago (2021), Phil of Science→Cambridge (2023).

### Philosophy of Technology / AI mode

Philosophy & Technology · Minds and Machines · Ethics and Information Technology · Science and Engineering Ethics · AI & Society · AI and Ethics · Techné · Digital Society · *[borderline]* Big Data & Society — all `std`.

*(ISSNs, RSS URLs, volumes, and inclusion rationale for every journal: `research/debruin-2023.md`, `research/leiter-rankings.md`, `research/specialist-journals.md`. 30+ RSS feed URLs live-verified or pattern-verified; Cambridge/Brill/PDCnet/MIT feeds unavailable → those journals ride on CrossRef alone, which is fine since CrossRef is the canonical source anyway.)*

## 5. UI

**2D dashboard (default)**
- **By venue**: ranked journal rows/cards (rank badge, sparkline of recent volume), each expanding to its recent papers; special-issue groups nested with an issue-title header and badge.
- **By topic**: same papers pivoted into topic columns/sections from the heuristic tagger.
- **Ranking toggle**: de Bruin (default, PCA) ⇄ Leiter 2022 — animated re-sort. Small "ⓘ" explains each ranking with citation + link.
- **Specialist mode switcher**: General / Ethics / Phil Science / Phil Tech & AI. Specialist modes rank by their own ordering (MP poll for ethics; curated tiers elsewhere) and note that basis.
- **Time controls**: window selector (30d / 90d / 12m default / 5y / all) + year scrubber for the deep archive; older shards lazy-load with a subtle loading state.
- **Paper interaction**: click → expansion/popover with abstract (or "no abstract available"), full author list, venue/volume/issue, topic chips, and the DOI link out.
- **Search**: client-side across titles/authors (+ abstracts where held), scoped by current mode/window.
- Wide layout (1200-1400px), conventional labels, works in light theme; fast first paint (recent.json only).

**3D mode** (toggle in header): Three.js scene — each journal a floating pane in space, arranged as a curved rank-ordered shelf (best journals nearest/highest); pane size ∝ recent volume, papers as rows on the pane face. Orbit/pan/zoom navigation, click a pane to fly to it and browse its papers, click a paper for the same detail popover. Ranking toggle re-shelves with animation. Archive years recede along the depth axis. Graceful fallback note if WebGL unavailable.

## 6. Decisions (signed off by Theo, 2026-07-09)

1. **Borderline journals**: ALL kept — Bioethics, J. Medical Ethics, Big Data & Society (tagged "applied/adjacent", filterable), and Free & Equal added alongside P&PA.
2. **Specialist flagships deep-tiered**: Ethics, P&PA, BJPS, Philosophy of Science backfilled to 2000.
3. **de Bruin PCA is canonical** (AM kept in data as secondary).
4. **Leiter July-2022 odds poll (25 journals)** is the toggle's canonical list.
5. **Leiter top 15 also deep-tiered** — adds Ergo and Proceedings of the Aristotelian Society to the deep set (the other 13 were already deep via de Bruin top 20). Deep set = 26 journals.

*(Ergo launched 2013; JAPA 2015 — "deep" takes whatever exists.)*

## 7. Build plan (the one-shot)

1. Scaffold repo (site skeleton, `.nojekyll`, vendored Three.js + MiniSearch, README)
2. `journals.json` registry generated from the research files (+ your §6 answers)
3. `harvest.py` (CrossRef + RSS, merge/dedupe, sharding, topic tagger, special-issue detector) + tests on 2-3 journals
4. Full backfill run on the Shack (est. 30-60 min) → data committed
5. 2D dashboard → search → 3D mode
6. GitHub Actions workflow (daily 06:00 UTC harvest + commit) + Pages enablement
7. Verify live site, log everything

Post-launch (v2 candidates): PhilPapers category/abstract enrichment, trend charts (topic volume over time), per-journal RSS gap-filling for Cambridge/Brill.
