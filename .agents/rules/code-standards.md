# Estándares de Código y Directrices de Estilo

## 1. Tecnologías y Dependencias

- **JavaScript Moderno Estándar (ES Modules)**:
  - Usar sintaxis estándar de módulos (`import` / `export`).
  - No introducir empaquetadores como Webpack, Rollup o Vite a menos que se solicite explícitamente.
  - La aplicación debe continuar ejecutándose cargando directamente `./js/main.js` desde el navegador.
- **Sin Paquetes NPM de Terceros en Producción**:
  - El proyecto no tiene `node_modules` de producción.
  - Las herramientas de desarrollo en `tools/*.mjs` usan Node 24 con módulos nativos (ej. `node:http`, `node:fs`, `node:crypto`, `node:child_process`). No agregar dependencias innecesarias en `package.json`.
- **CSS Vainilla**:
  - Estilos centralizados en `style.css` usando variables CSS (`--primary`, etc.) y diseño responsivo adaptado a orientación vertical (Portrait 9:16 / móviles).

## 2. Robustez y Guardas Defensivas

- **Saneamiento de Persistencia (`storage.js`)**:
  - Los datos guardados en `localStorage` pueden estar dañados, manipulados o ser de versiones anteriores.
  - Validar siempre tipos, límites (`Math.min`, `Math.max`), valores NaN y null al cargar el progreso del jugador o configuraciones.
- **Utilidades Matemáticas (`js/core/math.js`)**:
  - Reutilizar las funciones matemáticas del proyecto en lugar de reimplementarlas en línea:
    - `clamp(val, min, max)`
    - `remap(val, inMin, inMax, outMin, outMax)`
    - `damp(current, target, lambda, dt)` (suavizado independiente del framerate)
    - `RNG` reproducible con semilla para generación procedural determinista.
- **Manejo del Bucle de Cuadros (`dt`)**:
  - Acotar siempre el delta time (`Math.min(dt, 0.1)`) para evitar que un tirón de framerate o un cambio de pestaña descoloque las integraciones físicas o cause penetraciones de colisión.

## 3. Soporte Móvil y Orientación Vertical (Portrait)

- El juego está optimizado para orientación vertical móvil:
  - Respetar el FOV vertical dinámico (82° máx en pantallas verticales) en `CameraRig.js`.
  - Los controles táctiles en pantalla (Rueda táctil/D-pad y botón de boost) tienen zonas muertas calibradas (8%) y curvas de respuesta no lineales (potencia 0.72) para máxima sensibilidad y precisión.
  - Comprobar que cualquier nuevo elemento del HUD o ventana modal no se solape con los mandos táctiles inferiores ni con el indicador de viento/combustible.
