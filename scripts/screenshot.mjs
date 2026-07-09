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
await page.screenshot({ path: `${OUT}/01-venue.png` });

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
{
  const synCard = page.locator(".jcard", { hasText: "Synthese" }).first();
  await synCard.scrollIntoViewIfNeeded();
  await synCard.locator(":scope > .showmore").click(); // outer "All N papers" -> expand
  await page.waitForTimeout(400);
  const innerShowAll = synCard.locator(".jbody > .showmore");
  if (await innerShowAll.count()) await innerShowAll.click(); // reveal full ~2,800-row list
  await page.waitForTimeout(500);
  await synCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/09-synthese-5yr-expanded.png` });
  await synCard.locator(":scope > .showmore", { hasText: "Collapse" }).click(); // collapse back
  await page.waitForTimeout(300);
}

// "Since 2000" full-archive window — on-demand year-file stitching, must not
// freeze the UI or blow up journal counts/sparklines
await page.locator('#win-seg button[data-w="all"]').click();
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/09b-since-2000.png` });

// typed-year control: type a year >5 years back — coverage note should appear
await page.locator('#win-seg button[data-w="year"]').click();
await page.fill("#yearinput", "2003");
await page.locator("#yearinput").press("Enter");
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/09c-year-2003-coverage-note.png` });

// journal popout ("View all") — full list in a scroll-capped modal
await page.locator('#win-seg button[data-w="365"]').click();
await page.waitForTimeout(800);
await page.locator(".jcard .viewall").first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/10-journal-popout.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// wide mode
await page.locator("#btn-wide").click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/11-wide-mode.png` });
await page.locator("#btn-wide").click(); // revert for subsequent shots
await page.waitForTimeout(300);

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

// 3D mode
await page.locator("#btn-3d").click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/15-3d.png` });
// click near center-top where rank-1 pane sits
await page.mouse.click(750, 420);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/16-3d-selected.png` });

// dark mode
await page.locator("#btn-exit-3d").click();
await page.locator("#btn-theme").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/17-dark.png` });

// dark mode with the new controls visible: re-enable serif + wide, open Display
await page.locator("#btn-serif").click();
await page.locator("#btn-wide").click();
await page.locator("#btn-display").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/18-dark-controls.png` });

await browser.close();
console.log("console/page errors:", errors.length ? errors : "none");
