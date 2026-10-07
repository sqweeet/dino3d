/* Дино 3D — трёхмерный ремейк раннера с динозавриком (Chrome Dino).
   Строго монохромная графика: чёрный, белый и оттенки серого. Без текстур.
   В модуле: сцена three.js, низкополигональный T-Rex, кактусы и птеродактили,
   облака-параллакс, пыль, тени, игровая логика, HUD и панель тестов/бенчмарков. */

import * as THREE from "three";

const NL = String.fromCharCode(10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const lerp = (a, b, t) => a + (b - a) * t;
const pad5 = (n) => String(Math.max(0, Math.floor(n))).padStart(5, "0");

/* ---------------------------------------------------------------- */
/* Ошибки на странице                                               */
/* ---------------------------------------------------------------- */
const errBox = document.getElementById("errors");
const errors = [];
function reportError(kind, message) {
  errors.push(kind + ": " + message);
  console.error("[dino3d] " + kind + ": " + message);
  if (errBox) { errBox.hidden = false; errBox.textContent += kind + ": " + message + NL; }
  document.documentElement.setAttribute("data-errors", String(errors.length));
}
window.addEventListener("error", (e) => reportError("Ошибка", (e.message || "unknown") + " @ " + (e.filename || "") + ":" + (e.lineno || 0)));
window.addEventListener("unhandledrejection", (e) => reportError("Promise", String((e.reason && e.reason.message) || e.reason)));

/* ---------------------------------------------------------------- */
/* Качество, мир, состояние                                         */
/* ---------------------------------------------------------------- */
const QUALITY = {
  low:    { label: "Низкое",  pixelRatio: 1.0, shadows: false, shadowSize: 1024, clouds: 5,  dust: 12, pebbles: 8 },
  medium: { label: "Среднее", pixelRatio: 1.5, shadows: true,  shadowSize: 1024, clouds: 9,  dust: 20, pebbles: 16 },
  high:   { label: "Высокое", pixelRatio: 2.0, shadows: true,  shadowSize: 2048, clouds: 14, dust: 30, pebbles: 22 }
};
const MAX_CLOUDS = 14;
const MAX_DUST = 30;
const MAX_PEBBLES = 22;

const REX_X = -2.0;
const SPAWN_X = 13.5;
const DESPAWN_X = -9.5;
const SPEED_START = 10;
const SPEED_MAX = 32;
const SPEED_RAMP = 0.34;
const GRAVITY = 38;
const JUMP_V = 13.2;
const DUCK_SCALE = 0.42;
const REX_TOP = 2.52;

const state = {
  quality: "medium",
  paused: false,
  gameOver: false,
  shadows: true,
  dust: true,
  clouds: true,
  benchActive: false,
  ducking: false,
  airborne: false,
  vy: 0,
  y: 0,
  speed: SPEED_START,
  elapsed: 0,
  score: 0,
  hi: 0,
  frames: 0
};

/* Параметры URL: ?ff=сек (промотка), ?demo=1 (показ без столкновений), ?obst=cactus|ptero (форс типа). */
const URL_PARAMS = new URLSearchParams(window.location.search);
const FORCE_OBST = URL_PARAMS.get("obst") || "";

const HI_KEY = "dino3d.hi";
function loadHi() {
  try { const v = window.localStorage.getItem(HI_KEY); return v ? Math.max(0, parseInt(v, 10) || 0) : 0; }
  catch (e) { return 0; }
}
function saveHi(v) { try { window.localStorage.setItem(HI_KEY, String(v)); } catch (e) {} }
state.hi = loadHi();

/* ---------------------------------------------------------------- */
/* Рендерер, сцена, камера                                          */
/* ---------------------------------------------------------------- */
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setClearColor(0x000000, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;

const gl = renderer.getContext();

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 30, 105);

const camera = new THREE.PerspectiveCamera(44, 1.6, 0.1, 250);
camera.position.set(0.4, 3.6, 14.2);
camera.lookAt(0.4, 1.8, 0);

/* ---------------------------------------------------------------- */
/* Свет — только белый, чтобы картинка оставалась монохромной        */
/* ---------------------------------------------------------------- */
const hemi = new THREE.HemisphereLight(0xffffff, 0x2b2b2b, 1.0);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(6, 12, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 46;
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -6;
sun.shadow.bias = -0.0015;
sun.shadow.normalBias = 0.02;
sun.target.position.set(3, 0, 0);
scene.add(sun);
scene.add(sun.target);

const rim = new THREE.DirectionalLight(0xffffff, 0.55);
rim.position.set(-7, 5, -8);
scene.add(rim);

/* ---------------------------------------------------------------- */
/* Материалы (монохром)                                             */
/* ---------------------------------------------------------------- */
const MAT = {
  white:  new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
  light:  new THREE.MeshLambertMaterial({ color: 0xd9d9d9, flatShading: true }),
  mid:    new THREE.MeshLambertMaterial({ color: 0x9a9a9a, flatShading: true }),
  dark:   new THREE.MeshLambertMaterial({ color: 0x555555, flatShading: true }),
  cloud:  new THREE.MeshLambertMaterial({ color: 0x7d7d7d, flatShading: true }),
  pebble: new THREE.MeshLambertMaterial({ color: 0x6f6f6f, flatShading: true }),
  black:  new THREE.MeshBasicMaterial({ color: 0x000000 }),
  ground: new THREE.MeshLambertMaterial({ color: 0x101010 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false })
};

function box(w, h, d, x, y, z, mat, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (parent) parent.add(m);
  return m;
}

/* ---------------------------------------------------------------- */
/* Земля                                                            */
/* ---------------------------------------------------------------- */
const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(400, 260), MAT.ground);
groundPlane.rotation.x = -Math.PI / 2;
groundPlane.position.set(0, 0, -60);
groundPlane.receiveShadow = true;
scene.add(groundPlane);

const groundLine = new THREE.Mesh(new THREE.BoxGeometry(400, 0.05, 0.1), MAT.white);
groundLine.position.set(0, 0.03, 0.2);
scene.add(groundLine);

/* ---------------------------------------------------------------- */
/* Тираннозавр                                                      */
/* ---------------------------------------------------------------- */
function buildRex() {
  const g = new THREE.Group();
  box(1.55, 1.05, 0.8, 0, 1.18, 0, MAT.white, g);
  box(0.55, 0.8, 0.7, 0.72, 1.28, 0, MAT.white, g);
  box(0.5, 0.7, 0.55, 0.6, 1.78, 0, MAT.white, g);
  box(0.95, 0.6, 0.62, 1.2, 2.02, 0, MAT.white, g);
  box(0.55, 0.3, 0.5, 1.76, 1.92, 0, MAT.white, g);
  box(0.5, 0.16, 0.46, 1.7, 1.72, 0, MAT.light, g);
  box(0.14, 0.14, 0.14, 1.42, 2.18, 0.3, MAT.black, g);
  box(0.14, 0.14, 0.14, 1.42, 2.18, -0.3, MAT.black, g);
  box(0.5, 0.2, 0.36, 0.98, 2.4, 0, MAT.light, g);
  const t1 = box(1.05, 0.5, 0.5, -1.1, 1.32, 0, MAT.white, g);
  t1.rotation.z = 0.2;
  const t2 = box(0.75, 0.3, 0.36, -1.8, 1.62, 0, MAT.white, g);
  t2.rotation.z = 0.34;
  const t3 = box(0.42, 0.2, 0.28, -2.2, 1.86, 0, MAT.light, g);
  t3.rotation.z = 0.44;
  box(0.3, 0.22, 0.2, 0.85, 1.5, 0.44, MAT.light, g);
  box(0.3, 0.22, 0.2, 0.85, 1.5, -0.44, MAT.light, g);
  const legs = [];
  for (const z of [0.3, -0.3]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.05, 0.98, z);
    g.add(pivot);
    box(0.32, 0.9, 0.34, 0, -0.45, 0, MAT.white, pivot);
    box(0.62, 0.16, 0.44, 0.16, -0.9, 0, MAT.light, pivot);
    legs.push(pivot);
  }
  return { group: g, legs, tail: t1, tail2: t2 };
}

const rex = buildRex();
rex.group.position.set(REX_X, 0, 0);
scene.add(rex.group);

const rexShadow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24), MAT.shadow);
rexShadow.rotation.x = -Math.PI / 2;
rexShadow.position.set(REX_X, 0.05, 0);
scene.add(rexShadow);

/* ---------------------------------------------------------------- */
/* Препятствия                                                      */
/* ---------------------------------------------------------------- */
function buildCactus(h, w, cluster) {
  const g = new THREE.Group();
  const n = cluster || 1;
  let width = 0;
  for (let i = 0; i < n; i++) {
    const dx = (i - (n - 1) / 2) * (w * 1.7);
    box(w, h, w * 0.85, dx, h / 2, 0, MAT.white, g);
    if (h > 1.05) {
      const ah = h * 0.42;
      box(w * 0.62, ah, w * 0.62, dx - w * 0.85, h * 0.58, 0, MAT.white, g);
      box(w * 0.5, ah * 0.6, w * 0.5, dx - w * 1.25, h * 0.42, 0, MAT.white, g);
      box(w * 0.62, ah * 0.8, w * 0.62, dx + w * 0.85, h * 0.5, 0, MAT.white, g);
    }
    width += w * 1.7;
  }
  return { group: g, w: width + w * 1.7 };
}

function buildPtero() {
  const g = new THREE.Group();
  box(0.95, 0.36, 0.42, 0, 0, 0, MAT.white, g);
  box(0.42, 0.44, 0.38, 0.4, 0.03, 0, MAT.white, g);
  box(0.36, 0.34, 0.32, 0.72, 0.18, 0, MAT.light, g);
  box(0.36, 0.16, 0.2, 0.58, 0.36, 0, MAT.white, g);
  box(0.66, 0.11, 0.16, 1.12, 0.12, 0, MAT.white, g);
  box(0.12, 0.12, 0.12, 0.8, 0.24, 0.17, MAT.black, g);
  box(0.12, 0.12, 0.12, 0.8, 0.24, -0.17, MAT.black, g);
  const t = box(0.5, 0.14, 0.18, -0.62, 0.05, 0, MAT.light, g);
  t.rotation.z = 0.1;
  const wings = [];
  for (const s of [1, -1]) {
    const wp = new THREE.Group();
    wp.position.set(0.05, 0.16, 0.26 * s);
    g.add(wp);
    box(0.78, 0.15, 0.16, -0.36, 0.02, 0, MAT.light, wp);
    const tip = box(0.62, 0.13, 0.14, -0.98, -0.24, 0, MAT.light, wp);
    tip.rotation.z = 0.42;
    wings.push(wp);
  }
  return { group: g, wings };
}

const obstacles = [];

function disposeGroup(g) {
  g.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
}

function pickObstacle() {
  const t = state.elapsed;
  if (FORCE_OBST === "ptero") return { kind: "ptero" };
  if (t > 20 && FORCE_OBST !== "cactus" && Math.random() < 0.3) return { kind: "ptero" };
  const sizes = [{ h: 0.95, w: 0.42 }];
  if (t > 12) sizes.push({ h: 1.45, w: 0.52 });
  if (t > 32) sizes.push({ h: 1.85, w: 0.6 });
  return { kind: "cactus", size: sizes[randInt(0, sizes.length - 1)] };
}

function spawnObstacle() {
  const pick = pickObstacle();
  if (pick.kind === "ptero") {
    const high = Math.random() < 0.45;
    const built = buildPtero();
    const baseY = high ? 3.15 : 1.62;
    const o = {
      group: built.group, x: SPAWN_X, fly: true, wings: built.wings,
      w: 1.3, y0: baseY - 0.45, y1: baseY + 0.5, baseY, phase: rand(0, 6.28)
    };
    o.group.scale.setScalar(1.15);
    o.group.position.set(o.x, baseY, 0);
    scene.add(o.group);
    obstacles.push(o);
  } else {
    const cluster = (state.elapsed > 45 && Math.random() < 0.3) ? randInt(2, 3) : 1;
    const built = buildCactus(pick.size.h, pick.size.w, cluster);
    const o = { group: built.group, x: SPAWN_X, fly: false, w: built.w, y0: 0, y1: pick.size.h };
    o.group.position.set(o.x, 0, 0);
    scene.add(o.group);
    obstacles.push(o);
  }
}

function updateObstacles(dt) {
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.x -= (o.fly ? state.speed + 2.5 : state.speed) * dt;
    o.group.position.x = o.x;
    if (o.fly) {
      o.group.position.y = o.baseY + Math.sin(state.elapsed * 5 + o.phase) * 0.14;
      const f = Math.sin(state.elapsed * 8 + o.phase) * 0.38;
      for (const w of o.wings) w.rotation.z = f;
    }
    if (o.x < DESPAWN_X) {
      scene.remove(o.group);
      disposeGroup(o.group);
      obstacles.splice(i, 1);
    }
  }
  const lastX = obstacles.length ? obstacles[obstacles.length - 1].x : -Infinity;
  const gap = clamp(state.speed * 0.68, 7, 26) + rand(1.5, 5);
  if (lastX < SPAWN_X - gap) spawnObstacle();
}

function clearObstacles() {
  for (const o of obstacles) { scene.remove(o.group); disposeGroup(o.group); }
  obstacles.length = 0;
}

/* ---------------------------------------------------------------- */
/* Облака (параллакс)                                               */
/* ---------------------------------------------------------------- */
const clouds = [];
function makeCloud() {
  const g = new THREE.Group();
  const n = randInt(3, 5);
  for (let i = 0; i < n; i++) {
    const s = rand(0.8, 1.6);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), MAT.cloud);
    m.position.set(-1.7 + i * 0.9 + rand(-0.18, 0.18), rand(-0.14, 0.18), rand(-0.35, 0.35));
    m.scale.set(1.35, 0.5, 0.85);
    g.add(m);
  }
  return g;
}
for (let i = 0; i < MAX_CLOUDS; i++) {
  const c = makeCloud();
  c.position.set(rand(-34, 34), rand(4.2, 8.4), rand(-26, -9));
  c.userData.par = clamp((c.position.z + 30) / 24, 0.25, 1);
  scene.add(c);
  clouds.push(c);
}

function updateClouds(dt) {
  const n = state.clouds ? QUALITY[state.quality].clouds : 0;
  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i];
    c.visible = i < n;
    if (!c.visible) continue;
    c.position.x -= state.speed * 0.16 * c.userData.par * dt;
    if (c.position.x < -38) c.position.x = 38;
  }
}

/* ---------------------------------------------------------------- */
/* Камешки на земле — дают ощущение движения                       */
/* ---------------------------------------------------------------- */
const pebbleGeo = new THREE.TetrahedronGeometry(0.11, 0);
const pebbles = [];
for (let i = 0; i < MAX_PEBBLES; i++) {
  const m = new THREE.Mesh(pebbleGeo, MAT.pebble);
  m.position.set(rand(-30, 30), 0.04, rand(-3.5, 1.5));
  m.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
  m.scale.setScalar(rand(0.6, 1.5));
  scene.add(m);
  pebbles.push(m);
}
function updatePebbles(dt) {
  const n = QUALITY[state.quality].pebbles;
  for (let i = 0; i < pebbles.length; i++) {
    const p = pebbles[i];
    p.visible = i < n;
    if (!p.visible) continue;
    p.position.x -= state.speed * dt;
    p.rotation.x += dt * 0.6;
    if (p.position.x < -32) p.position.x = 32;
  }
}

/* ---------------------------------------------------------------- */
/* Пыль при приземлении                                             */
/* ---------------------------------------------------------------- */
const dustGeo = new THREE.TetrahedronGeometry(0.1, 0);
const dust = [];
for (let i = 0; i < MAX_DUST; i++) {
  const m = new THREE.Mesh(dustGeo, MAT.light);
  m.visible = false;
  scene.add(m);
  dust.push({ mesh: m, life: 0, ttl: 1, vx: 0, vy: 0, vz: 0 });
}

function spawnDust(x, y, strength) {
  const cap = state.dust ? QUALITY[state.quality].dust : 0;
  const n = Math.round(cap * 0.55 * strength);
  let spawned = 0;
  for (let i = 0; i < dust.length && spawned < n; i++) {
    const d = dust[i];
    if (i >= cap || d.life > 0) continue;
    d.ttl = d.life = rand(0.35, 0.7);
    d.vx = -rand(1, 4.5) * strength;
    d.vy = rand(0.6, 3.2);
    d.vz = rand(-1.3, 1.3);
    d.mesh.position.set(x + rand(-0.35, 0.45), y + rand(0.02, 0.28), rand(-0.5, 0.5));
    d.mesh.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
    d.mesh.visible = true;
    spawned++;
  }
}

function updateDust(dt) {
  for (const d of dust) {
    if (d.life <= 0) continue;
    d.life -= dt;
    if (d.life <= 0) { d.mesh.visible = false; continue; }
    d.vy -= 15 * dt;
    d.mesh.position.x += d.vx * dt;
    d.mesh.position.y += d.vy * dt;
    d.mesh.position.z += d.vz * dt;
    if (d.mesh.position.y < 0.05) { d.mesh.position.y = 0.05; d.vy = 0; d.vx *= 0.7; d.vz *= 0.7; }
    d.mesh.rotation.x += dt * 7;
    d.mesh.rotation.y += dt * 5;
    const k = clamp(d.life / d.ttl, 0, 1);
    d.mesh.scale.setScalar(0.5 + k * 1.2);
  }
}

/* ---------------------------------------------------------------- */
/* Игровая логика                                                   */
/* ---------------------------------------------------------------- */
const ui = {
  stage: document.getElementById("stage"),
  fpsHud: document.getElementById("fpsHud"),
  hudHi: document.getElementById("hudHi"),
  hudScore: document.getElementById("hudScore"),
  hudSpeed: document.getElementById("hudSpeed"),
  stFps: document.getElementById("stFps"),
  stFrame: document.getElementById("stFrame"),
  stCalls: document.getElementById("stCalls"),
  stTris: document.getElementById("stTris"),
  stScore: document.getElementById("stScore"),
  stHi: document.getElementById("stHi"),
  stSpeed: document.getElementById("stSpeed"),
  stTime: document.getElementById("stTime"),
  obsCount: document.getElementById("obsCount"),
  pauseOverlay: document.getElementById("pauseOverlay"),
  overOverlay: document.getElementById("overOverlay"),
  overScore: document.getElementById("overScore"),
  overHi: document.getElementById("overHi"),
  overNew: document.getElementById("overNew"),
  btnPause: document.getElementById("btnPause"),
  btnRestart: document.getElementById("btnRestart"),
  btnRestartOver: document.getElementById("btnRestartOver"),
  quality: document.getElementById("quality"),
  chkShadows: document.getElementById("chkShadows"),
  chkDust: document.getElementById("chkDust"),
  chkClouds: document.getElementById("chkClouds")
};

function doJump() {
  if (state.gameOver) { restart(); return; }
  if (state.benchActive) return;
  if (!state.airborne) {
    state.airborne = true;
    state.vy = JUMP_V;
    state.ducking = false;
  }
}

function gameOver() {
  state.gameOver = true;
  state.airborne = false;
  state.vy = 0;
  state.y = 0;
  const s = Math.floor(state.score);
  const isRecord = s > state.hi;
  if (isRecord) { state.hi = s; saveHi(state.hi); }
  ui.overScore.textContent = String(s);
  ui.overHi.textContent = String(state.hi);
  ui.overNew.hidden = !isRecord;
  ui.overOverlay.hidden = false;
}

function restart() {
  clearObstacles();
  state.gameOver = false;
  state.paused = false;
  state.airborne = false;
  state.ducking = false;
  state.vy = 0;
  state.y = 0;
  state.speed = SPEED_START;
  state.elapsed = 0;
  state.score = 0;
  rex.group.scale.y = 1;
  rex.group.position.y = 0;
  ui.overOverlay.hidden = true;
  ui.pauseOverlay.hidden = true;
  ui.btnPause.textContent = "Пауза";
  spawnObstacle();
}

function togglePause() {
  if (state.gameOver) return;
  state.paused = !state.paused;
  ui.pauseOverlay.hidden = !state.paused;
  ui.btnPause.textContent = state.paused ? "Продолжить" : "Пауза";
}

function updateGame(dt) {
  state.elapsed += dt;
  state.speed = Math.min(SPEED_MAX, SPEED_START + state.elapsed * SPEED_RAMP);
  state.score += state.speed * dt * 0.55;

  if (state.airborne) {
    state.vy -= GRAVITY * dt;
    state.y += state.vy * dt;
    if (state.y <= 0) {
      state.y = 0;
      state.vy = 0;
      state.airborne = false;
      spawnDust(REX_X + 0.15, 0, 1);
    }
  }
  rex.group.position.y = state.y;

  const targetScale = (state.ducking && !state.airborne) ? DUCK_SCALE : 1;
  rex.group.scale.y = lerp(rex.group.scale.y, targetScale, 1 - Math.exp(-dt * 16));

  const runT = state.elapsed * (6 + state.speed * 0.35);
  if (!state.airborne) {
    rex.legs[0].rotation.x = Math.sin(runT) * 0.7;
    rex.legs[1].rotation.x = -Math.sin(runT) * 0.7;
  } else {
    rex.legs[0].rotation.x = lerp(rex.legs[0].rotation.x, -0.9, 0.25);
    rex.legs[1].rotation.x = lerp(rex.legs[1].rotation.x, -0.45, 0.25);
  }
  rex.tail.rotation.y = Math.sin(runT * 0.5) * 0.14;
  rex.tail2.rotation.y = Math.sin(runT * 0.5 + 0.6) * 0.18;

  const k = clamp(1 - state.y / 3.4, 0.25, 1);
  rexShadow.position.x = REX_X;
  rexShadow.scale.setScalar(lerp(0.55, 1, k));
  MAT.shadow.opacity = 0.42 * k;

  if (!state.benchActive) {
    const rx0 = REX_X - 0.6;
    const rx1 = REX_X + 1.35;
    const ry0 = state.y;
    const ry1 = state.y + REX_TOP * rex.group.scale.y;
    for (const o of obstacles) {
      const ox0 = o.x - o.w / 2;
      const ox1 = o.x + o.w / 2;
      if (rx1 > ox0 && rx0 < ox1 && ry1 > o.y0 && ry0 < o.y1) { gameOver(); break; }
    }
  }
}

/* ---------------------------------------------------------------- */
/* Ввод                                                             */
/* ---------------------------------------------------------------- */
const keys = new Set();
function syncDuck() { state.ducking = keys.has("ArrowDown") || keys.has("KeyS"); }

window.addEventListener("keydown", (e) => {
  const c = e.code;
  if (c === "Space" || c === "ArrowUp" || c === "ArrowDown") e.preventDefault();
  if (keys.has(c)) return;
  keys.add(c);
  if (c === "Space" || c === "ArrowUp" || c === "KeyW") doJump();
  else if (c === "KeyP") togglePause();
  else if (c === "KeyR") restart();
  syncDuck();
});
window.addEventListener("keyup", (e) => { keys.delete(e.code); syncDuck(); });
window.addEventListener("blur", () => { keys.clear(); syncDuck(); });

ui.btnPause.addEventListener("click", togglePause);
ui.btnRestart.addEventListener("click", restart);
ui.btnRestartOver.addEventListener("click", restart);

canvas.addEventListener("pointerdown", () => { doJump(); });
ui.btnPause.blur();

/* ---------------------------------------------------------------- */
/* Качество                                                         */
/* ---------------------------------------------------------------- */
function applyQuality(name, updateSelect) {
  const q = QUALITY[name] || QUALITY.medium;
  state.quality = QUALITY[name] ? name : "medium";
  state.shadows = q.shadows;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  sun.castShadow = q.shadows;
  sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  if (updateSelect && ui.quality) ui.quality.value = state.quality;
  if (ui.chkShadows) ui.chkShadows.checked = q.shadows;
  resize();
}

ui.quality.addEventListener("change", () => applyQuality(ui.quality.value, false));
ui.chkShadows.addEventListener("change", () => { state.shadows = ui.chkShadows.checked; sun.castShadow = state.shadows; });
ui.chkDust.addEventListener("change", () => { state.dust = ui.chkDust.checked; });
ui.chkClouds.addEventListener("change", () => { state.clouds = ui.chkClouds.checked; });

/* ---------------------------------------------------------------- */
/* HUD, спарклайн, инфо WebGL                                       */
/* ---------------------------------------------------------------- */
const spark = document.getElementById("spark");
const sctx = spark.getContext("2d");
const frameTimes = new Array(120).fill(0);
let frameIdx = 0;
let frameMsSmooth = 16.7;
let fpsEma = 60;
let hudTimer = 1;

function drawSpark() {
  const w = spark.width;
  const h = spark.height;
  sctx.clearRect(0, 0, w, h);
  sctx.fillStyle = "#070707";
  sctx.fillRect(0, 0, w, h);
  let maxV = 8;
  for (const v of frameTimes) if (v > maxV) maxV = v;
  sctx.strokeStyle = "#2b2b2b";
  sctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const y = Math.round((h / 4) * i) + 0.5;
    sctx.beginPath(); sctx.moveTo(0, y); sctx.lineTo(w, y); sctx.stroke();
  }
  sctx.strokeStyle = "#ffffff";
  sctx.lineWidth = 1.6;
  sctx.beginPath();
  const step = w / (frameTimes.length - 1);
  for (let i = 0; i < frameTimes.length; i++) {
    const idx = (frameIdx + i) % frameTimes.length;
    const val = clamp(frameTimes[idx], 0, maxV);
    const x = i * step;
    const y = h - (val / maxV) * (h - 6) - 3;
    if (i === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
  }
  sctx.stroke();
  return maxV;
}

function initGlInfo() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  try {
    const isWebGL2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    set("glVersion", isWebGL2 ? "WebGL2" : "WebGL1");
  } catch (e) { set("glVersion", "WebGL"); }
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  set("glGpu", dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)));
  set("glTex", String(gl.getParameter(gl.MAX_TEXTURE_SIZE)));
  set("glSamples", String(gl.getParameter(gl.SAMPLES)));
  const chips = document.getElementById("glExts");
  if (chips) {
    chips.textContent = "";
    const wanted = [
      "EXT_color_buffer_float", "OES_texture_float_linear", "EXT_texture_filter_anisotropic",
      "WEBGL_compressed_texture_s3tc", "WEBGL_debug_renderer_info", "OES_standard_derivatives",
      "EXT_shader_texture_lod", "WEBGL_depth_texture"
    ];
    for (const name of wanted) {
      const have = !!gl.getExtension(name);
      const s = document.createElement("span");
      s.textContent = name;
      if (!have) s.className = "off";
      chips.appendChild(s);
    }
  }
}

function updateHud(dt, frameMs) {
  const info = renderer.info.render;
  if (ui.stCalls) ui.stCalls.textContent = String(info.calls);
  if (ui.stTris) ui.stTris.textContent = String(info.triangles);

  hudTimer += dt;
  if (hudTimer < 0.2) return;
  hudTimer = 0;

  const fps = 1000 / Math.max(frameMsSmooth, 0.0001);
  const score = Math.floor(state.score);
  if (ui.stFps) ui.stFps.textContent = fps.toFixed(1);
  if (ui.stFrame) ui.stFrame.textContent = frameMsSmooth.toFixed(2);
  if (ui.fpsHud) ui.fpsHud.textContent = fps.toFixed(0) + " FPS";
  if (ui.hudScore) ui.hudScore.textContent = pad5(score);
  if (ui.hudHi) ui.hudHi.textContent = "HI " + pad5(Math.max(state.hi, score));
  if (ui.hudSpeed) ui.hudSpeed.textContent = "×" + (state.speed / SPEED_START).toFixed(2);
  if (ui.stScore) ui.stScore.textContent = String(score);
  if (ui.stHi) ui.stHi.textContent = String(state.hi);
  if (ui.stSpeed) ui.stSpeed.textContent = "×" + (state.speed / SPEED_START).toFixed(2);
  if (ui.stTime) ui.stTime.textContent = state.elapsed.toFixed(0) + " с";
  if (ui.obsCount) ui.obsCount.textContent = String(obstacles.length);
  const maxV = drawSpark();
  const scale = document.getElementById("sparkScale");
  if (scale) scale.textContent = "макс " + maxV.toFixed(1) + " мс";
  document.documentElement.setAttribute("data-fps", fps.toFixed(1));
}

/* ---------------------------------------------------------------- */
/* Быстрая проверка сцены                                           */
/* ---------------------------------------------------------------- */
function monochromeViolations() {
  const seen = new Set();
  const bad = [];
  scene.traverse((o) => {
    if (!o.isMesh && !o.isLine && !o.isPoints) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !m.color || seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      const c = m.color;
      if (Math.abs(c.r - c.g) > 1e-6 || Math.abs(c.g - c.b) > 1e-6) bad.push("#" + c.getHexString());
    }
  });
  return bad;
}

function runSelfTests() {
  const list = document.getElementById("testList");
  const results = [];
  const add = (ok, label) => results.push({ ok, label });
  try {
    const isWebGL2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    add(true, "WebGL-контекст создан: " + (isWebGL2 ? "WebGL2" : "WebGL1"));
    const lost = gl.isContextLost ? gl.isContextLost() : false;
    add(!lost, "Контекст не потерян: " + (lost ? "потерян" : "ок"));
    add(renderer.info.render.calls > 0, "Рендер идёт: draw calls = " + renderer.info.render.calls);
    add(renderer.info.render.triangles > 0, "Геометрия рисуется: треугольников = " + renderer.info.render.triangles);
    const mono = monochromeViolations();
    add(mono.length === 0, mono.length === 0 ? "Палитра монохромна: все каналы R=G=B" : "Найдены цветные материалы: " + mono.join(", "));
    let storageOk = false;
    try { window.localStorage.setItem("dino3d.probe", "1"); window.localStorage.removeItem("dino3d.probe"); storageOk = true; } catch (e) { storageOk = false; }
    add(storageOk, "localStorage доступен: " + (storageOk ? "да" : "нет (рекорд не сохранится)"));
    add(document.querySelectorAll("canvas").length > 0, "Канвас на странице найден");
    add(fpsEma > 0, "Счётчик кадров активен: " + fpsEma.toFixed(1) + " FPS");
    add(obstacles.length > 0, "Препятствия генерируются: " + obstacles.length + " в сцене");
    let meshes = 0;
    scene.traverse((o) => { if (o.isMesh) meshes++; });
    add(meshes > 20, "Мешей в сцене: " + meshes);
  } catch (e) {
    add(false, "Исключение при проверке: " + String(e && e.message ? e.message : e));
  }
  if (list) {
    list.textContent = "";
    for (const r of results) {
      const li = document.createElement("li");
      li.className = r.ok ? "ok" : "fail";
      li.textContent = r.label;
      list.appendChild(li);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  document.documentElement.setAttribute("data-tests", String(results.length - failed) + "/" + String(results.length));
  console.log("[dino3d] самопроверка: " + String(results.length - failed) + " из " + String(results.length) + " пройдено");
  return results;
}
document.getElementById("btnSelfTest").addEventListener("click", runSelfTests);

/* ---------------------------------------------------------------- */
/* Бенчмарк                                                         */
/* ---------------------------------------------------------------- */
const bench = {
  active: false, idx: 0, seconds: 6, order: ["low", "medium", "high"],
  t: 0, count: 0, sumMs: 0, minMs: Infinity, maxMs: 0, results: [], restore: "medium"
};
const btnBench = document.getElementById("btnBench");
const benchProgress = document.getElementById("benchProgress");
const benchStatus = document.getElementById("benchStatus");
const benchTbody = document.querySelector("#benchTable tbody");

function benchNext() {
  bench.idx++;
  if (bench.idx >= bench.order.length) { benchFinish(); return; }
  const q = bench.order[bench.idx];
  applyQuality(q, true);
  state.benchActive = true;
  bench.t = 0; bench.count = 0; bench.sumMs = 0; bench.minMs = Infinity; bench.maxMs = 0;
  benchStatus.textContent = "Идёт замер: " + QUALITY[q].label + " — " + bench.seconds + " с...";
}

function startBench() {
  if (bench.active) return;
  const secs = parseFloat(document.getElementById("benchSeconds").value);
  bench.seconds = clamp(isFinite(secs) ? secs : 6, 1, 60);
  bench.active = true;
  bench.idx = -1;
  bench.results = [];
  bench.restore = state.quality;
  btnBench.disabled = true;
  restart();
  state.benchActive = true;
  benchNext();
}

function benchStep(rawMs) {
  bench.t += rawMs / 1000;
  bench.count++;
  bench.sumMs += rawMs;
  if (rawMs < bench.minMs) bench.minMs = rawMs;
  if (rawMs > bench.maxMs) bench.maxMs = rawMs;
  const p = clamp((bench.idx + clamp(bench.t / bench.seconds, 0, 1)) / bench.order.length, 0, 1);
  benchProgress.style.width = (p * 100).toFixed(1) + "%";
  if (bench.t >= bench.seconds) {
    bench.results.push({
      q: bench.order[bench.idx],
      label: QUALITY[bench.order[bench.idx]].label,
      avgFps: bench.count / bench.t,
      minFps: 1000 / Math.max(bench.maxMs, 0.01),
      maxFps: 1000 / Math.max(bench.minMs, 0.01),
      avgMs: bench.sumMs / Math.max(1, bench.count)
    });
    benchNext();
  }
}

function benchFinish() {
  bench.active = false;
  state.benchActive = false;
  applyQuality(bench.restore, true);
  btnBench.disabled = false;
  benchProgress.style.width = "100%";
  benchStatus.textContent = "Готово: по " + bench.seconds + " с на каждый уровень качества.";
  renderBenchTable();
  renderBenchChart();
  document.documentElement.setAttribute("data-bench", String(bench.results.length));
}

function renderBenchTable() {
  benchTbody.textContent = "";
  if (!bench.results.length) {
    const tr = document.createElement("tr");
    tr.className = "empty";
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "Нет данных";
    tr.appendChild(td);
    benchTbody.appendChild(tr);
    return;
  }
  for (const r of bench.results) {
    const tr = document.createElement("tr");
    for (const v of [r.label, r.avgFps.toFixed(1), r.minFps.toFixed(1), r.maxFps.toFixed(1), r.avgMs.toFixed(2)]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    }
    benchTbody.appendChild(tr);
  }
}

function renderBenchChart() {
  const grid = document.getElementById("chartGrid");
  const bars = document.getElementById("chartBars");
  const note = document.getElementById("chartNote");
  grid.textContent = "";
  bars.textContent = "";
  if (!bench.results.length) { note.textContent = "данных пока нет"; return; }
  note.textContent = "";
  const W = 340, H = 170, base = 128, top = 20;
  let maxFps = 1;
  for (const r of bench.results) if (r.avgFps > maxFps) maxFps = r.avgFps;
  const NS = "http://www.w3.org/2000/svg";
  for (let i = 0; i <= 4; i++) {
    const y = base - ((base - top) / 4) * i;
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", "30"); line.setAttribute("x2", "326");
    line.setAttribute("y1", String(y)); line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "#2b2b2b");
    grid.appendChild(line);
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", "26"); t.setAttribute("y", String(y + 3));
    t.setAttribute("text-anchor", "end");
    t.setAttribute("class", "chartlabel");
    t.textContent = String(Math.round((maxFps / 4) * i));
    grid.appendChild(t);
  }
  const n = bench.results.length;
  const slot = 296 / n;
  const bw = Math.min(56, slot * 0.6);
  for (let i = 0; i < n; i++) {
    const r = bench.results[i];
    const h = ((base - top) * (r.avgFps / maxFps));
    const x = 30 + slot * i + (slot - bw) / 2;
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", x.toFixed(1));
    rect.setAttribute("y", (base - h).toFixed(1));
    rect.setAttribute("width", bw.toFixed(1));
    rect.setAttribute("height", Math.max(1, h).toFixed(1));
    const shade = i === 0 ? "#8a8a8a" : (i === 1 ? "#c9c9c9" : "#ffffff");
    rect.setAttribute("fill", shade);
    bars.appendChild(rect);
    const val = document.createElementNS(NS, "text");
    val.setAttribute("x", (x + bw / 2).toFixed(1));
    val.setAttribute("y", (base - h - 6).toFixed(1));
    val.setAttribute("text-anchor", "middle");
    val.setAttribute("class", "chartval");
    val.textContent = r.avgFps.toFixed(0);
    bars.appendChild(val);
    const lab = document.createElementNS(NS, "text");
    lab.setAttribute("x", (x + bw / 2).toFixed(1));
    lab.setAttribute("y", String(base + 16));
    lab.setAttribute("text-anchor", "middle");
    lab.setAttribute("class", "chartlabel");
    lab.textContent = r.label;
    bars.appendChild(lab);
  }
}

btnBench.addEventListener("click", startBench);

/* ---------------------------------------------------------------- */
/* Размер и главный цикл                                            */
/* ---------------------------------------------------------------- */
function resize() {
  const w = ui.stage.clientWidth;
  const h = ui.stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

let last = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const raw = Math.max(0.1, now - last);
  last = now;
  const dt = clamp(raw / 1000, 0, 0.05);
  const frameMs = clamp(raw, 0.1, 250);

  frameTimes[frameIdx % frameTimes.length] = frameMs;
  frameIdx++;
  frameMsSmooth = frameMsSmooth * 0.9 + frameMs * 0.1;
  fpsEma = fpsEma * 0.9 + (1000 / Math.max(frameMs, 0.01)) * 0.1;

  if (!state.paused) {
    if (!state.gameOver) updateGame(dt);
    updateObstacles(dt);
    updateClouds(dt);
    updatePebbles(dt);
    updateDust(dt);
  }

  renderer.info.reset();
  renderer.render(scene, camera);
  state.frames++;
  if (state.frames === 1) document.documentElement.setAttribute("data-webgl", "1");
  document.documentElement.setAttribute("data-frames", String(state.frames));

  updateHud(dt, frameMs);
  if (bench.active) benchStep(raw);
}

/* ---------------------------------------------------------------- */
/* Старт                                                            */
/* ---------------------------------------------------------------- */
applyQuality("medium", true);
resize();
window.addEventListener("resize", resize);
/* Тестовый хук: ?ff=25 проматывает симуляцию вперёд для снимков и замеров. */
function fastForward(seconds) {
  const step = 1 / 60;
  const n = Math.floor(seconds / step);
  const savedBench = state.benchActive;
  state.benchActive = true;
  for (let i = 0; i < n; i++) {
    updateGame(step);
    updateObstacles(step);
    updateClouds(step);
    updatePebbles(step);
    updateDust(step);
  }
  state.benchActive = savedBench;
  last = performance.now();
}

initGlInfo();
const params = URL_PARAMS;
const ff = parseFloat(params.get("ff") || "0");
/* ?demo=1 — режим показа: столкновения отключены, сцена просто бежит. */
const demo = params.get("demo") === "1";
spawnObstacle();
if (isFinite(ff) && ff > 0) fastForward(Math.min(ff, 180));
if (demo) { state.benchActive = true; restart(); state.benchActive = true; if (isFinite(ff) && ff > 0) fastForward(Math.min(ff, 180)); }
setTimeout(() => { try { runSelfTests(); } catch (e) { reportError("Самопроверка", String(e && e.message ? e.message : e)); } }, 2500);
const buildInfo = document.getElementById("buildInfo");
if (buildInfo) buildInfo.textContent = "Сборка: три.js " + THREE.REVISION + " · монохром";
document.documentElement.setAttribute("data-three", String(THREE.REVISION));
requestAnimationFrame(animate);
