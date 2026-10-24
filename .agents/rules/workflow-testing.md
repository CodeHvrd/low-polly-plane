# Reglas de Flujo de Trabajo, Verificación y Herramientas

## 1. Validación Obligatoria de Código

Antes de dar por concluido cualquier cambio en el código fuente (especialmente en `js/`, `config.js` o `modes/`), se deben ejecutar y aprobar las suites de pruebas automatizadas:

```bash
# 1. Pruebas de aerodinámica, terreno, estabilidad numérica y balance
node tools/verify-physics.mjs

# 2. Pruebas de obstáculos, determinismo, colisiones, economía y guardas de fase
node tools/verify-game-logic.mjs
```

Ambos comandos deben salir con código 0 y `TODO OK`.

## 2. Servidor de Desarrollo Local

- No abras `index.html` directamente mediante `file://` debido a restricciones de CORS del navegador con módulos ES nativos.
- Para levantar el servidor local sin dependencias externas:
  ```bash
  node tools/serve.mjs          # corre en http://127.0.0.1:8765
  node tools/serve.mjs 3000     # puerto personalizado
  ```
- Este servidor deshabilita el almacenamiento en caché y asegura los MIME types correctos (`application/javascript` para `.js`).

## 3. Pruebas End-to-End de Navegador (Smoke Tests)

- Cuando se modifique la interfaz de usuario, eventos de puntero, transiciones de cámara o el ciclo completo de juego en navegador:
  1. Inicia el servidor local en el puerto 8765 (`node tools/serve.mjs 8765`).
  2. Ejecuta la suite de navegador headless:
     ```bash
     node tools/browser-smoke.mjs
     ```
  - Esta herramienta se comunica directamente con Chrome/Edge mediante DevTools Protocol nativo sin frameworks pesados (Puppeteer/Playwright).

## 4. Sincronización del Service Worker (PWA)

- Si se modifican archivos de la lista de caché (HTML, CSS, texturas, scripts, audio o tipografías), se debe sincronizar el Service Worker:
  ```bash
  node tools/sync-sw.mjs
  ```
- Esto actualiza la versión de caché y la lista de recursos en `sw.js` para evitar discrepancias de caché en clientes offline o PWA instaladas.

## 5. Medición y Calibración Basada en Datos

- **Prohibido ajustar balance a ojo**:
  - Para balancear aerodinámica y potencia:
    ```bash
    node tools/calibrate-flight.mjs power
    node tools/calibrate-flight.mjs angle
    ```
  - Para verificar la respuesta de los controles laterales y táctiles:
    ```bash
    node tools/measure-steering.mjs classic
    node tools/measure-steering.mjs frenetic
    ```
  - Para verificar comportamiento táctil móvil:
    ```bash
    node tools/check-touch.mjs
    ```
