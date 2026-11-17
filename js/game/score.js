/**
 * PAPERCRASH — game/score.js
 * ============================================================
 * Cálculo puro del desglose de SCORE por vuelo.
 * Sin dependencias de DOM ni Three.js (100% testeable en Node).
 *
 * Fórmula:
 *   MTS   = metros recorridos exactos
 *   COINS = 10 × amarillas (tier 5) + 25 × rosadas (tier 10) + 50 × doradas (tier 50)
 *   BONUS = (rozes + misiones diarias + conjunto de aros) × multiplicador de distancia
 *     Multiplicador:
 *       < 10.000 m → x1  (incluye umbral base 5.000 m)
 *       >= 10.000 m → x2
 *       >= 20.000 m → x4
 *       >= 40.000 m → x8
 *       >= 80.000 m → x16
 *   TOTAL = MTS + COINS + BONUS
 * ============================================================
 */

export const SCORE_WEIGHTS = {
  COIN_YELLOW: 10,
  COIN_PINK: 25,
  COIN_GOLD: 50,
  NEAR_MISS: 100,
  DAILY_MISSION: 250,
  RING: 20,
  RING_COMBO: 150,
};

export const BONUS_MULTIPLIER_TIERS = [
  { minDistance: 80000, multiplier: 16 },
  { minDistance: 40000, multiplier: 8 },
  { minDistance: 20000, multiplier: 4 },
  { minDistance: 10000, multiplier: 2 },
  { minDistance: 5000, multiplier: 1 },
];

/**
 * Devuelve el multiplicador de bonus según la distancia recorrida (m).
 * @param {number} distance
 * @returns {number}
 */
export function getDistanceBonusMultiplier(distance) {
  const d = Math.max(0, Number(distance) || 0);
  for (const tier of BONUS_MULTIPLIER_TIERS) {
    if (d >= tier.minDistance) return tier.multiplier;
  }
  return 1;
}

/**
 * Calcula el desglose completo de puntaje de una partida.
 * @param {object} result
 * @param {number} [missionsCompleted=0]
 */
export function computeRunScoreBreakdown(result, missionsCompleted = 0) {
  const distance = Math.max(0, Math.round(result?.distance ?? 0));
  const tiers = result?.coinsByTier ?? {};
  const yellowCount = Math.max(0, Math.round(tiers[5] ?? 0));
  const pinkCount = Math.max(0, Math.round(tiers[10] ?? 0));
  const goldCount = Math.max(0, Math.round(tiers[50] ?? 0));

  const coinsScore =
    yellowCount * SCORE_WEIGHTS.COIN_YELLOW +
    pinkCount * SCORE_WEIGHTS.COIN_PINK +
    goldCount * SCORE_WEIGHTS.COIN_GOLD;

  const nearMisses = Math.max(0, Math.round(result?.nearMisses ?? 0));
  const rings = Math.max(0, Math.round(result?.rings ?? 0));
  const ringCombos = Math.max(0, Math.round(result?.ringCombos ?? 0));
  const missions = Math.max(0, Math.round(missionsCompleted || (result?.missionsCompleted ?? 0)));

  const nearMissPts = nearMisses * SCORE_WEIGHTS.NEAR_MISS;
  const missionPts = missions * SCORE_WEIGHTS.DAILY_MISSION;
  const ringPts = rings * SCORE_WEIGHTS.RING + ringCombos * SCORE_WEIGHTS.RING_COMBO;

  const baseBonus = nearMissPts + missionPts + ringPts;
  const multiplier = getDistanceBonusMultiplier(distance);
  const bonusScore = baseBonus * multiplier;

  const totalScore = distance + coinsScore + bonusScore;

  return {
    mtsScore: distance,
    coinsScore,
    coinCounts: {
      yellow: yellowCount,
      pink: pinkCount,
      gold: goldCount,
    },
    bonusScore,
    baseBonus,
    multiplier,
    bonusDetails: {
      nearMissPts,
      missionPts,
      ringPts,
      nearMisses,
      missions,
      rings,
      ringCombos,
    },
    totalScore,
  };
}
