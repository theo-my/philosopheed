/* Philosopheed — 3D bookshelf view.
   Journals are books on ranked shelves (spine width ∝ volume, spine colour =
   cover colour): a main shelf (current mode) plus two labelled side-shelf
   wings holding the specialist sets (ethics & political / philosophy of
   science / technology & AI) — each wing is hinged flush against the main
   case's own side wall, so the whole thing reads as one continuous piece of
   furniture rather than three floating boxes. A row of lecterns sits close
   in front of the main shelf, distinctly below eye level, angled like
   reading stands: click a shelf book and it opens onto the next free
   lectern as a legible open two-page display; click that OCCUPIED lectern
   again to read its papers — the camera never moves, a screen-space panel
   opens in front of you instead; click a lectern's ↩ to reshelve it.
   Taking a book off the shelf leaves a ghosted marker with its own ↩
   Return at the empty slot. Drag looks around (camera orientation only,
   ~180° yaw clamp); scroll dollies the camera in/out. */
import * as THREE from "three";

let ctx = null;
let renderer, scene, camera, raycaster, pointer;
let books = [];            // {mesh, journal, home, out, lecternIndex, rotY, ghost} — main + both side shelves
let mainGroup = null, leftGroup = null, rightGroup = null, lecternGroup = null;
let spreadState = null;    // {journal, papers, page, pages} — the reading-panel content
let selected = null;       // book currently open in the reading panel
let running = false, built = false;
let lecterns = [];         // {index, occupant, occupiedAt, bookPos, displayGroup, displayMeshes, returnMesh}
let lecternClock = 0;
let RETURN_TEX = null, GHOST_RETURN_TEX = null;

const BOOK_H = 2.3, BOOK_D = 1.55, GAP = 0.07, SHELF_W = 15.5, SIDE_TARGET_W = 7.6;
const PER_SPREAD = 10; // 10 papers per reading-panel page
export const LECTERN_COUNT = 5;
// Lecterns sit close in front of the home camera (not out at the old ~10-unit
// remove that used to require flying the camera in to read them) and
// distinctly below eye height, angled like real reading stands.
const LECTERN_Z = 8.8, LECTERN_SPACING = 1.85, LECTERN_STAND_H = 1.15, LECTERN_TILT = -0.62;

// ------------------------------------------------------------ camera rig --
// Free-look: the camera position ("eye") only changes on scroll (dolly) —
// dragging changes yaw/pitch only, it never orbits the bookcase, and never
// flies anywhere (the old lectern fly-to has been retired — see openBook()).
const EYE_HOME = new THREE.Vector3(0, 2.55, 14.8);   // desktop / landscape
const EYE_HOME_PORTRAIT = new THREE.Vector3(0, 2.35, 24); // pulled back further — see homeEye()
const YAW_LIMIT = THREE.MathUtils.degToRad(90);   // ±90° = 180° total — drag only
const PITCH_MIN = THREE.MathUtils.degToRad(-24);
const PITCH_MAX = THREE.MathUtils.degToRad(16);
// "Aim to view" (gyro) is deliberately NOT yaw-clamped — pointing a phone at
// a wall that won't turn any further feels broken. Pitch keeps a wider (but
// still finite) range to stay clear of gimbal weirdness at the poles.
const GYRO_PITCH_MIN = THREE.MathUtils.degToRad(-65);
const GYRO_PITCH_MAX = THREE.MathUtils.degToRad(65);
const SIGN_SHOW_YAW = THREE.MathUtils.degToRad(130); // hysteresis band so the
const SIGN_HIDE_YAW = THREE.MathUtils.degToRad(108); // rear sign doesn't flicker at the boundary
const PITCH_HOME = THREE.MathUtils.degToRad(-7);
const PITCH_HOME_PORTRAIT = THREE.MathUtils.degToRad(-16);
const PORTRAIT_ASPECT = 0.8; // below this we're in "tall phone" territory

// A tall/narrow (portrait phone) viewport needs a much larger vertical fov
// than a wide desktop one to preserve the SAME horizontal breadth at the
// SAME distance (three.js fov is vertical) — taken too far that's a fisheye.
// Instead of only widening fov, portrait also stands the camera further
// back (homeEye) so a *smaller* horizontal target still comfortably frames
// the whole shelf, keeping the resulting vertical fov far more sane.
function homeEye() { return innerWidth / innerHeight < PORTRAIT_ASPECT ? EYE_HOME_PORTRAIT.clone() : EYE_HOME.clone(); }
function homePitch() { return innerWidth / innerHeight < PORTRAIT_ASPECT ? PITCH_HOME_PORTRAIT : PITCH_HOME; }

const DIST_MIN = 3.2, DIST_MAX = 34;
const DIST_ANCHOR = new THREE.Vector3(0, 1.8, 0);

let eye = EYE_HOME.clone();
let yaw = 0, pitch = PITCH_HOME;

function forwardVec(y, p) {
  return new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
}
function updateCameraLook() {
  camera.position.copy(eye);
  const d = forwardVec(yaw, pitch);
  camera.lookAt(eye.x + d.x, eye.y + d.y, eye.z + d.z);
}

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const jcolor = (j) => j.color || css("--accent") || "#2a78d6";

// ------------------------------------------------------------------ spine --
function spineTexture(journal, rank, count) {
  const color = jcolor(journal);
  const text = ctx.textOn(color);
  const W = 180, H = 1024;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "rgba(0,0,0,0.25)");
  grad.addColorStop(0.12, "rgba(0,0,0,0)");
  grad.addColorStop(0.88, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.25)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = text;
  g.font = 'bold 64px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(rank === Infinity ? "–" : String(rank), W / 2, 70);
  g.fillRect(W / 2 - 40, 125, 80, 4);
  g.save();
  g.translate(W / 2, 170);
  g.rotate(Math.PI / 2);
  g.textAlign = "left";
  let name = journal.name;
  let size = 56;
  g.font = `bold ${size}px "Century Schoolbook", "CMU Serif", Georgia, serif`;
  while (g.measureText(name).width > 700 && size > 30) {
    size -= 2;
    g.font = `bold ${size}px "Century Schoolbook", "CMU Serif", Georgia, serif`;
  }
  if (g.measureText(name).width > 700) {
    while (g.measureText(name + "…").width > 700) name = name.slice(0, -1);
    name += "…";
  }
  g.fillText(name, 0, 0);
  g.restore();
  g.save();
  g.translate(W / 2, H - 20);
  g.rotate(-Math.PI / 2);
  g.textAlign = "left";
  g.font = '34px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.globalAlpha = 0.85;
  g.fillText(`${count}`, 0, 0);
  g.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  return tex;
}

function labelTexture(text) {
  const W = 900, H = 160;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "rgba(20,19,17,0.78)";
  const r = 18;
  g.beginPath();
  g.moveTo(r, 0); g.arcTo(W, 0, W, H, r); g.arcTo(W, H, 0, H, r); g.arcTo(0, H, 0, 0, r); g.arcTo(0, 0, W, 0, r);
  g.closePath(); g.fill();
  g.fillStyle = "#f3efe4";
  g.font = 'bold 60px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text.toUpperCase(), W / 2, H / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  return tex;
}

function wrapTextCentered(g, text, cx, y, maxW, lh, maxLines) {
  const words = String(text).split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    let last = shown[maxLines - 1];
    while (g.measureText(last + "…").width > maxW) last = last.slice(0, -1);
    shown[maxLines - 1] = last + "…";
  }
  const startY = y - ((shown.length - 1) * lh) / 2;
  shown.forEach((l, i) => g.fillText(l, cx, startY + i * lh));
}

// -------------------------------------------------------------- disposal --
function disposeGroup(grp) {
  if (!grp) return;
  grp.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        m.map?.dispose(); m.dispose();
      });
    }
  });
  scene.remove(grp);
}

// ---------------------------------------------------------------- shelves --
function countsByJournal() {
  const m = new Map();
  ctx.state.rows.forEach((r) => m.set(r.journal, (m.get(r.journal) || 0) + 1));
  return m;
}
// Side-shelf journals live outside the active mode, so the current window's
// row set (mode-filtered) won't carry their paper counts — fall back to the
// archive-wide total already loaded in stats.json (mode-independent).
function archiveTotal(jid) { return ctx.state.stats?.journals?.[jid]?.total ?? 0; }

const zoneVec = (x, y, z, originX, originZ, rotY) => {
  const v = new THREE.Vector3(x, y, z);
  if (rotY) v.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  v.x += originX; v.z += originZ;
  return v;
};

// Greedy shelf-row packer, BALANCED to the case's total width rather than a
// fixed cap: it first works out how many rows the content needs at roughly
// `targetWidth` each, then repacks against totalWidth/rows so every row
// (including the last) ends up close to evenly filled — this is what fixes
// the "negative space on the bottom shelf" look a naive greedy-till-overflow
// pack produces when the content doesn't divide evenly.
function packRowsBalanced(widths, targetWidth) {
  const totalW = widths.reduce((a, w) => a + w + GAP, 0) - GAP;
  // ceil (not round!) — guarantees totalW/rows never exceeds targetWidth, so
  // rows stay at or under the nominal width instead of occasionally
  // rounding DOWN to fewer, wider-than-target rows.
  const rows = Math.max(1, Math.ceil(totalW / targetWidth - 1e-9));
  // Greedy fill-to-cap at exactly totalW/rows can overflow into an extra,
  // near-empty row when the item sizes don't divide evenly (the exact
  // "sparse last shelf" bug this balancing exists to fix) — relax the cap
  // slightly and retry until the greedy pack actually fits in `rows` rows.
  let cap = Math.max(totalW / rows, ...widths);
  let shelves;
  for (let guard = 0; guard < 60; guard++) {
    shelves = [[]];
    let acc = 0;
    widths.forEach((w, i) => {
      if (acc + w > cap && shelves[shelves.length - 1].length) { shelves.push([]); acc = 0; }
      shelves[shelves.length - 1].push(i);
      acc += w + GAP;
    });
    if (shelves.length <= rows) break;
    cap *= 1.03;
  }
  return shelves;
}

// Builds a bookcase (shelves + planks + back/side walls) for a set of
// journals, at an arbitrary origin/rotation/vertical offset. `pivot`
// controls where local x=0 sits: "center" (main case — symmetric, walls on
// both sides) or "left"/"right" (side wings — x=0 is the hinge edge that
// butts flush against the main case's own wall, so only the OUTER wall is
// built; the main case's wall is what visually joins them, no gap/double
// wall at the seam). Returns the group (for disposal) and the case's actual
// content width (used to size/place things narrower than the nominal target
// — see packRowsBalanced), and pushes book descriptors (world-space home/out
// vectors + the shelf's own Y rotation, needed to orient ghost-slot labels)
// onto `outBooks`.
function buildBookcase(journals, { width, originX = 0, originZ = 0, rotY = 0, baseY = 1.0, rankFn, countFn, pivot = "center" }, outBooks) {
  const group = new THREE.Group();
  const widths = journals.map((j) => 0.24 + Math.min(0.55, Math.log10(1 + (countFn(j.id) || 0)) * 0.24));
  const shelves = packRowsBalanced(widths, width);
  const topY = baseY + (shelves.length - 1) * 1.55;
  const caseWidth = Math.max(...shelves.map((idxs) => idxs.reduce((w, i) => w + widths[i] + GAP, -GAP)));
  const plankMat = new THREE.MeshBasicMaterial({ color: css("--baseline") || "#c3c2b7" });
  const backMat = new THREE.MeshBasicMaterial({ color: css("--grid") || "#e1e0d9" });

  const ROW_SPACING = 3.1; // vertical gap between shelf rows (top row at topY)
  shelves.forEach((idxs, s) => {
    const rowW = idxs.reduce((w, i) => w + widths[i] + GAP, -GAP);
    const shelfY = topY - s * ROW_SPACING;
    let x = pivot === "left" ? 0 : pivot === "right" ? -rowW : -rowW / 2;
    for (const i of idxs) {
      const j = journals[i], w = widths[i];
      const count = countFn(j.id) || 0;
      const spineMat = new THREE.MeshBasicMaterial({ map: spineTexture(j, rankFn(j), count) });
      const coverMat = new THREE.MeshBasicMaterial({ color: jcolor(j) });
      const pagesMat = new THREE.MeshBasicMaterial({ color: "#f3efe4" });
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, BOOK_H, BOOK_D),
        [coverMat, coverMat, pagesMat, coverMat, spineMat, coverMat]);
      const home = zoneVec(x + w / 2, shelfY + BOOK_H / 2, 0, originX, originZ, rotY);
      const out = zoneVec(x + w / 2, shelfY + BOOK_H / 2, 1.15, originX, originZ, rotY);
      mesh.position.copy(home);
      mesh.rotation.y = rotY;
      mesh.userData = { kind: "book", journalId: j.id };
      scene.add(mesh);
      outBooks.push({ mesh, journal: j, home, out, lecternIndex: null, rotY, ghost: null });
      x += w + GAP;
    }
    const plankX = pivot === "left" ? caseWidth / 2 : pivot === "right" ? -caseWidth / 2 : 0;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(caseWidth + 1.2, 0.12, BOOK_D + 0.6), plankMat);
    plank.position.copy(zoneVec(plankX, shelfY - 0.07, 0, originX, originZ, rotY));
    plank.rotation.y = rotY;
    group.add(plank);
  });
  const totalH = shelves.length * ROW_SPACING + 0.6;
  const backX = pivot === "left" ? caseWidth / 2 : pivot === "right" ? -caseWidth / 2 : 0;
  const back = new THREE.Mesh(new THREE.BoxGeometry(caseWidth + 1.2, totalH, 0.08), backMat);
  back.position.copy(zoneVec(backX, topY + BOOK_H - totalH / 2 + 0.4, -BOOK_D / 2 - 0.1, originX, originZ, rotY));
  back.rotation.y = rotY;
  group.add(back);
  const wallXs = pivot === "left" ? [caseWidth + 0.65]
    : pivot === "right" ? [-(caseWidth + 0.65)]
    : [-(caseWidth / 2 + 0.65), caseWidth / 2 + 0.65];
  for (const wx of wallXs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.14, totalH, BOOK_D + 0.6), plankMat);
    wall.position.copy(zoneVec(wx, topY + BOOK_H - totalH / 2 + 0.4, 0, originX, originZ, rotY));
    wall.rotation.y = rotY;
    group.add(wall);
  }
  scene.add(group);
  return { group, topY, rows: shelves.length, caseWidth };
}

// Same construction as buildBookcase, but for TWO journal sections sharing
// ONE case carcass — each section always starts on a fresh shelf row (so
// they never blend into the same row) and is independently balanced via
// packRowsBalanced. Used for the right wing: Philosophy of science (top
// section) stacked directly over Technology & AI (bottom section) in a
// single bookcase, rather than two separate floating boxes.
function buildSectionedBookcase(sections, { width, originX = 0, originZ = 0, rotY = 0, baseY = 1.0, pivot = "left", countFn }, outBooks) {
  const group = new THREE.Group();
  const plankMat = new THREE.MeshBasicMaterial({ color: css("--baseline") || "#c3c2b7" });
  const backMat = new THREE.MeshBasicMaterial({ color: css("--grid") || "#e1e0d9" });
  const ROW_SPACING = 3.1;

  const allJournals = [], allWidths = [], rowsMeta = [];
  sections.forEach((sec, si) => {
    const startIdx = allJournals.length;
    const widths = sec.journals.map((j) => 0.24 + Math.min(0.55, Math.log10(1 + (countFn(j.id) || 0)) * 0.24));
    allJournals.push(...sec.journals);
    allWidths.push(...widths);
    packRowsBalanced(widths, width).forEach((idxs) => rowsMeta.push({ idxs: idxs.map((i) => i + startIdx), sectionIdx: si }));
  });

  const topY = baseY + (rowsMeta.length - 1) * 1.55;
  const caseWidth = Math.max(...rowsMeta.map((r) => r.idxs.reduce((w, i) => w + allWidths[i] + GAP, -GAP)));
  const sectionTop = [];

  rowsMeta.forEach((row, s) => {
    if (sectionTop[row.sectionIdx] === undefined) sectionTop[row.sectionIdx] = topY - s * ROW_SPACING;
    const rowW = row.idxs.reduce((w, i) => w + allWidths[i] + GAP, -GAP);
    const shelfY = topY - s * ROW_SPACING;
    let x = pivot === "left" ? 0 : -rowW;
    const rankFn = sections[row.sectionIdx].rankFn;
    for (const i of row.idxs) {
      const j = allJournals[i], w = allWidths[i];
      const count = countFn(j.id) || 0;
      const spineMat = new THREE.MeshBasicMaterial({ map: spineTexture(j, rankFn(j), count) });
      const coverMat = new THREE.MeshBasicMaterial({ color: jcolor(j) });
      const pagesMat = new THREE.MeshBasicMaterial({ color: "#f3efe4" });
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, BOOK_H, BOOK_D),
        [coverMat, coverMat, pagesMat, coverMat, spineMat, coverMat]);
      const home = zoneVec(x + w / 2, shelfY + BOOK_H / 2, 0, originX, originZ, rotY);
      const out = zoneVec(x + w / 2, shelfY + BOOK_H / 2, 1.15, originX, originZ, rotY);
      mesh.position.copy(home);
      mesh.rotation.y = rotY;
      mesh.userData = { kind: "book", journalId: j.id };
      scene.add(mesh);
      outBooks.push({ mesh, journal: j, home, out, lecternIndex: null, rotY, ghost: null });
      x += w + GAP;
    }
    const plankX = pivot === "left" ? caseWidth / 2 : -caseWidth / 2;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(caseWidth + 1.2, 0.12, BOOK_D + 0.6), plankMat);
    plank.position.copy(zoneVec(plankX, shelfY - 0.07, 0, originX, originZ, rotY));
    plank.rotation.y = rotY;
    group.add(plank);
  });

  const totalH = rowsMeta.length * ROW_SPACING + 0.6;
  const backX = pivot === "left" ? caseWidth / 2 : -caseWidth / 2;
  const back = new THREE.Mesh(new THREE.BoxGeometry(caseWidth + 1.2, totalH, 0.08), backMat);
  back.position.copy(zoneVec(backX, topY + BOOK_H - totalH / 2 + 0.4, -BOOK_D / 2 - 0.1, originX, originZ, rotY));
  back.rotation.y = rotY;
  group.add(back);
  const wallX = pivot === "left" ? caseWidth + 0.65 : -(caseWidth + 0.65);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.14, totalH, BOOK_D + 0.6), plankMat);
  wall.position.copy(zoneVec(wallX, topY + BOOK_H - totalH / 2 + 0.4, 0, originX, originZ, rotY));
  wall.rotation.y = rotY;
  group.add(wall);

  scene.add(group);
  return { group, topY, rows: rowsMeta.length, caseWidth, sectionTop };
}

function buildMainShelf() {
  const js = ctx.rankedJournals();
  const counts = countsByJournal();
  const { group, caseWidth } = buildBookcase(js, {
    width: SHELF_W, originX: 0, originZ: 0, rotY: 0, baseY: 1.0, pivot: "center",
    rankFn: (j) => ctx.rankOf(j), countFn: (id) => counts.get(id),
  }, books);
  mainGroup = group;
  return caseWidth;
}

// Specialist side shelves, hinged flush against the main case's own side
// walls (touching — see buildBookcase's pivot doc). LEFT wing: ethics &
// political (full set), in its own case. RIGHT wing: philosophy of science
// (top section) + technology & AI (bottom section), sharing ONE case. Each
// is angled inward ~55° so it reads clearly once the camera yaws toward it,
// but sits outside the ~180° home framing — discoverable by rotating, per
// the hint.
const SIDE_ROT = THREE.MathUtils.degToRad(55);

function journalsForMode(modeKey) {
  return ctx.state.registry.journals
    .filter((j) => j.modes.includes(modeKey))
    .sort((a, b) => (a.mode_rank?.[modeKey] ?? Infinity) - (b.mode_rank?.[modeKey] ?? Infinity));
}

function buildSideShelves(mainCaseWidth) {
  const rankFn = (modeKey) => (j) => j.mode_rank?.[modeKey] ?? Infinity;
  const countFn = (id) => archiveTotal(id);
  const hingeOffset = mainCaseWidth / 2 + 0.65;

  const ethics = journalsForMode("ethics");
  const { group: lg, topY: lTop, caseWidth: lWidth } = buildBookcase(ethics, {
    width: SIDE_TARGET_W, originX: -hingeOffset, originZ: 0, rotY: SIDE_ROT, baseY: 1.0,
    rankFn: rankFn("ethics"), countFn, pivot: "right",
  }, books);
  leftGroup = lg;
  const lLabel = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.43), new THREE.MeshBasicMaterial({ map: labelTexture("Ethics & political"), transparent: true }));
  lLabel.position.copy(zoneVec(-lWidth / 2, lTop + BOOK_H + 0.55, 0, -hingeOffset, 0, SIDE_ROT));
  lLabel.rotation.y = SIDE_ROT;
  leftGroup.add(lLabel);

  const philsci = journalsForMode("philsci");
  const philtech = journalsForMode("philtech");
  const { group: rg, topY: rTop, sectionTop, caseWidth: rWidth } = buildSectionedBookcase([
    { journals: philsci, rankFn: rankFn("philsci") },
    { journals: philtech, rankFn: rankFn("philtech") },
  ], {
    width: SIDE_TARGET_W, originX: hingeOffset, originZ: 0, rotY: -SIDE_ROT, baseY: 1.0,
    pivot: "left", countFn,
  }, books);
  rightGroup = rg;
  const r1Label = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.43), new THREE.MeshBasicMaterial({ map: labelTexture("Philosophy of science"), transparent: true }));
  r1Label.position.copy(zoneVec(rWidth / 2, rTop + BOOK_H + 0.55, 0, hingeOffset, 0, -SIDE_ROT));
  r1Label.rotation.y = -SIDE_ROT;
  rightGroup.add(r1Label);

  // Technology & AI's own label mounts as a small shelf-edge plaque right at
  // the boundary row where its section begins (there's no headroom above it
  // for a top-of-case plaque — Phil Sci's rows are directly above).
  const r2Label = new THREE.Mesh(new THREE.PlaneGeometry(2.15, 0.38), new THREE.MeshBasicMaterial({ map: labelTexture("Technology & AI"), transparent: true }));
  r2Label.position.copy(zoneVec(rWidth / 2, sectionTop[1] - 0.32, BOOK_D / 2 + 0.18, hingeOffset, 0, -SIDE_ROT));
  r2Label.rotation.y = -SIDE_ROT;
  rightGroup.add(r2Label);
}

function buildShelf() {
  books.forEach((b) => { disposeGhostSlot(b); disposeGroup(b.mesh); });
  books = [];
  disposeGroup(mainGroup); disposeGroup(leftGroup); disposeGroup(rightGroup);
  resetLecterns();
  const mainCaseWidth = buildMainShelf();
  buildSideShelves(mainCaseWidth);
}

// -------------------------------------------------------------- lecterns --
function buildLecternRow() {
  lecternGroup = new THREE.Group();
  lecterns = [];
  const woodMat = new THREE.MeshBasicMaterial({ color: css("--baseline") || "#c3c2b7" });
  const startX = -((LECTERN_COUNT - 1) / 2) * LECTERN_SPACING;
  for (let i = 0; i < LECTERN_COUNT; i++) {
    const x = startX + i * LECTERN_SPACING;
    const grp = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, LECTERN_STAND_H, 10), woodMat);
    col.position.y = LECTERN_STAND_H / 2;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.07, 16), woodMat);
    base.position.y = 0.035;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.54), woodMat);
    top.position.y = LECTERN_STAND_H;
    top.rotation.x = LECTERN_TILT;
    grp.add(col, base, top);
    grp.position.set(x, 0, LECTERN_Z);
    lecternGroup.add(grp);
    lecterns.push({
      index: i, occupant: null, occupiedAt: 0,
      bookPos: new THREE.Vector3(x, LECTERN_STAND_H + 0.34, LECTERN_Z + 0.14),
      displayGroup: null, displayMeshes: null, returnMesh: null,
    });
  }
  scene.add(lecternGroup);
}

function returnSpriteTexture() {
  const W = 128, H = 128;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "rgba(20,20,18,0.72)";
  g.beginPath(); g.arc(W / 2, H / 2, 56, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(255,255,255,0.5)"; g.lineWidth = 3; g.stroke();
  g.fillStyle = "#fff";
  g.font = "bold 58px sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("↩", W / 2, H / 2 + 4);
  return new THREE.CanvasTexture(cv);
}

function buildReturnSprite(slot) {
  RETURN_TEX = RETURN_TEX || returnSpriteTexture();
  const mat = new THREE.MeshBasicMaterial({ map: RETURN_TEX, transparent: true, depthTest: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36), mat);
  mesh.position.copy(slot.bookPos);
  mesh.position.y += 0.62;
  mesh.renderOrder = 10;
  mesh.userData = { kind: "lectern-return", lecternIndex: slot.index };
  scene.add(mesh);
  slot.returnMesh = mesh;
}

function lecternDisplayTexture(journal, rank) {
  const W = 1600, H = 1000;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "#faf7ee"; g.fillRect(0, 0, W, H);
  const color = jcolor(journal);
  g.fillStyle = color; g.fillRect(0, 0, W, 22);
  g.fillStyle = "#1d1c19";
  g.font = 'bold 92px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.textAlign = "center";
  wrapTextCentered(g, journal.name, W / 2, 340, W - 160, 104, 3);
  g.font = '44px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.fillStyle = "#7a776e";
  g.fillText(journal.publisher || "", W / 2, H - 170);
  g.font = 'bold 50px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.fillStyle = color;
  g.fillText(rank === Infinity ? "unranked" : `rank ${rank}`, W / 2, H - 95);
  g.textAlign = "left";
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  return tex;
}

function disposeLecternDisplay(slot) {
  if (slot.displayGroup) {
    slot.displayGroup.traverse((o) => {
      o.geometry?.dispose();
      o.material?.map?.dispose();
      o.material?.dispose();
    });
    scene.remove(slot.displayGroup);
    slot.displayGroup = null; slot.displayMeshes = null;
  }
  if (slot.returnMesh) {
    scene.remove(slot.returnMesh);
    slot.returnMesh.geometry.dispose();
    slot.returnMesh.material.dispose();
    slot.returnMesh = null;
  }
}

// Builds the "open two-page book" resting on a lectern: two angled planes
// sharing a spine, both mapped to halves of one canvas texture so the
// journal's title reads clearly across the spread — legible from the home
// camera position without needing to fly closer (lecterns sit close &
// below eye level; see LECTERN_Z/LECTERN_STAND_H and the bumped font sizes
// in lecternDisplayTexture above).
function buildLecternDisplay(slot) {
  const journal = slot.occupant.journal;
  const rank = ctx.rankOf(journal);
  const tex = lecternDisplayTexture(journal, rank);
  const group = new THREE.Group();
  const pageW = 0.8, pageH = 0.58;
  const meshes = [];
  [-1, 1].forEach((side) => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(0.5, 1);
    t.offset.set(side < 0 ? 0 : 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pageW, pageH), mat);
    mesh.position.set(side * pageW / 2, 0, 0);
    mesh.rotation.y = side * -0.34;
    mesh.rotation.x = LECTERN_TILT;
    mesh.userData = { kind: "lectern-display", lecternIndex: slot.index };
    group.add(mesh);
    meshes.push(mesh);
  });
  group.position.copy(slot.bookPos);
  group.position.y += 0.05;
  scene.add(group);
  slot.displayGroup = group;
  slot.displayMeshes = meshes;
}

function placeOnLectern(book) {
  if (book.lecternIndex != null) { openBook(book); return; }
  let idx = lecterns.findIndex((l) => l.occupant == null);
  if (idx === -1) {
    // all full — replace the oldest-occupied lectern
    idx = lecterns.reduce((best, l, i) => (l.occupiedAt < lecterns[best].occupiedAt ? i : best), 0);
    clearLectern(idx);
  }
  const slot = lecterns[idx];
  slot.occupant = book;
  slot.occupiedAt = ++lecternClock;
  book.lecternIndex = idx;
  buildReturnSprite(slot); // discoverable immediately, even mid-flight
  buildGhostSlot(book);    // ghosted marker + its own ↩ left at the empty shelf slot
  setTimeout(() => {
    if (book.lecternIndex !== idx || slot.occupant !== book) return; // re-evicted before it landed
    book.mesh.visible = false;
    buildLecternDisplay(slot);
  }, 480);
}

function clearLectern(idx) {
  const slot = lecterns[idx];
  const book = slot.occupant;
  if (!book) return;
  book.lecternIndex = null;
  book.mesh.visible = true;
  slot.occupant = null;
  disposeLecternDisplay(slot);
  disposeGhostSlot(book);
  if (selected === book) closeBook();
}

// Clears all lectern occupancy (used on mode/ranking rebuilds and before
// "Open favourites" re-populates the row). The podium furniture itself
// (lecternGroup) is built once in enter() and is NOT touched here — only
// the occupant state, so the slots stay put across mode switches.
function resetLecterns() {
  lecterns.forEach((slot) => {
    disposeLecternDisplay(slot);
    if (slot.occupant) {
      disposeGhostSlot(slot.occupant);
      slot.occupant.lecternIndex = null; slot.occupant.mesh.visible = true;
    }
    slot.occupant = null; slot.occupiedAt = 0;
  });
  selected = null; spreadState = null;
  document.getElementById("three-panel")?.classList.remove("show");
}

// ------------------------------------------------------------ ghost slots --
// When a book leaves the shelf for a lectern, its empty slot gets a ghosted
// (translucent) label with the journal's name plus its own small ↩ Return
// button — clicking it sends the book straight back to the shelf and clears
// whichever lectern it was on, same as the lectern's own ↩.
function ghostSlotTexture(name) {
  const W = 560, H = 200;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "rgba(137,135,129,0.68)";
  g.font = 'italic 44px "Century Schoolbook", "CMU Serif", Georgia, serif';
  wrapTextCentered(g, name, W / 2, 74, W - 50, 50, 2);
  g.globalAlpha = 0.8;
  g.font = '24px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.fillStyle = "rgba(137,135,129,0.68)";
  g.fillText("— on a lectern —", W / 2, 150);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

function ghostReturnTexture() {
  const W = 320, H = 116;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "rgba(20,19,17,0.8)";
  const r = 18;
  g.beginPath();
  g.moveTo(r, 0); g.arcTo(W, 0, W, H, r); g.arcTo(W, H, 0, H, r); g.arcTo(0, H, 0, 0, r); g.arcTo(0, 0, W, 0, r);
  g.closePath(); g.fill();
  g.fillStyle = "#f3efe4";
  g.font = "bold 38px sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("↩ Return", W / 2, H / 2 + 3);
  return new THREE.CanvasTexture(cv);
}

function buildGhostSlot(book) {
  disposeGhostSlot(book);
  const group = new THREE.Group();
  const labelMat = new THREE.MeshBasicMaterial({ map: ghostSlotTexture(book.journal.name), transparent: true, depthWrite: false });
  const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.55), labelMat);
  labelMesh.position.set(0, 0.56, 0.05);
  group.add(labelMesh);

  GHOST_RETURN_TEX = GHOST_RETURN_TEX || ghostReturnTexture();
  const retMat = new THREE.MeshBasicMaterial({ map: GHOST_RETURN_TEX, transparent: true, depthTest: false });
  const retMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.22), retMat);
  retMesh.position.set(0, 0.16, 0.05);
  retMesh.renderOrder = 10;
  retMesh.userData = { kind: "ghost-return", bookRef: book };
  group.add(retMesh);

  group.position.copy(book.home);
  group.rotation.y = book.rotY || 0;
  scene.add(group);
  book.ghost = { group, returnMesh: retMesh };
}

function disposeGhostSlot(book) {
  if (!book.ghost) return;
  book.ghost.group.traverse((o) => {
    o.geometry?.dispose();
    o.material?.map?.dispose();
    o.material?.dispose();
  });
  scene.remove(book.ghost.group);
  book.ghost = null;
}

// ----------------------------------------------------- reading (no flight) --
// Clicking an occupied lectern's open book no longer flies the camera in —
// it opens a screen-space panel (#three-panel) in front of the (unmoved)
// camera with the paper list, volume separators and click-through to full
// abstracts, adapted from the same rendering this panel always used.
function openBook(book) {
  const rows = ctx.state.rows
    .filter((r) => r.journal === book.journal.id)
    .sort((a, b) => b.published.localeCompare(a.published));
  spreadState = {
    journal: book.journal, papers: rows, page: 0,
    pages: Math.max(1, Math.ceil(rows.length / PER_SPREAD)),
  };
  selected = book;
  renderPanel();
}

function turnPage(dir) {
  if (!spreadState) return;
  const next = spreadState.page + dir;
  if (next < 0 || next >= spreadState.pages) return;
  spreadState.page = next;
  renderPanel();
}

function closeBook() {
  spreadState = null;
  selected = null;
  document.getElementById("three-panel").classList.remove("show");
}

function renderPanel() {
  const { journal, papers, page, pages } = spreadState;
  const panel = document.getElementById("three-panel");
  const rank = ctx.rankOf(journal);
  const fmt = ctx.inferVolumeFormat(papers);
  panel.innerHTML = `<div class="panel-headrow">
      <h3>${ctx.esc(journal.name)}</h3>
      <button class="iconbtn closebtn" id="pg-close" title="Close — the camera stays exactly where it is">✕ Close</button>
    </div>
    <div class="sub">${ctx.esc(journal.publisher)} · rank ${rank === Infinity ? "unranked" : rank} · ${papers.length} papers in window</div>
    <div class="reading-note">Reading — camera unchanged. Use a lectern's or shelf slot's ↩ to reshelve this book.</div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <button class="iconbtn" id="pg-prev">‹ Prev</button>
      <span class="sub" style="margin:0">page ${page + 1} / ${pages}</span>
      <button class="iconbtn" id="pg-next">Next ›</button>
    </div>
    <div id="three-paperlist"></div>`;
  panel.querySelector("#pg-prev").addEventListener("click", () => turnPage(-1));
  panel.querySelector("#pg-next").addEventListener("click", () => turnPage(1));
  panel.querySelector("#pg-close").addEventListener("click", closeBook);
  const list = panel.querySelector("#three-paperlist");
  const start = page * PER_SPREAD;
  const slice = papers.slice(start, start + PER_SPREAD);
  if (!slice.length) {
    const status = document.createElement("div");
    status.className = "status";
    status.textContent = "No papers in the current window.";
    list.append(status);
  }
  slice.forEach((r, i) => {
    const idx = start + i;
    if (idx > 0) {
      const prev = papers[idx - 1];
      if (r.volume && prev.volume && r.volume !== prev.volume) {
        const sep = document.createElement("div");
        sep.className = "volsep";
        sep.innerHTML = `<span class="volsep-label">${ctx.esc(ctx.volumeLabelText(r, fmt))}</span>`;
        list.append(sep);
      }
    }
    const b = document.createElement("button");
    b.className = "paper";
    b.innerHTML = `<div class="ptitle">${ctx.sanitizeInline(r.title)}</div>
      <div class="pmeta">${ctx.esc((r.authors || []).join(", "))} · ${r.published}</div>`;
    b.addEventListener("click", () => ctx.openPaper(r));
    list.append(b);
  });
  panel.classList.add("show");
}

// ---------------------------------------------------------- favourites (3D) --
export function openFavorites() {
  if (!running) return;
  resetLecterns(); // clear current occupants; podium furniture itself stays put
  const favs = ctx.getFavorites();
  const chosen = [];
  for (const id of favs) {
    const b = books.find((bk) => bk.journal.id === id);
    if (b) chosen.push(b);
    if (chosen.length >= LECTERN_COUNT) break;
  }
  chosen.forEach((b) => placeOnLectern(b));
}

// -------------------------------------------------------- discovery hint --
let hintTimer = null, hintDismissed = false;
function showDiscoveryHint() {
  hintDismissed = false;
  document.getElementById("side-shelf-hint")?.classList.add("show");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(dismissHint, 10000);
}
function dismissHint() {
  hintDismissed = true;
  clearTimeout(hintTimer);
  document.getElementById("side-shelf-hint")?.classList.remove("show");
}
function maybeDismissHintByRotation() {
  if (hintDismissed) return;
  if (Math.abs(yaw) > THREE.MathUtils.degToRad(28)) dismissHint();
}

// ------------------------------------------------------------- interaction --
function interactiveMeshes() {
  const arr = books.filter((b) => b.mesh.visible).map((b) => b.mesh);
  lecterns.forEach((l) => {
    if (l.displayMeshes) arr.push(...l.displayMeshes);
    if (l.returnMesh) arr.push(l.returnMesh);
  });
  books.forEach((b) => { if (b.ghost) arr.push(b.ghost.returnMesh); });
  return arr;
}

function handleClick(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interactiveMeshes(), false);
  if (!hits.length) { if (spreadState) closeBook(); return; }
  const obj = hits[0].object;
  const kind = obj.userData?.kind;
  if (kind === "lectern-return") { clearLectern(obj.userData.lecternIndex); return; }
  if (kind === "ghost-return") {
    const book = obj.userData.bookRef;
    if (book?.lecternIndex != null) clearLectern(book.lecternIndex);
    return;
  }
  if (kind === "lectern-display") {
    const slot = lecterns[obj.userData.lecternIndex];
    if (slot?.occupant) openBook(slot.occupant);
    return;
  }
  const book = books.find((b) => b.mesh === obj);
  if (book) placeOnLectern(book);
}

function dollyBy(amount) {
  const d = forwardVec(yaw, pitch);
  const next = eye.clone().addScaledVector(d, amount);
  const dist = next.distanceTo(DIST_ANCHOR);
  if (dist > DIST_MIN && dist < DIST_MAX) eye.copy(next);
  updateCameraLook();
}

// Pointer Events unify mouse/touch/pen — one finger drags to look around
// (unless "Aim to view" gyro mode has that disabled), two fingers pinch to
// dolly in/out (scroll-wheel's touch equivalent).
let dragging = false, downX = 0, downY = 0, lastX = 0, lastY = 0, dragMoved = false;
const activePointers = new Map(); // pointerId -> {x, y}
let pinchStartDist = null;

function pinchDistance() {
  const pts = [...activePointers.values()];
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}
function onPointerDown(e) {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size >= 2) {
    dragging = false;
    pinchStartDist = pinchDistance();
    return;
  }
  dragging = true; dragMoved = false;
  downX = lastX = e.clientX; downY = lastY = e.clientY;
}
function onPointerMove(e) {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size >= 2) {
    const dist = pinchDistance();
    if (pinchStartDist != null) {
      dollyBy((dist - pinchStartDist) * 0.02);
      pinchStartDist = dist;
    }
    return;
  }
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) dragMoved = true;
  if (!gyroActive) { // "Aim to view" owns yaw/pitch while active — drag is disabled, not blended
    yaw = THREE.MathUtils.clamp(yaw - dx * 0.0032, -YAW_LIMIT, YAW_LIMIT);
    pitch = THREE.MathUtils.clamp(pitch - dy * 0.0022, PITCH_MIN, PITCH_MAX);
    updateCameraLook();
    maybeDismissHintByRotation();
  }
}
function onPointerUp(e) {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) pinchStartDist = null;
  if (activePointers.size === 0) {
    if (dragging && !dragMoved) handleClick(e);
    dragging = false;
  }
}
function onWheel(e) {
  e.preventDefault();
  dollyBy(-e.deltaY * 0.012);
}

// --------------------------------------------------------- aim to view --
// Device-orientation look-around, offered only on touch devices (see the
// #btn-aim visibility gate in CSS, driven by body.touch-device in app.js).
// Calibrates on enable so the current camera direction doesn't jump, then
// drives yaw/pitch from the phone's compass heading (alpha) and forward
// tilt (beta). Unlike drag, yaw is NOT clamped here — turning all the way
// around to face away is exactly the point of pointing a real device, and
// clamping it would feel broken (see the rear-hemisphere sign below for how
// we handle "facing away" instead of blocking it). Pitch keeps a wide but
// finite range to avoid gimbal weirdness at the poles. Drag is disabled
// while active (see onPointerMove) to avoid two input sources fighting over
// the camera; taps still work since click detection is independent of the
// rotation path.
let gyroActive = false;
let gyroBase = null; // {alpha, beta, yaw0, pitch0}

function onDeviceOrientation(e) {
  if (!gyroActive || e.alpha == null || e.beta == null) return;
  if (!gyroBase) { gyroBase = { alpha: e.alpha, beta: e.beta, yaw0: yaw, pitch0: pitch }; return; }
  let dAlpha = e.alpha - gyroBase.alpha;
  if (dAlpha > 180) dAlpha -= 360;
  if (dAlpha < -180) dAlpha += 360;
  const dBeta = e.beta - gyroBase.beta;
  yaw = gyroBase.yaw0 - THREE.MathUtils.degToRad(dAlpha); // unclamped — full 360° look-around
  pitch = THREE.MathUtils.clamp(gyroBase.pitch0 + THREE.MathUtils.degToRad(dBeta) * 0.6, GYRO_PITCH_MIN, GYRO_PITCH_MAX);
  updateCameraLook();
  maybeDismissHintByRotation();
  updateRearSign();
}

// ------------------------------------------------------- rear-hemisphere sign --
// Only reachable in gyro mode (drag stays clamped to the front ~180°). A
// billboard sprite (always faces the camera, so it's legible from any angle
// you've turned to) sitting behind the home viewpoint, with hysteresis so it
// doesn't flicker right at the boundary.
let signSprite = null;
let signVisible = false;

function buildRearSign() {
  const W = 900, H = 460;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "rgba(20,19,17,0.84)";
  const r = 30;
  g.beginPath();
  g.moveTo(r, 0); g.arcTo(W, 0, W, H, r); g.arcTo(W, H, 0, H, r); g.arcTo(0, H, 0, 0, r); g.arcTo(0, 0, W, 0, r);
  g.closePath(); g.fill();
  g.fillStyle = "#f3efe4";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.font = "bold 150px sans-serif";
  g.fillText("↩", W / 2, 165);
  g.font = 'bold 48px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.fillText("The bookshelves are behind you", W / 2, 340);
  g.globalAlpha = 0.82;
  g.font = '30px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.fillText("turn back around to browse", W / 2, 392);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(4.4, 2.25, 1);
  sprite.position.set(0, 2.15, homeEye().z + 7.5);
  sprite.renderOrder = 30;
  sprite.visible = false;
  scene.add(sprite);
  return sprite;
}

function updateRearSign() {
  if (!signSprite) return;
  let normYaw = ((yaw % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; // -> (-π, π]
  const absYaw = Math.abs(normYaw);
  if (!signVisible && absYaw > SIGN_SHOW_YAW) signVisible = true;
  else if (signVisible && absYaw < SIGN_HIDE_YAW) signVisible = false;
  signSprite.visible = gyroActive && signVisible;
}

function setAimStatus(msg, show) {
  const el = document.getElementById("aim-status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("show", !!show);
  if (show) clearTimeout(setAimStatus._t), (setAimStatus._t = setTimeout(() => el.classList.remove("show"), 3200));
}

export function isAimActive() { return gyroActive; }

export async function toggleAim() {
  const btn = document.getElementById("btn-aim");
  if (gyroActive) {
    gyroActive = false; gyroBase = null;
    window.removeEventListener("deviceorientation", onDeviceOrientation);
    btn?.classList.remove("on");
    setAimStatus("Aim to view off — drag to look around.", true);
    return;
  }
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === "function") {
    // iOS Safari: permission must be requested from within this user-gesture
    // handler, or the browser silently denies it.
    let result;
    try { result = await DOE.requestPermission(); }
    catch { result = "denied"; }
    if (result !== "granted") {
      setAimStatus("Motion access denied — enable it in Settings to aim by pointing your device.", true);
      return;
    }
  }
  gyroActive = true; gyroBase = null;
  window.addEventListener("deviceorientation", onDeviceOrientation);
  btn?.classList.add("on");
  setAimStatus("Aim to view on — point your device to look around.", true);
}

// -------------------------------------------------------------------- loop --
function animate() {
  if (!running) return;
  requestAnimationFrame(animate);
  books.forEach((b) => {
    const target = b.lecternIndex != null ? lecterns[b.lecternIndex].bookPos : b.home;
    b.mesh.position.lerp(target, 0.16);
  });
  updateCameraLook();
  updateRearSign();
  renderer.render(scene, camera);
}

// three.js PerspectiveCamera.fov is the VERTICAL field of view, so a fixed
// value gives a much narrower horizontal view on a tall/narrow phone
// viewport than on a wide desktop one — the shelf ends up cropped at both
// edges. Derive the vertical fov from a target *horizontal* fov instead, so
// framing stays sane; clamp so extreme aspect ratios don't fisheye (portrait
// also targets a narrower horizontal fov, since homeEye() already stands it
// further back — see the comment there).
const TARGET_HORIZONTAL_FOV = THREE.MathUtils.degToRad(68);
const TARGET_HORIZONTAL_FOV_PORTRAIT = THREE.MathUtils.degToRad(46);
function applyCameraFov() {
  const aspect = innerWidth / innerHeight;
  const targetH = aspect < PORTRAIT_ASPECT ? TARGET_HORIZONTAL_FOV_PORTRAIT : TARGET_HORIZONTAL_FOV;
  const vFov = 2 * Math.atan(Math.tan(targetH / 2) / aspect);
  camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(vFov), 40, 88);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

function onResize() {
  applyCameraFov();
  renderer.setSize(innerWidth, innerHeight);
}

// --------------------------------------------------------------------- API --
export function enter(context) {
  ctx = context;
  if (!built) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    document.getElementById("three-canvas").append(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 200);
    applyCameraFov();
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", onResize);
    buildLecternRow();
    signSprite = buildRearSign();
    built = true;
  }
  applyCameraFov();
  buildShelf();
  eye = homeEye();
  yaw = 0; pitch = homePitch();
  updateCameraLook();
  running = true;
  animate();
  showDiscoveryHint();
}

export function exit() {
  running = false;
  dismissHint();
  if (gyroActive) {
    gyroActive = false; gyroBase = null;
    window.removeEventListener("deviceorientation", onDeviceOrientation);
    document.getElementById("btn-aim")?.classList.remove("on");
  }
  if (spreadState) { spreadState = null; selected = null; }
  document.getElementById("three-panel").classList.remove("show");
}

export function setRanking() { if (running) { closeBook(); buildShelf(); } }
export function setMode() { if (running) { closeBook(); buildShelf(); } }

// ---------------------------------------------------------------- testing --
// Minimal read-only state hook for the screenshot/verification script (e.g.
// asserting the camera genuinely doesn't move when the reading panel opens,
// or that a ghost slot appears/disappears at the right time). Not used by
// the app itself.
export function _debugState() {
  return {
    running, built,
    cameraPos: camera ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : null,
    lecternOccupancy: lecterns.map((l) => !!l.occupant),
    ghostCount: books.filter((b) => b.ghost).length,
    panelOpen: !!spreadState,
  };
}
