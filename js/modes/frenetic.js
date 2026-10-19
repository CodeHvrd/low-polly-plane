/**
 * PAPERCRASH — modes/frenetic.js
 * ============================================================
 * Modo FRENÉTICO: vuelo dirigido, rápido y de reacción.
 *
 * ── En qué se diferencia del clásico ──
 *
 * 1. NO SE APUNTA HACIA ARRIBA. El tope son ~34°, y el tope absoluto de altura
 *    son 100 m. El lanzamiento es de DIRECCIÓN, no de objetivo: se elige por
 *    dónde salir, no a qué altura llegar.
 *
 * 2. NO HAY LÍNEA PUNTEADA. En su lugar van flechas grises translúcidas detrás
 *    de la nave que marcan hacia dónde va. La diferencia no es estética: la
 *    línea dice "por acá vas a pasar", las flechas dicen "por acá vas ahora".
 *    En un modo de reacción esa distinción es la que cambia el juego.
 *
 * 3. LA MOVILIDAD ES LA HERRAMIENTA. Los mandos de A/W/S/D están multiplicados
 *    con fuerza: la curva se corrige en el aire, no antes de salir.
 *
 * 4. BOOSTERS DE DOS TIPOS. El azul empuja en el momento del contacto (no se
 *    guarda, se siente), y el violeta se activa con Space. El azul es el que
 *    hace que volar bien cerca de las cosas tenga premio inmediato.
 *
 * 5. EL VIENTO JUZGA EN CONTRA Y A FAVOR. Empuja hacia abajo y hacia atrás, así
 *    que mantenerse alto y lejos cuesta combustible: la decisión constante es
 *    gastar ahora o aguantar.
 * ============================================================
 */

export const frenetic = {
  id: 'frenetic',
  name: 'Frenético',
  tag: 'Velocidad & Reacción',
  desc: 'Vuelo dirigido a toda velocidad: juntá boosters en el aire y esquivá.',

  // ── Ritmo ────────────────────────────────────────────────
  goal: 'distance',
  camera: 'chase',
  /** Sin línea de previsualización: flechas detrás de la nave. */
  trajectoryLine: 'arrows',

  // ── Apuntado ─────────────────────────────────────────────
  aim: {
    biasOffset: 0,
    /**
     * Rango ANGOSTO y bajo.
     *
     * El pedido es explícito: no se puede lanzar hacia arriba, el tope son
     * ~34°. Con el rango del clásico (18° a 52°) la curva se acentúa demasiado y
     * el avión pasa por encima de los aros y de los recolectables en vez de
     * atravesarlos, que es justo lo que se quiere evitar.
     */
    pitchMin: 12,
    pitchMax: 34,
    /**
     * Tope de altura del modo (m). El vuelo no debe superarlo nunca: si el
     * jugador sube más que esto, el avión entra en pérdida y baja solo.
     */
    /**
     * Tope de altura del modo (m).
     *
     * Bajó de 100 a 50: a 100 m el corredor se veía desde arriba y se perdía la
     * sensación rasante que es la identidad del modo. Con 50 el avión puede
     * remontar para pasar un obstáculo, pero nunca salirse del paisaje.
     */
    ceiling: 35,
    /** El ángulo pesa menos que la dirección: es un modo de rumbo. */
    pitchSensitivity: 0.65,
  },

  // ── Vuelo ────────────────────────────────────────────────
  motion: {
    /**
     * Mandos MUY aumentados. Es la herramienta principal del modo: la curva se
     * corrige volando, no apuntando.
     */
    controlScale: 2.4,
    /**
     * Poco arco: el avión sale llano y se queda llano.
     *
     * No es cero a propósito. Medido, con arco 0 el avión caía a los 84 m y el
     * modo quedaba injugable: el jugador no alcanzaba ni el segundo booster. El
     * arco mínimo le da tiempo a reaccionar sin convertir el modo en un planeo.
     */
    arcLift: 0.7,
    /** Un poco más de gravedad efectiva: obliga a trabajar para mantenerse. */
    gravityScale: 1.15,
    /** Menos resistencia: el modo es de velocidad sostenida. */
    dragScale: 0.78,
    /**
     * Resistencia extra al descender, mucho más baja que en el clásico.
     *
     * ── Por qué 0.33 ──
     * Se pidió que bajar el morro con S cueste la MISMA velocidad que no tocar
     * nada. Medido, con la resistencia del clásico la diferencia era de 1.87 m/s
     * en 1.5 s: al entrar en descenso sostenido el `glideDrag` sube el
     * coeficiente de 0.0024 a 0.0060 y eso frena al avión, justo lo contrario de
     * lo que se espera al picar.
     *
     * Con este factor la diferencia queda en 0.15 m/s (prácticamente nula) y el
     * alcance apenas cambia: 96 -> 101 m. En el frenético el arco no es una
     * opción de diseño —el rango de ángulo es angosto y bajo— así que no hay
     * nada que castigar.
     */
    glideDragScale: 0.33,
  },

  // ── Combustible y planeo ─────────────────────────────────
  fuel: {
    /**
     * 60 segundos de vuelo. ÉSTE es el recurso del modo.
     *
     * Es lo que lo hace de gestión y no sólo de reflejos: cada propulsión cuesta
     * combustible, el viento empuja hacia abajo todo el tiempo, y mantenerse
     * alto y lejos es caro. La decisión constante es gastar ahora o aguantar.
     */
    seconds: 60,
    /**
     * Planeo: NINGUNO.
     *
     * El frenético no se juega planeando. Con 0, el avión cae apenas pierde
     * empuje, y eso es lo que obliga a encadenar boosters azules para
     * mantenerse. El planeo del clásico acá sería una red de seguridad que
     * arruinaría el ritmo.
     */
    /**
     * Planeo mínimo de reacción (s), no un recurso.
     *
     * Medido: con planeo 0 el vuelo duraba 84 m y no se llegaba al segundo
     * booster. Este piso alcanza para reaccionar y apuntar al siguiente, pero no
     * para sostenerse: el que sostiene el vuelo es el booster azul.
     */
    glide: 2.2,
    glideMax: 6,
    /**
     * El violeta repone combustible Y algo de planeo.
     *
     * Con planeo 0 puro, el booster violeta no evitaba la caída: el jugador
     * gastaba una carga y se caía igual porque no quedaba sustentación. Un poco
     * de planeo hace que activarlo sirva para mantenerse.
     */
    glideRefill: 1.0,
    /** Coste de cada propulsión activada, en segundos de combustible. */
    thrustCost: 2.5,
    /** Cuánto combustible repone un booster violeta. */
    fuelRefill: 4.0,
  },

  // ── Obstáculos ───────────────────────────────────────────
  terrain: {
    /** Llanura: el relieve no es el desafío, lo son los obstáculos. */
    amplitude: 0.35,
    /** Árboles por tramo: escasos al principio, tupidos al final. */
    /** Árboles por tramo. Ver la nota de `rocks` sobre la ventana de tramos. */
    trees: 5,
    /**
     * Rocas por tramo: aglomeraciones que bloquean parte del corredor.
     *
     * Son el obstáculo "grande" del modo. Reemplazan a las barreras-bloque, que
     * se pidió sacar por artificiales.
     */
    /**
     * Rocas por tramo.
     *
     * Medido: con 5 grupos de hasta 6 piedras salían 201 rocas y el corredor
     * quedaba en 136 obstáculos por tramo, el triple del clásico. Era una pared
     * continua, no un desafío. Con 3 grupos de 2-4 el tramo queda denso pero
     * navegable, que es lo que se pidió: difícil, con recursos para sortearlo.
     */
    /**
     * Rocas por tramo.
     *
     * Bajó de 3 a 2 al pasar a la ventana de tramos: antes el corredor activo era
     * UN tramo y ahora son seis, así que la misma densidad por tramo significa
     * seis veces más obstáculos en juego. Medido, con 3 la ventana tenía 677
     * obstáculos y los boosters no encontraban hueco libre.
     */
    /**
     * Rocas por tramo.
     *
     * ── La cuenta que importa ──
     * El clásico tiene un obstáculo cada 12.6 m dentro del corredor. Con estos
     * valores el frenético quedaba en 5.7 m: el doble de denso, y el corredor se
     * volvía un muro. La intención es ~1.7x el clásico, o sea uno cada ~7.5 m:
     * más exigente, pero con huecos por los que pasar.
     */
    rocks: 1,
    /**
     * Troncos caídos por tramo.
     *
     * En un bosque es el obstáculo natural por excelencia: alargado, bajo y
     * atraviesa el corredor, así que obliga a subir o a rodearlo. Además da la
     * silueta semicaída que se pidió.
     */
    logs: 1,
    /** Menos aros que el clásico, y atravesables porque la curva es baja. */
    rings: 4,
  },

  // ── Recolectables ────────────────────────────────────────
  items: {
    /**
     * Los tres tipos.
     *   booster  (violeta) : se activa con Space
     *   instant  (azul)    : empuja al tocarlo
     *   emergency (rojo)   : sólo aparece cuando queda poco combustible
     */
    kinds: ['booster', 'instant', 'emergency'],
    /** VARIOS carriles por tramo: varios caminos, como se pidió. */
    lanes: 3,
    /**
     * Más seguidos que en el clásico: el modo es de encadenar.
     *
     * Medido: el avión necesita un booster cada 1-2 s para sostenerse, y a
     * velocidad de crucero eso son ~45 m. Más separados y el vuelo se muere
     * antes de llegar al siguiente.
     */
    boosterSpacing: 45,
    /** Boosters de emergencia por vuelo. */
    /*
     * ── El dorado aparece MUCHO menos ──
     *
     * Bajó de 3 a 1 por vuelo. El dorado repone combustible: es el que rescata un
     * vuelo que se está quedando sin margen, así que tiene que ser un alivio raro
     * y no un recurso que aparezca siempre. Con 3 dejaba de ser una emergencia.
     */
    emergency: 1,
    /** El violeta repone combustible de vuelo, no planeo. */
    glideBonus: 0,
    /** El azul empuja fuerte: se tiene que sentir en el momento. */
    instantStrength: 0.55,
  },

  // ── Propulsión ───────────────────────────────────────────
  propulsion: {
    thrust: 1.0,
    /**
     * Duración del empuje (s).
     *
     * ── Por qué bajó de 1.1 a 0.7 ──
     * El "sprint" (Space+W) se sentía más largo y potente que un booster, que es
     * al revés: el booster es el premio que se junta volando y la propulsión es
     * una habilidad de la nave. Un empuje corto hace que el sprint sea una
     * decisión puntual —cruzar un hueco, remontar— en vez de un modo de vuelo.
     */
    burnTime: 0.7,
    /**
     * Menos cargas que el clásico: acá el violeta es un recurso escaso y el
     * azul es el que da el ritmo.
     */
    maxCharges: 4,
    /**
     * Envión vertical del sprint (m/s).
     *
     * Bajó de 11 a 7.5: con 11 el avión quedaba subiendo seis segundos por
     * inercia, así que el sprint se sentía como un motor encendido y no como un
     * salto. Con 7.5 el envión se agota en ~2 s y después hay que trabajar.
     */
    climbKick: 7.5,
  },
};

