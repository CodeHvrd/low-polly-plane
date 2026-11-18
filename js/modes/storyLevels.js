/**
 * PAPERCRASH — modes/storyLevels.js
 * ============================================================
 * Configuración declarativa pura de los 5 niveles del Modo Historia
 * (niveles finitos con meta física que desbloquean el Modo Endless).
 *
 * ── Pureza Arquitectónica ──
 * Módulo 100% puro (sin DOM ni Three.js). Define parámetros de terreno,
 * densidad de obstáculos, metas de distancia, criterios de 3 estrellas y
 * recompensas. Ningún motor físico tiene `if (level === X)`.
 * ============================================================
 */

/**
 * @typedef {Object} StoryStarCriterion
 * @property {string} id
 * @property {string} label
 * @property {(result: object) => boolean} check
 */

/**
 * @typedef {Object} StoryLevelDef
 * @property {string} id
 * @property {number} number          1..5
 * @property {string} name
 * @property {string} subtitle
 * @property {string|null} aircraft   ID fijo de aeronave o null para libre elección
 * @property {number} targetDistance  Meta de distancia (m) donde termina el nivel (1★)
 * @property {number} courseLength    Largo del corredor del nivel (m)
 * @property {number} paletteIndex    Índice de paleta en STAGES.PALETTES
 * @property {number} groundAmplitude Amplitud de relieve inyectada en terrainField
 * @property {number} obstacleDensity Multiplicador de densidad de obstáculos
 * @property {string[]} allowedObstacles Tipos permitidos en este nivel
 * @property {string} hint            Mensaje tutorial contextual no intrusivo
 * @property {number} rewardCoins     Monedas ganadas al completar el nivel
 * @property {StoryStarCriterion[]} stars
 */

/** @type {StoryLevelDef[]} */
export const STORY_LEVELS = [
  {
    id: 'story-1',
    number: 1,
    name: 'El Primer Pliegue',
    subtitle: 'Resortera, planeo y primeros boosters',
    aircraft: 'paper',
    targetDistance: 600,
    courseLength: 700,
    paletteIndex: 0,
    groundAmplitude: 0.04,
    obstacleDensity: 0.25,
    allowedObstacles: ['tree', 'rock'],
    hint: 'Arrastrá la resortera para ajustar potencia y ángulo. ¡Recogé boosters para llegar a la meta a 600 m!',
    rewardCoins: 100,
    stars: [
      {
        id: 'finish',
        label: 'Cruzá la meta a 600 m',
        check: (r) => (r?.distance ?? 0) >= 600,
      },
      {
        id: 'coins',
        label: 'Recogé al menos 12 monedas',
        check: (r) => (r?.coinsCollected ?? 0) >= 12,
      },
      {
        id: 'boosters',
        label: 'Recogé 2 boosters en el vuelo',
        check: (r) => (r?.boosters ?? 0) >= 2,
      },
    ],
  },
  {
    id: 'story-2',
    number: 2,
    name: 'Corrientes del Valle',
    subtitle: 'Boosters de recarga y vendavales',
    aircraft: 'paper',
    targetDistance: 1000,
    courseLength: 1100,
    paletteIndex: 1,
    groundAmplitude: 0.09,
    obstacleDensity: 0.45,
    allowedObstacles: ['tree', 'rock', 'updraft'],
    hint: 'Los boosters recargan tu planeo y te dan cargas. ¡Entrá en los vendavales para remontar hasta los 1.000 m!',
    rewardCoins: 150,
    stars: [
      {
        id: 'finish',
        label: 'Cruzá la meta a 1.000 m',
        check: (r) => (r?.distance ?? 0) >= 1000,
      },
      {
        id: 'boosters',
        label: 'Recogé 3 boosters en el vuelo',
        check: (r) => (r?.boosters ?? 0) >= 3,
      },
      {
        id: 'altitude',
        label: 'Alcanzá 26 m de altitud máxima',
        check: (r) => (r?.maxAltitude ?? 0) >= 26,
      },
    ],
  },
  {
    id: 'story-3',
    number: 3,
    name: 'El Circuito de Aros',
    subtitle: 'Viraje lateral y combos de aros',
    aircraft: 'passenger',
    targetDistance: 2200,
    courseLength: 2350,
    paletteIndex: 2,
    groundAmplitude: 0.14,
    obstacleDensity: 0.68,
    allowedObstacles: ['tree', 'rock', 'mesa', 'ring', 'updraft'],
    hint: 'Girá con A/D para alinear el avión con los aros celestes. ¡4 seguidos activan un Súper Impulso hacia los 2.200 m!',
    rewardCoins: 220,
    stars: [
      {
        id: 'finish',
        label: 'Cruzá la meta a 2.200 m',
        check: (r) => (r?.distance ?? 0) >= 2200,
      },
      {
        id: 'rings',
        label: 'Atravesá 5 aros en el recorrido',
        check: (r) => (r?.rings ?? 0) >= 5,
      },
      {
        id: 'combo',
        label: 'Completá 1 Combo de 4 Aros seguidos',
        check: (r) => (r?.ringCombos ?? 0) >= 1,
      },
    ],
  },
  {
    id: 'story-4',
    number: 4,
    name: 'Desfiladero Supersónico',
    subtitle: 'Jet de Caza — Propulsión y Near Miss',
    aircraft: 'jet',
    targetDistance: 5000,
    courseLength: 5200,
    paletteIndex: 3,
    groundAmplitude: 0.22,
    obstacleDensity: 0.9,
    allowedObstacles: ['rock', 'spire', 'log', 'ring', 'updraft'],
    hint: 'Presioná ESPACIO para activar el propulsor del Jet. ¡Cruzá la meta a 5.000 m!',
    rewardCoins: 320,
    stars: [
      {
        id: 'finish',
        label: 'Cruzá la meta a 5.000 m',
        check: (r) => (r?.distance ?? 0) >= 5000,
      },
      {
        id: 'speed',
        label: 'Superá los 60 m/s de velocidad punta',
        check: (r) => (r?.maxSpeed ?? 0) >= 60,
      },
      {
        id: 'nearmiss',
        label: 'Realizá 3 Near Misses sin chocar',
        check: (r) => (r?.nearMisses ?? 0) >= 3,
      },
    ],
  },
  {
    id: 'story-5',
    number: 5,
    name: 'La Prueba del Horizonte',
    subtitle: 'Helicóptero · Rumbo al Desafío Final',
    aircraft: 'heli',
    targetDistance: 7500,
    courseLength: 7800,
    paletteIndex: 4,
    groundAmplitude: 0.30,
    obstacleDensity: 1.15,
    allowedObstacles: ['tree', 'rock', 'mesa', 'spire', 'log', 'ring', 'updraft'],
    hint: 'Combiná aros, vendavales, propulsión y near misses. ¡Superá 7.500 m para llegar al Nivel 6!',
    rewardCoins: 500,
    stars: [
      {
        id: 'finish',
        label: 'Cruzá la meta a 7.500 m',
        check: (r) => (r?.distance ?? 0) >= 7500,
      },
      {
        id: 'tactical',
        label: 'Atravesá 6 aros y usá 3 propulsiones',
        check: (r) => (r?.rings ?? 0) >= 6 && (r?.thrustsUsed ?? 0) >= 3,
      },
      {
        id: 'mastery',
        label: '1 Combo de aros + 3 Near Misses',
        check: (r) => (r?.ringCombos ?? 0) >= 1 && (r?.nearMisses ?? 0) >= 3,
      },
    ],
  },
  {
    id: 'story-6',
    number: 6,
    name: 'Leyenda del Aire',
    subtitle: 'Maestría total — Desbloquea Ranking y Sin Fin',
    aircraft: null, // Libre elección entre las naves adquiridas
    targetDistance: 10000,
    courseLength: 10500,
    paletteIndex: 4,
    groundAmplitude: 0.34,
    obstacleDensity: 1.25,
    allowedObstacles: ['tree', 'rock', 'mesa', 'spire', 'log', 'ring', 'updraft'],
    hint: 'Elegí tu mejor nave mejorada y combiná aros, boosters y propulsión. ¡Superá los 10.000 m!',
    rewardCoins: 800,
    stars: [
      {
        id: 'finish',
        label: 'Cruzá la meta final a 10.000 m',
        check: (r) => (r?.distance ?? 0) >= 10000,
      },
      {
        id: 'tactical',
        label: 'Atravesá 8 aros y usá 4 propulsiones',
        check: (r) => (r?.rings ?? 0) >= 8 && (r?.thrustsUsed ?? 0) >= 4,
      },
      {
        id: 'mastery',
        label: '1 Combo de aros + 4 Near Misses',
        check: (r) => (r?.ringCombos ?? 0) >= 1 && (r?.nearMisses ?? 0) >= 4,
      },
    ],
  },
];

export const STORY_LEVEL_BY_ID = new Map(STORY_LEVELS.map((l) => [l.id, l]));

/**
 * Obtiene la definición de un nivel por número (1..5) o ID ('story-1'..'story-5').
 * @param {number|string} levelRef
 * @returns {StoryLevelDef|null}
 */
export function getStoryLevel(levelRef) {
  if (typeof levelRef === 'number') {
    return STORY_LEVELS.find((l) => l.number === levelRef) ?? null;
  }
  return STORY_LEVEL_BY_ID.get(levelRef) ?? null;
}

/**
 * Sanea el estado guardado del Modo Historia / Campaña.
 * @param {object} raw
 * @returns {{unlockedLevel: number, endlessUnlocked: boolean, stars: Record<string, number>, usedAircraft: string[]}}
 */
export function sanitizeStorySave(raw) {
  const unlockedLevel =
    typeof raw?.unlockedLevel === 'number' && Number.isFinite(raw.unlockedLevel)
      ? Math.max(1, Math.min(STORY_LEVELS.length, Math.floor(raw.unlockedLevel)))
      : 1;

  const endlessUnlocked = raw?.endlessUnlocked === true;
  const rawStars = raw?.stars && typeof raw.stars === 'object' ? raw.stars : {};
  const stars = {};
  for (const lvl of STORY_LEVELS) {
    const val = rawStars[lvl.id];
    if (typeof val === 'number' && Number.isFinite(val)) {
      stars[lvl.id] = Math.max(0, Math.min(3, Math.floor(val)));
    }
  }

  const validShips = new Set(STORY_LEVELS.map((l) => l.aircraft).filter(Boolean));
  const usedSet = new Set(['paper']);
  if (Array.isArray(raw?.usedAircraft)) {
    for (const id of raw.usedAircraft) {
      if (typeof id === 'string' && validShips.has(id)) usedSet.add(id);
    }
  }
  for (const lvl of STORY_LEVELS) {
    if (lvl.aircraft && (stars[lvl.id] > 0 || endlessUnlocked)) {
      usedSet.add(lvl.aircraft);
    }
  }

  return { unlockedLevel, endlessUnlocked, stars, usedAircraft: [...usedSet] };
}

/**
 * Evalúa el resultado de un vuelo frente a los objetivos del nivel de Historia.
 *
 * @param {StoryLevelDef} level
 * @param {object} result
 * @returns {{passed: boolean, starsEarned: number, starDetails: Array<{id:string, label:string, earned:boolean}>, rewardCoins: number}}
 */
export function evaluateStoryResult(level, result) {
  if (!level) {
    return { passed: false, starsEarned: 0, starDetails: [], rewardCoins: 0 };
  }

  const passed = (result?.distance ?? 0) >= level.targetDistance;
  let starsEarned = 0;
  const starDetails = level.stars.map((s) => {
    const earned = Boolean(s.check(result));
    if (earned) starsEarned++;
    return { id: s.id, label: s.label, earned };
  });

  // Si no superó la distancia mínima, nunca otorga estrellas ni victoria
  const finalStars = passed ? Math.max(1, starsEarned) : 0;
  const rewardCoins = passed ? level.rewardCoins : 0;

  return {
    passed,
    starsEarned: finalStars,
    starDetails,
    rewardCoins,
  };
}
