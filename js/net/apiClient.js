/**
 * PAPERCRASH — net/apiClient.js
 * ============================================================
 * Cliente HTTP mínimo y no-bloqueante hacia la API de Vercel (/api/*).
 *
 * Principio local-first:
 *   · Si no hay internet o Neon todavía no está conectado, falla en silencio
 *     sin trabar ni retrasar el vuelo ni el menú.
 *   · Cuando está conectado, gestiona sesión guest/OAuth, solicita
 *     challengeToken para runs verificadas y alimenta el Ranking global.
 * ============================================================
 */

const AUTH_STORAGE_KEY = 'papercrash.auth.v1';
const PROD_VERCEL_ORIGIN = 'https://flyorcrash.vercel.app';

function resolveApiBase() {
  if (typeof window === 'undefined') return '';
  const { hostname, protocol } = window.location;
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.vercel.app')
  ) {
    return '';
  }
  if (protocol === 'https:' || protocol === 'http:') {
    return PROD_VERCEL_ORIGIN;
  }
  return PROD_VERCEL_ORIGIN;
}

function readAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAuth(data) {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
  } catch { /* modo privado */ }
}

async function apiFetch(path, opts = {}, timeoutMs = 4500) {
  const base = resolveApiBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const auth = readAuth();
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
let sessionPromise = null;

/** Verifica conectividad con Vercel + Neon y autentica usuario guest si hace falta. */
export async function initRemoteBackend() {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const health = await apiFetch('/api/health');
    if (!health.ok || !health.db?.connected) {
      dbOnline = false;
      return { online: false, reason: health.db?.reason || health.error || 'NO_DB' };
    }
    dbOnline = true;
    const auth = readAuth();
    if (!auth.token) {
      const guestId = auth.guestId || (crypto.randomUUID?.() ?? `g-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const login = await apiFetch('/api/auth/guest', {
        method: 'POST',
        body: JSON.stringify({ guestId }),
      });
      if (login.ok && login.token) {
        writeAuth({ guestId, userId: login.userId, token: login.token });
      }
    }
    return { online: true };
  })();
  return sessionPromise;
}

export function isRemoteOnline() {
  return dbOnline;
}

/** Solicita un challengeToken de un solo uso al empezar a volar. */
export async function startRemoteRun({ modeId = 'frenetic', storyLevel = null } = {}) {
  if (!dbOnline) return null;
  const res = await apiFetch('/api/runs/start', {
    method: 'POST',
    body: JSON.stringify({ modeId, storyLevel }),
  });
  if (!res.ok || !res.challengeToken) return null;
  return { challengeToken: res.challengeToken, seed: res.seed };
}

/** Envía la partida + replay para verificación anti-trampas y ranking global. */
export async function submitRemoteRun(payload) {
  if (!dbOnline || !payload?.challengeToken) return null;
  return await apiFetch('/api/runs/finish', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 6000);
}

/** Obtiene el ranking global filtrado por período ('weekly' | 'monthly' | 'all'). */
export async function fetchGlobalLeaderboard(period = 'weekly', limit = 15) {
  const res = await apiFetch(`/api/leaderboard?period=${encodeURIComponent(period)}&limit=${limit}`);
  if (!res.ok || !Array.isArray(res.entries)) return null;
  return res.entries;
}
