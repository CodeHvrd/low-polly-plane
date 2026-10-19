/**
 * Mide el RETARDO y la agilidad del control lateral.
 *
 * El problema reportado: "demora bastante la respuesta del analógico" y "cuando
 * dobla ya tenés que volver a corregir". Son dos cosas distintas:
 *
 *   · RETARDO  → cuánto tarda el avión en empezar a girar desde que movés el dedo.
 *   · AGILIDAD → cuánto tarda en completar el giro y cuánto ocupa.
 *
 * Uso: node tools/measure-steering.mjs
 */
import { paramsFromSpec, createState, velocityFromAim, step, addGlideBudget, setControls } from '../js/physics/flightModel.js';
import { getSpec } from '../js/physics/specs.js';
import { setMode } from '../js/modes/index.js';
import { FLIGHT_CONTROLS, AIM, PROPULSION, SIM, LAUNCH_POS } from '../js/config.js';
import { groundHeightAt } from '../js/world/terrainField.js';

const MODO = process.argv[2] ?? 'frenetic';
setMode(MODO);

/** Arranca un vuelo estable a la altura de crucero. */
function despegar(spec, velocidad) {
  const p = paramsFromSpec(spec);
  const s = createState(LAUNCH_POS.y);
  const v = velocityFromAim(20, 0, velocidad, { x: 0, y: 0, z: 0 });
  s.vx = v.x; s.vy = v.y; s.vz = v.z;
  addGlideBudget(s, 60, 60);
  // Un poco de vuelo recto para que se asiente.
  for (let i = 0; i < 120; i++) {
    setControls(s, 0, 0);
    step(s, p, SIM.FIXED_DT);
  }
  return { s, p };
}

console.log('  ═══ AGILIDAD del control lateral — modo ' + MODO + ' ═══\n');
console.log(`  LATERAL_ACCEL=${FLIGHT_CONTROLS.LATERAL_ACCEL}  LATERAL_MAX=${FLIGHT_CONTROLS.LATERAL_MAX}  LATERAL_DAMP=${FLIGHT_CONTROLS.LATERAL_DAMP}\n`);

for (const id of ['paper', 'jet']) {
  const spec = getSpec(id);
  const velocidad = spec.baseSpeed + spec.speedRange * 0.7;
  const { s, p } = despegar(spec, velocidad);

  /*
   * Se mueve el "dedo" a fondo y se mide:
   *   · en qué instante la velocidad lateral llega al 90% del tope (respuesta)
   *   · cuánto tarda el avión en cruzar 10 m de costado (giro usable)
   */
  setControls(s, 1, 0);
  const z0 = s.z;
  let tRespuesta = null;
  const objetivo = FLIGHT_CONTROLS.LATERAL_MAX * 0.9;
  let t10m = null;
  const t0 = s.time;

  for (let i = 0; i < 120 * 8; i++) {
    step(s, p, SIM.FIXED_DT);
    if (tRespuesta === null && Math.abs(s.lateralVel) >= objetivo) tRespuesta = s.time - t0;
    if (t10m === null && Math.abs(s.z - z0) >= 10) t10m = s.time - t0;
    if (s.y <= groundHeightAt(s.x, s.z) && s.x > 1) break;
  }

  console.log(`  ${id}:`);
  console.log(`    tarda ${(tRespuesta ?? -1).toFixed(2)}s en llegar al 90% del tope lateral`);
  console.log(`    tarda ${(t10m ?? -1).toFixed(2)}s en moverse 10 m de costado`);
  console.log(`    a esa velocidad recorre ${(velocidad * (t10m ?? 0)).toFixed(0)} m hacia adelante en ese tiempo`);
}

console.log('\n  ═══ ¿Y si el tope es el problema? = el avión gira poco por segundo ═══\n');
{
  const spec = getSpec('paper');
  const velocidad = spec.baseSpeed + spec.speedRange * 0.7;
  const { s, p } = despegar(spec, velocidad);
  setControls(s, 1, 0);
  const z0 = s.z;
  const x0 = s.x;
  let t = 0;
  console.log('    t      z      lateralVel   desvío por 100 m');
  for (let i = 1; i <= 120 * 3; i++) {
    step(s, p, SIM.FIXED_DT);
    if (i % 60 === 0) {
      const dz = Math.abs(s.z - z0);
      const dx = s.x - x0;
      console.log(`    ${(i / 120).toFixed(1)}s  ${s.z.toFixed(1).padStart(6)}  ${s.lateralVel.toFixed(1).padStart(8)}   ${dx > 0 ? ((dz / dx) * 100).toFixed(1) : '-'} m`);
    }
  }
  console.log(`\n    velocidad: ${velocidad.toFixed(1)} m/s`);
}
