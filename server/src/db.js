/**
 * PAPERCRASH API — Acceso a Neon PostgreSQL (@neondatabase/serverless Pool)
 */
import { Pool } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const connectionString = (
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  ''
).trim();

const pool = connectionString ? new Pool({ connectionString, max: 5 }) : null;

let schemaReadyPromise = null;

export function hasDatabase() {
  return Boolean(pool);
}

/**
 * Ejecuta una consulta parametrizada en Neon usando $1, $2, ...
 * @param {string} queryText
 * @param {any[]} [params]
 * @returns {Promise<any[]>}
 */
export async function query(queryText, params = []) {
  if (!pool) {
    throw new Error('DATABASE_URL / POSTGRES_URL no configurado en las variables de entorno.');
  }
  const res = await pool.query(queryText, params);
  return res.rows;
}

/**
 * Garantiza que el esquema y migraciones incrementales existan en Neon.
 * Corre una sola vez por instancia.
 */
export async function ensureSchema() {
  if (!pool) return false;
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const check = await pool.query(`SELECT to_regclass('public.users') AS tbl`);
      if (!check.rows?.[0]?.tbl) {
        const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
        const ddl = readFileSync(join(rootDir, 'db', 'schema.sql'), 'utf8');
        await pool.query(ddl);
      }

      // Migración idempotente para cuentas locales (usuario + contraseña)
      const colCheck = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'auth_identities' AND column_name = 'password_hash'
         LIMIT 1`,
      );
      if (colCheck.rowCount === 0) {
        await pool.query(`ALTER TABLE auth_identities ADD COLUMN IF NOT EXISTS password_hash TEXT`);
        await pool.query(`ALTER TABLE auth_identities DROP CONSTRAINT IF EXISTS auth_identities_provider_check`);
        await pool.query(
          `ALTER TABLE auth_identities
           ADD CONSTRAINT auth_identities_provider_check
           CHECK (provider IN ('google', 'google_play', 'steam', 'guest', 'local'))`,
        );
      }

      // Migración idempotente: Campaña ampliada de 5 a 6 niveles
      const storyChk = await pool.query(
        `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
         WHERE conrelid = 'public.player_story_progress'::regclass
           AND conname = 'player_story_progress_unlocked_level_check'`,
      );
      if (storyChk.rows?.[0]?.def?.includes('5')) {
        await pool.query(`ALTER TABLE player_story_progress DROP CONSTRAINT IF EXISTS player_story_progress_unlocked_level_check`);
        await pool.query(
          `ALTER TABLE player_story_progress
           ADD CONSTRAINT player_story_progress_unlocked_level_check
           CHECK (unlocked_level BETWEEN 1 AND 6)`,
        );
      }
      // Migración idempotente: tablas de telemetría y analíticas de administrador
      await pool.query(`
        CREATE TABLE IF NOT EXISTS run_telemetry (
          id            BIGSERIAL PRIMARY KEY,
          user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
          is_guest      BOOLEAN NOT NULL DEFAULT true,
          device_type   VARCHAR(16) NOT NULL DEFAULT 'desktop',
          platform      VARCHAR(64),
          build         INT NOT NULL DEFAULT 0,
          mode          VARCHAR(16) NOT NULL DEFAULT 'endless',
          story_level   SMALLINT,
          aircraft      VARCHAR(24) NOT NULL DEFAULT 'paper',
          distance      INT NOT NULL DEFAULT 0,
          duration_sec  REAL NOT NULL DEFAULT 0,
          max_speed     REAL NOT NULL DEFAULT 0,
          max_altitude  REAL NOT NULL DEFAULT 0,
          score         BIGINT NOT NULL DEFAULT 0,
          coins_earned  INT NOT NULL DEFAULT 0,
          rings         INT NOT NULL DEFAULT 0,
          boosters      INT NOT NULL DEFAULT 0,
          near_misses   INT NOT NULL DEFAULT 0,
          end_cause     VARCHAR(24) NOT NULL DEFAULT 'ground',
          end_kind      VARCHAR(16) NOT NULL DEFAULT 'crash',
          obstacle_type VARCHAR(32),
          crash_x       REAL,
          crash_y       REAL,
          crash_z       REAL,
          stage_index   SMALLINT NOT NULL DEFAULT 0,
          avg_fps       REAL,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_run_telemetry_created ON run_telemetry(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_run_telemetry_mode_lvl ON run_telemetry(mode, story_level, created_at DESC);
        CREATE TABLE IF NOT EXISTS client_telemetry_events (
          id          BIGSERIAL PRIMARY KEY,
          user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
          event_type  VARCHAR(32) NOT NULL,
          device_type VARCHAR(16) NOT NULL DEFAULT 'desktop',
          build       INT NOT NULL DEFAULT 0,
          payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_client_telemetry_type_created ON client_telemetry_events(event_type, created_at DESC);
      `);
      return true;
    })().catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }
  return schemaReadyPromise;
}

/** Ping rápido para /api/health (también despierta + verifica tablas en Neon). */
export async function pingDatabase() {
  if (!pool) return { connected: false, reason: 'NO_DATABASE_URL' };
  const rows = await query('SELECT 1 AS ok');
  let schemaReady = false;
  let schemaError = null;
  try {
    schemaReady = await ensureSchema();
  } catch (err) {
    schemaError = err.message;
  }
  return {
    connected: rows?.[0]?.ok === 1,
    schemaReady,
    ...(schemaError ? { schemaError } : {}),
  };
}
