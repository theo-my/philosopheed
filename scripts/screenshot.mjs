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

// about modal (light mode) — new copy, dynamic "Data last updated" line
// rendered in the viewer's local timezone (headless Chromium's default TZ)
await page.locator("#btn-about").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/11-about.png` });
await page.locator("#about-close").click();
await page.waitForTimeout(200);

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
  await page.mouse.click(50, 50); // close popover
  await page.waitForTimeout(200);

  await page.locator("#rank-seg button", { hasText: "Favourites" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/21-favorites-ranking-2d.png` });
}

// feed width — "Max" preset (replaces the old Wide toggle) + card style /
// feed width controls visible in the Display popover. The popover stays
// open across these clicks (only closes on an outside click or a second
// #btn-display click — don't re-click #btn-display mid-sequence, it toggles).
await page.locator("#btn-display").click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/22-display-popover.png` }); // shows card-style + feed-width controls
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

// serif toggle on — venue titles + paper modal
await page.locator("#btn-serif").click();
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
await page.locator("#display-reset").click();
await page.locator("#btn-display").click();
await page.locator("#btn-serif").click(); // revert serif for subsequent shots
await page.waitForTimeout(300);
// undo the favourites ranking pick so 3D shots start from de Bruin ranking
await page.locator("#rank-seg button", { hasText: "de Bruin" }).click();
await page.waitForTimeout(300);

// ------------------------------------------------------------------- 3D --
await page.locator("#btn-3d").click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/15-3d.png` });

// discovery hint should be visible shortly after entering 3D, before its
// 10s auto-dismiss or a big rotation
await page.screenshot({ path: `${OUT}/15b-discovery-hint.png` });

// click 3 top-shelf books (well clear of the lectern row below) — each
// opens onto the next free lectern (title legible)
for (const x of [260, 500, 750]) {
  await page.mouse.click(x, 260);
  await page.waitForTimeout(900);
}
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/16-lecterns-open-books.png` });

// click the first occupied lectern's open book — today's fly-to reading pane.
// Lecterns fill left-to-right in click order, so the first placed book sits
// on the leftmost lectern; probe a small grid around its expected position
// rather than a single guessed pixel (camera framing can shift a little).
{
  let opened = false;
  for (const [x, y] of [[180, 455], [200, 470], [160, 440], [220, 490]]) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(1200);
    if (await page.locator("#pg-close").isVisible().catch(() => false)) { opened = true; break; }
  }
  if (!opened) console.log("WARNING: could not open the lectern reading pane — check 16-lecterns-open-books.png for actual book position");
  await page.screenshot({ path: `${OUT}/17-lectern-reading-pane.png` });
  if (opened) {
    // close the book (back to the lectern row, not the shelf — book stays put)
    await page.locator("#pg-close").click();
    await page.waitForTimeout(1200);
  }
}

// rotate the camera (look-around drag, not an orbit of the bookcase) toward
// a labelled side shelf
await page.mouse.move(750, 470);
await page.mouse.down();
await page.mouse.move(120, 470, { steps: 24 });
await page.mouse.up();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/18-side-shelf-rotated.png` });
// rotate back toward home for the remaining shots
await page.mouse.move(120, 470);
await page.mouse.down();
await page.mouse.move(750, 470, { steps: 24 });
await page.mouse.up();
await page.waitForTimeout(600);

// Favourites in 3D: "Open favourites" places the top N onto the lecterns
await page.locator("#btn-3d-open-favs").click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/19-3d-open-favorites.png` });

// dark mode
await page.locator("#btn-exit-3d").click();
await page.locator("#btn-theme").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/25-dark.png` }); // book-style cards, dark mode

// about modal (dark mode) — confirm the new copy/links read fine on dark surface
await page.locator("#btn-about").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/25a-about-dark.png` });
await page.locator("#about-close").click();
await page.waitForTimeout(200);

// dark mode with the new controls visible: serif on, Max feed width, Display open
await page.locator("#btn-serif").click();
await page.locator("#btn-display").click();
await page.locator('#feedwidth-seg button[data-fw="max"]').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/26-dark-controls.png` });

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

// "All" view on a phone (single-column, chunked/lazy-rendered flat list)
await mp.locator('#view-seg button[data-v="all"]').click();
await mp.waitForTimeout(600);
await mp.screenshot({ path: `${OUT}/m01c-all-portrait.png` });
await mp.locator('#view-seg button[data-v="venue"]').click();
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

await mp.locator('#view-seg button[data-v="topic"]').click();
await mp.waitForTimeout(500);
await mp.screenshot({ path: `${OUT}/m06-topic.png` });
await mp.locator('#view-seg button[data-v="venue"]').click();
await mp.waitForTimeout(300);

// 3D — portrait: framing, touch-drag rotate, "Aim to view"
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

// turn far enough to face away — gyro mode is unclamped, so this should
// reveal the rear-hemisphere "bookshelves are behind you" sign
await mp.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 195, beta: 10, gamma: 0 })));
await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/m11-aim-rear-sign.png` });

// turn back toward the shelf — sign should disappear (with hysteresis)
await mp.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 15, beta: 8, gamma: 0 })));
await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/m12-aim-rear-sign-gone.png` });

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
await ml.screenshot({ path: `${OUT}/m14-3d-landscape.png` }); // shelf + lecterns framing, HUD not covering the scene

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
