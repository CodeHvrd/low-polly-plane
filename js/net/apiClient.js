/**
 * PAPERCRASH — net/apiClient.js
 * ============================================================
 * Cliente HTTP mínimo y no-bloqueante hacia la API de Vercel (/api/*).
 *
 * Principio local-first:
 *   · Si no hay internet o Neon todavía no está conectado, falla en silencio
 *     sin trabar ni retrasar el vuelo ni el menú.
 *   · Gestiona sesión guest, cuentas locales (usuario + contraseña),
 *     Google Sign-In, alias de piloto, sync de perfil y Ranking global.
 * ============================================================
 */

const AUTH_STORAGE_KEY = 'papercrash.auth.v1';
const PROD_VERCEL_ORIGIN = 'https://flyorcrash.vercel.app';

function resolveApiBase() {
  if (typeof window === 'undefined') return '';
  const { hostname } = window.location;
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.vercel.app')
  ) {
    return '';
  }
  return PROD_VERCEL_ORIGIN;
}

export function getStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSessionFromResponse(res, fallbackGuestId = null) {
  const prev = getStoredAuth();
  const next = {
    guestId: fallbackGuestId || prev.guestId || null,
    userId: res.userId ?? prev.userId ?? null,
    displayName: res.displayName ?? prev.displayName ?? 'Piloto',
    provider: res.provider ?? prev.provider ?? 'guest',
    username: res.username ?? null,
    email: res.email ?? null,
    avatarUrl: res.avatarUrl ?? null,
    isAdmin: Boolean(res.isAdmin),
    token: res.token ?? prev.token ?? null,
  };
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
  } catch { /* modo privado */ }
  return next;
}

async function apiFetch(path, opts = {}, timeoutMs = 5000) {
  const base = resolveApiBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const auth = getStoredAuth();
  const headers = {
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
    ...(opts.headers || {}),
  };
  try {
    const res = await fetch(`${base}${path}`, {
      ...opts,
      headers,
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({ ok: false }));
    return { status: res.status, ...json };
  } catch (err) {
    return { ok: false, offline: true, error: err?.message || 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

let dbOnline = false;
let googleClientId = null;
let sessionPromise = null;

/** Verifica conectividad con Vercel + Neon y autentica usuario guest si hace falta. */
export async function initRemoteBackend() {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const [health, cfg] = await Promise.all([
      apiFetch('/api/health'),
      apiFetch('/api/auth/config').catch(() => ({})),
    ]);
    if (cfg?.googleClientId) googleClientId = cfg.googleClientId;

    if (!health.ok || !health.db?.connected) {
      dbOnline = false;
      return { online: false, reason: health.db?.reason || health.error || 'NO_DB' };
    }
    dbOnline = true;

    const auth = getStoredAuth();
    if (auth.token) {
      const me = await apiFetch('/api/auth/me');
      if (me.ok && me.user) {
        saveSessionFromResponse(me.user);
        return { online: true, user: getStoredAuth() };
      }
    }

    const guestId =
      auth.guestId ||
      (crypto.randomUUID?.() ?? `g-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const login = await apiFetch('/api/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ guestId, displayName: auth.displayName || 'Piloto' }),
    });
    if (login.ok && login.token) {
      saveSessionFromResponse(login, guestId);
    }
    return { online: true, user: getStoredAuth() };
  })();
  return sessionPromise;
}

export function isRemoteOnline() {
  return dbOnline;
}

export function getGoogleClientId() {
  return googleClientId;
}

/** Cambia el nombre visible del piloto (aparece en el Ranking). */
export async function updatePilotDisplayName(displayName) {
  const res = await apiFetch('/api/auth/profile', {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  });
  if (res.ok && res.user) {
    return { ok: true, session: saveSessionFromResponse(res.user) };
  }
  return res;
}

/** Crea una cuenta nueva (mail + usuario + contraseña). Si `linkCurrentAccount`, conserva datos de invitado. */
export async function registerLocalUser({ email, username, password, displayName, linkCurrentAccount = true }) {
  const res = await apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, username, password, displayName, linkCurrentAccount }),
  });
  if (res.ok && res.token) {
    return { ok: true, session: saveSessionFromResponse(res) };
  }
  return res;
}

/** Inicia sesión con usuario o mail + contraseña locales. */
export async function loginLocalUser({ identifier, username, password }) {
  const res = await apiFetch('/api/auth/password-login', {
    method: 'POST',
    body: JSON.stringify({ identifier: identifier ?? username, password }),
  });
  if (res.ok && res.token) {
    return { ok: true, session: saveSessionFromResponse(res) };
  }
  return res;
}

/** Inicia sesión o vincula cuenta de Google usando ID Token o Access Token de Google Identity Services. */
export async function loginGoogleToken({ idToken = null, accessToken = null }, linkCurrentAccount = true) {
  const res = await apiFetch('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ idToken, accessToken, linkCurrentAccount }),
  });
  if (res.ok && res.token) {
    return { ok: true, session: saveSessionFromResponse(res) };
  }
  return res;
}

export function loginGoogleIdToken(idToken, linkCurrentAccount = true) {
  return loginGoogleToken({ idToken }, linkCurrentAccount);
}

/** Cierra la sesión actual y abre una sesión Guest limpia en Neon. */
export async function switchToFreshGuest() {
  const newGuestId =
    crypto.randomUUID?.() ?? `g-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch { /* noop */ }
  const res = await apiFetch('/api/auth/guest', {
    method: 'POST',
    body: JSON.stringify({ guestId: newGuestId, displayName: 'Piloto' }),
  });
  if (res.ok && res.token) {
    return { ok: true, session: saveSessionFromResponse(res, newGuestId) };
  }
  return {
    ok: true,
    session: saveSessionFromResponse({ displayName: 'Piloto', provider: 'guest', token: null }, newGuestId),
  };
}

/** Descarga perfil completo de la nube (wallet, mejoras, naves, historia, misiones, stats). */
export async function fetchCloudProfile() {
  if (!dbOnline) return null;
  const res = await apiFetch('/api/profile');
  return res.ok ? res : null;
}

/** Sube un snapshot compacto del progreso local al usuario autenticado actual. */
export async function syncCloudProfile(snapshot, opts = {}) {
  if (!dbOnline || !getStoredAuth().token) return null;
  return await apiFetch('/api/profile/sync', {
    method: 'POST',
    body: JSON.stringify(snapshot),
    keepalive: Boolean(opts.keepalive),
  });
}

/** Solicita un challengeToken de un solo uso al empezar a volar. */
export async function startRemoteRun({ modeId = 'frenetic', storyLevel = null } = {}) {
  await initRemoteBackend().catch(() => {});
  if (!dbOnline || !getStoredAuth().token) return null;
  const res = await apiFetch('/api/runs/start', {
    method: 'POST',
    body: JSON.stringify({ modeId, storyLevel }),
  });
  if (!res.ok || !res.challengeToken) return null;
  return { challengeToken: res.challengeToken, seed: res.seed };
}

/** Envía la partida + replay para verificación anti-trampas y ranking global. */
export async function submitRemoteRun(payload) {
  await initRemoteBackend().catch(() => {});
  if (!dbOnline || !payload?.challengeToken) return null;
  return await apiFetch('/api/runs/finish', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 6000);
}

/** Obtiene el ranking global filtrado por período ('daily' | 'weekly' | 'monthly' | 'all'). */
export async function fetchGlobalLeaderboard(period = 'daily', limit = 15) {
  const res = await apiFetch(`/api/leaderboard?period=${encodeURIComponent(period)}&limit=${limit}&_t=${Date.now()}`);
  if (!res.ok || !Array.isArray(res.entries)) return null;
  return res.entries;
}

/** Envía telemetría de cada vuelo (Campaña o Endless) para analíticas del equipo. */
export async function reportRunTelemetry(payload) {
  if (!dbOnline) return null;
  return await apiFetch('/api/telemetry/run', {
    method: 'POST',
    body: JSON.stringify(payload),
    keepalive: true,
  }, 4000).catch(() => null);
}

/** Registra un evento liviano de sesión, embudo o error de cliente. */
export async function reportTelemetryEvent(eventType, payload = {}) {
  if (!dbOnline) return null;
  return await apiFetch('/api/telemetry/event', {
    method: 'POST',
    body: JSON.stringify({ eventType, ...payload }),
    keepalive: true,
  }, 4000).catch(() => null);
}

/** Obtiene métricas completas del panel Admin (restringido en backend al admin). */
export async function fetchAdminAnalytics(range = '7d') {
  return await apiFetch(`/api/admin/analytics?range=${encodeURIComponent(range)}`, {}, 8000);
}
