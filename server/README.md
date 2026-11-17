# PaperCrash API (`server/`) — Render + Neon PostgreSQL

Backend liviano en Node.js puro (sin Express) que reutiliza el motor físico determinista del juego (`js/game/replay.js` y `js/game/score.js`) para validar partidas sin trampa y guardar usuarios, inventario y rankings en Neon.

---

## Cómo desplegar en Render (Free Tier o Starter)

1. Entrá a **Render** → **New +** → **Web Service** → conectá este repositorio (`low-polly-plane`).
2. Configurá así el servicio:
   - **Root Directory**: *(dejar vacío `.`, muy importante para poder importar `js/game/replay.js` desde la raíz)*
   - **Runtime**: `Node`
   - **Build Command**: `cd server && npm install`
   - **Start Command**: `node server/src/index.js`
3. Agregá las **Environment Variables** en Render:
   - `DATABASE_URL` → la cadena **Pooled** (`-pooler...neon.tech/...?sslmode=require`) de tu proyecto en Neon.
   - `AUTH_SECRET` → una clave larga aleatoria (ej. generada con `openssl rand -hex 32`).
   - `CORS_ORIGIN` → `https://codehvrd.github.io,http://localhost:8080`
4. Guardá y desplegá. Al terminar, probá `https://TU-APP.onrender.com/api/health` y debería responder `{"ok":true,"db":{"connected":true}}`.

---

## Prueba local

```bash
cd server
npm install
# Copiar .env.example a .env con tu DATABASE_URL de Neon
node --env-file=.env src/index.js
```
