/**
 * ============================================================================
 * PAPERCRASH API — Backend Autoritativo (Render + Neon PostgreSQL)
 * ============================================================================
 * Endpoints:
 *   GET  /api/health                  Wake-up + estado de Neon
 *   POST /api/auth/guest              Alta/login rápido sin fricción
 *   POST /api/auth/login              Login o vinculación (google/google_play/steam)
 *   GET  /api/profile                 Billetera, inventario, historia y stats
 *   POST /api/runs/start              Emite challengeToken único + seed
 *   POST /api/runs/finish             Verifica replay headless + guarda run y score
 *   GET  /api/leaderboard             Ranking global (weekly | monthly | all)
 * ============================================================================
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pingDatabase, hasDatabase, query } from './db.js';
import { readBearerToken, upsertIdentity, verifySessionToken } from './auth.js';
import {
  getCachedLeaderboard,
  invalidateLeaderboardCache,
  setCachedLeaderboard,
} from './leaderboardCache.js';

// Importación directa del motor determinista puro del juego (sin DOM / Three.js)
import { verifyReplay } from '../../js/game/replay.js';
import { computeRunScoreBreakdown } from '../../js/game/score.js';

const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 64 * 1024;
const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ORIGIN || 'https://codehvrd.github.io,http://localhost:8080,http://127.0.0.1:8080')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.has(origin) || ALLOWED_ORIGINS.has('*'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload demasiado grande'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON inválido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function requireUserId(req) {
  const uid = verifySessionToken(readBearerToken(req));
  if (!uid) {
    throw Object.assign(new Error('Sesión inválida o expirada'), { status: 401 });
  }
  return uid;
}

async function handleRequest(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  // ── GET /api/health ─────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/health') {
    const db = await pingDatabase().catch((err) => ({
      connected: false,
      error: err.message,
    }));
    return sendJson(res, 200, { ok: true, service: 'papercrash-api', db });
  }

  if (!hasDatabase()) {
    return sendJson(res, 503, {
      ok: false,
      error: 'DATABASE_URL no configurado todavía en el servidor.',
    });
  }

  // ── POST /api/auth/guest ────────────────────────────────────
  if (req.method === 'POST' && path === '/api/auth/guest') {
    const body = await readJsonBody(req);
    const guestUid = String(body.guestId || randomUUID()).slice(0, 128);
    const session = await upsertIdentity({
      provider: 'guest',
      providerUid: guestUid,
      displayName: body.displayName || 'Piloto',
    });
    return sendJson(res, 200, { ok: true, ...session });
  }

  // ── POST /api/auth/login (Google / Google Play / Steam) ─────
  if (req.method === 'POST' && path === '/api/auth/login') {
    const body = await readJsonBody(req);
    const provider = String(body.provider || '');
    const providerUid = String(body.providerUid || '').trim();
    if (!['google', 'google_play', 'steam'].includes(provider) || !providerUid) {
      return sendJson(res, 400, { ok: false, error: 'Proveedor o identificador inválido' });
    }
    const existingUid = verifySessionToken(readBearerToken(req));
    // TODO producción: validar idToken (Google/Google Play) o SessionTicket (Steam Web API)
    const session = await upsertIdentity({
      provider,
      providerUid,
      displayName: body.displayName || 'Piloto',
      email: body.email || null,
      linkToUserId: body.linkCurrentAccount ? existingUid : null,
    });
    return sendJson(res, 200, { ok: true, ...session });
  }

  // ── GET /api/profile ────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/profile') {
    const userId = requireUserId(req);
    const [walletRows, invRows, storyRows, statsRows] = await Promise.all([
      query(`SELECT coins, gems, best_distance, best_score, active_aircraft, version FROM player_wallets WHERE user_id = $1`, [userId]),
      query(`SELECT item_type, item_id, level, quantity, metadata FROM player_inventory WHERE user_id = $1`, [userId]),
      query(`SELECT unlocked_level, endless_unlocked, stars_by_level FROM player_story_progress WHERE user_id = $1`, [userId]),
      query(`SELECT runs, total_distance, rings, boosters, near_misses, achievements FROM player_stats WHERE user_id = $1`, [userId]),
    ]);
    return sendJson(res, 200, {
      ok: true,
      wallet: walletRows[0] ?? null,
      inventory: invRows,
      story: storyRows[0] ?? null,
      stats: statsRows[0] ?? null,
    });
  }

  // ── POST /api/runs/start ────────────────────────────────────
  if (req.method === 'POST' && path === '/api/runs/start') {
    const userId = requireUserId(req);
    const body = await readJsonBody(req);
    const seed = Math.floor(Math.random() * 2_000_000_000);
    const modeId = String(body.modeId || 'frenetic').slice(0, 24);
    const storyLevel = body.storyLevel ? Number(body.storyLevel) : null;

    const rows = await query(
      `INSERT INTO run_challenges (user_id, seed, mode_id, story_level)
       VALUES ($1, $2, $3, $4)
       RETURNING token, seed, expires_at`,
      [userId, seed, modeId, storyLevel],
    );
    return sendJson(res, 200, {
      ok: true,
      challengeToken: rows[0].token,
      seed: rows[0].seed,
      expiresAt: rows[0].expires_at,
    });
  }

  // ── POST /api/runs/finish (Anti-trampas + Score + DB) ───────
  if (req.method === 'POST' && path === '/api/runs/finish') {
    const userId = requireUserId(req);
    const body = await readJsonBody(req);
    const { challengeToken, build, ship, upgrades, claimed, replay, missionsCompleted = 0 } = body;

    if (!challengeToken || !replay) {
      return sendJson(res, 400, { ok: false, error: 'Falta challengeToken o replay' });
    }

    const chRows = await query(
      `UPDATE run_challenges
       SET consumed_at = now()
       WHERE token = $1 AND user_id = $2 AND consumed_at IS NULL AND expires_at > now()
       RETURNING seed, mode_id`,
      [challengeToken, userId],
    );
    if (chRows.length === 0) {
      return sendJson(res, 409, { ok: false, error: 'Challenge inválido, expirado o ya usado' });
    }

    const { seed, mode_id: modeId } = chRows[0];
    const check = verifyReplay({
      seed,
      ship: String(ship || 'paper'),
      upgrades: upgrades && typeof upgrades === 'object' ? upgrades : {},
      replay,
      claimed: claimed && typeof claimed === 'object' ? claimed : null,
    });

    if (!check.verified) {
      return sendJson(res, 422, {
        ok: false,
        verified: false,
        reason: check.reason,
        deltaDistance: check.deltaDistance,
      });
    }

    const sim = check.simulated;
    const scoreData = computeRunScoreBreakdown(sim, Math.min(3, Math.max(0, Number(missionsCompleted) || 0)));

    await query(
      `INSERT INTO flight_runs (
         user_id, challenge_token, build, mode_id, aircraft, seed,
         distance, mts_score, coins_score, bonus_score, total_score,
         coins_earned, rings, boosters, near_misses, duration_sec, replay_payload, verified
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true)`,
      [
        userId,
        challengeToken,
        Number(build || 0),
        modeId,
        String(ship || 'paper'),
        seed,
        sim.distance,
        scoreData.mtsScore,
        scoreData.coinsScore,
        scoreData.bonusScore,
        scoreData.totalScore,
        sim.coins,
        sim.rings,
        sim.boosters,
        sim.nearMisses,
        sim.time,
        JSON.stringify(replay),
      ],
    );

    await query(
      `UPDATE player_wallets
       SET coins = coins + $2,
           best_distance = GREATEST(best_distance, $3),
           best_score = GREATEST(best_score, $4),
           version = version + 1,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, sim.coins, sim.distance, scoreData.totalScore],
    );

    invalidateLeaderboardCache();
    return sendJson(res, 200, {
      ok: true,
      verified: true,
      simulated: sim,
      score: scoreData,
    });
  }

  // ── GET /api/leaderboard?period=weekly|monthly|all ──────────
  if (req.method === 'GET' && path === '/api/leaderboard') {
    const rawPeriod = url.searchParams.get('period') || 'weekly';
    const period = ['weekly', 'monthly', 'all'].includes(rawPeriod) ? rawPeriod : 'weekly';
    const limit = Math.min(100, Math.max(5, Number(url.searchParams.get('limit') || 25)));

    const cacheKey = `${period}:${limit}`;
    const cached = getCachedLeaderboard(cacheKey);
    if (cached) {
      return sendJson(res, 200, cached, { 'Cache-Control': 'public, max-age=15' });
    }

    const whereClause =
      period === 'weekly'
        ? `AND r.created_at >= now() - INTERVAL '7 days'`
        : period === 'monthly'
          ? `AND r.created_at >= now() - INTERVAL '30 days'`
          : '';

    const rows = await query(
      `SELECT r.user_id, u.display_name, r.aircraft, r.distance, r.total_score, r.created_at
       FROM flight_runs r
       JOIN users u ON u.id = r.user_id
       WHERE r.verified = true AND u.is_banned = false ${whereClause}
       ORDER BY r.total_score DESC, r.distance DESC
       LIMIT $1`,
      [limit],
    );

    const payload = { ok: true, period, entries: rows };
    setCachedLeaderboard(cacheKey, payload);
    return sendJson(res, 200, payload, { 'Cache-Control': 'public, max-age=15' });
  }

  return sendJson(res, 404, { ok: false, error: 'Ruta no encontrada' });
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    const status = err.status || 500;
    console.error('[api-error]', err);
    if (!res.headersSent) {
      sendJson(res, status, { ok: false, error: err.message || 'Error interno' });
    }
  });
});

server.listen(PORT, () => {
  console.log(`[papercrash-api] escuchando en puerto ${PORT} (Neon: ${hasDatabase() ? 'configurado' : 'pendiente DATABASE_URL'})`);
});
