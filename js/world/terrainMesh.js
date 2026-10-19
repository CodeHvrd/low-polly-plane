/**
 * PAPERCRASH — world/terrainMesh.js
 * ============================================================
 * Malla del terreno con VENTANA DESLIZANTE.
 *
 * ── El problema ──
 * El suelo se construía una sola vez, de la rampa de lanzamiento hasta el final
 * del corredor. Cuando el corredor se prolongó sin fin, esa malla seguía
 * terminando en el mismo sitio: pasado ese punto el avión volaba sobre el vacío y
 * la pantalla se veía negra, sin obstáculos porque tampoco había suelo donde
 * apoyarlos.
 *
 * ── Por qué NO se hace una malla gigante ──
 * Cubrir 29 km con la resolución actual serían unos 25 millones de vértices. No
 * es una opción.
 *
 * ── Cómo funciona ──
 * La malla cubre una VENTANA de terreno alrededor del avión. Cuando el avión se
 * acerca al borde, los vértices se reescriben desplazados: la geometría siempre
 * es la misma (misma cantidad de vértices, mismo buffer) y sólo cambian las
 * coordenadas. No se crea ni se libera nada, así que no hay picos de memoria ni
 * basura para el recolector.
 *
 * Es la misma idea que la ventana de tramos de obstáculos (ver `Game.js`), y por
 * la misma razón: el corredor es infinito pero lo que se puede tener vivo es
 * acotado.
 *
 * ── Por qué la altura no necesita ventana ──
 * `terrainHeightAt` es una función pura de (x, z): no depende de nada generado.
 * Reescribir los vértices es sólo volver a evaluarla en las coordenadas nuevas.
 * ============================================================
 */
import { scene } from '../core/engine.js';
import { WORLD, STAGES } from '../config.js';
import { terrainHeightAt } from './terrainField.js';

/** Cuánto terreno se mantiene detrás del avión (m). */
const DETRAS = 600;
/** Cuánto hacia adelante (m). */
const ADELANTE = 2400;
/** Subdivisiones a lo largo. */
const SEG_X = 260;
/** Subdivisiones a lo ancho. */
const SEG_Z = 30;

/** @type {object|null} */
let mesh = null;
/** @type {object|null} */
let geometry = null;
/** @type {object|null} */
let material = null;
/**
 * El material del terreno, expuesto para que la PALETA DEL BIOMA lo tiña.
 *
 * ── Por qué hace falta ──
 * Antes el color se fijaba una sola vez, con el de la primera paleta, y nadie lo
 * volvía a tocar: el suelo no cambiaba nunca de bioma. Con paletas oscuras el
 * terreno quedaba tan cerca del color del cielo que no se distinguía —era el
 * "no se ve el piso" reportado.
 */
let terrainMaterial = null;

/** Devuelve el material del terreno, o null si la malla no está construida. */
export function getTerrainMaterial() {
  return terrainMaterial;
}
/** Centro de la ventana actual (m). */
let centroActual = -Infinity;

/**
 * Construye la malla del terreno. Idempotente.
 *
 * @returns {object} la malla
 */
export function initTerrainMesh() {
  if (mesh) return mesh;

  geometry = new THREE.PlaneGeometry(1, 1, SEG_X, SEG_Z);
  geometry.rotateX(-Math.PI / 2);

  /*
   * Material de una sola cara visto desde arriba.
   *
   * `DoubleSide` costaba el doble de relleno y no hacía falta: el avión vuela por
   * encima del suelo y nunca lo mira desde abajo. Si el avión se hunde bajo el
   * terreno, la colisión lo mata antes de que se note.
   */
  material = new THREE.MeshLambertMaterial({
    color: STAGES.PALETTES[0].ground,
    flatShading: true,
  });
  terrainMaterial = material;

  mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  // El terreno es enorme: descartarlo por frustum lo haría parpadear.
  mesh.frustumCulled = false;
  scene.add(mesh);

  return mesh;
}

/**
 * Coloca la ventana de terreno alrededor de `x`. Idempotente por proximidad.
 *
 * @param {number} x  posición del avión
 * @param {boolean} [forzar]
 * @returns {boolean} si reescribió los vértices
 */
export function updateTerrainWindow(x, forzar = false) {
  if (!mesh) return false;

  /*
   * Se recentra de a saltos y no de a un metro.
   *
   * Reescribir 260x30 vértices es barato, pero hacerlo cada frame no tiene
   * sentido: el avión avanza 30 m por segundo y el terreno se ve igual. El salto
   * es de un cuarto de tramo (125 m), mucho menos que la parte que queda
   * adelante, así que el borde nunca se acerca lo suficiente para verse.
   */
  const salto = STAGES.SEGMENT_LENGTH / 4;
  const centro = Math.round(x / salto) * salto;
  if (!forzar && Math.abs(centro - centroActual) < salto) return false;
  centroActual = centro;

  const x0 = centro - DETRAS;
  const x1 = centro + ADELANTE;
  const z0 = -WORLD.TERRAIN_WIDTH / 2;
  const z1 = WORLD.TERRAIN_WIDTH / 2;

  const pos = geometry.attributes.position;
  let i = 0;
  for (let iz = 0; iz <= SEG_Z; iz++) {
    const z = z0 + ((z1 - z0) * iz) / SEG_Z;
    for (let ix = 0; ix <= SEG_X; ix++) {
      const vx = x0 + ((x1 - x0) * ix) / SEG_X;
      // La MISMA función que usan la física y la vista previa: el suelo que se
      // ve es el suelo que se pisa.
      pos.setXYZ(i, vx, terrainHeightAt(vx, z), z);
      i++;
    }
  }

  pos.needsUpdate = true;
  /*
   * Sin recalcular la esfera envolvente, Three.js cree que la malla sigue donde
   * estaba y la descarta al mirar hacia otro lado. Con `frustumCulled = false` no
   * haría falta, pero recalcularla es correcto y barato, y deja la malla usable
   * si alguna vez se activa el descarte.
   */
  geometry.computeBoundingSphere();

  return true;
}

/** Vuelve al estado inicial. */
export function disposeTerrainMesh() {
  if (!mesh) return;
  scene.remove(mesh);
  geometry?.dispose();
  material?.dispose();
  mesh = null;
  geometry = null;
  material = null;
  centroActual = -Infinity;
}

/** Coordenadas de la ventana actual, para depurar. */
export function terrainWindow() {
  return centroActual === -Infinity
    ? null
    : { from: centroActual - DETRAS, to: centroActual + ADELANTE };
}
