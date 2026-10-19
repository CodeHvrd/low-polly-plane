/**
 * PAPERCRASH — game/achievements.js
 * ============================================================
 * Logros y estadísticas acumuladas del jugador.
 *
 * ── Por qué está separado del estado ──
 * Los logros son DATOS (una lista con umbrales), no código de juego. Tenerlos
 * aparte permite agregar trofeos sin tocar `state.js` ni la UI, y que el día que
 * haya ranking en el servidor se puedan validar desde afuera.
 *
 * ── Cómo se guarda ──
 * No se guarda "qué logros están desbloqueados": se guardan los TOTALES
 * (`STATE.stats.rings`, `.boosters`…) y el logro se calcula comparando contra su
 * umbral. Es menos estado, y si mañana se agrega un logro nuevo, los jugadores
 * viejos ya lo tienen desbloqueado si habían llegado al número.
 *
 * Eso importa para escalar: un logro nuevo no necesita migración de guardados.
 * ============================================================
 */

/**
 * @typedef {object} Achievement
 * @property {string} id
 * @property {string} name
 * @property {string} desc
 * @property {number} target   umbral
 * @property {(stats:object) => number} value  progreso actual
 */

/** @type {Achievement[]} */
export const ACHIEVEMENTS = [
  /* ── Aros: el circuito pasa a ser el objetivo del vuelo ── */
  { id: 'rings-25', name: 'Ring Rookie', desc: 'Cruzá 25 aros', target: 25, value: (s) => s.rings ?? 0 },
  { id: 'rings-100', name: 'Ring Master', desc: 'Cruzá 100 aros', target: 100, value: (s) => s.rings ?? 0 },
  { id: 'rings-250', name: 'Ring Legend', desc: 'Cruzá 250 aros', target: 250, value: (s) => s.rings ?? 0 },

  /* ── Boosters ── */
  { id: 'boost-50', name: 'Collector', desc: 'Juntá 50 boosters', target: 50, value: (s) => s.boosters ?? 0 },
  { id: 'boost-100', name: 'Hoarder', desc: 'Juntá 100 boosters', target: 100, value: (s) => s.boosters ?? 0 },
  { id: 'boost-250', name: 'Overcharged', desc: 'Juntá 250 boosters', target: 250, value: (s) => s.boosters ?? 0 },

  /* ── Vuelos ── */
  { id: 'runs-10', name: 'Getting Started', desc: 'Hacé 10 vuelos', target: 10, value: (s) => s.runs ?? 0 },
  { id: 'runs-50', name: 'Regular Flyer', desc: 'Hacé 50 vuelos', target: 50, value: (s) => s.runs ?? 0 },
  { id: 'runs-200', name: 'Veteran', desc: 'Hacé 200 vuelos', target: 200, value: (s) => s.runs ?? 0 },

  /* ── Distancia: el mejor vuelo, no el acumulado ── */
  { id: 'dist-1000', name: 'Kilometer', desc: 'Volá 1000 m en un vuelo', target: 1000, value: (s) => s.bestDistance ?? 0 },
  { id: 'dist-3000', name: 'Long Haul', desc: 'Volá 3000 m en un vuelo', target: 3000, value: (s) => s.bestDistance ?? 0 },
  { id: 'dist-5000', name: 'Skyline', desc: 'Volá 5000 m en un vuelo', target: 5000, value: (s) => s.bestDistance ?? 0 },

  /* ── Monedas juntadas (no compradas) ── */
  { id: 'coins-500', name: 'Coin Rush', desc: 'Juntá 500 monedas', target: 500, value: (s) => s.coinsCollected ?? 0 },
  { id: 'coins-2500', name: 'Treasure Hunter', desc: 'Juntá 2500 monedas', target: 2500, value: (s) => s.coinsCollected ?? 0 },
];

/**
 * Estado de un logro: progreso, si está conseguido y el porcentaje.
 *
 * @param {Achievement} a
 * @param {object} stats
 * @returns {{id:string,name:string,desc:string,target:number,value:number,progress:number,unlocked:boolean,pct:number}}
 */
export function estadoLogro(a, stats) {
  const value = Math.min(a.target, a.value(stats));
  return {
    id: a.id,
    name: a.name,
    desc: a.desc,
    target: a.target,
    value,
    progress: value,
    unlocked: value >= a.target,
    pct: a.target > 0 ? Math.min(100, Math.round((value / a.target) * 100)) : 0,
  };
}

/** Todos los logros con su estado actual. */
export function todosLosLogros(stats) {
  return ACHIEVEMENTS.map((a) => estadoLogro(a, stats));
}

/** Cuántos están conseguidos. */
export function logrosConseguidos(stats) {
  return ACHIEVEMENTS.filter((a) => a.value(stats) >= a.target).length;
}

/** Stats en cero, para arrancar. */
export function statsVacios() {
  return {
    rings: 0,
    boosters: 0,
    runs: 0,
    crashes: 0,
    coinsCollected: 0,
    bestDistance: 0,
    /** Milisegundos acumulados de vuelo. */
    playMs: 0,
    /** Vuelos que terminaron en el suelo sin chocar con obstáculo. */
    landings: 0,
    /** Veces que se salió del corredor. */
    corridorExits: 0,
  };
}
