/**
 * PAPERCRASH — main.js
 * ============================================================
 * Punto de entrada. Arranca el juego con validaciones previas y un
 * arranque a prueba de fallos.
 *
 * Este archivo NO tenía que ser un módulo ES para funcionar: se eligió
 * `type="module"` a propósito. Sus ventajas frente a los scripts globales
 * del código original:
 *   · `import` explícito → el grafo de dependencias lo resuelve el
 *     navegador y no hay variables globales compartidas por accidente.
 *   · los módulos son deferred → el DOM ya existe al evaluarse, así que
 *     no hace falta envolver todo en `DOMContentLoaded`.
 *   · ámbito propio por archivo → dos módulos no pueden pisarse un
 *     `const`/`function` con el mismo nombre (era un riesgo real con un
 *     único game.js de 1600 líneas).
 *   · errores de import reportados con el archivo exacto.
 *
 * Contrapartida asumida: los módulos ES requieren `http://` y no
 * funcionan abriendo el archivo con `file://` (el navegador bloquea los
 * imports por CORS). Ver README.md para cómo servir el proyecto.
 * ============================================================
 */
import { Game, reportBootError } from './game/Game.js';
import { BUILD } from './core/version.js';
import { findMissingRequiredDom, showBootError } from './ui/dom.js';

/** Espera a que el CDN de Three.js esté disponible (o falla con aviso). */
function waitForThree(timeoutMs = 8000) {
  if (window.THREE) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (window.THREE) return resolve();
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('THREE no se cargó (¿bloqueaste el CDN o estás sin conexión?)'));
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function boot() {
  /*
   * La versión del build, abajo a la izquierda.
   *
   * Sirve para confirmar que el teléfono corre la última versión y no una
   * cacheada por el service worker: si el número no cambió, no se recargó.
   */
  const etiqueta = document.getElementById('build-version');
  if (etiqueta) etiqueta.textContent = `v. ${BUILD}`;

  // 1) ¿Está el DOM que la UI necesita?
  const missing = findMissingRequiredDom();
  if (missing.length) {
    showBootError(
      `Faltan elementos en index.html: ${missing.join(', ')}`,
      'Revisá que los nodos con data-required sigan presentes.',
    );
    return;
  }

  // 2) ¿Está la librería 3D?
  waitForThree()
    .then(() => {
      // 3) Arrancar. Cualquier fallo se muestra en pantalla en vez de
      //    dejar una pantalla negra muda.
      const game = new Game();
      game.start();
      // Expuesto para depurar desde la consola; el juego no depende de esto.
      window.__papercrash = game;
    })
    .catch((err) => {
      reportBootError(err);
    });
}

// Los módulos ES son deferred, así que el DOM ya está listo. Aun así se
// contempla el caso de que el script se cargue antes por algún bundler.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

/*
 * ── Service worker: hace instalable la app y la deja andar sin conexión ──
 *
 * Se registra AL FINAL, después de arrancar el juego. Al revés, la descarga del
 * caché competiría con la carga de los módulos y la primera pantalla tardaría
 * más: el service worker es una mejora, no un requisito para jugar.
 *
 * Si falla no se avisa al jugador: el juego funciona igual, sólo pierde la
 * instalación y el modo sin conexión. Un error acá no debe romper una partida.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('[papercrash] service worker no registrado:', err.message);
    });
  });
}

