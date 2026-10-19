/**
 * PAPERCRASH — aircraft/index.js
 * ============================================================
 * Registro de constructores de modelos 3D.
 *
 * Es el único punto que sabe cómo pasar de un `type` (el id de la ficha
 * técnica en physics/specs.js) a un Object3D. Añadir una aeronave nueva
 * consiste en: 1) su ficha en specs.js, 2) su constructor acá, 3) el botón
 * en la UI. Nada más del juego necesita cambios.
 * ============================================================
 */
import { buildPaperPlane } from './paperPlane.js';
import { buildPassengerPlane } from './passengerPlane.js';
import { buildFighterJet } from './fighterJet.js';
import { buildHelicopter } from './helicopter.js';

/** @type {Record<string, () => THREE.Group>} */
const BUILDERS = {
  paper: buildPaperPlane,
  passenger: buildPassengerPlane,
  jet: buildFighterJet,
  heli: buildHelicopter,
};

/**
 * Construye el modelo de una aeronave.
 * @param {string} type
 * @returns {THREE.Group} siempre un grupo; cae a `paper` si el id es inválido
 */
export function buildAircraftModel(type) {
  const build = BUILDERS[type] || BUILDERS.paper;
  return build();
}

/**
 * Libera geometrías y materiales de un modelo ya descartado.
 * Imprescindible al cambiar de nave: sin esto la GPU acumula basura
 * en cada cambio de aeronave.
 * @param {THREE.Object3D} root
 */
export function disposeAircraftModel(root) {
  root.traverse((child) => {
    child.geometry?.dispose?.();
    const m = child.material;
    if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.());
    else m?.dispose?.();
  });
  root.clear();
}
