/**
 * PAPERCRASH — world/terrainField.js
 * ============================================================
 * Función de altura del suelo. ÚNICA fuente de verdad.
 *
 * La usan la física (colisiones), la malla del terreno y la colocación de
 * obstáculos y recolectables. Si hubiera dos definiciones, el avión chocaría
 * contra un suelo invisible o atravesaría la malla.
 *
 * ── Perfil por tramos ──
 * El relieve crece a lo largo del corredor: los primeros tramos son casi planos
 * y rasantes, y los últimos tienen Montañas de verdad que obligan a volar alto.
 * La amplitud la manda `game/flightProfile.js`, que es también quien define a
 * qué altura conviene volar.
 *
 * Módulo puro: sin Three.js ni DOM.
 * ============================================================
 */
import { WORLD, STAGES } from '../config.js';

/** Ruido de valor con interpolación suave, determinista. */
function hash2(ix, iy, seed) {
  let h = ix * 374761393 + iy * 668265263 + seed * 1442695040888963407;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  // Suavizado tipo smoothstep: sin esto el ruido se ve facetado de más.
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);

  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

function fbm(x, y, seed, octaves) {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function smoothstep(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/* ── Amplitud por tramos, inyectada ──────────────────────────
 *
 * Igual que la altura objetivo de los recolectables, el relieve se configura
 * desde una función inyectada para no invertir la dependencia `world → game`.
 * El respaldo hace que el terreno crezca solo, que es lo razonable si nadie
 * configuró nada.
 */
let amplitudeFn = null;

/**
 * Registra la función que devuelve la amplitud del relieve (0..1+) a esa x.
 * @param {(x:number) => number} fn
 */
export function setTerrainAmplitudeProvider(fn) {
  amplitudeFn = fn;
}

/** Amplitud del relieve a esa distancia. */
function amplitudeAt(x) {
  if (amplitudeFn) return amplitudeFn(x);
  // Respaldo: crecimiento suave a lo largo del corredor.
  const t = Math.max(0, Math.min(1, x / Math.max(1, WORLD.COURSE_LENGTH)));
  return STAGES.GROUND_AMPLITUDE * (0.35 + Math.pow(t, 1.35) * 1.1);
}

/**
 * Altura del terreno en coordenadas de MUNDO.
 *
 * @param {number} x  metros hacia el horizonte (negativo = detrás del lanzador)
 * @param {number} z  metros laterales
 * @returns {number} altura en metros (0 en la plataforma)
 */
export function terrainHeightAt(x, z) {
  // ── Plataforma: llana de punta a punta ──
  if (x < WORLD.FLAT_ZONE && x > -WORLD.PAD_BACK_LENGTH) return 0;

  // ── Detrás de la plataforma: loma que tapa el borde del mundo ──
  if (x <= -WORLD.PAD_BACK_LENGTH) {
    const d = Math.min(1, (-WORLD.PAD_BACK_LENGTH - x) / 130);
    const rise = smoothstep(d) * 22;
    // Ondulación amplia: da silueta sin ser un muro.
    const ripple =
      Math.sin((x + WORLD.PAD_BACK_LENGTH) * 0.021) * 3.2 +
      Math.cos(Math.abs(z) * 0.045) * 2.4;
    const lateralBack = Math.pow(Math.abs(z) / (WORLD.TERRAIN_WIDTH / 2), 2) * 14;
    return Math.max(0, rise + ripple * smoothstep(d) + lateralBack);
  }

  // ── Corredor de vuelo ──
  const amp = amplitudeAt(x);

  // Rampa de entrada suave: evita un escalón vertical en el borde de la plataforma.
  const ramp = smoothstep((x - WORLD.FLAT_ZONE) / 22);

  /*
   * Perfil longitudinal: varias lomas en vez de una sola.
   *
   * El corredor es mucho más largo que antes (2500 m), así que una única loma
   * dejaría tramos enteros perfectamente planos. La frecuencia se elige para que
   * haya una loma cada ~340 m.
   *
   * IMPORTANTE: la amplitud escala la DESVIACIÓN respecto de una base, no la
   * base. Escalando todo, el primer tramo (amplitud 0.26) daba suelo a 0 m en
   * algunos puntos y el relieve desaparecía: el avión volaba sobre una chapa
   * plana. Así el suelo siempre tiene un mínimo y lo que cambia es cuánto sube.
   */
  const BASE_HEIGHT = 1.4;
  const undulation = Math.sin((x - WORLD.FLAT_ZONE) * 0.0185) * 0.55
    + Math.sin((x - WORLD.FLAT_ZONE) * 0.0071 + 1.7) * 0.45;
  /*
   * La escala del relieve es baja a propósito (13 en vez de 17): con el corredor
   * rasante, cada metro de loma le come alcance al tiro plano. El desafío lo
   * tienen que poner los obstáculos, no el suelo.
   */
  const profile = BASE_HEIGHT + (undulation * 0.5 + 0.5) * 13 * amp;

  // Colinas laterales: crecen al alejarse del eje del corredor, y también con el
  // tramo: en los primeros el corredor está abierto, en los últimos es un cañón.
  const lateral = Math.pow(Math.abs(z) / (WORLD.TERRAIN_WIDTH / 2), 2) * 70 * amp;

  /*
   * Detalle de alta frecuencia para el look facetado.
   *
   * Se usa |z| a propósito: el ruido de valor se apoya en una grilla entera, y
   * su salida no es simétrica respecto del origen (la celda [3,4] y la celda
   * [-4,-3] dan valores distintos). Sin este valor absoluto, apuntar a la
   * izquierda y a la derecha daban suelos distintos y el vuelo dejaba de ser
   * simétrico: el mismo ángulo a un lado y al otro caía a alturas diferentes.
   */
  const detail = (fbm(x * 0.018, Math.abs(z) * 0.05, 1337, 3) - 0.5) * 7 * amp;

  return Math.max(0, (profile + lateral + detail) * ramp);
}

/** Altura del suelo efectiva para la física (permite desactivar el relieve). */
export function groundHeightAt(x, z) {
  return terrainHeightAt(x, z);
}
