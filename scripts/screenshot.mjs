// Verification screenshots: loads the local server, exercises the main views,
// captures console errors. Usage: node scripts/screenshot.mjs [outdir]
// playwright is installed globally (no local node_modules); import by file URL
const { chromium } = await import(
  process.env.PLAYWRIGHT_MJS ||
  "file:///home/theo/.nvm/versions/node/v24.14.0/lib/node_modules/playwright/index.mjs");

const BASE = process.env.BASE || "http://127.0.0.1:8791";
const OUT = process.argv[2] || "/tmp/philosopheed-shots";
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

// -------------------------------------------------------- v9 chip helpers --
// The v9 header rebuild replaced the segmented rows/compact-dropdown pairs
// (View/Subfield/Ranking/Window) with "chip" buttons that open an attached
// popover menu of options — one shared interaction pattern that works
// IDENTICALLY on desktop and mobile (the chip row just becomes a horizontal
// scroller on narrow viewports), so these helpers replace what used to be
// separate #x-seg / #x-dd branches per breakpoint.
async function pickChip(pg, chipId, menuId, text) {
  await pg.locator(`#${chipId}`).click();
  await pg.waitForTimeout(150);
  await pg.locator(`#${menuId} .chip-menu-item`, { hasText: text }).click();
  await pg.waitForTimeout(200);
}
// setView matches the menu item's WHOLE text (not hasText's substring
// matching): the v12 view split means "Favourites" is a substring of BOTH
// "Favourites by venue" and "All favourites", and "All" of both "All" and
// "All favourites" — substring matching would be a strict-mode violation.
async function setView(pg, text) {
  await pg.locator("#chip-view").click();
  await pg.waitForTimeout(150);
  const exact = new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  await pg.locator("#menu-view .chip-menu-item").filter({ hasText: exact }).click();
  await pg.waitForTimeout(200);
}
async function setMode(pg, text) { await pickChip(pg, "chip-mode", "menu-mode", text); }
async function setRanking(pg, text) { await pickChip(pg, "chip-rank", "menu-rank", text); }
async function setWindowPreset(pg, presetId) {
  await pg.locator("#chip-win").click();
  await pg.waitForTimeout(150);
  await pg.locator(`#menu-win .chip-menu-item[data-preset="${presetId}"]`).click();
  await pg.waitForTimeout(200);
}
async function openWinMenu(pg) {
  await pg.locator("#chip-win").click();
  await pg.waitForTimeout(150);
}
async function openYearPicker(pg) {
  await openWinMenu(pg);
  await pg.locator("#win-menu-year-toggle").click();
  await pg.waitForTimeout(150);
}
async function openCustomPicker(pg) {
  await openWinMenu(pg);
  await pg.locator("#win-menu-custom-toggle").click();
  await pg.waitForTimeout(150);
}
// Favourites/Display/3D: real standalone header buttons on desktop; on
// mobile they hide (CSS) and are reachable only via the "⋯" overflow menu,
// which proxies a click onto the same (hidden but functional) button.
async function openFavorites(pg, mobile = false) {
  if (mobile) { await pg.locator("#btn-more").click(); await pg.waitForTimeout(150); await pg.locator("#menu-favorites").click(); }
  else { await pg.locator("#btn-favorites").click(); }
  await pg.waitForTimeout(200);
}
async function openDisplay(pg, mobile = false) {
  if (mobile) { await pg.locator("#btn-more").click(); await pg.waitForTimeout(150); await pg.locator("#menu-display").click(); }
  else { await pg.locator("#btn-display").click(); }
  await pg.waitForTimeout(200);
}
async function enter3D(pg, mobile = false) {
  if (mobile) { await pg.locator("#btn-more").click(); await pg.waitForTimeout(150); await pg.locator("#menu-3d").click(); }
  else { await pg.locator("#btn-3d").click(); }
}
async function toggleTheme(pg) {
  await pg.locator("#btn-more").click();
  await pg.waitForTimeout(150);
  await pg.locator("#menu-theme").click();
  await pg.waitForTimeout(150);
}
async function openAboutMenu(pg) {
  await pg.locator("#btn-more").click();
  await pg.waitForTimeout(150);
  await pg.locator("#menu-about").click();
  await pg.waitForTimeout(150);
}

// -------------------------------------------------- v11 "since last visit" --
// _visitDebug()/fnv1aHash() are read-only/pure testing hooks app.js exports
// purely for this kind of assertion (same pattern as threeview.js's
// _debugState()/_screenPosOf() below) — re-importing app.js by URL resolves
// to the SAME already-running module instance (ES module caching is
// per-resolved-URL), so this reads genuinely live state.
async function visitDebug(pg) {
  return pg.evaluate(async () => {
    const m = await import(new URL("./js/app.js", location.href).href);
    return m._visitDebug();
  });
}
// Overwrites the philosopheed:seen baseline with a crafted one built from
// the REAL current recent.json + journals.json (fetched fresh each time, so
// this stays correct even as the underlying data changes over time) —
// dropping `dropCount` dois from a single low-volume, current-window,
// general-mode journal (so the resulting "new" set lands entirely on ONE
// journal card, inside its PREVIEW slice, making both the "+N new" chip sum
// and the rendered .newdot count exactly assertable), or a `dropFraction`
// of ALL dois (for the safety-valve case, where landing on one journal
// doesn't matter). Returns bookkeeping for the caller to assert against.
async function craftBaseline(pg, { ageMs, dropCount = null, dropFraction = null }) {
  return pg.evaluate(async ({ ageMs, dropCount, dropFraction }) => {
    const m = await import(new URL("./js/app.js", location.href).href);
    const [recent, registry] = await Promise.all([
      fetch(new URL("./data/recent.json", location.href).href).then((r) => r.json()),
      fetch(new URL("./data/journals.json", location.href).href).then((r) => r.json()),
    ]);
    const allDois = recent.map((r) => r.doi);
    let dropSet, targetJournal = null;
    if (dropFraction != null) {
      const dropN = Math.ceil(allDois.length * dropFraction);
      dropSet = new Set(allDois.slice(0, dropN));
    } else {
      const generalIds = new Set(registry.journals.filter((j) => j.modes.includes("general")).map((j) => j.id));
      const cut = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10); // matches the app's own 365d window math
      const eligible = recent.filter((r) => generalIds.has(r.journal) && r.published >= cut);
      const byJournal = new Map();
      eligible.forEach((r) => {
        if (!byJournal.has(r.journal)) byJournal.set(r.journal, []);
        byJournal.get(r.journal).push(r);
      });
      // a journal with enough eligible papers to drop `dropCount` from, but
      // few enough to stay comfortably inside the PREVIEW(200) render cap
      const candidate = [...byJournal.entries()].find(([, rows]) => rows.length >= dropCount && rows.length <= 150);
      if (!candidate) throw new Error("craftBaseline: no suitable low-volume journal found for dropCount=" + dropCount);
      targetJournal = candidate[0];
      dropSet = new Set(candidate[1].slice(0, dropCount).map((r) => r.doi));
    }
    const keepIds = allDois.filter((d) => !dropSet.has(d)).map((d) => m.fnv1aHash(d));
    localStorage.setItem("philosopheed:seen", JSON.stringify({ ts: Date.now() - ageMs, ids: keepIds }));
    return { totalDois: allDois.length, droppedCount: dropSet.size, targetJournal };
  }, { ageMs, dropCount, dropFraction });
}
async function seenStorage(pg) {
  return pg.evaluate(() => JSON.parse(localStorage.getItem("philosopheed:seen") || "null"));
}

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/01-venue.png` }); // default view: book-style cards, light mode

// v9-01: desktop header — row 1 (brand/search/utilities), row 2 (four chips
// left-aligned + count note right-aligned). Asserts chip labels & order.
{
  await page.locator("header.site").screenshot({ path: `${OUT}/v9-01-desktop-header.png` });
  const chipLabels = await page.locator(".chip-val").allInnerTexts();
  const chipKeys = await page.locator(".chip-key").allInnerTexts();
  console.log(`v9-01: chip keys=${JSON.stringify(chipKeys)} (expect ["VIEW","SUBFIELD","RANKING","WINDOW"]), values=${JSON.stringify(chipLabels)}`);
  const row1Ids = await page.locator(".site-row > *").evaluateAll((els) => els.map((e) => e.id || e.className));
  console.log(`v9-01: row1 children (brand/spacer/search/utilities): ${JSON.stringify(row1Ids)}`);
  const oldEls = await page.evaluate(() => ({
    subrow: !!document.querySelector(".subrow"),
    viewSeg: !!document.querySelector("#view-seg"),
    modeSeg: !!document.querySelector("#mode-seg"),
    ddWrap: !!document.querySelector(".dd-wrap"),
    btnTheme: !!document.querySelector("#btn-theme"),
    btnAbout: !!document.querySelector("#btn-about"),
  }));
  console.log(`v9-01: dead old-design elements present: ${JSON.stringify(oldEls)} (expect all false)`);
}

// journal card head close-up (desktop) — verifies the compacted card-top
// padding and that "View all" now sits inline with the count, not stacked
// directly above/over the sparkline
await page.locator(".jcard").first().locator(".jhead").screenshot({ path: `${OUT}/01b-jcard-head-desktop.png` });

// expand first journal card
await page.locator(".jhead").first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/02-expanded.png` });

// open a paper modal
await page.locator(".jbody .paper").first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/03-paper.png` });
await page.keyboard.press("Escape");

// topic view
await setView(page, "By topic");
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/04-topic.png` });

// v9-10 (addendum, task 5): topic-section colour coding — each topic card
// gets a stable accent drawn from the SAME per-journal colour list, spread
// out so related/adjacent topics (Ethics vs Political) land on visibly
// different colours, not neighbouring shades.
{
  await page.locator(".tcard").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/v9-10-topic-colors.png` });
  const colors = await page.evaluate(() => {
    const byName = (name) => [...document.querySelectorAll(".tcard")]
      .find((c) => c.querySelector(".jname")?.textContent.trim().startsWith(name));
    const get = (name) => {
      const c = byName(name);
      return c ? getComputedStyle(c).getPropertyValue("--jc").trim() : null;
    };
    return { ethics: get("Ethics"), political: get("Political") };
  });
  const v910pass = !!colors.ethics && !!colors.political && colors.ethics !== colors.political;
  console.log(`v9-10: Ethics section accent=${colors.ethics}, Political section accent=${colors.political} -> ${v910pass ? "PASS (distinct)" : "FAIL"}`);
}

// scrolled topic card: expand + scroll within a topic body (respects the
// card-height cap, same mechanism as journal cards)
{
  const firstTopic = page.locator(".jcard.tcard").first();
  await firstTopic.scrollIntoViewIfNeeded();
  const jbody = firstTopic.locator(".jbody");
  await jbody.evaluate((el) => { el.scrollTop = 180; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/04b-topic-scrolled.png` });
}

// topic card "Expand (N papers)" button — always present (v7), not just
// past the 200-row preview cap — and the per-card bottom-edge drag-resize
// handle (pointer events; per-card height override, independent of the
// global card-height slider)
{
  const firstTopic = page.locator(".jcard.tcard").first();
  await firstTopic.scrollIntoViewIfNeeded();
  const expandBtn = firstTopic.locator(":scope > .showmore");
  const label = await expandBtn.innerText();
  console.log(`Topic card expand button label: "${label}" (expect "Expand (N papers)")`);
  await expandBtn.click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/04c-topic-expand-button.png` });
  await expandBtn.click(); // collapse back
  await page.waitForTimeout(300);

  const handle = firstTopic.locator(".card-resize-handle");
  const hbox = await handle.boundingBox();
  await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + 260, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/04d-topic-card-resized.png` }); // card should be visibly taller
}

// ---------------------------------------------------------------- all view --
// flat, newest-first, cross-journal list — paperRow(r, true) journal-colour
// accent (same treatment as the topic view), chunked/lazy rendering via
// IntersectionObserver so it doesn't have to render everything up front.
await setView(page, "All");
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/04c-all-12mo.png` });

// scroll to trigger a couple of lazy-render chunks past the initial batch
await page.mouse.wheel(0, 4000);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/04d-all-scrolled.png` });

// regression check: "All" view on "Since 2000" (~tens of thousands of rows
// across all journals) must not hang the tab — time the initial render and
// confirm only a small chunk is in the DOM up front (lazy, not everything
// at once), then scroll to pull in a few more chunks.
{
  await setWindowPreset(page, "all");
  const t0 = Date.now();
  await page.waitForTimeout(4000); // same settle time the existing 09b since-2000 case uses
  const elapsedMs = Date.now() - t0;
  const rowCount = await page.locator(".allbody .paper").count();
  const totalCount = await page.locator(".allcard .jcount b").innerText();
  console.log(`All view / Since 2000: ${rowCount} paper rows in DOM after ${elapsedMs}ms settle (of ${totalCount} total in window) — lazy-rendered, not all at once`);
  await page.screenshot({ path: `${OUT}/04e-all-since2000.png` });
  await page.mouse.wheel(0, 6000);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/04f-all-since2000-scrolled.png` });
}

// back to venue + 12mo for the rest of the desktop shots
await setWindowPreset(page, "365");
await page.waitForTimeout(800);
await setView(page, "By venue");
await page.waitForTimeout(400);

// ------------------------------------------------------------- 7d preset --
await setWindowPreset(page, "7");
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/04g-7d-window.png` });

// -------------------------------------------------------- custom window --
// v9-02: Window chip menu open, showing presets + "Pick a year…" + "Custom…"
await openWinMenu(page);
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/v9-02-window-chip-menu.png` });
{
  const items = await page.locator("#menu-win .chip-menu-item").allInnerTexts();
  console.log(`v9-02: Window chip menu items: ${JSON.stringify(items)} (expect 6 presets + "Pick a year…" + "Custom…")`);
}

// open the inline custom picker (inside the still-open menu), apply a short
// custom window (3 weeks — no partial-data note expected), then a long one
// (10 years — past 5 years, partial-data note expected). The WINDOW CHIP's
// own label should update to reflect the applied value.
await page.locator("#win-menu-custom-toggle").click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/04h-custom-picker-open.png` }); // inline UI visible within the still-open menu, defaults (3 weeks)
await page.fill("#custom-n", "3");
await page.selectOption("#custom-unit", "weeks");
await page.locator("#custom-apply").click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/04i-custom-3weeks-applied.png` }); // chip label -> "3 weeks", no coverage note, menu closed
{
  const chipVal = await page.locator("#chip-win .chip-val").innerText();
  console.log(`Custom window chip label after 3-weeks apply: "${chipVal}" (expect "3 weeks")`);
}

await openCustomPicker(page);
await page.fill("#custom-n", "10");
await page.selectOption("#custom-unit", "years");
await page.locator("#custom-apply").click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/04j-custom-10years-coverage-note.png` }); // partial-data note should now show

// revert to the default window for the remaining desktop shots
await setWindowPreset(page, "365");
await page.waitForTimeout(600);

// leiter ranking toggle (back on venue)
await setView(page, "By venue");
await setRanking(page, "Leiter");
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/05-leiter.png` });

// ethics mode
await setMode(page, "Ethics");
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/06-ethics.png` });

// search
await setMode(page, "General");
await page.fill("#search", "blame");
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/07-search.png` });

// sanitized inline markup: this Ergo title carries a real "<i>Daodejing</i>"
// tag in the source data — confirm it renders as italic markup, not raw tags
await page.fill("#search", "Daodejing");
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/07b-inline-markup.png` });
await page.fill("#search", "");

// 5-year window
await setWindowPreset(page, "1826");
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/08-5yr.png` });

// regression check: expand Synthese in the 5-yr window (~2,800 papers — the
// pathological case that used to balloon the page and hide the Collapse
// control far below the fold). Expand, reveal the full inner list, and
// confirm the Collapse control is reachable without scrolling the page.
// This is also a good venue for volume separators (Synthese/Springer
// deposits volume numbers reliably and runs many volumes/year).
{
  const synCard = page.locator(".jcard").filter({ has: page.locator(".jname", { hasText: /^Synthese\s*$/ }) }).first();
  await synCard.scrollIntoViewIfNeeded();
  await synCard.locator(":scope > .showmore").click(); // outer "All N papers" -> expand
  await page.waitForTimeout(400);
  const innerShowAll = synCard.locator(".jbody > .showmore");
  if (await innerShowAll.count()) await innerShowAll.click(); // reveal full ~2,800-row list
  await page.waitForTimeout(500);
  await synCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/09-synthese-5yr-expanded.png` });
  // scroll partway down the (now unbounded, expanded) inner list to bring a
  // volume boundary separator into frame
  await synCard.locator(".jbody").evaluate((el) => { el.scrollTop = el.scrollHeight * 0.15; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/09a-synthese-volume-boundary.png` });
  // task 11: year-qualified volume separator label is "Vol. N (YYYY)" (was
  // "'YY · Vol. N") — Synthese runs several volumes/year, so its separators
  // are always the year-qualified form; assert the new format on whatever's
  // in view.
  {
    const label = await synCard.locator(".volsep-label").first().innerText();
    const ok = /^VOL\.\s*\d+\s*\(\d{4}\)$/.test(label);
    console.log(`Volume separator label format: "${label}" — ${ok ? "PASS" : "FAIL"} (expect "VOL. N (YYYY)")`);
  }
  await synCard.locator(":scope > .showmore", { hasText: "Collapse" }).click(); // collapse back
  await page.waitForTimeout(300);
}

// "Since 2000" full-archive window — on-demand year-file stitching, must not
// freeze the UI or blow up journal counts/sparklines
await setWindowPreset(page, "all");
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/09b-since-2000.png` });

// volume boundary in the "View all" popout (Phil Studies, Springer — reliable
// volume data across the full archive window)
{
  const psCard = page.locator(".jcard").filter({ has: page.locator(".jname", { hasText: /^Philosophical Studies\s*$/ }) }).first();
  await psCard.scrollIntoViewIfNeeded();
  await psCard.locator(".viewall").click();
  await page.waitForTimeout(500);
  await page.locator("#journal-modal-body").evaluate((el) => { el.scrollTop = el.scrollHeight * 0.1; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/09c-popout-volume-boundary.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

// missing-abstract placeholder — T&F's Australasian Journal of Philosophy
// deposits zero abstracts to CrossRef in the current window (verified
// against data/shards/ajp/2026.json), so its first paper is a reliable hit
{
  await setWindowPreset(page, "365");
  await page.waitForTimeout(800);
  const ajpCard = page.locator(".jcard").filter({ has: page.locator(".jname", { hasText: /^Australasian Journal of Philosophy\s*$/ }) }).first();
  await ajpCard.scrollIntoViewIfNeeded();
  await ajpCard.locator(".jbody .paper").first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/09d-missing-abstract.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

// typed-year control: type a year >5 years back — coverage note should appear
await openYearPicker(page);
await page.fill("#yearinput", "2003");
await page.locator("#yearinput").press("Enter");
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/09e-year-2003-coverage-note.png` });

// journal popout ("View all") — full list in a scroll-capped modal
await setWindowPreset(page, "365");
await page.waitForTimeout(800);
await page.locator(".jcard .viewall").first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/10-journal-popout.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// v8-01/v8-02: paper modal opened FROM a paper row inside the journal
// popout must stack strictly above it (interactive, not just visible), and
// closing the paper modal (Esc here; click-outside/X share the same
// closePaper()) must return to the still-open journal popout rather than
// closing both at once.
{
  await page.locator(".jcard .viewall").first().click();
  await page.waitForTimeout(400);
  await page.locator("#journal-modal .paper").first().click();
  await page.waitForTimeout(600);

  const stackCheck = await page.evaluate(() => {
    const paperModal = document.querySelector("#paper-modal");
    const rect = paperModal.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    const paperZ = Number(getComputedStyle(document.querySelector("#paper-overlay")).zIndex);
    const journalZ = Number(getComputedStyle(document.querySelector("#journal-overlay")).zIndex);
    return {
      topElIsInPaperModal: !!(topEl && paperModal.contains(topEl)),
      paperZ, journalZ,
    };
  });
  const v801pass = stackCheck.topElIsInPaperModal && stackCheck.paperZ > stackCheck.journalZ;
  console.log(`v8-01: elementFromPoint(paper-modal center) inside #paper-modal=${stackCheck.topElIsInPaperModal}, ` +
    `#paper-overlay z-index=${stackCheck.paperZ} > #journal-overlay z-index=${stackCheck.journalZ} -> ${v801pass ? "PASS" : "FAIL"}`);
  await page.screenshot({ path: `${OUT}/v8-01-paper-over-journal.png` });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const afterEsc = await page.evaluate(() => ({
    paperOpen: document.querySelector("#paper-overlay").classList.contains("show"),
    journalOpen: document.querySelector("#journal-overlay").classList.contains("show"),
  }));
  const v802pass = !afterEsc.paperOpen && afterEsc.journalOpen;
  console.log(`v8-02: after Esc — paper modal open=${afterEsc.paperOpen} (expect false), journal popout open=${afterEsc.journalOpen} (expect true) -> ${v802pass ? "PASS" : "FAIL"}`);
  await page.screenshot({ path: `${OUT}/v8-02-esc-closes-paper-only.png` });

  await page.keyboard.press("Escape"); // close the journal popout too, cleanup for the rest of the run
  await page.waitForTimeout(200);
}

// v9-03: "⋯" menu open (Theme/About) — desktop only ever shows these two
// items in the menu (Favourites/Display/3D stay as standalone buttons and
// their .mobile-only-item menu twins are CSS-hidden at this viewport).
{
  await page.locator("#btn-more").click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/v9-03-more-menu-desktop.png` });
  const visible = await page.evaluate(() => {
    const vis = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== "none" && e.offsetParent !== null; };
    return {
      theme: vis("#menu-theme"), about: vis("#menu-about"),
      favorites: vis("#menu-favorites"), display: vis("#menu-display"), threeD: vis("#menu-3d"),
    };
  });
  console.log(`v9-03: ⋯ menu item visibility on desktop: ${JSON.stringify(visible)} (expect theme/about=true, favorites/display/threeD=false)`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

// about modal (light mode) — new copy, dynamic "Data last updated" line
// rendered in the viewer's local timezone (headless Chromium's default TZ)
await openAboutMenu(page);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/11-about.png` });
await page.locator("#about-close").click();
await page.waitForTimeout(200);

// -------------------------------------------------------- favourites view --
// task 13 (label updated in v12: "Favourites" -> "Favourites by venue"):
// favourited journals as a VIEW option (distinct from the Favourites
// RANKING option below) — empty state first, before any favourites exist
{
  await setView(page, "Favourites by venue");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/20a-favorites-view-empty.png` });
  await setView(page, "By venue");
  await page.waitForTimeout(300);
}

// ------------------------------------------------------------ favourites --
// pick the top 3 ranked journals (positional — robust to naming) in order,
// confirm circled-number badges appear, then switch to Favourites ranking.
// v9: favourites are persisted BY DEFAULT now (no opt-in checkbox) — see
// the dedicated v9-09 reload-persistence check near the end of this script.
{
  await openFavorites(page);
  await page.waitForTimeout(200);
  const rows = page.locator("#fav-list .fav-row input");
  await rows.nth(0).click();
  await rows.nth(1).click();
  await rows.nth(2).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/20-favorites-dropdown.png` });
  {
    const hasPersistCheckbox = await page.locator("#fav-persist").count();
    console.log(`v9: "Save favourites on this device" checkbox present: ${hasPersistCheckbox > 0} (expect false — removed, persists by default)`);
  }

  // Re-order favourites: drag-to-rank panel replaces the checkbox list,
  // "Done" returns to it — reordering updates rank badges/numbers everywhere
  // (checkbox view, Favourites ranking mode, 3D shelving) since it's just
  // rewriting the one shared Prefs.favorites array.
  await page.locator("#fav-reorder").click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/20b-favorites-reorder-panel.png` });
  {
    const firstRow = page.locator("#fav-reorder-list .fav-reorder-row").first();
    const rowsAll = page.locator("#fav-reorder-list .fav-reorder-row");
    const count = await rowsAll.count();
    const box = await firstRow.boundingBox();
    const lastBox = await rowsAll.nth(count - 1).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, lastBox.y + lastBox.height - 4, { steps: 12 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const orderAfterDrag = await page.evaluate(() =>
      [...document.querySelectorAll("#fav-reorder-list .fav-reorder-row .fav-name")].map((n) => n.textContent));
    console.log("Favourites re-order: first pick dragged to last ->", orderAfterDrag);
  }
  await page.screenshot({ path: `${OUT}/20c-favorites-reordered.png` });
  await page.locator("#fav-reorder-done").click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/20d-favorites-checkbox-after-reorder.png` }); // rank badges reflect the new order
  await page.mouse.click(50, 50); // close popover
  await page.waitForTimeout(200);

  await setRanking(page, "Favourites");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/21-favorites-ranking-2d.png` }); // reflects the re-ordered ranks

  // task 13: "Favourites by venue" VIEW (not ranking) — only the favourited
  // journals, in favourites order, as ordinary cards. Revert ranking to de
  // Bruin first so this isn't conflated with the ranking-mode shot above.
  await setRanking(page, "Meta-ranking");
  await page.waitForTimeout(300);
  await setView(page, "Favourites by venue");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/20e-favorites-view-populated.png` });
  await setView(page, "By venue");
  await page.waitForTimeout(300);
}

// feed width — "Max" preset (replaces the old Wide toggle) + card style /
// feed width controls visible in the Display popover. The popover stays
// open across these clicks (only closes on an outside click or a second
// #btn-display click — don't re-click #btn-display mid-sequence, it toggles).
await openDisplay(page);
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/22-display-popover.png` }); // shows card-style + feed-width (all 4 presets) + Font + Details rows, unclipped
await page.locator('#feedwidth-seg button[data-fw="max"]').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/23-feedwidth-max.png` });
await page.locator('#feedwidth-seg button[data-fw="default"]').click(); // revert

// Basic card style (proves the Book/Basic toggle actually changes the look)
await page.locator('#cardstyle-seg button[data-cs="basic"]').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/24-cardstyle-basic.png` });
await page.locator('#cardstyle-seg button[data-cs="book"]').click(); // revert to book (default)
await openDisplay(page); // close popover

// font toggle: Serif — venue titles + paper modal (moved from a standalone
// header button into the Display popover as a Font: Sans/Serif row in v7)
await openDisplay(page);
await page.waitForTimeout(200);
await page.locator('#font-seg button[data-font="serif"]').click();
await page.waitForTimeout(200);
await openDisplay(page); // close popover
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/12-serif-venue.png` });
await page.locator(".jbody .paper").first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/13-serif-modal.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// v9-08: "Hide authors & dates" display toggle (task 4) — paper rows show
// titles only (no .pmeta line) everywhere in 2D; the paper MODAL keeps
// full author/date info regardless.
{
  await openDisplay(page);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/v9-08a-display-details-row.png` }); // Details: Show/Hide segmented row visible
  await page.locator('#details-seg button[data-details="hide"]').click();
  await page.waitForTimeout(200);
  await openDisplay(page); // close popover
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/v9-08b-hide-authors-cards.png` });
  // .pmeta nodes stay IN the DOM (paperRow() always renders them) — CSS
  // (body.hide-authors .pmeta{display:none}) is what hides them, so assert
  // computed style, not element count/presence.
  const pmetaVisibleCount = await page.locator(".jbody .pmeta").evaluateAll(
    (els) => els.filter((e) => getComputedStyle(e).display !== "none").length);
  console.log(`v9-08: .pmeta elements with computed display!=none (i.e. actually visible) in venue cards with Hide authors on: ${pmetaVisibleCount} (expect 0)`);
  const ptitleCount = await page.locator(".jbody .ptitle").count();
  console.log(`v9-08: .ptitle (title-only rows) still present: ${ptitleCount} (expect > 0)`);

  // modal keeps full info regardless of the toggle
  await page.locator(".jbody .paper").first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/v9-08c-hide-authors-modal-unaffected.png` });
  const modalAuthorsVisible = await page.evaluate(() => {
    const a = document.querySelector("#paper-modal .authors");
    return !!a && getComputedStyle(a).display !== "none" && a.textContent.trim().length >= 0;
  });
  console.log(`v9-08: paper modal .authors still present/visible with Hide authors on: ${modalAuthorsVisible} (expect true)`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // revert for the rest of the run
  await openDisplay(page);
  await page.locator('#details-seg button[data-details="show"]').click();
  await openDisplay(page);
  await page.waitForTimeout(200);
}

// Display popover open, sliders moved
await openDisplay(page);
await page.waitForTimeout(200);
await page.locator("#zoom-slider").fill("75");
await page.locator("#zoom-slider").dispatchEvent("input");
await page.locator("#cardw-slider").fill("340");
await page.locator("#cardw-slider").dispatchEvent("input");
await page.locator("#cardh-slider").fill("600");
await page.locator("#cardh-slider").dispatchEvent("input");
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/14-display-popover.png` });
await page.mouse.click(50, 50); // click outside to close
await page.waitForTimeout(200);
// reset back to defaults so later views aren't zoomed for the rest of the run
await openDisplay(page);
await page.locator("#display-reset").click(); // resets zoom/card sliders/feed width/card style/font/details
await openDisplay(page);
await page.waitForTimeout(300);
{
  const cardwMin = await page.locator("#cardw-slider").getAttribute("min");
  console.log(`Card-width slider min attribute: ${cardwMin} (expect "160" — task 3/v9)`);
}
// undo the favourites ranking pick so 3D shots start from de Bruin ranking
await setRanking(page, "Meta-ranking");
await page.waitForTimeout(300);

// ------------------------------------------------------------------- 3D --
// v10: single bookcase, direct reading. _debugState()/_screenPosOf() are
// small read-only hooks threeview.js exports purely for this kind of
// assertion — see js/threeview.js's "testing" section at the bottom.
// Re-importing the module by URL inside page.evaluate resolves to the SAME
// already-running singleton instance app.js loaded (ES module caching is
// per-resolved-URL), so this reads genuinely live state, not a fresh copy.
async function threeDebugState() {
  return page.evaluate(async () => {
    const m = await import(new URL("./js/threeview.js", location.href).href);
    return m._debugState();
  });
}
async function threeScreenPosOf(journalId) {
  return page.evaluate(async (id) => {
    const m = await import(new URL("./js/threeview.js", location.href).href);
    return m._screenPosOf(id);
  }, journalId);
}

await enter3D(page);
await page.waitForTimeout(2500);

// v10-01: home view — single bookcase, all shelves populated, specialist
// shelf labels visible. homeEye() now derives its distance from the case's
// real height AND width (see js/threeview.js), so the home dolly level
// already frames the whole (taller, single-carcass) case on its own —
// no manual zoom-out needed before this shot any more.
await page.screenshot({ path: `${OUT}/v10-01-3d-home-single-case.png` });

// v10-02: journal count on shelves == registry journal count, no duplicates
{
  const st = await threeDebugState();
  const registryCount = await page.evaluate(async () => {
    const res = await fetch(new URL("./data/journals.json", location.href).href);
    const d = await res.json();
    return d.journals.length;
  });
  const uniqueCount = new Set(st.journalIds).size;
  const pass = st.journalIds.length === registryCount && uniqueCount === registryCount;
  console.log(`v10-02: shelved=${st.journalIds.length} unique=${uniqueCount} registryTotal=${registryCount} -> ${pass ? "PASS" : "FAIL"}`);
}

// v10-03: click a book (the top-ranked general-shelf book, via the exact
// screen projection rather than a guessed pixel) — it should fly out in
// front of the camera and the reading panel should open with that
// journal's papers, with the camera position bit-for-bit unchanged.
let topGeneralId = null;
{
  const before = await threeDebugState();
  topGeneralId = before.generalOrder[0];
  const pos = await threeScreenPosOf(topGeneralId);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(700);
  const after = await threeDebugState();
  const cameraUnmoved = JSON.stringify(before.cameraPos) === JSON.stringify(after.cameraPos);
  const panelOpen = await page.locator("#three-panel.show").isVisible().catch(() => false);
  const pass = panelOpen && after.bookOut === topGeneralId && cameraUnmoved;
  console.log(`v10-03: clicked ${topGeneralId} — panelOpen=${panelOpen}, bookOut=${after.bookOut}, cameraUnmoved=${cameraUnmoved} -> ${pass ? "PASS" : "FAIL"}`);
  await page.screenshot({ path: `${OUT}/v10-03-book-out-reading-panel.png` });
  const volsepCount = await page.locator("#three-panel .volsep").count();
  console.log(`Reading panel volume separators present: ${volsepCount}`);
}

// v10-04: Esc closes the panel and sends the book back — camera still
// unmoved throughout.
{
  const before = await threeDebugState();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const after = await threeDebugState();
  const cameraUnmoved = JSON.stringify(before.cameraPos) === JSON.stringify(after.cameraPos);
  const panelClosed = !(await page.locator("#three-panel.show").isVisible().catch(() => false));
  const pass = panelClosed && after.bookOut === null && cameraUnmoved;
  console.log(`v10-04: after Esc — panelClosed=${panelClosed}, bookOut=${after.bookOut} (expect null), cameraUnmoved=${cameraUnmoved} -> ${pass ? "PASS" : "FAIL"}`);
  await page.screenshot({ path: `${OUT}/v10-04-esc-book-returned.png` });
}

// v10-05: switching ranking via #rank-seg-3d reshelves the general
// section — assert the shelving order actually changes.
{
  const before = await threeDebugState();
  await page.locator("#rank-seg-3d button", { hasText: "Leiter" }).click();
  await page.waitForTimeout(500);
  const after = await threeDebugState();
  const orderChanged = JSON.stringify(before.generalOrder) !== JSON.stringify(after.generalOrder);
  console.log(`v10-05: general shelf order before=${JSON.stringify(before.generalOrder.slice(0, 5))}… after Leiter=${JSON.stringify(after.generalOrder.slice(0, 5))}… -> ${orderChanged ? "PASS (order differs)" : "FAIL (order unchanged)"}`);
  await page.screenshot({ path: `${OUT}/v10-05-3d-reranked.png` });
  await page.locator("#rank-seg-3d button", { hasText: "Meta-ranking" }).click(); // revert
  await page.waitForTimeout(500);
}

// click-empty-space also returns an out book (reuses the same closeBook()
// path Esc uses) — verified via code path above; sanity screenshot of a
// second book opened then dismissed by clicking empty space.
{
  const pos = await threeScreenPosOf(topGeneralId);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(700);
  await page.mouse.click(500, 850); // lower-left canvas area — clear of the HUD, panel, and hint text
  await page.waitForTimeout(500);
  const st = await threeDebugState();
  console.log(`Click-empty-space return: bookOut=${st.bookOut} (expect null)`);
}

// dark mode
await page.locator("#btn-exit-3d").click();
await toggleTheme(page);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/25-dark.png` }); // book-style cards, dark mode

// v10-06: 3D in dark mode (#btn-theme is covered by #three-wrap while 3D is
// open — z-index 60 vs the header's 40 — so the toggle has to happen while
// back on the 2D dashboard, as above, then re-enter 3D for this shot)
{
  await page.locator("#btn-3d").click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/v10-06-3d-dark.png` });
  await page.locator("#btn-exit-3d").click();
  await page.waitForTimeout(200);
}

// about modal (dark mode) — confirm the new copy/links read fine on dark surface
await openAboutMenu(page);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/25a-about-dark.png` });
await page.locator("#about-close").click();
await page.waitForTimeout(200);

// dark mode with the new controls visible: serif on, Max feed width, Display open
await openDisplay(page);
await page.locator('#font-seg button[data-font="serif"]').click();
await page.locator('#feedwidth-seg button[data-fw="max"]').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/26-dark-controls.png` });
await openDisplay(page); // close popover
await page.waitForTimeout(200);
// revert font + feed width so later shots aren't affected
await openDisplay(page);
await page.locator('#font-seg button[data-font="sans"]').click();
await page.locator('#feedwidth-seg button[data-fw="default"]').click();
await openDisplay(page);
await page.waitForTimeout(200);

// dark-mode scrollbars (task 9) — scrollbar-color is applied via CSS custom
// properties; headless Chromium screenshots hide OS scrollbars by default
// (Playwright's --hide-scrollbars flag), so this asserts the COMPUTED style
// directly rather than relying on a visual screenshot of the thumb itself.
{
  const synCard = page.locator(".jcard").filter({ has: page.locator(".jname", { hasText: /^Synthese\s*$/ }) }).first();
  await synCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/26b-dark-scrollbar-area.png` }); // scrollable card list area, dark mode
  const scrollbarColor = await page.evaluate(() => getComputedStyle(document.querySelector(".jbody")).scrollbarColor);
  console.log(`Dark-mode .jbody scrollbar-color: "${scrollbarColor}" (expect a dark thumb/track pair, not "auto")`);
  await toggleTheme(page); // back to light
  await page.waitForTimeout(300);
  const scrollbarColorLight = await page.evaluate(() => getComputedStyle(document.querySelector(".jbody")).scrollbarColor);
  console.log(`Light-mode .jbody scrollbar-color: "${scrollbarColorLight}" (expect "auto" — unaffected)`);
  await toggleTheme(page); // back to dark for the rest of the desktop run
  await page.waitForTimeout(300);
}

// ================================================================ mobile ==
// Manually-specified device descriptors (rather than importing a named
// entry from playwright's device list) so this doesn't depend on exactly
// which Playwright version is installed.
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const mobileErrors = [];

// ---- portrait (390×844) ----
const mCtxP = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  deviceScaleFactor: 3, userAgent: IPHONE_UA,
});
const mp = await mCtxP.newPage();
mp.on("console", (m) => { if (m.type() === "error") mobileErrors.push(`[portrait] ${m.text()}`); });
mp.on("pageerror", (e) => mobileErrors.push(`[portrait] ${e}`));

await mp.goto(BASE, { waitUntil: "networkidle" });
await mp.waitForTimeout(800);
await mp.screenshot({ path: `${OUT}/m01-venue-portrait.png` }); // single-column cards, header row 1 no longer wraps

// header close-up (portrait) — compacted chrome, no horizontal overflow;
// chip row now visible (was dropdowns pre-v9)
await mp.locator("header.site").screenshot({ path: `${OUT}/m01a-header-portrait.png` });
// journal card head close-up (portrait) — compacted card top, "View all"
// inline with the count rather than stacked over the sparkline
await mp.locator(".jcard").first().locator(".jhead").screenshot({ path: `${OUT}/m01b-jcard-head-portrait.png` });
{
  const overflowPortrait = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`portrait horizontal overflow: ${overflowPortrait}px (should be <=0)`);
}

// mobile header row 1 (brand + search-icon + "⋯") must be a SINGLE row, not
// wrapped onto two — regression check for the .spacer flex-basis:100%
// leftover that used to force the icon buttons beneath the brand on a
// 390px/320px-wide phone (see the mobile-CSS comment in style.css). Row 1
// is .site-row itself (the chip row is a separate sibling below it), so
// asserting on that element's own box height cleanly excludes row 2.
{
  const row1 = await mp.evaluate(() => {
    const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
    const b = rect(".brand");
    const s = rect("#btn-search-toggle");
    const m = rect("#btn-more");
    const row = rect(".site-row");
    const overlaps = (a, c) => a.top < c.bottom && c.top < a.bottom;
    return {
      rowHeight: row.height,
      brandSearchSameRow: overlaps(b, s),
      brandMoreSameRow: overlaps(b, m),
    };
  });
  const singleRowPass = row1.brandSearchSameRow && row1.brandMoreSameRow && row1.rowHeight <= 60;
  console.log(`mobile header row 1: height=${row1.rowHeight.toFixed(1)}px (expect <=60px), ` +
    `brand/search-icon same row=${row1.brandSearchSameRow}, brand/more same row=${row1.brandMoreSameRow} -> ${singleRowPass ? "PASS" : "FAIL"}`);
}

// v9-04: mobile portrait — chip row is a single non-wrapping scrollable
// strip (scrollWidth > clientWidth, or a visible right-edge fade), and the
// full-width search input is hidden (only the search ICON shows).
{
  const scroll = await mp.evaluate(() => {
    const c = document.querySelector(".chiprow");
    return { scrollWidth: c.scrollWidth, clientWidth: c.clientWidth };
  });
  const scrollable = scroll.scrollWidth > scroll.clientWidth;
  console.log(`v9-04: chip row scrollWidth=${scroll.scrollWidth} clientWidth=${scroll.clientWidth} -> scrollable=${scrollable} (expect true)`);
  const searchboxVisible = await mp.locator(".searchbox").isVisible();
  const searchIconVisible = await mp.locator("#btn-search-toggle").isVisible();
  console.log(`v9-04: mobile portrait — full search input visible=${searchboxVisible} (expect false), search icon visible=${searchIconVisible} (expect true)`);
  await mp.screenshot({ path: `${OUT}/v9-04-mobile-chiprow-scrollable.png` });
}

// Subfield chip changes the Ranking chip's options (general mode: de
// Bruin/Leiter/Favourites -> field modes: Field ranking/Favourites) — same
// interaction surface (chips) now covers what the mobile-only dropdowns
// used to test pre-v9.
{
  const rankOptsBefore = await mp.locator("#menu-rank .chip-menu-item").allInnerTexts();
  await setMode(mp, "Ethics");
  await mp.waitForTimeout(400);
  const rankOptsAfter = await mp.locator("#menu-rank .chip-menu-item").allInnerTexts();
  const rankChanged = JSON.stringify(rankOptsBefore) !== JSON.stringify(rankOptsAfter);
  console.log(`mobile: rank menu items before=${JSON.stringify(rankOptsBefore)} after switching to Ethics & political=${JSON.stringify(rankOptsAfter)} -> changed=${rankChanged} (expect true)`);
  await mp.screenshot({ path: `${OUT}/m01c-mobile-subfield-ethics.png` });
  await setMode(mp, "General"); // revert for the rest of the mobile run
  await mp.waitForTimeout(300);
}

await openYearPicker(mp);
await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/m01d-window-year-open.png` }); // typed-year input still reachable via the Window chip menu
await mp.keyboard.press("Escape");
await setWindowPreset(mp, "365");
await mp.waitForTimeout(300);

// "All" view on a phone (single-column, chunked/lazy-rendered flat list)
await setView(mp, "All");
await mp.waitForTimeout(600);
await mp.screenshot({ path: `${OUT}/m01e-all-portrait.png` });
await setView(mp, "By venue");
await mp.waitForTimeout(400);

// v9-05: search icon tapped -> search input visible AND focused
{
  await mp.locator("#btn-search-toggle").click();
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: `${OUT}/v9-05-mobile-search-open.png` });
  const searchState = await mp.evaluate(() => {
    const el = document.querySelector("#search");
    return { visible: !!el && getComputedStyle(el).display !== "none", focused: document.activeElement === el };
  });
  console.log(`v9-05: mobile search after icon tap: ${JSON.stringify(searchState)} (expect both true)`);
  await mp.keyboard.press("Escape");
  await mp.waitForTimeout(200);
  const stillOpen = await mp.evaluate(() => document.body.classList.contains("search-open"));
  console.log(`v9-05: mobile search closed by Esc: ${!stillOpen} (expect true)`);
}

await openDisplay(mp, true);
await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/m02-display-popover.png` }); // bottom-sheet, must fit on screen
await mp.keyboard.press("Escape");
await mp.waitForTimeout(200);

await openFavorites(mp, true);
await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/m03-favorites-popover.png` });
await mp.keyboard.press("Escape");
await mp.waitForTimeout(200);

await mp.locator(".jcard .viewall").first().click();
await mp.waitForTimeout(400);
await mp.screenshot({ path: `${OUT}/m04-journal-popout.png` }); // 85vh modal on a small screen
await mp.keyboard.press("Escape");
await mp.waitForTimeout(200);

await mp.locator(".jbody .paper").first().click();
await mp.waitForTimeout(700);
await mp.screenshot({ path: `${OUT}/m05-paper-modal.png` });
await mp.keyboard.press("Escape");
await mp.waitForTimeout(200);

await setView(mp, "By topic");
await mp.waitForTimeout(500);
await mp.screenshot({ path: `${OUT}/m06-topic.png` });
await setView(mp, "By venue");
await mp.waitForTimeout(300);

// v9-07: phone portrait, card width 180 -> at least 2 columns of journal
// cards, no horizontal page overflow. (Card-width slider min is 160 — task
// 3/v9; the jgrid formula clamps minmax()'s floor to the container width.)
{
  await openDisplay(mp, true);
  await mp.waitForTimeout(300);
  await mp.fill("#cardw-slider", "180");
  await mp.locator("#cardw-slider").dispatchEvent("input");
  await mp.waitForTimeout(300);
  await mp.keyboard.press("Escape");
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: `${OUT}/v9-07-phone-2col-cards.png` });
  const cols = await mp.evaluate(() => {
    const cards = [...document.querySelectorAll(".jgrid .jcard")];
    if (!cards.length) return { cardCount: 0, firstRowCount: 0 };
    const firstTop = Math.round(cards[0].getBoundingClientRect().top);
    const firstRowCount = cards.filter((c) => Math.round(c.getBoundingClientRect().top) === firstTop).length;
    return { cardCount: cards.length, firstRowCount };
  });
  console.log(`v9-07: journal cards in the first grid row at 180px card-width on a 390px phone: ${cols.firstRowCount} (expect >= 2)`);
  const overflowNarrow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`v9-07: horizontal overflow at 180px card-width: ${overflowNarrow}px (should be <=0)`);
  // revert card width for the rest of the mobile run
  await openDisplay(mp, true);
  await mp.locator("#display-reset").click();
  await mp.keyboard.press("Escape");
  await mp.waitForTimeout(300);
}

// 3D — portrait: single-bookcase framing, touch-drag rotate, "Aim to view".
// Entered via the "⋯" menu on mobile (the standalone #btn-3d hides below
// the breakpoint).
await enter3D(mp, true);
await mp.waitForTimeout(2500);
await mp.screenshot({ path: `${OUT}/m07-3d-portrait.png` });

// single-finger touch-drag rotate. Playwright's mouse API dispatches real
// pointer events (which is what threeview.js listens for) even in a
// hasTouch/isMobile context, so this exercises the same onPointerMove path
// a finger-drag would — genuine multi-touch pinch isn't practical to
// simulate through page.mouse, so pinch-zoom is verified by code review
// (dollyBy() shared with the wheel handler) rather than a screenshot.
await mp.mouse.move(300, 420);
await mp.mouse.down();
await mp.mouse.move(70, 420, { steps: 15 });
await mp.mouse.up();
await mp.waitForTimeout(500);
await mp.screenshot({ path: `${OUT}/m08-3d-touch-rotate.png` });
// drag back to the home yaw before the aim tests below — otherwise gyro
// mode calibrates its baseline against this leftover rotation, and the
// yaw math in the comments there assumes a ~0 starting yaw
await mp.mouse.move(70, 420);
await mp.mouse.down();
await mp.mouse.move(300, 420, { steps: 15 });
await mp.mouse.up();
await mp.waitForTimeout(400);

// "Aim to view" — only visible because body.touch-device was set (this
// context has hasTouch:true). No real gyro in headless Chromium, so drive
// the camera with synthetic deviceorientation events instead.
await mp.locator("#btn-aim").click();
await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/m09-aim-toggle-on.png` });

await mp.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 10, beta: 5, gamma: 0 })));
await mp.waitForTimeout(150); // first event only calibrates the baseline
await mp.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 70, beta: 15, gamma: 0 })));
await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/m10-aim-camera-moved.png` }); // camera should have turned ~60°

// turn far enough to face away — gyro mode's yaw is deliberately unclamped
// (unlike drag), so this should keep turning smoothly past the point drag
// would have stopped at
await mp.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 195, beta: 10, gamma: 0 })));
await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/m11-aim-turned-away.png` });

// turn back toward the shelf
await mp.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 15, beta: 8, gamma: 0 })));
await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/m12-aim-turned-back.png` });

await mp.locator("#btn-aim").click(); // toggle off
await mp.waitForTimeout(300);
await mp.locator("#btn-exit-3d").click();
await mCtxP.close();

// ---- landscape (844×390) ----
const mCtxL = await browser.newContext({
  viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true,
  deviceScaleFactor: 3, userAgent: IPHONE_UA,
});
const ml = await mCtxL.newPage();
ml.on("console", (m) => { if (m.type() === "error") mobileErrors.push(`[landscape] ${m.text()}`); });
ml.on("pageerror", (e) => mobileErrors.push(`[landscape] ${e}`));

await ml.goto(BASE, { waitUntil: "networkidle" });
await ml.waitForTimeout(800);
await ml.screenshot({ path: `${OUT}/m13-venue-landscape.png` });

// header close-up (landscape) — the tightest case: only 390px of *height*
// to work with, so the compacted header must not eat most of the screen
await ml.locator("header.site").screenshot({ path: `${OUT}/m13a-header-landscape.png` });
{
  const overflowLandscape = await ml.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`landscape horizontal overflow: ${overflowLandscape}px (should be <=0)`);
}

await enter3D(ml, true);
await ml.waitForTimeout(2500);
await ml.screenshot({ path: `${OUT}/m14-3d-landscape.png` }); // single-bookcase framing, HUD not covering the scene

await ml.mouse.move(600, 200);
await ml.mouse.down();
await ml.mouse.move(200, 200, { steps: 15 });
await ml.mouse.up();
await ml.waitForTimeout(500);
await ml.screenshot({ path: `${OUT}/m15-3d-landscape-rotated.png` });

await ml.locator("#btn-exit-3d").click();
await mCtxL.close();

// ============================================================ persistence ==
// v9-06/v9-09: a FRESH, isolated browser context (own localStorage) so
// nothing from the rest of the run (dark mode toggles, favourites picks,
// etc.) leaks in or masks what's actually being persisted/restored.
const persErrors = [];
const persCtx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const pp = await persCtx.newPage();
pp.on("console", (m) => { if (m.type() === "error") persErrors.push(m.text()); });
pp.on("pageerror", (e) => persErrors.push(String(e)));

await pp.goto(BASE, { waitUntil: "networkidle" });
await pp.waitForTimeout(800);

// v9-09: favourite 2 journals, reload, confirm still favourited
await openFavorites(pp);
await pp.waitForTimeout(200);
const favRows = pp.locator("#fav-list .fav-row input");
await favRows.nth(0).click();
await favRows.nth(1).click();
await pp.waitForTimeout(200);
const favNamesBefore = await pp.locator("#fav-list .fav-row.checked .fav-name").allInnerTexts();
await pp.mouse.click(50, 50); // close popover
await pp.waitForTimeout(200);

// v9-06: set view=All, subfield=Ethics, window=90d, dark theme, card width
// 200, hide-authors on
await setView(pp, "All");
await pp.waitForTimeout(300);
await setMode(pp, "Ethics");
await pp.waitForTimeout(300);
await setWindowPreset(pp, "90");
await pp.waitForTimeout(300);
await toggleTheme(pp); // -> dark (default effective theme is light in headless Chromium)
await pp.waitForTimeout(300);
await openDisplay(pp);
await pp.waitForTimeout(200);
await pp.fill("#cardw-slider", "200");
await pp.locator("#cardw-slider").dispatchEvent("input");
await pp.locator('#details-seg button[data-details="hide"]').click();
await pp.waitForTimeout(200);
await openDisplay(pp); // close
await pp.waitForTimeout(300);

const beforeReload = await pp.evaluate(() => ({
  view: document.querySelector("#chip-view .chip-val").textContent,
  mode: document.querySelector("#chip-mode .chip-val").textContent,
  win: document.querySelector("#chip-win .chip-val").textContent,
  theme: document.documentElement.dataset.theme,
  cardMinW: getComputedStyle(document.documentElement).getPropertyValue("--card-min-w").trim(),
  hideAuthors: document.body.classList.contains("hide-authors"),
}));
console.log(`v9-06: state BEFORE reload: ${JSON.stringify(beforeReload)}`);
await pp.screenshot({ path: `${OUT}/v9-06a-before-reload.png` });

await pp.reload({ waitUntil: "networkidle" });
await pp.waitForTimeout(1000);

const afterReload = await pp.evaluate(() => ({
  view: document.querySelector("#chip-view .chip-val").textContent,
  mode: document.querySelector("#chip-mode .chip-val").textContent,
  win: document.querySelector("#chip-win .chip-val").textContent,
  theme: document.documentElement.dataset.theme,
  cardMinW: getComputedStyle(document.documentElement).getPropertyValue("--card-min-w").trim(),
  hideAuthors: document.body.classList.contains("hide-authors"),
  // .pmeta nodes stay IN the DOM (paperRow() always renders them) — CSS is
  // what hides them, so assert computed style, not element count/presence.
  pmetaVisibleCount: [...document.querySelectorAll(".pmeta")].filter((e) => getComputedStyle(e).display !== "none").length,
  favorites: JSON.parse(localStorage.getItem("philosopheed:prefs") || "{}").favorites || [],
}));
console.log(`v9-06: state AFTER reload: ${JSON.stringify(afterReload)}`);
const v906pass = afterReload.view === beforeReload.view && afterReload.mode === beforeReload.mode &&
  afterReload.win === beforeReload.win && afterReload.theme === "dark" &&
  afterReload.cardMinW === beforeReload.cardMinW && afterReload.hideAuthors === true &&
  afterReload.pmetaVisibleCount === 0;
console.log(`v9-06: ALL restored after reload -> ${v906pass ? "PASS" : "FAIL"}`);
await pp.screenshot({ path: `${OUT}/v9-06b-after-reload.png` });

// v9-09: favourites list persisted BY DEFAULT — checked directly off the
// stored prefs (not the Favourites popover's checkbox UI): that UI is
// filtered to the CURRENT Subfield mode (existing, intentional design —
// "journals absent from the current mode simply don't render, but keep
// their place in the list"), and v9-06 just switched mode to Ethics &
// political, under which Noûs/Philosophical Studies (General-only
// journals) correctly render as unchecked/absent. The underlying array is
// what "persisted by default" actually means here, so that's what's
// asserted; a follow-up check also confirms the popover UI reflects them
// again once back in General mode.
const v909pass = JSON.stringify(favNamesBefore.slice().sort()) ===
  JSON.stringify(afterReload.favorites.map((id) => ({ nous: "Noûs", "phil-studies": "Philosophical Studies" }[id] || id)).sort());
console.log(`v9-09: favourites before reload (checkbox names)=${JSON.stringify(favNamesBefore)}, ` +
  `stored favourites ids after reload=${JSON.stringify(afterReload.favorites)} -> ${v909pass ? "PASS" : "FAIL"}`);
await pp.screenshot({ path: `${OUT}/v9-09a-favorites-persisted-ethics-mode.png` }); // still Ethics mode here — Noûs/Phil Studies correctly not in this mode's list

await setMode(pp, "General");
await pp.waitForTimeout(300);
await openFavorites(pp);
await pp.waitForTimeout(200);
const favNamesAfterGeneral = await pp.locator("#fav-list .fav-row.checked .fav-name").allInnerTexts();
console.log(`v9-09: favourites checkbox UI back in General mode after reload: ${JSON.stringify(favNamesAfterGeneral)} (expect same 2 as before reload)`);
await pp.screenshot({ path: `${OUT}/v9-09b-favorites-persisted-general-mode.png` });

await persCtx.close();

// ==================================================== v11: since last visit ==
// Own isolated context (own localStorage) throughout, same reasoning as the
// persistence block above. K = the number of dois crafted "missing" from
// the baseline in the cases that need a concrete, assertable new-count.
const K = 3;
const v11Errors = [];
const v11Ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const vp = await v11Ctx.newPage();
vp.on("console", (m) => { if (m.type() === "error") v11Errors.push(m.text()); });
vp.on("pageerror", (e) => v11Errors.push(String(e)));

// v11-01: first visit — no markers anywhere, baseline stored silently.
await vp.goto(BASE, { waitUntil: "networkidle" });
await vp.waitForTimeout(800);
{
  const dotCount = await vp.locator(".newdot").count();
  const chipCount = await vp.locator(".newchip").count();
  const stored = await seenStorage(vp);
  const tsFresh = stored && Math.abs(Date.now() - stored.ts) < 15000;
  const idsOk = stored && Array.isArray(stored.ids) && stored.ids.length > 0;
  const pass = dotCount === 0 && chipCount === 0 && tsFresh && idsOk;
  console.log(`v11-01: first visit — dots=${dotCount} chips=${chipCount} (expect 0,0), ` +
    `stored philosopheed:seen ts fresh=${tsFresh} ids.length=${stored?.ids?.length ?? "null"} -> ${pass ? "PASS" : "FAIL"}`);
  await vp.screenshot({ path: `${OUT}/v11-01-first-visit-no-markers.png` });
}

// v11-02: crafted 8h-old baseline missing K ids (all from one low-volume,
// current-window, general-mode journal) — "+K new" chip on that one card,
// exactly K .newdot rows, nowhere else.
let craftInfo;
{
  craftInfo = await craftBaseline(vp, { ageMs: 8 * 3600e3, dropCount: K });
  await vp.reload({ waitUntil: "networkidle" });
  await vp.waitForTimeout(800);
  const dbg = await visitDebug(vp);
  const dotCount = await vp.locator(".newdot").count();
  const newChipSum = await vp.evaluate(() =>
    [...document.querySelectorAll(".newchip")].reduce((sum, el) => sum + (parseInt(el.textContent, 10) || 0), 0));
  const newChipCards = await vp.locator(".newchip").count();
  const pass = dbg.sinceVisitEligible === true && dbg.newCount === K &&
    newChipSum === K && dotCount === K && newChipCards === 1;
  console.log(`v11-02: crafted baseline (journal=${craftInfo.targetJournal}, dropped=${craftInfo.droppedCount}) — ` +
    `_visitDebug=${JSON.stringify(dbg)}, newChipSum=${newChipSum} (1 card), dotCount=${dotCount} -> ${pass ? "PASS" : "FAIL"} (expect eligible=true, newCount=${K}, chipSum=${K}, dots=${K})`);
  await vp.locator(".jcard").filter({ has: vp.locator(".newchip") }).first().scrollIntoViewIfNeeded();
  await vp.screenshot({ path: `${OUT}/v11-02-new-markers.png` });
}

// v11-03: Window chip menu — "Since last visit" enabled; selecting it
// filters ALL views to only new papers; chip label updates; count == K.
{
  await openWinMenu(vp);
  await vp.waitForTimeout(150);
  const menuState = await vp.evaluate(() => {
    const b = document.querySelector("#win-menu-since-visit");
    return { disabled: b.disabled, ariaDisabled: b.getAttribute("aria-disabled"), text: b.textContent.trim() };
  });
  console.log(`v11-03: "Since last visit" menu entry state: ${JSON.stringify(menuState)} (expect disabled=false, no "(no earlier visit yet)" hint)`);
  await vp.screenshot({ path: `${OUT}/v11-03a-since-visit-menu-enabled.png` });
  await vp.locator("#win-menu-since-visit").click();
  await vp.waitForTimeout(400);
  const chipVal = await vp.locator("#chip-win .chip-val").innerText();
  const rowCount = await vp.locator(".jbody .paper").count();
  const pass = chipVal === "since last visit" && rowCount === K && !menuState.disabled;
  console.log(`v11-03: after selecting — chip label="${chipVal}" (expect "since last visit"), rendered .paper rows=${rowCount} (expect ${K}) -> ${pass ? "PASS" : "FAIL"}`);
  await vp.screenshot({ path: `${OUT}/v11-03b-since-visit-filtered.png` });
}

// v11-04: reload after v11-03 — window pref restored to the previous REAL
// window (30 d, the default — never touched by the since-last-visit
// toggle), NOT stuck showing "since last visit".
{
  await vp.reload({ waitUntil: "networkidle" });
  await vp.waitForTimeout(800);
  const chipVal = await vp.locator("#chip-win .chip-val").innerText();
  const dbg = await visitDebug(vp);
  const rowCount = await vp.locator(".jbody .paper, .allbody .paper").count();
  const pass = chipVal === "30 d" && dbg.sinceLastVisit === false && rowCount > K;
  console.log(`v11-04: after reload — chip label="${chipVal}" (expect "30 d"), sinceLastVisit=${dbg.sinceLastVisit} (expect false), rows=${rowCount} (expect >${K}) -> ${pass ? "PASS" : "FAIL"}`);
  await vp.screenshot({ path: `${OUT}/v11-04-window-restored-after-reload.png` });
}

// v11-05: baseline only 30 min old — no markers, and the baseline is NOT
// rolled forward (persisted ts unchanged by the reload).
{
  await vp.evaluate(() => localStorage.clear());
  await vp.reload({ waitUntil: "networkidle" }); // fresh "first visit" — establishes a clean baseline to overwrite
  await vp.waitForTimeout(600);
  await craftBaseline(vp, { ageMs: 30 * 60e3, dropCount: 2 });
  const before = await seenStorage(vp);
  await vp.reload({ waitUntil: "networkidle" });
  await vp.waitForTimeout(800);
  const after = await seenStorage(vp);
  const dbg = await visitDebug(vp);
  const dotCount = await vp.locator(".newdot").count();
  const tsUnchanged = before && after && before.ts === after.ts;
  const pass = dotCount === 0 && dbg.sinceVisitEligible === false && tsUnchanged;
  console.log(`v11-05: 30min-old baseline — dots=${dotCount} (expect 0), eligible=${dbg.sinceVisitEligible} (expect false), ` +
    `stored ts before=${before?.ts} after=${after?.ts} unchanged=${tsUnchanged} -> ${pass ? "PASS" : "FAIL"}`);
  await vp.screenshot({ path: `${OUT}/v11-05-fresh-baseline-not-rolled.png` });
}

// v11-06: safety valve — 90% of ids missing (corrupt/ancient-looking
// baseline) — no markers, baseline reset immediately regardless of age.
{
  await vp.evaluate(() => localStorage.clear());
  await vp.reload({ waitUntil: "networkidle" }); // fresh first-visit baseline to overwrite
  await vp.waitForTimeout(600);
  await craftBaseline(vp, { ageMs: 8 * 3600e3, dropFraction: 0.9 });
  const before = await seenStorage(vp);
  await vp.reload({ waitUntil: "networkidle" });
  await vp.waitForTimeout(800);
  const after = await seenStorage(vp);
  const dbg = await visitDebug(vp);
  const dotCount = await vp.locator(".newdot").count();
  const chipCount = await vp.locator(".newchip").count();
  const resetHappened = after && before && after.ts > before.ts + 6 * 3600e3 - 5000; // bumped forward well past the crafted 8h-old ts
  const pass = dotCount === 0 && chipCount === 0 && dbg.sinceVisitEligible === false && resetHappened;
  console.log(`v11-06: safety valve (90% missing) — dots=${dotCount} chips=${chipCount} (expect 0,0), eligible=${dbg.sinceVisitEligible} (expect false), ` +
    `baseline ts before=${before?.ts} after=${after?.ts} reset=${resetHappened} -> ${pass ? "PASS" : "FAIL"}`);
  await vp.screenshot({ path: `${OUT}/v11-06-safety-valve-reset.png` });
}

await v11Ctx.close();

// v11-07: mobile portrait (390×844) with an 8h-old baseline missing K ids —
// "+N new" visible on a card without breaking the header/card layout.
const v11MobileErrors = [];
const v11MCtx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  deviceScaleFactor: 3, userAgent: IPHONE_UA,
});
const vm = await v11MCtx.newPage();
vm.on("console", (m) => { if (m.type() === "error") v11MobileErrors.push(m.text()); });
vm.on("pageerror", (e) => v11MobileErrors.push(String(e)));
{
  await vm.goto(BASE, { waitUntil: "networkidle" }); // first visit — establishes baseline
  await vm.waitForTimeout(600);
  const info = await craftBaseline(vm, { ageMs: 8 * 3600e3, dropCount: K });
  await vm.reload({ waitUntil: "networkidle" });
  await vm.waitForTimeout(800);
  const dotCount = await vm.locator(".newdot").count();
  const chipCount = await vm.locator(".newchip").count();
  const overflow = await vm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const cardEl = vm.locator(".jcard").filter({ has: vm.locator(".newchip") }).first();
  const headBox = await cardEl.locator(".jhead").boundingBox();
  const pass = dotCount === K && chipCount === 1 && overflow <= 0 && !!headBox;
  console.log(`v11-07: mobile portrait (journal=${info.targetJournal}) — dots=${dotCount} (expect ${K}), chips=${chipCount} (expect 1), ` +
    `horizontal overflow=${overflow}px (expect <=0), card head intact=${!!headBox} -> ${pass ? "PASS" : "FAIL"}`);
  await vm.screenshot({ path: `${OUT}/v11-07a-mobile-new-markers.png` });
  await cardEl.locator(".jhead").screenshot({ path: `${OUT}/v11-07b-mobile-newchip-head-closeup.png` });
}
await v11MCtx.close();

// ================================================ v12: favourites view split ==
// The old "Favourites" VIEW is now two: "Favourites by venue" (view id
// "favorites" — journal cards in favourites order, unchanged behaviour) and
// "All favourites" (view id "favall" — the All view's flat colour-coded
// lazy-chunked list, filtered to favourited journals). Own isolated context
// (own localStorage), same reasoning as the persistence block above.
const v12Errors = [];
const v12Ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const fp = await v12Ctx.newPage();
fp.on("console", (m) => { if (m.type() === "error") v12Errors.push(m.text()); });
fp.on("pageerror", (e) => v12Errors.push(String(e)));

await fp.goto(BASE, { waitUntil: "networkidle" });
await fp.waitForTimeout(800);

// v12-01: the VIEW chip menu offers BOTH new labels (and no plain
// "Favourites" item any more), and with zero favourites picked BOTH views
// show the shared friendly empty state — never a blank page.
{
  const items = await fp.locator("#menu-view .chip-menu-item").allInnerTexts();
  const expected = ["By venue", "By topic", "All", "Favourites by venue", "All favourites"];
  const menuPass = JSON.stringify(items) === JSON.stringify(expected);
  console.log(`v12-01: VIEW menu items=${JSON.stringify(items)} (expect ${JSON.stringify(expected)}) -> ${menuPass ? "PASS" : "FAIL"}`);

  await setView(fp, "Favourites by venue");
  await fp.waitForTimeout(300);
  const venueEmpty = await fp.locator(".fav-view-empty").count();
  const venueCards = await fp.locator(".jgrid .jcard").count();
  await fp.screenshot({ path: `${OUT}/v12-01a-fav-by-venue-empty.png` });

  await setView(fp, "All favourites");
  await fp.waitForTimeout(300);
  const favallEmpty = await fp.locator(".fav-view-empty").count();
  const favallRows = await fp.locator(".paper").count();
  await fp.screenshot({ path: `${OUT}/v12-01b-all-favourites-empty.png` });
  const pass = venueEmpty === 1 && venueCards === 0 && favallEmpty === 1 && favallRows === 0;
  console.log(`v12-01: empty states — by-venue: empty-msg=${venueEmpty} cards=${venueCards} (expect 1, 0); ` +
    `all-favourites: empty-msg=${favallEmpty} paper rows=${favallRows} (expect 1, 0) -> ${pass ? "PASS" : "FAIL"}`);
}

// v12-02: pick 3 favourites (top 3 in default rank order — pick order ==
// list order) while STILL on "All favourites": toggling a favourite must
// live-refresh this view, same as it always did for the old favourites view.
let favNames = [], favIds = [];
{
  await openFavorites(fp);
  await fp.waitForTimeout(200);
  const rows = fp.locator("#fav-list .fav-row input");
  await rows.nth(0).click();
  await rows.nth(1).click();
  await rows.nth(2).click();
  await fp.waitForTimeout(300);
  favNames = await fp.locator("#fav-list .fav-row.checked .fav-name").allInnerTexts();
  await fp.mouse.click(50, 50); // close popover
  await fp.waitForTimeout(400);
  favIds = await fp.evaluate(() => JSON.parse(localStorage.getItem("philosopheed:prefs") || "{}").favorites || []);
  const liveRows = await fp.locator(".allbody .paper").count();
  console.log(`v12-02: picked favourites ${JSON.stringify(favNames)} (ids=${JSON.stringify(favIds)}) — ` +
    `"All favourites" live-updated to ${liveRows} rows (expect > 0) -> ${liveRows > 0 ? "PASS" : "FAIL"}`);
}

// v12-03: "Favourites by venue" — only the 3 favourited journals, as cards,
// in FAVOURITES order (assert twice: pick order, then a reversed stored
// order after reload — cards must follow the favourites order, not rank).
{
  await setView(fp, "Favourites by venue");
  await fp.waitForTimeout(400);
  const stripCeased = (n) => n.replace(/\s*ceased\s*$/, "").trim();
  const cardNames = await fp.evaluate(() =>
    [...document.querySelectorAll(".jgrid .jcard .jname")].map((n) => n.textContent.replace(/\s*ceased\s*$/, "").trim()));
  const orderPass = JSON.stringify(cardNames) === JSON.stringify(favNames.map(stripCeased));
  await fp.screenshot({ path: `${OUT}/v12-03a-fav-by-venue-populated.png` });

  await fp.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("philosopheed:prefs"));
    p.favorites = p.favorites.slice().reverse();
    localStorage.setItem("philosopheed:prefs", JSON.stringify(p));
  });
  await fp.reload({ waitUntil: "networkidle" });
  await fp.waitForTimeout(800);
  const cardNamesRev = await fp.evaluate(() =>
    [...document.querySelectorAll(".jgrid .jcard .jname")].map((n) => n.textContent.replace(/\s*ceased\s*$/, "").trim()));
  const revPass = JSON.stringify(cardNamesRev) === JSON.stringify(favNames.map(stripCeased).reverse());
  const pass = cardNames.length === 3 && orderPass && revPass;
  console.log(`v12-03: "Favourites by venue" cards=${JSON.stringify(cardNames)} (expect the 3 picks in pick order), ` +
    `after reversing stored order + reload=${JSON.stringify(cardNamesRev)} (expect reversed) -> ${pass ? "PASS" : "FAIL"}`);
  await fp.screenshot({ path: `${OUT}/v12-03b-fav-by-venue-reordered.png` });
}

// v12-04: "All favourites" — flat list containing ONLY papers from the
// favourited journals, colour-coded venue names, newest-first (the All
// view's own ordering), and the header total matches an independent
// recomputation from recent.json (same 30 d window math the app uses).
{
  await setView(fp, "All favourites");
  await fp.waitForTimeout(500);
  const headTitle = await fp.locator(".allcard .jname").innerText();
  const check = await fp.evaluate(async () => {
    const favs = JSON.parse(localStorage.getItem("philosopheed:prefs")).favorites;
    const favSet = new Set(favs);
    const [recent, registry] = await Promise.all([
      fetch(new URL("./data/recent.json", location.href).href).then((r) => r.json()),
      fetch(new URL("./data/journals.json", location.href).href).then((r) => r.json()),
    ]);
    const nameById = new Map(registry.journals.map((j) => [j.id, j.name]));
    const favNameSet = new Set(favs.map((id) => nameById.get(id)));
    const cut = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const expectedTotal = recent.filter((r) => favSet.has(r.journal) && r.published >= cut).length;
    const rows = [...document.querySelectorAll(".allbody .paper")];
    const journals = rows.map((p) => p.querySelector(".pj").textContent.replace(/^●\s*/, "").trim());
    const onlyFavs = rows.length > 0 && journals.every((n) => favNameSet.has(n));
    const colored = rows.length > 0 && rows.every((p) => !!p.querySelector(".pj").style.color);
    const dates = rows.map((p) => p.querySelector(".pmeta").textContent.trim().slice(-10));
    const newestFirst = dates.every((d, i) => i === 0 || dates[i - 1] >= d);
    const total = Number(document.querySelector(".allcard .jcount b").textContent.replace(/,/g, ""));
    return { rowCount: rows.length, journals: [...new Set(journals)], onlyFavs, colored, newestFirst, total, expectedTotal };
  });
  const pass = headTitle === "All favourites" && check.onlyFavs && check.colored &&
    check.newestFirst && check.total === check.expectedTotal;
  console.log(`v12-04: "All favourites" — title="${headTitle}" (expect "All favourites"), rows in DOM=${check.rowCount}, ` +
    `venues present=${JSON.stringify(check.journals)} all favourited=${check.onlyFavs}, colour-coded=${check.colored}, ` +
    `newest-first=${check.newestFirst}, header total=${check.total} vs independently computed=${check.expectedTotal} -> ${pass ? "PASS" : "FAIL"}`);
  await fp.screenshot({ path: `${OUT}/v12-04-all-favourites-desktop.png` });
}

// v12-05: the All view's lazy chunked rendering applies to "All favourites"
// too — on the 5 yr window the DOM holds only the first chunk(s) up front,
// and scrolling pulls in more.
{
  await setWindowPreset(fp, "1826");
  await fp.waitForTimeout(3000);
  const before = await fp.locator(".allbody .paper").count();
  const total = Number((await fp.locator(".allcard .jcount b").innerText()).replace(/,/g, ""));
  await fp.mouse.wheel(0, 5000);
  await fp.waitForTimeout(600);
  const after = await fp.locator(".allbody .paper").count();
  const pass = total > before && after > before;
  console.log(`v12-05: "All favourites" on 5 yr — ${before} rows in DOM of ${total} total (expect DOM < total: lazy), ` +
    `after scroll=${after} (expect > ${before}) -> ${pass ? "PASS" : "FAIL"}`);
  await fp.screenshot({ path: `${OUT}/v12-05-all-favourites-lazy-5yr.png` });
  await setWindowPreset(fp, "30"); // revert to the default window
  await fp.waitForTimeout(500);
}

// v12-06: the new view persists across reload like the others (stored under
// philosopheed:prefs — the "All favourites" pick above was made via the UI).
{
  await fp.reload({ waitUntil: "networkidle" });
  await fp.waitForTimeout(800);
  const chipVal = await fp.locator("#chip-view .chip-val").innerText();
  const allcard = await fp.locator(".allcard").count();
  const rows = await fp.locator(".allbody .paper").count();
  const pass = chipVal === "All favourites" && allcard === 1 && rows > 0;
  console.log(`v12-06: after reload — VIEW chip="${chipVal}" (expect "All favourites"), .allcard present=${allcard === 1}, ` +
    `rows=${rows} (expect > 0) -> ${pass ? "PASS" : "FAIL"}`);
  await fp.screenshot({ path: `${OUT}/v12-06-favall-persists-reload.png` });
}

// v12-07: "new since your last visit" accent dots work in "All favourites"
// exactly as in the All view — craft a baseline missing K papers from one
// journal, favourite ONLY that journal, and expect the same dot count in
// both views (the All view is fully lazy-loaded before counting).
{
  const K12 = 3;
  const info = await craftBaseline(fp, { ageMs: 8 * 3600e3, dropCount: K12 });
  await fp.evaluate((jid) => {
    const p = JSON.parse(localStorage.getItem("philosopheed:prefs"));
    p.favorites = [jid];
    localStorage.setItem("philosopheed:prefs", JSON.stringify(p));
  }, info.targetJournal);
  await fp.reload({ waitUntil: "networkidle" });
  await fp.waitForTimeout(800);
  const favallDots = await fp.locator(".allbody .newdot").count();
  await fp.locator(".allbody .paper.is-new").first().scrollIntoViewIfNeeded().catch(() => {});
  await fp.screenshot({ path: `${OUT}/v12-07-favall-new-dots.png` });
  await setView(fp, "All");
  await fp.waitForTimeout(500);
  for (let i = 0; i < 60 && await fp.locator(".all-sentinel").count(); i++) {
    await fp.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await fp.waitForTimeout(250);
  }
  const allDots = await fp.locator(".allbody .newdot").count();
  const pass = favallDots === K12 && allDots === K12;
  console.log(`v12-07: ${K12} crafted-new papers on ${info.targetJournal} (the only favourite) — ` +
    `.newdot count in "All favourites"=${favallDots}, in fully-loaded "All"=${allDots} (expect ${K12} in both) -> ${pass ? "PASS" : "FAIL"}`);
}

await v12Ctx.close();

// v12-08: mobile portrait (390×844) — "All favourites" renders with no
// horizontal page overflow (chip row scrolls; the longer labels are fine).
const v12MErrors = [];
const v12MCtx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  deviceScaleFactor: 3, userAgent: IPHONE_UA,
});
const fm = await v12MCtx.newPage();
fm.on("console", (m) => { if (m.type() === "error") v12MErrors.push(`[v12 mobile] ${m.text()}`); });
fm.on("pageerror", (e) => v12MErrors.push(`[v12 mobile] ${e}`));
{
  await fm.goto(BASE, { waitUntil: "networkidle" }); // first visit — seeds baseline/prefs
  await fm.waitForTimeout(600);
  await fm.evaluate((ids) => {
    const p = JSON.parse(localStorage.getItem("philosopheed:prefs") || "{}");
    p.favorites = ids;
    p.view = "favall";
    localStorage.setItem("philosopheed:prefs", JSON.stringify(p));
  }, favIds);
  await fm.reload({ waitUntil: "networkidle" });
  await fm.waitForTimeout(800);
  const chipVal = await fm.locator("#chip-view .chip-val").innerText();
  const rows = await fm.locator(".allbody .paper").count();
  const overflow = await fm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const pass = chipVal === "All favourites" && rows > 0 && overflow <= 0;
  console.log(`v12-08: mobile 390px portrait "All favourites" — VIEW chip="${chipVal}" (expect "All favourites"), ` +
    `rows=${rows} (expect > 0), horizontal overflow=${overflow}px (expect <=0) -> ${pass ? "PASS" : "FAIL"}`);
  await fm.screenshot({ path: `${OUT}/v12-08-all-favourites-mobile.png` });
}
await v12MCtx.close();

await browser.close();
console.log("console/page errors:", errors.length ? errors : "none");
console.log("mobile console/page errors:", mobileErrors.length ? mobileErrors : "none");
console.log("persistence-context console/page errors:", persErrors.length ? persErrors : "none");
console.log("v11 (since-last-visit) context console/page errors:", v11Errors.length ? v11Errors : "none");
console.log("v11 mobile console/page errors:", v11MobileErrors.length ? v11MobileErrors : "none");
console.log("v12 (favourites view split) console/page errors:", v12Errors.length ? v12Errors : "none");
console.log("v12 mobile console/page errors:", v12MErrors.length ? v12MErrors : "none");
if (errors.length || mobileErrors.length || persErrors.length || v11Errors.length || v11MobileErrors.length ||
    v12Errors.length || v12MErrors.length) process.exitCode = 1;
