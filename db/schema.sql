-- ============================================================================
-- PAPERCRASH — Esquema PostgreSQL para Neon (Serverless Postgres)
-- ============================================================================
-- Diseñado para:
--   1. Identidad unificada multi-plataforma (Google, Google Play Games, Steam, Guest)
--   2. Inventario y billetera con control de concurrencia optimista (sin double-spend)
--   3. Progresión de Modo Historia, Misiones y Estadísticas
--   4. Vuelos verificados anti-trampas (seed + replay + challenge_token)
--   5. Rankings ágiles: Semanal, Mensual y All-Time (índices compuestos)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. USUARIOS E IDENTIDADES MULTI-PLATAFORMA
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    VARCHAR(32) NOT NULL DEFAULT 'Piloto',
  avatar_url      TEXT,
  country_code    CHAR(2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_banned       BOOLEAN NOT NULL DEFAULT false
);

-- Un mismo usuario puede vincular múltiples proveedores (Google + Google Play + Steam)
CREATE TABLE IF NOT EXISTS auth_identities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         VARCHAR(24) NOT NULL CHECK (provider IN ('google', 'google_play', 'steam', 'guest')),
  provider_uid     VARCHAR(128) NOT NULL,
  email            VARCHAR(255),
  linked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);

-- ----------------------------------------------------------------------------
-- 2. BILLETERA, INVENTARIO Y PROGRESIÓN (LIVIANO Y CONSISTENTE)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_wallets (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coins           BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0),
  gems            INT NOT NULL DEFAULT 0 CHECK (gems >= 0),
  best_distance   INT NOT NULL DEFAULT 0 CHECK (best_distance >= 0),
  best_score      BIGINT NOT NULL DEFAULT 0 CHECK (best_score >= 0),
  active_aircraft VARCHAR(24) NOT NULL DEFAULT 'paper',
  -- Control de concurrencia optimista: evita duplicar monedas en requests paralelos
  version         INT NOT NULL DEFAULT 1,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inventario unificado: aeronaves, mejoras, cosméticos y consumibles
CREATE TABLE IF NOT EXISTS player_inventory (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type       VARCHAR(24) NOT NULL CHECK (item_type IN ('aircraft', 'upgrade', 'cosmetic', 'booster')),
  item_id         VARCHAR(48) NOT NULL,
  level           SMALLINT NOT NULL DEFAULT 1 CHECK (level >= 0),
  quantity        INT NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  acquired_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_type, item_id)
);

-- Progresión del Modo Historia (niveles 1..5 y desbloqueo Endless)
CREATE TABLE IF NOT EXISTS player_story_progress (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  unlocked_level   SMALLINT NOT NULL DEFAULT 1 CHECK (unlocked_level BETWEEN 1 AND 5),
  endless_unlocked BOOLEAN NOT NULL DEFAULT false,
  stars_by_level   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Misiones activas (3 slots), completadas y progreso acumulado
CREATE TABLE IF NOT EXISTS player_missions (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  progress        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Estadísticas acumuladas y logros
CREATE TABLE IF NOT EXISTS player_stats (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  runs            INT NOT NULL DEFAULT 0,
  total_distance  BIGINT NOT NULL DEFAULT 0,
  play_ms         BIGINT NOT NULL DEFAULT 0,
  rings           INT NOT NULL DEFAULT 0,
  boosters        INT NOT NULL DEFAULT 0,
  coins_collected INT NOT NULL DEFAULT 0,
  near_misses     INT NOT NULL DEFAULT 0,
  crashes         INT NOT NULL DEFAULT 0,
  landings        INT NOT NULL DEFAULT 0,
  achievements    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. CHALLENGES ANTI-TRAMPAS Y VUELOS VERIFICADOS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_challenges (
  token           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seed            INT NOT NULL,
  mode_id         VARCHAR(24) NOT NULL DEFAULT 'frenetic',
  story_level     SMALLINT,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
  consumed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_run_challenges_user_active
  ON run_challenges(user_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS flight_runs (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_token UUID UNIQUE REFERENCES run_challenges(token),
  build           INT NOT NULL,
  mode_id         VARCHAR(24) NOT NULL DEFAULT 'frenetic',
  aircraft        VARCHAR(24) NOT NULL,
  seed            INT NOT NULL,
  distance        INT NOT NULL CHECK (distance >= 0),
  mts_score       INT NOT NULL CHECK (mts_score >= 0),
  coins_score     INT NOT NULL CHECK (coins_score >= 0),
  bonus_score     INT NOT NULL CHECK (bonus_score >= 0),
  total_score     BIGINT NOT NULL CHECK (total_score >= 0),
  coins_earned    INT NOT NULL DEFAULT 0 CHECK (coins_earned >= 0),
  rings           INT NOT NULL DEFAULT 0,
  boosters        INT NOT NULL DEFAULT 0,
  near_misses     INT NOT NULL DEFAULT 0,
  duration_sec    REAL NOT NULL DEFAULT 0,
  replay_payload  JSONB,
  verified        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 4. ÍNDICES DE RANKING (SEMANAL, MENSUAL, ALL-TIME)
-- ----------------------------------------------------------------------------
-- Solo entran al ranking público los vuelos verificados de usuarios no baneados.
CREATE INDEX IF NOT EXISTS idx_flight_runs_alltime_score
  ON flight_runs (total_score DESC, distance DESC)
  WHERE verified = true;

CREATE INDEX IF NOT EXISTS idx_flight_runs_created_score
  ON flight_runs (created_at DESC, total_score DESC)
  WHERE verified = true;

CREATE INDEX IF NOT EXISTS idx_flight_runs_user_best
  ON flight_runs (user_id, total_score DESC);
