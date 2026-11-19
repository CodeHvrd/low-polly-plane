/**
 * PAPERCRASH — core/storage.js
 * ============================================================
 * Persistencia del progreso en localStorage.
 *
 * Reglas de robustez adoptadas:
 *   · Nunca lanzar: si localStorage está bloqueado (modo privado,
 *     políticas del navegador) el juego sigue funcionando en memoria.
 *   · Validar y sanear lo leído: un guardado corrupto o editado a mano
 *     no debe poder romper la simulación.
 *   · Versionado: permite migrar el formato sin perder progreso.
 * ============================================================
 */
import { SAVE } from '../config.js';
import { clamp } from './math.js';
import { sanitizeMissionsSave, getInitialActiveMissions } from '../game/missions.js';
import { sanitizeStorySave } from '../modes/storyLevels.js';
import { defaultAdsState, sanitizeAdsState } from '../game/adPolicy.js';

/** @returns {Storage|null} */
function getStore() {
  try {
    const s = window.localStorage;
    const probe = '__pc_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const store = getStore();
export const storageAvailable = store !== null;

/**
 * Escribe un valor. Silencioso ante fallos (cuota llena, bloqueo).
 * @returns {boolean} éxito
 */
export function write(key, value) {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('[storage] no se pudo guardar', err);
    return false;
  }
}

/** @returns {any|null} */
export function read(key) {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch (err) {
    console.warn('[storage] guardado ilegible, se descarta', err);
    remove(key);
    return null;
  }
}

export function remove(key) {
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* ignorado */
  }
}

// ── Guardado del juego ──────────────────────────────────────

/** Forma actual del guardado. Todo campo debe poder venir ausente. */
export const DEFAULT_SAVE = {
  version: SAVE.VERSION,
  coins: 0,
  upgrades: {},
  /** Aeronaves desbloqueadas (ver game/state.js → initOwnedAircraft). */
  aircraftOwned: [],
  bestDistance: 0,
  runs: 0,
  aircraft: 'paper',
  muted: false,
  orientation: 'auto',
  invertY: false,
  missions: { active: getInitialActiveMissions(), completed: [], progress: {} },
  story: { unlockedLevel: 1, endlessUnlocked: false, stars: {}, usedAircraft: ['paper'] },
  ads: defaultAdsState(),
};

/**
 * Sanea un objeto de guardado arbitrario.
 * Cualquier valor no numérico, NaN o negativo se reemplaza por el default.
 */
export function sanitizeSave(raw, upgradeIds, aircraftIds) {
  const out = { ...DEFAULT_SAVE, upgrades: {} };
  if (!raw || typeof raw !== 'object') return out;

  const num = (v, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? clamp(n, min, max) : fallback;
  };

  out.version = SAVE.VERSION;
  out.coins = Math.floor(num(raw.coins, 0, 0));
  out.bestDistance = num(raw.bestDistance, 0, 0);
  out.runs = Math.floor(num(raw.runs, 0, 0));
  out.muted = typeof raw.muted === 'boolean' ? raw.muted : false;
  out.orientation = typeof raw.orientation === 'string' && ['auto', 'portrait', 'landscape'].includes(raw.orientation)
    ? raw.orientation
    : DEFAULT_SAVE.orientation;
  out.aircraft = typeof raw.aircraft === 'string' && aircraftIds.includes(raw.aircraft)
    ? raw.aircraft
    : DEFAULT_SAVE.aircraft;

  out.cursorFollow = typeof raw.cursorFollow === 'boolean' ? raw.cursorFollow : null;
  out.invertY = typeof raw.invertY === 'boolean' ? raw.invertY : false;
  out.missions = sanitizeMissionsSave(raw.missions);
  out.story = sanitizeStorySave(raw.story);
  out.ads = sanitizeAdsState(raw.ads);
  out.stats = raw.stats && typeof raw.stats === 'object' ? { ...raw.stats } : undefined;

  const levels = raw.upgrades && typeof raw.upgrades === 'object' ? raw.upgrades : {};
  for (const id of upgradeIds) {
    out.upgrades[id] = Math.floor(num(levels[id], 0, 0, 999));
  }

  // Inventario de aeronaves: solo ids conocidos y sin repetidos.
  const ownedRaw = Array.isArray(raw.aircraftOwned) ? raw.aircraftOwned : [];
  out.aircraftOwned = [...new Set(
    ownedRaw.filter((id) => typeof id === 'string' && aircraftIds.includes(id)),
  )];

  // Migración v1 -> v2: antes las 4 naves eran gratis y se guardaban todas en aircraftOwned.
  if (raw.version === 1) {
    out.aircraftOwned = aircraftIds.includes('paper') ? ['paper'] : [];
    out.aircraft = aircraftIds.includes('paper') ? 'paper' : DEFAULT_SAVE.aircraft;
  }

  return out;
}

export function loadSave(upgradeIds, aircraftIds) {
  const raw = read(SAVE.KEY);
  return sanitizeSave(raw, upgradeIds, aircraftIds);
}

export function persistSave(state) {
  return write(SAVE.KEY, {
    version: SAVE.VERSION,
    coins: Math.floor(state.coins),
    upgrades: { ...state.upgrades },
    aircraftOwned: [...(state.aircraftOwned ?? [])],
    bestDistance: state.bestDistance,
    runs: state.runs,
    aircraft: state.aircraft,
    muted: state.muted,
    orientation: state.orientationPref ?? 'auto',
    cursorFollow: typeof state.cursorFollow === 'boolean' ? state.cursorFollow : null,
    invertY: Boolean(state.invertY),
    missions: state.missions ? sanitizeMissionsSave(state.missions) : undefined,
    story: state.story ? sanitizeStorySave(state.story) : undefined,
    ads: state.ads ? sanitizeAdsState(state.ads) : undefined,
    stats: state.stats ? { ...state.stats } : undefined,
  });
}

export function clearSave() {
  remove(SAVE.KEY);
}
