/* Philosopheed — dashboard app (no build step, ES modules). */
import MiniSearch from "../vendor/minisearch.min.js";

// ------------------------------------------------------------------ state --
const S = {
  registry: null,        // journals.json
  stats: null,           // stats.json
  recent: null,          // recent.json rows
  yearCache: new Map(),  // year -> rows
  mode: "general",
  view: "venue",         // venue | topic
  ranking: "db",         // db | leiter (general mode only; irrelevant when rankMode is "favorites")
  rankMode: "normal",    // normal | favorites — "Favourites" is a ranking option layered on top of db/leiter/field
  win: "365",            // '30'|'90'|'365'|'1826'|'year'
  year: 2020,
  query: "",
  rows: [],              // rows for current window (all modes)
  mini: null,            // MiniSearch instance over rows
  three: null,           // threeview module (lazy)
};

// -------------------------------------------------------------- prefs (§8) --
// ALL persisted display prefs live under one localStorage key, read once at
// boot and written on every change. Favourites (+ their opt-in flag) are only
// ever included in the stored object when the user has ticked "Save
// favourites on this device" — unticking drops them from the very next write.
// No cookies: nothing here is ever sent to a server.
const PREF_KEY = "philosopheed:prefs";
const DEFAULT_PREFS = {
  serif: false,
  feedWidth: "default",   // narrow | default | wide | max
  zoom: 100,
  cardW: 420,
  cardH: 430,
  cardStyle: "book",       // book | basic
};
const LEGACY_KEYS = { serif: "phd-serif", wide: "phd-wide", zoom: "phd-zoom", cardw: "phd-cardw", cardh: "phd-cardh" };

function migrateLegacyPrefs() {
  const hasLegacy = Object.values(LEGACY_KEYS).some((k) => localStorage.getItem(k) !== null);
  if (!hasLegacy) return null;
  const p = { ...DEFAULT_PREFS };
  if (localStorage.getItem(LEGACY_KEYS.serif) !== null) p.serif = localStorage.getItem(LEGACY_KEYS.serif) === "1";
  if (localStorage.getItem(LEGACY_KEYS.wide) !== null) p.feedWidth = localStorage.getItem(LEGACY_KEYS.wide) === "1" ? "max" : "default";
  if (localStorage.getItem(LEGACY_KEYS.zoom) !== null) p.zoom = Number(localStorage.getItem(LEGACY_KEYS.zoom)) || 100;
  if (localStorage.getItem(LEGACY_KEYS.cardw) !== null) p.cardW = Number(localStorage.getItem(LEGACY_KEYS.cardw)) || 420;
  if (localStorage.getItem(LEGACY_KEYS.cardh) !== null) p.cardH = Number(localStorage.getItem(LEGACY_KEYS.cardh)) || 430;
  Object.values(LEGACY_KEYS).forEach((k) => localStorage.removeItem(k));
  return p;
}

function loadPrefs() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(PREF_KEY) || "null"); } catch { stored = null; }
  if (!stored) stored = migrateLegacyPrefs();
  const p = { ...DEFAULT_PREFS, ...(stored || {}) };
  p.favoritesEnabled = !!(stored && stored.favoritesEnabled);
  p.favorites = (stored && p.favoritesEnabled && Array.isArray(stored.favorites)) ? stored.favorites.slice() : [];
  return p;
}

const Prefs = loadPrefs();

function savePrefs() {
  const toStore = {
    serif: Prefs.serif, feedWidth: Prefs.feedWidth, zoom: Prefs.zoom,
    cardW: Prefs.cardW, cardH: Prefs.cardH, cardStyle: Prefs.cardStyle,
  };
  if (Prefs.favoritesEnabled) {
    toStore.favoritesEnabled = true;
    toStore.favorites = Prefs.favorites;
  }
  localStorage.setItem(PREF_KEY, JSON.stringify(toStore));
}

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// --------------------------------------------------------- inline markup --
// Paper titles/abstracts come from CrossRef/RSS and are UNTRUSTED: publishers
// sometimes embed inline markup (e.g. Ergo: "<i>Daodejing</i>"), and some
// records carry the same markup HTML-entity-escaped ("&lt;i&gt;...&lt;/i&gt;").
// sanitizeInline() decodes entities, keeps ONLY a small whitelist of
// attribute-free inline tags as real markup, and escapes everything else back
// to literal display text — including unrelated escaped angle-bracket
// notation some philosophy abstracts use for propositions (e.g. an abstract
// containing "&lt;Snow is white&gt;"), which is not a tag and must render as
// literal "<Snow is white>", not be swallowed or misinterpreted.
const INLINE_TAG_RE = /^<\/?(em|i|b|strong|sub|sup)>/i;
function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
export function sanitizeInline(raw) {
  const s = decodeEntities(raw);
  let out = "", i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "<") {
      const m = s.slice(i).match(INLINE_TAG_RE);
      if (m) { out += m[0].toLowerCase(); i += m[0].length; continue; }
      out += "&lt;"; i++; continue;
    }
    if (ch === ">") { out += "&gt;"; i++; continue; }
    if (ch === "&") { out += "&amp;"; i++; continue; }
    if (ch === '"') { out += "&quot;"; i++; continue; }
    if (ch === "'") { out += "&#39;"; i++; continue; }
    out += ch; i++;
  }
  return out;
}
// Plain-text form (all whitelisted tags removed, non-tag angle brackets kept
// literally) — used for search indexing and for canvas text in the 3D view,
// where HTML can't be rendered at all.
export function stripInlineToText(raw) {
  const s = decodeEntities(raw);
  let out = "", i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "<") {
      const m = s.slice(i).match(INLINE_TAG_RE);
      if (m) { i += m[0].length; continue; }
    }
    out += ch; i++;
  }
  return out;
}

const TOPIC_LABELS = {
  "blame-resp": "Blame & moral responsibility",
  ethics: "Ethics & moral philosophy", political: "Political philosophy",
  epistemology: "Epistemology", metaphysics: "Metaphysics",
  mind: "Mind & cognitive science", language: "Language",
  logic: "Logic & mathematics", philsci: "Philosophy of science",
  "tech-ai": "Technology & AI", aesthetics: "Aesthetics",
  history: "History of philosophy", religion: "Philosophy of religion",
  action: "Action & agency", social: "Social & feminist philosophy",
  metaphil: "Metaphilosophy", unclassified: "Unclassified",
};

// ------------------------------------------------------------------- data --
async function fetchJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function loadCore() {
  [S.registry, S.stats, S.recent] = await Promise.all([
    fetchJSON("data/journals.json"),
    fetchJSON("data/stats.json"),
    fetchJSON("data/recent.json"),
  ]);
}

async function loadYear(y) {
  if (!S.yearCache.has(y)) {
    try { S.yearCache.set(y, await fetchJSON(`data/years/${y}.json`)); }
    catch { S.yearCache.set(y, []); }
  }
  return S.yearCache.get(y);
}

const ARCHIVE_START_YEAR = 2000; // deep-tier journals are backfilled to here (data/years/2000.json…)

// Fetches (on-demand, cached in S.yearCache) and stitches a set of year files,
// showing the same "Loading N archive years…" status the 5-yr window already
// uses. Shared by the 5-yr and "Since 2000" windows.
async function stitchYears(years, cut) {
  setStatus(`Loading ${years.length} archive year${years.length === 1 ? "" : "s"}…`);
  const all = await Promise.all(years.map(loadYear));
  let rows = all.flat();
  if (cut) rows = rows.filter((r) => r.published >= cut);
  return rows.sort((a, b) => b.published.localeCompare(a.published));
}

async function rowsForWindow() {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (S.win === "year") {
    return loadYear(S.year);
  }
  if (S.win === "all") {
    // full archive: only deep-tier journals are backfilled this far — see
    // the "coverage note" shown above the window control for this case.
    const years = [];
    for (let y = ARCHIVE_START_YEAR; y <= today.getFullYear(); y++) years.push(y);
    return stitchYears(years);
  }
  const days = Number(S.win);
  if (days <= 365) {
    const cut = iso(new Date(today - days * 864e5));
    return S.recent.filter((r) => r.published >= cut);
  }
  // 5 years: stitch year files (newest first)
  const cut = iso(new Date(today - days * 864e5));
  const y0 = Number(cut.slice(0, 4));
  const years = [];
  for (let y = y0; y <= today.getFullYear(); y++) years.push(y);
  return stitchYears(years, cut);
}

// --------------------------------------------------------------- journals --
const journalById = (id) => S.registry.journals.find((j) => j.id === id);
const modeJournals = () => S.registry.journals.filter((j) => S.mode === "general"
  ? j.modes.includes("general") : j.modes.includes(S.mode));

function defaultRankOf(j) {
  if (S.mode !== "general") return j.mode_rank?.[S.mode] ?? Infinity;
  const r = S.ranking === "db" ? j.rankings?.db_pca : j.rankings?.leiter;
  return r ?? Infinity;
}

// Favourites ranking: favourites first (in the order they were favourited),
// then the remaining journals in the mode's default ranking. One global
// favourites list is shared across all four modes — journals absent from the
// current mode simply don't render, but keep their place in the list.
let favMap = new Map();
function computeFavMap() {
  const js = modeJournals().slice().sort((a, b) => defaultRankOf(a) - defaultRankOf(b));
  const favSet = new Set(Prefs.favorites);
  const favInMode = Prefs.favorites.filter((id) => js.some((j) => j.id === id));
  const rest = js.filter((j) => !favSet.has(j.id));
  const map = new Map();
  [...favInMode, ...rest.map((j) => j.id)].forEach((id, i) => map.set(id, i + 1));
  return map;
}
function rankOf(j) {
  if (S.rankMode === "favorites") return favMap.get(j.id) ?? Infinity;
  return defaultRankOf(j);
}
function rankedJournals() {
  if (S.rankMode === "favorites") favMap = computeFavMap();
  return modeJournals().sort((a, b) => rankOf(a) - rankOf(b));
}

// ---------------------------------------------------------------- widgets --
function sparkline(jid) {
  const ys = S.stats.journals[jid]?.years || {};
  const now = new Date().getFullYear();
  const span = [];
  for (let y = now - 11; y <= now; y++) span.push([y, ys[y] || 0]);
  const max = Math.max(1, ...span.map(([, c]) => c));
  const w = 6, gap = 2, H = 26;
  const svg = span.map(([y, c], i) => {
    const h = Math.max(c ? 2 : 0.5, (c / max) * H);
    return `<rect x="${i * (w + gap)}" y="${H - h}" width="${w}" height="${h}" rx="1.5">` +
           `<title>${y}: ${c} papers</title></rect>`;
  }).join("");
  return `<svg class="spark" width="${span.length * (w + gap)}" height="${H}" ` +
         `role="img" aria-label="papers per year">${svg}</svg>`;
}

function rankBadge(j) {
  const r = rankOf(j);
  if (r === Infinity) return `<span class="rankbadge unranked" title="Not ranked in the selected ranking">—</span>`;
  return `<span class="rankbadge">${r}</span>`;
}

// per-journal cover colour (from registry), with readable text on top
export function textOn(hex) {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? "#0b0b0b" : "#ffffff";
}
function applyColor(node, j) {
  if (j.color) {
    node.style.setProperty("--jc", j.color);
    node.style.setProperty("--jc-text", textOn(j.color));
  }
}

function paperRow(r, showJournal) {
  const j = journalById(r.journal);
  const authors = (r.authors || []).join(", ");
  const jc = j?.color;
  const jn = showJournal
    ? `<span class="pj"${jc ? ` style="color:${jc}"` : ""}>${jc ? "● " : ""}${esc(j?.name || r.journal)}</span> · `
    : "";
  const date = r.published;
  const b = el("button", "paper");
  const si = r.si ? `<span class="sichip" title="${esc(r.si)}">SI</span>` : "";
  b.innerHTML = `<div class="ptitle">${si}${sanitizeInline(r.title)}</div>
    <div class="pmeta">${esc(authors) || "<i>—</i>"} · ${jn}${date}</div>`;
  b.addEventListener("click", () => openPaper(r));
  return b;
}

// -------------------------------------------------------- volume boundaries --
// Consecutive papers in a single-journal list that cross a volume boundary
// get a visual separator (double rule + small label). Not used in the
// mixed-journal topic view. Label format is inferred per journal from the
// window's own data: if any year in the list carries 2+ distinct volumes,
// numbering is per-year (label "'26 · Vol. 3"); otherwise it's cumulative
// over the journal's history (label "Vol. 135"). Rows with no volume data
// never trigger a separator.
export function inferVolumeFormat(papers) {
  const yearVols = new Map();
  for (const r of papers) {
    if (!r.volume) continue;
    const y = r.published.slice(0, 4);
    if (!yearVols.has(y)) yearVols.set(y, new Set());
    yearVols.get(y).add(r.volume);
  }
  for (const set of yearVols.values()) if (set.size >= 2) return "year-vol";
  return "cumulative";
}
export function volumeLabelText(row, fmt) {
  return fmt === "year-vol" ? `’${row.published.slice(2, 4)} · Vol. ${row.volume}` : `Vol. ${row.volume}`;
}
function volumeSeparatorEl(label) {
  return el("div", "volsep", `<span class="volsep-label">${esc(label)}</span>`);
}
// Appends papers[from, to) to container, inserting a volume separator
// wherever the volume changes from the *true* previous item in the full
// list (so separators stay correct across "show more" continuations).
function appendPapers(container, allPapers, showJournal, from = 0, to = allPapers.length) {
  if (!allPapers.length) return;
  const fmt = inferVolumeFormat(allPapers);
  for (let i = from; i < to; i++) {
    const r = allPapers[i];
    if (i > 0) {
      const prev = allPapers[i - 1];
      if (r.volume && prev.volume && r.volume !== prev.volume) {
        container.append(volumeSeparatorEl(volumeLabelText(r, fmt)));
      }
    }
    container.append(paperRow(r, showJournal));
  }
}

// ------------------------------------------------------------ venue view --
const PREVIEW = 200;   // rows per scrollable card (6 visible, rest on scroll)

function renderVenue(rows) {
  const byJ = new Map();
  rows.forEach((r) => {
    if (!byJ.has(r.journal)) byJ.set(r.journal, []);
    byJ.get(r.journal).push(r);
  });
  const root = el("div", "jgrid");
  for (const j of rankedJournals()) {
    const papers = byJ.get(j.id) || [];
    const card = el("div", "jcard");
    applyColor(card, j);
    const ceased = j.active === false ? `<span class="jceased">ceased</span>` : "";
    const head = el("div", "jhead");
    head.innerHTML = `${rankBadge(j)}
      <div><div class="jname">${esc(j.name)} ${ceased}</div>
      <div class="jmeta">${esc(j.publisher)}</div></div>
      <div class="jright">
      <button class="viewall" type="button" title="View the full list for this journal">View all</button>
      <span class="jcount"><b>${papers.length}</b> in window</span>
      ${sparkline(j.id)}</div>`;
    head.querySelector(".viewall").addEventListener("click", (e) => {
      e.stopPropagation();
      openJournalModal(j, papers);
    });
    const body = el("div", "jbody");
    appendPapers(body, papers, false, 0, Math.min(PREVIEW, papers.length));
    if (!papers.length) body.append(el("div", "status", "No papers in this window."));
    card.append(head, body);
    if (papers.length > PREVIEW) {
      const more = el("button", "showmore", `All ${papers.length} papers`);
      more.addEventListener("click", () => {
        const expanded = card.classList.toggle("expanded");
        body.innerHTML = "";
        if (expanded) {
          fillJournalBody(body, papers);
          more.textContent = "Collapse";
        } else {
          appendPapers(body, papers, false, 0, Math.min(PREVIEW, papers.length));
          more.textContent = `All ${papers.length} papers`;
          card.scrollIntoView({ block: "nearest" });
        }
      });
      body.after(more);
      more.style.margin = "0 15px 12px";
      more.style.width = "calc(100% - 30px)";
    }
    root.append(card);
  }
  return root;
}

// limit: number of non-special-issue rows to show before a "Show all" button,
// or null to render the complete list at once (used by the journal popout,
// which already scrolls internally — see .modal.journal-modal .modal-scroll).
function fillJournalBody(body, papers, limit = 12) {
  if (!papers.length) {
    body.append(el("div", "status", "No papers in this window."));
    return;
  }
  // special issues first, grouped
  const si = new Map();
  const rest = [];
  papers.forEach((r) => (r.si ? (si.has(r.si) ? si.get(r.si) : si.set(r.si, []).get(r.si)).push(r) : rest.push(r)));
  for (const [label, members] of si) {
    const g = el("div", "sigroup");
    g.innerHTML = `<div class="sihead"><span class="sibadge">Special issue</span> ${esc(label)}</div>`;
    members.forEach((r) => g.append(paperRow(r, false)));
    body.append(g);
  }
  if (limit == null) {
    appendPapers(body, rest, false);
    return;
  }
  appendPapers(body, rest, false, 0, Math.min(limit, rest.length));
  if (rest.length > limit) {
    const more = el("button", "showmore", `Show all ${rest.length} papers`);
    more.addEventListener("click", () => {
      more.remove();
      appendPapers(body, rest, false, limit, rest.length);
    });
    body.append(more);
  }
}

// ------------------------------------------------------------ journal popout --
function openJournalModal(j, papers) {
  const modal = $("#journal-modal");
  const n = papers.length;
  modal.innerHTML = `
    <div class="modal-sticky-head">
      <div class="headtext">
        <h3 class="jname">${esc(j.name)}</h3>
        <div class="venueline">${esc(j.publisher)} · ${n.toLocaleString()} paper${n === 1 ? "" : "s"} in the current window</div>
      </div>
      <button class="iconbtn closebtn" id="journal-close">Close</button>
    </div>
    <div class="modal-scroll" id="journal-modal-body"></div>`;
  fillJournalBody($("#journal-modal-body"), papers, null);
  $("#journal-close").addEventListener("click", closeJournalModal);
  $("#journal-overlay").classList.add("show");
}
function closeJournalModal() { $("#journal-overlay").classList.remove("show"); }

// ------------------------------------------------------------ topic view --
// Topic cards mirror the venue cards' book/basic styling and scroll cap
// (respects the card-height slider), but are mixed-journal — so they never
// get volume separators, and stay full-width rather than joining the card
// grid (topic bodies routinely run to hundreds of rows across many venues).
function renderTopic(rows) {
  const byT = new Map();
  rows.forEach((r) => {
    const ts = r.topics && r.topics.length ? r.topics : ["unclassified"];
    ts.forEach((t) => {
      if (!byT.has(t)) byT.set(t, []);
      byT.get(t).push(r);
    });
  });
  const order = Object.keys(TOPIC_LABELS).filter((t) => byT.has(t));
  const root = el("div");
  for (const t of order) {
    const papers = byT.get(t).sort((a, b) => b.published.localeCompare(a.published));
    const card = el("div", "jcard tcard");
    const head = el("div", "jhead");
    head.innerHTML = `<div><div class="jname">${esc(TOPIC_LABELS[t])}</div></div>
      <div class="jright"><span class="jcount"><b>${papers.length}</b> in window</span></div>`;
    const body = el("div", "jbody");
    papers.slice(0, PREVIEW).forEach((r) => body.append(paperRow(r, true)));
    if (!papers.length) body.append(el("div", "status", "No papers in this window."));
    card.append(head, body);
    if (papers.length > PREVIEW) {
      const more = el("button", "showmore", `All ${papers.length} papers`);
      more.addEventListener("click", () => {
        const expanded = card.classList.toggle("expanded");
        body.innerHTML = "";
        if (expanded) {
          papers.forEach((r) => body.append(paperRow(r, true)));
          more.textContent = "Collapse";
        } else {
          papers.slice(0, PREVIEW).forEach((r) => body.append(paperRow(r, true)));
          more.textContent = `All ${papers.length} papers`;
          card.scrollIntoView({ block: "nearest" });
        }
      });
      body.after(more);
      more.style.margin = "0 15px 12px";
      more.style.width = "calc(100% - 30px)";
    }
    root.append(card);
  }
  return root;
}

// ---------------------------------------------------------------- search --
function buildIndex(rows) {
  S.mini = new MiniSearch({
    fields: ["title", "authorsText"],
    storeFields: [],
    idField: "doi",
  });
  S.mini.addAll(rows.map((r) => ({ doi: r.doi, title: stripInlineToText(r.title), authorsText: (r.authors || []).join(" ") })));
}

function renderSearch(rows) {
  const hits = S.mini.search(S.query, { prefix: true, fuzzy: 0.15 }).slice(0, 200);
  const byDoi = new Map(rows.map((r) => [r.doi, r]));
  const root = el("div");
  root.append(el("div", "status", `${hits.length} result${hits.length === 1 ? "" : "s"} for “${esc(S.query)}” in the current mode &amp; window`));
  const box = el("div", "tbody");
  box.style.background = "var(--surface)";
  box.style.borderRadius = "12px";
  hits.forEach((h) => {
    const r = byDoi.get(h.id);
    if (r) box.append(paperRow(r, true));
  });
  root.append(box);
  return root;
}

// ------------------------------------------------------------ paper modal --
async function openPaper(r) {
  const j = journalById(r.journal);
  const modal = $("#paper-modal");
  const vol = [r.volume && `vol. ${r.volume}`, r.issue && `no. ${r.issue}`].filter(Boolean).join(", ");
  const chips = (r.topics || []).map((t) => `<span class="chip">${esc(TOPIC_LABELS[t] || t)}</span>`).join("");
  modal.innerHTML = `
    ${r.si ? `<div class="silabel">Special issue: ${esc(r.si)}</div>` : ""}
    <h3>${sanitizeInline(r.title)}</h3>
    <div class="authors">${esc((r.authors || []).join(", "))}</div>
    <div class="venueline">${esc(j?.name || r.journal)}${vol ? " · " + esc(vol) : ""} · ${r.published}</div>
    <div class="abstract none">Loading abstract…</div>
    <div>${chips}</div>
    <div class="actions">
      <a class="doibtn" href="https://doi.org/${esc(r.doi)}" target="_blank" rel="noopener">View at source ↗</a>
      <button class="iconbtn closebtn" id="paper-close">Close</button>
    </div>`;
  $("#paper-overlay").classList.add("show");
  $("#paper-close").addEventListener("click", closePaper);
  // lazy-load the abstract from the journal-year shard
  const absEl = modal.querySelector(".abstract");
  try {
    const shard = await fetchJSON(`data/shards/${r.journal}/${r.published.slice(0, 4)}.json`);
    const full = shard.find((p) => p.doi === r.doi);
    if (full?.abstract) {
      absEl.innerHTML = sanitizeInline(full.abstract);
      absEl.classList.remove("none");
    } else {
      absEl.textContent = "Abstract not available here — follow the DOI link above.";
    }
  } catch {
    absEl.textContent = "No abstract available for this paper — follow the source link.";
  }
}
function closePaper() { $("#paper-overlay").classList.remove("show"); }

// ------------------------------------------------------------ about modal --
// Renders "Data last updated" in the VIEWER's local timezone (no timeZone
// override — browser default), but still shows the zone name (AEST, BST,
// etc.) via timeZoneName so visitors can tell what "local" means here.
function formatUpdated(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric", month: "long", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(d);
}
function openAbout() {
  const m = S.registry.meta;
  const st = S.stats;
  $("#about-modal").innerHTML = `
    <h3>About Philosopheed</h3>
    <p>This is a work-in-progress dashboard for viewing publications in leading philosophy
    journals. The point is so that you can, at a glance, see what's come out recently in top
    journals.</p>
    <p>Publications are taken daily from CrossRef and publisher RSS feeds. Given the focus on
    the present, journals by default only have a 5-year history, except for top-ranked journals
    which have a history since 2000. Some specialist journals do not show up in the default
    mode.</p>
    <p class="about-updated">Data last updated: ${esc(formatUpdated(st.generated))}</p>
    <h3>Rankings</h3>
    <ul>
      <li><b>de Bruin 2023 (meta-ranking)</b> — A meta-ranking of several journal rankings,
      which is the default for this site. Based on this Synthese article:
      <a href="${esc(m.rankings.db_pca.url)}" target="_blank" rel="noopener">source ↗</a></li>
      <li><b>Leiter 2022 poll</b> — Many philosophers refer to Brian Leiter's blog for a
      popular ranking of philosophy journals, so I include it here, too. Most recent is 2022
      (~1000 participants). Ties share a rank.
      <a href="${esc(m.rankings.leiter.url)}" target="_blank" rel="noopener">source ↗</a></li>
      <li><b>Favourites</b> — Pick your favourites! If you want to keep them for future visits,
      tick "Save favourites on this device" in the Favourites menu — they're stored only in
      your browser, never sent anywhere.</li>
    </ul>
    <h3>Modes</h3>
    <ul>${Object.values(m.modes).map((x) => `<li><b>${esc(x.label)}</b> — ${esc(x.basis)}</li>`).join("")}</ul>
    <h3>By Topic</h3>
    <p>These topics are organised by heuristic keyword matching over titles and abstracts,
    which is imperfect, but hopefully helpful. Since this is a bit of a personal passion
    project, I have 'Blame &amp; moral responsibility' as an option, since it's my area.</p>
    <h3>Caveats</h3>
    <ul>
      <li>Abstract coverage is gappy, as not all publishers share these through CrossRef/RSS
      (which is what I take as permission to share abstracts here).</li>
      <li>Topics are grouped by heuristic keyword tag.</li>
      <li>Where I can, I try to group things by volume and special issue (SI).</li>
      <li>Each paper links to its publisher page (via DOI where possible). Your access may
      vary. Sorry, I am not in the piracy business here!</li>
    </ul>
    <h3>Who made this?</h3>
    <p>This was made by Theo Murray, a PhD student at the Australian National University, who
    also works at Seth Lazar's
    <a href="https://mintresearch.org" target="_blank" rel="noopener">MINT Lab</a>. My
    <a href="https://philpeople.org/profiles/theo-murray" target="_blank" rel="noopener">PhilPeople</a>.
    I made it with the help of Claude Code.</p>
    <p>My work is primarily on blame/moral responsibility, with particular recent interest on
    the epistemology of blaming and the ways that new technology (like LLMs) interact with our
    informal moral practices (like blaming).</p>
    <div class="actions"><button class="iconbtn closebtn" id="about-close">Close</button></div>`;
  $("#about-overlay").classList.add("show");
  $("#about-close").addEventListener("click", () => $("#about-overlay").classList.remove("show"));
}

// ------------------------------------------------------------------ render --
function setStatus(msg) {
  $("#content").innerHTML = "";
  $("#content").append(el("div", "status", msg));
}

async function refresh() {
  setStatus("Loading…");
  const all = await rowsForWindow();
  const ids = new Set(modeJournals().map((j) => j.id));
  S.rows = all.filter((r) => ids.has(r.journal));
  buildIndex(S.rows);
  const c = $("#content");
  c.innerHTML = "";
  if (S.query.length >= 2) c.append(renderSearch(S.rows));
  else if (S.view === "topic") c.append(renderTopic(S.rows));
  else c.append(renderVenue(S.rows));
  const winLabel = S.win === "year" ? `year ${S.year}`
    : { 30: "last 30 days", 90: "last 90 days", 365: "last 12 months", 1826: "last 5 years", all: "since 2000" }[S.win];
  $("#count-note").textContent =
    `${S.rows.length.toLocaleString()} papers · ${ids.size} journals · ${winLabel}`;
  $("#basis-note").textContent = S.mode === "general" ? "" : S.registry.meta.modes[S.mode].basis;
}

// ------------------------------------------------------------------ chrome --
function segButtons(container, items, onPick) {
  container.innerHTML = "";
  items.forEach(({ id, label, on }) => {
    const b = el("button", on ? "on" : "", esc(label));
    b.dataset.id = id;
    b.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      onPick(id);
    });
    container.append(b);
  });
}

function buildRankSeg(container) {
  const applyRanking = (id) => {
    if (id === "favorites") S.rankMode = "favorites";
    else { S.rankMode = "normal"; if (id !== "field") S.ranking = id; }
    buildRankSeg($("#rank-seg"));
    buildRankSeg($("#rank-seg-3d"));
    refresh();
    S.three?.setRanking?.();
  };
  if (S.mode !== "general") {
    segButtons(container, [
      { id: "field", label: "Field ranking", on: S.rankMode !== "favorites" },
      { id: "favorites", label: "Favourites", on: S.rankMode === "favorites" },
    ], applyRanking);
    return;
  }
  segButtons(container, [
    { id: "db", label: "de Bruin 2023", on: S.rankMode !== "favorites" && S.ranking === "db" },
    { id: "leiter", label: "Leiter 2022", on: S.rankMode !== "favorites" && S.ranking === "leiter" },
    { id: "favorites", label: "Favourites", on: S.rankMode === "favorites" },
  ], applyRanking);
}

function initChrome() {
  // "Aim to view" (device-orientation look-around, in threeview.js) is only
  // useful — and its permission prompt only makes sense — on touch devices.
  if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
    document.body.classList.add("touch-device");
  }
  const modes = S.registry.meta.modes;
  segButtons($("#mode-seg"),
    Object.keys(modes).map((id) => ({ id, label: modes[id].label, on: id === S.mode })),
    (id) => { S.mode = id; buildRankSeg($("#rank-seg")); buildRankSeg($("#rank-seg-3d")); refresh(); S.three?.setMode?.(); renderFavoritesList(); });
  buildRankSeg($("#rank-seg"));

  $("#view-seg").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      $("#view-seg").querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      S.view = b.dataset.v;
      refresh();
    }));

  const nowYear = new Date().getFullYear();
  const covNote = $("#cov-note");
  function updateCoverageNote() {
    const beyond5 = S.win === "all" || (S.win === "year" && S.year <= nowYear - 5);
    covNote.textContent = beyond5
      ? "Data beyond 5 years is available for only some journals — the 26 deep-tier titles are backfilled to 2000; the rest cover roughly the last 5 years."
      : "";
    covNote.classList.toggle("show", beyond5);
  }

  $("#win-seg").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      $("#win-seg").querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      S.win = b.dataset.w;
      $("#yearpick").classList.toggle("show", S.win === "year");
      updateCoverageNote();
      refresh();
    }));

  // typed-year control (replaces the old scrubber): Enter, blur or the "Go"
  // button apply the value, clamped to the archive range.
  const yearInput = $("#yearinput");
  const yearApply = $("#yearapply");
  yearInput.max = nowYear;
  function applyYear() {
    let y = Math.round(Number(yearInput.value));
    if (!Number.isFinite(y)) y = S.year;
    y = Math.min(nowYear, Math.max(ARCHIVE_START_YEAR, y));
    yearInput.value = y;
    if (y === S.year && S.win === "year") return;
    S.year = y;
    updateCoverageNote();
    refresh();
  }
  yearInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyYear(); } });
  yearInput.addEventListener("blur", applyYear);
  yearApply.addEventListener("click", applyYear);
  updateCoverageNote();

  let debounce;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { S.query = e.target.value.trim(); refresh(); }, 200);
  });

  const effTheme = () => document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const themeBtn = $("#btn-theme");
  const labelTheme = () => {
    themeBtn.textContent = effTheme() === "dark" ? "Light mode" : "Dark mode";
  };
  themeBtn.addEventListener("click", () => {
    const next = effTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("phd-theme", next);
    labelTheme();
  });
  const saved = localStorage.getItem("phd-theme");
  if (saved) document.documentElement.dataset.theme = saved;
  labelTheme();

  $("#btn-about").addEventListener("click", openAbout);
  $("#paper-overlay").addEventListener("click", (e) => { if (e.target.id === "paper-overlay") closePaper(); });
  $("#about-overlay").addEventListener("click", (e) => { if (e.target.id === "about-overlay") $("#about-overlay").classList.remove("show"); });
  $("#journal-overlay").addEventListener("click", (e) => { if (e.target.id === "journal-overlay") closeJournalModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePaper();
      $("#about-overlay").classList.remove("show");
      closeJournalModal();
      closeDisplayPopover();
      closeFavoritesPopover();
    }
  });

  // ---------------------------------------------------------- display prefs --
  // All of serif / feed width / zoom / card width / card height / card style
  // (and, opt-in only, favourites + its flag) live in the single Prefs
  // object, backed by one localStorage key (§8 — see loadPrefs/savePrefs).
  const body = document.body;
  const root = document.documentElement;

  // serif toggle (default off — see CSS: body.serif restores the academic
  // serif on paper titles / modal titles / abstracts only)
  const serifBtn = $("#btn-serif");
  function setSerif(on, persist = true) {
    Prefs.serif = on;
    body.classList.toggle("serif", on);
    serifBtn.classList.toggle("on", on);
    if (persist) savePrefs();
  }
  serifBtn.addEventListener("click", () => setSerif(!body.classList.contains("serif")));
  setSerif(Prefs.serif, false);

  // feed width (Display popover; replaces the old standalone Wide toggle —
  // "Max" reproduces its full-viewport behaviour)
  function setFeedWidth(id, persist = true) {
    Prefs.feedWidth = id;
    body.dataset.feedwidth = id;
    $("#feedwidth-seg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.fw === id));
    if (persist) savePrefs();
  }
  $("#feedwidth-seg").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => setFeedWidth(b.dataset.fw)));
  setFeedWidth(Prefs.feedWidth, false);

  // card style: Book (default — coloured spine + page-edge hairlines) vs
  // Basic (flat top bar, the old look)
  function setCardStyle(id, persist = true) {
    Prefs.cardStyle = id;
    body.dataset.cardstyle = id;
    $("#cardstyle-seg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.cs === id));
    if (persist) savePrefs();
  }
  $("#cardstyle-seg").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => setCardStyle(b.dataset.cs)));
  setCardStyle(Prefs.cardStyle, false);

  // Display popover: zoom + card width + card height sliders
  const zoomSlider = $("#zoom-slider"), zoomVal = $("#zoom-val");
  const cardwSlider = $("#cardw-slider"), cardwVal = $("#cardw-val");
  const cardhSlider = $("#cardh-slider"), cardhVal = $("#cardh-val");

  function setZoom(pct, persist = true) {
    Prefs.zoom = pct;
    root.style.setProperty("--zoom", pct / 100);
    zoomSlider.value = pct;
    zoomVal.textContent = `${pct}%`;
    if (persist) savePrefs();
  }
  function setCardW(px, persist = true) {
    Prefs.cardW = px;
    root.style.setProperty("--card-min-w", `${px}px`);
    cardwSlider.value = px;
    cardwVal.textContent = `${px}px`;
    if (persist) savePrefs();
  }
  function setCardH(px, persist = true) {
    Prefs.cardH = px;
    root.style.setProperty("--card-max-h", `${px}px`);
    cardhSlider.value = px;
    cardhVal.textContent = `${px}px`;
    if (persist) savePrefs();
  }
  setZoom(Prefs.zoom, false);
  setCardW(Prefs.cardW, false);
  setCardH(Prefs.cardH, false);

  zoomSlider.addEventListener("input", () => setZoom(Number(zoomSlider.value)));
  cardwSlider.addEventListener("input", () => setCardW(Number(cardwSlider.value)));
  cardhSlider.addEventListener("input", () => setCardH(Number(cardhSlider.value)));
  $("#display-reset").addEventListener("click", () => {
    setZoom(100); setCardW(420); setCardH(430); setFeedWidth("default"); setCardStyle("book");
  });

  const displayBtn = $("#btn-display");
  const displayPop = $("#display-popover");
  function closeDisplayPopover() { displayPop.classList.remove("show"); }
  displayBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeFavoritesPopover();
    displayPop.classList.toggle("show");
  });
  document.addEventListener("click", (e) => {
    if (displayPop.classList.contains("show") && !displayPop.contains(e.target) && e.target !== displayBtn) {
      closeDisplayPopover();
    }
  });

  // ------------------------------------------------------------ favourites --
  // ONE global ordered list of journal ids (click order = rank), shared
  // across all four modes. Persistence is opt-in (see savePrefs): unticking
  // "Save favourites on this device" drops it from localStorage immediately.
  const favBtn = $("#btn-favorites");
  const favPop = $("#favorites-popover");
  const favList = $("#fav-list");
  const favPersist = $("#fav-persist");
  favPersist.checked = Prefs.favoritesEnabled;

  function closeFavoritesPopover() { favPop.classList.remove("show"); }

  function toggleFavorite(jid, on) {
    const i = Prefs.favorites.indexOf(jid);
    if (on && i === -1) Prefs.favorites.push(jid);
    else if (!on && i !== -1) Prefs.favorites.splice(i, 1);
    if (Prefs.favoritesEnabled) savePrefs();
    renderFavoritesList();
    if (S.rankMode === "favorites") { refresh(); S.three?.setRanking?.(); }
  }

  function renderFavoritesList() {
    favList.innerHTML = "";
    const js = modeJournals().slice().sort((a, b) => defaultRankOf(a) - defaultRankOf(b));
    if (!js.length) { favList.append(el("div", "fav-empty", "No journals in this mode.")); return; }
    js.forEach((j) => {
      const idx = Prefs.favorites.indexOf(j.id);
      const checked = idx !== -1;
      const row = el("label", `fav-row${checked ? " checked" : ""}`);
      row.innerHTML = `<input type="checkbox" ${checked ? "checked" : ""}>
        <span class="fav-name">${esc(j.name)}</span>
        <span class="fav-rank"></span>`;
      // circled-number glyphs only exist up to 20; fall back to a plain
      // numeral in a circle-styled span beyond that (favourites lists are
      // short in practice, but don't silently drop the count if not).
      const rankSpan = row.querySelector(".fav-rank");
      rankSpan.textContent = checked ? circledNumber(idx + 1) : "";
      row.querySelector("input").addEventListener("change", (e) => toggleFavorite(j.id, e.target.checked));
      favList.append(row);
    });
  }
  const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
  function circledNumber(n) { return n >= 1 && n <= 20 ? CIRCLED[n - 1] : `(${n})`; }

  favBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeDisplayPopover();
    renderFavoritesList();
    favPop.classList.toggle("show");
  });
  document.addEventListener("click", (e) => {
    if (favPop.classList.contains("show") && !favPop.contains(e.target) && e.target !== favBtn) {
      closeFavoritesPopover();
    }
  });
  favPersist.addEventListener("change", () => {
    Prefs.favoritesEnabled = favPersist.checked;
    savePrefs(); // ticking persists now; unticking drops favourites from storage immediately
  });
  $("#fav-clear").addEventListener("click", () => {
    Prefs.favorites = [];
    if (Prefs.favoritesEnabled) savePrefs();
    renderFavoritesList();
    if (S.rankMode === "favorites") { refresh(); S.three?.setRanking?.(); }
  });

  $("#btn-3d").addEventListener("click", async () => {
    if (!S.three) {
      try { S.three = await import("./threeview.js"); }
      catch (err) {
        alert("3D view unavailable (WebGL or module load failed): " + err.message);
        return;
      }
    }
    $("#three-wrap").classList.add("show");
    S.three.enter({
      state: S, rankedJournals, rankOf, journalById,
      openPaper, esc, TOPIC_LABELS, textOn,
      sanitizeInline, stripInlineToText,
      inferVolumeFormat, volumeLabelText,
      getFavorites: () => Prefs.favorites.slice(),
    });
  });
  $("#btn-3d-open-favs").addEventListener("click", () => S.three?.openFavorites?.());
  $("#btn-aim").addEventListener("click", () => S.three?.toggleAim?.());
  $("#btn-exit-3d").addEventListener("click", () => {
    $("#three-wrap").classList.remove("show");
    S.three?.exit?.();
  });
}

// ------------------------------------------------------------------- boot --
(async function boot() {
  try {
    await loadCore();
    initChrome();
    await refresh();
  } catch (err) {
    setStatus(`Failed to load data: ${esc(err.message)}. If you are running locally, serve the directory over HTTP (e.g. python3 -m http.server).`);
  }
})();
