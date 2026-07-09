#!/usr/bin/env python3
"""Philosopheed harvester.

Pulls publication metadata for every journal in data/journals.json from
CrossRef (canonical) and publisher RSS feeds (freshness/abstract enrichment),
normalises it, tags topics, detects special issues, and writes the static
JSON artifacts the dashboard reads:

  data/shards/{journal}/{year}.json   full records incl. abstracts
  data/years/{year}.json              compact rows for browse + search
  data/recent.json                    compact rows, last 12 months
  data/stats.json                     per-journal counts for the UI
  data/.harvest_state.json            checkpoint state (gitignored? no — committed,
                                      so Actions runs are incremental)

Usage:
  harvest.py --backfill [id ...]   full history per journal tier (resumable;
                                   skips journals already marked backfilled)
  harvest.py --update  [id ...]    incremental: CrossRef delta + RSS merge
  harvest.py --rebuild             regenerate derived files from shards only
  harvest.py --force               with --backfill: redo even if marked done

Design notes: checkpoint after every journal; every HTTP call has a timeout;
polite CrossRef usage (mailto UA, throttle, backoff on 429/5xx).
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

try:
    import feedparser
except ImportError:  # RSS enrichment becomes a no-op
    feedparser = None

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SHARDS = DATA / "shards"
YEARS = DATA / "years"
STATE_FILE = DATA / ".harvest_state.json"

MAILTO = "mintlabjhu@gmail.com"
API = "https://api.crossref.org/works"
THROTTLE = 0.15  # s between CrossRef requests
RECENT_DAYS = 365
UPDATE_OVERLAP_DAYS = 14  # re-query window to catch late/updated metadata

SELECT = ("DOI,title,subtitle,author,abstract,volume,issue,page,"
          "issued,published-print,published-online")

# Front-matter / non-article noise that CrossRef still types as journal-article.
NOISE_TITLE = re.compile(
    r"^(issue information|editorial board|front matter|back matter|"
    r"books? received|index to volume|volume information|contents|"
    r"cover image|front cover|back cover|ofc|ifc|obc|ibc|"
    r"list of referees|referees|thanks to (our )?referees|manuscript reviewers|"
    r"from the editors?\b|notes on contributors|announcements?\b|"
    r"reviews? of\b|book reviews?|review essays?|critical notices?|"
    r"erratum|corrigendum|correction to[:\s]|retraction( notice)?[:\s]?)",
    re.I,
)

# Citation-style book-review titles ("… .New York: Oxford University Press…",
# "… Pp. 224. $35.00") — reviews deposited with the reviewed book's citation
# as the title (Chicago 2010s era, some others).
REVIEW_CITE = re.compile(
    r"\.\s?[A-Z][\w. ]+:\s?[\w&,. ]*(Press|Publish|Books|Blackwell|Routledge|"
    r"Wiley|Springer|Clarendon|Bloomsbury|Palgrave)\b"
    r"|\bPp\.\s?[ivxl\d]|\bpp\.\s?[ivxl\d]+\.|ISBN[\s:]|\$\d+\.\d{2}|£\d+(\.\d{2})?",
)

# ---------------------------------------------------------------- topics ----

TOPICS = {
    "ethics": r"ethic(s|al|ist)?|moral(ity|ly|ism)?|\bblame(worthy|worthiness)?\b|praise|responsib|obligat|\bduty\b|\bduties\b|virtue|vice\b|consequentialis|deontolog|utilitarian|metaethic|normativ|wrong(doing|ness)|supererogat|well-?being|welfare|\bharm\b|\bconsent\b",
    "political": r"politic|justice|democra|liberal|\brights\b|equalit|egalitarian|libertarian|republican|legitimacy|public reason|oppression|exploitation|\bstate\b.*authority|civic|citizenship|migration|punishment",
    "epistemology": r"epistem|knowledge|\bbelief\b|justification|eviden(ce|tial)|testimony|disagreement|s[ck]eptic|credence|understanding\b|rationalit|\bluck\b|internalis|externalis|reliabilis",
    "metaphysics": r"metaphysic|ontolog|causation|\bcausal|modalit|possible worlds?|essence|grounding|persistence|personal identity|free will|\btime\b|mereolog|dispositions?|truthmak|composition|realism\b|nominalis",
    "mind": r"\bmind(s|ed)?\b|mental|consciousness|phenomenal|qualia|percept(ion|ual)|cogniti|intentionalit|representation|emotion|\bmemory\b|attention|embodied|introspect|panpsych",
    "language": r"\blanguage\b|linguistic|\bmeaning\b|semantic|pragmatic|reference\b|assertion|implicature|\bnames\b|predicat|metaphor|\bslurs?\b|indexical|proposition",
    "logic": r"\blogic(al|s)?\b|\bproofs?\b|paradox|inference|validity|quantifi|set.theor|mathematic|\btruth\b.*theor|incompleteness|arithmetic",
    "philsci": r"\bscien(ce|ces|tific)\b|explanation|laws of nature|confirmation|induction|probabilit|\bmodels?\b|mechanis|biolog|physics|quantum|evolution|species|natural kinds?|experiment|causal inference|clinical|medicine",
    "tech-ai": r"artificial intelligence|machine learning|algorithm|\brobots?\b|technolog|digital|internet|\bonline\b|\bdata\b|privacy|automation|large language models?|\bLLMs?\b|neural network|computation|software|cyber|social media|deepfake",
    "aesthetics": r"aesthetic|\bart\b|artwork|beauty|fiction|imagination|\bmusic\b|literature|pictorial|depiction|\bgenre\b|creativity",
    "history": r"\bkant(ian)?\b|\bhume(an)?\b|aristot|\bplato\b|platonic|descartes|cartesian|spinoza|leibniz|hegel|nietzsche|wittgenstein|\blocke(an)?\b|berkeley|\bmill\b|frege|husserl|heidegger|aquinas|ancient|medieval|early modern|stoic|confuci",
    "religion": r"\bgod\b|theis[mt]|atheis|divine|religio|\bfaith\b|miracle|afterlife|\bprayer\b|\bsoul\b",
    "action": r"\baction\b|agency|intention(al)?\b|practical reason|deliberation|weakness of will|akrasia|\bagents?\b.*rational|decision.theor",
    "social": r"social ontolog|collective|group agen|feminis|gender|\brace\b|racism|disabilit|ideolog|social construct|solidarity|\btrust\b|institutions",
    "metaphil": r"metaphilosoph|philosophical method|intuitions?\b|experimental philosophy|conceptual (engineering|analysis)|thought experiment",
}
TOPIC_RE = {k: re.compile(v, re.I) for k, v in TOPICS.items()}

# journal prior: specialist-mode membership implies a topic
MODE_TOPIC = {"ethics": "ethics", "philsci": "philsci", "philtech": "tech-ai"}

SI_MARK = re.compile(r"special issue|topical collection|book symposium|symposium on", re.I)
SI_LABEL = re.compile(
    r"(?:introduction[:\s].*?)?(?:special issue|topical collection|symposium)"
    r"(?:\s+on\b|\s*[:—-])\s*[\"“']?(.+?)[\"”']?\s*$", re.I)


def tag_topics(title: str, abstract: str, journal: dict) -> list[str]:
    text_t = title or ""
    text_a = (abstract or "")[:4000]
    topics = set()
    for key, rx in TOPIC_RE.items():
        if rx.search(text_t):
            topics.add(key)
        elif text_a and len(rx.findall(text_a)) >= 2:
            topics.add(key)
    for mode in journal.get("modes", []):
        if mode in MODE_TOPIC:
            topics.add(MODE_TOPIC[mode])
    return sorted(topics)


# ------------------------------------------------------------- normalise ----

JATS_TAG = re.compile(r"<[^>]+>")
WS = re.compile(r"\s+")


def clean_text(s: str | None) -> str:
    if not s:
        return ""
    s = html.unescape(JATS_TAG.sub(" ", s))
    s = unicodedata.normalize("NFC", s)
    return WS.sub(" ", s).strip()


def strip_abstract(s: str | None) -> str:
    s = clean_text(s)
    # drop leading boilerplate like "Abstract" / "Summary"
    return re.sub(r"^(abstract|summary)[\s:.]+", "", s, flags=re.I)


def pick_date(item: dict) -> str | None:
    """Earliest full-ish date among online/print/issued; pad to YYYY-MM-DD."""
    cands = []
    for key in ("published-online", "published-print", "issued"):
        parts = (item.get(key) or {}).get("date-parts", [[None]])[0]
        if parts and parts[0]:
            y = parts[0]
            m = parts[1] if len(parts) > 1 and parts[1] else 1
            d = parts[2] if len(parts) > 2 and parts[2] else 1
            try:
                cands.append(date(y, m, d))
            except ValueError:
                continue
    return min(cands).isoformat() if cands else None


def norm_authors(item: dict) -> list[str]:
    out = []
    for a in item.get("author", []) or []:
        if a.get("family"):
            out.append(f"{a.get('given', '')} {a['family']}".strip())
        elif a.get("name"):
            out.append(a["name"])
    return out


def normalise(item: dict, journal: dict) -> dict | None:
    doi = item.get("DOI")
    title = clean_text((item.get("title") or [""])[0])
    # Empty primary title + subtitle-only = how some publishers (e.g. Chicago)
    # deposit book reviews; drop rather than fabricate ": Book Title" articles.
    # Chicago deposits book reviews as ":<i>Book Title</i>" — a leading colon
    # in the raw title marks review front-matter, not an article.
    if (not doi or not title or title.startswith(":")
            or NOISE_TITLE.match(title) or REVIEW_CITE.search(title)):
        return None
    if item.get("subtitle"):
        sub = clean_text(item["subtitle"][0])
        if sub and sub.lower() not in title.lower():
            title = f"{title}: {sub}"
    pub = pick_date(item)
    if not pub:
        return None
    abstract = strip_abstract(item.get("abstract"))
    return {
        "doi": doi.lower(),
        "title": title,
        "authors": norm_authors(item),
        "journal": journal["id"],
        "published": pub,
        "volume": item.get("volume"),
        "issue": item.get("issue"),
        "pages": item.get("page"),
        "abstract": abstract,
        "topics": tag_topics(title, abstract, journal),
        "si": None,  # filled by special-issue pass
        "url": f"https://doi.org/{doi}",
    }


# ------------------------------------------------------------- crossref -----

session = requests.Session()
session.headers["User-Agent"] = f"philosopheed/1.0 (https://github.com/theo-my/philosopheed; mailto:{MAILTO})"


def cr_get(params: dict, retries: int = 5) -> dict:
    for attempt in range(retries):
        try:
            r = session.get(API, params=params, timeout=90)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"{r.status_code}")
            r.raise_for_status()
            return r.json()["message"]
        except Exception as e:  # noqa: BLE001
            wait = 2 ** attempt * 2
            log(f"    crossref retry {attempt + 1}/{retries} in {wait}s ({e})")
            time.sleep(wait)
    raise RuntimeError("CrossRef unreachable after retries")


def harvest_crossref(journal: dict, from_date: str) -> list[dict]:
    issn_filter = ",".join(f"issn:{i}" for i in journal["issn"])
    flt = f"{issn_filter},type:journal-article,from-pub-date:{from_date}"
    cursor = "*"
    papers, seen, total = [], set(), None
    while True:
        msg = cr_get({"filter": flt, "rows": 1000, "cursor": cursor,
                      "select": SELECT, "mailto": MAILTO})
        if total is None:
            total = msg.get("total-results", 0)
        items = msg.get("items", [])
        if not items:
            break
        for it in items:
            rec = normalise(it, journal)
            if rec and rec["doi"] not in seen:
                seen.add(rec["doi"])
                papers.append(rec)
        cursor = msg.get("next-cursor")
        log(f"    {journal['id']}: {len(seen)} kept / {total} raw")
        if not cursor:
            break
        time.sleep(THROTTLE)
    return papers


# ------------------------------------------------------------------ rss -----

DOI_IN_URL = re.compile(r"10\.\d{4,9}/[^\s?#]+")


def harvest_rss(journal: dict) -> dict[str, str]:
    """Return {doi: abstract} found in the journal's RSS feed."""
    if not feedparser or not journal.get("rss"):
        return {}
    try:
        r = session.get(journal["rss"], timeout=60)
        r.raise_for_status()
        feed = feedparser.parse(r.content)
    except Exception as e:  # noqa: BLE001
        log(f"    rss failed for {journal['id']}: {e}")
        return {}
    out = {}
    for e in feed.entries:
        doi = None
        for cand in (e.get("prism_doi"), e.get("dc_identifier"), e.get("id"), e.get("link")):
            if cand:
                m = DOI_IN_URL.search(str(cand))
                if m:
                    doi = m.group(0).rstrip(".").lower()
                    break
        if not doi:
            continue
        summary = strip_abstract(e.get("summary") or e.get("description") or "")
        if summary and len(summary) > 80:  # skip "Volume x, Issue y" stubs
            out[doi] = summary
    return out


# --------------------------------------------------------- special issues ---

def detect_special_issues(papers: list[dict]) -> None:
    """Group by (volume, issue); mark groups whose member titles flag an SI."""
    groups: dict[tuple, list[dict]] = {}
    for p in papers:
        if p["volume"] and p["issue"]:
            groups.setdefault((p["volume"], p["issue"]), []).append(p)
    intro_label = re.compile(r"^introduction\s*[—:–-]\s*(.{4,120}?)\s*$", re.I)
    for (vol, iss), members in groups.items():
        if len(members) < 3:
            continue
        label = None
        marks = [p for p in members if SI_MARK.search(p["title"])]
        if marks:
            for p in marks:
                m = SI_LABEL.search(p["title"])
                if m and 3 < len(m.group(1)) < 120:
                    label = m.group(1).strip().rstrip(".")
                    break
            label = label or f"Special issue (vol. {vol}, no. {iss})"
        elif len(members) >= 4:
            # secondary heuristic: an "Introduction—Theme" paper names the issue
            for p in members:
                m = intro_label.match(p["title"])
                if m:
                    label = m.group(1).strip().rstrip(".")
                    break
        if not label:
            continue
        for p in members:
            p["si"] = label


# ---------------------------------------------------------------- storage ---

def shard_path(jid: str, year: int) -> Path:
    return SHARDS / jid / f"{year}.json"


def load_shard(jid: str, year: int) -> dict[str, dict]:
    p = shard_path(jid, year)
    if p.exists():
        return {r["doi"]: r for r in json.loads(p.read_text())}
    return {}


def write_shard(jid: str, year: int, recs: dict[str, dict]) -> None:
    p = shard_path(jid, year)
    p.parent.mkdir(parents=True, exist_ok=True)
    rows = sorted(recs.values(), key=lambda r: r["published"], reverse=True)
    p.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")))


def merge_papers(jid: str, papers: list[dict]) -> int:
    """Merge into per-year shards; keep existing abstracts if new ones are empty."""
    by_year: dict[int, list[dict]] = {}
    for p in papers:
        by_year.setdefault(int(p["published"][:4]), []).append(p)
    added = 0
    for year, recs in sorted(by_year.items()):
        shard = load_shard(jid, year)
        for r in recs:
            old = shard.get(r["doi"])
            if old:
                if not r["abstract"] and old.get("abstract"):
                    r["abstract"] = old["abstract"]
                    r["topics"] = sorted(set(r["topics"]) | set(old.get("topics", [])))
                if not r["si"]:
                    r["si"] = old.get("si")
            else:
                added += 1
            shard[r["doi"]] = r
        # re-run SI detection over the whole shard so late-arriving papers join groups
        rows = list(shard.values())
        detect_special_issues(rows)
        write_shard(jid, year, {r["doi"]: r for r in rows})
    return added


COMPACT_KEYS = ("doi", "title", "authors", "journal", "published", "volume",
                "issue", "topics", "si")


def compact(r: dict) -> dict:
    c = {k: r[k] for k in COMPACT_KEYS if r.get(k)}
    c["ha"] = bool(r.get("abstract"))
    return c


def rebuild_derived(registry: dict) -> None:
    """Regenerate years/*.json, recent.json and stats.json from shards."""
    YEARS.mkdir(parents=True, exist_ok=True)
    cutoff = (date.today() - timedelta(days=RECENT_DAYS)).isoformat()
    per_year: dict[int, list[dict]] = {}
    recent: list[dict] = []
    stats: dict[str, dict] = {}
    for j in registry["journals"]:
        jdir = SHARDS / j["id"]
        if not jdir.exists():
            continue
        st = {"total": 0, "years": {}, "last12mo": 0}
        for f in sorted(jdir.glob("*.json")):
            rows = json.loads(f.read_text())
            year = int(f.stem)
            st["total"] += len(rows)
            st["years"][year] = len(rows)
            for r in rows:
                c = compact(r)
                per_year.setdefault(year, []).append(c)
                if r["published"] >= cutoff:
                    recent.append(c)
                    st["last12mo"] += 1
        stats[j["id"]] = st
    for year, rows in per_year.items():
        rows.sort(key=lambda r: r["published"], reverse=True)
        (YEARS / f"{year}.json").write_text(
            json.dumps(rows, ensure_ascii=False, separators=(",", ":")))
    recent.sort(key=lambda r: r["published"], reverse=True)
    (DATA / "recent.json").write_text(
        json.dumps(recent, ensure_ascii=False, separators=(",", ":")))
    (DATA / "stats.json").write_text(json.dumps({
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "papers": sum(s["total"] for s in stats.values()),
        "recent": len(recent),
        "journals": stats,
        "years": sorted(per_year),
    }, ensure_ascii=False))
    log(f"derived: {len(recent)} recent, {sum(s['total'] for s in stats.values())} total, "
        f"{len(per_year)} year files")


# ------------------------------------------------------------------ state ---

def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"journals": {}}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=1))


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ------------------------------------------------------------------- main ---

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", nargs="*", metavar="ID")
    ap.add_argument("--update", nargs="*", metavar="ID")
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    registry = json.loads((DATA / "journals.json").read_text())
    by_id = {j["id"]: j for j in registry["journals"]}
    state = load_state()

    def pick(ids):
        if ids:
            missing = [i for i in ids if i not in by_id]
            if missing:
                ap.error(f"unknown journal id(s): {missing}")
            return [by_id[i] for i in ids]
        return registry["journals"]

    touched = False

    if args.backfill is not None:
        for j in pick(args.backfill):
            js = state["journals"].setdefault(j["id"], {})
            if js.get("backfilled") and not args.force:
                log(f"skip {j['id']} (already backfilled)")
                continue
            log(f"BACKFILL {j['id']} from {j['backfill_from']}")
            t0 = time.time()
            papers = harvest_crossref(j, j["backfill_from"])
            added = merge_papers(j["id"], papers)
            js.update(backfilled=True, last_update=date.today().isoformat(),
                      last_count=len(papers))
            save_state(state)
            touched = True
            log(f"  done {j['id']}: {len(papers)} papers ({added} new) "
                f"in {time.time() - t0:.0f}s")

    if args.update is not None:
        for j in pick(args.update):
            if not j.get("active", True) and state["journals"].get(j["id"], {}).get("backfilled"):
                continue  # ceased journal, nothing new to fetch
            js = state["journals"].setdefault(j["id"], {})
            since = js.get("last_update", j["backfill_from"])
            since = (date.fromisoformat(since) - timedelta(days=UPDATE_OVERLAP_DAYS)).isoformat()
            log(f"UPDATE {j['id']} since {since}")
            papers = harvest_crossref(j, since)
            rss_abs = harvest_rss(j)
            for p in papers:
                if not p["abstract"] and p["doi"] in rss_abs:
                    p["abstract"] = rss_abs[p["doi"]]
                    p["topics"] = tag_topics(p["title"], p["abstract"], j)
            added = merge_papers(j["id"], papers)
            # RSS can also patch abstracts CrossRef never had, for papers
            # already in recent shards
            if rss_abs:
                fetched = {p["doi"] for p in papers}
                leftover = {d: a for d, a in rss_abs.items() if d not in fetched}
                patched = 0
                thisyear = date.today().year
                for year in (thisyear, thisyear - 1):
                    if not leftover:
                        break
                    shard = load_shard(j["id"], year)
                    dirty = False
                    for doi in list(leftover):
                        r = shard.get(doi)
                        if r is not None:
                            if not r.get("abstract"):
                                r["abstract"] = leftover[doi]
                                r["topics"] = tag_topics(r["title"], r["abstract"], j)
                                dirty = True
                                patched += 1
                            del leftover[doi]
                    if dirty:
                        write_shard(j["id"], year, shard)
                if patched:
                    log(f"    rss patched {patched} abstracts")
            js["last_update"] = date.today().isoformat()
            save_state(state)
            touched = True
            log(f"  done {j['id']}: {len(papers)} fetched, {added} new")

    if args.rebuild or touched:
        rebuild_derived(registry)

    if not (args.rebuild or args.backfill is not None or args.update is not None):
        ap.print_help()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
