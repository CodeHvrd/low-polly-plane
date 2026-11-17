/**
 * PAPERCRASH API — Sesiones HMAC-SHA256, Contraseñas scrypt e Identidad Multi-Plataforma
 *
 * Soporta:
 *   · Guest instantáneo
 *   · Cuenta local (usuario + contraseña con scrypt + salt)
 *   · Google OAuth / Sign-In (verificación de ID Token con tokeninfo + GOOGLE_CLIENT_ID)
 *   · Google Play Games / Steam (extensible sobre la misma tabla `auth_identities`)
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
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

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, keyHex] = stored.split(':');
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derived = scryptSync(String(password), salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return timingSafeEqual(keyBuf, derived);
}

export function sanitizeDisplayName(name, fallback = 'Piloto') {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return clean.length >= 2 ? clean : fallback;
}

export function normalizeUsername(username) {
  return String(username || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '');
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function isValidPassword(password) {
  const s = String(password || '');
  return s.length >= 6 && /[a-zA-Z]/.test(s) && /[0-9]/.test(s);
}

async function createUserWithDefaults(displayName, avatarUrl = null) {
  const safeName = sanitizeDisplayName(displayName);
  const created = await query(
    `INSERT INTO users (display_name, avatar_url) VALUES ($1, $2) RETURNING id, display_name`,
    [safeName, avatarUrl],
  );
  const userId = created[0].id;
  await query(`INSERT INTO player_wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  await query(`INSERT INTO player_story_progress (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  await query(`INSERT INTO player_missions (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  await query(`INSERT INTO player_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  return userId;
}

export async function getUserAccountInfo(userId) {
  const [uRows, idRows] = await Promise.all([
    query(`SELECT id, display_name, avatar_url FROM users WHERE id = $1 LIMIT 1`, [userId]),
    query(`SELECT provider, provider_uid, email FROM auth_identities WHERE user_id = $1`, [userId]),
  ]);
  if (!uRows.length) return null;
  const u = uRows[0];
  const primaryProvider =
    idRows.find((r) => r.provider === 'google')?.provider ||
    idRows.find((r) => r.provider === 'local')?.provider ||
    idRows[0]?.provider ||
    'guest';
  const localRow = idRows.find((r) => r.provider === 'local');
  const googleRow = idRows.find((r) => r.provider === 'google');

  return {
    userId: u.id,
    displayName: u.display_name,
    avatarUrl: u.avatar_url || null,
    provider: primaryProvider,
    username: localRow?.provider_uid || null,
    email: googleRow?.email || localRow?.email || null,
    providers: idRows.map((r) => r.provider),
  };
}

/**
 * Crea o recupera un usuario por identidad (guest | google | google_play | steam).
 */
export async function upsertIdentity({
  provider,
  providerUid,
  displayName = 'Piloto',
  email = null,
  avatarUrl = null,
  linkToUserId = null,
}) {
  const existing = await query(
    `SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_uid = $2 LIMIT 1`,
    [provider, providerUid],
  );

  let userId;
  if (existing.length > 0) {
    userId = existing[0].user_id;
    await query(
      `UPDATE auth_identities SET last_login_at = now(), email = COALESCE($3, email)
       WHERE provider = $1 AND provider_uid = $2`,
      [provider, providerUid, email],
    );
    await query(
      `UPDATE users
       SET last_seen_at = now(),
           avatar_url = COALESCE($2, avatar_url)
       WHERE id = $1`,
      [userId, avatarUrl],
    );
  } else {
    userId = linkToUserId || (await createUserWithDefaults(displayName, avatarUrl));
    if (linkToUserId && displayName) {
      const safe = sanitizeDisplayName(displayName, '');
      if (safe) {
        await query(
          `UPDATE users SET display_name = CASE WHEN display_name = 'Piloto' THEN $2 ELSE display_name END,
                            avatar_url = COALESCE($3, avatar_url)
           WHERE id = $1`,
          [userId, safe, avatarUrl],
        );
      }
    }
    await query(
      `INSERT INTO auth_identities (user_id, provider, provider_uid, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, provider_uid) DO NOTHING`,
      [userId, provider, providerUid, email],
    );
  }

  const info = await getUserAccountInfo(userId);
  return {
    ...info,
    token: issueSessionToken(userId),
  };
}

/** Registra una cuenta local (email obligatorio + usuario + contraseña mín. 6 con letras y números). */
export async function registerLocalAccount({
  email,
  username,
  password,
  displayName,
  linkToUserId = null,
}) {
  const cleanEmail = normalizeEmail(email);
  if (!isValidEmail(cleanEmail)) {
    throw Object.assign(new Error('Ingresá un correo electrónico válido.'), { status: 400 });
  }
  const cleanUser = normalizeUsername(username);
  if (cleanUser.length < 3 || cleanUser.length > 24) {
    throw Object.assign(new Error('El usuario debe tener entre 3 y 24 caracteres (letras/números).'), { status: 400 });
  }
  if (!isValidPassword(password)) {
    throw Object.assign(new Error('La contraseña debe tener al menos 6 caracteres con letras y números.'), { status: 400 });
  }

  const dup = await query(
    `SELECT provider_uid, email FROM auth_identities
     WHERE provider = 'local' AND (provider_uid = $1 OR lower(email) = $2)
     LIMIT 1`,
    [cleanUser, cleanEmail],
  );
  if (dup.length > 0) {
    const msg = dup[0].email?.toLowerCase() === cleanEmail
      ? 'Ese correo ya tiene una cuenta asociada. Iniciá sesión.'
      : 'Ese nombre de usuario ya está en uso. Elegí otro.';
    throw Object.assign(new Error(msg), { status: 409 });
  }

  const safeName = sanitizeDisplayName(displayName || cleanUser, cleanUser);
  let userId = linkToUserId;
  if (userId) {
    await query(`UPDATE users SET display_name = $2, last_seen_at = now() WHERE id = $1`, [userId, safeName]);
  } else {
    userId = await createUserWithDefaults(safeName);
  }

  const pwHash = hashPassword(password);
  await query(
    `INSERT INTO auth_identities (user_id, provider, provider_uid, email, password_hash)
     VALUES ($1, 'local', $2, $3, $4)`,
    [userId, cleanUser, cleanEmail, pwHash],
  );

  const info = await getUserAccountInfo(userId);
  return {
    ...info,
    token: issueSessionToken(userId),
  };
}

/** Inicia sesión con usuario o email + contraseña locales. */
export async function loginLocalAccount({ identifier, username, password }) {
  const rawId = String(identifier ?? username ?? '').trim();
  const isMail = rawId.includes('@');
  const cleanUser = isMail ? normalizeEmail(rawId) : normalizeUsername(rawId);
  if (!cleanUser || !password) {
    throw Object.assign(new Error('Ingresá tu usuario (o mail) y contraseña.'), { status: 400 });
  }

  const rows = await query(
    `SELECT user_id, password_hash FROM auth_identities
     WHERE provider = 'local' AND ${isMail ? 'lower(email) = $1' : 'provider_uid = $1'}
     LIMIT 1`,
    [cleanUser],
  );
  if (!rows.length || !verifyPassword(password, rows[0].password_hash)) {
    throw Object.assign(new Error('Usuario/mail o contraseña incorrectos.'), { status: 401 });
  }

  const userId = rows[0].user_id;
  await query(
    `UPDATE auth_identities SET last_login_at = now() WHERE user_id = $1 AND provider = 'local'`,
    [userId],
  );
  await query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [userId]);

  const info = await getUserAccountInfo(userId);
  return {
    ...info,
    token: issueSessionToken(userId),
  };
}

/** Verifica un ID Token de Google Sign-In contra tokeninfo oficial. */
export async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw Object.assign(new Error('Falta idToken de Google.'), { status: 400 });
  }
  const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!resp.ok) {
    throw Object.assign(new Error('Token de Google inválido o expirado.'), { status: 401 });
  }
  const claims = await resp.json();
  const configuredAud = process.env.GOOGLE_CLIENT_ID?.trim();
  if (configuredAud && claims.aud !== configuredAud) {
    throw Object.assign(new Error('El token no corresponde a esta aplicación.'), { status: 401 });
  }
  if (!claims.sub) {
    throw Object.assign(new Error('Token de Google sin identificador sub.'), { status: 401 });
  }
  return {
    sub: String(claims.sub),
    email: claims.email ? String(claims.email) : null,
    name: claims.name ? String(claims.name) : 'Piloto',
    picture: claims.picture ? String(claims.picture) : null,
  };
}

export async function updateDisplayName(userId, displayName) {
  const safe = sanitizeDisplayName(displayName, '');
  if (!safe) {
    throw Object.assign(new Error('El nombre debe tener entre 2 y 24 caracteres.'), { status: 400 });
  }
  await query(`UPDATE users SET display_name = $2, last_seen_at = now() WHERE id = $1`, [userId, safe]);
  return safe;
}
