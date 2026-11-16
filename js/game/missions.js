/**
 * PAPERCRASH — game/missions.js
 * ============================================================
 * Sistema de Misiones Tripartitas (3 objetivos activos simultáneos).
 *
 * ── Inspiración y Filosofía de Diseño ──
 * Basado en las mejores prácticas de retención de Alto's Adventure y Jetpack
 * Joyride: el jugador siempre tiene 3 objetivos claros y alcanzables en pantalla
 * que evitan el "muro de desconexión" y otorgan inyecciones constantes de
 * monedas entre vuelos.
 *
 * ── Pureza Arquitectónica ──
 * Módulo 100% puro (sin DOM ni Three.js), testeable en Node.js.
 * ============================================================
 */
import { clamp } from '../core/math.js';

/**
 * @typedef {Object} MissionDef
 * @property {string} id
 * @property {string} title
 * @property {string} desc
 * @property {string} icon
 * @property {number} reward          Monedas al completarla
 * @property {'flight'|'total'} scope 'flight' = en un solo vuelo, 'total' = acumulado
 * @property {number} target          Valor a alcanzar
 * @property {(flightStats:object, lifetimeStats:object) => number} getProgress
 */

/** Catálogo de misiones ordenadas por progresión y variedad de mecánicas. */
export const MISSION_CATALOG = [
  // ── Rango 1: Primeros vuelos e iniciación ──
  {
    id: 'dist-120',
    title: 'Bautismo de Vuelo',
    desc: 'Alcanzá 120 m en un solo vuelo',
    icon: '📏',
    reward: 50,
    scope: 'flight',
    target: 120,
    getProgress: (f) => f?.distance ?? 0,
  },
  {
    id: 'speed-35',
    title: 'Aceleración',
    desc: 'Superá los 35 m/s de velocidad',
    icon: '⚡',
    reward: 50,
    scope: 'flight',
    target: 35,
    getProgress: (f) => f?.maxSpeed ?? 0,
  },
  {
    id: 'coins-15',
    title: 'Monedero',
    desc: 'Recogé 15 monedas en un vuelo',
    icon: '🪙',
    reward: 60,
    scope: 'flight',
    target: 15,
    getProgress: (f) => f?.coinsCollected ?? 0,
  },

  // ── Rango 2: Habilidad, aros y rozes cercanos ──
  {
    id: 'near-1',
    title: 'Vuelo Temerario',
    desc: 'Rozá 1 obstáculo sin chocar (Near Miss)',
    icon: '🎯',
    reward: 80,
    scope: 'flight',
    target: 1,
    getProgress: (f) => f?.nearMisses ?? 0,
  },
  {
    id: 'rings-3',
    title: 'Diana en el Aire',
    desc: 'Atravesá 3 aros en un solo vuelo',
    icon: '⭕',
    reward: 90,
    scope: 'flight',
    target: 3,
    getProgress: (f) => f?.rings ?? 0,
  },
  {
    id: 'alt-25',
    title: 'Vuelo Alto',
    desc: 'Alcanzá 25 m de altitud',
    icon: '🏔️',
    reward: 70,
    scope: 'flight',
    target: 25,
    getProgress: (f) => f?.maxAltitude ?? 0,
  },
  {
    id: 'boosters-3',
    title: 'Recarga Táctica',
    desc: 'Recogé 3 boosters en un vuelo',
    icon: '🔋',
    reward: 85,
    scope: 'flight',
    target: 3,
    getProgress: (f) => f?.boosters ?? 0,
  },
  {
    id: 'thrust-2',
    title: 'Piloto a Reacción',
    desc: 'Activá la propulsión 2 veces en un vuelo',
    icon: '🚀',
    reward: 75,
    scope: 'flight',
    target: 2,
    getProgress: (f) => f?.thrustsUsed ?? 0,
  },

  // ── Rango 3: Destreza intermedia y combos ──
  {
    id: 'combo-1',
    title: 'Cadencia Sonora',
    desc: 'Completá 1 combo de aros (4 aros seguidos)',
    icon: '🎶',
    reward: 120,
    scope: 'flight',
    target: 1,
    getProgress: (f) => f?.ringCombos ?? 0,
  },
  {
    id: 'dist-350',
    title: 'Cruzando el Valle',
    desc: 'Alcanzá 350 m en un solo vuelo',
    icon: '🗺️',
    reward: 130,
    scope: 'flight',
    target: 350,
    getProgress: (f) => f?.distance ?? 0,
  },
  {
    id: 'speed-55',
    title: 'Rompiendo la Barrera',
    desc: 'Superá los 55 m/s de velocidad',
    icon: '💨',
    reward: 140,
    scope: 'flight',
    target: 55,
    getProgress: (f) => f?.maxSpeed ?? 0,
  },
  {
    id: 'near-3',
    title: 'A Milímetros',
    desc: 'Rozá 3 obstáculos sin chocar en un vuelo',
    icon: '⚡',
    reward: 150,
    scope: 'flight',
    target: 3,
    getProgress: (f) => f?.nearMisses ?? 0,
  },

  // ── Rango 4: Metas acumuladas y maestría ──
  {
    id: 'total-rings-20',
    title: 'Veterano del Circuito',
    desc: 'Acumulá 20 aros atravesados en total',
    icon: '🏆',
    reward: 160,
    scope: 'total',
    target: 20,
    getProgress: (_f, s) => s?.rings ?? 0,
  },
  {
    id: 'total-coins-200',
    title: 'Fortuna Aérea',
    desc: 'Acumulá 200 monedas recogidas en total',
    icon: '💰',
    reward: 180,
    scope: 'total',
    target: 200,
    getProgress: (_f, s) => s?.coinsCollected ?? 0,
  },
  {
    id: 'dist-700',
    title: 'As del Horizonte',
    desc: 'Alcanzá 700 m en un solo vuelo',
    icon: '🌄',
    reward: 220,
    scope: 'flight',
    target: 700,
    getProgress: (f) => f?.distance ?? 0,
  },
  {
    id: 'speed-70',
    title: 'Mach 1',
    desc: 'Alcanzá 70 m/s de velocidad punta',
    icon: '🌠',
    reward: 250,
    scope: 'flight',
    target: 70,
    getProgress: (f) => f?.maxSpeed ?? 0,
  },
  {
    id: 'total-near-10',
    title: 'Intocable',
    desc: 'Acumulá 10 Near Misses en total',
    icon: '🎖️',
    reward: 200,
    scope: 'total',
    target: 10,
    getProgress: (_f, s) => s?.nearMisses ?? 0,
  },
  {
    id: 'dist-1200',
    title: 'Vuelo Transcontinental',
    desc: 'Alcanzá 1.200 m de distancia',
    icon: '🌟',
    reward: 350,
    scope: 'flight',
    target: 1200,
    getProgress: (f) => f?.distance ?? 0,
  },
];

export const MISSION_BY_ID = new Map(MISSION_CATALOG.map((m) => [m.id, m]));

/**
 * Devuelve la lista inicial de 3 misiones para una partida nueva.
 * @returns {string[]} IDs de las 3 misiones activas
 */
export function getInitialActiveMissions() {
  return [
    MISSION_CATALOG[0].id, // dist-120
    MISSION_CATALOG[1].id, // speed-35
    MISSION_CATALOG[2].id, // coins-15
  ];
}

/**
 * Sanea y valida el estado de misiones guardado.
 * @param {object} raw
 * @returns {{active:string[], completed:string[]}}
 */
export function sanitizeMissionsSave(raw) {
  const completed = Array.isArray(raw?.completed)
    ? raw.completed.filter((id) => typeof id === 'string' && MISSION_BY_ID.has(id))
    : [];

  let active = Array.isArray(raw?.active)
    ? raw.active.filter((id) => typeof id === 'string' && MISSION_BY_ID.has(id) && !completed.includes(id))
    : [];

  // Completar hasta 3 slots con misiones aún no completadas
  if (active.length < 3) {
    for (const def of MISSION_CATALOG) {
      if (active.length >= 3) break;
      if (!completed.includes(def.id) && !active.includes(def.id)) {
        active.push(def.id);
      }
    }
  }

  // Si todas las misiones del catálogo fueron completadas, reciclamos las últimas
  if (active.length < 3) {
    for (const def of MISSION_CATALOG) {
      if (active.length >= 3) break;
      if (!active.includes(def.id)) active.push(def.id);
    }
  }

  return { active: active.slice(0, 3), completed };
}

/**
 * @typedef {Object} MissionState
 * @property {string} id
 * @property {string} title
 * @property {string} desc
 * @property {string} icon
 * @property {number} reward
 * @property {'flight'|'total'} scope
 * @property {number} target
 * @property {number} progress
 * @property {number} pct
 * @property {boolean} isCompleted
 */

/**
 * Obtiene el estado detallado de las misiones activas según las estadísticas.
 *
 * @param {string[]} activeIds
 * @param {object} flightStats
 * @param {object} lifetimeStats
 * @returns {MissionState[]}
 */
export function evaluateMissions(activeIds, flightStats, lifetimeStats) {
  const list = [];
  for (const id of activeIds) {
    const def = MISSION_BY_ID.get(id);
    if (!def) continue;

    const currentVal = def.getProgress(flightStats, lifetimeStats);
    const progress = Math.min(def.target, Math.max(0, currentVal));
    const isCompleted = progress >= def.target;
    const pct = def.target > 0 ? Math.min(100, Math.round((progress / def.target) * 100)) : 0;

    list.push({
      id: def.id,
      title: def.title,
      desc: def.desc,
      icon: def.icon,
      reward: def.reward,
      scope: def.scope,
      target: def.target,
      progress,
      pct,
      isCompleted,
    });
  }
  return list;
}

/**
 * Reemplaza una misión completada por la siguiente disponible en el catálogo.
 *
 * @param {string[]} activeIds
 * @param {string[]} completedIds
 * @param {string} completedMissionId
 * @returns {{nextActive: string[], nextCompleted: string[], replacement: MissionDef|null}}
 */
export function advanceCompletedMission(activeIds, completedIds, completedMissionId) {
  const nextCompleted = completedIds.includes(completedMissionId)
    ? [...completedIds]
    : [...completedIds, completedMissionId];

  // Buscar la siguiente misión del catálogo que no esté activa ni completada
  let replacement = MISSION_CATALOG.find(
    (m) => !nextCompleted.includes(m.id) && !activeIds.includes(m.id)
  ) || null;

  // Si no quedan misiones inéditas, elegir cualquier misión que no esté activa
  if (!replacement) {
    replacement = MISSION_CATALOG.find((m) => !activeIds.includes(m.id)) || null;
  }

  const nextActive = activeIds.map((id) => (id === completedMissionId ? replacement?.id ?? id : id));

  return { nextActive, nextCompleted, replacement };
}
