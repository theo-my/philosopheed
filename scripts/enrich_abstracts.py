#!/usr/bin/env python3
"""Philosopheed abstract-enrichment pipeline.

Fills abstracts that CrossRef never had (Chicago/Elsevier/T&F/OLH/PES-MUSE/
Brill/Duke deposit them rarely) from an external source. Source evaluation
(2026-07, see scratch report) found OpenAlex's `abstract_inverted_index`
clearly best: batchable (50 DOIs/request via `filter=doi:a|b|c`), free,
polite mailto pool, and it recovers abstracts CrossRef doesn't have (pulled
from publisher HTML/PDF text-mining, Unpaywall, etc.) at roughly a
40-47% hit rate on papers CrossRef is missing. Semantic Scholar's keyless
API is both far more rate-limited (429s within a handful of calls) AND,
on the same missing-abstract sample, returned essentially the SAME gap
(0/9 papers found had an abstract) -- for this journal set S2's abstract
field is mostly sourced from the same places CrossRef already failed to
get one from. PhilPapers' API is free but its terms explicitly restrict
REDISTRIBUTING data / republishing abstracts publicly without contacting
them first -- not evaluated for bulk pulling here; see report for the
terms-of-use note (this script does not implement a PhilPapers source).

Usage:
  # Dry run (default) -- writes a JSON report + resumable checkpoint, never
  # touches data/:
  python3 scripts/enrich_abstracts.py --publishers "Oxford University Press,Wiley,University of Chicago Press" \\
      --year-min 2025 --limit 300 --out-dir /path/to/scratch/enrich-pilot

  # Apply (IMPLEMENTED BUT NOT TO BE RUN WITHOUT SIGN-OFF) -- merges found
  # abstracts into shards using the exact same clean_text/tag_topics/
  # write_shard conventions as harvest.py, then regenerates years/*.json,
  # recent.json, stats.json the same way `harvest.py --rebuild` does:
  python3 scripts/enrich_abstracts.py --apply --yes-modify-data \\
      --report /path/to/scratch/enrich-pilot/report.json

Design notes (matches harvest.py conventions):
  - every HTTP call has an explicit timeout + retry/backoff on 429/5xx
  - checkpointed after every batch (results.jsonl is append-only; a
    checkpoint.json tracks which DOIs are already resolved so a killed
    run is resumable with the same command)
  - abstract text is reconstructed from OpenAlex's inverted index, then
    run through harvest.strip_abstract() (imported directly from
    harvest.py) so cleaning/whitespace/JATS-tag handling is byte-for-byte
    consistent with how CrossRef- and RSS-sourced abstracts are stored
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import harvest  # noqa: E402  -- reuse clean_text/strip_abstract/tag_topics + shard I/O

ROOT = harvest.ROOT
DATA = harvest.DATA
SHARDS = harvest.SHARDS

OPENALEX_WORKS = "https://api.openalex.org/works"
MAILTO_DEFAULT = "mintlabjhu@gmail.com"
BATCH_SIZE = 50  # OpenAlex practical cap for `filter=doi:a|b|c|...`

session = requests.Session()
session.headers["User-Agent"] = (
    f"philosopheed-enrich/1.0 (https://github.com/theo-my/philosopheed; "
    f"mailto:{MAILTO_DEFAULT})"
)


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ------------------------------------------------------------- discovery ----

def load_registry() -> dict:
    return json.loads((DATA / "journals.json").read_text())


def select_journals(registry: dict, journal_ids: list[str] | None,
                     publishers: list[str] | None) -> list[dict]:
    js = registry["journals"]
    if journal_ids:
        want = {j.lower() for j in journal_ids}
        js = [j for j in js if j["id"].lower() in want]
    if publishers:
        want_pub = {p.strip().lower() for p in publishers}
        js = [j for j in js if (j.get("publisher") or "").strip().lower() in want_pub]
    return js


def scan_missing(journals: list[dict], year_min: int | None,
                  year_max: int | None) -> list[dict]:
    """Every shard record with no abstract, across the selected journals."""
    out = []
    for j in journals:
        jdir = SHARDS / j["id"]
        if not jdir.exists():
            continue
        for f in sorted(jdir.glob("*.json")):
            try:
                year = int(f.stem)
            except ValueError:
                continue
            if year_min and year < year_min:
                continue
            if year_max and year > year_max:
                continue
            rows = json.loads(f.read_text())
            for r in rows:
                if not r.get("abstract"):
                    out.append({
                        "doi": r["doi"],
                        "journal": j["id"],
                        "publisher": j.get("publisher"),
                        "year": year,
                        "title": r["title"],
                        "published": r["published"],
                    })
    return out


# --------------------------------------------------------------- openalex ---

def reconstruct_abstract(inv_index: dict | None) -> str:
    """OpenAlex stores abstracts as {word: [positions]} (ToS-driven, see
    report). Rebuild plain text, then let harvest.strip_abstract() do the
    same whitespace/boilerplate cleanup CrossRef/RSS abstracts get."""
    if not inv_index:
        return ""
    positions: dict[int, str] = {}
    maxpos = 0
    for word, idxs in inv_index.items():
        for i in idxs:
            positions[i] = word
            if i > maxpos:
                maxpos = i
    words = [positions.get(i, "") for i in range(maxpos + 1)]
    return harvest.strip_abstract(" ".join(w for w in words if w))


# Pilot (300-record, OUP/Wiley/Chicago, 2025-2026) found real garbage in
# OpenAlex's abstract field for a handful of DOIs -- not reconstruction bugs,
# the *source* record itself: a mis-scraped citation string standing in for
# the abstract ("N L Engel-Hawbecker; Worried about Weight?, Analysis, ,
# anag042, https://doi.org/..."), a literal "No abstract available." deposit,
# and CoI/disclosure boilerplate ("The author has nothing to report.") that
# got filed under abstract instead of its own metadata field. None of these
# are article abstracts and none should be written into shards.
BOILERPLATE_ABSTRACT = re.compile(
    r"^(no abstract (is )?available\.?|abstract not available\.?|"
    r"the author(s)? (has|have) nothing to (disclose|report)\.?|"
    r"no (competing|conflict(s)? of) interests? (were |was )?"
    r"(declared|reported|to disclose)\.?)$",
    re.I,
)
DOI_URL_IN_TEXT = re.compile(r"https?://doi\.org/10\.\d{4,9}/\S+")

# Also found in the pilot, concentrated in Wiley book-symposium/reply/
# discussion-note content (ejp, bioethics, ppr, nous, jap, ratio): OpenAlex's
# abstract_inverted_index sometimes reconstructs to the FULL ARTICLE TEXT
# (3,000-5,100 words seen), not an abstract -- and the tail is often visibly
# garbled ("...to up a formulations of idealizing views need to by..."),
# consistent with sparse/overlapping position coverage from PDF text-mining
# deep into a long document. Real philosophy abstracts in this corpus top
# out well under 400 words, so anything longer is treated as suspect
# full-text, not merely "quite long."
MAX_ABSTRACT_WORDS = 400


def classify_abstract(text: str) -> str:
    """Return 'ok', or a rejection reason: 'empty', 'too_short',
    'boilerplate', 'citation_string', or 'too_long' (likely full text)."""
    if not text:
        return "empty"
    n = len(text.split())
    if n < 12:
        return "too_short"
    if BOILERPLATE_ABSTRACT.match(text.strip()):
        return "boilerplate"
    if DOI_URL_IN_TEXT.search(text):
        return "citation_string"
    if n > MAX_ABSTRACT_WORDS:
        return "too_long"
    return "ok"


def looks_like_real_abstract(text: str) -> bool:
    return classify_abstract(text) == "ok"


def openalex_get(params: dict, timeout: float, retries: int = 5) -> dict:
    for attempt in range(retries):
        try:
            r = session.get(OPENALEX_WORKS, params=params, timeout=timeout)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"{r.status_code}")
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            wait = 2 ** attempt * 2
            log(f"    openalex retry {attempt + 1}/{retries} in {wait}s ({e})")
            time.sleep(wait)
    raise RuntimeError("OpenAlex unreachable after retries")


def query_openalex_batch(dois: list[str], mailto: str, timeout: float) -> dict[str, dict]:
    filt = "doi:" + "|".join(dois)
    data = openalex_get({
        "filter": filt,
        "per-page": len(dois),
        "mailto": mailto,
        "select": "doi,title,abstract_inverted_index",
    }, timeout=timeout)
    by_doi = {}
    for w in data.get("results", []):
        doi = (w.get("doi") or "").replace("https://doi.org/", "").lower()
        if doi:
            by_doi[doi] = w
    return by_doi


# ------------------------------------------------------------- checkpoint ---

def load_done_dois(results_path: Path) -> set[str]:
    done = set()
    if results_path.exists():
        for line in results_path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                done.add(json.loads(line)["doi"])
            except Exception:  # noqa: BLE001
                continue
    return done


def append_results(results_path: Path, rows: list[dict]) -> None:
    with results_path.open("a") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


# --------------------------------------------------------------- dry run ----

def run_dry(args: argparse.Namespace) -> None:
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    results_path = out_dir / "results.jsonl"
    checkpoint_path = out_dir / "checkpoint.json"
    report_path = out_dir / "report.json"

    if args.restart:
        results_path.write_text("")
        if checkpoint_path.exists():
            checkpoint_path.write_text("{}")

    registry = load_registry()
    journal_ids = args.journals.split(",") if args.journals else None
    publishers = args.publishers.split(",") if args.publishers else None
    journals = select_journals(registry, journal_ids, publishers)
    if not journals:
        log("no journals matched --journals/--publishers filters")
        return
    log(f"scanning {len(journals)} journal(s): {', '.join(j['id'] for j in journals)}")

    candidates = scan_missing(journals, args.year_min, args.year_max)
    log(f"found {len(candidates)} missing-abstract records in scope")

    if args.limit and len(candidates) > args.limit:
        rng = random.Random(args.seed)
        rng.shuffle(candidates)
        candidates = candidates[:args.limit]
        log(f"sampled down to --limit {args.limit} (seed={args.seed})")

    done = load_done_dois(results_path)
    todo = [c for c in candidates if c["doi"] not in done]
    log(f"{len(done)} already checkpointed, {len(todo)} to query this run")

    t0 = time.time()
    n_batches = 0
    for i in range(0, len(todo), args.batch_size):
        batch = todo[i:i + args.batch_size]
        dois = [c["doi"] for c in batch]
        try:
            found = query_openalex_batch(dois, args.mailto, args.timeout)
        except RuntimeError as e:
            log(f"    batch {i // args.batch_size} FAILED, checkpoint preserved: {e}")
            break
        rows = []
        for c in batch:
            w = found.get(c["doi"])
            raw_abstract = reconstruct_abstract(w.get("abstract_inverted_index")) if w else ""
            verdict = classify_abstract(raw_abstract)
            rejected = verdict not in ("ok", "empty")
            abstract = raw_abstract if verdict == "ok" else ""
            rows.append({
                **c,
                "openalex_found": w is not None,
                "abstract": abstract,
                "has_abstract": bool(abstract),
                "rejected_garbage": rejected,
                "rejection_reason": verdict if rejected else None,
                "rejected_text": raw_abstract if rejected else None,
            })
        append_results(results_path, rows)
        checkpoint_path.write_text(json.dumps({
            "last_batch_end": i + len(batch),
            "total_todo": len(todo),
            "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }, indent=1))
        n_batches += 1
        log(f"    batch {n_batches}: {len(batch)} queried, "
            f"{sum(r['has_abstract'] for r in rows)} with abstract "
            f"({i + len(batch)}/{len(todo)} done)")
        if i + args.batch_size < len(todo):
            time.sleep(args.sleep)

    elapsed = time.time() - t0
    write_report(results_path, report_path, journals, elapsed, len(todo))


def write_report(results_path: Path, report_path: Path, journals: list[dict],
                  elapsed: float, n_queried_this_run: int) -> None:
    rows = [json.loads(l) for l in results_path.read_text().splitlines() if l.strip()]
    by_pub_total: Counter = Counter()
    by_pub_hit: Counter = Counter()
    by_journal_total: Counter = Counter()
    by_journal_hit: Counter = Counter()
    for r in rows:
        by_pub_total[r.get("publisher") or "?"] += 1
        by_journal_total[r["journal"]] += 1
        if r["has_abstract"]:
            by_pub_hit[r.get("publisher") or "?"] += 1
            by_journal_hit[r["journal"]] += 1

    hits = sum(r["has_abstract"] for r in rows)
    rejected = [r for r in rows if r.get("rejected_garbage")]
    rejected_by_reason: Counter = Counter(r["rejection_reason"] for r in rejected)
    samples = [r for r in rows if r["has_abstract"]][:5]

    report = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "openalex",
        "n_records": len(rows),
        "n_with_abstract": hits,
        "hit_rate": round(hits / len(rows), 4) if rows else None,
        "n_rejected_garbage": len(rejected),
        "rejected_by_reason": dict(rejected_by_reason),
        "rejected_garbage_examples": [
            {"journal": r["journal"], "doi": r["doi"], "reason": r["rejection_reason"],
             "rejected_text": (r["rejected_text"][:200] + "…"
                                if len(r["rejected_text"]) > 200 else r["rejected_text"])}
            for r in rejected[:12]
        ],
        "seconds_this_run": round(elapsed, 1),
        "records_queried_this_run": n_queried_this_run,
        "seconds_per_record_this_run": (
            round(elapsed / n_queried_this_run, 3) if n_queried_this_run else None
        ),
        "by_publisher": {
            p: {"total": by_pub_total[p], "hit": by_pub_hit[p],
                "hit_rate": round(by_pub_hit[p] / by_pub_total[p], 4)}
            for p in by_pub_total
        },
        "by_journal": {
            j: {"total": by_journal_total[j], "hit": by_journal_hit[j],
                "hit_rate": round(by_journal_hit[j] / by_journal_total[j], 4)}
            for j in by_journal_total
        },
        "samples": [
            {"journal": s["journal"], "title": s["title"],
             "abstract_excerpt": " ".join(s["abstract"].split()[:40])}
            for s in samples
        ],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=1))
    log(f"report written to {report_path}")
    log(f"hit rate: {hits}/{len(rows)} = {report['hit_rate']}")


# ----------------------------------------------------------------- apply ----
# Implemented for completeness (per spec) but MUST NOT be invoked without
# explicit owner sign-off -- it is the only code path in this file that
# writes under data/. Guarded behind two flags so it can't fire by accident.

def run_apply(args: argparse.Namespace) -> None:
    if not args.yes_modify_data:
        log("refusing to --apply without --yes-modify-data (safety guard)")
        sys.exit(2)

    report_dir = Path(args.report).parent if Path(args.report).is_file() else Path(args.report)
    results_path = report_dir / "results.jsonl" if (report_dir / "results.jsonl").exists() \
        else Path(args.report)
    rows = [json.loads(l) for l in results_path.read_text().splitlines() if l.strip()]
    to_apply = [r for r in rows if r.get("has_abstract")]
    log(f"applying {len(to_apply)} recovered abstracts from {results_path}")

    registry = load_registry()
    by_id = {j["id"]: j for j in registry["journals"]}

    by_journal_year: dict[tuple[str, int], list[dict]] = {}
    for r in to_apply:
        by_journal_year.setdefault((r["journal"], r["year"]), []).append(r)

    patched = 0
    for (jid, year), items in sorted(by_journal_year.items()):
        journal = by_id.get(jid)
        if not journal:
            log(f"    skip unknown journal id {jid}")
            continue
        shard = harvest.load_shard(jid, year)
        dirty = False
        for r in items:
            rec = shard.get(r["doi"])
            if rec is None:
                log(f"    skip {r['doi']}: not found in {jid}/{year} shard "
                    f"(shard may have changed since dry run)")
                continue
            if rec.get("abstract"):
                continue  # don't clobber an abstract that arrived some other way meanwhile
            rec["abstract"] = r["abstract"]
            rec["topics"] = harvest.tag_topics(rec["title"], rec["abstract"], journal)
            shard[r["doi"]] = rec
            dirty = True
            patched += 1
        if dirty:
            harvest.write_shard(jid, year, shard)
            log(f"    wrote {jid}/{year}.json ({sum(1 for i in items if shard.get(i['doi']))} touched)")

    log(f"patched {patched} records; regenerating derived files (years/, recent.json, stats.json)")
    harvest.rebuild_derived(registry)
    log("apply complete")


# ------------------------------------------------------------------- main ---

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--journals", help="comma-separated journal ids (default: all)")
    ap.add_argument("--publishers", help="comma-separated publisher names, exact match "
                                          "against journals.json (default: all)")
    ap.add_argument("--year-min", type=int)
    ap.add_argument("--year-max", type=int)
    ap.add_argument("--limit", type=int, help="cap total candidates (random sample) -- for piloting")
    ap.add_argument("--seed", type=int, default=42, help="sample seed for --limit (default 42)")
    ap.add_argument("--source", default="openalex", choices=["openalex"],
                     help="external abstract source (only openalex implemented -- "
                          "see module docstring for why S2/PhilPapers weren't wired up)")
    ap.add_argument("--mailto", default=MAILTO_DEFAULT)
    ap.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    ap.add_argument("--sleep", type=float, default=0.25, help="seconds between batches")
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--out-dir", help="dry-run output dir (report.json/results.jsonl/checkpoint.json)")
    ap.add_argument("--restart", action="store_true", help="ignore existing checkpoint, start clean")
    ap.add_argument("--dry-run", action="store_true", help="explicit no-op flag; this is the default mode")
    ap.add_argument("--apply", action="store_true",
                     help="merge a prior dry-run's results into data/shards + regenerate derived "
                          "files. Requires --yes-modify-data. NOT to be run without owner sign-off.")
    ap.add_argument("--yes-modify-data", action="store_true",
                     help="required alongside --apply as a safety interlock")
    ap.add_argument("--report", help="[--apply mode] path to a dry-run out-dir or its results.jsonl")
    args = ap.parse_args()

    if args.apply:
        if not args.report:
            ap.error("--apply requires --report <dry-run out-dir or results.jsonl>")
        run_apply(args)
        return 0

    if not args.out_dir:
        ap.error("--out-dir is required in dry-run mode")
    run_dry(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
