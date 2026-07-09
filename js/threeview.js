/* Philosopheed — 3D bookshelf view.
   Journals are books on ranked shelves (spine width ∝ volume, spine colour =
   cover colour). Click a book: it slides out and opens as a two-page spread of
   its papers; click the right/left page (or use the panel buttons) to turn
   pages; click a paper in the side panel for the full record. */
import * as THREE from "three";
import { OrbitControls } from "../vendor/OrbitControls.js";

let ctx = null;
let renderer, scene, camera, controls, raycaster, pointer;
let books = [];            // {mesh, journal, home: Vector3, out: Vector3}
let caseGroup = null;      // shelves + panels
let spread = null;         // open-book mesh
let spreadState = null;    // {journal, papers, page, pages}
let selected = null;
let running = false, built = false;
let flight = null;

const BOOK_H = 2.3, BOOK_D = 1.55, GAP = 0.07, SHELF_W = 15.5;
const HOME_CAM = new THREE.Vector3(0, 1.6, 13.5);
const HOME_TGT = new THREE.Vector3(0, 1.0, 0);
const PER_SPREAD = 10; // 5 per page

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
  // subtle edge shading
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "rgba(0,0,0,0.25)");
  grad.addColorStop(0.12, "rgba(0,0,0,0)");
  grad.addColorStop(0.88, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.25)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // rank
  g.fillStyle = text;
  g.font = 'bold 64px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(rank === Infinity ? "–" : String(rank), W / 2, 70);
  g.fillRect(W / 2 - 40, 125, 80, 4);
  // title down the spine
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
  // count near the bottom
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

// ----------------------------------------------------------------- shelves --
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

function countsByJournal() {
  const m = new Map();
  ctx.state.rows.forEach((r) => m.set(r.journal, (m.get(r.journal) || 0) + 1));
  return m;
}

function buildShelf() {
  books.forEach((b) => disposeGroup(b.mesh));
  books = [];
  disposeGroup(caseGroup);
  caseGroup = new THREE.Group();

  const js = ctx.rankedJournals();
  const counts = countsByJournal();
  // pass 1: widths, split into shelves
  const widths = js.map((j) => 0.24 + Math.min(0.55, Math.log10(1 + (counts.get(j.id) || 0)) * 0.24));
  const shelves = [[]];
  let acc = 0;
  js.forEach((j, i) => {
    if (acc + widths[i] > SHELF_W) { shelves.push([]); acc = 0; }
    shelves[shelves.length - 1].push(i);
    acc += widths[i] + GAP;
  });
  const topY = 1.0 + (shelves.length - 1) * 1.55;
  const plankMat = new THREE.MeshBasicMaterial({ color: css("--baseline") || "#c3c2b7" });
  const backMat = new THREE.MeshBasicMaterial({ color: css("--grid") || "#e1e0d9" });

  shelves.forEach((idxs, s) => {
    const rowW = idxs.reduce((w, i) => w + widths[i] + GAP, -GAP);
    const shelfY = topY - s * 3.1;
    let x = -rowW / 2;
    for (const i of idxs) {
      const j = js[i], w = widths[i];
      const count = counts.get(j.id) || 0;
      const spineMat = new THREE.MeshBasicMaterial({ map: spineTexture(j, ctx.rankOf(j), count) });
      const coverMat = new THREE.MeshBasicMaterial({ color: jcolor(j) });
      const pagesMat = new THREE.MeshBasicMaterial({ color: "#f3efe4" });
      // faces: +x, -x, +y(top), -y, +z(spine), -z
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, BOOK_H, BOOK_D),
        [coverMat, coverMat, pagesMat, coverMat, spineMat, coverMat]);
      const home = new THREE.Vector3(x + w / 2, shelfY + BOOK_H / 2, 0);
      mesh.position.copy(home);
      mesh.userData.journalId = j.id;
      scene.add(mesh);
      books.push({ mesh, journal: j, home, out: home.clone().setZ(1.15) });
      x += w + GAP;
    }
    // plank under the row
    const plank = new THREE.Mesh(new THREE.BoxGeometry(SHELF_W + 1.2, 0.12, BOOK_D + 0.6), plankMat);
    plank.position.set(0, shelfY - 0.07, 0);
    caseGroup.add(plank);
  });
  // back panel + sides
  const totalH = shelves.length * 3.1 + 0.6;
  const back = new THREE.Mesh(new THREE.BoxGeometry(SHELF_W + 1.2, totalH, 0.08), backMat);
  back.position.set(0, topY + BOOK_H - totalH / 2 + 0.4, -BOOK_D / 2 - 0.1);
  caseGroup.add(back);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.14, totalH, BOOK_D + 0.6), plankMat);
    wall.position.set(side * (SHELF_W / 2 + 0.65), back.position.y, 0);
    caseGroup.add(wall);
  }
  scene.add(caseGroup);
}

// -------------------------------------------------------------- open book --
function spreadTexture() {
  const { journal, papers, page, pages } = spreadState;
  const W = 2048, H = 1200;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  // paper
  g.fillStyle = "#faf7ee";
  g.fillRect(0, 0, W, H);
  const gut = g.createLinearGradient(W / 2 - 60, 0, W / 2 + 60, 0);
  gut.addColorStop(0, "rgba(0,0,0,0)");
  gut.addColorStop(0.5, "rgba(0,0,0,0.18)");
  gut.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gut;
  g.fillRect(W / 2 - 60, 0, 120, H);
  g.fillStyle = "#2b2a26";
  g.font = 'bold 44px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.fillText(journal.name, 70, 80);
  g.font = '30px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.fillStyle = "#7a776e";
  g.textAlign = "right";
  g.fillText(`spread ${page + 1} / ${pages}`, W - 70, 80);
  g.textAlign = "left";

  const start = page * PER_SPREAD;
  const slice = papers.slice(start, start + PER_SPREAD);
  const colX = [70, W / 2 + 70];
  const colW = W / 2 - 150;
  slice.forEach((p, i) => {
    const x = colX[i < 5 ? 0 : 1];
    const y = 170 + (i % 5) * 200;
    g.fillStyle = "#1d1c19";
    g.font = 'bold 34px "Century Schoolbook", "CMU Serif", Georgia, serif';
    // canvas text can't render HTML — strip any inline markup to plain text
    wrapText(g, ctx.stripInlineToText(p.title), x, y, colW, 42, 2);
    g.fillStyle = "#6d6a61";
    g.font = '28px "Century Schoolbook", "CMU Serif", Georgia, serif';
    const byline = `${(p.authors || []).join(", ")} · ${p.published}`;
    wrapText(g, byline, x, y + 92, colW, 34, 1);
    g.strokeStyle = "rgba(0,0,0,0.08)";
    g.beginPath(); g.moveTo(x, y + 140); g.lineTo(x + colW, y + 140); g.stroke();
  });
  if (!slice.length) {
    g.fillStyle = "#7a776e";
    g.font = '34px "Century Schoolbook", "CMU Serif", Georgia, serif';
    g.fillText("No papers in the current window.", 70, 200);
  }
  g.fillStyle = "#a29e93";
  g.font = '26px "Century Schoolbook", "CMU Serif", Georgia, serif';
  g.fillText("click right page to turn ▸", 70, H - 40);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  return tex;
}

function wrapText(g, text, x, y, maxW, lh, maxLines) {
  const words = String(text).split(" ");
  let line = "", lines = 0;
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (g.measureText(t).width > maxW && line) {
      if (lines === maxLines - 1) {
        while (g.measureText(line + "…").width > maxW) line = line.slice(0, -1);
        g.fillText(line + "…", x, y + lines * lh);
        return;
      }
      g.fillText(line, x, y + lines * lh);
      lines++; line = w;
    } else line = t;
  }
  g.fillText(line, x, y + lines * lh);
}

function openBook(book) {
  const rows = ctx.state.rows
    .filter((r) => r.journal === book.journal.id)
    .sort((a, b) => b.published.localeCompare(a.published));
  spreadState = {
    journal: book.journal, papers: rows, page: 0,
    pages: Math.max(1, Math.ceil(rows.length / PER_SPREAD)),
  };
  if (!spread) {
    spread = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 3.28),
      new THREE.MeshBasicMaterial({ map: null, transparent: true }));
    scene.add(spread);
  }
  spread.material.map?.dispose();
  spread.material.map = spreadTexture();
  spread.material.needsUpdate = true;
  spread.position.set(0, 1.15, 5.4);
  spread.visible = true;
  flyTo(new THREE.Vector3(0, 1.35, 9.6), spread.position);
  renderPanel();
}

function turnPage(dir) {
  if (!spreadState) return;
  const next = spreadState.page + dir;
  if (next < 0 || next >= spreadState.pages) return;
  spreadState.page = next;
  spread.material.map?.dispose();
  spread.material.map = spreadTexture();
  spread.material.needsUpdate = true;
  renderPanel();
}

function closeBook() {
  if (spread) spread.visible = false;
  spreadState = null;
  if (selected) selected = null;
  document.getElementById("three-panel").classList.remove("show");
  flyTo(HOME_CAM, HOME_TGT);
}

// ------------------------------------------------------------------ panel --
function renderPanel() {
  const { journal, papers, page, pages } = spreadState;
  const panel = document.getElementById("three-panel");
  const rank = ctx.rankOf(journal);
  panel.innerHTML = `<h3>${ctx.esc(journal.name)}</h3>
    <div class="sub">${ctx.esc(journal.publisher)} · rank ${rank === Infinity ? "unranked" : rank} · ${papers.length} papers in window</div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <button class="iconbtn" id="pg-prev">‹</button>
      <span class="sub" style="margin:0">spread ${page + 1} / ${pages}</span>
      <button class="iconbtn" id="pg-next">›</button>
      <button class="iconbtn" id="pg-close" style="margin-left:auto">Close book</button>
    </div>`;
  panel.querySelector("#pg-prev").addEventListener("click", () => turnPage(-1));
  panel.querySelector("#pg-next").addEventListener("click", () => turnPage(1));
  panel.querySelector("#pg-close").addEventListener("click", closeBook);
  papers.slice(page * PER_SPREAD, page * PER_SPREAD + PER_SPREAD).forEach((r) => {
    const b = document.createElement("button");
    b.className = "paper";
    b.innerHTML = `<div class="ptitle">${ctx.sanitizeInline(r.title)}</div>
      <div class="pmeta">${ctx.esc((r.authors || []).join(", "))} · ${r.published}</div>`;
    b.addEventListener("click", () => ctx.openPaper(r));
    panel.append(b);
  });
  panel.classList.add("show");
}

// ------------------------------------------------------------- interaction --
function onClick(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  // page turn when the spread is open and clicked
  if (spread?.visible) {
    const hit = raycaster.intersectObject(spread);
    if (hit.length) {
      turnPage(hit[0].uv.x > 0.5 ? 1 : -1);
      return;
    }
  }
  const hits = raycaster.intersectObjects(books.map((b) => b.mesh));
  if (!hits.length) { if (spreadState) closeBook(); return; }
  const book = books.find((b) => b.mesh === hits[0].object);
  selected = book;
  openBook(book);
}

function flyTo(camPos, lookAt) {
  flight = {
    fromP: camera.position.clone(), toP: camPos.clone(),
    fromT: controls.target.clone(), toT: lookAt.clone(), t: 0,
  };
}

// -------------------------------------------------------------------- loop --
function animate() {
  if (!running) return;
  requestAnimationFrame(animate);
  books.forEach((b) => {
    const target = b === selected ? b.out : b.home;
    b.mesh.position.lerp(target, 0.16);
  });
  if (flight) {
    flight.t = Math.min(1, flight.t + 0.045);
    const k = 1 - Math.pow(1 - flight.t, 3);
    camera.position.lerpVectors(flight.fromP, flight.toP, k);
    controls.target.lerpVectors(flight.fromT, flight.toT, k);
    if (flight.t >= 1) flight = null;
  }
  controls.update();
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
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
    camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
    camera.position.copy(HOME_CAM);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.rotateSpeed = 0.55;
    controls.target.copy(HOME_TGT);
    controls.minDistance = 2.5;
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI * 0.62;
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    renderer.domElement.addEventListener("click", onClick);
    window.addEventListener("resize", onResize);
    built = true;
  }
  buildShelf();
  camera.position.copy(HOME_CAM);
  controls.target.copy(HOME_TGT);
  running = true;
  animate();
}

export function exit() {
  running = false;
  if (spreadState) {
    spread.visible = false;
    spreadState = null;
    selected = null;
  }
  document.getElementById("three-panel").classList.remove("show");
}

export function setRanking() { if (running) { closeBook(); buildShelf(); } }
export function setMode() { if (running) { closeBook(); buildShelf(); } }
