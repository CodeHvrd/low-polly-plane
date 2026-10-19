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

// ── Cordillera de fondo ─────────────────────────────────────
function buildMountains() {
  const rng = createRng(4242);
  const group = new THREE.Group();
  group.name = 'mountains';

  const shades = [0x1a2030, 0x1e2535, 0x18202e, 0x1c2538, 0x212a40];

  // Las franjas cubren también el tramo detrás del lanzador: la vista de
  // lanzamiento mira hacia adelante, pero la de apuntado puede verse desde
  // cualquier lado y no debe quedar sin fondo.
  const from = -WORLD.BEHIND_LENGTH * 0.55;
  const to = WORLD.COURSE_LENGTH + 80;

  const rows = [
    { z: -78, count: 17, hMin: 26, hMax: 58 },
    { z: 78, count: 17, hMin: 24, hMax: 54 },
  ];

  for (const row of rows) {
    for (let i = 0; i < row.count; i++) {
      const h = rng.range(row.hMin, row.hMax);
      const geo = new THREE.ConeGeometry(h * rng.range(0.7, 1.0), h, rng.int(5, 7));
      const base = shades[rng.int(0, shades.length - 1)];

      // Gradiente vertical por vértice para que las cumbres se aclaren.
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const cc = new THREE.Color(base);
      for (let v = 0; v < pos.count; v++) {
        const t = (pos.getY(v) + h / 2) / h;
        colors[v * 3] = Math.min(1, cc.r + t * 0.06);
        colors[v * 3 + 1] = Math.min(1, cc.g + t * 0.04);
        colors[v * 3 + 2] = Math.min(1, cc.b + t * 0.09);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.deleteAttribute('uv');

      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        from + (i / (row.count - 1)) * (to - from),
        h / 2 - 3,
        row.z + rng.range(-14, 14),
      );
      mesh.rotation.y = rng.range(0, Math.PI);
      group.add(mesh);
    }
  }

  scene.add(group);
  disposables.push(group);
  return group;
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
    // El acento tiñe las luces: da identidad al tramo sin tocar la geometría.
    accentTarget.setHex(palette.accent);
    sunLight?.color.lerp(accentTarget, 0.3);
    rimLight?.color.lerp(accentTarget, 0.45);
  }
}

/** Nombre del tramo, para el HUD. */
export function stageName(index) {
  const palettes = STAGES.PALETTES;
  if (!palettes.length) return '';
  const wrapped = ((index % palettes.length) + palettes.length) % palettes.length;
  return palettes[wrapped].name;
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
  buildMountains();
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
  disposables.length = 0;
  built = false;
}
