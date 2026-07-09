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
await page.fill("#search", "");

// 5-year window
await page.locator('#win-seg button[data-w="1826"]').click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/08-5yr.png` });

// 3D mode
await page.locator("#btn-3d").click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/09-3d.png` });
// click near center-top where rank-1 pane sits
await page.mouse.click(750, 420);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/10-3d-selected.png` });

// dark mode
await page.locator("#btn-exit-3d").click();
await page.locator("#btn-theme").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/11-dark.png` });

await browser.close();
console.log("console/page errors:", errors.length ? errors : "none");
