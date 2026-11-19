/**
 * PAPERCRASH — world/environment.js
 * ============================================================
 * Construcción del escenario: cielo, estrellas, terreno low-poly,
 * cordillera de fondo y plataforma de lanzamiento.
 *
 * La geometría del terreno se desplaza con `terrainHeightAt`, la MISMA
 * función que usan la física y la vista previa. Así el suelo que se ve
 * es el suelo que se pisa.
 *
 * Todo lo que se agrega a la escena se registra en `disposables` para
 * poder liberar GPU en un `dispose()`. Sin esto, cada reinicio del
 * navegador o recarga en caliente acumula geometrías huérfanas.
 * ============================================================
 */
import { scene, sunLight, rimLight } from '../core/engine.js';
import { WORLD, STAGES } from '../config.js';
import { createRng } from '../core/math.js';
import { terrainHeightAt } from './terrainField.js';
import { initTerrainMesh, updateTerrainWindow, getTerrainMaterial } from './terrainMesh.js';

/** @type {Array<{geometry?:object, material?:object}>} */
const disposables = [];

function track(obj) {
  disposables.push(obj);
  return obj;
}

/** Añade a la escena y registra para liberar. */
function addTracked(mesh) {
  scene.add(mesh);
  track(mesh);
  return mesh;
}

// ── Cielo: cúpula con gradiente vertical por vértice ────────
function buildSky() {
  const radius = 1400;
  const geo = new THREE.SphereGeometry(radius, 12, 10);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const bottom = new THREE.Color(0x0a0e1a);
  const mid = new THREE.Color(0x141033);
  const top = new THREE.Color(0x1a0a3a);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, (pos.getY(i) + radius) / (radius * 2)));
    if (t < 0.5) c.copy(bottom).lerp(mid, t * 2);
    else c.copy(mid).lerp(top, (t - 0.5) * 2);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -100;
  return addTracked(mesh);
}

// ── Estrellas ───────────────────────────────────────────────
function buildStars() {
  const rng = createRng(90210);
  const count = 1400;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const theta = rng.range(0, Math.PI * 2);
    const phi = Math.acos(rng.range(-1, 1));
    const r = rng.range(1150, 1300);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.8,
    sizeAttenuation: false,
    fog: false,
    transparent: true,
    opacity: 0.85,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = -99;
  return addTracked(points);
}

// ── Terreno low-poly ────────────────────────────────────────
/*
 * ── El terreno vive en su propio módulo ──
 *
 * Antes se construía acá, una sola vez, desde la rampa hasta el final del
 * corredor. Cuando el corredor pasó a ser indefinido esa malla dejaba de cubrir
 * el suelo: pasado su final el avión volaba sobre el vacío y la pantalla se veía
 * negra.
 *
 * Ahora la malla se reescribe desplazándose con el avión. Ver
 * `world/terrainMesh.js`: misma geometría siempre, sólo cambian las coordenadas,
 * así que no hay asignaciones ni basura.
 */

// ── Escenografía infinita (límites de pista, montañas y costados temáticos) ─
const BORDER_STEP = 32;
const BORDER_SLOTS = 36; // cubre ~1150 m en ambos lados sin fin
const BORDER_REFRESH_STEP = 128; // reescribe matrices 4x menos seguido sin notarse en pantalla
const SCENERY_STEP = 40;
const SCENERY_SLOTS = 42;
const SCENERY_REFRESH_STEP = 160;
const MOUNTAIN_SPAN = 2600;

const dummy = new THREE.Object3D();
let lastBorderAnchor = Infinity;
let lastSceneryAnchor = Infinity;
let sceneryState = null;

function buildSceneryPool() {
  const rng = createRng(4242);
  const group = new THREE.Group();
  group.name = 'mountains';

  // 1) Límites de pista visibles en ambos bordes (z = ±COURSE_HALF_WIDTH)
  const stripGeo = new THREE.BoxGeometry(18, 0.36, 1.35);
  const stripMat = new THREE.MeshBasicMaterial({
    color: 0xff5252,
    transparent: true,
    opacity: 0.78,
  });
  const borderStrips = new THREE.InstancedMesh(stripGeo, stripMat, BORDER_SLOTS * 2);
  borderStrips.frustumCulled = false;

  const postGeo = new THREE.CylinderGeometry(0.24, 0.44, 5.4, 6);
  postGeo.translate(0, 2.7, 0);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x263248, flatShading: true });
  const borderPosts = new THREE.InstancedMesh(postGeo, postMat, BORDER_SLOTS * 2);
  borderPosts.frustumCulled = false;

  const capGeo = new THREE.OctahedronGeometry(0.58, 0);
  const capMat = new THREE.MeshBasicMaterial({ color: 0xff6d00 });
  const borderCaps = new THREE.InstancedMesh(capGeo, capMat, BORDER_SLOTS * 2);
  borderCaps.frustumCulled = false;

  group.add(borderStrips, borderPosts, borderCaps);

  // 2) Cordillera lateral envolvente en doble fila (oculta cualquier horizonte liso)
  const mtnDefs = [];
  const rowCfg = [
    { zBase: -115, count: 22, hMin: 28, hMax: 60 },
    { zBase: 115, count: 22, hMin: 26, hMax: 58 },
    { zBase: -188, count: 18, hMin: 48, hMax: 92 },
    { zBase: 188, count: 18, hMin: 46, hMax: 88 },
  ];
  const mtnGeo = new THREE.ConeGeometry(1, 1, 6);
  const mtnMat = new THREE.MeshLambertMaterial({ color: 0x232d42, flatShading: true });
  const totalMtns = rowCfg.reduce((s, r) => s + r.count, 0);
  const mountainsMesh = new THREE.InstancedMesh(mtnGeo, mtnMat, totalMtns);
  mountainsMesh.frustumCulled = false;
  for (const row of rowCfg) {
    for (let i = 0; i < row.count; i++) {
      const h = rng.range(row.hMin, row.hMax);
      mtnDefs.push({
        baseX: (i / row.count) * MOUNTAIN_SPAN - MOUNTAIN_SPAN * 0.25 + rng.range(-25, 25),
        z: row.zBase + rng.range(-18, 18),
        r: h * rng.range(0.68, 1.05),
        h,
        rotY: rng.range(0, Math.PI * 2),
      });
    }
  }
  group.add(mountainsMesh);

  // 3) Vegetación / formaciones temáticas a ambos costados (|z| ∈ [76, 150])
  const floraGeo = new THREE.ConeGeometry(2.6, 11, 5);
  floraGeo.translate(0, 5.5, 0);
  const floraMat = new THREE.MeshLambertMaterial({ color: 0x2f5e34, flatShading: true });
  const floraMesh = new THREE.InstancedMesh(floraGeo, floraMat, SCENERY_SLOTS * 2);
  floraMesh.frustumCulled = false;

  const rockGeo = new THREE.DodecahedronGeometry(3.2, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x4a4038, flatShading: true });
  const rocksMesh = new THREE.InstancedMesh(rockGeo, rockMat, SCENERY_SLOTS * 2);
  rocksMesh.frustumCulled = false;

  const sideSeeds = [];
  for (let i = 0; i < SCENERY_SLOTS; i++) {
    sideSeeds.push({
      zLeft: -(76 + ((i * 37) % 68)),
      zRight: 76 + ((i * 53 + 19) % 68),
      scaleA: 0.7 + ((i * 29) % 10) * 0.08,
      scaleB: 0.65 + ((i * 41) % 10) * 0.09,
      rockZLeft: -(82 + ((i * 61 + 11) % 80)),
      rockZRight: 82 + ((i * 47 + 23) % 80),
      rot: (i * 1.37) % (Math.PI * 2),
    });
  }
  group.add(floraMesh, rocksMesh);

  scene.add(group);
  disposables.push(group);
  sceneryState = {
    group,
    borderStrips,
    borderPosts,
    borderCaps,
    mountainsMesh,
    mtnDefs,
    floraMesh,
    rocksMesh,
    sideSeeds,
    stripMat,
    capMat,
    mtnMat,
    floraMat,
    rockMat,
  };
  lastBorderAnchor = Infinity;
  lastSceneryAnchor = Infinity;
  updateEnvironmentScenery(0, true);
  return group;
}

/**
 * Reposiciona los límites de pista y la escenografía lateral alrededor del avión.
 * @param {number} x
 * @param {boolean} [force=false]
 */
export function updateEnvironmentScenery(x, force = false) {
  if (!sceneryState) return;
  const s = sceneryState;
  const borderAnchor = Math.floor(x / BORDER_REFRESH_STEP) * BORDER_REFRESH_STEP;
  if (force || borderAnchor !== lastBorderAnchor) {
    lastBorderAnchor = borderAnchor;
    const hw = WORLD.COURSE_HALF_WIDTH;
    const startX = borderAnchor - 280;
    let idx = 0;
    for (let i = 0; i < BORDER_SLOTS; i++) {
      const bx = startX + i * BORDER_STEP;
      for (const side of [-1, 1]) {
        const bz = side * hw;
        const by = terrainHeightAt(bx, bz);
        const byNext = terrainHeightAt(bx + 12, bz);
        const slope = Math.atan2(byNext - by, 12);

        dummy.position.set(bx, by + 0.16, bz);
        dummy.rotation.set(0, 0, slope);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        s.borderStrips.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(bx, by, bz + side * 0.9);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        s.borderPosts.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(bx, by + 5.75, bz + side * 0.9);
        dummy.rotation.set(0, bx * 0.05, 0);
        dummy.updateMatrix();
        s.borderCaps.setMatrixAt(idx, dummy.matrix);
        idx++;
      }
    }
    s.borderStrips.instanceMatrix.needsUpdate = true;
    s.borderPosts.instanceMatrix.needsUpdate = true;
    s.borderCaps.instanceMatrix.needsUpdate = true;
  }

  const sceneryAnchor = Math.floor(x / SCENERY_REFRESH_STEP) * SCENERY_REFRESH_STEP;
  if (force || sceneryAnchor !== lastSceneryAnchor) {
    lastSceneryAnchor = sceneryAnchor;
    const minMtnX = x - MOUNTAIN_SPAN * 0.35;
    for (let i = 0; i < s.mtnDefs.length; i++) {
      const d = s.mtnDefs[i];
      const offset = (((d.baseX - minMtnX) % MOUNTAIN_SPAN) + MOUNTAIN_SPAN) % MOUNTAIN_SPAN;
      const mx = minMtnX + offset;
      dummy.position.set(mx, d.h * 0.5 - 4, d.z);
      dummy.rotation.set(0, d.rotY, 0);
      dummy.scale.set(d.r, d.h, d.r);
      dummy.updateMatrix();
      s.mountainsMesh.setMatrixAt(i, dummy.matrix);
    }
    s.mountainsMesh.instanceMatrix.needsUpdate = true;

    const startSX = sceneryAnchor - 320;
    let sIdx = 0;
    for (let i = 0; i < SCENERY_SLOTS; i++) {
      const sx = startSX + i * SCENERY_STEP;
      const worldSlot = Math.round(sx / SCENERY_STEP);
      const sd = s.sideSeeds[((worldSlot % SCENERY_SLOTS) + SCENERY_SLOTS) % SCENERY_SLOTS];
      for (const isLeft of [true, false]) {
        const z = isLeft ? sd.zLeft : sd.zRight;
        const sc = isLeft ? sd.scaleA : sd.scaleB;
        const sy = terrainHeightAt(sx, z);
        dummy.position.set(sx, sy - 0.3, z);
        dummy.rotation.set(0, sd.rot + (isLeft ? 0 : 1.1), 0);
        dummy.scale.set(sc, sc * 1.15, sc);
        dummy.updateMatrix();
        s.floraMesh.setMatrixAt(sIdx, dummy.matrix);

        const rz = isLeft ? sd.rockZLeft : sd.rockZRight;
        const ry = terrainHeightAt(sx + 14, rz);
        dummy.position.set(sx + 14, ry + sc * 0.5, rz);
        dummy.rotation.set(sd.rot * 0.4, sd.rot, 0);
        dummy.scale.set(sc * 1.35, sc * 0.9, sc * 1.2);
        dummy.updateMatrix();
        s.rocksMesh.setMatrixAt(sIdx, dummy.matrix);
        sIdx++;
      }
    }
    s.floraMesh.instanceMatrix.needsUpdate = true;
    s.rocksMesh.instanceMatrix.needsUpdate = true;
  }
}

// ── Tramos: cambio de escenario ─────────────────────────────
/**
 * Paleta vigente, para no reescribir la escena en cada frame: el cambio de tramo
 * ocurre una vez cada 500 m, no de forma continua.
 */
let activePalette = -1;

/** Colores destino de la transición. */
const skyTarget = new THREE.Color();
const fogTarget = new THREE.Color();
const accentTarget = new THREE.Color();
const groundTarget = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

/**
 * Aplica la paleta de un tramo, con transición suave.
 *
 * La transición importa: el cambio se dispara cuando el avión cruza la frontera,
 * así que un salto brusco de color en ese momento se vería como un parpadeo. Se
 * interpola en el TIEMPO y no por posición porque el avión puede estar quieto (o
 * volviendo) justo en la junta.
 *
 * Sólo se interpolan colores: cambiar geometría a mitad de vuelo sería
 * desorientador y carísimo.
 *
 * @param {number} index  índice de tramo (0-based)
 * @param {number} dt     segundos desde el frame anterior
 */
export function setStagePalette(index, dt = 0) {
  const palettes = STAGES.PALETTES;
  if (!palettes.length) return;

  const wrapped = ((index % palettes.length) + palettes.length) % palettes.length;
  const palette = palettes[wrapped];

  skyTarget.setHex(palette.sky);
  fogTarget.setHex(palette.fog);

  // Amortiguación exponencial: independiente de los FPS. Con dt 0 salta directo,
  // que es lo que se quiere al reiniciar.
  const k = dt > 0 ? 1 - Math.exp(-1.6 * dt) : 1;

  if (scene.background?.isColor) scene.background.lerp(skyTarget, k);
  else scene.background = skyTarget.clone();

  if (scene.fog) scene.fog.color.lerp(fogTarget, k);

  /*
   * ── El suelo también cambia con el bioma ──
   *
   * ── Por qué hacía falta ──
   * El color del terreno se fijaba al construirlo, con el de la primera paleta, y
   * nunca se volvía a tocar. El cielo y la niebla sí cambiaban, así que en los
   * biomas oscuros el suelo quedaba a un paso del color del fondo y se leía como
   * "no hay piso".
   *
   * Se aclara un 35% respecto del color de la paleta: los colores de suelo están
   * pensados como tono base, y con la iluminación de la escena quedan oscuros.
   */
  const mat = getTerrainMaterial();
  if (mat) {
    groundTarget.setHex(palette.ground);
    // Aclarado: se interpola hacia blanco, que sube el valor sin cambiar el tinte.
    groundTarget.lerp(WHITE, 0.35);
    mat.color.lerp(groundTarget, k);
  }

  if (wrapped !== activePalette) {
    activePalette = wrapped;
    // El acento tiñe las luces y la escenografía lateral: da identidad al tramo.
    accentTarget.setHex(palette.accent);
    sunLight?.color.lerp(accentTarget, 0.3);
    rimLight?.color.lerp(accentTarget, 0.45);
    if (sceneryState) {
      sceneryState.capMat.color.setHex(palette.accent);
      sceneryState.rockMat.color.setHex(palette.rock);
      sceneryState.floraMat.color.setHex(palette.ground).lerp(accentTarget, 0.28);
      sceneryState.mtnMat.color.setHex(palette.rock).lerp(skyTarget, 0.45);
    }
  }
}

/** Nombre del tramo, para el HUD. */
export function stageName(index) {
  const palettes = STAGES.PALETTES;
  if (!palettes.length) return '';
  const wrapped = ((index % palettes.length) + palettes.length) % palettes.length;
  return palettes[wrapped].name;
}

/** Paleta completa de un tramo. */
export function stagePalette(index) {
  const palettes = STAGES.PALETTES;
  if (!palettes.length) return null;
  const wrapped = ((index % palettes.length) + palettes.length) % palettes.length;
  return palettes[wrapped];
}

// ── API pública ─────────────────────────────────────────────
let built = false;

/**
 * Construye el escenario completo. Idempotente: llamarlo dos veces no
 * duplica geometría (protege contra el doble arranque del boot).
 *
 * La plataforma de la resortera vive en world/launchpad.js porque
 * pertenece al conjunto de la resortera, no al paisaje.
 */
export function initEnvironment() {
  if (built) return;
  built = true;
  buildSky();
  buildStars();
  initTerrainMesh();
  updateTerrainWindow(0, true);
  buildSceneryPool();
  /*
   * ── La paleta se aplica desde el arranque ──
   *
   * `setStagePalette` sólo se llamaba al CAMBIAR de tramo durante el vuelo, así
   * que en el primer arranque el lobby se quedaba con el color crudo del material
   * (#2f4a2a) en vez del clareado (#778974): se veía más oscuro que después de
   * jugar una run, y con la paleta oscura el suelo se confundía con el fondo.
   */
  setStagePalette(0, 0);
}

/** Libera los recursos de GPU del escenario. */
export function disposeEnvironment() {
  for (const item of disposables) {
    item.traverse?.((child) => {
      child.geometry?.dispose?.();
      const m = child.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.());
      else m?.dispose?.();
    });
    item.geometry?.dispose?.();
    item.material?.dispose?.();
    scene.remove(item);
  }
  disposeTerrainMesh();
  disposables.length = 0;
  sceneryState = null;
  lastBorderAnchor = Infinity;
  lastSceneryAnchor = Infinity;
  built = false;
  activePalette = -1;
}
