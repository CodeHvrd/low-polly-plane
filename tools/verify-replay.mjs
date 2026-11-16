/**
 * PAPERCRASH — tools/verify-replay.mjs
 * ============================================================
 * Verifica:
 *   1. Arquitectura Anti-Trampas por Replay Determinista (`js/game/replay.js`).
 *      - Simulación headless bit-a-bit idéntica sin DOM ni Three.js.
 *      - Detección y rechazo de fraudes (distancia, monedas, aros, potencia).
 *   2. Rendimiento en Vuelos Extensos (complejidad O(1) por tick y tamaño
 *      compacto del stream de entradas RLE).
 *
 * Ejecutar:  node tools/verify-replay.mjs
 * ============================================================
 */
import { InputRecorder, verifyReplay } from '../js/game/replay.js';
import { SIM } from '../js/config.js';

let passed = 0;
const failures = [];
function check(label, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}${detail ? `  (${detail})` : ''}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? `  (${detail})` : ''}`);
  }
}
const section = (t) => console.log(`\n=== ${t} ===`);

section('1. Compresión de Entradas (InputRecorder)');
{
  const rec = new InputRecorder();
  rec.reset({ pitchDeg: 24, azimuthDeg: 0, power01: 1.0 });

  // Simular 600 ticks (5 segundos a 120 Hz) manteniendo la misma dirección:
  // Solo debe grabar 1 cambio de estado, no 600 entradas.
  for (let t = 0; t < 600; t++) {
    rec.recordControls(t, 0.5, 0);
  }
  rec.recordControls(600, 0, -0.3);
  rec.recordThrust(120);

  const exported = rec.export();
  check('delta-encoding comprime 600 ticks constantes en 2 eventos', exported.events.length === 2, `${exported.events.length} eventos`);
  check('registra los ticks exactos de propulsión', exported.thrusts.length === 1 && exported.thrusts[0] === 120);
  const byteSize = JSON.stringify(exported).length;
  check('tamaño de payload JSON ultra compacto (< 256 bytes)', byteSize < 256, `${byteSize} bytes`);
}

section('2. Verificación Headless Determinista y Detección de Fraude');
{
  const rec = new InputRecorder();
  rec.reset({ pitchDeg: 35, azimuthDeg: 0, power01: 1.0 });
  rec.recordControls(10, 0, 0);
  rec.recordThrust(90);

  const replay = rec.export();
  const baseParams = {
    seed: 12345678,
    ship: 'paper',
    upgrades: { wings: 2, engine: 2, hull: 1 },
    replay,
  };

  // Primera simulación (actúa como el resultado legítimo del cliente)
  const run1 = verifyReplay(baseParams);
  check('simulación headless completa exitosamente', run1.verified && run1.simulated.distance > 50, `${run1.simulated.distance}m, ${run1.simulated.coins} monedas`);

  // Segunda simulación con el mismo payload (reproducibilidad determinista)
  const run2 = verifyReplay({ ...baseParams, claimed: run1.simulated });
  check('vuelo legítimo validado con deltaDistance === 0', run2.verified && run2.deltaDistance === 0, `reason=${run2.reason}`);
  check('monedas coinciden exactamente (deltaCoins === 0)', run2.deltaCoins === 0);

  // Intentos de trampa (Anti-Cheat)
  const cheatDist = verifyReplay({
    ...baseParams,
    claimed: { ...run1.simulated, distance: run1.simulated.distance + 500 },
  });
  check('rechaza manipulación de distancia (+500m)', !cheatDist.verified && cheatDist.reason.startsWith('DISTANCE_MISMATCH'));

  const cheatCoins = verifyReplay({
    ...baseParams,
    claimed: { ...run1.simulated, coins: run1.simulated.coins + 9999 },
  });
  check('rechaza manipulación de monedas (+9999)', !cheatCoins.verified && cheatCoins.reason.startsWith('COINS_MISMATCH'));

  const cheatRings = verifyReplay({
    ...baseParams,
    claimed: { ...run1.simulated, rings: run1.simulated.rings + 10 },
  });
  check('rechaza manipulación de aros (+10)', !cheatRings.verified && cheatRings.reason.startsWith('RINGS_MISMATCH'));

  // Intento de hackear potencia de lanzamiento > 100%
  const cheatPower = verifyReplay({
    ...baseParams,
    replay: {
      ...replay,
      launch: { ...replay.launch, power01: 5.0 },
    },
    claimed: { ...run1.simulated, distance: run1.simulated.distance + 200 },
  });
  check('clamp de potencia impide vuelos alterados (power01=5.0)', !cheatPower.verified);
}

section('3. Rendimiento en Vuelos Extensos (Escalabilidad CPU y Memoria)');
{
  const rec = new InputRecorder();
  rec.reset({ pitchDeg: 28, azimuthDeg: 0, power01: 1.0 });
  // Maniobras suaves durante un vuelo con mejoras al máximo
  for (let t = 0; t < 4000; t += 240) {
    rec.recordControls(t, 0, 0.12);
    if (t > 0 && t % 480 === 0) rec.recordThrust(t);
  }
  const replay = rec.export();

  const t0 = performance.now();
  const res = verifyReplay({
    seed: 9876543,
    ship: 'jet',
    upgrades: { wings: 5, engine: 5, hull: 5, nose: 5, bounce: 3 },
    replay,
  });
  const elapsedMs = performance.now() - t0;
  const ticks = Math.max(1, Math.round(res.simulated.time / SIM.FIXED_DT));
  const usPerTick = (elapsedMs * 1000) / ticks;

  check('vuelo extenso simulado sin degradación (< 50 ms en total)', elapsedMs < 50, `${elapsedMs.toFixed(2)} ms para ${res.simulated.distance}m (${ticks} ticks)`);
  check('costo por tick de física constante (< 50 µs/tick)', usPerTick < 50, `${usPerTick.toFixed(2)} µs/tick`);
  const payloadBytes = JSON.stringify(replay).length;
  check('replay de vuelo extenso se mantiene liviano (< 2 KB)', payloadBytes < 2048, `${payloadBytes} bytes`);
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`TODO OK — ${passed} verificaciones pasaron.`);
  process.exit(0);
} else {
  console.log(`FALLARON ${failures.length} de ${passed + failures.length}:`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
