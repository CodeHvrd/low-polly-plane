# PaperCrash — Roadmap

Documento vivo. Marcar con `[x]` lo terminado. Cada hito debe cerrar con `node tools/verify-physics.mjs` y `node tools/verify-game-logic.mjs` en `TODO OK` (y `node tools/sync-sw.mjs` si cambian assets).

## Visión

Dos modos de juego:

1. **Endless (sin límites)** — el juego actual. Más velocidad, más boosters, llegar lo más lejos posible. El puntaje entra en un ranking/clasificación.
2. **Historia** — al menos 5 mapas premodelados, con objetivos y dificultades distintas. Da sentido a tener varios aviones con habilidades distintas.

---

## Fase 1 — Estética y modelos (EMPEZAMOS ACÁ)

Modelos GLB de Meshy con respaldo procedural (`assets/models/`).

| Elemento | Estado |
| --- | --- |
| Jet (`plane_chrome.glb`) | [x] conectado |
| Roca (`rock_chrome.glb`) | [x] conectado |
| Mesa (`mesa_chrome.glb`) | [x] conectado |
| Aguja (`spire_chrome.glb`) | [x] conectado |
| Aro (`ring_chrome.glb`) | [x] conectado |
| Vendaval (`updraft_chrome.glb`) | [x] conectado |
| Avión de papel (`paper_chrome.glb`) | [x] conectado |
| Avión de pasajeros (`airliner_chrome.glb`) | [x] conectado |
| Helicóptero (`heli_chrome.glb` + rotores) | [x] conectado |
| Árboles (`tree_chrome.glb`) | [x] conectado |
| Troncos caídos (`log_chrome.glb`) | [x] conectado |
| Boosters (`booster_chrome.glb`) | [x] conectado |
| Monedas (`coin_chrome.glb`) | [x] conectado |
| Lanzador / resortera (`launcher_chrome.glb`) | [x] conectado |
| Terreno, cielo, paletas por tramo | [ ] pulido estético |

Reglas: hitbox según silueta real, geometría compartida, precarga/caché, respaldo procedural si el GLB falla, peso razonable para móvil.

## Fase 2 — Modo Endless + ranking

- [ ] Definir el puntaje (distancia + velocidad máxima + aros + monedas) y fijarlo en `config.js`.
- [ ] Progresión de velocidad más marcada: cada tramo/booster eleva el techo de velocidad.
- [ ] Ranking local (mejores N corridas por avión) en `storage.js`.
- [ ] Clasificación por rangos/ligas según puntaje (bronce → …).
- [ ] Decidir si el ranking es solo local o con backend/online (pendiente).
- [ ] Pantalla de ranking en el menú.
- [ ] Revisar que el corredor de 2500 m no limite el "sin límites" (¿generación infinita por chunks?).
- [ ] Ajustar balance con `tools/calibrate-flight.mjs` (prohibido a ojo).

## Fase 3 — Música y audio

Hoy: audio procedural WebAudio (`js/core/audio.js`), solo sube una capa.

- [ ] **Música de menú** (menú principal, Opciones, Logros y antes del lanzador).
- [ ] **Música de juego** con estilos que cambian según la velocidad del avión (no solo sumar una capa: cambiar de estilo/sección).
- [ ] Umbrales de velocidad → estilo, definidos en `config.js`, con transiciones cuantizadas al compás.
- [ ] Al colisionar/perder: cortar la música de juego con remate y volver a la del menú.
- [ ] Decidir: música procedural vs. archivos de audio (impacta en el peso y el cache del SW).
- [ ] Volumen separado música/efectos en Opciones.
- [ ] Mantener el atajo `M` y el mute.

## Fase 4 — Mobile: vertical y horizontal

Soporte completo y fluido en ambas orientaciones con selector de preferencia en Opciones.

- [x] Habilitar rotación de pantalla (manifest `orientation: any`, APK en `native/AndroidManifest.xml`).
- [x] Layout horizontal: HUD, controles D-pad, botón de boost, tienda, resultado y menús adaptados sin solapamientos.
- [x] Cámara/FOV según aspecto dinámico (factor de escala automático en vertical/horizontal para ver el corredor completo).
- [x] Opción en Opciones: Auto / Vertical / Horizontal. Persistida en almacenamiento local.
- [x] Verificado con `node tools/check-mobile.mjs` y `node tools/check-touch.mjs`.

## Fase 5 — Modo Historia

- [ ] Diseñar 5+ mapas premodelados (terreno propio vía `terrainField.js`, sin ramas de código en los motores: cada mapa es data/config).
- [ ] Objetivos por mapa (llegar a X, cruzar N aros, juntar monedas, tiempo, sin chocar…).
- [ ] Dificultad creciente y paleta/tema propios.
- [ ] Habilidades por avión útiles en Historia (papel y jet ya dominan Endless; pasajeros y helicóptero necesitan su nicho).
- [ ] Desbloqueo de mapas, estrellas/medallas, guardado de progreso.
- [ ] Pantalla de selección de mapa.

| Mapa | Tema | Objetivo | Avión sugerido |
| --- | --- | --- | --- |
| 1 | por definir | por definir | por definir |
| 2 | por definir | por definir | por definir |
| 3 | por definir | por definir | por definir |
| 4 | por definir | por definir | por definir |
| 5 | por definir | por definir | por definir |

## Fase 6 — Menú, Opciones, Logros

- [ ] Menú principal con selección de modo (Endless / Historia).
- [ ] Pantalla de Opciones (audio, orientación, calidad gráfica).
- [ ] Sistema de Logros.

## Ideas sueltas / backlog

- Precios en el hangar (hoy las 4 naves son gratis con desbloqueo por récord).
- Más mejoras en la tienda.
- Nuevos tipos de camino y obstáculos.
- Regenerar el APK y sincronizar `sw.js` tras cada hito.
- Actualizar README (algunas cifras están viejas: corredor de 600 m vs 2500 m).

## Retención y Game Juice (Implementado)

- [x] **Sistema de Misiones Tripartitas (Retención tipo Alto's Adventure)**: 3 objetivos activos concurrentes en Standby, Premios y Resultados con 18 misiones en catálogo, recompensas en monedas y rotación fluida al completarse.
- [x] **Sensación de Velocidad y Game Juice (Problemática #2)**:
  - **FOV dinámico**: apertura reactiva (+10-12°) ligada a la velocidad real y aceleración.
  - **Speedlines procedurales**: estelas de viento de alta velocidad desvaneciéndose por encima de 32 m/s sin sobrecarga de GC.
  - **Rumble aerodinámico y sacudida cinética**: vibración de cámara a más de 45 m/s e impactos visuales en propulsión y combos.
  - **Mecánica de Near Miss (Vuelo rasante)**: detección de proximidad (<2.4m) a obstáculos sólidos sin impacto con premio instantáneo (+15 monedas), ráfaga de partículas oro/cian y sacudida.
  - **Escala armónica de aros**: pitch ascendente en semitonos para rachas consecutivas de aros atravesados.
  - **Toasts flotantes**: avisos estilizados en tiempo real para misiones y vuelos rasantes.

## Decisiones tomadas

1. **Ranking online.** Requiere backend (cuenta/ID de jugador, validación anti-trampa, tabla por avión). Hay que elegir proveedor y definir cómo se verifica un puntaje (el juego es determinista por semilla: se puede reenviar semilla + inputs para validar).
2. **Música: archivos sin copyright**, mezclados por condiciones (menú / juego / estilos por velocidad / remate al chocar). Dejar de lado la música procedural. Pendiente: elegir librería de licencia libre (CC0 / CC-BY, guardar atribuciones) y tener en cuenta el peso en el cache del SW.
3. **Endless con generación infinita**, que cambia bajo un criterio (por distancia/velocidad: tramos, paletas, dificultad). El corredor fijo de 2500 m pasa a ser solo la base de los tramos; generación por chunks determinista por semilla (necesario también para validar el ranking).
4. **Historia como tutorial progresivo de 5 niveles; Endless se desbloquea al terminar el nivel 5.**
   - Nivel 1: práctica de mecánicas básicas y de cómo repercuten las mejoras del avión de papel.
   - Niveles 2-3: introducen boosters, aros, obstáculos y la elección del camino.
   - Niveles 3-5: mapas más desafiantes que exigen habilidad y mejora de nave, no solo el camino correcto.
   - Meta: al terminar el nivel 5 el jugador ya sabe jugar bien el Endless.

## Decisiones abiertas

1. Proveedor del backend del ranking y esquema anti-trampa.
2. Qué pistas de música usar (fuente y licencia).
3. Criterio exacto de cambio de tramo/dificultad en el Endless infinito.
4. Objetivos concretos de cada nivel de Historia y qué avión usa cada uno.
