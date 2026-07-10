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

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/01-venue.png` }); // default view: book-style cards, light mode

// task 12: desktop header — full segmented View/Ranking/Window rows (NOT
// the compact dropdowns, which only take over below the mobile breakpoint)
await page.locator("header.site").screenshot({ path: `${OUT}/01a-desktop-header.png` });
{
  const ddVisible = await page.locator("#view-dd-wrap").isVisible();
  const segVisible = await page.locator("#view-seg").isVisible();
  console.log(`Desktop header: dropdowns visible=${ddVisible} (expect false), segmented rows visible=${segVisible} (expect true)`);
}

// v8-05: top .site-row no longer carries the old unlabelled #mode-seg — it
// moved into .subrow as the labelled "Subfield" group (see v8-03 below).
{
  const modeInTopRow = await page.evaluate(() => {
    const row = document.querySelector(".site-row");
    const seg = document.querySelector("#mode-seg");
    return !!(row && seg && row.contains(seg));
  });
  console.log(`v8-05: #mode-seg inside top .site-row: ${modeInTopRow} (expect false)`);
  await page.locator(".site-row").screenshot({ path: `${OUT}/v8-05-top-row-no-mode-seg.png` });
}

// v8-03: desktop .subrow now shows View · Subfield · Ranking · Window groups
// (Subfield immediately after View, matching the existing pattern).
{
  const labels = await page.locator(".subrow > .label").allInnerTexts();
  console.log(`v8-03: .subrow group labels: ${JSON.stringify(labels)} (expect ["View","Subfield","Ranking","Window"])`);
  const modeInSubrow = await page.evaluate(() => {
    const sub = document.querySelector(".subrow");
    const seg = document.querySelector("#mode-seg");
    return !!(sub && seg && sub.contains(seg));
  });
  console.log(`v8-03: #mode-seg inside .subrow: ${modeInSubrow} (expect true)`);
  await page.locator(".subrow").screenshot({ path: `${OUT}/v8-03-subrow-desktop.png` });
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
await page.locator('#view-seg button[data-v="topic"]').click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/04-topic.png` });

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
await page.locator('#view-seg button[data-v="all"]').click();
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
  await page.locator('#win-seg button[data-w="all"]').click();
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
await page.locator('#win-seg button[data-w="365"]').click();
await page.waitForTimeout(800);
await page.locator('#view-seg button[data-v="venue"]').click();
await page.waitForTimeout(400);

// ------------------------------------------------------------- 7d preset --
await page.locator('#win-seg button[data-w="7"]').click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/04g-7d-window.png` });

// -------------------------------------------------------- custom window --
// open the inline picker, apply a short custom window (3 weeks — no
// partial-data note expected), then a long one (10 years — past 5 years,
// partial-data note expected). Label on the seg button itself should update.
await page.locator("#win-custom").click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/04h-custom-picker-open.png` }); // inline UI visible, defaults (3 weeks)
await page.fill("#custom-n", "3");
await page.selectOption("#custom-unit", "weeks");
await page.locator("#custom-apply").click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/04i-custom-3weeks-applied.png` }); // seg button label -> "Custom: 3 weeks", no coverage note

await page.fill("#custom-n", "10");
await page.selectOption("#custom-unit", "years");
await page.locator("#custom-apply").click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/04j-custom-10years-coverage-note.png` }); // partial-data note should now show

// revert to the default window for the remaining desktop shots
await page.locator('#win-seg button[data-w="365"]').click();
await page.waitForTimeout(600);

// leiter ranking toggle (back on venue)
await page.locator('#view-seg button[data-v="venue"]').click();
await page.locator("#rank-seg button", { hasText: "Leiter" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/05-leiter.png` });

// ethics mode
await page.locator("#mode-seg button", { hasText: "Ethics" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/06-ethics.png` });

// search
await page.locator("#mode-seg button", { hasText: "General" }).click();
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
await page.locator('#win-seg button[data-w="1826"]').click();
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
await page.locator('#win-seg button[data-w="all"]').click();
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
  await page.locator('#win-seg button[data-w="365"]').click();
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
await page.locator('#win-seg button[data-w="year"]').click();
await page.fill("#yearinput", "2003");
await page.locator("#yearinput").press("Enter");
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/09e-year-2003-coverage-note.png` });

// journal popout ("View all") — full list in a scroll-capped modal
await page.locator('#win-seg button[data-w="365"]').click();
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

// about modal (light mode) — new copy, dynamic "Data last updated" line
// rendered in the viewer's local timezone (headless Chromium's default TZ)
await page.locator("#btn-about").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/11-about.png` });
await page.locator("#about-close").click();
await page.waitForTimeout(200);

// -------------------------------------------------------- favourites view --
// task 13: "Favourites" as a VIEW option (distinct from the Favourites
// RANKING option below) — empty state first, before any favourites exist
{
  await page.locator('#view-seg button[data-v="favorites"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/20a-favorites-view-empty.png` });
  await page.locator('#view-seg button[data-v="venue"]').click();
  await page.waitForTimeout(300);
}

// ------------------------------------------------------------ favourites --
// pick the top 3 ranked journals (positional — robust to naming) in order,
// confirm circled-number badges appear, then switch to Favourites ranking
{
  await page.locator("#btn-favorites").click();
  await page.waitForTimeout(200);
  const rows = page.locator("#fav-list .fav-row input");
  await rows.nth(0).click();
  await rows.nth(1).click();
  await rows.nth(2).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/20-favorites-dropdown.png` });
  await page.locator("#fav-persist").click(); // opt in to persistence

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

  await page.locator("#rank-seg button", { hasText: "Favourites" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/21-favorites-ranking-2d.png` }); // reflects the re-ordered ranks

  // task 13: Favourites VIEW (not ranking) — only the favourited journals,
  // in favourites order, as ordinary cards. Revert ranking to de Bruin
  // first so this isn't conflated with the ranking-mode shot above.
  await page.locator("#rank-seg button", { hasText: "de Bruin" }).click();
  await page.waitForTimeout(300);
  await page.locator('#view-seg button[data-v="favorites"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/20e-favorites-view-populated.png` });
  await page.locator('#view-seg button[data-v="venue"]').click();
  await page.waitForTimeout(300);
}

// feed width — "Max" preset (replaces the old Wide toggle) + card style /
// feed width controls visible in the Display popover. The popover stays
// open across these clicks (only closes on an outside click or a second
// #btn-display click — don't re-click #btn-display mid-sequence, it toggles).
await page.locator("#btn-display").click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/22-display-popover.png` }); // shows card-style + feed-width (all 4 presets) + Font row, unclipped
await page.locator('#feedwidth-seg button[data-fw="max"]').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/23-feedwidth-max.png` });
await page.locator('#feedwidth-seg button[data-fw="default"]').click(); // revert

// Basic card style (proves the Book/Basic toggle actually changes the look)
await page.locator('#cardstyle-seg button[data-cs="basic"]').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/24-cardstyle-basic.png` });
await page.locator('#cardstyle-seg button[data-cs="book"]').click(); // revert to book (default)
await page.locator("#btn-display").click(); // close popover
await page.waitForTimeout(200);

// font toggle: Serif — venue titles + paper modal (moved from a standalone
// header button into the Display popover as a Font: Sans/Serif row in v7)
await page.locator("#btn-display").click();
await page.waitForTimeout(200);
await page.locator('#font-seg button[data-font="serif"]').click();
await page.waitForTimeout(200);
await page.locator("#btn-display").click(); // close popover
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/12-serif-venue.png` });
await page.locator(".jbody .paper").first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/13-serif-modal.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// Display popover open, sliders moved
await page.locator("#btn-display").click();
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
await page.locator("#btn-display").click();
await page.locator("#display-reset").click(); // resets zoom/card sliders/feed width/card style AND font (serif -> sans)
await page.locator("#btn-display").click();
await page.waitForTimeout(300);
// undo the favourites ranking pick so 3D shots start from de Bruin ranking
await page.locator("#rank-seg button", { hasText: "de Bruin" }).click();
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

await page.locator("#btn-3d").click();
await page.waitForTimeout(2500);

// v10-01: home view — single bookcase, all shelves populated, specialist
// shelf labels visible. Zoom out a bit first so the whole (now taller,
// single-carcass) case — general shelves plus the three specialist zones
// stacked below them — fits in frame together.
await page.mouse.wheel(0, 1400); // dollyBy(-deltaY*0.012): positive deltaY zooms OUT
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/v10-01-3d-home-single-case.png` });
await page.mouse.wheel(0, -1400); // back to the home dolly level
await page.waitForTimeout(400);

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
  await page.locator("#rank-seg-3d button", { hasText: "de Bruin" }).click(); // revert
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
await page.locator("#btn-theme").click();
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
await page.locator("#btn-about").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/25a-about-dark.png` });
await page.locator("#about-close").click();
await page.waitForTimeout(200);

// dark mode with the new controls visible: serif on, Max feed width, Display open
await page.locator("#btn-display").click();
await page.locator('#font-seg button[data-font="serif"]').click();
await page.locator('#feedwidth-seg button[data-fw="max"]').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/26-dark-controls.png` });
await page.locator("#btn-display").click(); // close popover
await page.waitForTimeout(200);
// revert font + feed width so later shots aren't affected
await page.locator("#btn-display").click();
await page.locator('#font-seg button[data-font="sans"]').click();
await page.locator('#feedwidth-seg button[data-fw="default"]').click();
await page.locator("#btn-display").click();
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
  await page.locator("#btn-theme").click(); // back to light
  await page.waitForTimeout(300);
  const scrollbarColorLight = await page.evaluate(() => getComputedStyle(document.querySelector(".jbody")).scrollbarColor);
  console.log(`Light-mode .jbody scrollbar-color: "${scrollbarColorLight}" (expect "auto" — unaffected)`);
  await page.locator("#btn-theme").click(); // back to dark for the rest of the desktop run
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
await mp.screenshot({ path: `${OUT}/m01-venue-portrait.png` }); // single-column cards, header wraps

// header close-up (portrait) — compacted chrome, no horizontal overflow;
// view selector ("All" now present) + window controls (7d/Custom… now
// present) must still be reachable (wrapped), not cut off
await mp.locator("header.site").screenshot({ path: `${OUT}/m01a-header-portrait.png` });
// journal card head close-up (portrait) — compacted card top, "View all"
// inline with the count rather than stacked over the sparkline
await mp.locator(".jcard").first().locator(".jhead").screenshot({ path: `${OUT}/m01b-jcard-head-portrait.png` });
{
  const overflowPortrait = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`portrait horizontal overflow: ${overflowPortrait}px (should be <=0)`);
}

// task 12: View/Ranking/Window are compact dropdowns on mobile now — the
// segmented rows are display:none below this breakpoint, so drive them via
// the dropdowns (what a real user would tap) rather than the hidden buttons
{
  const segVisible = await mp.locator("#view-seg").isVisible();
  const ddVisible = await mp.locator("#view-dd-wrap").isVisible();
  console.log(`Mobile portrait: view-seg visible=${segVisible} (expect false), view-dd-wrap visible=${ddVisible} (expect true)`);
}

// v8-04: mobile portrait — four dropdowns (View/Subfield/Ranking/Window) all
// visible in .subrow, then switch Subfield to "Ethics & political" and
// assert the Ranking dropdown's options change accordingly (general mode:
// de Bruin/Leiter/Favourites -> field modes: Field ranking/Favourites).
{
  const ddVis = {
    view: await mp.locator("#view-dd-wrap").isVisible(),
    mode: await mp.locator("#mode-dd-wrap").isVisible(),
    rank: await mp.locator("#rank-dd-wrap").isVisible(),
    win: await mp.locator("#win-dd-wrap").isVisible(),
  };
  console.log(`v8-04: mobile dropdowns visible: ${JSON.stringify(ddVis)} (expect all true)`);
  await mp.screenshot({ path: `${OUT}/v8-04a-mobile-four-dropdowns.png` });

  const rankOptsBefore = await mp.locator("#rank-dd option").allTextContents();
  await mp.selectOption("#mode-dd", "ethics");
  await mp.waitForTimeout(400);
  const rankOptsAfter = await mp.locator("#rank-dd option").allTextContents();
  const rankChanged = JSON.stringify(rankOptsBefore) !== JSON.stringify(rankOptsAfter);
  console.log(`v8-04: rank-dd options before=${JSON.stringify(rankOptsBefore)} after switching to Ethics & political=${JSON.stringify(rankOptsAfter)} -> changed=${rankChanged} (expect true)`);
  await mp.screenshot({ path: `${OUT}/v8-04b-mobile-subfield-ethics.png` });

  await mp.selectOption("#mode-dd", "general"); // revert for the rest of the mobile run
  await mp.waitForTimeout(300);
}

await mp.selectOption("#win-dd", "year");
await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/m01d-window-dd-year-open.png` }); // typed-year input still reachable via the dropdown flow
await mp.selectOption("#win-dd", "365");
await mp.waitForTimeout(300);

// "All" view on a phone (single-column, chunked/lazy-rendered flat list)
await mp.selectOption("#view-dd", "all");
await mp.waitForTimeout(600);
await mp.screenshot({ path: `${OUT}/m01c-all-portrait.png` });
await mp.selectOption("#view-dd", "venue");
await mp.waitForTimeout(400);

await mp.locator("#btn-display").click();
await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/m02-display-popover.png` }); // bottom-sheet, must fit on screen
await mp.locator("#btn-display").click();
await mp.waitForTimeout(200);

await mp.locator("#btn-favorites").click();
await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/m03-favorites-popover.png` });
await mp.locator("#btn-favorites").click();
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

await mp.selectOption("#view-dd", "topic");
await mp.waitForTimeout(500);
await mp.screenshot({ path: `${OUT}/m06-topic.png` });
await mp.selectOption("#view-dd", "venue");
await mp.waitForTimeout(300);

// 3D — portrait: single-bookcase framing, touch-drag rotate, "Aim to view"
await mp.locator("#btn-3d").click();
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

await ml.locator("#btn-3d").click();
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

await browser.close();
console.log("console/page errors:", errors.length ? errors : "none");
console.log("mobile console/page errors:", mobileErrors.length ? mobileErrors : "none");
if (errors.length || mobileErrors.length) process.exitCode = 1;
