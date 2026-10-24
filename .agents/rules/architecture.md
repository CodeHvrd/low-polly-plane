# Reglas de Arquitectura y Modularidad

## 1. Desacoplamiento entre Lógica Pura y Render/DOM

- **Módulos puros (Node.js compatible)**:
  - Todo archivo dentro de `js/physics/`, `js/game/` (excepto renders específicos), `js/core/math.js` y `js/core/storage.js` debe ser código JavaScript puro (ES Modules).
  - **PROHIBIDO** importar `three.js` o acceder a `window`, `document`, `navigator` o APIs del navegador dentro de los módulos puros.
  - La lógica de simulación, cálculos de sustentación/arrastre, detección matemática de colisiones, economía de monedas y árboles de decisiones deben poder ejecutarse de forma independiente en Node.js.
- **Capa de Renderizado y UI**:
  - `js/aircraft/AircraftView.js`, `js/world/pickupMeshes.js`, `js/ui/*`, etc., consumen datos de la lógica pura y crean/actualizan objetos de Three.js o elementos DOM.
  - Ningún cálculo crítico de física o colisión debe depender del estado visual de Three.js (ej. no leer matrices de mundo de Three.js para decidir colisiones en tiempo real si el objeto físico ya tiene su posición).

## 2. Orquestación y Ciclo de Vida

- **Orquestador central (`Game.js`)**:
  - Es el pegamento que conecta los subsistemas (mundo, física, cámara, UI, audio, controles).
  - Los subsistemas no deben llamarse de forma cruzada directa (por ejemplo, el módulo de física no debe llamar directamente a la UI de monedas; en su lugar, emite eventos o devuelve resultados a `Game.js`).
- **Control de Fases (`RunController.js`)**:
  - El ciclo de fases es inmutable: `STANDBY` ➔ `AIM` ➔ `PLAYING` ➔ `RESULT`.
  - **Guardas de fase**: Toda acción de entrada (teclado, toque, clic de ratón) debe validar que la fase actual permita dicha acción.
  - No permitir relanzar el avión desde la pantalla de resultado sin pasar por el reseteo correspondiente.
  - No permitir que atajos de teclado (como `Espacio`) atraviesen diálogos o disparen lanzamientos cuando se está apuntando o en pantalla final.

## 3. Fuentes Únicas de Verdad (Single Source of Truth)

- **Terreno (`js/world/terrainField.js`)**:
  - Es la única fuente autoritativa sobre la elevación del suelo `h(x, z)`.
  - La malla gráfica del terreno, las colisiones del avión con el piso y la previsualización de trayectoria deben consultar `terrainField.js`.
- **Perfil de Vuelo (`js/game/flightProfile.js`)**:
  - Define la función de `distancia ➔ altura esperada/deseada`.
  - Determina la altura de crucero por tramo, la altura a la que se sitúan los recolectables y a qué altura apunta la puntería neutra.
  - Nunca desacoplar la generación de monedas del perfil de vuelo; de lo contrario los recolectables quedarán en cotas inalcanzables.
- **Configuraciones de Modo (`js/modes/classic.js`, `js/modes/frenetic.js`)**:
  - Un nuevo modo de juego se define extendiendo la configuración de parámetros (rango de apuntado, consumo de combustible, cantidad de obstáculos, movilidad), **NUNCA** duplicando ni bifurcando el motor de simulación.
