/**
 * PAPERCRASH — sw.js
 * ============================================================
 * Service worker: hace que el juego se pueda INSTALAR y ande sin conexión.
 *
 * ── Estrategia ──
 * El juego es un puñado de archivos estáticos que no cambian entre partidas, así
 * que se cachean todos en la instalación y después se sirven desde el caché. No
 * hay red en el camino crítico: abrir la app no espera a nadie.
 *
 * ── Por qué el caché se versiona ──
 * `VERSION` es parte del nombre del caché. Al subirla, el service worker nuevo
 * instala un caché distinto, activa y BORRA los viejos. Sin esto, un despliegue
 * nuevo seguiría sirviendo los archivos del anterior y el jugador vería una
 * versión vieja sin entender por qué.
 *
 * ── Lo que NO se cachea ──
 * Las fuentes de Google. Van a la red con un respaldo silencioso: si no hay
 * conexión, el juego usa las fuentes del sistema y se ve bien igual. Cachearlas
 * agregaría dependencia de un tercero en algo que tiene que arrancar siempre.
 * ============================================================
 */

/** Subir esto en cada despliegue que cambie archivos. */
const VERSION = 'papercrash-alpha-1.1.31';

/** Archivos del juego. Si falta uno, la instalación falla entera. */
const NUCLEO = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

/**
 * Módulos del juego.
 *
 * Se listan todos a propósito, en vez de descubrirlos: así la instalación falla
 * RUIDOSAMENTE si un archivo cambió de nombre, en lugar de romper en el primer
 * vuelo sin conexión. Un service worker que falla en silencio es peor que uno
 * que no existe.
 */
const MODULOS = [
  './js/aircraft/fighterJet.js',
  './js/aircraft/helicopter.js',
  './js/aircraft/index.js',
  './js/aircraft/launcher.js',
  './js/aircraft/paperPlane.js',
  './js/aircraft/passengerPlane.js',
  './js/aircraft/shared.js',
  './js/config.js',
  './js/core/audio.js',
  './js/core/engine.js',
  './js/core/input.js',
  './js/core/math.js',
  './js/core/storage.js',
  './js/core/version.js',
  './js/game/AircraftView.js',
  './js/game/Game.js',
  './js/game/RunController.js',
  './js/game/achievements.js',
  './js/game/aiming.js',
  './js/game/cameraRig.js',
  './js/game/effects.js',
  './js/game/flightProfile.js',
  './js/game/ranking.js',
  './js/game/slingshotBand.js',
  './js/game/state.js',
  './js/game/trail.js',
  './js/main.js',
  './js/modes/frenetic.js',
  './js/modes/index.js',
  './js/physics/flightModel.js',
  './js/physics/specs.js',
  './js/physics/trajectory.js',
  './js/ui/aimFeedback.js',
  './js/ui/aircraftSelector.js',
  './js/ui/dom.js',
  './js/ui/hud.js',
  './js/ui/overlays.js',
  './js/ui/resultScreen.js',
  './js/ui/shop.js',
  './js/ui/touchControls.js',
  './js/vendor/three.min.js',
  './js/world/collectibles.js',
  './js/world/directionArrows.js',
  './js/world/environment.js',
  './js/world/launchpad.js',
  './js/world/obstacleMeshes.js',
  './js/world/obstacles.js',
  './js/world/pickupMeshes.js',
  './js/world/terrainField.js',
  './js/world/terrainMesh.js',
];

const ARCHIVOS = [...NUCLEO, ...MODULOS];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      /*
       * `addAll` es atómico: si un solo archivo falla, no se instala nada y el
       * service worker viejo sigue sirviendo. Es preferible a quedar con un
       * caché a medias que rompa en medio de una partida.
       */
      await cache.addAll(ARCHIVOS);
      // Toma el control sin esperar a que se cierren las pestañas.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(
        nombres
          .filter((n) => n.startsWith('papercrash-') && n !== VERSION)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;

  // Sólo GET: nada más se cachea.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /*
   * Las fuentes de Google van directo a la red, con respaldo del caché si ya se
   * bajaron alguna vez. No se pre-cachean: si no hay conexión el juego arranca
   * igual con las fuentes del sistema.
   */
  if (url.origin !== self.location.origin) {
    evento.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const guardado = await caches.match(request);
          if (guardado) return guardado;
          // Sin fuente: el navegador usa la del sistema y listo.
          return new Response('', { status: 504, statusText: 'sin conexión' });
        }
      })(),
    );
    return;
  }

  /*
   * Archivos propios: primero el caché.
   *
   * Es lo que hace que abrir la app sea instantáneo y que ande sin conexión. El
   * juego no tiene datos en vivo, así que no hay nada que ganar yendo a la red
   * primero.
   */
  evento.respondWith(
    (async () => {
      const guardado = await caches.match(request);
      if (guardado) return guardado;

      try {
        const respuesta = await fetch(request);
        /*
         * Se guarda una copia de lo que se pidió y no estaba. Cubre el caso de
         * un archivo agregado después del despliegue: entra al caché en el
         * primer uso en vez de fallar para siempre sin conexión.
         */
        if (respuesta.ok && respuesta.type === 'basic') {
          const cache = await caches.open(VERSION);
          cache.put(request, respuesta.clone());
        }
        return respuesta;
      } catch (err) {
        /*
         * Sin conexión y sin caché. Para una navegación se devuelve el index,
         * que es lo que permite abrir la app desde el icono aunque la URL
         * exacta no esté cacheada.
         */
        if (request.mode === 'navigate') {
          const index = await caches.match('./index.html');
          if (index) return index;
        }
        throw err;
      }
    })(),
  );
});
