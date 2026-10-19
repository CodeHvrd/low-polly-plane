/**
 * PAPERCRASH — physics/specs.js
 * ============================================================
 * Fichas técnicas de las aeronaves. Fuente única de verdad de la física.
 *
 * ── Diferenciación ──
 * Las cuatro naves tienen que SENTIRSE distintas, y no sólo en la velocidad.
 * Cada una tiene un perfil propio:
 *
 *   Papel      : alcance largo, estabilidad baja, el viento lo lleva.
 *   Pasajeros  : alcance corto, muy estable, inmune al viento, poco maniobrable.
 *   Jet        : el más rápido y el de mayor alcance, pero inestable y difícil
 *                de maniobrar; además pierde sustentación a baja velocidad.
 *   Helicóptero: el más estable y maniobrable, alcance corto; flota.
 *
 * ── Desbloqueo ──
 * `unlockAt` es la distancia (m) que hay que ALCANZAR alguna vez para que la
 * nave quede disponible. Se comparan contra el récord del jugador, así que
 * progresar desbloquea naves sin tener que comprarlas.
 *
 * `ratings` son los valores 0..1 que dibuja la tienda: no afectan la física, son
 * la traducción legible de estos números para que el jugador pueda comparar.
 * ============================================================
 */

/**
 * @typedef {Object} FlightSpec
 * @property {string} id
 * @property {string} name
 * @property {string} tag
 * @property {string} icon
 * @property {number} price       Costo en monedas. 0 = gratis.
 * @property {number} unlockAt    Récord de distancia necesario (m). 0 = inicial.
 * @property {number} cl          Coeficiente de sustentación efectivo
 * @property {number} cd          Coeficiente de resistencia efectivo
 * @property {number} liftCapG    Tope de aceleración de sustentación, en g
 * @property {number} baseSpeed   Velocidad de lanzamiento a potencia 0 (m/s)
 * @property {number} speedRange  m/s que agrega el 100% de potencia
 * @property {number} mass        Masa nominal (kg), para UI/mejoras
 * @property {number} pitchRate   Velocidad de alineación visual del morro (1/s)
 * @property {number} glideSink   Velocidad de descenso de referencia (m/s)
 * @property {number} glideDrag   Resistencia extra al descender (adimensional)
 * @property {number} windFactor  Cuánto la afecta el viento (1 = normal)
 * @property {number} stallSpeed  Velocidad por debajo de la cual pierde sustentación (m/s)
 * @property {number} control     Multiplicador de los mandos del jugador
 * @property {{range:number, stability:number, handling:number}} ratings
 * @property {string} desc
 */

/** @type {Record<string, FlightSpec>} */
export const AIRCRAFT_SPECS = {
  paper: {
    id: 'paper',
    name: 'Papel',
    tag: 'Ágil & Inestable',
    icon: '✈',
    price: 0,
    unlockAt: 0,
    desc: 'Planea larguísimo, pero el viento lo lleva y no perdona un mal gesto.',
    cl: 0.0040,
    cd: 0.0024,
    liftCapG: 1.2,
    baseSpeed: 14,
    speedRange: 22,
    mass: 0.15,
    pitchRate: 4.0,
    glideSink: 1.2,
    glideDrag: 1.5,
    /*
     * El papel es LIVIANO: el viento lo desvía el triple que a un avión grande.
     * Es su defecto característico y se nota apenas hay viento lateral.
     */
    windFactor: 3.0,
    /** Vuela bien lento: es lo que le permite planear tanto. */
    stallSpeed: 7,
    /** Muy sensible a los mandos: responde rápido pero es fácil pasarse. */
    control: 1.35,
    ratings: { range: 0.82, stability: 0.2, handling: 0.9 },
  },

  passenger: {
    id: 'passenger',
    name: 'Pasajeros',
    tag: 'Estable & Pesado',
    icon: '🛫',
    price: 0,
    unlockAt: 400,
    desc: 'Un tanque: el viento no lo mueve y mantiene el rumbo solo, pero le cuesta girar.',
    cl: 0.0030,
    cd: 0.0048,
    liftCapG: 1.1,
    baseSpeed: 12,
    speedRange: 20,
    mass: 0.42,
    pitchRate: 2.0,
    glideSink: 2.4,
    glideDrag: 1.3,
    /** Casi inmune al viento: es su gracia. */
    windFactor: 0.35,
    /** Necesita velocidad para sostenerse: si frena, se cae. */
    stallSpeed: 14,
    /** Mandos pesados: gira lento y con inercia. */
    control: 0.72,
    ratings: { range: 0.42, stability: 0.95, handling: 0.3 },
  },

  jet: {
    id: 'jet',
    name: 'Jet Caza',
    tag: 'Veloz & Nervioso',
    icon: '🚀',
    price: 0,
    unlockAt: 900,
    desc: 'El más rápido y el que más lejos llega, si lográs domarlo.',
    cl: 0.0034,
    cd: 0.0036,
    liftCapG: 1.4,
    baseSpeed: 18,
    speedRange: 32,
    mass: 0.28,
    pitchRate: 5.5,
    glideSink: 1.8,
    glideDrag: 1.4,
    windFactor: 1.4,
    /** Aguanta mucho antes de perder sustentación: vuela rápido por diseño. */
    stallSpeed: 20,
    /** Mandos durísimos a propósito: es rápido y pide mano firme. */
    control: 0.85,
    ratings: { range: 1.0, stability: 0.4, handling: 0.45 },
  },

  heli: {
    id: 'heli',
    name: 'Helicóptero',
    tag: 'Flota & Maniobrable',
    icon: '🚁',
    price: 0,
    unlockAt: 1500,
    desc: 'Los rotores lo sostienen: casi no cae y gira donde querés. Alcance corto.',
    cl: 0.0034,
    cd: 0.0032,
    liftCapG: 1.25,
    baseSpeed: 15,
    speedRange: 21,
    mass: 0.34,
    pitchRate: 3.0,
    glideSink: 1.0,
    glideDrag: 2.0,
    windFactor: 0.8,
    /** Es el que menos velocidad necesita para no caerse. */
    stallSpeed: 5,
    /**
     * El más maniobrable, pero SIN pasarse.
     *
     * ── Por qué bajó de 1.5 a 1.15 ──
     * Con el multiplicador del modo frenético (x2.4) la autoridad de morro
     * quedaba en 46.8 m/s², casi cinco veces la gravedad: el helicóptero subía
     * como un cohete y no avanzaba. La maniobrabilidad tiene que notarse en los
     * giros y en la respuesta, no en poder vencer a la gravedad sin costo.
     */
    control: 1.15,
    ratings: { range: 0.28, stability: 0.75, handling: 1.0 },
  },
};

/** Lista ordenada para construir la UI del selector. */
export const AIRCRAFT_LIST = ['paper', 'passenger', 'jet', 'heli'].map((id) => AIRCRAFT_SPECS[id]);

/** Aeronave con la que se arranca. */
export const DEFAULT_AIRCRAFT = 'paper';

/**
 * Busca una ficha por id, con respaldo a la inicial.
 *
 * Nunca devuelve undefined: un id desconocido (un guardado viejo, por ejemplo)
 * dejaría la física sin parámetros y el juego rompería al primer lanzamiento.
 *
 * @param {string} id
 * @returns {FlightSpec}
 */
export function getSpec(id) {
  return AIRCRAFT_SPECS[id] ?? AIRCRAFT_SPECS[DEFAULT_AIRCRAFT];
}

/**
 * ¿Está desbloqueada esta nave para el récord indicado?
 * @param {FlightSpec} spec @param {number} bestDistance
 */
export function isUnlocked(spec, bestDistance) {
  return (spec.unlockAt ?? 0) <= bestDistance;
}
