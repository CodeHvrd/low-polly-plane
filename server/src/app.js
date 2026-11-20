/**
 * ============================================================================
 * PAPERCRASH API — Router HTTP Agnóstico (Vercel Functions + Render/Node HTTP)
 * ============================================================================
 */
import { randomUUID } from 'node:crypto';
import { ensureSchema, hasDatabase, pingDatabase, query } from './db.js';
import {
  getUserAccountInfo,
  isAdminUser,
  loginLocalAccount,
  readBearerToken,
  registerLocalAccount,
  updateDisplayName,
  upsertIdentity,
  verifyGoogleToken,
  verifySessionToken,
} from './auth.js';
import {
  getCachedLeaderboard,
  invalidateLeaderboardCache,
  setCachedLeaderboard,
} from './leaderboardCache.js';

// Importación directa del motor determinista puro del juego (sin DOM / Three.js)
import { verifyReplay } from '../../js/game/replay.js';
import { computeRunScoreBreakdown } from '../../js/game/score.js';
import { hasMode, setMode } from '../../js/modes/index.js';

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_ORIGINS = [
  'https://flyorcrash.vercel.app',
  'https://codehvrd.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:3000',
];
if (process.env.VERCEL_URL) {
  DEFAULT_ORIGINS.push(`https://${process.env.VERCEL_URL}`);
}

const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ORIGIN || DEFAULT_ORIGINS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.has(origin) || origin.endsWith('.vercel.app') || ALLOWED_ORIGINS.has('*'))) {
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
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try {
        return Promise.resolve(JSON.parse(req.body || '{}'));
      } catch {
        return Promise.reject(Object.assign(new Error('JSON inválido'), { status: 400 }));
      }
    }
    return Promise.resolve(req.body && typeof req.body === 'object' ? req.body : {});
  }

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

export async function handleApiRequest(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
  const rawRoute = url.searchParams.get('__route');
  const path = rawRoute ? `/api/${rawRoute.replace(/^\/+/, '')}` : url.pathname;

  // ── GET /api/health ─────────────────────────────────────────
  if (req.method === 'GET' && (path === '/api/health' || path === '/api')) {
    const db = await pingDatabase().catch((err) => ({
      connected: false,
      error: err.message,
    }));
    return sendJson(res, 200, { ok: true, service: 'papercrash-api', db });
  }

  // ── GET /api/auth/config ────────────────────────────────────
  if (req.method === 'GET' && path === '/api/auth/config') {
    return sendJson(res, 200, {
      ok: true,
      googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
    });
  }

  if (!hasDatabase()) {
    return sendJson(res, 503, {
      ok: false,
      error: 'DATABASE_URL / POSTGRES_URL no configurado en Vercel.',
    });
  }

  await ensureSchema();

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

  // ── POST /api/auth/register (Mail + usuario + contraseña local) ─
  if (req.method === 'POST' && path === '/api/auth/register') {
    const body = await readJsonBody(req);
    const existingUid = verifySessionToken(readBearerToken(req));
    const linkCurrent = Boolean(body.linkCurrentAccount && existingUid);
    const session = await registerLocalAccount({
      email: body.email,
      username: body.username,
      password: body.password,
      displayName: body.displayName,
      linkToUserId: linkCurrent ? existingUid : null,
    });
    invalidateLeaderboardCache();
    return sendJson(res, 200, { ok: true, ...session });
  }

  // ── POST /api/auth/password-login ───────────────────────────
  if (req.method === 'POST' && path === '/api/auth/password-login') {
    const body = await readJsonBody(req);
    const session = await loginLocalAccount({
      identifier: body.identifier ?? body.username,
      password: body.password,
    });
    return sendJson(res, 200, { ok: true, ...session });
  }

  // ── POST /api/auth/google ───────────────────────────────────
  if (req.method === 'POST' && path === '/api/auth/google') {
    const body = await readJsonBody(req);
    const g = await verifyGoogleToken({ idToken: body.idToken, accessToken: body.accessToken });
    const existingUid = verifySessionToken(readBearerToken(req));
    const session = await upsertIdentity({
      provider: 'google',
      providerUid: g.sub,
      displayName: g.name,
      email: g.email,
      avatarUrl: g.picture,
      linkToUserId: body.linkCurrentAccount && existingUid ? existingUid : null,
    });
    invalidateLeaderboardCache();
    return sendJson(res, 200, { ok: true, ...session });
  }

  // ── POST /api/auth/login (Google Play / Steam / legacy hook) ─
  if (req.method === 'POST' && path === '/api/auth/login') {
    const body = await readJsonBody(req);
    const provider = String(body.provider || '');
    const providerUid = String(body.providerUid || '').trim();
    if (!['google_play', 'steam'].includes(provider) || !providerUid) {
      return sendJson(res, 400, { ok: false, error: 'Proveedor o identificador inválido' });
    }
    const existingUid = verifySessionToken(readBearerToken(req));
    const session = await upsertIdentity({
      provider,
      providerUid,
      displayName: body.displayName || 'Piloto',
      email: body.email || null,
      linkToUserId: body.linkCurrentAccount ? existingUid : null,
    });
    return sendJson(res, 200, { ok: true, ...session });
  }

  // ── GET /api/auth/me ────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/auth/me') {
    const userId = requireUserId(req);
    const user = await getUserAccountInfo(userId);
    if (!user) return sendJson(res, 404, { ok: false, error: 'Usuario no encontrado' });
    return sendJson(res, 200, { ok: true, user });
  }

  // ── POST /api/auth/profile (Actualizar alias de piloto) ─────
  if (req.method === 'POST' && path === '/api/auth/profile') {
    const userId = requireUserId(req);
    const body = await readJsonBody(req);
    const displayName = await updateDisplayName(userId, body.displayName);
    invalidateLeaderboardCache();
    const user = await getUserAccountInfo(userId);
    return sendJson(res, 200, { ok: true, displayName, user });
  }

  // ── GET /api/profile ────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/profile') {
    const userId = requireUserId(req);
    const [user, walletRows, invRows, storyRows, missionsRows, statsRows] = await Promise.all([
      getUserAccountInfo(userId),
      query(`SELECT coins, gems, best_distance, best_score, active_aircraft, version FROM player_wallets WHERE user_id = $1`, [userId]),
      query(`SELECT item_type, item_id, level, quantity, metadata FROM player_inventory WHERE user_id = $1`, [userId]),
      query(`SELECT unlocked_level, endless_unlocked, stars_by_level FROM player_story_progress WHERE user_id = $1`, [userId]),
      query(`SELECT active_ids, completed_ids, progress FROM player_missions WHERE user_id = $1`, [userId]),
      query(`SELECT runs, total_distance, play_ms, rings, boosters, coins_collected, near_misses, crashes, landings, achievements FROM player_stats WHERE user_id = $1`, [userId]),
    ]);
    return sendJson(res, 200, {
      ok: true,
      user,
      wallet: walletRows[0] ?? null,
      inventory: invRows,
      story: storyRows[0] ?? null,
      missions: missionsRows[0] ?? null,
      stats: statsRows[0] ?? null,
    });
  }

  // ── POST /api/profile/sync (Guarda progreso del usuario) ────
  if (req.method === 'POST' && path === '/api/profile/sync') {
    const userId = requireUserId(req);
    const body = await readJsonBody(req);
    const coins = Math.max(0, Math.round(Number(body.coins) || 0));
    const bestDistance = Math.max(0, Math.round(Number(body.bestDistance) || 0));
    const activeAircraft = String(body.aircraft || 'paper').slice(0, 24);

    await query(
      `UPDATE player_wallets
       SET coins = $2,
           best_distance = GREATEST(best_distance, $3),
           active_aircraft = $4,
           version = version + 1,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, coins, bestDistance, activeAircraft],
    );

    if (body.upgrades && typeof body.upgrades === 'object') {
      for (const [shipOrId, val] of Object.entries(body.upgrades)) {
        if (val && typeof val === 'object') {
          await query(
            `INSERT INTO player_inventory (user_id, item_type, item_id, level, quantity, metadata)
             VALUES ($1, 'upgrade', $2, 1, 1, $3::jsonb)
             ON CONFLICT (user_id, item_type, item_id)
             DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = now()`,
            [userId, String(shipOrId).slice(0, 48), JSON.stringify(val)],
          );
        } else {
          const level = Math.max(0, Math.min(20, Math.round(Number(val) || 0)));
          await query(
            `INSERT INTO player_inventory (user_id, item_type, item_id, level, quantity)
             VALUES ($1, 'upgrade', $2, $3, 1)
             ON CONFLICT (user_id, item_type, item_id)
             DO UPDATE SET level = EXCLUDED.level, updated_at = now()`,
            [userId, String(shipOrId).slice(0, 48), level],
          );
        }
      }
    }

    const ownedList = Array.isArray(body.ownedAircraft)
      ? body.ownedAircraft
      : (Array.isArray(body.aircraftOwned) ? body.aircraftOwned : null);
    if (ownedList) {
      for (const shipId of ownedList) {
        await query(
          `INSERT INTO player_inventory (user_id, item_type, item_id, level, quantity)
           VALUES ($1, 'aircraft', $2, 1, 1)
           ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
          [userId, String(shipId).slice(0, 48)],
        );
      }
    }

    if (body.story && typeof body.story === 'object') {
      const unlocked = Math.max(1, Math.min(6, Math.round(Number(body.story.unlockedLevel) || 1)));
      const endless = Boolean(body.story.endlessUnlocked);
      const starsPayload = { ...(body.story.stars || {}) };
      if (Array.isArray(body.story.usedAircraft)) {
        starsPayload._usedAircraft = body.story.usedAircraft;
      }
      const stars = JSON.stringify(starsPayload);
      await query(
        `UPDATE player_story_progress
         SET unlocked_level = $2, endless_unlocked = $3, stars_by_level = $4::jsonb, updated_at = now()
         WHERE user_id = $1`,
        [userId, unlocked, endless, stars],
      );
    }

    if (body.missions && typeof body.missions === 'object') {
      await query(
        `UPDATE player_missions
         SET active_ids = $2::jsonb, completed_ids = $3::jsonb, progress = $4::jsonb, updated_at = now()
         WHERE user_id = $1`,
        [
          userId,
          JSON.stringify(body.missions.active || []),
          JSON.stringify(body.missions.completed || []),
          JSON.stringify(body.missions.progress || {}),
        ],
      );
    }

    if (body.stats && typeof body.stats === 'object') {
      const s = body.stats;
      await query(
        `UPDATE player_stats
         SET runs = GREATEST(runs, $2),
             total_distance = GREATEST(total_distance, $3),
             play_ms = GREATEST(play_ms, $4),
             rings = GREATEST(rings, $5),
             boosters = GREATEST(boosters, $6),
             coins_collected = GREATEST(coins_collected, $7),
             near_misses = GREATEST(near_misses, $8),
             crashes = GREATEST(crashes, $9),
             landings = GREATEST(landings, $10),
             updated_at = now()
         WHERE user_id = $1`,
        [
          userId,
          Math.max(0, Math.round(Number(s.runs) || 0)),
          Math.max(0, Math.round(Number(s.totalDistance) || 0)),
          Math.max(0, Math.round(Number(s.playMs) || 0)),
          Math.max(0, Math.round(Number(s.rings) || 0)),
          Math.max(0, Math.round(Number(s.boosters) || 0)),
          Math.max(0, Math.round(Number(s.coinsCollected) || 0)),
          Math.max(0, Math.round(Number(s.nearMisses) || 0)),
          Math.max(0, Math.round(Number(s.crashes) || 0)),
          Math.max(0, Math.round(Number(s.landings) || 0)),
        ],
      );
    }

    return sendJson(res, 200, { ok: true });
  }

  // ── POST /api/runs/start ────────────────────────────────────
  if (req.method === 'POST' && path === '/api/runs/start') {
    const userId = requireUserId(req);
    const body = await readJsonBody(req);
    const seed = Math.floor(Math.random() * 2_000_000_000);
    const modeId = String(body.modeId || 'frenetic').slice(0, 24);
    const storyLevel = body.storyLevel ? Number(body.storyLevel) : null;

    const rows = await query(
      `INSERT INTO run_challenges (user_id, seed, mode_id, story_level, expires_at)
       VALUES ($1, $2, $3, $4, now() + INTERVAL '4 hours')
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
    if (hasMode(modeId)) setMode(modeId);
    const claimedDist = Math.max(0, Number(claimed?.distance) || 0);
    const claimedCoins = Math.max(0, Number(claimed?.coins) || 0);
    const check = verifyReplay({
      seed,
      ship: String(ship || 'paper'),
      upgrades: upgrades && typeof upgrades === 'object' ? upgrades : {},
      replay,
      claimed: claimed && typeof claimed === 'object' ? claimed : null,
      toleranceMeters: Math.max(50, Math.round(claimedDist * 0.05)),
      toleranceCoins: Math.max(50, Math.round(claimedCoins * 0.08)),
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

  // ── GET /api/leaderboard?period=daily|weekly|monthly|all ─────
  if (req.method === 'GET' && path === '/api/leaderboard') {
    const rawPeriod = url.searchParams.get('period') || 'daily';
    const period = ['daily', 'weekly', 'monthly', 'all'].includes(rawPeriod) ? rawPeriod : 'daily';
    const limit = Math.min(100, Math.max(5, Number(url.searchParams.get('limit') || 25)));

    const whereClause =
      period === 'daily'
        ? `AND r.created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires')`
        : period === 'weekly'
          ? `AND r.created_at >= now() - INTERVAL '7 days'
             AND EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id AND ai.provider <> 'guest')`
          : period === 'monthly'
            ? `AND r.created_at >= now() - INTERVAL '30 days'
               AND EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id AND ai.provider <> 'guest')`
            : `AND EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id AND ai.provider <> 'guest')`;

    const distanceCol = period === 'all'
      ? `GREATEST(COALESCE(pw.best_distance, 0), r.distance) AS distance`
      : `r.distance`;

    const rows = await query(
      `SELECT best.*
       FROM (
         SELECT DISTINCT ON (r.user_id)
                r.user_id,
                u.display_name,
                NOT EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id AND ai.provider <> 'guest') AS is_guest,
                GREATEST(COALESCE(pw.best_score, 0), r.total_score) AS best_score,
                r.aircraft,
                ${distanceCol},
                r.total_score,
                r.created_at
         FROM flight_runs r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN player_wallets pw ON pw.user_id = r.user_id
         WHERE r.verified = true AND u.is_banned = false ${whereClause}
         ORDER BY r.user_id, r.total_score DESC, r.distance DESC, r.created_at DESC
       ) best
       ORDER BY best.total_score DESC, best.distance DESC
       LIMIT $1`,
      [limit],
    );

    const payload = { ok: true, period, entries: rows };
    return sendJson(res, 200, payload, { 'Cache-Control': 'no-store' });
  }

  // ── POST /api/telemetry/run (Registra cada corrida para analíticas) ─
  if (req.method === 'POST' && path === '/api/telemetry/run') {
    const uid = verifySessionToken(readBearerToken(req));
    const body = await readJsonBody(req);
    const num = (v, fallback = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    let isGuest = true;
    if (uid) {
      const idRows = await query(
        `SELECT 1 FROM auth_identities WHERE user_id = $1 AND provider <> 'guest' LIMIT 1`,
        [uid],
      );
      isGuest = idRows.length === 0;
      await query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [uid]);
    }

    await query(
      `INSERT INTO run_telemetry (
         user_id, is_guest, device_type, platform, build,
         mode, story_level, aircraft, distance, duration_sec,
         max_speed, max_altitude, score, coins_earned, rings, boosters, near_misses,
         end_cause, end_kind, obstacle_type, crash_x, crash_y, crash_z, stage_index, avg_fps
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
      [
        uid || null,
        isGuest,
        String(body.deviceType || 'desktop').slice(0, 16),
        body.platform ? String(body.platform).slice(0, 64) : null,
        Math.max(0, Math.round(num(body.build, 0))),
        body.mode === 'story' ? 'story' : 'endless',
        body.storyLevel ? Math.max(1, Math.min(6, Math.round(num(body.storyLevel, 1)))) : null,
        String(body.aircraft || 'paper').slice(0, 24),
        Math.max(0, Math.round(num(body.distance, 0))),
        Math.max(0, num(body.durationSec, 0)),
        Math.max(0, num(body.maxSpeed, 0)),
        Math.max(0, num(body.maxAltitude, 0)),
        Math.max(0, Math.round(num(body.score, 0))),
        Math.max(0, Math.round(num(body.coinsEarned, 0))),
        Math.max(0, Math.round(num(body.rings, 0))),
        Math.max(0, Math.round(num(body.boosters, 0))),
        Math.max(0, Math.round(num(body.nearMisses, 0))),
        String(body.endCause || 'ground').slice(0, 24),
        String(body.endKind || 'crash').slice(0, 16),
        body.obstacleType ? String(body.obstacleType).slice(0, 32) : null,
        body.crashX !== null && body.crashX !== undefined ? num(body.crashX, 0) : null,
        body.crashY !== null && body.crashY !== undefined ? num(body.crashY, 0) : null,
        body.crashZ !== null && body.crashZ !== undefined ? num(body.crashZ, 0) : null,
        Math.max(0, Math.round(num(body.stageIndex, 0))),
        body.avgFps !== null && body.avgFps !== undefined ? Math.max(0, Math.min(240, num(body.avgFps, 0))) : null,
      ],
    );
    return sendJson(res, 200, { ok: true });
  }

  // ── POST /api/telemetry/event (Sesiones, errores y eventos clave) ─
  if (req.method === 'POST' && path === '/api/telemetry/event') {
    const uid = verifySessionToken(readBearerToken(req));
    const body = await readJsonBody(req);
    const eventType = String(body.eventType || 'ping').slice(0, 32);
    const deviceType = String(body.deviceType || 'desktop').slice(0, 16);
    const build = Math.max(0, Math.round(Number(body.build) || 0));
    const safePayload = body.payload && typeof body.payload === 'object' ? body.payload : {};

    if (uid) {
      await query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [uid]);
    }
    await query(
      `INSERT INTO client_telemetry_events (user_id, event_type, device_type, build, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [uid || null, eventType, deviceType, build, JSON.stringify(safePayload)],
    );
    return sendJson(res, 200, { ok: true });
  }

  // ── GET /api/admin/analytics (SOLO ADMIN: juanmaarosales@gmail.com) ─
  if (req.method === 'GET' && path === '/api/admin/analytics') {
    const userId = requireUserId(req);
    const isAdmin = await isAdminUser(userId);
    if (!isAdmin) {
      return sendJson(res, 403, { ok: false, error: 'Acceso restringido al administrador.' });
    }

    const rawRange = url.searchParams.get('range') || '7d';
    const range = ['24h', '7d', '30d', 'all'].includes(rawRange) ? rawRange : '7d';
    const intervalSql =
      range === '24h'
        ? `created_at >= now() - INTERVAL '24 hours'`
        : range === '7d'
          ? `created_at >= now() - INTERVAL '7 days'`
          : range === '30d'
            ? `created_at >= now() - INTERVAL '30 days'`
            : 'TRUE';

    const [
      usersAgg,
      runSummary,
      causeRows,
      obstacleRows,
      bucketRows,
      storyRows,
      shipRows,
      errorRows,
      recentRunRows,
    ] = await Promise.all([
      query(`
        SELECT
          COUNT(*)::int AS total_users,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id AND ai.provider <> 'guest'))::int AS registered_users,
          COUNT(*) FILTER (WHERE last_seen_at >= now() - INTERVAL '24 hours')::int AS active_24h,
          COUNT(*) FILTER (WHERE last_seen_at >= now() - INTERVAL '7 days')::int AS active_7d,
          COALESCE(SUM(ps.play_ms), 0)::bigint AS total_play_ms,
          COALESCE(MAX(pw.best_distance), 0)::int AS max_best_distance
        FROM users u
        LEFT JOIN player_stats ps ON ps.user_id = u.id
        LEFT JOIN player_wallets pw ON pw.user_id = u.id
      `),
      query(`
        SELECT
          COUNT(*)::int AS total_runs,
          COALESCE(AVG(duration_sec), 0)::real AS avg_duration_sec,
          COALESCE(SUM(duration_sec), 0)::real AS sum_duration_sec,
          COALESCE(AVG(distance), 0)::real AS avg_distance,
          COALESCE(MAX(distance), 0)::int AS max_distance,
          COUNT(*) FILTER (WHERE device_type = 'mobile')::int AS mobile_runs,
          COALESCE(AVG(avg_fps) FILTER (WHERE device_type = 'mobile' AND avg_fps > 0), 0)::real AS avg_fps_mobile,
          COALESCE(AVG(avg_fps) FILTER (WHERE device_type = 'desktop' AND avg_fps > 0), 0)::real AS avg_fps_desktop
        FROM run_telemetry
        WHERE ${intervalSql}
      `),
      query(`
        SELECT end_cause, COUNT(*)::int AS cnt
        FROM run_telemetry
        WHERE ${intervalSql}
        GROUP BY end_cause
        ORDER BY cnt DESC
      `),
      query(`
        SELECT obstacle_type, COUNT(*)::int AS cnt, COALESCE(AVG(distance), 0)::int AS avg_dist
        FROM run_telemetry
        WHERE ${intervalSql} AND end_cause = 'obstacle' AND obstacle_type IS NOT NULL
        GROUP BY obstacle_type
        ORDER BY cnt DESC
        LIMIT 8
      `),
      query(`
        SELECT bucket, COUNT(*)::int AS cnt
        FROM (
          SELECT CASE
            WHEN distance < 50 THEN '0–50m'
            WHEN distance < 150 THEN '50–150m'
            WHEN distance < 350 THEN '150–350m'
            WHEN distance < 700 THEN '350–700m'
            WHEN distance < 1500 THEN '700–1500m'
            WHEN distance < 3000 THEN '1500–3000m'
            ELSE '3000m+'
          END AS bucket
          FROM run_telemetry
          WHERE ${intervalSql}
        ) b
        GROUP BY bucket
      `),
      query(`
        SELECT
          story_level,
          COUNT(*)::int AS attempts,
          COUNT(*) FILTER (WHERE end_cause = 'finish')::int AS passes,
          COALESCE(AVG(distance), 0)::int AS avg_dist
        FROM run_telemetry
        WHERE ${intervalSql} AND mode = 'story' AND story_level IS NOT NULL
        GROUP BY story_level
        ORDER BY story_level ASC
      `),
      query(`
        SELECT
          aircraft,
          COUNT(*)::int AS runs,
          COALESCE(AVG(distance), 0)::int AS avg_dist,
          COALESCE(AVG(duration_sec), 0)::real AS avg_sec,
          COUNT(*) FILTER (WHERE end_cause = 'obstacle')::int AS obstacle_crashes
        FROM run_telemetry
        WHERE ${intervalSql}
        GROUP BY aircraft
        ORDER BY runs DESC
      `),
      query(`
        SELECT device_type, build, payload, created_at
        FROM client_telemetry_events
        WHERE event_type = 'client_error' AND ${intervalSql}
        ORDER BY created_at DESC
        LIMIT 12
      `),
      query(`
        SELECT
          COALESCE(u.display_name, 'Anónimo') AS display_name,
          rt.is_guest,
          rt.device_type,
          rt.mode,
          rt.story_level,
          rt.aircraft,
          rt.distance,
          rt.duration_sec,
          rt.score,
          rt.end_cause,
          rt.obstacle_type,
          rt.avg_fps,
          rt.created_at
        FROM run_telemetry rt
        LEFT JOIN users u ON u.id = rt.user_id
        WHERE ${intervalSql}
        ORDER BY rt.created_at DESC
        LIMIT 15
      `),
    ]);

    const u0 = usersAgg[0] || {};
    const r0 = runSummary[0] || {};
    const totalRuns = r0.total_runs || 0;
    const mobileSharePct = totalRuns > 0 ? Math.round(((r0.mobile_runs || 0) / totalRuns) * 100) : 0;

    return sendJson(res, 200, {
      ok: true,
      range,
      summary: {
        totalUsers: u0.total_users || 0,
        registeredUsers: u0.registered_users || 0,
        guestUsers: Math.max(0, (u0.total_users || 0) - (u0.registered_users || 0)),
        active24h: u0.active_24h || 0,
        active7d: u0.active_7d || 0,
        totalPlayMin: Math.round(Number(u0.total_play_ms || 0) / 60000),
        maxBestDistance: u0.max_best_distance || 0,
        totalRuns,
        avgRunSec: Number((r0.avg_duration_sec || 0).toFixed(1)),
        sumRunMin: Math.round(Number(r0.sum_duration_sec || 0) / 60),
        avgDistance: Math.round(r0.avg_distance || 0),
        maxDistance: r0.max_distance || 0,
        mobileSharePct,
        avgFpsMobile: Math.round(r0.avg_fps_mobile || 0),
        avgFpsDesktop: Math.round(r0.avg_fps_desktop || 0),
      },
      deathCauses: causeRows,
      deadlyObstacles: obstacleRows,
      distanceBuckets: bucketRows,
      storyFunnel: storyRows,
      aircraftStats: shipRows,
      recentErrors: errorRows,
      recentRuns: recentRunRows,
    }, { 'Cache-Control': 'no-store' });
  }

  return sendJson(res, 404, { ok: false, error: 'Ruta no encontrada' });
}
