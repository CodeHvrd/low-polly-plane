/**
 * PAPERCRASH — tools/calibrate-flight.mjs
 * ============================================================
 * Banco de calibración del modelo de vuelo.
 *
 * Responde preguntas de diseño con números en vez de a ojo: "¿qué tan abrupta
 * es la caída?", "¿en qué ángulo está el alcance máximo?", "¿manda la potencia
 * o manda el ángulo?".
 *
 * No es una prueba con aserciones: es una herramienta de exploración.
 *
 *   node tools/calibrate-flight.mjs            # tabla de las 4 aeronaves
 *   node tools/calibrate-flight.mjs paper      # sólo una
 *   node tools/calibrate-flight.mjs power      # ¿manda potencia o ángulo?
 *   node tools/calibrate-flight.mjs shape      # rasante vs arco (objetivo de diseño)
 *   node tools/calibrate-flight.mjs sweep      # barrido de coeficientes
 * ============================================================
 */
import { paramsFromSpec } from '../js/physics/flightModel.js';
import { computeTrajectory } from '../js/physics/trajectory.js';
import { AIRCRAFT_SPECS, AIRCRAFT_LIST } from '../js/physics/specs.js';
import { WORLD } from '../js/config.js';

const pad = (v, n = 6, d = 0) => String(typeof v === 'number' ? v.toFixed(d) : v).padStart(n);

/** Corre una trayectoria con una ficha dada. */
function fly(spec, pitch, speed, mods = {}) {
  return { pitch, ...computeTrajectory(spec, paramsFromSpec(spec, mods), pitch, 0, speed) };
}

const BASE = {
  baseSpeed: 15, mass: 0.15, pitchRate: 4, liftCapG: 1.2,
  id: 'x', name: 'x', tag: '', icon: '', desc: '', price: 0,
};

/**
 * Perfil completo de una ficha sintética: mejor alcance, vuelo más plano que
 * conserva la mayor parte de ese alcance, y avisos de patologías.
 */
function profile(spec, speedRange) {
  const s = { ...spec, speedRange };
  const speed = s.baseSpeed + speedRange;
  let best = { distance: -1, apex: 0, flightTime: 0, pitch: 0 };
  let flat = null;
  let pathological = false;

  for (let pitch = 6; pitch <= 76; pitch += 1) {
    const r = fly(s, pitch, speed);
    if (r.distance <= 0.01 || r.flightTime > 40) pathological = true;
    if (r.distance > best.distance) best = r;
  }
  for (let pitch = 6; pitch <= 76; pitch += 1) {
    const r = fly(s, pitch, speed);
    if (r.distance >= best.distance * 0.75) { flat = r; break; }
  }
  const at20 = fly(s, 20, speed);
  const at45 = fly(s, 45, speed);
  return {
    speed, best, flat: flat ?? best, pathological,
    at20: at20.distance, at45: at45.distance,
    /** >1 significa que el rasante llega MÁS LEJOS que el arco. */
    flatGain: at45.distance > 0 ? at20.distance / at45.distance : 0,
  };
}

/**
 * OBJETIVO DE DISEÑO: el vuelo rasante debe ser el que más lejos llega, y el
 * arco debe ser una herramienta táctica para pasar por arriba de obstáculos,
 * no la forma de maximizar distancia.
 */
function shape() {
  console.log('Forma del vuelo — ¿rasante o arco?\n');
  console.log('     cl     cd  sink │  rasante 20° │   arco 45° │ ganancia rasante │ vuelo');
  const rows = [];
  for (const cl of [0.0030, 0.0040, 0.0055]) {
    for (const cd of [0.0016, 0.0024, 0.0034]) {
      for (const sink of [3.0, 4.0, 5.5]) {
        const p = profile({ ...BASE, cl, cd, glideSink: sink }, 21);
        rows.push({ cl, cd, sink, ...p });
        console.log(
          `${pad(cl, 7, 4)} ${pad(cd, 6, 4)} ${pad(sink, 5, 1)} │ ` +
          `${pad(p.at20, 12)}m │ ${pad(p.at45, 10)}m │ ${pad(p.flatGain, 16, 2)} │ ` +
          `${pad(p.best.distance, 5)}m @ ${p.best.pitch}°`,
        );
      }
    }
  }

  console.log('\n── Candidatos viables ──');
  console.log('  rasante ≥ 130 m · rasante gana por ≥ 1.25x · ápice del arco < 40 m · sin patologías');
  const ok = rows.filter((r) =>
    !r.pathological && r.at20 >= 130 && r.flatGain >= 1.25 && r.at45 > 0 && r.best.apex < 40);
  for (const r of ok) {
    console.log(
      `  cl=${r.cl} cd=${r.cd} sink=${r.sink} → rasante ${r.at20.toFixed(0)}m, arco ${r.at45.toFixed(0)}m, ` +
      `ganancia x${r.flatGain.toFixed(2)}, mejor ${r.best.distance.toFixed(0)}m @ ${r.best.pitch}°`,
    );
  }
  if (!ok.length) console.log('  ninguno con ese criterio');
}

/** ¿Manda la potencia o manda el ángulo? */
function power() {
  const spec = AIRCRAFT_LIST[0];
  const speedAt = (p) => spec.baseSpeed + spec.speedRange * p;
  console.log(`\n${spec.name}: potencia manda vs ángulo manda\n`);

  console.log('  Alcance según POTENCIA (a 30° fijo):');
  const byPower = [];
  for (const p of [0.2, 0.4, 0.6, 0.8, 1.0]) {
    const r = fly(spec, 30, speedAt(p));
    byPower.push(r.distance);
    console.log(`    ${pad(p * 100, 3)}% → ${pad(speedAt(p), 4, 1)} m/s → ${pad(r.distance, 6)}m  (ápice ${r.apex.toFixed(0)}m, ${r.flightTime.toFixed(1)}s)`);
  }
  console.log(`    relación 100%/20% = x${(byPower[4] / byPower[0]).toFixed(1)}`);

  console.log('\n  Alcance según ÁNGULO (a 100% de potencia):');
  const byAngle = [];
  for (let pitch = 18; pitch <= 52; pitch += 4) {
    const r = fly(spec, pitch, speedAt(1));
    byAngle.push({ pitch, d: r.distance });
    console.log(`    ${pad(pitch, 3)}° → ${pad(r.distance, 6)}m  (ápice ${r.apex.toFixed(0)}m, ${r.flightTime.toFixed(1)}s)`);
  }
  const lo = byAngle[0].d;
  const hi = Math.max(...byAngle.map((a) => a.d));
  const at = byAngle.find((a) => a.d === hi);
  console.log(`    de 18° a ${at.pitch}° el alcance sube sólo x${(hi / lo).toFixed(2)}`);

  console.log('\n  Zona útil (≥85% del alcance máximo):');
  let best = 0;
  for (let p = 6; p <= 76; p++) best = Math.max(best, fly(spec, p, speedAt(1)).distance);
  const band = [];
  for (let p = 6; p <= 76; p++) if (fly(spec, p, speedAt(1)).distance >= best * 0.85) band.push(p);
  console.log(`    ${band[0]}° a ${band[band.length - 1]}°`);
}

/** Barrido conjunto de coeficientes contra el objetivo de diseño. */
function sweep() {
  console.log('Barrido — papel, potencia 100%\n');
  console.log('  v.max │     cl     cd  sink │ óptimo │ alcance │ ápice │ rasante │  arco │ ganancia');
  const rows = [];
  for (const vmax of [30, 36, 42]) {
    for (const cl of [0.0030, 0.0040, 0.0055]) {
      for (const cd of [0.0016, 0.0024]) {
        for (const sink of [3.0, 4.5, 6.0]) {
          const p = profile({ ...BASE, baseSpeed: vmax - 21, cl, cd, glideSink: sink }, 21);
          rows.push({ vmax, cl, cd, sink, ...p });
          console.log(
            `${pad(vmax, 6)} │ ${pad(cl, 7, 4)} ${pad(cd, 6, 4)} ${pad(sink, 5, 1)} │ ` +
            `${pad(p.best.pitch, 5)}° │ ${pad(p.best.distance, 6)}m │ ${pad(p.best.apex, 5, 1)}m │ ` +
            `${pad(p.at20, 7)}m │ ${pad(p.at45, 5)}m │ ${pad(p.flatGain, 8, 2)}`,
          );
        }
      }
    }
  }

  console.log('\n── Candidatos viables ──');
  console.log('  alcance 110-200 m · óptimo 24-40° · ápice < 32 m · rasante ≥ 120 m y gana ≥ 1.2x');
  const ok = rows.filter((r) =>
    !r.pathological &&
    r.best.distance >= 110 && r.best.distance <= 200 &&
    r.best.pitch >= 24 && r.best.pitch <= 40 &&
    r.best.apex < 32 &&
    r.at20 >= 120 && r.flatGain >= 1.2);
  for (const r of ok) {
    console.log(
      `  vmax=${r.vmax} cl=${r.cl} cd=${r.cd} sink=${r.sink} → óptimo ${r.best.pitch}° ${r.best.distance.toFixed(0)}m ` +
      `ápice ${r.best.apex.toFixed(1)}m · rasante ${r.at20.toFixed(0)}m · arco ${r.at45.toFixed(0)}m · x${r.flatGain.toFixed(2)}`,
    );
  }
  if (!ok.length) console.log('  ninguno con ese criterio');
}

const which = process.argv[2];

if (which === 'sweep') sweep();
else if (which === 'shape') shape();
else if (which === 'power') power();
else {
  const specs = which ? AIRCRAFT_LIST.filter((s) => s.id === which) : AIRCRAFT_LIST;
  for (const spec of specs) {
    console.log(`\n═══ ${spec.name} (${spec.id}) ═══`);
    console.log(`  cl=${spec.cl}  cd=${spec.cd}  L/D nominal=${(spec.cl / spec.cd).toFixed(2)}`);
    console.log(`  velocidad: base ${spec.baseSpeed} m/s + ${spec.speedRange} de rango`);
    console.log(`  liftCapG=${spec.liftCapG}  ·  descenso terminal ${spec.glideSink} m/s`);

    for (const p of [1.0, 0.6]) {
      const speed = spec.baseSpeed + spec.speedRange * p;
      console.log(`\n  ── potencia ${(p * 100).toFixed(0)}%  (${speed.toFixed(1)} m/s) ──`);
      console.log('  pitch │ alcance │ ápice │ tiempo │  lift0 │  drag0 │ L/D');
      for (let pitch = 8; pitch <= 76; pitch += 6) {
        const params = paramsFromSpec(spec);
        const r = fly(spec, pitch, speed);
        const lift0 = Math.min(params.liftCap, params.cl * speed * speed);
        const drag0 = params.cd * speed * speed;
        console.log(
          `  ${pad(r.pitch, 5)}° │ ${pad(r.distance, 6)}m │ ${pad(r.apex, 5, 1)}m │ ${pad(r.flightTime, 5, 1)}s │ ` +
          `${pad(lift0, 6, 2)} │ ${pad(drag0, 6, 2)} │ ${pad(lift0 / drag0, 4, 2)}`,
        );
      }
    }
  }
}

void AIRCRAFT_SPECS;
void WORLD;
