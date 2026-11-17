/**
 * Caché en memoria TTL (20 s) para consultas de leaderboard.
 * Evita pegarle a Neon cuando muchos jugadores abren la solapa Ranking.
 */
const TTL_MS = 20_000;
const store = new Map();

export function getCachedLeaderboard(period) {
  const entry = store.get(period);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    store.delete(period);
    return null;
  }
  return entry.data;
}

export function setCachedLeaderboard(period, data) {
  store.set(period, { at: Date.now(), data });
}

export function invalidateLeaderboardCache() {
  store.clear();
}
