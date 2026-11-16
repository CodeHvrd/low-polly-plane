/**
 * PAPERCRASH — modes/storyLevels.js
 * ============================================================
 * Configuración declarativa pura de los 5 niveles del Modo Historia
 * (tutoriales progresivos hacia el Modo Endless).
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
 * @property {number} targetDistance  Meta de distancia (m) para superar el nivel (1★)
 * @property {number} courseLength    Largo sugerido del corredor (m)
 * @property {number} paletteIndex    Índice de paleta en STAGES.PALETTES
 * @property {number} groundAmplitude Amplitud de relieve inyectada en terrainField
 * @property {number} obstacleDensity Multiplicador de densidad de obstáculos
 * @property {string[]} allowedObstacles Tipos permitidos en este nivel
 * @property {string} hint            Mensaje tutorial contextual no intrusivo
 * @property {number} rewardCoins     Monedas ganadas al completar el nivel por 1.ª vez o superarlo
 * @property {StoryStarCriterion[]} stars
 */

/** @type {StoryLevelDef[]} */
export const STORY_LEVELS = [
  {
    id: 'story-1',
    number: 1,
    name: 'El Primer Pliegue',
    subtitle: 'Domina la resortera y el planeo',
    aircraft: 'paper',
    targetDistance: 150,
    courseLength: 240,
    paletteIndex: 0,
    groundAmplitude: 0.04,
    obstacleDensity: 0.2,
    allowedObstacles: ['tree'],
    hint: 'Arrastrá la resortera hacia atrás para cargar potencia y arriba/abajo para elegir ángulo.',
    rewardCoins: 80,
    stars: [
      {
        id: 'finish',
        label: 'Cruzá la meta a 150 m',
        check: (r) => (r?.distance ?? 0) >= 150,
      },
      {
        id: 'coins',
        label: 'Recogé al menos 8 monedas',
        check: (r) => (r?.coinsCollected ?? 0) >= 8,
      },
      {
        id: 'land',
        label: 'Aterrizaje suave pasado los 170 m',
        check: (r) => (r?.distance ?? 0) >= 170 && r?.kind === 'landing',
      },
    ],
  },
  {
    id: 'story-2',
    number: 2,
    name: 'Corrientes del Valle',
    subtitle: 'Boosters de recarga y vendavales',
    aircraft: 'paper',
    targetDistance: 280,
    courseLength: 380,
    paletteIndex: 1,
    groundAmplitude: 0.09,
    obstacleDensity: 0.45,
    allowedObstacles: ['tree', 'rock', 'updraft'],
    hint: 'Los boosters recargan tu planeo y te dan cargas. ¡Entrá en los vendavales para remontar!',
    rewardCoins: 120,
    stars: [
      {
        id: 'finish',
        label: 'Cruzá la meta a 280 m',
        check: (r) => (r?.distance ?? 0) >= 280,
      },
      {
        id: 'boosters',
        label: 'Recogé 2 boosters en el vuelo',
        check: (r) => (r?.boosters ?? 0) >= 2,
      },
      {
        id: 'altitude',
        label: 'Alcanzá 24 m de altitud máxima',
        check: (r) => (r?.maxAltitude ?? 0) >= 24,
      },
    ],
  },
  {
    id: 'story-3',
    number: 3,
    name: 'El Circuito de Aros',
    subtitle: 'Viraje lateral y combos de aros',
    aircraft: 'passenger',
    targetDistance: 400,
    courseLength: 520,
    paletteIndex: 2,
    groundAmplitude: 0.14,
    obstacleDensity: 0.68,
    allowedObstacles: ['tree', 'rock', 'mesa', 'ring', 'updraft'],
    hint: 'Girá con A/D para alinear el avión con los aros celestes. ¡4 seguidos activan un Súper Impulso!',
    rewardCoins: 160,
    stars: [
      {
        id: 'finish',
        label: 'Cruzá la meta a 400 m',
        check: (r) => (r?.distance ?? 0) >= 400,
      },
      {
        id: 'rings',
        label: 'Atravesá 3 aros en el recorrido',
        check: (r) => (r?.rings ?? 0) >= 3,
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
    subtitle: 'Propulsión táctica y Near Miss',
    aircraft: 'jet',
    targetDistance: 600,
    courseLength: 740,
    paletteIndex: 3,
    groundAmplitude: 0.22,
    obstacleDensity: 0.9,
    allowedObstacles: ['rock', 'spire', 'log', 'ring', 'updraft'],
    hint: 'Presioná ESPACIO para activar el propulsor. ¡Rozá rocas a milímetros para sumar bonos!',
    rewardCoins: 220,
    stars: [
      {
        id: 'finish',
        label: 'Cruzá la meta a 600 m',
        check: (r) => (r?.distance ?? 0) >= 600,
      },
      {
        id: 'speed',
        label: 'Superá los 58 m/s de velocidad punta',
        check: (r) => (r?.maxSpeed ?? 0) >= 58,
      },
      {
        id: 'nearmiss',
        label: 'Realizá 2 Near Misses sin chocar',
        check: (r) => (r?.nearMisses ?? 0) >= 2,
      },
    ],
  },
  {
    id: 'story-5',
    number: 5,
    name: 'La Prueba del Horizonte',
    subtitle: 'Maestría total — Desbloquea Endless',
    aircraft: null, // Libre elección de nave
    targetDistance: 850,
    courseLength: 1050,
    paletteIndex: 4,
    groundAmplitude: 0.30,
    obstacleDensity: 1.15,
    allowedObstacles: ['tree', 'rock', 'mesa', 'spire', 'log', 'ring', 'updraft'],
    hint: 'Combiná aros, vendavales, propulsión y near misses. ¡Superá 850 m para desbloquear Endless!',
    rewardCoins: 400,
    stars: [
      {
        id: 'finish',
        label: 'Cruzá la meta final a 850 m',
        check: (r) => (r?.distance ?? 0) >= 850,
      },
      {
        id: 'tactical',
        label: 'Atravesá 4 aros y usá 2 propulsiones',
        check: (r) => (r?.rings ?? 0) >= 4 && (r?.thrustsUsed ?? 0) >= 2,
      },
      {
        id: 'mastery',
        label: '950 m + 1 Combo de aros + 2 Near Misses',
        check: (r) => (r?.distance ?? 0) >= 950 && (r?.ringCombos ?? 0) >= 1 && (r?.nearMisses ?? 0) >= 2,
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
 * Sanea el estado guardado del Modo Historia.
 * @param {object} raw
 * @returns {{unlockedLevel: number, endlessUnlocked: boolean, stars: Record<string, number>}}
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

  return { unlockedLevel, endlessUnlocked, stars };
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
