/**
 * PAPERCRASH — game/flightProfile.js
 * ============================================================
 * Perfil de vuelo: LOS COSTADOS del corredor.
 *
 * ── Qué problema resuelve ──
 * El juego decidía "qué tan alto vuela esto" en tres lugares distintos y
 * descoordinados: la trayectoria nominal de los recolectables, el sesgo de
 * ángulo de la puntería y la altura del terreno. Cuando uno cambiaba, los otros
 * dos quedaban desfasados y el avión pasaba por al lado de todo sin recoger
 * nada (ya pasó una vez y costó encontrarlo).
 *
 * Acá se define UNA función de distancia → altura deseada, y todo lo demás se
 * deriva de ella: los recolectables se anclan a esa línea, el terreno se moldea
 * con esa amplitud, y la puntería arranca apuntando ahí.
 *
 * ── Por qué la altura es ABSOLUTA y no sobre el suelo ──
 * Mismo motivo: el avión vuela a alturas absolutas, el terreno sube, y anclar
 * cosas "a 10 m del suelo" las deja inalcanzables a media distancia.
 *
 * Módulo puro: sin Three.js ni DOM, verificable en Node.
 * ============================================================
 */
import { LAUNCH_POS } from '../config.js';

/**
 * Alturas absolutas de referencia (m sobre el nivel del mar del corredor).
 *
 * `CRUISE` es la altura a la que el avión se nivela con un tiro normal: es LA
 * referencia del juego. Todo lo que tiene que ser alcanzable vive cerca de ahí.
 */
/**
 * Techo PRÁCTICO de la línea de vuelo (m).
 *
 * No es el techo del modo (que es un límite duro) sino hasta dónde conviene
 * apuntar. La diferencia importa: apuntar al límite deja al avión sin margen.
 */
const CRUISE_MAX = 28;

export const ALTITUDE = {
  /** Nivel del corredor: el avión nunca baja de acá. */
  GROUND: LAUNCH_POS.y,
  /**
   * Altura de crucero de los primeros tramos (m).
   *
   * Deliberadamente baja: se pidió que la experiencia inicial se sienta rasante,
   * esquivando obstáculos, y que la altura sea algo que aparece más adelante.
   */
  CRUISE: 15,
  /** Techo del perfil, en el tramo final (m). */
  CEILING: 52,
  /**
   * Margen mínimo entre el suelo y la línea de vuelo (m).
   *
   * Es lo que impide que los recolectables queden enterrados donde el relieve
   * sube: la línea nunca baja de `suelo + esto`.
   */
  TERRAIN_CLEARANCE: 9,
};

/** Cuánto dura la transición de un tramo al siguiente, en metros. */
const BLEND_METERS = 220;

/** Suavizado de la curva: arranca y frena sin escalones. */
function smoothstep01(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/**
 * Perfil de alturas del corredor.
 *
 * `amplitude` es cuánto puede subir el ENTORNO (terreno, montañas) en ese tramo,
 * y va creciendo: los primeros tramos son planos y rasantes, los últimos tienen
 * relieve de verdad y obligan a volar alto.
 *
 * @param {{segmentLength:number, heightGrowth?:number, groundAmplitude?:number}} profile
 * @returns {Array<{index:number, from:number, to:number, amplitude:number, cruise:number, label:string}>}
 */
/**
 * Circuito de un tramo.
 *
 * ── Por qué es función del ÍNDICE ──
 * Determinista: el mismo tramo da siempre el mismo circuito, así que el mundo
 * sigue siendo reproducible (necesario para el ranking y para el futuro online).
 * Alterna para que el vuelo cambie de ritmo: uno de planeo, uno rasante.
 *
 * @param {number} segmento
 * @returns {'alto'|'rasante'}
 */
export function nivelDeCircuito(segmento) {
  return segmento % 2 === 0 ? 'alto' : 'rasante';
}

export function buildProfile(profile) {
  const seg = profile.segmentLength;
  const growth = profile.heightGrowth ?? 0.75;
  const ground = profile.groundAmplitude ?? 1;

  const segments = [];
  for (let i = 0; i < profile.stageCount; i++) {
    const from = i * seg;
    const to = from + seg;
    /*
     * ── Progresión de dificultad, normalizada para LLEGAR al techo ──
     *
     * `t` es el avance del tramo dentro del corredor de referencia, pero se
     * normaliza contra el ÚLTIMO tramo y no contra el largo del corredor.
     *
     * ── El bug que esto arregla ──
     * Antes se usaba `t = from / courseLength`, y con 5 tramos el último arranca
     * en 2000/2500 = 0.8. Elevado a 1.35 daba k = 0.74, así que el bioma más
     * avanzado quedaba al 74% de la dificultad máxima y NINGUNO llegaba al techo:
     * la curva se quedaba a medio camino.
     *
     * Normalizando, el último bioma de la lista da exactamente k = 1. La curva
     * sigue siendo suave (exponente 1.35: los primeros crecen poco y los últimos
     * se aceleran) pero ahora termina donde tiene que terminar.
     *
     * ── Y después del último bioma ──
     * El índice del tramo puede crecer sin fin porque el corredor es indefinido.
     * La saturación en 1 hace que del sexto tramo en adelante la dificultad se
     * mantenga: el último bioma se repite infinitamente, cada vez más difícil,
     * pero nunca imposible.
     */
    const total = Math.max(1, profile.stageCount - 1);
    const t = Math.min(1, i / total);
    const k = Math.pow(t, 1.35);
    segments.push({
      index: i,
      from,
      to,
      /**
       * Amplitud del relieve del entorno, en fracción de la máxima.
       *
       * El primer tramo es CASI PLANO (0.1) a propósito: el pedido es que la
       * experiencia inicial se sienta rasante. Con relieve desde el arranque, el
       * tiro plano chocaba contra una loma a los 90 m y el arco ganaba por
       * goleada, que es justo lo contrario de lo que se busca.
       *
       * La base (0.06) y el crecimiento (1.05) están elegidos para que la curva dé
       * EXACTAMENTE 1.0 en el último bioma. Con la fórmula anterior daba 1.31: un
       * 31% más de relieve que el máximo previsto, y con el techo de vuelo del
       * modo frenético en 35 m la línea de vuelo quedaba pegada al techo.
       */
      amplitude: Math.max(0.06, ground * (0.06 + k * 1.05)),
      /**
       * Altura de crucero hacia la que tiende la puntería (m).
       *
       * ── Por qué ahora apunta a CRUISE_MAX y no al techo ──
       * Antes tendía al techo del modo, pero el techo es un LÍMITE, no un destino:
       * apuntar ahí dejaba al avión sin margen para subir. En el frenético, con el
       * techo en 35 m, la línea habría quedado a 34 m y no se podría remontar
       * nunca.
       *
       * `CRUISE_MAX` es el techo PRÁCTICO: el relieve del último bioma llega a
       * ~14 m, así que 28 deja 14 m de colchón para esquivar por arriba.
       */
      cruise: ALTITUDE.CRUISE + (CRUISE_MAX - ALTITUDE.CRUISE) * k * growth,
      label: `Tramo ${i + 1}`,
    });
  }
  return segments;
}

/**
 * Interpola un valor por tramo, con transición suave en la frontera.
 *
 * La transición importa: un salto de golpe entre tramos se vería como un
 * escalón en el terreno y descolocaría a los recolectables que están justo en
 * la junta.
 *
 * @param {ReturnType<typeof buildProfile>} segments
 * @param {number} x
 * @param {'amplitude'|'cruise'} key
 * @param {number} fallback
 */
export function valueAt(segments, x, key, fallback = 0) {
  if (!segments.length) return fallback;

  const seg = segments[0];
  const segLen = seg.to - seg.from;
  const idx = Math.floor(x / segLen);
  if (idx < 0) return segments[0][key];
  if (idx >= segments.length) return segments[segments.length - 1][key];

  const current = segments[idx];
  const next = segments[idx + 1];
  if (!next) return current[key];

  // Se mezcla sólo en la franja final del tramo.
  const intoSeg = x - current.from;
  const blendStart = segLen - BLEND_METERS;
  if (intoSeg < blendStart) return current[key];
  const t = smoothstep01((intoSeg - blendStart) / BLEND_METERS);
  return current[key] + (next[key] - current[key]) * t;
}

/**
 * Línea de vuelo OBJETIVO: la altura a la que debería pasar el avión.
 *
 * No es una trayectoria física (el avión no la sigue sola: depende del ángulo
 * con que lo lances y de la potencia). Es la referencia con la que se colocan
 * los recolectables y se sesga la puntería, para que apuntar "normal" ponga al
 * avión cerca de las cosas que hay que juntar.
 *
 * ── Por qué depende del terreno ──
 * El relieve del último tramo sube mucho, y una curva puramente geométrica
 * terminaba por DEBAJO del suelo: el margen llegaba a 0.4 m al final del
 * corredor, o sea que los recolectables de ahí quedaban enterrados. El suelo es
 * un dato duro, así que la línea se calcula como el máximo entre la curva
 * deseada y el terreno más un margen.
 *
 * @param {ReturnType<typeof buildProfile>} segments
 * @param {number} x
 * @param {number} courseLength
 * @param {number} [terrainY]  altura del suelo en (x, 0); 0 si no se conoce
 */
export function desiredAltitudeAt(segments, x, courseLength, terrainY = 0) {
  const cruise = valueAt(segments, x, 'cruise', ALTITUDE.CRUISE);

  /*
   * Arco: apenas sube al principio, tiene su pico alrededor del 65% del corredor
   * y baja al final.
   *
   * El exponente y el techo están calibrados para que la línea se mantenga baja
   * y navegable: con el pico más marcado, el último tramo terminaba exigiéndole
   * al avión una altura que sólo se alcanza gastando todas las propulsiones.
   */
  const t = courseLength > 0 ? Math.min(1, Math.max(0, x / courseLength)) : 0;
  const arc = Math.sin(Math.PI * Math.pow(t, 0.85));

  const curve = ALTITUDE.CRUISE + (cruise - ALTITUDE.CRUISE) * (0.45 + arc * 0.55);

  // El suelo manda cuando está más alto que la curva.
  return Math.max(
    ALTITUDE.GROUND + 4,
    curve,
    terrainY + ALTITUDE.TERRAIN_CLEARANCE,
  );
}

/**
 * Ángulo de salida que apunta a la línea objetivo, dado un alcance esperado.
 *
 * Sirve para que la puntería NEUTRA (sin arrastrar nada) apunte a la línea del
 * primer tramo. Sin esto el jugador tendría que averiguar a mano que en el
 * primer tramo hay que lanzar más rasante que en el último.
 *
 * @param {ReturnType<typeof buildProfile>} segments
 * @param {number} x  distancia a la que se quiere llegar
 * @param {number} range distancia que vuela ese lanzamiento
 */
export function aimPitchFor(segments, x, range) {
  const target = desiredAltitudeAt(segments, x, range);
  const rise = target - ALTITUDE.GROUND;
  // Relación geométrica simple: cuánto hay que subir para llegar a esa altura
  // en la distancia disponible. Es una aproximación, y está bien que lo sea:
  // sólo tiene que acercar la puntería neutra al tramo correcto.
  const slope = rise / Math.max(1, x);
  return (Math.atan(slope) * 180) / Math.PI;
}
