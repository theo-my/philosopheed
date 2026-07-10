/* Philosopheed — 3D bookshelf view (v10, radically simplified).
   One bookcase, all journals. General-mode journals fill the main shelves
   (top of the case) in the current ranking order; journals that only exist
   in a specialist field (never "general") get their own labelled shelf
   zone lower in the SAME carcass — one zone per field, a journal that's
   specialist-only in more than one field appears once, in its first field.
   No lecterns, no wings, no ghost slots. Click a book and it flies out of
   its shelf slot to a spot in front of the camera and turns to face you —
   a screen-space panel (#three-panel) opens alongside it with the
   journal's recent papers, same panel/mechanics the old lectern reading
   used. Only one book is ever "out"; picking another returns the first.
   Esc, the panel's own close button, or clicking empty space all send the
   open book back to its slot. Drag looks around (camera orientation only);
   scroll dollies the camera in/out; the camera position itself never
   moves — see openBook()/computeOutTransform(). */
import * as THREE from "three";

let ctx = null;
let renderer, scene, camera, raycaster, pointer;
let books = [];             // {mesh, journal, home, out, outPos, outQuat, section}
let mainGroup = null;       // the single bookcase (planks/back/walls/labels)
let spreadState = null;     // {journal, papers, page, pages} — reading-panel content
let outBook = null;         // the one book currently off the shelf (== the panel's journal)
let running = false, built = false;
let caseInfo = { rows: 1, topY: 1.0, caseWidth: 15.5, totalH: 3.7 };

const BOOK_H = 2.3, BOOK_D = 1.55, GAP = 0.07, SHELF_W = 15.5, BASE_Y = 1.0, ROW_SPACING = 3.1;
const PER_SPREAD = 10; // 10 papers per reading-panel page

const SPECIALIST_FIELDS = ["ethics", "philsci", "philtech"];
const FIELD_LABELS = { ethics: "Ethics & political", philsci: "Philosophy of science", philtech: "Technology & AI" };

// ------------------------------------------------------------ camera rig --
// Free-look: the camera position ("eye") only changes on scroll (dolly) —
// dragging changes yaw/pitch only, it never orbits the bookcase, and never
// flies anywhere. homeEye()/homePitch() are derived from the built case's
// own dimensions (caseInfo) so framing stays sane if the journal registry
// grows/shrinks the shelf count.
const YAW_LIMIT = THREE.MathUtils.degToRad(90);   // ±90° = 180° total — drag only
const PITCH_MIN = THREE.MathUtils.degToRad(-38);
const PITCH_MAX = THREE.MathUtils.degToRad(32);
// "Aim to view" (gyro) is deliberately NOT yaw-clamped — pointing a phone at
// a wall that won't turn any further feels broken. Pitch keeps a wider (but
// still finite) range to stay clear of gimbal weirdness at the poles.
const GYRO_PITCH_MIN = THREE.MathUtils.degToRad(-65);
const GYRO_PITCH_MAX = THREE.MathUtils.degToRad(65);
const PORTRAIT_ASPECT = 0.8; // below this we're in "tall phone" territory

// Vertical mid-point of the whole (now potentially several-rows-tall,
// single-carcass) case — used to centre the home view on it rather than on
// a fixed height, since the case's row count varies with how many
// journals/fields the registry has.
function caseCenterY() { return caseInfo.topY + BOOK_H + 0.4 - caseInfo.totalH / 2; }

// Real camera fov for the current aspect — same derivation applyCameraFov()
// uses (kept in sync deliberately), rather than a rough guessed constant.
// Guessing badly here (a flat ~19°/23° half-vfov) is what made the home
// framing miss badly on tall phone aspects, where the actual vertical fov
// balloons far past that as applyCameraFov widens it to hold a sane
// *horizontal* fov on a narrow screen.
function homeCameraFovs() {
  const aspect = innerWidth / innerHeight;
  const portrait = aspect < PORTRAIT_ASPECT;
  const targetH = portrait ? TARGET_HORIZONTAL_FOV_PORTRAIT : TARGET_HORIZONTAL_FOV;
  const vFovRaw = 2 * Math.atan(Math.tan(targetH / 2) / aspect);
  const vFov = THREE.MathUtils.clamp(vFovRaw, THREE.MathUtils.degToRad(40), THREE.MathUtils.degToRad(88));
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect); // actual horizontal fov once vFov is clamped
  return { vFov, hFov };
}
const HOME_V_MARGIN = 2.0, HOME_H_MARGIN = 1.6; // world-unit headroom around the case at home

// Distance that clears the whole case, height AND width, with a bit of
// headroom — whichever of the two needs is more demanding wins. On a wide
// desktop viewport the height need dominates (the case ends up filling most
// of the frame's height, a little air above/below); on a narrow/tall phone
// viewport the width need dominates instead, since the case is much wider
// than it is tall but the phone's usable horizontal fov is kept modest — a
// shelf row's top/bottom can end up just outside frame there, which is fine
// (nothing left-right ever gets clipped, so no book ever looks cut off).
function homeEye() {
  const { vFov, hFov } = homeCameraFovs();
  const distH = (caseInfo.totalH / 2 + HOME_V_MARGIN) / Math.tan(vFov / 2);
  const distW = (caseInfo.caseWidth / 2 + HOME_H_MARGIN) / Math.tan(hFov / 2);
  const dist = THREE.MathUtils.clamp(Math.max(distH, distW), 14, 34);
  return new THREE.Vector3(0, caseCenterY(), dist);
}
function homePitch() { return 0; }

const DIST_MIN = 3.2, DIST_MAX = 40;
function distAnchor() { return new THREE.Vector3(0, caseCenterY(), 0); }

let eye = new THREE.Vector3(0, 2.5, 20);
let yaw = 0, pitch = homePitch();

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

// Word-wraps `text` onto lines no wider than maxWidth (assumes g.font is
// already set) — used by coverTexture() below to lay the journal name out
// across the much wider cover face, rather than spineTexture()'s single
// rotated line up the narrow spine.
function wrapLines(g, text, maxWidth, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (line && g.measureText(trial).width > maxWidth) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) return lines;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Front-cover texture for the face that turns to meet the camera when a
// book comes off the shelf (see quaternionFacing() — the local +X face is
// what ends up pointing at the viewer). Used to be a flat colour swatch;
// now a proper plate-style cover — rank, journal name, publisher — in the
// journal's own colour scheme, canvas-textured the same way spineTexture()
// textures the narrow spine face, just laid out for a much wider canvas.
function coverTexture(journal, rank, count) {
  const color = jcolor(journal);
  const text = ctx.textOn(color);
  const W = 640, H = 950; // matches the cover face's own aspect (BOOK_D x BOOK_H)
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  const shade = g.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, "rgba(255,255,255,0.10)");
  shade.addColorStop(0.5, "rgba(255,255,255,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.22)");
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);

  // Double inset frame — the "hardcover with a debossed border" look.
  g.strokeStyle = text;
  g.globalAlpha = 0.55;
  g.lineWidth = 6;
  g.strokeRect(34, 34, W - 68, H - 68);
  g.lineWidth = 2;
  g.strokeRect(50, 50, W - 100, H - 100);
  g.globalAlpha = 1;

  const maxWidth = W - 150;
  g.fillStyle = text;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.font = 'bold 44px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.fillText(rank === Infinity ? "UNRANKED" : `No. ${rank}`, W / 2, 118);
  g.fillRect(W / 2 - 56, 148, 112, 3);

  // Title: word-wrapped, shrinking to fit within a handful of lines rather
  // than the spine's single-line-with-ellipsis (there's room to spare here).
  let size = 66, lines = [];
  const maxLines = 4;
  do {
    g.font = `bold ${size}px "Century Schoolbook", "CMU Serif", Georgia, serif`;
    lines = wrapLines(g, journal.name, maxWidth, maxLines + 1);
    if (lines.length <= maxLines) break;
    size -= 4;
  } while (size > 26);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last && g.measureText(last + "…").width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "…";
  }
  const lineH = size * 1.22;
  const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((ln, i) => g.fillText(ln, W / 2, startY + i * lineH));

  g.font = '30px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.globalAlpha = 0.85;
  let pub = journal.publisher || "";
  if (pub && g.measureText(pub).width > maxWidth) {
    while (pub && g.measureText(pub + "…").width > maxWidth) pub = pub.slice(0, -1);
    pub += "…";
  }
  g.fillText(pub, W / 2, H - 148);
  g.globalAlpha = 1;
  g.fillRect(W / 2 - 90, H - 108, 180, 3);

  g.font = '24px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.globalAlpha = 0.7;
  g.fillText(`${count} papers tracked`, W / 2, H - 62);
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  return tex;
}

// Carved-plate style label, reused for each specialist shelf zone's plaque.
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

// -------------------------------------------------------------- disposal --
function disposeObject(obj) {
  if (!obj) return;
  obj.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        m.map?.dispose(); m.dispose();
      });
    }
  });
  scene.remove(obj);
}

// ---------------------------------------------------------------- shelves --
// Paper counts (for spine width + the small count etched on the spine) use
// the archive-wide total from stats.json rather than the current window's
// row set — the current window's rows are filtered to whatever mode the 2D
// dashboard happens to be in, but this bookcase always shows ALL journals
// regardless of dashboard mode, so it needs a count source that isn't
// mode-scoped.
function archiveTotal(jid) { return ctx.state.stats?.journals?.[jid]?.total ?? 0; }

// Ranking for the general-shelf journals — mirrors app.js's own db/leiter +
// favourites logic, but always evaluated as if in "general" mode (the main
// shelves aren't tied to whatever field the 2D dashboard happens to be
// showing). favMap is only built when the Favourites ranking is active.
function generalRankOf(j, favMap) {
  if (ctx.state.rankMode === "favorites") return favMap.get(j.id) ?? Infinity;
  const r = ctx.state.ranking === "db" ? j.rankings?.db_pca : j.rankings?.leiter;
  return r ?? Infinity;
}
function computeGeneralFavMap(generalJournals) {
  const favs = ctx.getFavorites();
  const favSet = new Set(favs);
  const byDefault = (a, b) => (a.rankings?.db_pca ?? Infinity) - (b.rankings?.db_pca ?? Infinity);
  const favIn = favs.filter((id) => generalJournals.some((j) => j.id === id));
  const rest = generalJournals.filter((j) => !favSet.has(j.id)).slice().sort(byDefault);
  const map = new Map();
  [...favIn, ...rest.map((j) => j.id)].forEach((id, i) => map.set(id, i + 1));
  return map;
}

// Builds the ordered list of shelf sections: general first (unlabelled,
// main shelves), then one labelled section per specialist field that has
// any specialist-ONLY journals left after earlier fields have claimed
// theirs (so a journal appearing in more than one specialist field, should
// that ever occur in the registry, shelves once — in its first field).
function getSections() {
  const all = ctx.state.registry.journals;
  const general = all.filter((j) => j.modes.includes("general"));
  const generalIds = new Set(general.map((j) => j.id));
  const favMap = ctx.state.rankMode === "favorites" ? computeGeneralFavMap(general) : null;
  const generalSorted = general.slice().sort((a, b) => generalRankOf(a, favMap) - generalRankOf(b, favMap));

  const sections = [{ key: "general", label: null, journals: generalSorted, rankFn: (j) => generalRankOf(j, favMap) }];
  const assigned = new Set();
  SPECIALIST_FIELDS.forEach((field) => {
    const js = all.filter((j) => !generalIds.has(j.id) && j.modes.includes(field) && !assigned.has(j.id));
    js.forEach((j) => assigned.add(j.id));
    if (!js.length) return;
    const sorted = js.slice().sort((a, b) => (a.mode_rank?.[field] ?? Infinity) - (b.mode_rank?.[field] ?? Infinity));
    sections.push({ key: field, label: FIELD_LABELS[field], journals: sorted, rankFn: (j) => j.mode_rank?.[field] ?? Infinity });
  });
  return sections;
}

// Greedy shelf-row packer, BALANCED to the case's total width rather than a
// fixed cap: it first works out how many rows the content needs at roughly
// `targetWidth` each, then repacks against totalWidth/rows so every row
// (including the last) ends up close to evenly filled.
function packRowsBalanced(widths, targetWidth) {
  const totalW = widths.reduce((a, w) => a + w + GAP, 0) - GAP;
  const rows = Math.max(1, Math.ceil(totalW / targetWidth - 1e-9));
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

// Builds the single bookcase: general section's rows stacked at the top,
// then each specialist field's own row(s) below it (always starting a
// fresh row — sections never blend into the same row), all in one
// continuous carcass (one back wall, one pair of side walls, spanning the
// full height). A carved plate marks the first row of each labelled
// (specialist) section.
function buildBookcase() {
  const sections = getSections();
  const plankMat = new THREE.MeshBasicMaterial({ color: css("--baseline") || "#c3c2b7" });
  const backMat = new THREE.MeshBasicMaterial({ color: css("--grid") || "#e1e0d9" });

  const allJournals = [], allWidths = [], rowsMeta = [];
  sections.forEach((sec, si) => {
    const startIdx = allJournals.length;
    const widths = sec.journals.map((j) => 0.24 + Math.min(0.55, Math.log10(1 + (archiveTotal(j.id) || 0)) * 0.24));
    allJournals.push(...sec.journals);
    allWidths.push(...widths);
    packRowsBalanced(widths, SHELF_W).forEach((idxs, ri) =>
      rowsMeta.push({ idxs: idxs.map((i) => i + startIdx), sectionIdx: si, firstOfSection: ri === 0 }));
  });

  const topY = BASE_Y + (rowsMeta.length - 1) * ROW_SPACING;
  const caseWidth = Math.max(SHELF_W, ...rowsMeta.map((r) => r.idxs.reduce((w, i) => w + allWidths[i] + GAP, -GAP)));
  const group = new THREE.Group();

  rowsMeta.forEach((row, s) => {
    const rowW = row.idxs.reduce((w, i) => w + allWidths[i] + GAP, -GAP);
    const shelfY = topY - s * ROW_SPACING;
    const sec = sections[row.sectionIdx];
    let x = -rowW / 2;
    for (const i of row.idxs) {
      const j = allJournals[i], w = allWidths[i];
      const count = archiveTotal(j.id) || 0;
      const rank = sec.rankFn(j);
      const spineMat = new THREE.MeshBasicMaterial({ map: spineTexture(j, rank, count) });
      // BoxGeometry material order is [+x, -x, +y, -y, +z, -z]. +z carries
      // the spine (what's visible browsing the shelf); +x carries the front
      // cover — quaternionFacing() always turns a book's local +x toward
      // the camera when it flies out, so that's the face that needs to look
      // like a cover rather than a blank swatch (see coverTexture() above).
      const frontCoverMat = new THREE.MeshBasicMaterial({ map: coverTexture(j, rank, count) });
      const coverMat = new THREE.MeshBasicMaterial({ color: jcolor(j) });
      const pagesMat = new THREE.MeshBasicMaterial({ color: "#f3efe4" });
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, BOOK_H, BOOK_D),
        [frontCoverMat, coverMat, pagesMat, coverMat, spineMat, coverMat]);
      const home = new THREE.Vector3(x + w / 2, shelfY + BOOK_H / 2, 0);
      mesh.position.copy(home);
      mesh.userData = { kind: "book", journalId: j.id };
      scene.add(mesh);
      books.push({ mesh, journal: j, home, out: false, outPos: null, outQuat: null, section: sec.key });
      x += w + GAP;
    }
    const plank = new THREE.Mesh(new THREE.BoxGeometry(caseWidth + 1.2, 0.12, BOOK_D + 0.6), plankMat);
    plank.position.set(0, shelfY - 0.07, 0);
    group.add(plank);
    if (row.firstOfSection && sec.label) {
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 0.46),
        new THREE.MeshBasicMaterial({ map: labelTexture(sec.label), transparent: true }));
      label.position.set(0, shelfY + BOOK_H - 0.16, BOOK_D / 2 + 0.2);
      group.add(label);
    }
  });

  const totalH = rowsMeta.length * ROW_SPACING + 0.6;
  const back = new THREE.Mesh(new THREE.BoxGeometry(caseWidth + 1.2, totalH, 0.08), backMat);
  back.position.set(0, topY + BOOK_H - totalH / 2 + 0.4, -BOOK_D / 2 - 0.1);
  group.add(back);
  for (const wx of [-(caseWidth / 2 + 0.65), caseWidth / 2 + 0.65]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.14, totalH, BOOK_D + 0.6), plankMat);
    wall.position.set(wx, topY + BOOK_H - totalH / 2 + 0.4, 0);
    group.add(wall);
  }
  scene.add(group);
  mainGroup = group;
  caseInfo = { rows: rowsMeta.length, topY, caseWidth, totalH };
}

function buildShelf() {
  closeBook();
  books.forEach((b) => disposeObject(b.mesh));
  books = [];
  disposeObject(mainGroup);
  mainGroup = null;
  buildBookcase();
}

// ----------------------------------------------------- direct reading --
// Clicking a book both flies it out and opens the reading panel — no
// separate "place then open" step. Only one book is ever out; opening a
// different one first sends the previous one back to its slot.
const IDENTITY_QUAT = new THREE.Quaternion();
const OUT_DIST = 7.5, OUT_RIGHT = -1.4, OUT_UP = -0.1, OUT_SCALE = 1.4;
const _scratchScale = new THREE.Vector3();

// Any orthonormal, right-handed basis whose local +X axis points from
// `fromPos` toward `towardPos` — used so the book's front cover (the ±X
// faces) ends up facing the camera when it comes out, rather than just
// re-presenting its spine.
function quaternionFacing(fromPos, towardPos) {
  const x = new THREE.Vector3().subVectors(towardPos, fromPos).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let y = worldUp.clone().sub(x.clone().multiplyScalar(worldUp.dot(x)));
  if (y.lengthSq() < 1e-6) y = new THREE.Vector3(0, 0, 1); // x ~parallel to world up (rare)
  y.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// Freezes the "out" pose at the moment a book is picked, from the camera's
// position/orientation right now — the book flies to a fixed point in
// front of you and turns to face you; it doesn't keep chasing the camera
// if you look around afterwards. Offset left of dead-centre so it isn't
// hidden behind the reading panel, which is anchored to the right edge.
function computeOutTransform(book) {
  const dir = forwardVec(yaw, pitch);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(dir, worldUp).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  const pos = eye.clone().addScaledVector(dir, OUT_DIST).addScaledVector(right, OUT_RIGHT).addScaledVector(up, OUT_UP);
  book.outPos = pos;
  book.outQuat = quaternionFacing(pos, eye);
}

function openBook(book) {
  if (outBook && outBook !== book) { outBook.out = false; outBook.outPos = null; outBook.outQuat = null; }
  outBook = book;
  book.out = true;
  computeOutTransform(book);
  const rows = ctx.state.rows
    .filter((r) => r.journal === book.journal.id)
    .sort((a, b) => b.published.localeCompare(a.published));
  spreadState = { journal: book.journal, papers: rows, page: 0, pages: Math.max(1, Math.ceil(rows.length / PER_SPREAD)) };
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
  if (outBook) { outBook.out = false; outBook.outPos = null; outBook.outQuat = null; }
  outBook = null;
  document.getElementById("three-panel")?.classList.remove("show");
}

function renderPanel() {
  const { journal, papers, page, pages } = spreadState;
  const panel = document.getElementById("three-panel");
  const rank = ctx.rankOf(journal);
  const fmt = ctx.inferVolumeFormat(papers);
  panel.innerHTML = `<div class="panel-headrow">
      <h3>${ctx.esc(journal.name)}</h3>
      <button class="iconbtn closebtn" id="pg-close" title="Close — puts the book back on the shelf">✕ Close</button>
    </div>
    <div class="sub">${ctx.esc(journal.publisher)} · rank ${rank === Infinity ? "unranked" : rank} · ${papers.length} papers in window</div>
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

// ------------------------------------------------------------- interaction --
function interactiveMeshes() { return books.map((b) => b.mesh); }

function handleClick(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interactiveMeshes(), false);
  if (!hits.length) { if (spreadState) closeBook(); return; }
  const book = books.find((b) => b.mesh === hits[0].object);
  if (book) openBook(book);
}

function onKeyDown(e) {
  if (!running) return;
  if (e.key === "Escape" && spreadState) closeBook();
}

function dollyBy(amount) {
  const d = forwardVec(yaw, pitch);
  const next = eye.clone().addScaledVector(d, amount);
  const dist = next.distanceTo(distAnchor());
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
// around is exactly the point of pointing a real device. Drag is disabled
// while active (see onPointerMove) to avoid two input sources fighting
// over the camera; taps still work since click detection is independent
// of the rotation path.
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
    const targetPos = b.out ? b.outPos : b.home;
    const targetQuat = b.out ? b.outQuat : IDENTITY_QUAT;
    b.mesh.position.lerp(targetPos, 0.16);
    b.mesh.quaternion.slerp(targetQuat, 0.16);
    b.mesh.scale.lerp(_scratchScale.setScalar(b.out ? OUT_SCALE : 1), 0.16);
  });
  updateCameraLook();
  renderer.render(scene, camera);
}

// three.js PerspectiveCamera.fov is the VERTICAL field of view, so a fixed
// value gives a much narrower horizontal view on a tall/narrow phone
// viewport than on a wide desktop one — the shelf ends up cropped at both
// edges. Derive the vertical fov from a target *horizontal* fov instead, so
// framing stays sane; clamp so extreme aspect ratios don't fisheye.
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
    window.addEventListener("keydown", onKeyDown);
    built = true;
  }
  applyCameraFov();
  buildShelf();
  eye = homeEye();
  yaw = 0; pitch = homePitch();
  updateCameraLook();
  running = true;
  animate();
}

export function exit() {
  running = false;
  if (gyroActive) {
    gyroActive = false; gyroBase = null;
    window.removeEventListener("deviceorientation", onDeviceOrientation);
    document.getElementById("btn-aim")?.classList.remove("on");
  }
  closeBook();
}

export function setRanking() { if (running) buildShelf(); }
// The bookcase always shows every journal regardless of the 2D dashboard's
// current field — switching that field has nothing for the 3D view to
// react to, so this is a deliberate no-op (kept only so app.js's existing
// `S.three?.setMode?.()` call site needs no change).
export function setMode() {}

// ---------------------------------------------------------------- testing --
// Small read-only hooks for the screenshot/verification script — not used
// by the app itself.
export function _debugState() {
  return {
    running, built,
    cameraPos: camera ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : null,
    panelOpen: !!spreadState,
    bookOut: outBook ? outBook.journal.id : null,
    journalIds: books.map((b) => b.journal.id),
    generalOrder: books.filter((b) => b.section === "general").map((b) => b.journal.id),
  };
}
// Projects a shelved journal's book to CSS screen-space pixel coordinates,
// so the verification script can click it directly instead of guessing
// pixel positions.
export function _screenPosOf(journalId) {
  const b = books.find((x) => x.journal.id === journalId);
  if (!b || !camera || !renderer) return null;
  const v = b.mesh.position.clone().project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return { x: (v.x * 0.5 + 0.5) * rect.width + rect.left, y: (-v.y * 0.5 + 0.5) * rect.height + rect.top };
}
