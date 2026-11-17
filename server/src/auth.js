/**
 * PAPERCRASH API — Sesiones HMAC-SHA256 e Identidad Multi-Plataforma
 *
 * Permite arrancar como invitado (guest) y vincular luego Google,
 * Google Play Games o Steam manteniendo un mismo `user_id` en Neon.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { query } from './db.js';

const DEV_SECRET = 'papercrash-dev-secret-change-in-production';
const AUTH_SECRET = process.env.AUTH_SECRET?.trim() || DEV_SECRET;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function toB64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadB64) {
  return createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
}

export function issueSessionToken(userId) {
  const payload = { uid: userId, exp: Date.now() + TOKEN_TTL_MS };
  const b64 = toB64Url(JSON.stringify(payload));
  return `${b64}.${sign(b64)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expected = sign(b64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!payload?.uid || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
      return null;
    }
    return payload.uid;
  } catch {
    return null;
  }
}

export function readBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

/**
 * Crea o recupera un usuario por identidad (guest | google | google_play | steam).
 * Si se pasa `linkToUserId` y esa identidad no existía, la asocia al usuario actual.
 */
export async function upsertIdentity({
  provider,
  providerUid,
  displayName = 'Piloto',
  email = null,
  linkToUserId = null,
}) {
  const safeName = String(displayName || 'Piloto').trim().slice(0, 32) || 'Piloto';
  const existing = await query(
    `SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_uid = $2 LIMIT 1`,
    [provider, providerUid],
  );

  let userId;
  if (existing.length > 0) {
    userId = existing[0].user_id;
    await query(
      `UPDATE auth_identities SET last_login_at = now() WHERE provider = $1 AND provider_uid = $2`,
      [provider, providerUid],
    );
    await query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [userId]);
  } else {
    if (linkToUserId) {
      userId = linkToUserId;
    } else {
      const created = await query(
        `INSERT INTO users (display_name) VALUES ($1) RETURNING id`,
        [safeName],
      );
      userId = created[0].id;
      await query(`INSERT INTO player_wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
      await query(`INSERT INTO player_story_progress (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
      await query(`INSERT INTO player_missions (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
      await query(`INSERT INTO player_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
    }
    await query(
      `INSERT INTO auth_identities (user_id, provider, provider_uid, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, provider_uid) DO NOTHING`,
      [userId, provider, providerUid, email],
    );
  }

  return {
    userId,
    token: issueSessionToken(userId),
  };
}
