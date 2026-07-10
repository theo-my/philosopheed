/* Philosopheed — dashboard app (no build step, ES modules). */
import MiniSearch from "../vendor/minisearch.min.js";

// -------------------------------------------------------------- prefs (§8) --
// ALL persisted state lives under ONE localStorage key, read once at boot
// (before S is constructed, so the very first render already reflects it)
// and written on every change (view/mode/ranking/window read live off S;
// everything else off Prefs — see savePrefs() below). No cookies: nothing
// here is ever sent to a server. Corrupt/absent/invalid values fall back to
// the current defaults silently (see the validation at the bottom of
// loadPrefs()) — a returning visitor never sees a broken UI because of a
// stale or hand-edited localStorage value.
const PREF_KEY = "philosopheed:prefs";
const DEFAULT_PREFS = {
  theme: null,             // null = follow system; "light" | "dark" = explicit
  serif: false,
  feedWidth: "default",    // narrow | default | wide | max
  zoom: 100,
  cardW: 420,
  cardH: 430,
  cardStyle: "book",       // book | basic
  hideAuthors: false,      // "Hide authors & dates" display toggle (task 4)
  view: "venue",           // venue | topic | all | favorites
  mode: "general",         // subfield
  ranking: "db",           // db | leiter
  rankMode: "normal",      // normal | favorites
  win: "365",              // '7'|'30'|'90'|'365'|'1826'|'all'|'year'|'custom'
  year: 2020,
  customN: 3,
  customUnit: "weeks",     // days | weeks | months | years
  favorites: [],           // journal ids, in pick/drag order — persisted by default (v9)
};
const LEGACY_KEYS = {
  serif: "phd-serif", wide: "phd-wide", zoom: "phd-zoom",
  cardw: "phd-cardw", cardh: "phd-cardh", theme: "phd-theme",
};

function migrateLegacyPrefs() {
  const hasLegacy = Object.values(LEGACY_KEYS).some((k) => localStorage.getItem(k) !== null);
  if (!hasLegacy) return null;
  const p = { ...DEFAULT_PREFS };
  if (localStorage.getItem(LEGACY_KEYS.serif) !== null) p.serif = localStorage.getItem(LEGACY_KEYS.serif) === "1";
  if (localStorage.getItem(LEGACY_KEYS.wide) !== null) p.feedWidth = localStorage.getItem(LEGACY_KEYS.wide) === "1" ? "max" : "default";
  if (localStorage.getItem(LEGACY_KEYS.zoom) !== null) p.zoom = Number(localStorage.getItem(LEGACY_KEYS.zoom)) || 100;
  if (localStorage.getItem(LEGACY_KEYS.cardw) !== null) p.cardW = Number(localStorage.getItem(LEGACY_KEYS.cardw)) || 420;
  if (localStorage.getItem(LEGACY_KEYS.cardh) !== null) p.cardH = Number(localStorage.getItem(LEGACY_KEYS.cardh)) || 430;
  if (localStorage.getItem(LEGACY_KEYS.theme) !== null) p.theme = localStorage.getItem(LEGACY_KEYS.theme);
  Object.values(LEGACY_KEYS).forEach((k) => localStorage.removeItem(k));
  return p;
}

const VALID_VIEWS = ["venue", "topic", "all", "favorites"];
const VALID_WINS = ["7", "30", "90", "365", "1826", "all", "year", "custom"];
const VALID_UNITS = ["days", "weeks", "months", "years"];

function loadPrefs() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(PREF_KEY) || "null"); } catch { stored = null; }
  if (!stored) stored = migrateLegacyPrefs();
  const p = { ...DEFAULT_PREFS, ...(stored || {}) };
  p.favorites = Array.isArray(p.favorites) ? p.favorites.slice() : [];
  if (p.theme !== "light" && p.theme !== "dark") p.theme = null;
  if (!VALID_VIEWS.includes(p.view)) p.view = "venue";
  if (typeof p.mode !== "string" || !p.mode) p.mode = "general"; // re-checked against the registry once loaded
  if (p.ranking !== "db" && p.ranking !== "leiter") p.ranking = "db";
  if (p.rankMode !== "normal" && p.rankMode !== "favorites") p.rankMode = "normal";
  if (!VALID_WINS.includes(p.win)) p.win = "365";
  if (!Number.isFinite(p.year)) p.year = 2020;
  if (!Number.isFinite(p.customN) || p.customN < 1) p.customN = 3;
  if (!VALID_UNITS.includes(p.customUnit)) p.customUnit = "weeks";
  if (!Number.isFinite(p.zoom)) p.zoom = 100;
  if (!Number.isFinite(p.cardW)) p.cardW = 420;
  if (!Number.isFinite(p.cardH)) p.cardH = 430;
  if (p.feedWidth !== "narrow" && p.feedWidth !== "default" && p.feedWidth !== "wide" && p.feedWidth !== "max") p.feedWidth = "default";
  if (p.cardStyle !== "book" && p.cardStyle !== "basic") p.cardStyle = "book";
  p.serif = !!p.serif;
  p.hideAuthors = !!p.hideAuthors;
  return p;
}

const Prefs = loadPrefs();

// ------------------------------------------------------------------ state --
const S = {
  registry: null,        // journals.json
  stats: null,           // stats.json
  recent: null,          // recent.json rows
  yearCache: new Map(),  // year -> rows
  mode: Prefs.mode,
  view: Prefs.view,       // venue | topic | all | favorites
  ranking: Prefs.ranking, // db | leiter (general mode only; irrelevant when rankMode is "favorites")
  rankMode: Prefs.rankMode, // normal | favorites — "Favourites" is a ranking option layered on top of db/leiter/field
  win: Prefs.win,         // '7'|'30'|'90'|'365'|'1826'|'all'|'year'|'custom'
  year: Prefs.year,
  customN: Prefs.customN,   // "Custom…" window: amount + unit (last applied value)
  customUnit: Prefs.customUnit, // days | weeks | months | years
  customApplied: Prefs.win === "custom", // has the user ever applied the custom picker?
  query: "",
  rows: [],              // rows for current window (all modes)
  mini: null,            // MiniSearch instance over rows
  three: null,           // threeview module (lazy)
};

// savePrefs() reads session-y state straight off S (view/mode/ranking/window)
// so it's never duplicated between S and Prefs — only display-only settings
// and favourites actually LIVE on Prefs.
function savePrefs() {
  const toStore = {
    theme: Prefs.theme, serif: Prefs.serif, feedWidth: Prefs.feedWidth, zoom: Prefs.zoom,
    cardW: Prefs.cardW, cardH: Prefs.cardH, cardStyle: Prefs.cardStyle, hideAuthors: Prefs.hideAuthors,
    view: S.view, mode: S.mode, ranking: S.ranking, rankMode: S.rankMode,
    win: S.win, year: S.year, customN: S.customN, customUnit: S.customUnit,
    favorites: Prefs.favorites,
  };
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

// "Custom…" window: an amount + unit (days/weeks/months/years) converted to
// a day count. Approximate months/years as 30/365 days — good enough for a
// browsing window, and keeps the maths identical to the fixed-day presets.
const CUSTOM_UNIT_DAYS = { days: 1, weeks: 7, months: 30, years: 365 };
const CUSTOM_UNIT_LABEL = { days: "day", weeks: "week", months: "month", years: "year" };
const CUSTOM_MAX_YEARS = 26; // sane cap — matches the deep-tier archive's earliest year (2000)
function customWindowDays() {
  const unit = CUSTOM_UNIT_DAYS[S.customUnit] ? S.customUnit : "weeks";
  const n = Number.isFinite(S.customN) && S.customN > 0 ? S.customN : 1;
  return n * CUSTOM_UNIT_DAYS[unit];
}
function customWindowLabel() {
  const unit = CUSTOM_UNIT_DAYS[S.customUnit] ? S.customUnit : "weeks";
  const n = Number.isFinite(S.customN) && S.customN > 0 ? S.customN : 1;
  return `${n} ${CUSTOM_UNIT_LABEL[unit]}${n === 1 ? "" : "s"}`;
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
  const days = S.win === "custom" ? customWindowDays() : Number(S.win);
  if (days <= 365) {
    const cut = iso(new Date(today - days * 864e5));
    return S.recent.filter((r) => r.published >= cut);
  }
  // beyond a year: stitch year files (newest first) — same path the 5-yr
  // preset uses, shared by any custom window that runs past 365 days
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

// per-journal (or per-topic — see getTopicColor) cover colour, with readable
// text on top
export function textOn(hex) {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? "#0b0b0b" : "#ffffff";
}
function applyColor(node, hex) {
  if (hex) {
    node.style.setProperty("--jc", hex);
    node.style.setProperty("--jc-text", textOn(hex));
  }
}

// Topic-section colour coding (task 5, v9) — reuses the SAME per-journal
// colour list already in data/journals.json (no invented palette), spread
// evenly across a fixed topic order so adjacent/related topics (e.g. Ethics
// vs Political philosophy) land on visually distinct colours rather than
// neighbouring shades. Stable across reloads: both the topic order
// (TOPIC_LABELS' own key order) and the colour list (deduped + sorted) are
// deterministic given the same registry data. Memoized once the registry is
// available (renderTopic() only ever runs after loadCore() resolves).
let topicColorMap = null;
function getTopicColor(topicId) {
  if (!topicColorMap) {
    const colors = [...new Set(S.registry.journals.map((j) => j.color).filter(Boolean))].sort();
    const ids = Object.keys(TOPIC_LABELS);
    const step = colors.length / ids.length;
    topicColorMap = new Map();
    ids.forEach((id, i) => {
      if (colors.length) topicColorMap.set(id, colors[Math.floor(i * step) % colors.length]);
    });
  }
  return topicColorMap.get(topicId);
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
  return fmt === "year-vol" ? `Vol. ${row.volume} (${row.published.slice(0, 4)})` : `Vol. ${row.volume}`;
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

// Builds one venue-style journal card — shared by the "By venue" grid and
// the "Favourites" view (task 13), so both get identical rank badges,
// sparklines, "View all", and expand behaviour for free.
function buildJournalCard(j, papers) {
  const card = el("div", "jcard");
  applyColor(card, j.color);
  const ceased = j.active === false ? `<span class="jceased">ceased</span>` : "";
  const head = el("div", "jhead");
  head.innerHTML = `${rankBadge(j)}
    <div><div class="jname">${esc(j.name)} ${ceased}</div>
    <div class="jmeta">${esc(j.publisher)}</div></div>
    <div class="jright">
    <div class="jright-top">
    <span class="jcount"><b>${papers.length}</b> in window</span>
    <button class="viewall" type="button" title="View the full list for this journal">View all</button>
    </div>
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
  return card;
}

function byJournalMap(rows) {
  const byJ = new Map();
  rows.forEach((r) => {
    if (!byJ.has(r.journal)) byJ.set(r.journal, []);
    byJ.get(r.journal).push(r);
  });
  return byJ;
}

function renderVenue(rows) {
  const byJ = byJournalMap(rows);
  const root = el("div", "jgrid");
  for (const j of rankedJournals()) root.append(buildJournalCard(j, byJ.get(j.id) || []));
  return root;
}

// ---------------------------------------------------------- favourites view --
// Shows ONLY the user's favourited journals, as ordinary venue-style cards,
// in the user's own pick/drag order (Prefs.favorites — see the re-order
// panel in initChrome). Distinct from the "Favourites" RANKING option,
// which re-ranks ALL journals rather than filtering to just these.
function renderFavoritesView(rows) {
  const inMode = new Set(modeJournals().map((j) => j.id));
  const favIds = Prefs.favorites.filter((id) => inMode.has(id));
  if (!favIds.length) {
    const root = el("div", "status fav-view-empty");
    root.innerHTML = `No favourites picked yet for this mode.<br>Open the <b>Favourites</b> menu in the header to pick some — they'll show up here, in the order you pick them.`;
    return root;
  }
  const byJ = byJournalMap(rows);
  const root = el("div", "jgrid");
  favIds.forEach((id) => {
    const j = journalById(id);
    if (j) root.append(buildJournalCard(j, byJ.get(id) || []));
  });
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
// Each topic also gets its own stable accent colour (task 5, v9) via
// getTopicColor()/applyColor(), the SAME mechanism + CSS the venue cards
// use for their spine/top-bar accent — so it "just works" in both card
// styles and both themes with no new CSS.
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
    applyColor(card, getTopicColor(t));
    const head = el("div", "jhead");
    head.innerHTML = `<div><div class="jname">${esc(TOPIC_LABELS[t])}</div></div>
      <div class="jright"><span class="jcount"><b>${papers.length}</b> in window</span></div>`;
    const body = el("div", "jbody");
    papers.slice(0, PREVIEW).forEach((r) => body.append(paperRow(r, true)));
    if (!papers.length) body.append(el("div", "status", "No papers in this window."));
    card.append(head, body);

    // per-card height override set by the drag handle below; cleared while
    // expanded (that state has its own generous CSS cap — see .expanded .jbody)
    let customH = null;
    function applyCustomHeight() {
      body.style.maxHeight = (customH != null && !card.classList.contains("expanded")) ? `${customH}px` : "";
    }

    if (papers.length) {
      const more = el("button", "showmore", `Expand (${papers.length} papers)`);
      more.addEventListener("click", () => {
        const expanded = card.classList.toggle("expanded");
        body.innerHTML = "";
        if (expanded) {
          papers.forEach((r) => body.append(paperRow(r, true)));
          more.textContent = "Collapse";
        } else {
          papers.slice(0, PREVIEW).forEach((r) => body.append(paperRow(r, true)));
          more.textContent = `Expand (${papers.length} papers)`;
          card.scrollIntoView({ block: "nearest" });
        }
        applyCustomHeight();
      });
      body.after(more);
      more.style.margin = "0 15px 12px";
      more.style.width = "calc(100% - 30px)";
    }

    // draggable bottom edge — per-card height resize (pointer events, so it
    // works with touch as well as mouse); sane min/max bounds
    const RESIZE_MIN = 120, RESIZE_MAX = 1400;
    const handle = el("div", "card-resize-handle");
    handle.title = "Drag to resize this card";
    let dragging = false, startY = 0, startH = 0;
    handle.addEventListener("pointerdown", (e) => {
      dragging = true;
      startY = e.clientY;
      startH = body.getBoundingClientRect().height;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      customH = Math.min(RESIZE_MAX, Math.max(RESIZE_MIN, startH + (e.clientY - startY)));
      applyCustomHeight();
    });
    const endResize = () => { dragging = false; };
    handle.addEventListener("pointerup", endResize);
    handle.addEventListener("pointercancel", endResize);
    card.append(handle);

    root.append(card);
  }
  return root;
}

// -------------------------------------------------------------- all view --
// Every publication in the current mode + window as one flat, newest-first,
// cross-journal list — same paperRow() treatment (and journal-colour accent
// on the venue name) as the topic view uses. Volume info is deliberately
// omitted (cross-journal, so volume separators don't make sense here).
//
// A 5-yr/Since-2000 window can carry ~25k rows; rendering them all at once
// (the way the venue/topic "All N papers" expand button does) would freeze
// the tab. Instead this renders in small chunks, appending the next chunk
// only once an IntersectionObserver reports the trailing sentinel has
// scrolled near the viewport — i.e. genuine lazy/incremental rendering, not
// a "fake" progress bar. Only one observer is ever live; renderAll() and
// refresh() both tear down the previous one before creating/rendering.
const ALL_CHUNK = 120;
let allViewObserver = null;
function teardownAllView() {
  if (allViewObserver) { allViewObserver.disconnect(); allViewObserver = null; }
}
function renderAll(rows) {
  teardownAllView();
  const root = el("div", "jcard tcard allcard");
  const head = el("div", "jhead");
  head.innerHTML = `<div><div class="jname">All papers</div></div>
    <div class="jright"><span class="jcount"><b>${rows.length.toLocaleString()}</b> in window</span></div>`;
  const body = el("div", "jbody allbody");
  root.append(head, body);
  if (!rows.length) {
    body.append(el("div", "status", "No papers in this window."));
    return root;
  }
  let loaded = 0;
  const sentinel = el("div", "all-sentinel");
  body.append(sentinel);
  function loadMore() {
    if (loaded >= rows.length) return;
    const next = Math.min(loaded + ALL_CHUNK, rows.length);
    const frag = document.createDocumentFragment();
    for (let i = loaded; i < next; i++) frag.append(paperRow(rows[i], true));
    body.insertBefore(frag, sentinel);
    loaded = next;
    if (loaded >= rows.length) { sentinel.remove(); teardownAllView(); }
  }
  loadMore(); // first chunk renders immediately, synchronously
  allViewObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadMore();
  }, { rootMargin: "1000px 0px" });
  allViewObserver.observe(sentinel);
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
      <li><b>Favourites</b> — Pick your favourites in the header menu! They're saved
      automatically in your browser (never sent anywhere), so they're there again next time
      you visit.</li>
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
  teardownAllView(); // leaving/re-entering the All view — drop any live lazy-render observer
  const all = await rowsForWindow();
  const ids = new Set(modeJournals().map((j) => j.id));
  S.rows = all.filter((r) => ids.has(r.journal));
  buildIndex(S.rows);
  const c = $("#content");
  c.innerHTML = "";
  if (S.query.length >= 2) c.append(renderSearch(S.rows));
  else if (S.view === "topic") c.append(renderTopic(S.rows));
  else if (S.view === "all") c.append(renderAll(S.rows));
  else if (S.view === "favorites") c.append(renderFavoritesView(S.rows));
  else c.append(renderVenue(S.rows));
  const winLabel = S.win === "year" ? `year ${S.year}`
    : S.win === "custom" ? `last ${customWindowLabel()}`
    : { 7: "last 7 days", 30: "last 30 days", 90: "last 90 days", 365: "last 12 months", 1826: "last 5 years", all: "since 2000" }[S.win];
  $("#count-note").textContent =
    `${S.rows.length.toLocaleString()} papers · ${ids.size} journals · ${winLabel}`;
  $("#basis-note").textContent = S.mode === "general" ? "" : S.registry.meta.modes[S.mode].basis;
}

// ------------------------------------------------------------------ chrome --
// Shared popover/menu plumbing (v9): every dropdown-ish panel in the header —
// the Favourites/Display popovers, the chip menus (View/Subfield/Ranking/
// Window), and the "⋯" overflow menu — registers itself here so there's ONE
// "close everything else" / "click outside closes it" / Esc mechanism for
// the whole header, rather than each popover reinventing its own.
let OPEN_PANELS = [];
function registerPanel(panel, btn) { if (panel) OPEN_PANELS.push({ panel, btn }); }
function closeAllPopovers() {
  OPEN_PANELS.forEach(({ panel, btn }) => {
    panel.classList.remove("show");
    btn?.setAttribute("aria-expanded", "false");
  });
}
function openPopover(panel, btn) {
  const isOpen = panel.classList.contains("show");
  closeAllPopovers();
  if (!isOpen) { panel.classList.add("show"); btn?.setAttribute("aria-expanded", "true"); }
}
function setChipValue(chipId, text) {
  const val = document.querySelector(`#${chipId} .chip-val`);
  if (val) val.textContent = text;
}

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

// Ranking options depend on mode (general: db/leiter/favourites; field
// modes: field/favourites) — shared by the Ranking chip menu AND the 3D
// HUD's own segmented row, so both always agree on what's on offer.
function rankOptions() {
  return S.mode !== "general"
    ? [
        { id: "field", label: "Field ranking", on: S.rankMode !== "favorites" },
        { id: "favorites", label: "Favourites", on: S.rankMode === "favorites" },
      ]
    : [
        { id: "db", label: "de Bruin 2023", on: S.rankMode !== "favorites" && S.ranking === "db" },
        { id: "leiter", label: "Leiter 2022", on: S.rankMode !== "favorites" && S.ranking === "leiter" },
        { id: "favorites", label: "Favourites", on: S.rankMode === "favorites" },
      ];
}
function applyRanking(id) {
  if (id === "favorites") S.rankMode = "favorites";
  else { S.rankMode = "normal"; if (id !== "field") S.ranking = id; }
  syncRankControls();
  refresh();
  S.three?.setRanking?.();
  savePrefs();
}
function buildRankSeg(container) {
  if (container) segButtons(container, rankOptions(), applyRanking);
}
// Rebuilds the Ranking chip's menu items (fresh nodes each time — cheap,
// avoids stale-listener bugs) while leaving the basis-note caption in place.
function buildRankChipMenu() {
  const menu = $("#menu-rank");
  if (!menu) return;
  const caption = $("#basis-note");
  menu.querySelectorAll(".chip-menu-item").forEach((n) => n.remove());
  const opts = rankOptions();
  opts.forEach((o) => {
    const b = el("button", `chip-menu-item${o.on ? " on" : ""}`, esc(o.label));
    b.setAttribute("role", "menuitemradio");
    b.setAttribute("aria-checked", o.on ? "true" : "false");
    b.addEventListener("click", () => { applyRanking(o.id); closeAllPopovers(); });
    menu.insertBefore(b, caption);
  });
  const current = opts.find((o) => o.on);
  setChipValue("chip-rank", current ? current.label : "");
}
// Keeps the Ranking chip menu AND the 3D HUD's own segmented row in sync —
// call this everywhere ranking state (or the mode it depends on) changes.
function syncRankControls() {
  buildRankSeg($("#rank-seg-3d"));
  buildRankChipMenu();
}

function initChrome() {
  // "Aim to view" (device-orientation look-around, in threeview.js) is only
  // useful — and its permission prompt only makes sense — on touch devices.
  if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
    document.body.classList.add("touch-device");
  }

  // Restored mode might not exist in this registry build (renamed/removed
  // subfield, or corrupt storage) — fall back to General silently.
  const modes = S.registry.meta.modes;
  if (!modes[S.mode]) S.mode = "general";

  // -------------------------------------------------------- chip: Subfield --
  function buildModeChipMenu() {
    const menu = $("#menu-mode");
    menu.innerHTML = "";
    Object.keys(modes).forEach((id) => {
      const on = id === S.mode;
      const b = el("button", `chip-menu-item${on ? " on" : ""}`, esc(modes[id].label));
      b.setAttribute("role", "menuitemradio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.addEventListener("click", () => { setMode(id); closeAllPopovers(); });
      menu.append(b);
    });
    setChipValue("chip-mode", modes[S.mode]?.label || "");
  }
  function setMode(id) {
    S.mode = id;
    buildModeChipMenu();
    syncRankControls();
    refresh();
    S.three?.setMode?.();
    renderFavoritesList();
    savePrefs();
  }
  buildModeChipMenu();
  syncRankControls();

  // ------------------------------------------------------------- chip: View --
  const VIEW_OPTIONS = [
    { id: "venue", label: "By venue" }, { id: "topic", label: "By topic" },
    { id: "all", label: "All" }, { id: "favorites", label: "Favourites" },
  ];
  function buildViewChipMenu() {
    const menu = $("#menu-view");
    menu.innerHTML = "";
    VIEW_OPTIONS.forEach((o) => {
      const on = o.id === S.view;
      const b = el("button", `chip-menu-item${on ? " on" : ""}`, esc(o.label));
      b.setAttribute("role", "menuitemradio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.addEventListener("click", () => { setView(o.id); closeAllPopovers(); });
      menu.append(b);
    });
    setChipValue("chip-view", VIEW_OPTIONS.find((o) => o.id === S.view)?.label || "");
  }
  function setView(v) {
    S.view = v;
    buildViewChipMenu();
    refresh();
    savePrefs();
  }
  buildViewChipMenu();

  const nowYear = new Date().getFullYear();
  const covNote = $("#cov-note");
  function updateCoverageNote() {
    const beyond5 = S.win === "all" || (S.win === "year" && S.year <= nowYear - 5)
      || (S.win === "custom" && customWindowDays() > 1826);
    covNote.textContent = beyond5
      ? "Data beyond 5 years is available for only some journals — the 26 deep-tier titles are backfilled to 2000; the rest cover roughly the last 5 years."
      : "";
    covNote.classList.toggle("show", beyond5);
  }

  // ----------------------------------------------------------- chip: Window --
  // Window chip menu: 6 fixed presets + "Pick a year…"/"Custom…", which
  // reveal the existing inline #yearpick/#custompick controls (now living
  // inside #menu-win) and — unlike the presets — deliberately keep the menu
  // open so the user can type before Enter/"Go" applies + closes it. The
  // chip label reflects the APPLIED state (e.g. "2019", "3 weeks"), not the
  // menu item's own (static) label.
  const WIN_PRESETS = { 7: "7 d", 30: "30 d", 90: "90 d", 365: "12 mo", 1826: "5 yr", all: "Since 2000" };
  function winChipLabel() {
    if (S.win === "year") return String(S.year);
    if (S.win === "custom") return customWindowLabel();
    return WIN_PRESETS[S.win] || "12 mo";
  }
  function buildWinChipMenu() {
    $("#menu-win").querySelectorAll(".chip-menu-item[data-preset]").forEach((b) => {
      const on = b.dataset.preset === S.win;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    $("#win-menu-year-toggle").classList.toggle("on", S.win === "year");
    $("#win-menu-custom-toggle").classList.toggle("on", S.win === "custom");
    setChipValue("chip-win", winChipLabel());
  }
  function setWindow(id) {
    S.win = id;
    $("#yearpick").classList.toggle("show", id === "year");
    $("#custompick").classList.toggle("show", id === "custom");
    buildWinChipMenu();
    updateCoverageNote();
    refresh();
    savePrefs();
  }
  $("#menu-win").querySelectorAll(".chip-menu-item[data-preset]").forEach((b) => {
    b.addEventListener("click", () => { setWindow(b.dataset.preset); closeAllPopovers(); });
  });

  // custom time window: "last X <unit>" — small inline UI in the same style
  // as the typed-year control, now living inside the Window chip's menu.
  // Applying (Enter, blur, or "Go") validates to a positive integer, capped
  // so the resulting window can't run past the archive's start year (2000),
  // then updates the WINDOW CHIP's own label to reflect the applied value
  // (e.g. "3 weeks") — Enter/"Go" additionally close the menu; a plain blur
  // (e.g. tabbing to the unit select) does not, so the menu stays open while
  // the user is still adjusting it.
  const customNInput = $("#custom-n");
  const customUnitSelect = $("#custom-unit");
  const customApplyBtn = $("#custom-apply");
  function applyCustom() {
    let n = Math.round(Number(customNInput.value));
    if (!Number.isFinite(n) || n < 1) n = 1;
    const unit = CUSTOM_UNIT_DAYS[customUnitSelect.value] ? customUnitSelect.value : "weeks";
    const maxN = Math.max(1, Math.floor((CUSTOM_MAX_YEARS * 365) / CUSTOM_UNIT_DAYS[unit]));
    n = Math.min(n, maxN);
    customNInput.value = n;
    S.customN = n;
    S.customUnit = unit;
    S.customApplied = true;
    buildWinChipMenu();
    if (S.win === "custom") { updateCoverageNote(); refresh(); }
    savePrefs();
  }
  customNInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyCustom(); closeAllPopovers(); } });
  customNInput.addEventListener("blur", applyCustom);
  customUnitSelect.addEventListener("change", applyCustom);
  customApplyBtn.addEventListener("click", () => { applyCustom(); closeAllPopovers(); });

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
    if (y === S.year && S.win === "year") { buildWinChipMenu(); return; }
    S.year = y;
    buildWinChipMenu();
    updateCoverageNote();
    refresh();
    savePrefs();
  }
  yearInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyYear(); closeAllPopovers(); } });
  yearInput.addEventListener("blur", applyYear);
  yearApply.addEventListener("click", () => { applyYear(); closeAllPopovers(); });

  $("#win-menu-year-toggle").addEventListener("click", () => {
    setWindow("year");
    yearInput.focus(); yearInput.select();
  });
  $("#win-menu-custom-toggle").addEventListener("click", () => {
    setWindow("custom");
    customNInput.focus(); customNInput.select();
  });

  // reflect the restored year/custom values into the inline inputs, then
  // render the window chip's initial state
  yearInput.value = S.year;
  customNInput.value = S.customN;
  customUnitSelect.value = S.customUnit;
  $("#yearpick").classList.toggle("show", S.win === "year");
  $("#custompick").classList.toggle("show", S.win === "custom");
  buildWinChipMenu();
  updateCoverageNote();

  // --------------------------------------------------------------- search --
  let debounce;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { S.query = e.target.value.trim(); refresh(); }, 200);
  });

  // mobile: search collapses to an icon; tapping it reveals a full-width
  // input (CSS: body.search-open .searchbox), focused automatically. Only
  // the icon itself or Esc hide it again (not an outside click — the user
  // may be about to tap elsewhere in the results).
  const searchToggleBtn = $("#btn-search-toggle");
  const searchInput = $("#search");
  function openMobileSearch() {
    document.body.classList.add("search-open");
    searchToggleBtn.setAttribute("aria-expanded", "true");
    searchInput.focus();
  }
  function closeMobileSearch() {
    document.body.classList.remove("search-open");
    searchToggleBtn.setAttribute("aria-expanded", "false");
  }
  searchToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (document.body.classList.contains("search-open")) closeMobileSearch();
    else { closeAllPopovers(); openMobileSearch(); }
  });

  // ---------------------------------------------------------------- theme --
  // Applied before paint via the inline <head> script (index.html) reading
  // the same prefs key — this just keeps Prefs/the "⋯" menu label in sync
  // with whatever's already on <html data-theme>, and persists future
  // changes back into the single prefs key (theme is no longer its own
  // separate localStorage entry — see LEGACY_KEYS.theme migration above).
  const effTheme = () => document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const themeMenuItem = $("#menu-theme");
  function labelTheme() {
    themeMenuItem.textContent = effTheme() === "dark" ? "Light mode" : "Dark mode";
  }
  function setTheme(next) {
    document.documentElement.dataset.theme = next;
    Prefs.theme = next;
    savePrefs();
    labelTheme();
  }
  labelTheme();

  $("#paper-overlay").addEventListener("click", (e) => { if (e.target.id === "paper-overlay") closePaper(); });
  $("#about-overlay").addEventListener("click", (e) => { if (e.target.id === "about-overlay") $("#about-overlay").classList.remove("show"); });
  $("#journal-overlay").addEventListener("click", (e) => { if (e.target.id === "journal-overlay") closeJournalModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // Paper modal can be opened from within the journal popout and now
      // stacks above it (see #paper-overlay z-index in style.css) — so a
      // single Escape while both are open must close ONLY the paper modal,
      // returning to the still-open journal popout, not both at once.
      if ($("#paper-overlay").classList.contains("show")) { closePaper(); return; }
      $("#about-overlay").classList.remove("show");
      closeJournalModal();
      closeAllPopovers();
      closeMobileSearch();
    }
  });

  // ---------------------------------------------------------- display prefs --
  const body = document.body;
  const root = document.documentElement;

  // font toggle (default sans — see CSS: body.serif restores the academic
  // serif on paper titles / modal titles / abstracts only).
  function setSerif(on, persist = true) {
    Prefs.serif = on;
    body.classList.toggle("serif", on);
    $("#font-seg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", (b.dataset.font === "serif") === on));
    if (persist) savePrefs();
  }
  $("#font-seg").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => setSerif(b.dataset.font === "serif")));
  setSerif(Prefs.serif, false);

  // feed width (Display popover; "Max" reproduces the old standalone Wide
  // toggle's full-viewport behaviour)
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

  // "Hide authors & dates" display toggle (task 4) — same segmented pattern
  // as Card style; CSS (body.hide-authors .pmeta{display:none}) does the
  // actual hiding everywhere paperRow()'s meta line appears.
  function setDetails(id, persist = true) {
    const hide = id === "hide";
    Prefs.hideAuthors = hide;
    body.classList.toggle("hide-authors", hide);
    $("#details-seg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.details === id));
    if (persist) savePrefs();
  }
  $("#details-seg").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => setDetails(b.dataset.details)));
  setDetails(Prefs.hideAuthors ? "hide" : "show", false);

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
    setZoom(100); setCardW(420); setCardH(430); setFeedWidth("default"); setCardStyle("book"); setSerif(false); setDetails("show");
  });

  const displayBtn = $("#btn-display");
  const displayPop = $("#display-popover");
  registerPanel(displayPop, displayBtn);
  displayBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openPopover(displayPop, displayBtn);
  });

  // ------------------------------------------------------------ favourites --
  // ONE global ordered list of journal ids (click order = rank), shared
  // across all four modes. Persisted BY DEFAULT (v9) — the old opt-in "Save
  // favourites on this device" checkbox is gone; "Clear favourites" (which
  // also clears them from storage) and the re-order feature remain.
  const favBtn = $("#btn-favorites");
  const favPop = $("#favorites-popover");
  const favList = $("#fav-list");
  registerPanel(favPop, favBtn);

  function toggleFavorite(jid, on) {
    const i = Prefs.favorites.indexOf(jid);
    if (on && i === -1) Prefs.favorites.push(jid);
    else if (!on && i !== -1) Prefs.favorites.splice(i, 1);
    savePrefs();
    renderFavoritesList();
    if (S.rankMode === "favorites" || S.view === "favorites") { refresh(); S.three?.setRanking?.(); }
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

  // Re-order favourites: a drag-to-reorder ranked list of just the ticked
  // favourites (pointer events — mouse + touch), replacing the checkbox
  // list until "Done". Prefs.favorites is itself the ordered rank list
  // (click order = rank — see toggleFavorite above), so reordering is just
  // rewriting that array; ranks everywhere (badge numbers, Favourites
  // ranking mode in 2D, 3D shelving) all read from it, no extra wiring.
  const favReorderBtn = $("#fav-reorder");
  const favReorderList = $("#fav-reorder-list");
  const favReorderDone = $("#fav-reorder-done");

  function commitReorderFromDom() {
    const ids = [...favReorderList.querySelectorAll(".fav-reorder-row")].map((r) => r.dataset.jid);
    Prefs.favorites = ids;
    savePrefs();
    if (S.rankMode === "favorites" || S.view === "favorites") { refresh(); S.three?.setRanking?.(); }
  }

  function renderReorderList() {
    favReorderList.innerHTML = "";
    let dragEl = null;
    Prefs.favorites.forEach((jid, i) => {
      const j = journalById(jid);
      if (!j) return; // stale id (e.g. journal removed from registry) — skip, harmless
      const row = el("div", "fav-reorder-row");
      row.dataset.jid = jid;
      row.innerHTML = `<span class="fav-drag-handle" aria-hidden="true">⠿</span>
        <span class="fav-rank">${circledNumber(i + 1)}</span>
        <span class="fav-name">${esc(j.name)}</span>`;
      row.addEventListener("pointerdown", (e) => {
        dragEl = row;
        row.classList.add("dragging");
        row.setPointerCapture(e.pointerId);
      });
      row.addEventListener("pointermove", (e) => {
        if (dragEl !== row) return;
        const rows = [...favReorderList.querySelectorAll(".fav-reorder-row")];
        const target = rows.find((r) => {
          if (r === row) return false;
          const rect = r.getBoundingClientRect();
          return e.clientY > rect.top && e.clientY < rect.bottom;
        });
        if (target) {
          // Move TARGET around the dragged row, never the row itself —
          // insertBefore()-ing the pointer-captured element mid-drag
          // silently releases its pointer capture in Chromium (moving it
          // detaches + reattaches it), which would abort the drag after
          // exactly one reorder. Relocating the other row achieves the same
          // resulting order without ever touching row's DOM position.
          const before = e.clientY < target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
          favReorderList.insertBefore(target, before ? row.nextSibling : row);
        }
      });
      const endDrag = () => {
        if (dragEl !== row) return;
        row.classList.remove("dragging");
        dragEl = null;
        commitReorderFromDom();
        // renumber the rank badges in place without a full re-render (keeps
        // DOM order the drag just produced)
        favReorderList.querySelectorAll(".fav-reorder-row").forEach((r, idx) => {
          r.querySelector(".fav-rank").textContent = circledNumber(idx + 1);
        });
      };
      row.addEventListener("pointerup", endDrag);
      row.addEventListener("pointercancel", endDrag);
      favReorderList.append(row);
    });
  }

  function enterReorderMode() {
    favList.style.display = "none";
    $("#fav-clear").style.display = "none";
    favReorderBtn.style.display = "none";
    favReorderList.style.display = "block";
    favReorderDone.style.display = "block";
    renderReorderList();
  }
  function exitReorderMode() {
    favList.style.display = "";
    $("#fav-clear").style.display = "";
    favReorderBtn.style.display = "";
    favReorderList.style.display = "none";
    favReorderDone.style.display = "none";
    renderFavoritesList();
  }
  favReorderBtn.addEventListener("click", enterReorderMode);
  favReorderDone.addEventListener("click", exitReorderMode);

  favBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    exitReorderMode(); // always open on the checkbox view, not mid-reorder
    openPopover(favPop, favBtn);
  });
  $("#fav-clear").addEventListener("click", () => {
    Prefs.favorites = [];
    savePrefs();
    renderFavoritesList();
    if (S.rankMode === "favorites" || S.view === "favorites") { refresh(); S.three?.setRanking?.(); }
  });

  // ------------------------------------------------------------------ 3D --
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
  $("#btn-aim").addEventListener("click", () => S.three?.toggleAim?.());
  $("#btn-exit-3d").addEventListener("click", () => {
    $("#three-wrap").classList.remove("show");
    S.three?.exit?.();
  });

  // ------------------------------------------------------- chips + "⋯" menu --
  function wireChip(btnId, menuId) {
    const btn = $(`#${btnId}`), menu = $(`#${menuId}`);
    registerPanel(menu, btn);
    btn.addEventListener("click", (e) => { e.stopPropagation(); openPopover(menu, btn); });
  }
  wireChip("chip-view", "menu-view");
  wireChip("chip-mode", "menu-mode");
  wireChip("chip-rank", "menu-rank");
  wireChip("chip-win", "menu-win");

  const moreBtn = $("#btn-more");
  const moreMenu = $("#more-menu");
  registerPanel(moreMenu, moreBtn);
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openPopover(moreMenu, moreBtn);
  });
  // Favourites/Display/3D items only ever show inside this menu on mobile
  // (see .mobile-only-item CSS) — they proxy a click onto the real,
  // still-present-but-hidden header button, reusing all of its existing
  // open/close/positioning logic rather than duplicating it.
  $("#menu-favorites").addEventListener("click", () => { closeAllPopovers(); favBtn.click(); });
  $("#menu-display").addEventListener("click", () => { closeAllPopovers(); displayBtn.click(); });
  $("#menu-3d").addEventListener("click", () => { closeAllPopovers(); $("#btn-3d").click(); });
  themeMenuItem.addEventListener("click", () => { closeAllPopovers(); setTheme(effTheme() === "dark" ? "light" : "dark"); });
  $("#menu-about").addEventListener("click", () => { closeAllPopovers(); openAbout(); });

  // one delegated "click outside closes everything open" listener for the
  // whole header (chips, Favourites/Display, "⋯") — trigger buttons
  // stopPropagation() on their own click (above), so this only ever fires
  // for genuine outside clicks.
  document.addEventListener("click", (e) => {
    const anyOpen = OPEN_PANELS.some(({ panel }) => panel.classList.contains("show"));
    if (!anyOpen) return;
    const insideOpen = OPEN_PANELS.some(({ panel, btn }) =>
      panel.contains(e.target) || (btn && btn.contains(e.target)));
    if (!insideOpen) closeAllPopovers();
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
