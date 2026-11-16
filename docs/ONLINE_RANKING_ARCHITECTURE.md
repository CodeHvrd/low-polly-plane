# PaperCrash — Arquitectura de Ranking Online Anti-Trampas y Rendimiento en Vuelos Extensos

Este documento detalla la arquitectura de validación determinista para el ranking online (sin servidor autoritativo en tiempo real) y las optimizaciones de rendimiento implementadas para vuelos de larga distancia (10 km – 30 km+).

---

## 1. Arquitectura de Ranking Online Anti-Trampas

### Principio Fundamental: No Confiar en el Cliente
En lugar de aceptar un puntaje enviado por el navegador (`{ distance: 8500, coins: 1200 }`), el servidor **re-simula el vuelo entero** de forma headless en Node.js / Edge Runtime utilizando exactamente el mismo motor físico puro del repositorio (`js/physics/flightModel.js`, `js/world/obstacles.js`, `js/world/collectibles.js`, `js/game/replay.js`).

### Flujo de Envío Seguro

```
Cliente (Navegador / APK)                        Backend (Node.js / Edge Worker)
─────────────────────────                        ───────────────────────────────
1. Al iniciar la partida:
   GET /api/v1/runs/challenge  ───────────────▶  Genera { challengeToken, seed, issuedAt }
                               ◀───────────────  Firmado con HMAC-SHA256 (TTL 15 min)

2. Durante el vuelo (`RunController.js`):
   - `InputRecorder` graba cambios de estado
     (delta-encoding: `[tick, steer, nose]`)
     y ticks exactos de propulsión (`thrusts`).
   - Viento determinista (`windRng`) sembrado
     con `seed` y avanzado por `SIM.FIXED_DT`.

3. Al aterrizar (`ranking.js`):
   POST /api/v1/runs/submit    ───────────────▶  1. Verifica HMAC y expiración de `challengeToken`
   {                                                (un solo uso, evita replay attacks).
     challengeToken,                             2. Verifica `build` compatible.
     seed, ship, upgrades,                       3. Ejecuta `verifyReplay()` en Node.js (~15 ms).
     claimed: { distance, coins, rings... },     4. Compara `simulated` vs `claimed`:
     replay: { v: 1, launch, events, thrusts }      - `deltaDistance <= 2m`
   }                                                - `deltaCoins <= 25` y `rings === sim.rings`.
                                                 5. Si coincide: guarda en PostgreSQL / Supabase.
                               ◀───────────────  Responde { ok: true, rank: #14 }
```

### Implementación ya Integrada en el Código
1. **`js/game/replay.js`** (100% puro, sin DOM ni Three.js):
   - `InputRecorder`: compresión RLE/delta de controles (`steer`, `nose`) y ticks de propulsión (`thrusts`). Un vuelo de varios minutos ocupa < 2 KB.
   - `verifyReplay()`: simulador headless completo con soporte de chunks dinámicos, vendavales, aros, near-miss, boosters y rebotes.
2. **`js/game/RunController.js`**:
   - Viento (`rollWind`, `updateWind`), enfriamiento y combustible avanzan estrictamente con `SIM.FIXED_DT` y PRNG determinista (`createRng`).
   - Graba automáticamente cada vuelo y adjunta `replay` en `computeResult()`.
3. **`js/game/ranking.js`**:
   - `crearPayloadOnline(registro, challengeToken)` empaqueta el registro listo para enviar al endpoint de verificación.

### Reglas Anti-Trampa Adicionales Recomendadas para Producción
* **Validación de Upgrades**: El backend debe cruzar los `upgrades` declarados contra el historial/perfil del jugador o validar el límite máximo de `UPGRADES[i].maxLevel` (ya acotado por `modsFromLevels()`).
* **Challenge Nonce de un Solo Uso**: Almacenar los `challengeToken` consumidos en Redis / KV con TTL de 15 minutos para impedir reenvíos duplicados de un mismo replay válido.
* **Rate Limiting & Sanity Checks**: Limitar envíos por IP/Usuario y validar que `time` real transcurrido entre `challenge` y `submit` sea coherente con la duración simulada del vuelo (`>= simulated.time * 0.85`).

---

## 2. Rendimiento en Vuelos Extensos (10 km – 30 km+)

### Cuellos de Botella Detectados y Resueltos

1. **Destrucción de Texturas Canvas y Materiales cada 500 m (`pickupMeshes.js`)**:
   - *Problema*: En cada transición de tramo (`updateChunkWindow`), `rerollPickupPaths` llamaba a `disposePickupMeshes()`, destruyendo las `CanvasTexture` de las letras de los boosters (`B`, `S`, `I`) y todos los materiales compartidos, forzando re-renderizado 2D y re-subida a GPU en medio del vuelo.
   - *Solución*: Se implementó `clearPickupMeshes()` que remueve únicamente las instancias de la escena manteniendo geometrías, materiales y `CanvasTexture` residentes en caché de GPU.

2. **Animación por Frame de Recolectables Fuera de Cámara (`pickupMeshes.js`)**:
   - *Problema*: `updatePickupMeshes()` iteraba sobre ~250+ recolectables calculando `Math.sin` y rotaciones en cada frame aunque estuvieran a más de 1.500 metros de distancia.
   - *Solución*: Culling espacial por distancia (`focusX - 60` a `focusX + 420`), reduciendo en ~75% el trabajo de CPU en el bucle de presentación.

3. **Complejidad Acotada O(1) en Ventana Deslizante**:
   - **Terreno (`terrainMesh.js`)**: Reutiliza una única malla de tamaño fijo (`SEG_X=260, SEG_Z=30`) desplazando vértices in-situ sin asignaciones de memoria.
   - **Estela (`trail.js`)**: Ring-buffer sobre `Float32Array` fijo con `copyWithin(0, 3)` (0 alocaciones por frame).
   - **Speedlines (`effects.js`)**: Buffer estático pre-alocado en `LineSegments` que solo se actualiza por encima de 55 m/s.
   - **Física Headless**: Verificado en `tools/verify-replay.mjs` con costo constante de ~9–15 µs por tick de física.
