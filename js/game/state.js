/**
 * PAPERCRASH — game/state.js
 * ============================================================
 * Estado persistente del juego y definición de la tienda.
 *
 * Módulo de datos: no toca DOM ni Three.js.
 *
 * ── Sobre el balance de las mejoras ──
 * Los multiplicadores NO son arbitrarios. El modelo de vuelo es cuadrático
 * en la velocidad, así que pequeños cambios se amplifican: con los valores
 * originales (dragMult 0.15, launchPowerMult x3.1) el build al máximo
 * llegaba a 2.9 km, muy por fuera del corredor de 600 m.
 *
 * Los valores de acá fueron calibrados con tools/verify-physics.mjs:
 *   base 114 m  →  50% 228 m  →  máximo 508 m
 * Es decir, progresión real de ~4.4x sin salirse nunca del corredor.
 * ============================================================
 */
import { getSpec, DEFAULT_AIRCRAFT, AIRCRAFT_LIST } from '../physics/specs.js';

/**
 * @typedef {Object} UpgradeDef
 * @property {string} id
 * @property {string} name
 * @property {string} icon
 * @property {string} desc
 * @property {number} maxLevel
 * @property {number} baseCost
 * @property {number} costMult
 * @property {(lvl:number) => object} effect
 */

/** @type {UpgradeDef[]} */
export const UPGRADES = [
  {
    id: 'wings',
    name: 'Alas',
    icon: '✈️',
    desc: 'Más sustentación: el avión se sostiene mejor y planea más lejos.',
    maxLevel: 8,
    baseCost: 80,
    costMult: 1.55,
    effect: (lvl) => ({ liftMult: 1 + lvl * 0.10 }),
  },
  {
    id: 'engine',
    name: 'Motor',
    icon: '⚡',
    desc: 'Más empuje en el lanzamiento: más velocidad inicial.',
    maxLevel: 8,
    baseCost: 100,
    costMult: 1.6,
    effect: (lvl) => ({ launchPowerMult: 1 + lvl * 0.09 }),
  },
  {
    id: 'hull',
    name: 'Casco',
    icon: '🛡️',
    desc: 'Estructura reforzada: aguanta mejor los rebotes e impactos.',
    maxLevel: 6,
    baseCost: 120,
    costMult: 1.7,
    effect: (lvl) => ({ hullStr: 1 + lvl * 0.30 }),
  },
  {
    id: 'weight',
    name: 'Peso',
    icon: '⚖️',
    desc: 'Aligerar el fuselaje reduce la inercia y alarga el vuelo.',
    maxLevel: 6,
    baseCost: 90,
    costMult: 1.5,
    effect: (lvl) => ({ massMult: Math.max(0.6, 1 - lvl * 0.07) }),
  },
  {
    id: 'aero',
    name: 'Aerodinámica',
    icon: '💨',
    desc: 'Menos resistencia al aire: conserva la velocidad por más tiempo.',
    /*
     * Tope en 6 niveles: con 0.14 por nivel se llega al techo real de 90 m/s en el
     * nivel 6, así que 7 y 8 serían monedas gastadas sin efecto visible.
     */
    maxLevel: 6,
    baseCost: 110,
    costMult: 1.5,
    effect: (lvl) => ({ dragMult: Math.max(0.55, 1 - lvl * 0.06) }),
  },
  {
    id: 'stab',
    name: 'Estabilizadores',
    icon: '📐',
    desc: 'El morro sigue la trayectoria con más firmeza.',
    maxLevel: 6,
    baseCost: 75,
    costMult: 1.45,
    effect: (lvl) => ({ stabilityMult: 1 + lvl * 0.25 }),
  },
  {
    id: 'bounce',
    name: 'Rebote',
    icon: '🔄',
    desc: 'Amortiguación: al tocar el suelo rebota en vez de estrellarse.',
    maxLevel: 5,
    baseCost: 200,
    costMult: 2.0,
    effect: (lvl) => ({ bounceMult: lvl * 0.18 }),
  },
  {
    /*
     * ── Alerones: agilidad lateral ──
     *
     * Se pidió una mejora que cubra la falta de agilidad de costado: es la
     * carencia que más se siente al esquivar rocas seguidas en el circuito
     * rasante, y hasta ahora no había forma de invertir monedas en resolverla.
     *
     * Sube la ACELERACIÓN lateral y el TOPE de desvío a la vez, así mejora tanto
     * la respuesta inmediata como la capacidad de mantener el giro.
     */
    id: 'ailerons',
    name: 'Alerones',
    icon: '🪁',
    desc: 'Más agilidad de costado: responde antes y gira más por metro.',
    maxLevel: 8,
    baseCost: 110,
    costMult: 1.55,
    /*
     * 0.14 por nivel no alcanzaba: con la nave a fondo y mucha velocidad el avión
     * seguía sin doblar. Se duplicó a 0.30, así el nivel 6 da x2.8 de agilidad
     * lateral en vez de x1.84.
     */
    effect: (lvl) => ({ lateralMult: 1 + lvl * 0.3 }),
  },
  {
    id: 'nose',
    name: 'Nariz',
    icon: '🔺',
    desc: 'Perfil afilado: convierte mejor el empuje en velocidad.',
    maxLevel: 5,
    baseCost: 130,
    costMult: 1.6,
    effect: (lvl) => ({ noseMult: 1 + lvl * 0.04 }),
  },
];

export const UPGRADE_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));
export const UPGRADE_IDS = UPGRADES.map((u) => u.id);

/**
 * Estado global del juego. Se hidrata desde `core/storage.js` en el arranque.
 * @type {{coins:number, upgrades:Record<string,number>, aircraftOwned:string[], bestDistance:number, runs:number, aircraft:string, muted:boolean}}
 */
/** Stats en cero, para el reset y para guardados que no tienen el campo. */
export function statsVacios() {
  return {
    rings: 0, boosters: 0, runs: 0, crashes: 0, coinsCollected: 0,
    bestDistance: 0, playMs: 0, landings: 0, corridorExits: 0,
  };
}

export const STATE = {
  coins: 0,
  upgrades: {},
  /**
   * Aeronaves desbloqueadas. Por ahora las 4 vienen gratis, así que arranca
   * con todas. Cuando haya precios, esta lista pasa a ser el inventario real
   * y `canPickAircraft()` en ui/aircraftSelector.js ya la consulta.
   * @type {string[]}
   */
  aircraftOwned: [],
  bestDistance: 0,
  runs: 0,
  aircraft: DEFAULT_AIRCRAFT,
  muted: false,

  /*
   * ── Estadísticas acumuladas de la vida del jugador ──
   *
   * Se guardan los TOTALES, no los logros conseguidos: el logro se calcula
   * comparando contra su umbral (ver game/achievements.js). Así, agregar un logro
   * nuevo no necesita migrar guardados — los jugadores viejos ya lo tienen si
   * habían llegado al número.
   */
  stats: statsVacios(),
};

/**
 * ¿La forma guardada es la vieja (plana) o la nueva (por nave)?
 *
 * ── Por qué hay que migrar ──
 * Hasta ahora las mejoras eran GLOBALES: `{ wings: 3, engine: 1 }`. Ahora son
 * por nave: `{ paper: { wings: 3 }, jet: { wings: 1 } }`. Un guardado viejo tiene
 * números en la raíz; uno nuevo tiene objetos.
 *
 * Lo comprobamos por la forma y no por un número de versión para no meter un
 * campo extra que haya que recordar actualizar.
 */
function esFormatoViejo(upgrades) {
  if (!upgrades) return false;
  return UPGRADE_IDS.some((id) => typeof upgrades[id] === 'number');
}

/**
 * Migra un guardado con mejoras GLOBALES al formato por nave.
 *
 * Las mejoras compradas se le asignan a la nave que el jugador tenía activa: es
 * lo más justo, porque fue con esa con la que las compró.
 */
function migrarUpgrades(upgrades, naveActiva) {
  if (!esFormatoViejo(upgrades)) return upgrades ?? {};
  const porNave = {};
  const nivel = {};
  for (const id of UPGRADE_IDS) {
    if (typeof upgrades[id] === 'number') nivel[id] = upgrades[id];
  }
  porNave[naveActiva || 'paper'] = nivel;
  return porNave;
}

/** Niveles de mejora de una nave concreta (nunca undefined). */
export function nivelesDe(shipId = STATE.aircraft) {
  if (!STATE.upgrades[shipId]) STATE.upgrades[shipId] = {};
  return STATE.upgrades[shipId];
}

/** Rellena con nivel 0 las mejoras de cada nave que tenga datos. */
export function initUpgradeLevels() {
  for (const shipId of Object.keys(STATE.upgrades)) {
    const niveles = STATE.upgrades[shipId];
    if (!niveles || typeof niveles !== 'object') continue;
    for (const id of UPGRADE_IDS) {
      if (typeof niveles[id] !== 'number') niveles[id] = 0;
    }
  }
}

/**
 * Aplica un guardado ya saneado sobre el estado vivo.
 * @param {object} save
 */
export function hydrate(save) {
  STATE.coins = save.coins;
  STATE.bestDistance = save.bestDistance;
  STATE.runs = save.runs;
  STATE.aircraft = save.aircraft;
  STATE.muted = save.muted;
  /*
   * Las mejoras guardadas pueden venir en el formato VIEJO (global) o en el nuevo
   * (por nave). Se migran al cargar, asignando las compradas a la nave que el
   * jugador tenía activa.
   */
  /*
   * Las estadísticas se FUSIONAN con las de fábrica.
   *
   * Un guardado viejo no tiene `stats`, y uno nuevo puede no tener un campo que se
   * agregue después. Fusionar evita `undefined` en las sumas.
   */
  STATE.stats = { ...STATE.stats, ...(save.stats ?? {}) };
  STATE.upgrades = migrarUpgrades(save.upgrades, save.aircraft);
  initUpgradeLevels();
  initOwnedAircraft();
}

/**
 * Garantiza que la lista de aeronaves desbloqueadas incluya, como mínimo, las
 * que son gratis y la que está en uso.
 *
 * Motivo: si un guardado viejo no trae la lista, o el jugador tenía
 * seleccionada una nave que ya no es gratis, quedaría "en uso" algo que no
 * posee. Es más simple y más seguro normalizar acá que confiar en el guardado.
 */
export function initOwnedAircraft() {
  const owned = new Set(Array.isArray(STATE.aircraftOwned) ? STATE.aircraftOwned : []);
  for (const spec of AIRCRAFT_LIST) {
    if ((spec.price ?? 0) <= 0) owned.add(spec.id);
  }
  // La nave en uso debe estar siempre en el inventario.
  if (STATE.aircraft) owned.add(STATE.aircraft);
  STATE.aircraftOwned = [...owned];
}

/**
 * Multiplicadores agregados de todas las mejoras compradas.
 * Se recalculan una vez por vuelo, no por frame.
 *
 * Nota de diseño: `weight` (masa) y `aero` (resistencia) se combinan en un
 * único `dragMult`. En el modelo de vuelo los coeficientes ya están
 * normalizados por masa, así que aligerar el avión y reducir su resistencia
 * producen el mismo efecto físico: menos frenado. Mantenerlos separados
 * sugeriría una distinción que la simulación no hace.
 */
export function getUpgradeMods(shipId = STATE.aircraft) {
  const niveles = nivelesDe(shipId);
  const mods = {
    liftMult: 1,
    launchPowerMult: 1,
    hullStr: 1,
    massMult: 1,
    dragMult: 1,
    stabilityMult: 1,
    bounceMult: 0,
    noseMult: 1,
  };

  for (const u of UPGRADES) {
    const lvl = niveles[u.id] || 0;
    if (lvl > 0) Object.assign(mods, u.effect(lvl));
  }

  return {
    ...mods,
    dragMult: mods.dragMult * mods.massMult,
    launchPowerMult: mods.launchPowerMult * mods.noseMult,
  };
}

/** Costo de la próxima compra. */
export function upgradeCost(id, shipId = STATE.aircraft) {
  const u = UPGRADE_BY_ID.get(id);
  if (!u) return Infinity;
  const lvl = nivelesDe(shipId)[id] || 0;
  return Math.round(u.baseCost * u.costMult ** lvl);
}

export const isMaxed = (id, shipId = STATE.aircraft) =>
  (nivelesDe(shipId)[id] || 0) >= (UPGRADE_BY_ID.get(id)?.maxLevel ?? 0);
export const canAfford = (id) => STATE.coins >= upgradeCost(id);

/** ¿Se puede comprar? Devuelve el motivo si no. */
export function canBuy(id, shipId = STATE.aircraft) {
  const u = UPGRADE_BY_ID.get(id);
  if (!u) return { ok: false, reason: 'unknown' };
  if (isMaxed(id, shipId)) return { ok: false, reason: 'maxed' };
  if (!canAfford(id, shipId)) return { ok: false, reason: 'coins' };
  return { ok: true, cost: upgradeCost(id, shipId) };
}

/**
 * Ejecuta la compra. Devuelve el resultado para que la UI reaccione
 * (y para poder testear la economía sin DOM).
 */
/**
 * Compra un nivel de mejora para la NAVE ACTIVA.
 *
 * Las mejoras son por nave: comprar "Alas" con el avión de papel no mejora al
 * jet. Cada nave se sube aparte, que es lo que hace que elegir nave sea una
 * decisión de largo plazo y no un cambio cosmético.
 *
 * @param {string} id  id de la mejora
 * @param {string} [shipId]  por defecto la nave equipada
 */
export function purchaseUpgrade(id, shipId = STATE.aircraft) {
  const check = canBuy(id, shipId);
  if (!check.ok) return check;
  STATE.coins -= check.cost;
  const niveles = nivelesDe(shipId);
  niveles[id] = (niveles[id] || 0) + 1;
  return { ok: true, cost: check.cost, level: niveles[id] };
}

/** Selecciona aeronave validando el id. */
export function setAircraft(id) {
  getSpec(id); // valida y devuelve fallback si no existe
  STATE.aircraft = id;
}

/**
 * Compra una aeronave y la deja disponible.
 *
 * Valida las MISMAS condiciones que la UI (`canPickAircraft`), pero acá sin DOM:
 * la economía tiene que poder probarse sin navegador, y además la UI no debe ser
 * la única defensa contra gastar de más. Si el precio es 0 la agrega igual a las
 * adquiridas, así el estado queda consistente pase lo que pase.
 *
 * @param {import('../physics/specs.js').FlightSpec} spec
 * @returns {{ok:boolean, reason:string, cost?:number}}
 */
export function buyAircraft(spec) {
  if (!spec?.id) return { ok: false, reason: 'invalid' };
  if ((STATE.aircraftOwned ?? []).includes(spec.id)) return { ok: false, reason: 'owned' };

  const price = spec.price ?? 0;
  if (price > STATE.coins) return { ok: false, reason: 'coins' };

  STATE.coins -= price;
  if (!Array.isArray(STATE.aircraftOwned)) STATE.aircraftOwned = [];
  STATE.aircraftOwned.push(spec.id);
  return { ok: true, reason: 'bought', cost: price };
}

/** Snapshot plano para persistir. */
export function toSaveObject() {
  return {
    coins: STATE.coins,
    upgrades: { ...STATE.upgrades },
    aircraftOwned: [...STATE.aircraftOwned],
    bestDistance: STATE.bestDistance,
    runs: STATE.runs,
    aircraft: STATE.aircraft,
    muted: STATE.muted,
  };
}
