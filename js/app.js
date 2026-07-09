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
  ranking: "db",         // db | leiter (general mode only)
  win: "365",            // '30'|'90'|'365'|'1826'|'year'
  year: 2020,
  query: "",
  rows: [],              // rows for current window (all modes)
  mini: null,            // MiniSearch instance over rows
  three: null,           // threeview module (lazy)
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TOPIC_LABELS = {
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

async function rowsForWindow() {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (S.win === "year") {
    return loadYear(S.year);
  }
  const days = Number(S.win);
  if (days <= 365) {
    const cut = iso(new Date(today - days * 864e5));
    return S.recent.filter((r) => r.published >= cut);
  }
  // 5 years: stitch year files
  const cut = iso(new Date(today - days * 864e5));
  const y0 = Number(cut.slice(0, 4));
  const years = [];
  for (let y = y0; y <= today.getFullYear(); y++) years.push(y);
  setStatus(`Loading ${years.length} archive years…`);
  const all = await Promise.all(years.map(loadYear));
  return all.flat().filter((r) => r.published >= cut);
}

// --------------------------------------------------------------- journals --
const journalById = (id) => S.registry.journals.find((j) => j.id === id);
const modeJournals = () => S.registry.journals.filter((j) => S.mode === "general"
  ? j.modes.includes("general") : j.modes.includes(S.mode));

function rankOf(j) {
  if (S.mode !== "general") return j.mode_rank?.[S.mode] ?? Infinity;
  const r = S.ranking === "db" ? j.rankings?.db_pca : j.rankings?.leiter;
  return r ?? Infinity;
}
const rankedJournals = () => modeJournals().sort((a, b) => rankOf(a) - rankOf(b));

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
  const cls = r <= 3 ? "rankbadge top" : "rankbadge";
  return `<span class="${cls}">${r}</span>`;
}

function paperRow(r, showJournal) {
  const j = journalById(r.journal);
  const authors = (r.authors || []).join(", ");
  const jn = showJournal ? `<span class="pj">${esc(j?.name || r.journal)}</span> · ` : "";
  const date = r.published;
  const b = el("button", "paper");
  b.innerHTML = `<div class="ptitle">${esc(r.title)}</div>
    <div class="pmeta">${esc(authors) || "<i>—</i>"} · ${jn}${date}${r.ha ? "" : ""}</div>`;
  b.addEventListener("click", () => openPaper(r));
  return b;
}

// ------------------------------------------------------------ venue view --
function renderVenue(rows) {
  const byJ = new Map();
  rows.forEach((r) => {
    if (!byJ.has(r.journal)) byJ.set(r.journal, []);
    byJ.get(r.journal).push(r);
  });
  const root = el("div");
  for (const j of rankedJournals()) {
    const papers = byJ.get(j.id) || [];
    const card = el("div", "jcard");
    const ceased = j.active === false
      ? `<span class="jceased">ceased ${esc((j.tags || []).find(t => t.startsWith("ceased-"))?.slice(7) || "")}</span>` : "";
    const head = el("div", "jhead");
    head.innerHTML = `${rankBadge(j)}
      <div><div class="jname">${esc(j.name)} ${ceased}</div>
      <div class="jmeta">${esc(j.publisher)}</div></div>
      <div class="jright"><span class="jcount"><b>${papers.length}</b> in window</span>
      ${sparkline(j.id)}<span class="chev">›</span></div>`;
    const body = el("div", "jbody");
    head.addEventListener("click", () => {
      card.classList.toggle("open");
      if (card.classList.contains("open") && !body.dataset.filled) {
        fillJournalBody(body, papers);
        body.dataset.filled = "1";
      }
    });
    card.append(head, body);
    root.append(card);
  }
  return root;
}

function fillJournalBody(body, papers) {
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
  const LIMIT = 12;
  rest.slice(0, LIMIT).forEach((r) => body.append(paperRow(r, false)));
  if (rest.length > LIMIT) {
    const more = el("button", "showmore", `Show all ${rest.length} papers`);
    more.addEventListener("click", () => {
      more.remove();
      rest.slice(LIMIT).forEach((r) => body.append(paperRow(r, false)));
    });
    body.append(more);
  }
}

// ------------------------------------------------------------ topic view --
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
    const sec = el("section", "tsection");
    sec.innerHTML = `<h2>${esc(TOPIC_LABELS[t])} <span class="tcount">${papers.length}</span></h2>`;
    const box = el("div", "tbody");
    const LIMIT = 15;
    papers.slice(0, LIMIT).forEach((r) => box.append(paperRow(r, true)));
    if (papers.length > LIMIT) {
      const more = el("button", "showmore", `Show all ${papers.length}`);
      more.addEventListener("click", () => {
        more.remove();
        papers.slice(LIMIT).forEach((r) => box.append(paperRow(r, true)));
      });
      box.append(more);
    }
    sec.append(box);
    root.append(sec);
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
  S.mini.addAll(rows.map((r) => ({ doi: r.doi, title: r.title, authorsText: (r.authors || []).join(" ") })));
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
    <h3>${esc(r.title)}</h3>
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
      absEl.textContent = full.abstract;
      absEl.classList.remove("none");
    } else {
      absEl.textContent = "No abstract available for this paper — follow the source link.";
    }
  } catch {
    absEl.textContent = "No abstract available for this paper — follow the source link.";
  }
}
function closePaper() { $("#paper-overlay").classList.remove("show"); }

// ------------------------------------------------------------ about modal --
function openAbout() {
  const m = S.registry.meta;
  const st = S.stats;
  const rk = (k) => `<li><b>${esc(m.rankings[k].label)}</b> — ${esc(m.rankings[k].description)}
    <a href="${esc(m.rankings[k].url)}" target="_blank" rel="noopener">source ↗</a></li>`;
  $("#about-modal").innerHTML = `
    <h3>About Philosopheed</h3>
    <p>A client-side dashboard of publications in philosophy's leading journals —
    ${st.papers.toLocaleString()} papers across ${Object.keys(st.journals).length} journals,
    harvested daily from CrossRef and publisher RSS feeds. Deep archive (from 2000) for the
    top-ranked journals; five-year windows for the rest. Data updated ${esc(st.generated.slice(0, 10))}.</p>
    <h3>Rankings</h3>
    <ul>${rk("db_pca")}${rk("leiter")}${rk("leiter_mp")}</ul>
    <h3>Modes</h3>
    <ul>${Object.values(m.modes).map((x) => `<li><b>${esc(x.label)}</b> — ${esc(x.basis)}</li>`).join("")}</ul>
    <h3>Caveats</h3>
    <ul>
      <li>Abstract coverage varies by publisher (some never deposit abstracts to CrossRef).</li>
      <li>Topics are heuristic keyword tags — imperfect by design; a paper can carry several.</li>
      <li>Special-issue grouping is best-effort from issue metadata and title patterns.</li>
      <li>Every paper links to its publisher page via DOI; access depends on your subscriptions.</li>
    </ul>
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
    : { 30: "last 30 days", 90: "last 90 days", 365: "last 12 months", 1826: "last 5 years" }[S.win];
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
  if (S.mode !== "general") {
    segButtons(container, [{ id: "field", label: "Field ranking", on: true }], () => {});
    return;
  }
  segButtons(container, [
    { id: "db", label: "de Bruin 2023", on: S.ranking === "db" },
    { id: "leiter", label: "Leiter 2022", on: S.ranking === "leiter" },
  ], (id) => { S.ranking = id; refresh(); S.three?.setRanking?.(); });
}

function initChrome() {
  const modes = S.registry.meta.modes;
  segButtons($("#mode-seg"),
    Object.keys(modes).map((id) => ({ id, label: modes[id].label, on: id === S.mode })),
    (id) => { S.mode = id; buildRankSeg($("#rank-seg")); buildRankSeg($("#rank-seg-3d")); refresh(); S.three?.setMode?.(); });
  buildRankSeg($("#rank-seg"));

  $("#view-seg").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      $("#view-seg").querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      S.view = b.dataset.v;
      refresh();
    }));

  $("#win-seg").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      $("#win-seg").querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      S.win = b.dataset.w;
      $("#yearpick").classList.toggle("show", S.win === "year");
      refresh();
    }));

  const slider = $("#yearslider");
  slider.max = new Date().getFullYear();
  slider.addEventListener("input", () => { $("#yearlabel").textContent = slider.value; });
  slider.addEventListener("change", () => { S.year = Number(slider.value); refresh(); });

  let debounce;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { S.query = e.target.value.trim(); refresh(); }, 200);
  });

  $("#btn-theme").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("phd-theme", next);
  });
  const saved = localStorage.getItem("phd-theme");
  if (saved) document.documentElement.dataset.theme = saved;

  $("#btn-about").addEventListener("click", openAbout);
  $("#paper-overlay").addEventListener("click", (e) => { if (e.target.id === "paper-overlay") closePaper(); });
  $("#about-overlay").addEventListener("click", (e) => { if (e.target.id === "about-overlay") $("#about-overlay").classList.remove("show"); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closePaper(); $("#about-overlay").classList.remove("show"); }
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
      openPaper, esc, TOPIC_LABELS,
    });
  });
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
