/**
 * PAPERCRASH — game/missions.js
 * ============================================================
 * Sistema de Misiones Tripartitas (3 objetivos activos simultáneos).
 *
 * ── Filosofía de Diseño y Calibración ──
 * Basado en las mejores prácticas de retención (Alto's Adventure, Jetpack Joyride).
 * Cada misión está calibrada para resolverse en el marco de 3 a 4 partidas:
 *   - Objetivos acumulativos que progresan sostenidamente entre vuelos.
 *   - Desafíos de vuelo que requieren comprar mejoras iniciales o dominar impulsos.
 *
 * ── Pureza Arquitectónica ──
 * Módulo 100% puro (sin DOM ni Three.js), testeable en Node.js.
 * ============================================================
 */

/**
 * @typedef {Object} MissionDef
 * @property {string} id
 * @property {string} title
 * @property {string} desc
 * @property {string} icon
 * @property {number} reward          Monedas al completarla
 * @property {'flight'|'cumulative'} scope 'flight' = en un solo vuelo, 'cumulative' = acumulado entre partidas
 * @property {number} target          Valor a alcanzar
 * @property {((flightStats:object) => number)} [getProgress]
 * @property {((flightStats:object) => number)} [getContribution]
 */

/** Catálogo de misiones calibradas para resolverse en un marco de 3-4 partidas. */
export const MISSION_CATALOG = [
  // ── Rango 1: Objetivos de 3 a 4 partidas iniciales ──
  {
    id: 'cum-dist-1000',
    title: 'Travesía Inicial',
    desc: 'Acumulá 1.000 m de vuelo total',
    icon: '🗺️',
    reward: 120,
    scope: 'cumulative',
    target: 1000,
    getContribution: (f) => f?.distance ?? 0,
  },
  {
    id: 'single-speed-58',
    title: 'Rompiendo el Viento',
    desc: 'Superá los 58 m/s de velocidad punta',
    icon: '⚡',
    reward: 110,
    scope: 'flight',
    target: 58,
    getProgress: (f) => f?.maxSpeed ?? 0,
  },
  {
    id: 'cum-coins-75',
    title: 'Cazador de Monedas',
    desc: 'Acumulá 75 monedas recogidas en total',
    icon: '🪙',
    reward: 110,
    scope: 'cumulative',
    target: 75,
    getContribution: (f) => f?.coinsCollected ?? 0,
  },

  // ── Rango 2: Habilidad táctica, rozes y aros ──
  {
    id: 'single-dist-380',
    title: 'Cruzando el Valle',
    desc: 'Alcanzá 380 m en un solo vuelo',
    icon: '📏',
    reward: 130,
    scope: 'flight',
    target: 380,
    getProgress: (f) => f?.distance ?? 0,
  },
  {
    id: 'cum-near-4',
    title: 'As del Rasante',
    desc: 'Acumulá 4 Near Misses (rozes cercanos)',
    icon: '🎯',
    reward: 140,
    scope: 'cumulative',
    target: 4,
    getContribution: (f) => f?.nearMisses ?? 0,
  },
  {
    id: 'single-rings-4',
    title: 'Puntería Perfecta',
    desc: 'Atravesá 4 aros en un solo vuelo',
    icon: '⭕',
    reward: 120,
    scope: 'flight',
    target: 4,
    getProgress: (f) => f?.rings ?? 0,
  },
  {
    id: 'cum-boosters-8',
    title: 'Carga Continua',
    desc: 'Recogé 8 boosters en total',
    icon: '🔋',
    reward: 130,
    scope: 'cumulative',
    target: 8,
    getContribution: (f) => f?.boosters ?? 0,
  },
  {
    id: 'single-alt-32',
    title: 'Vuelo Alto',
    desc: 'Alcanzá 32 m de altitud en un vuelo',
    icon: '🏔️',
    reward: 100,
    scope: 'flight',
    target: 32,
    getProgress: (f) => f?.maxAltitude ?? 0,
  },
  {
    id: 'cum-thrust-6',
    title: 'Fuerza Propulsora',
    desc: 'Activá la propulsión 6 veces en total',
    icon: '🚀',
    reward: 125,
    scope: 'cumulative',
    target: 6,
    getContribution: (f) => f?.thrustsUsed ?? 0,
  },

  // ── Rango 3: Destreza media y combos sostenidos ──
  {
    id: 'single-combo-1',
    title: 'Cadencia Sonora',
    desc: 'Completá 1 combo de aros (4 seguidos)',
    icon: '🎶',
    reward: 150,
    scope: 'flight',
    target: 1,
    getProgress: (f) => f?.ringCombos ?? 0,
  },
  {
    id: 'cum-rings-12',
    title: 'Maestro del Circuito',
    desc: 'Atravesá 12 aros en total',
    icon: '🏆',
    reward: 140,
    scope: 'cumulative',
    target: 12,
    getContribution: (f) => f?.rings ?? 0,
  },
  {
    id: 'single-near-2',
    title: 'Doble Vuelo Temerario',
    desc: 'Rozá 2 obstáculos sólidos en un solo vuelo',
    icon: '⚡',
    reward: 135,
    scope: 'flight',
    target: 2,
    getProgress: (f) => f?.nearMisses ?? 0,
  },
  {
    id: 'single-coins-25',
    title: 'Fortuna en el Aire',
    desc: 'Recogé 25 monedas en un solo vuelo',
    icon: '💰',
    reward: 120,
    scope: 'flight',
    target: 25,
    getProgress: (f) => f?.coinsCollected ?? 0,
  },
  {
    id: 'cum-dist-1500',
    title: 'Gran Expedición',
    desc: 'Acumulá 1.500 m de vuelo total',
    icon: '🌄',
    reward: 160,
    scope: 'cumulative',
    target: 1500,
    getContribution: (f) => f?.distance ?? 0,
  },

  // ── Rango 4: Metas avanzadas para aviones mejorados ──
  {
    id: 'single-speed-68',
    title: 'Mach 1',
    desc: 'Alcanzá 68 m/s de velocidad punta',
    icon: '🌠',
    reward: 160,
    scope: 'flight',
    target: 68,
    getProgress: (f) => f?.maxSpeed ?? 0,
  },
  {
    id: 'cum-coins-120',
    title: 'Arca de Oro',
    desc: 'Acumulá 120 monedas recogidas en total',
    icon: '🪙',
    reward: 170,
    scope: 'cumulative',
    target: 120,
    getContribution: (f) => f?.coinsCollected ?? 0,
  },
  {
    id: 'single-dist-600',
    title: 'As del Horizonte',
    desc: 'Alcanzá 600 m en un solo vuelo',
    icon: '🌟',
    reward: 220,
    scope: 'flight',
    target: 600,
    getProgress: (f) => f?.distance ?? 0,
  },
  {
    id: 'cum-near-8',
    title: 'Intocable',
    desc: 'Acumulá 8 Near Misses en total',
    icon: '🎖️',
    reward: 200,
    scope: 'cumulative',
    target: 8,
    getContribution: (f) => f?.nearMisses ?? 0,
  },
];

export const MISSION_BY_ID = new Map(MISSION_CATALOG.map((m) => [m.id, m]));

/**
 * Devuelve la lista inicial de 3 misiones para una partida nueva.
 * @returns {string[]} IDs de las 3 misiones activas
 */
export function getInitialActiveMissions() {
  return [
    'cum-dist-1000',
    'single-speed-58',
    'cum-coins-75',
  ];
}

/**
 * Sanea y valida el estado de misiones guardado.
 * @param {object} raw
 * @returns {{active:string[], completed:string[], progress:Record<string,number>}}
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

  // Si todas las misiones del catálogo fueron completadas, reciclamos
  if (active.length < 3) {
    for (const def of MISSION_CATALOG) {
      if (active.length >= 3) break;
      if (!active.includes(def.id)) active.push(def.id);
    }
  }

  const rawProg = raw?.progress && typeof raw.progress === 'object' ? raw.progress : {};
  const progress = {};
  for (const id of active) {
    if (typeof rawProg[id] === 'number' && Number.isFinite(rawProg[id])) {
      progress[id] = Math.max(0, rawProg[id]);
    }
  }

  return { active: active.slice(0, 3), completed, progress };
}

/**
 * @typedef {Object} MissionState
 * @property {string} id
 * @property {string} title
 * @property {string} desc
 * @property {string} icon
 * @property {number} reward
 * @property {'flight'|'cumulative'} scope
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
 * @param {Record<string,number>} [activeProgress={}]
 * @returns {MissionState[]}
 */
export function evaluateMissions(activeIds, flightStats, activeProgress = {}) {
  const list = [];
  for (const id of activeIds) {
    const def = MISSION_BY_ID.get(id);
    if (!def) continue;

    let currentVal = 0;
    if (def.scope === 'flight') {
      currentVal = def.getProgress ? def.getProgress(flightStats) : 0;
    } else {
      const base = activeProgress?.[def.id] ?? 0;
      const inFlight = def.getContribution ? def.getContribution(flightStats) : 0;
      currentVal = base + inFlight;
    }

    const progress = Math.min(def.target, Math.max(0, Math.round(currentVal)));
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
 * Acumula el progreso de un vuelo finalizado en el diccionario de progreso acumulativo.
 *
 * @param {string[]} activeIds
 * @param {object} flightStats
 * @param {Record<string,number>} activeProgress
 * @returns {Record<string,number>}
 */
export function recordFlightProgress(activeIds, flightStats, activeProgress = {}) {
  const next = { ...activeProgress };
  for (const id of activeIds) {
    const def = MISSION_BY_ID.get(id);
    if (!def || def.scope !== 'cumulative') continue;
    const contribution = def.getContribution ? def.getContribution(flightStats) : 0;
    next[id] = (next[id] ?? 0) + contribution;
  }
  return next;
}

/**
 * Reemplaza una misión completada por la siguiente disponible en el catálogo.
 *
 * @param {string[]} activeIds
 * @param {string[]} completedIds
 * @param {string} completedMissionId
 * @param {Record<string,number>} [activeProgress={}]
 * @returns {{nextActive: string[], nextCompleted: string[], replacement: MissionDef|null, nextProgress: Record<string,number>}}
 */
export function advanceCompletedMission(activeIds, completedIds, completedMissionId, activeProgress = {}) {
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
  const nextProgress = { ...activeProgress };
  delete nextProgress[completedMissionId];

  return { nextActive, nextCompleted, replacement, nextProgress };
}
