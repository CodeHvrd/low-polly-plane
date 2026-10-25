/**
 * PAPERCRASH — physics/flightModel.js
 * ============================================================
 * NÚCLEO DE FÍSICA. Único lugar del proyecto donde se integra el vuelo.
 *
 * Se usa para dos cosas que DEBEN coincidir exactamente:
 *   1. El vuelo real (simulación paso a paso).
 *   2. La previsualización de trayectoria (misma ecuación, otro dt).
 *
 * Que exista una sola implementación es lo que garantiza que la línea
 * punteada que ve el jugador sea de verdad la trayectoria del avión.
 * Antes había dos copias divergentes y la vista previa mentía.
 *
 * Estabilidad numérica:
 *   La fuerza aerodinámica es cuadrática en la velocidad, así que un paso
 *   fijo de Euler se vuelve inestable y "explota" a alta velocidad. Por eso
 *   se subdivide el paso para que la velocidad relativa cambie poco en cada
 *   sub-paso (criterio tipo CFL):
 *
 *       a·dt ≤ CFL·v      →      dt ≤ CFL / (max(CL,CD)·v)
 *
 *   Con los coeficientes actuales esto implica ~2-3 sub-pasos por frame a
 *   velocidad normal, y como mucho ~10 en el peor caso.
 * ============================================================
 */
import { GRAVITY, SIM, FLIGHT_CONTROLS, PROPULSION, AIM } from '../config.js';
import { MODE } from '../modes/index.js';
import { clamp, degToRad } from '../core/math.js';

/**
 * @typedef {Object} Vec3Like
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * @typedef {Object} FlightParams
 * @property {number} cl       Coeficiente de sustentación efectivo
 * @property {number} cd       Coeficiente de resistencia efectivo
 * @property {number} liftCap  Tope de aceleración de sustentación (m/s²)
 * @property {number} windX    Viento longitudinal (m/s), +X
 * @property {number} windZ    Viento lateral (m/s), +Z
 */

/**
 * @typedef {Object} FlightState
 * @property {number} x @property {number} y @property {number} z
 * @property {number} vx @property {number} vy @property {number} vz
 * @property {number} time
 * @property {number} maxAltitude
 * @property {number} maxSpeed
 * @property {boolean} landed
 */

/**
 * Estado de vuelo nuevo en la posición de lanzamiento.
 * @param {number} y0
 * @returns {FlightState}
 */
export function createState(y0) {
  return {
    x: 0,
    y: y0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    time: 0,
    maxAltitude: y0,
    maxSpeed: 0,
    landed: false,
    /**
     * Segundos de planeo que le quedan al avión.
     *
     * Es el RECURSO del juego: se gasta mientras el avión desciende y lo
     * recargan los boosters (`addGlideBudget`). Cuando llega a cero el avión
     * deja de planear y cae, así que la distancia depende de recolectar
     * boosters y no del ángulo de salida.
     */
    glideBudget: 0,
    /** Empuje de propulsión activo (m/s²) y segundos que le quedan. */
    burn: 0,
    burnTime: 0,
    /**
     * Mandos del jugador, en [-1, 1].
     *
     * `steer`  : + derecha, - izquierda (A/D)
     * `nose`   : + arriba, - abajo (W/S)
     *
     * Viven en el estado y no en los params porque son entradas del jugador, no
     * propiedades del avión: cambian en cada frame.
     */
    steer: 0,
    nose: 0,
    /** Velocidad lateral actual (m/s), para amortiguar al soltar la tecla. */
    lateralVel: 0,
  };
}

/**
 * Convierte pitch/azimut/potencia en el vector velocidad inicial.
 *
 * @param {number} pitchDeg  Ángulo de salida sobre la horizontal
 * @param {number} azimuthDeg Ángulo lateral (+ = hacia +Z)
 * @param {number} speed     Rapidez inicial (m/s)
 * @param {{x:number,y:number,z:number}} out objeto reutilizable
 */
export function velocityFromAim(pitchDeg, azimuthDeg, speed, out) {
  const pitch = degToRad(pitchDeg);
  const az = degToRad(azimuthDeg);
  const horizontal = speed * Math.cos(pitch);
  out.x = horizontal * Math.cos(az);
  out.y = speed * Math.sin(pitch);
  out.z = horizontal * Math.sin(az);
  return out;
}

/** Copia el estado de vuelo (para snapshots / replay). */
export function cloneState(s) {
  return { ...s };
}

/**
 * Recarga el presupuesto de planeo, sin pasar del tope.
 *
 * Lo llaman los boosters al recogerse y la propulsión al usarse. Es la forma en
 * que el jugador "compra" tiempo de vuelo, en vez de apuntando alto.
 *
 * @param {FlightState} s
 * @param {number} seconds
 * @param {number} max
 * @returns {number} presupuesto resultante
 */
export function addGlideBudget(s, seconds, max = Infinity) {
  s.glideBudget = Math.min(max, s.glideBudget + seconds);
  return s.glideBudget;
}

/**
 * Enciende una propulsión.
 *
 * @param {FlightState} s
 * @param {number} accel   aceleración del empuje (m/s²)
 * @param {number} seconds duración (s)
 * @param {number} [climbKick]  empujón vertical extra (m/s)
 */
export function applyBoost(s, accel, seconds, climbKick = 0) {
  // Si ya había un empuje en curso se toma el más fuerte en vez de sumarlos:
  // encadenar propulsiones no debe multiplicar la aceleración sin control.
  s.burn = Math.max(s.burn, accel);
  s.burnTime = Math.max(s.burnTime, seconds);

  /*
   * Empujón hacia arriba.
   *
   * Es el pedido: propulsar CON el morro arriba da un envión vertical, y después
   * el avión sigue planeando con la velocidad que traía. Se suma a `vy` una sola
   * vez —es un impulso, no una fuerza sostenida— y se acota para que no dispare
   * al avión fuera de la pantalla.
   */
  if (climbKick > 0) {
    s.vy = Math.min(PROPULSION.CLIMB_KICK_MAX_VY, s.vy + climbKick);
  }
  return s;
}

/**
 * Aplica los mandos del jugador al estado.
 *
 * Se separa de `integrateSubstep` para que el controlador pueda fijarlos una vez
 * por frame sin que la física tenga que conocer el teclado.
 *
 * @param {FlightState} s
 * @param {number} steer  -1 izquierda .. +1 derecha
 * @param {number} nose   -1 morro abajo .. +1 morro arriba
 */
export function setControls(s, steer, nose) {
  s.steer = Math.max(-1, Math.min(1, steer || 0));
  s.nose = Math.max(-1, Math.min(1, nose || 0));
  return s;
}

/**
 * Deriva los coeficientes de aceleración y el tope de sustentación
 * a partir de la ficha de la aeronave y los multiplicadores de mejoras.
 *
 * @param {import('./specs.js').FlightSpec} spec
 * @param {{liftMult?:number, dragMult?:number}} [mods]
 * @returns {FlightParams}
 */
export function paramsFromSpec(spec, mods = {}) {
  const liftMult = mods.liftMult ?? 1;
  const dragMult = mods.dragMult ?? 1;
  return {
    cl: spec.cl * liftMult,
    cd: spec.cd * dragMult,
    liftCap: spec.liftCapG * -GRAVITY,
    /*
     * Cuánto la afecta el viento. Un avión de papel lo lleva el triple que un
     * avión de pasajeros: es la diferencia más fácil de SENTIR entre naves y no
     * cuesta nada de modelar.
     */
    windFactor: spec.windFactor ?? 1,
    /** Por debajo de esta velocidad pierde sustentación (m/s). */
    stallSpeed: spec.stallSpeed ?? 0,
    /*
     * ── Multiplicador de los mandos, con TOPE SUAVE ──
     *
     * ── Los dos bugs que esto arregla ──
     *
     * 1. `stabilityMult` se calculaba en state.js pero NO se usaba en ningún lado:
     *    la mejora "Estabilizadores" no hacía absolutamente nada.
     *
     * 2. La autoridad de los mandos crecía sin techo. Sumando nave + modo +
     *    mejoras, la respuesta se volvía vertiginosa: el avión cambiaba de
     *    dirección tan rápido que no se podía dosificar.
     *
     * ── Qué hace la estabilidad ──
     * AMORTIGUA: más estabilidad, menos nervioso. Es lo que dice su descripción
     * ("el morro sigue la trayectoria con más firmeza") y lo que el jugador espera
     * al comprarla.
     *
     * ── Por qué un tope SUAVE y no un clamp ──
     * Un `Math.min` produciría un salto: a partir de cierto nivel, seguir mejorando
     * dejaría de notarse de golpe. La curva mantiene la mejora perceptible hasta la
     * rodilla y después la vuelve asintótica, así que nunca se vuelve ingobernable
     * pero tampoco se congela.
     */
    /** Multiplicador de agilidad lateral (mejora "Alerones"). */
    lateral: mods.lateralMult ?? 1,
    control: (() => {
      /*
       * El efecto de la estabilidad se aplica al 55% y no al 100%.
       *
       * Al máximo (nivel 6 = ×2.5) dividir entero dejaba el avión de papel en 1.30
       * de autoridad: pasaba de nervioso a lento, y el jugador que compró la mejora
       * la sentiría como un castigo. Con el 55% queda en ~1.73: se nota claramente
       * más firme, pero sigue siendo pilotable.
       */
      const amortiguacion = 1 + ((mods.stabilityMult ?? 1) - 1) * 0.55;
      const bruto = ((spec.control ?? 1) * FLIGHT_CONTROLS.SCALE) / amortiguacion;
      const rodilla = FLIGHT_CONTROLS.CONTROL_KNEE;
      const tope = FLIGHT_CONTROLS.CONTROL_MAX;
      if (bruto <= rodilla) return bruto;
      return rodilla + (tope - rodilla) * (1 - Math.exp(-(bruto - rodilla) / (tope - rodilla)));
    })(),
    // Planeo: referencia de velocidad de descenso (m/s) y cuánta resistencia
    // extra aparece al bajar. Ver `integrateSubstep`.
    glideSink: spec.glideSink ?? 0,
    // La resistencia de descenso la escala el MODO: ver `modes/*.js`.
    glideDrag: (spec.glideDrag ?? 0) * (MODE.motion.glideDragScale ?? 1),
    /*
     * ── Multiplicadores del MODO ──
     *
     * Se copian a los params (y no se leen de MODE en cada sub-paso) porque la
     * física corre cientos de veces por frame: leer cuatro getters en el bucle
     * interno es trabajo regalado. El coste es que un cambio de modo necesita
     * reconstruir los params, y eso ya pasa al empezar cada vuelo.
     */
    gravityScale: MODE.motion.gravityScale,
    dragScale: MODE.motion.dragScale,
    arcLift: MODE.motion.arcLift,
    /** Tope de altura del modo (m). Ver `integrateSubstep`. */
    ceiling: AIM.CEILING,
    windX: 0,
    windZ: 0,
  };
}

/**
 * Cantidad de sub-pasos necesarios para integrar `dt` con estabilidad.
 * @param {FlightParams} p
 * @param {number} speed
 * @param {number} dt
 */
export function substepsFor(p, speed, dt) {
  const kMax = Math.max(p.cl, p.cd);
  if (!(speed > 0) || kMax <= 0) return 1;
  const n = Math.ceil((kMax * speed * speed * dt) / SIM.CFL);
  return clamp(n, 1, SIM.MAX_SUBSTEPS);
}

/**
 * Aplica el viento. Se modela como una aceleración de arrastre relativa:
 * el viento "empuja" al avión hacia su propia velocidad, escalado por la
 * resistencia (más resistencia = más te lleva el viento).
 */
function applyWind(p, s, h) {
  if (p.windX === 0 && p.windZ === 0) return;
  const speed2 = s.vx * s.vx + s.vy * s.vy + s.vz * s.vz;
  // El factor de la ficha multiplica el efecto: liviano = lo lleva el viento.
  const scale = Math.min(1, p.cd * speed2) * h * p.windFactor;
  s.vx += p.windX * scale;
  s.vz += p.windZ * scale;
}

/**
 * Integra un sub-paso con Euler semi-implícito:
 * primero se actualiza la velocidad y después la posición.
 * Es mucho más estable que el Euler explícito para fuerzas cuadráticas.
 *
 * @param {FlightState} s
 * @param {FlightParams} p
 * @param {number} h  sub-paso (s)
 */
/** Autoridad mínima del morro cuando no queda planeo (0..1). */
const CLIMB_MIN_AUTHORITY = FLIGHT_CONTROLS.CLIMB_MIN_AUTHORITY;
/** Planeo (s) con el que el morro recupera autoridad plena. */
const CLIMB_FULL_AUTHORITY = Math.max(0.1, FLIGHT_CONTROLS.CLIMB_FULL_AUTHORITY);

/**
 * Tope de la MAGNITUD del ratio vy/glideSink en la resistencia de descenso.
 *
 * Ver el bloque de `cd` en `integrateSubstep`: sin tope, un picado fuerte daba
 * factores de resistencia de cientos y el avión se frenaba al bajar el morro.
 */
const GLIDE_DRAG_MAX_RATIO = 2.5;

export function integrateSubstep(s, p, h) {
  const speed = Math.hypot(s.vx, s.vy, s.vz);

  /*
   * ── Presupuesto de planeo: se gasta por ENERGÍA, no por tiempo de descenso ──
   *
   * ── El bug que esto arregla ──
   * Antes el presupuesto se descontaba sólo si `vy < 0`, es decir mientras el
   * avión bajaba POR GRAVEDAD. Pero el control de morro (W) empuja la velocidad
   * vertical DIRECTAMENTE y no pasaba por el presupuesto: mantener W, o
   * bombearlo, subía el avión y el planeo no se gastaba nunca. Se podían volar
   * cientos de metros con el marcador congelado.
   *
   * ── La regla nueva ──
   * Sostener el avión cuesta planeo, suba o baje. El costo es proporcional a la
   * sustentación que se está pidiendo: un planeo normal cuesta ~1×, y forzar al
   * avión a subir contra la gravedad cuesta más, porque hay que GANAR energía y
   * no sólo no perderla. Así el planeo se comporta como la energía que
   * realmente es, y ninguna combinación de teclas lo esquiva.
   */
  let gliding = false;
  if (s.glideBudget > 0) {
    const sinkRef = p.glideSink > 0 ? p.glideSink : 1.2;
    /*
     * Esfuerzo: cuánta sustentación se está pidiendo respecto de un planeo.
     *
     *   vy = -sinkRef (planeo normal)   -> esfuerzo 2 -> extra 0 -> costo 1
     *   vy = 0        (vuelo nivelado)  -> esfuerzo 1 -> extra 0 -> costo 1
     *   vy = +sinkRef (subiendo fuerte) -> esfuerzo 0 -> extra 1 -> costo 1 + CLIMB_COST
     *
     * ── Las DOS acotaciones son necesarias ──
     * `Math.min(2, ...)` limita por arriba (picar mucho no abarata: el costo
     * tiene piso 1) y `Math.max(0, ...)` limita por abajo (subir mucho no
     * encarece sin techo).
     *
     * ── El bug que causaba el tope inferior faltante ──
     * Sin el `max(0, ...)`, subir a 12 m/s daba esfuerzo -9.21 y `extra` 10.21,
     * o sea un costo de 13x. El planeo se vaciaba en 0.2 s en vez de durar 2.2 s:
     * exactamente el "la duración de planeo baja abruptamente" reportado.
     */
    const esfuerzo = Math.max(0, Math.min(2, 1 - s.vy / sinkRef));
    const extra = Math.max(0, 1 - esfuerzo);
    s.glideBudget = Math.max(0, s.glideBudget - (1 + extra * FLIGHT_CONTROLS.CLIMB_COST) * h);
    gliding = true;
  }

  if (speed > 1e-6) {
    const vxn = s.vx / speed;
    const vyn = s.vy / speed;
    const vzn = s.vz / speed;

    // Sustentación: perpendicular a la velocidad, en el plano vertical (XY).
    // Para vuelo horizontal (vyn = 0) queda (0, +1): apunta hacia arriba.
    const lx = -vyn;
    const ly = vxn;

    /*
     * Resistencia extra mientras el avión DESCIENDE.
     *
     * Sin esto, la altura que gana un lanzamiento arqueado se convierte en
     * distancia gratis: el avión sube mucho, planea mucho tiempo y termina
     * llegando más lejos que un tiro rasante. Pero la idea del juego es que el
     * RASANTE sea el que maximiza distancia, y que el arco sirva para pasar por
     * arriba de los obstáculos, no para ganar alcance.
     *
     * Físicamente es razonable: en el descenso el avión frena la caída con
     * sustentación, y esa sustentación viene con resistencia inducida, que crece
     * con lo rápido que baja. Así la energía potencial no se cobra entera.
     *
     * Crece con (vy/sink)²: en un descenso suave casi no se nota, y en una
     * bajada fuerte domina.
     *
     * ── El tope del ratio ──
     * El crecimiento cuadrático es correcto para un planeo, pero se dispara en un
     * PICADO: a 18 m/s de descenso con un sink de 1.2, el ratio es 15 y el factor
     * queda en 1 + 1.5·225 = 338. Con esa resistencia el avión se frena muchísimo,
     * y era la causa de que bajar el morro con S costara velocidad —justo lo
     * contrario de lo que se pide—.
     *
     * Acotando la MAGNITUD del ratio a 2.5 el factor llega como máximo a
     * 1 + 1.5·6.25 = 10.4: sigue siendo una resistencia de picado muy fuerte
     * (comparable a la de un freno aerodinámico) pero deja de ser infinita.
     *
     * Se acota el valor absoluto y no el valor: `vy` es NEGATIVO al bajar (este
     * bloque sólo corre con `vy < 0`), así que un `Math.min` directo no acotaba
     * nada —-15 sigue siendo menor que 2.5— y el tope no tenía efecto.
     */
    let cd = p.cd;
    if (p.glideDrag > 0 && p.glideSink > 0 && s.vy < 0) {
      /*
       * ── Con el morro abajo, la resistencia de picado se reduce mucho ──
       *
       * ── El problema que esto arregla ──
       * Se reportó que la flecha de bajar "te hace caer en el lugar en vez de
       * respetar la velocidad que traés". Medido: picando desde 60 m/s el avión
       * quedaba en ~28 m/s de avance y sólo recorría 44 m en 2 s, contra 108 m de
       * planeo normal. El culpable era este factor: la resistencia de descenso
       * multiplica `cd` por hasta 10.4 y se come la velocidad.
       *
       * Físicamente una picada ACELERA: la altura se convierte en velocidad. Con
       * el jugador pidiendo descender, la resistencia inducida no debería dominar.
       *
       * Se acota a un tercio del tope normal: sigue habiendo resistencia (picar no
       * es gratis) pero deja de borrar la velocidad que el avión traía.
       */
      const topeRatio = s.nose < 0 ? GLIDE_DRAG_MAX_RATIO / 3 : GLIDE_DRAG_MAX_RATIO;
      const ratio = clamp(s.vy / p.glideSink, -topeRatio, 0);
      cd *= 1 + p.glideDrag * ratio * ratio;
    }

    const aLift = Math.min(p.liftCap, p.cl * speed * speed);
    /*
     * La resistencia la escala el MODO: el frenético la baja, así que el avión
     * conserva la velocidad y hay que corregir con los mandos en vez de esperar
     * a que se frene solo. El clásico la deja en 1.
     */
    const aDrag = cd * speed * speed * p.dragScale;

    s.vx += (lx * aLift - vxn * aDrag) * h;
    s.vy += (GRAVITY * p.gravityScale + ly * aLift - vyn * aDrag) * h;
    s.vz += -vzn * aDrag * h;
  } else {
    s.vy += GRAVITY * p.gravityScale * h;
  }

  /*
   * Mandos del jugador.
   *
   * ── Lateral (A/D) ──
   * Empuje perpendicular al rumbo, en el plano horizontal. Se aplica como
   * ACELERACIÓN y no como velocidad directa: así el avión tiene inercia y
   * corregir la línea se siente como pilotar, no como teletransportarse de lado.
   * Al soltar la tecla se amortigua, así que el avión sigue derivando un poco.
   *
   * ── Morro (W/S) ──
   * Empuje vertical. Arriba es más débil que la gravedad a propósito: mantener W
   * hace subir al avión pero no lo sostiene, así que sigue siendo un planeo y no
   * un helicóptero. Abajo sí puede ser más fuerte, porque picar es gratis.
   */
  if (s.steer !== 0) {
    // Perpendicular horizontal al rumbo: (-vz, 0, vx) normalizado.
    const hLen = Math.hypot(s.vx, s.vz);
    let px;
    let pz;
    if (hLen > 1e-4) {
      px = -s.vz / hLen;
      pz = s.vx / hLen;
    } else {
      // Sin rumbo horizontal (caída vertical): "derecha" es +Z.
      px = 0;
      pz = 1;
    }
    /*
     * ── La mejora sube la RESPUESTA, pero no en forma lineal ──
     *
     * Con el multiplicador entero, Alerones nivel 3 ya duplicaba la aceleración
     * lateral y el avión se iba de golpe: inmanejable a alta velocidad.
     *
     * Se aplica el 55% de la mejora sobre la respuesta. Sigue notándose (la
     * corrección llega antes) sin que el avión salte de carril.
     */
    const respuestaLateral = 1 + ((p.lateral ?? 1) - 1) * 0.55;
    s.lateralVel += s.steer * FLIGHT_CONTROLS.LATERAL_ACCEL * p.control * respuestaLateral * h;

    /*
     * ── El tope lateral ESCALA con la velocidad de avance ──
     *
     * ── El problema que resuelve ──
     * El tope estaba FIJO en 34 m/s. Eso significa que la capacidad de esquivar
     * dependía de la velocidad: a 40 m/s el avión se movía 34 m de costado por
     * cada 40 m de avance (ratio 0.85), pero a 65 m/s el mismo tope da 0.52. O sea
     * que cuanto más rápido ibas, MÁS ANGOSTO se volvía el corredor en tiempo
     * útil, y con la nave al máximo era imposible esquivar rocas seguidas.
     *
     * ── La solución ──
     * El tope pasa a ser proporcional a la velocidad horizontal, así que el RATIO
     * de giro se mantiene constante sin importar lo rápido que vayas. Acotado por
     * arriba para que a velocidades absurdas no se vuelva un teletransporte.
     */
    /*
     * ── El tope crece poco, y con techo ──
     *
     * ── El problema que esto arregla ──
     * El tope escalaba LINEAL con la mejora: nivel 1.9x, nivel 3 1.9x, nivel 6
     * 2.8x. Medido a 70 m/s, el nivel 3 permitía 15.7 m de desvío por cada 10 m de
     * avance: más de metro y medio de costado por metro avanzado. El avión cruzaba
     * el corredor de lado y resultaba imposible de manejar.
     *
     * Ahora la mejora aporta sólo el 18% de su exceso al tope. Nivel 3 queda en
     * ~10 m por 10 m (contra 8.3 sin mejora) y nivel 6 en ~11.5: se nota y se
     * agradece, pero el avión sigue volando hacia adelante.
     */
    const ratio = Math.min(
      1.15,
      FLIGHT_CONTROLS.LATERAL_RATIO * (1 + ((p.lateral ?? 1) - 1) * 0.22),
    );
    const topeLateral = Math.min(
      FLIGHT_CONTROLS.LATERAL_MAX_MAX,
      Math.max(FLIGHT_CONTROLS.LATERAL_MAX_MIN, hLen * ratio),
    );
    s.lateralVel = Math.max(-topeLateral, Math.min(topeLateral, s.lateralVel));
    s.vx += px * s.lateralVel * h;
    s.vz += pz * s.lateralVel * h;
  } else if (s.lateralVel !== 0) {
    // Amortiguación exponencial: independiente de los FPS.
    s.lateralVel *= Math.exp(-FLIGHT_CONTROLS.LATERAL_DAMP * h);
    if (Math.abs(s.lateralVel) < 0.05) s.lateralVel = 0;
  }

  if (s.nose > 0) {
    /*
     * ── Subir el morro GASTA planeo, y sin planeo no sube ──
     *
     * ── El bug que esto arregla ──
     * El control de morro empujaba `vy` directamente, sin pasar por el
     * presupuesto. Con el avión de papel y sin planeo restante, mantener W lo
     * hacía subir igual: el avión trepaba con el marcador en cero, y bombear W
     * permitía viajar cientos de metros sin gastar nada. La causa de fondo es
     * que el único límite de ascenso era el tope de velocidad vertical, y el
     * tope de planeo sólo frena el DESCENSO (`vy = max(vy, -glideSink)`), así que
     * subir nunca estaba limitado por nada.
     *
     * ── Cómo se limita ahora ──
     * La autoridad del morro se escala con el planeo que queda. Con presupuesto
     * lleno el avión sube como siempre; con el presupuesto agotado el control no
     * tiene autoridad y la gravedad gana. El `piso` evita que el control quede
     * muerto de golpe en los últimos segundos, que se sentiría como un fallo.
     */
    const margen = CLIMB_MIN_AUTHORITY
      + (1 - CLIMB_MIN_AUTHORITY) * Math.min(1, s.glideBudget / CLIMB_FULL_AUTHORITY);
    /*
     * ── El tope sube si hay propulsión activa ──
     *
     * ── El bug que esto arregla ──
     * Se reportó que ▲ + booster no hace nada. El motivo: el booster ya deja
     * `vy` en NOSE_UP_MAX_VY, así que la flecha arriba encontraba el tope y no
     * sumaba nada. Con el margen extra la flecha sigue teniendo efecto durante
     * la propulsión, que es justo cuando el jugador la aprieta.
     */
    const topeVy = FLIGHT_CONTROLS.NOSE_UP_MAX_VY + (s.burnTime > 0 ? FLIGHT_CONTROLS.NOSE_UP_BOOST_EXTRA : 0);
    if (s.vy < topeVy) {
      s.vy = Math.min(
        topeVy,
        s.vy + s.nose * margen * FLIGHT_CONTROLS.NOSE_UP_ACCEL * p.control * h,
      );
    }
  } else if (s.nose < 0) {
    /*
     * ── Bajar el morro ROTA la velocidad, no la aumenta ──
     *
     * ── El problema que esto arregla ──
     * Antes el morro abajo SUMABA velocidad vertical: `vy -= fuerza`. Eso hacía
     * que el módulo de la velocidad creciera, y como la resistencia va con v², el
     * avión perdía velocidad al picar. Se pidió que la caída de velocidad con S
     * sea IGUAL que sin tocar nada, y con un empuje vertical eso es imposible:
     * cualquier fuerza que no sea perpendicular al rumbo cambia el módulo.
     *
     * ── La solución ──
     * Se ROTA el vector velocidad hacia abajo sin cambiar su módulo. Es lo que
     * hace un timón de profundidad de verdad: redirige el rumbo, no agrega
     * energía. El avión baja y conserva la velocidad que traía.
     *
     * La rotación se aplica en el plano vertical (XY). Se usa el ángulo que
     * corresponde a la aceleración pedida, así el mando sigue sintiéndose igual
     * de sensible y respetando `control` por nave.
     */
    const v = Math.hypot(s.vx, s.vy, s.vz);
    const horiz = Math.hypot(s.vx, s.vz);
    if (v > 1e-4 && horiz > 1e-4) {
      // Ángulo a rotar: el que produciría la aceleración pedida en este paso.
      const giro = (s.nose * FLIGHT_CONTROLS.NOSE_DOWN_ACCEL * p.control * h) / v;
      const cos = Math.cos(giro);
      const sin = Math.sin(giro);
      // Rotación en el plano (horizontal, vertical) sin tocar el módulo.
      const hx = horiz;
      const nuevoH = hx * cos - s.vy * sin;
      const nuevoV = hx * sin + s.vy * cos;
      // Se reescala el componente horizontal conservando su dirección en XZ.
      const k = nuevoH / hx;
      s.vx *= k;
      s.vz *= k;
      s.vy = nuevoV;

      /*
       * ── La picada GANA velocidad ──
       *
       * La rotación conserva el módulo, así que picar sólo repartía la velocidad
       * entre avance y caída: el avance bajaba y la sensación era de frenar.
       *
       * La altura que se pierde se convierte en velocidad, que es lo que hace un
       * avión de verdad al picar. Se aplica SOBRE EL VECTOR y con tope, para que no
       * rompa el límite de velocidad de la nave.
       */
      const rapidez = Math.hypot(s.vx, s.vy, s.vz);
      const tope = p.maxSpeed > 0 ? p.maxSpeed : Infinity;
      if (rapidez > 1e-4 && rapidez < tope) {
        const suma = Math.min(FLIGHT_CONTROLS.DIVE_GAIN * p.control * h, tope - rapidez);
        s.vx += (s.vx / rapidez) * suma;
        s.vy += (s.vy / rapidez) * suma;
        s.vz += (s.vz / rapidez) * suma;
      }
    } else {
      // Sin rumbo definido (caída vertical): no hay nada que rotar.
      s.vy += s.nose * FLIGHT_CONTROLS.NOSE_DOWN_ACCEL * p.control * h;
    }
  }

  /*
   * ── Pérdida de sustentación ──
   *
   * Por debajo de su velocidad de pérdida, el avión deja de sostener: la
   * sustentación disponible cae en picada y el morro se va hacia abajo.
   *
   * Es lo que hace que el jet sea "rápido pero difícil": vuela rapidísimo, pero
   * si el jugador lo frena subiendo el morro, se le cae. El helicóptero, con su
   * velocidad de pérdida bajísima, es el que perdona.
   */
  if (p.stallSpeed > 0) {
    const v = Math.hypot(s.vx, s.vy, s.vz);
    if (v < p.stallSpeed) {
      // Cuanto más por debajo, más fuerte la pérdida.
      const t = 1 - v / p.stallSpeed;
      s.vy -= t * t * 9 * h;
      // Y el morro se cae solo, que es lo que se siente al perder sustentación.
      s.vy -= t * 4 * h;
    }
  }

  /*
   * Propulsión: acelera en la dirección de vuelo (o hacia adelante si el avión
   * todavía no tiene rumbo). Se consume con el tiempo.
   *
   * Se aplica como aceleración sostenida y no como salto instantáneo de
   * velocidad para que el empuje se sienta como un motor y no como un
   * teletransporte.
   */
  if (s.burnTime > 0 && s.burn > 0) {
    const dt = Math.min(h, s.burnTime);
    if (speed > 1e-6) {
      s.vx += (s.vx / speed) * s.burn * dt;
      s.vy += (s.vy / speed) * s.burn * dt;
      s.vz += (s.vz / speed) * s.burn * dt;
    } else {
      s.vx += s.burn * dt;
    }
    s.burnTime = Math.max(0, s.burnTime - dt);
    if (s.burnTime === 0) s.burn = 0;
  }

  // Planeo: se limita el descenso, entre el bloque de fuerzas y el avance.
  //
  // El orden importa: va DESPUÉS de los mandos y la propulsión, así que subir el
  // morro o propulsar pueden sacar al avión del descenso y el límite deja de
  // aplicarse solo. Y va ANTES de integrar la posición, que es donde tiene que
  // actuar para que el planeo se note en el avance.
  //
  // ── Por qué el tope NO se aplica con el morro abajo ──
  //
  // ── El bug que esto arregla ──
  // Picar costaba DOS VECES. Primero la rotación del morro abajo convierte avance
  // en caída: `vx` baja. Y enseguida este tope devolvía la caída a `glideSink`, así
  // que la velocidad vertical ganada se descartaba. Resultado: el avión perdía
  // avance y no lo recuperaba en ningún lado, y en vez de picar y acelerar se
  // quedaba cayendo "en el lugar".
  //
  // Con el morro abajo el jugador pide explícitamente descender: el tope de planeo
  // no tiene nada que hacer ahí. Picar es una DECISIÓN con su costo (perder
  // altura), no un castigo que además quite velocidad.
  const picando = s.nose < 0;
  if (gliding && !picando && s.vy < -p.glideSink) s.vy = -p.glideSink;

  /*
   * ── Techo de altura del MODO ──
   *
   * ── Dónde va y por qué ──
   * Va AL FINAL, después de los mandos y de la propulsión, porque es el último
   * que puede tocar `vy`. La versión anterior estaba ANTES del control de morro,
   * así que el jugador podía mantener W y el morro volvía a subir la velocidad
   * vertical después del freno: medido, el avión llegaba a 181 m con un techo de
   * 50. El techo no existía en la práctica.
   *
   * ── Cómo funciona, sin ser una pared ──
   * No es un límite de posición (eso se vería como chocar contra un vidrio
   * invisible). Es un TECHO DE ASCENSO: por encima de la altura límite la
   * velocidad vertical nunca puede ser positiva, así que el avión puede quedarse
   * volando ahí arriba todo lo que quiera —y de hecho se ve bien, se ve el
   * paisaje desde arriba— pero no puede trepar ni un metro más.
   *
   * El exceso se corrige con una fuerza suave hacia abajo para que un avión que
   * llegue lanzado no se quede pegado al techo, sino que se asiente.
   */
  if (p.ceiling > 0 && s.y > p.ceiling) {
    /*
     * ── El techo CORRIGE, no pega ──
     *
     * ── El bug que esto arregla ──
     * Antes se hacía `s.vy = 0`, y eso dejaba al avión CLAVADO: con la velocidad
     * vertical en cero exacto, ningún mando lo bajaba de ahí —el morro hacia
     * abajo no tenía velocidad que rotar— y el planeo casi no se drenaba. Medido,
     * las tres naves quedaban en 35.0 m con `vy = -0.00` durante 20 s.
     *
     * Peor: como los boosters vuelan más abajo que el techo, el avión quedaba
     * atrapado arriba sin poder alcanzarlos. Era el "a partir de los 3 km dejan
     * de haber boosters": seguían estando, pero no se podía bajar a buscarlos.
     *
     * Ahora se le quita sólo la componente hacia arriba y se lo empuja hacia
     * abajo con suavidad, así que el avión sigue volando y puede picar para
     * descender cuando quiera.
     */
    if (s.vy > 0) s.vy = 0;

    /*
     * ── El empuje tiene que GANARLE a la sustentación ──
     *
     * Con 2 m/s² no alcanzaba: a 29 m/s el morro arriba genera ~18 m/s² de
     * sustentación, que se come cualquier empuje chico y vuelve a clavar el avión
     * contra el tope. Medido, seguía en `vy = -0.02` después de 20 s.
     *
     * El empuje crece hasta 25 m/s² apenas se pasa del techo, así que insistir con
     * el morro arriba pasa a hacer PERDER altura: el avión rebota en el tope en vez
     * de apoyarse en él. Eso también le devuelve el riesgo a subir demasiado.
     */
    const exceso = Math.min(1, (s.y - p.ceiling) / 4);
    s.vy -= (4 + exceso * 21) * h;

    /*
     * E insistir contra el techo CUESTA planeo.
     *
     * Sin esto se podía mantener el morro arriba indefinidamente pagando sólo el
     * costo de vuelo nivelado, así que el tope era un lugar cómodo donde quedarse
     * en vez de un límite que obliga a bajar.
     */
    s.glideBudget = Math.max(0, s.glideBudget - exceso * 3 * h);
    gliding = true;
  }

  applyWind(p, s, h);

  s.x += s.vx * h;
  s.y += s.vy * h;
  s.z += s.vz * h;
  s.time += h;

  if (s.y > s.maxAltitude) s.maxAltitude = s.y;
  const sp = Math.hypot(s.vx, s.vy, s.vz);
  if (sp > s.maxSpeed) s.maxSpeed = sp;
}

/**
 * Avanza el vuelo `dt` segundos, subdividiendo según estabilidad.
 * Muta `s`.
 *
 * @param {FlightState} s
 * @param {FlightParams} p
 * @param {number} dt
 * @returns {number} sub-pasos efectivamente usados
 */
export function step(s, p, dt) {
  if (s.landed) return 0;
  const speed = Math.hypot(s.vx, s.vy, s.vz);

  // Red de seguridad: nunca dejamos que la velocidad se escape.
  if (speed > SIM.MAX_SPEED) {
    const f = SIM.MAX_SPEED / speed;
    s.vx *= f;
    s.vy *= f;
    s.vz *= f;
  }

  const n = substepsFor(p, speed, dt);
  const h = dt / n;
  for (let i = 0; i < n; i++) integrateSubstep(s, p, h);
  return n;
}

/**
 * Ángulo de asentamiento visual del morro (radianes).
 * El morro persigue la dirección del vector velocidad; la velocidad de
 * persecución la define la ficha de la aeronave (`pitchRate`), así un jet
 * gira el morro mucho más rápido que un avión de pasajeros.
 *
 * Se separa de la integración para que la parte física quede pura y
 * verificable sin depender de la representación visual.
 */
export function attitudeTarget(state) {
  return Math.atan2(state.vy, Math.hypot(state.vx, state.vz));
}
