/**
 * PAPERCRASH / FLY OR CRASH — game/adPolicy.js
 * ============================================================
 * Política pura de monetización por anuncios (SIN DOM ni Three.js).
 *
 * Principios de diseño:
 *   1. Rewarded-first: los anuncios opcionales con recompensa clara (×2 monedas
 *      del vuelo, +250 monedas en tienda) generan satisfacción y nunca frenan.
 *   2. Anti-saturación en intersticiales: nunca en los primeros vuelos, nunca
 *      tras un choque corto (<10 s), nunca durante vuelo/apuntado, y con
 *      inmunidad temporal si el jugador ya vio un anuncio Rewarded.
 *   3. Integridad competitiva: los premios por anuncio aplican en la economía
 *      meta DESPUÉS del cálculo/envío del replay, sin alterar física ni score.
 * ============================================================
 */

export const AD_CONFIG = {
  /** Monedas mínimas del vuelo para ofrecer botón "×2 Monedas". */
  DOUBLE_COINS_MIN: 15,
  /** Tope de monedas extra otorgadas por un único anuncio "×2 Monedas". */
  DOUBLE_COINS_MAX_BONUS: 2500,

  /** Premio fijo por ver un anuncio voluntario en Tienda / Hangar. */
  SHOP_COINS_REWARD: 250,
  /** Espera entre anuncios voluntarios en tienda (segundos). */
  SHOP_COINS_COOLDOWN_SEC: 180,
  /** Máximo diario de recargas voluntarias en tienda. */
  SHOP_COINS_MAX_PER_DAY: 8,

  /** Cantidad mínima de vuelos totales antes del primer intersticial. */
  INTERSTITIAL_MIN_TOTAL_RUNS: 3,
  /** Duración mínima del vuelo para considerar mostrar intersticial al salir (s). */
  INTERSTITIAL_MIN_FLIGHT_SEC: 10,
  /** Vuelos mínimos entre dos intersticiales automáticos. */
  INTERSTITIAL_MIN_RUNS_BETWEEN: 3,
  /** Cooldown mínimo entre intersticiales automáticos (segundos). */
  INTERSTITIAL_COOLDOWN_SEC: 150,
  /** Inmunidad frente a intersticiales tras ver un Rewarded (segundos). */
  REWARDED_GRACE_SEC: 180,

  /** Alto mínimo de viewport (px) para mostrar banner en menús sin tapar UI. */
  BANNER_MIN_VIEWPORT_H: 520,
};

export const AD_PLACEMENTS = {
  RESULT_DOUBLE_COINS: 'result_double_coins',
  SHOP_FREE_COINS: 'shop_free_coins',
  BETWEEN_RUNS_INTERSTITIAL: 'between_runs_interstitial',
  MENU_BANNER: 'menu_banner',
};

/** Clave YYYY-MM-DD en horario local del caller para límites diarios. */
export function getLocalDayKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function defaultAdsState(todayKey = getLocalDayKey()) {
  return {
    lastInterstitialAt: 0,
    lastRewardedAt: 0,
    lastShopAdAt: 0,
    runsSinceInterstitial: 0,
    dailyDate: todayKey,
    shopClaimsToday: 0,
    rewardedTotal: 0,
    interstitialTotal: 0,
    adsDisabled: false,
  };
}

/** Sanea el bloque `ads` persistido en localStorage/cloud. */
export function sanitizeAdsState(raw, todayKey = getLocalDayKey()) {
  const base = defaultAdsState(todayKey);
  if (!raw || typeof raw !== 'object') return base;

  const nonNegInt = (v, fallback = 0) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.floor(n);
  };

  const savedDay = typeof raw.dailyDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dailyDate)
    ? raw.dailyDate
    : todayKey;
  const sameDay = savedDay === todayKey;

  return {
    lastInterstitialAt: nonNegInt(raw.lastInterstitialAt, 0),
    lastRewardedAt: nonNegInt(raw.lastRewardedAt, 0),
    lastShopAdAt: nonNegInt(raw.lastShopAdAt, 0),
    runsSinceInterstitial: nonNegInt(raw.runsSinceInterstitial, 0),
    dailyDate: todayKey,
    shopClaimsToday: sameDay ? nonNegInt(raw.shopClaimsToday, 0) : 0,
    rewardedTotal: nonNegInt(raw.rewardedTotal, 0),
    interstitialTotal: nonNegInt(raw.interstitialTotal, 0),
    adsDisabled: raw.adsDisabled === true,
  };
}

/** Calcula cuánto extra otorga "×2 Monedas" sobre lo ganado en el vuelo. */
export function computeDoubleCoinsBonus(runCoins) {
  const coins = Math.max(0, Math.floor(Number(runCoins) || 0));
  if (coins < AD_CONFIG.DOUBLE_COINS_MIN) return 0;
  return Math.min(coins, AD_CONFIG.DOUBLE_COINS_MAX_BONUS);
}

/** Evalúa si en Resultados corresponde ofrecer/reclamar "×2 Monedas". */
export function canDoubleRunCoins(runCoins, alreadyDoubled = false) {
  if (alreadyDoubled) {
    return { ok: false, reason: 'already_claimed', bonus: 0 };
  }
  const bonus = computeDoubleCoinsBonus(runCoins);
  if (bonus <= 0) {
    return { ok: false, reason: 'min_coins_not_met', bonus: 0 };
  }
  return { ok: true, reason: 'ready', bonus };
}

/** Evalúa disponibilidad y cooldown de "+250 monedas" en Tienda. */
export function canClaimShopCoins(adsState, nowMs = Date.now(), todayKey = getLocalDayKey(nowMs)) {
  const st = sanitizeAdsState(adsState, todayKey);
  if (st.shopClaimsToday >= AD_CONFIG.SHOP_COINS_MAX_PER_DAY) {
    return {
      ok: false,
      reason: 'daily_cap',
      remainingCooldownSec: 0,
      remainingDaily: 0,
      reward: AD_CONFIG.SHOP_COINS_REWARD,
    };
  }

  const elapsedSec = st.lastShopAdAt > 0 ? Math.max(0, (nowMs - st.lastShopAdAt) / 1000) : Infinity;
  if (elapsedSec < AD_CONFIG.SHOP_COINS_COOLDOWN_SEC) {
    return {
      ok: false,
      reason: 'cooldown',
      remainingCooldownSec: Math.ceil(AD_CONFIG.SHOP_COINS_COOLDOWN_SEC - elapsedSec),
      remainingDaily: Math.max(0, AD_CONFIG.SHOP_COINS_MAX_PER_DAY - st.shopClaimsToday),
      reward: AD_CONFIG.SHOP_COINS_REWARD,
    };
  }

  return {
    ok: true,
    reason: 'ready',
    remainingCooldownSec: 0,
    remainingDaily: Math.max(0, AD_CONFIG.SHOP_COINS_MAX_PER_DAY - st.shopClaimsToday),
    reward: AD_CONFIG.SHOP_COINS_REWARD,
  };
}

/**
 * Decide si mostrar un intersticial en una transición natural tras resultados.
 * Protege la experiencia con 6 guardas anti-saturación explícitas.
 */
export function shouldShowInterstitial({
  adsState,
  nowMs = Date.now(),
  totalRuns = 0,
  flightTimeSec = 0,
  justWatchedRewarded = false,
}) {
  const st = sanitizeAdsState(adsState, getLocalDayKey(nowMs));
  if (st.adsDisabled) return { show: false, reason: 'ads_disabled' };
  if (justWatchedRewarded) return { show: false, reason: 'just_watched_rewarded' };
  if (totalRuns < AD_CONFIG.INTERSTITIAL_MIN_TOTAL_RUNS) return { show: false, reason: 'new_player_grace' };
  if (flightTimeSec < AD_CONFIG.INTERSTITIAL_MIN_FLIGHT_SEC) return { show: false, reason: 'short_run_grace' };
  if (st.runsSinceInterstitial < AD_CONFIG.INTERSTITIAL_MIN_RUNS_BETWEEN) {
    return { show: false, reason: 'min_runs_between' };
  }

  if (st.lastRewardedAt > 0) {
    const sinceRewarded = Math.max(0, (nowMs - st.lastRewardedAt) / 1000);
    if (sinceRewarded < AD_CONFIG.REWARDED_GRACE_SEC) {
      return { show: false, reason: 'rewarded_grace' };
    }
  }

  if (st.lastInterstitialAt > 0) {
    const sinceInterstitial = Math.max(0, (nowMs - st.lastInterstitialAt) / 1000);
    if (sinceInterstitial < AD_CONFIG.INTERSTITIAL_COOLDOWN_SEC) {
      return { show: false, reason: 'cooldown' };
    }
  }

  return { show: true, reason: 'ready' };
}

/**
 * Define en qué pantallas puede haber un banner discreto.
 * Jamás en `aim` ni en `playing` para no tapar apuntado, HUD ni controles táctiles.
 */
export function shouldShowBanner(screen, viewportHeight = 800, adsState = null) {
  if (adsState?.adsDisabled) return { show: false, position: 'bottom', reason: 'ads_disabled' };
  if (screen !== 'standby' && screen !== 'result') {
    return { show: false, position: 'bottom', reason: 'gameplay_screen' };
  }
  if (viewportHeight < AD_CONFIG.BANNER_MIN_VIEWPORT_H) {
    return { show: false, position: 'bottom', reason: 'compact_landscape' };
  }
  return { show: true, position: 'bottom', reason: 'ready' };
}
