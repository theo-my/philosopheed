/* Philosopheed — 3D ranked-shelf view (Three.js, vendored). */
import * as THREE from "three";
import { OrbitControls } from "../vendor/OrbitControls.js";

let ctx = null;           // injected from app.js on enter()
let renderer, scene, camera, controls, raycaster, pointer;
let panes = [];           // {mesh, journal, target: Vector3}
let yearSlabs = [];
let selected = null;
let running = false;
let built = false;

const css = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function themeColors() {
  return {
    page: css("--page") || "#f9f9f7",
    surface: css("--surface") || "#fcfcfb",
    ink: css("--ink") || "#0b0b0b",
    ink2: css("--ink-2") || "#52514e",
    muted: css("--muted") || "#898781",
    accent: css("--accent") || "#2a78d6",
    gold: css("--gold") || "#eda100",
  };
}

// ------------------------------------------------------------ pane texture --
function paneTexture(journal, rank, count) {
  const c = themeColors();
  const W = 1024, H = 560;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = c.surface;
  g.beginPath(); g.roundRect(0, 0, W, H, 28); g.fill();
  g.strokeStyle = c.accent; g.lineWidth = 6;
  g.beginPath(); g.roundRect(3, 3, W - 6, H - 6, 26); g.stroke();
  // rank badge
  g.fillStyle = rank <= 3 ? c.gold : c.accent;
  g.beginPath(); g.roundRect(36, 36, 130, 110, 20); g.fill();
  g.fillStyle = "#ffffff";
  g.font = "bold 72px system-ui, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(rank === Infinity ? "—" : String(rank), 101, 95);
  // name (wrapped)
  g.fillStyle = c.ink;
  g.font = "bold 58px system-ui, sans-serif";
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  const words = journal.name.split(" ");
  let line = "", y = 240;
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (g.measureText(t).width > W - 100 && line) {
      g.fillText(line, 48, y); y += 66; line = w;
    } else line = t;
    if (y > 380) break;
  }
  g.fillText(line, 48, y);
  // meta
  g.fillStyle = c.ink2;
  g.font = "36px system-ui, sans-serif";
  g.fillText(journal.publisher, 48, H - 96);
  g.fillStyle = c.muted;
  g.font = "34px system-ui, sans-serif";
  g.fillText(`${count} paper${count === 1 ? "" : "s"} in window`, 48, H - 44);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

// ------------------------------------------------------------------ build --
function layoutTargets() {
  // gentle arc: rank 1 center-front-top, later ranks fan outward and recede
  const js = ctx.rankedJournals();
  const counts = countsByJournal();
  js.forEach((j, i) => {
    const p = panes.find((p) => p.journal.id === j.id);
    if (!p) return;
    const side = i % 2 === 0 ? 1 : -1;          // alternate right/left of center
    const k = Math.ceil(i / 2);
    const angle = side * k * 0.30;
    const R = 14 + k * 1.1;
    p.target.set(Math.sin(angle) * R, 4 - k * 0.55, 14 - Math.cos(angle) * R);
    p.mesh.userData.rank = ctx.rankOf(j);
    p.mesh.userData.count = counts.get(j.id) || 0;
    p.mesh.visible = true;
  });
  // hide panes not in current mode
  const ids = new Set(js.map((j) => j.id));
  panes.forEach((p) => { if (!ids.has(p.journal.id)) p.mesh.visible = false; });
}

function countsByJournal() {
  const m = new Map();
  ctx.state.rows.forEach((r) => m.set(r.journal, (m.get(r.journal) || 0) + 1));
  return m;
}

function buildPanes() {
  panes.forEach((p) => { scene.remove(p.mesh); p.mesh.material.map?.dispose(); p.mesh.material.dispose(); });
  panes = [];
  const counts = countsByJournal();
  for (const j of ctx.rankedJournals()) {
    const count = counts.get(j.id) || 0;
    const scale = 1 + Math.min(1.0, Math.log10(1 + count) * 0.45);
    const geo = new THREE.PlaneGeometry(3.4 * scale, 1.86 * scale);
    const mat = new THREE.MeshBasicMaterial({
      map: paneTexture(j, ctx.rankOf(j), count),
      transparent: true, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.journalId = j.id;
    mesh.position.set(0, 2, -30);   // fly in from the back
    scene.add(mesh);
    panes.push({ mesh, journal: j, target: new THREE.Vector3() });
  }
  layoutTargets();
}

function clearYearSlabs() {
  yearSlabs.forEach((s) => { scene.remove(s); s.material.map?.dispose(); s.material.dispose(); });
  yearSlabs = [];
}

function showYearStack(pane) {
  clearYearSlabs();
  const c = themeColors();
  const ys = ctx.state.stats.journals[pane.journal.id]?.years || {};
  const years = Object.keys(ys).map(Number).sort((a, b) => b - a).slice(0, 14);
  years.forEach((y, i) => {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 90;
    const g = cv.getContext("2d");
    g.fillStyle = c.surface; g.globalAlpha = 0.92;
    g.beginPath(); g.roundRect(0, 0, 512, 90, 16); g.fill();
    g.globalAlpha = 1;
    g.fillStyle = c.ink2; g.font = "bold 44px system-ui, sans-serif";
    g.textBaseline = "middle";
    g.fillText(String(y), 28, 47);
    g.fillStyle = c.muted; g.font = "36px system-ui, sans-serif";
    g.fillText(`${ys[y]} papers`, 170, 47);
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true });
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.42), mat);
    const base = pane.mesh.position;
    slab.position.set(base.x, base.y - 1.4 - i * 0.05, base.z - 1.2 - i * 1.05);
    slab.lookAt(camera.position);
    scene.add(slab);
    yearSlabs.push(slab);
  });
}

// ------------------------------------------------------------------ panel --
function showPanel(journal) {
  const rows = ctx.state.rows
    .filter((r) => r.journal === journal.id)
    .sort((a, b) => b.published.localeCompare(a.published));
  const panel = document.getElementById("three-panel");
  const rank = ctx.rankOf(journal);
  panel.innerHTML = `<h3>${ctx.esc(journal.name)}</h3>
    <div class="sub">${ctx.esc(journal.publisher)} · rank ${rank === Infinity ? "unranked" : rank} · ${rows.length} papers in window</div>`;
  rows.slice(0, 40).forEach((r) => {
    const b = document.createElement("button");
    b.className = "paper";
    b.innerHTML = `<div class="ptitle">${ctx.esc(r.title)}</div>
      <div class="pmeta">${ctx.esc((r.authors || []).join(", "))} · ${r.published}</div>`;
    b.addEventListener("click", () => ctx.openPaper(r));
    panel.append(b);
  });
  if (rows.length > 40) {
    const note = document.createElement("div");
    note.className = "sub";
    note.style.marginTop = "8px";
    note.textContent = `…and ${rows.length - 40} more — use the dashboard view for the full list.`;
    panel.append(note);
  }
  panel.classList.add("show");
}

// ------------------------------------------------------------- interaction --
function onClick(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(panes.filter((p) => p.mesh.visible).map((p) => p.mesh));
  if (!hits.length) {
    selected = null;
    document.getElementById("three-panel").classList.remove("show");
    clearYearSlabs();
    return;
  }
  const pane = panes.find((p) => p.mesh === hits[0].object);
  selected = pane;
  showPanel(pane.journal);
  showYearStack(pane);
  // fly toward the pane
  const t = pane.target.clone().add(new THREE.Vector3(0, 0.4, 5.2));
  flyTo(t, pane.target);
}

let flight = null;
function flyTo(camPos, lookAt) {
  flight = {
    fromP: camera.position.clone(), toP: camPos,
    fromT: controls.target.clone(), toT: lookAt.clone(),
    t: 0,
  };
}

// ------------------------------------------------------------------- loop --
function animate() {
  if (!running) return;
  requestAnimationFrame(animate);
  panes.forEach((p) => {
    if (p.mesh.visible) {
      p.mesh.position.lerp(p.target, 0.06);
      p.mesh.lookAt(camera.position.x, p.mesh.position.y, camera.position.z + 8);
    }
  });
  if (flight) {
    flight.t = Math.min(1, flight.t + 0.03);
    const k = 1 - Math.pow(1 - flight.t, 3);
    camera.position.lerpVectors(flight.fromP, flight.toP, k);
    controls.target.lerpVectors(flight.fromT, flight.toT, k);
    if (flight.t >= 1) flight = null;
  }
  controls.update();
  renderer.render(scene, camera);
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// -------------------------------------------------------------------- API --
export function enter(context) {
  ctx = context;
  if (!built) {
    const holder = document.getElementById("three-canvas");
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    holder.append(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
    camera.position.set(0, 3.2, 22);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 1.5, 0);
    controls.maxDistance = 60;
    controls.minDistance = 3;
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    renderer.domElement.addEventListener("click", onClick);
    window.addEventListener("resize", onResize);
    built = true;
  }
  buildPanes();
  running = true;
  animate();
}

export function exit() {
  running = false;
  selected = null;
  clearYearSlabs();
  document.getElementById("three-panel").classList.remove("show");
}

export function setRanking() { if (running) buildPanes(); }
export function setMode() { if (running) buildPanes(); }
