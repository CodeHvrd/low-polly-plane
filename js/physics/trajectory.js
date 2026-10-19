/**
 * PAPERCRASH — physics/trajectory.js
 * ============================================================
 * Previsualización de trayectoria.
 *
 * Usa EXACTAMENTE el mismo núcleo que el vuelo real
 * (physics/flightModel.js) y la misma función de altura del suelo
 * (world/terrainField.js). La única diferencia es el paso de muestreo:
 * acá se usa un `dt` más grande para obtener puntos bien espaciados.
 *
 * Por construcción, la línea punteada no puede mentir.
 * ============================================================
 */
import { TRAJECTORY, LAUNCH_POS, SIM } from '../config.js';
import { createState, velocityFromAim, step, attitudeTarget } from './flightModel.js';
import { groundHeightAt } from '../world/terrainField.js';

const scratchVel = { x: 0, y: 0, z: 0 };
const scratchState = createState(LAUNCH_POS.y);

/**
 * @typedef {Object} TrajectoryPoint
 * @property {number} x @property {number} y @property {number} z
 * @property {number} pitch  Ángulo visual del morro (rad) en ese punto
 */

/**
 * @typedef {Object} TrajectoryResult
 * @property {TrajectoryPoint[]} points
 * @property {boolean} hitGround   true si terminó contra el suelo
 * @property {number} distance     alcance horizontal (m)
 * @property {number} apex         altura máxima (m)
 * @property {number} flightTime   duración estimada (s)
 */

/** Buffer reutilizable: la vista previa se recalcula en cada movimiento del mouse. */
const points = [];

function makePoint(x, y, z, pitch) {
  return { x, y, z, pitch };
}

/**
 * Calcula la trayectoria prevista sin asignar memoria nueva.
 * El array devuelto se reutiliza entre llamadas: NO guardar referencias.
 *
 * @param {import('./specs.js').FlightSpec} spec
 * @param {import('./flightModel.js').FlightParams} params
 * @param {number} pitchDeg
 * @param {number} azimuthDeg
 * @param {number} speed
 * @returns {TrajectoryResult}
 */
export function computeTrajectory(spec, params, pitchDeg, azimuthDeg, speed) {
  points.length = 0;

  velocityFromAim(pitchDeg, azimuthDeg, speed, scratchVel);
  const s = scratchState;
  s.x = 0;
  s.y = LAUNCH_POS.y;
  s.z = 0;
  s.vx = scratchVel.x;
  s.vy = scratchVel.y;
  s.vz = scratchVel.z;
  s.time = 0;
  s.maxAltitude = s.y;
  s.maxSpeed = speed;
  s.landed = false;
  /*
   * La previsualización NO recibe boosters.
   *
   * Es deliberado: la línea punteada muestra lo que pasaría sin recolectar
   * nada. Si incluyera los boosters le estaría regalando al jugador la
   * respuesta de por dónde pasar, que es justamente lo que tiene que decidir.
   */
  s.glideBudget = 0;
  s.burn = 0;
  s.burnTime = 0;

  const dt = TRAJECTORY.SAMPLE_DT;
  /*
   * Cuántos pasos simular y cada cuántos guardar un punto.
   *
   * Son dos cosas distintas a propósito. Antes el bucle estaba limitado por la
   * cantidad de PUNTOS, así que la previsualización sólo simulaba ~10 s de
   * vuelo: alcanzaba para un tiro tenso, pero con planeo un lanzamiento alto
   * seguía en el aire al agotarse el bucle, nunca se detectaba el impacto y el
   * alcance quedaba en 0. Ahora la simulación corre por tiempo y el muestreo se
   * adapta para no pasar de `MAX_POINTS` puntos.
   */
  const maxSteps = Math.ceil(TRAJECTORY.MAX_SIM_TIME / dt);
  const stride = Math.max(1, Math.floor(maxSteps / TRAJECTORY.MAX_POINTS));

  let apex = s.y;
  /** Última posición conocida: es el resultado si nunca se toca el suelo. */
  let lastX = s.x;
  let lastZ = s.z;
  let hitGround = false;
  let lastPitch = attitudeTarget(s);

  points.push(makePoint(s.x, s.y, s.z, lastPitch));

  for (let i = 1; i <= maxSteps; i++) {
    step(s, params, dt);

    // Guarda de cordura: si el estado se corrompe, cortamos la vista previa
    // en vez de dibujar una línea hacia el infinito.
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) break;

    const pitch = attitudeTarget(s);
    // Suavizado del morro, igual criterio que en el vuelo real.
    lastPitch += (pitch - lastPitch) * Math.min(1, spec.pitchRate * dt);

    lastX = s.x;
    lastZ = s.z;

    // El último punto se guarda siempre, para que la línea llegue hasta donde
    // realmente llegó el avión aunque el impacto caiga entre dos muestras.
    const isSample = i % stride === 0 || points.length === 1;
    if (isSample || s.y <= groundHeightAt(s.x, s.z)) {
      points.push(makePoint(s.x, s.y, s.z, lastPitch));
    }
    if (s.y > apex) apex = s.y;

    if (s.y <= groundHeightAt(s.x, s.z)) {
      hitGround = true;
      // Se fija el último punto justo sobre el suelo para que el marcador
      // de impacto quede apoyado y no flotando ni enterrado.
      const last = points[points.length - 1];
      last.y = groundHeightAt(s.x, s.z);
      break;
    }

    if (s.time > SIM.MAX_FLIGHT_TIME) break;
    if (Math.abs(s.z) > 400) break;
  }

  return {
    points,
    hitGround,
    // Si nunca tocó el suelo, el alcance es hasta donde llegó y no cero.
    distance: lastX,
    distanceZ: lastZ,
    apex,
    flightTime: s.time,
  };
}
