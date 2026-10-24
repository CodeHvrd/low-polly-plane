# PaperCrash — Reglas de Desarrollo para Agentes (.agents)

Este directorio define las directivas, arquitectura y restricciones operativas que cualquier agente o desarrollador debe respetar al modificar o extender este juego.

---

## 🧭 Resumen de Principios Fundamentales

1. **Pureza Modular y Cero Dependencias Innecesarias**:
   - Todo módulo de física, lógica de juego, matemáticas o economía (`js/physics/`, `js/game/`, `js/core/math.js`, `storage.js`) **NO debe importar Three.js ni acceder al DOM** (`window`, `document`).
   - Esto garantiza que el juego pueda testearse de forma instantánea en Node.js sin navegadores headless ni mocks pesados.

2. **Orquestación Desacoplada**:
   - `Game.js` es el orquestador central que conecta los subsistemas. Los subsistemas no deben llamarse ni acoplarse directamente entre sí.
   - `RunController.js` maneja estrictamente las fases de la partida (`STANDBY`, `AIM`, `PLAYING`, `RESULT`). Ningún evento de interfaz o atajo de teclado puede saltarse la fase actual ni violar las guardas de fase.

3. **Fuentes Únicas de Verdad (SSOT)**:
   - `terrainField.js`: Único proveedor de alturas, relieve y forma del terreno para render, colisiones y cálculo de trayectorias.
   - `flightProfile.js`: Única fuente para la curva de altura deseada, tramos del corredor y anclaje de recolectables.
   - Modos de juego (`modes/classic.js`, `modes/frenetic.js`): Son capas de configuración (data/parámetros), no bifurcaciones ni ramas de código en los motores.

4. **Invariantes del Bucle de Vuelo y Mecánicas**:
   - **La propulsión es una habilidad táctica**, no un premio instantáneo. Los boosters otorgan cargas y recargan planeo; el jugador decide cuándo activar el empuje (`Espacio`).
   - **El planeo tiene presupuesto (`glideBudget`)** y se descuenta según la sustentación requerida, no solo cuando el avión desciende (evita exploits de ascenso infinito).
   - **La transición de cámara ocurre al ENTRAR a modo lanzamiento (`AIM`)**, nunca al soltar el avión (`launch`). Soltar es instantáneo sin movimiento de cámara.
   - **Potencia y Ángulo son ejes desacoplados** en el arrastre en pantalla.
   - **Colisiones justas**: Las hitboxes respetan la silueta real del objeto; los aros nunca colisionan en su borde y recompensan al cruzarlos.

5. **Verificación Automatizada Obligatoria**:
   - Cada cambio de código que afecte física, lógica, terreno, recolectables o guardas DEBE ser validado ejecutando:
     ```bash
     node tools/verify-physics.mjs
     node tools/verify-game-logic.mjs
     ```
   - Toda suite debe reportar 100% OK antes de dar la tarea por concluida.

---

## 📂 Índice de Reglas Detalladas

Para directivas específicas, consulta las reglas en el directorio `rules/`:

- [Arquitectura y Estructura Modular](file:///c:/Users/jajaj/Desktop/Ai%20proyects/plane-low-poly/.agents/rules/architecture.md)
- [Físicas, Controles y Mecánicas de Juego](file:///c:/Users/jajaj/Desktop/Ai%20proyects/plane-low-poly/.agents/rules/gameplay-physics.md)
- [Flujo de Trabajo, Verificación y Herramientas](file:///c:/Users/jajaj/Desktop/Ai%20proyects/plane-low-poly/.agents/rules/workflow-testing.md)
- [Estándares de Código y Directrices de Estilo](file:///c:/Users/jajaj/Desktop/Ai%20proyects/plane-low-poly/.agents/rules/code-standards.md)
