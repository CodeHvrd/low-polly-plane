# Arquitectura de Base de Datos en Neon (PostgreSQL Serverless) — PaperCrash

Esta guía define la infraestructura recomendada para conectar **PaperCrash** con **Neon Postgres**, **Google**, **Google Play Games** y **Steam**, manteniendo el cliente web/mobile ultra liviano y con latencia mínima.

---

## 1. Principios de Diseño (Por qué Neon + Edge API)

1. **Cliente 100% liviano**: El navegador / PWA **nunca** incluye drivers pesados de base de datos ni credenciales de Postgres. Se comunica por `fetch()` con endpoints REST/JSON livianos (Cloudflare Workers, Vercel Edge Functions o Node API) usando `@neondatabase/serverless` (conexiones HTTP/WebSocket sin handshake TCP lento).
2. **Local-first con sincronización asíncrona**:
   - El juego sigue guardando en `localStorage` de forma instantánea (`0 ms`).
   - Al terminar un vuelo o comprar una mejora, el cliente encola una sincronización en segundo plano con `version` optimista, de modo que una mala señal en mobile jamás traba el gameplay.
3. **Branching en Neon**:
   - `main` → Producción.
   - `staging` / `dev` → Ramas instantáneas de Neon para probar migraciones o eventos sin tocar datos reales.

---

## 2. Identidad Unificada Multi-Plataforma (`users` + `auth_identities`)

Para que un jugador pueda entrar hoy como invitado o con **Google / Google Play Games**, y mañana vincular **Steam** conservando sus monedas, aviones y récords:

- **`users`**: Entidad única del jugador (`id UUID`, `display_name`, `avatar_url`, `is_banned`).
- **`auth_identities`**: Tabla puente `N:1` hacia `users` con clave única `(provider, provider_uid)`:
  - `provider = 'google'` → `sub` de Google OAuth / OIDC.
  - `provider = 'google_play'` → `playerId` de Google Play Games Services.
  - `provider = 'steam'` → `steamid64` validado vía Steam Web API (`ISteamUserAuth/AuthenticateUserTicket`).
  - `provider = 'guest'` → UUID firmado en dispositivo, migrable automáticamente al vincular cuenta.

**Flujo de vinculación**: Si un jugador entra con `guest` y luego inicia sesión con Google o Steam, el backend reasigna o fusiona las filas hacia el `user_id` principal en una transacción ACID.

---

## 3. Inventario, Billetera y Concurrencia Segura

- **`player_wallets`**: Guarda `coins`, `gems`, `best_distance`, `best_score`, `active_aircraft` y una columna `version INT`.
  - Cada actualización usa *Optimistic Locking*: `UPDATE player_wallets SET coins = coins + $1, version = version + 1 WHERE user_id = $2 AND version = $3`.
  - Si dos pestañas o dispositivos intentan gastar las mismas monedas a la vez, una falla limpiamente y re-sincroniza.
- **`player_inventory`**: Tabla normalizada `(user_id, item_type, item_id)` (`aircraft`, `upgrade`, `cosmetic`, `booster`) con `level`, `quantity` y `metadata JSONB`. Permite agregar nuevas naves o cosméticos sin migraciones de columnas.
- **`player_story_progress`**, **`player_missions`** y **`player_stats`**: Separados por dominio para que actualizar estadísticas o misiones no bloquee consultas de ranking ni de inventario.

---

## 4. Anti-Trampas y Rankings Rápidos (Semanal / Mensual / All-Time)

El motor de física de PaperCrash ya es **determinista y pure-JS** (`js/game/replay.js`). El flujo seguro es:

1. **Inicio de vuelo (`POST /api/runs/start`)**: El servidor emite un `challenge_token` (UUID de un solo uso con TTL de 30 min) y la `seed` del corredor en `run_challenges`.
2. **Fin de vuelo (`POST /api/runs/finish`)**: El cliente envía `{ challengeToken, build, seed, ship, upgrades, claimed, replay }`.
3. **Verificación Headless**: El servidor re-simula el vuelo con `verifyReplay()` (toma `< 15 ms` en CPU por vuelo extenso). Si `deltaDistance` está dentro de tolerancia, marca `verified = true` en `flight_runs` y acredita `coins_earned` en `player_wallets`.
4. **Consultas de Ranking (`GET /api/leaderboard?period=weekly|monthly|all`)**:
   - **All-Time**: usa el índice parcial `idx_flight_runs_alltime_score (total_score DESC, distance DESC) WHERE verified = true`.
   - **Semanal / Mensual**: filtra `created_at >= date_trunc('week', now())` o `now() - INTERVAL '30 days'` apoyado en `idx_flight_runs_created_score`.
   - Respuesta cacheada en CDN/Edge durante `15–30 s` (`Cache-Control: public, s-maxage=20`), haciendo que miles de jugadores consulten el ranking sin golpear a Postgres.

---

## 5. Variables de Entorno Necesarias (Backend / Edge)

```env
DATABASE_URL=postgres://<user>:<password>@<endpoint>.neon.tech/papercrash?sslmode=require
JWT_SECRET=<clave-firma-sesiones>
GOOGLE_CLIENT_ID=<oauth-client-id>
STEAM_WEB_API_KEY=<steam-publisher-key>
```

El esquema DDL completo listo para ejecutar en Neon está en [db/schema.sql](file:///c:/Users/jajaj/Desktop/Ai%20proyects/plane-low-poly/db/schema.sql).
