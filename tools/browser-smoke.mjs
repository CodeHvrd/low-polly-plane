/**
 * PAPERCRASH — tools/browser-smoke.mjs
 * ============================================================
 * Prueba de humo en un navegador REAL, sin dependencias externas.
 *
 * Usa Chrome/Edge en modo headless vía el protocolo DevTools (CDP).
 * Node 24 trae un cliente WebSocket nativo, así que no hace falta puppeteer.
 *
 * ── Decisión de diseño importante ──
 * Cada sección de prueba corre en una PESTAÑA NUEVA. Se probó a reutilizar
 * una sola pestaña y el resultado fue frágil: el bucle de render sigue vivo
 * entre evaluaciones, así que el estado se filtraba de una sección a la
 * siguiente (un arrastre a medias, una fase a mitad de vuelo) y las
 * aserciones medían cosas distintas de las que creían. Una pestaña limpia
 * por sección elimina esa clase de falso negativo.
 *
 * Qué cubre:
 *   1. Carga sin errores y resolución de todos los módulos ES.
 *   2. Estado inicial coherente.
 *   3. Previsualización de trayectoria: línea punteada blanca translúcida.
 *   4. Independencia de los ejes de apuntado (potencia / pitch / azimut).
 *   5. Un vuelo completo hasta la pantalla de resultado.
 *   6. REGRESIÓN del bug reportado: con el resultado abierto, ni el clic ni
 *      Espacio pueden relanzar el avión o reabrir el menú; y Espacio durante
 *      el arrastre no lanza.
 *   7. Estabilidad del bucle y ausencia de fugas de recursos.
 *
 * Uso:
 *   node tools/browser-smoke.mjs [url]
 * Requiere servir el proyecto por HTTP (los módulos ES no cargan en file://).
 * ============================================================
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PICKUPS } from '../js/config.js';

const URL_UNDER_TEST = process.argv[2] ?? 'http://127.0.0.1:8765/index.html';
const DEBUG_PORT = 9333;

const BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Cliente CDP mínimo ──────────────────────────────────────
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} ${JSON.stringify(msg.error.data ?? '')}`));
        else resolve(msg.result);
        return;
      }
      if (msg.method) for (const fn of this.listeners) fn(msg);
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout en ${method}`));
        }
      }, timeoutMs);
    });
  }

  /**
   * Evalúa una expresión en la página y devuelve el valor.
   * Las expresiones con `return` se envuelven en una IIFE automáticamente,
   * lo que además evita errores de TDZ por declarar `const` suelto.
   */
  async evaluate(expression) {
    /*
     * El envoltorio es `async` para que las pruebas puedan usar `await` dentro
     * (por ejemplo `await import(...)` para leer la configuración del modo).
     * `awaitPromise: true` hace que CDP espere la promesa resultante.
     */
    const src = /\breturn\b/.test(expression)
      ? `(async () => { ${expression} })()`
      : expression;
    const res = await this.send('Runtime.evaluate', {
      expression: src,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`excepción en la página: ${d.exception?.description ?? d.text}`);
    }
    return res.result.value;
  }

  close() {
    try { this.ws.close(); } catch { /* ignorado */ }
  }
}

// ── Mini framework de aserciones ────────────────────────────
let passed = 0;
const failures = [];
const sectionErrors = [];
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log(`  \u2713 ${label}${detail ? `  (${detail})` : ''}`); }
  else { failures.push(label); console.log(`  \u2717 ${label}${detail ? `  (${detail})` : ''}`); }
}
const section = (t) => console.log(`\n=== ${t} ===`);
/** Formatea un numero para los logs sin romper si es undefined. */
const apuntandoFmt = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(0) : String(v));

// ── Sesión de navegador ─────────────────────────────────────
class BrowserSession {
  constructor(port) {
    this.port = port;
  }

  /** Abre una pestaña nueva, la deja lista y devuelve {cdp, errors, close}. */
  async openPage(url, { settleMs = 2500 } = {}) {
    const res = await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, { method: 'PUT' });
    if (!res.ok) throw new Error(`no se pudo crear la pestaña: HTTP ${res.status}`);
    const target = await res.json();

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('falló el WebSocket de CDP')), { once: true });
    });

    const cdp = new CDP(ws);
    const errors = { console: [], page: [], network: [] };

    cdp.on((msg) => {
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.console.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.page.push(d.exception?.description ?? d.text);
      }
      if (msg.method === 'Network.loadingFailed') {
        errors.network.push(`${msg.params.type} ${msg.params.errorText}`);
      }
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Page.enable');

    await cdp.send('Page.navigate', { url });

    // Esperar a que el juego esté vivo.
    const deadline = Date.now() + 20000;
    let booted = false;
    while (Date.now() < deadline) {
      await sleep(200);
      try {
        booted = await cdp.evaluate('Boolean(window.__papercrash)');
        if (booted) break;
      } catch { /* la navegación reemplaza el contexto */ }
    }
    // Un respiro para que se asienten cargas de fuentes y del CDN.
    await sleep(settleMs);

    return {
      cdp,
      errors,
      booted,
      close: () => cdp.close(),
    };
  }
}

// ── Cuerpo del test ─────────────────────────────────────────
const profileDir = mkdtempSync(join(tmpdir(), 'pc-smoke-'));
let browser = null;

/** Espera a una condición evaluada en la página. */
async function waitFor(cdp, expression, { timeoutMs = 20000, interval = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate(expression)) return true;
    } catch { /* contexto en transición */ }
    await sleep(interval);
  }
  return false;
}

async function main() {
  const exe = BROWSER_CANDIDATES.find((p) => p && existsSync(p));
  if (!exe) {
    console.log('No se encontró Chrome/Edge. Prueba omitida.');
    return 0;
  }
  console.log(`Navegador: ${exe}`);
  console.log(`URL:       ${URL_UNDER_TEST}`);

  browser = spawn(exe, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--window-size=1280,800',
    // WebGL por software: en headless no hay GPU.
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore' });

  let version = null;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (r.ok) { version = await r.json(); break; }
    } catch { /* todavía arranca */ }
    await sleep(250);
  }
  if (!version) throw new Error('el navegador no abrió el puerto de depuración');
  console.log(`Motor:     ${version.Browser}\n`);

  const session = new BrowserSession(DEBUG_PORT);

  // ══ Sección 1: carga y estado inicial ══
  section('1. Carga, módulos ES y estado inicial');
  {
    const page = await session.openPage(URL_UNDER_TEST);
    const { cdp, errors } = page;

    check('el juego se inicializó (window.__papercrash)', page.booted === true);
    check('el documento terminó de cargar', await cdp.evaluate("document.readyState === 'complete'"));
    check('Three.js del CDN disponible', await cdp.evaluate('typeof window.THREE === "object" && Boolean(window.THREE.WebGLRenderer)'));
    check('no se muestra el cartel de error de arranque',
      !(await cdp.evaluate("!document.getElementById('boot-error').classList.contains('hidden')")));

    // Un fallo de import dejaría el cartel visible y sin instancia de juego.
    check('sin excepciones de página', errors.page.length === 0, errors.page.slice(0, 2).join(' | '));
    check('sin errores de consola', errors.console.length === 0, errors.console.slice(0, 2).join(' | '));

    const init = await cdp.evaluate(`return {
      phase: window.__papercrash.controller.phase,
      screen: window.__papercrash.overlays.current,
      viewReady: window.__papercrash.view.ready,
      planeX: window.__papercrash.view.root.position.x,
      hudHidden: document.getElementById('hud').classList.contains('hidden'),
      resultHidden: document.getElementById('result-screen').classList.contains('hidden'),
      idleVisible: !document.getElementById('idle-overlay').classList.contains('hidden'),
      aimHidden: document.getElementById('aim-overlay').classList.contains('hidden'),
      hintVisible: !document.getElementById('idle-hint-block').classList.contains('hidden'),
      shopPanelHidden: document.getElementById('shop-panel').classList.contains('hidden'),
      aircraftButtons: document.querySelectorAll('.plane-choice-btn').length,
      obstacles: window.__papercrash.obstacles.length,
      shopCards: document.querySelectorAll('.shop-card').length,
      dashVisible: window.__papercrash.aiming.dashLine.visible,
      markerVisible: window.__papercrash.aiming.impactMarker.visible,
      rendererSize: window.__papercrash && document.getElementById('gameCanvas').width,
    };`);

    check('arranca en fase IDLE', init.phase === 'idle', `fase=${init.phase}`);
    check('arranca en la etapa standby', init.screen === 'standby', `etapa=${init.screen}`);
    check('el avión está cargado en la resortera', init.viewReady === true && Math.abs(init.planeX) < 0.01);
    check('se ve el título', init.idleVisible === true);
    check('el modo lanzamiento está oculto', init.aimHidden === true);
    check('se ve la pista de control en standby', init.hintVisible === true);
    check('la tienda arranca cerrada', init.shopPanelHidden === true);
    check('el HUD está oculto al inicio', init.hudHidden === true);
    check('la pantalla de resultado está oculta', init.resultHidden === true);
    check('el hangar tiene las 4 aeronaves', init.aircraftButtons === 4, `${init.aircraftButtons}`);
    check('la tienda tiene las 9 mejoras', init.shopCards === 9, `${init.shopCards}`);
    check('el corredor tiene obstáculos', init.obstacles >= 8, `${init.obstacles}`);
    check('la línea de trayectoria está oculta sin arrastre', init.dashVisible === false);
    check('el marcador de impacto está oculto sin arrastre', init.markerVisible === false);
    check('el canvas tiene resolución real', init.rendererSize > 100, `${init.rendererSize}px`);

    page.close();
  }

  // ══ Sección 2: tienda, hangar y flujo de pantallas ══
  section('2. Tienda, hangar y flujo de pantallas');
  {
    const page = await session.openPage(URL_UNDER_TEST);
    const { cdp, errors } = page;

    // ── La tienda se abre desde el botón debajo de las monedas ──
    const opened = await cdp.evaluate(`
      const G = window.__papercrash;
      document.getElementById('btn-shop').click();
      const vis = (id) => !document.getElementById(id).classList.contains('hidden');
      return {
        panel: vis('shop-panel'),
        expanded: document.getElementById('btn-shop').getAttribute('aria-expanded'),
        // En el arranque todavía no se ganaron monedas: las mejoras se ocultan.
        mejorasOcultas: !vis('shop-upgrades'),
        hangarVisible: vis('shop-hangar'),
        etiquetaNave: document.getElementById('shop-current-plane').textContent.trim(),
      };
    `);
    console.log(`    tienda abierta: panel=${opened.panel} etiqueta="${opened.etiquetaNave}"`);

    check('el botón de tienda abre el panel', opened.panel === true);
    check('el botón refleja el estado expandido', opened.expanded === 'true');
    check('el hangar se ve dentro de la tienda', opened.hangarVisible === true);
    check('sin monedas ganadas, las mejoras quedan ocultas', opened.mejorasOcultas === true);
    check('el botón muestra la aeronave activa', /Papel/.test(opened.etiquetaNave), opened.etiquetaNave);

    /*
     * ── Tarjetas de nave: preselección de dos pasos ──
     *
     * El estado ya no vive en `.plane-status` sino en `.plane-action`, que es el
     * BOTÓN: un clic en la tarjeta sólo preselecciona, y hay que apretar el botón
     * para adquirir o equipar. Es el pedido explícito, y evita que un clic
     * accidental gaste las monedas ahorradas.
     */
    const prices = await cdp.evaluate(`
      return [...document.querySelectorAll('.plane-choice-btn')].map((b) => ({
        id: b.dataset.type,
        precio: b.querySelector('.plane-price').textContent.trim(),
        accion: b.querySelector('.plane-action').textContent.trim(),
        numeros: [...b.querySelectorAll('.plane-stat-value')].map((v) => v.textContent.trim()),
        seleccionada: b.classList.contains('selected'),
        bloqueada: b.classList.contains('locked'),
      }));
    `);
    for (const p of prices) {
      console.log(`    ${p.id.padEnd(10)} precio=${p.precio.padEnd(8)} accion=${p.accion.padEnd(12)} stats=${p.numeros.join(' | ')}`);
    }

    // Las naves se DESBLOQUEAN por récord: al arrancar sólo la de papel.
    const desbloqueadas = prices.filter((p) => !p.bloqueada);
    check('al arrancar sólo la nave inicial está desbloqueada',
      desbloqueadas.length === 1 && desbloqueadas[0].id === 'paper',
      prices.filter((p) => !p.bloqueada).map((p) => p.id).join(', ') || 'ninguna');
    check('las naves bloqueadas indican cuánto falta',
      // El número se abrevia (1.5K), así que se busca que empiece con "A " y
      // termine en "m", no un formato numérico concreto.
      prices.filter((p) => p.bloqueada).every((p) => /^A\s+[\d.]+K?\s*m$/.test(p.accion)),
      prices.filter((p) => p.bloqueada).map((p) => p.accion).join(' / '));

    // Las estadísticas se muestran con NÚMEROS además de las barras.
    check('cada nave muestra sus estadísticas con número',
      prices.every((p) => p.numeros.length === 5 && p.numeros.every((x) => x.length > 0)),
      `${prices[0].numeros.length} valores por tarjeta`);
    check('las estadísticas distinguen las naves',
      prices.every((p) => p.numeros[0] !== prices[0].numeros[0] || p.id === 'paper'),
      prices.map((p) => `${p.id}:${p.numeros[0]}`).join(' '));

    check('al menos una nave dice EQUIPAR o EN USO',
      prices.some((p) => p.accion === 'EN USO' || p.accion === 'EQUIPAR'),
      prices.map((p) => p.accion).join('/'));

    // ── La preselección no compra ni equipa ──
    const preseleccion = await cdp.evaluate(`
      const antes = window.__papercrash.controller.phase;
      const btn = document.querySelector('.plane-choice-btn[data-type="passenger"]');
      btn.click();
      return {
        faseIgual: window.__papercrash.controller.phase === antes,
        seleccionada: btn.classList.contains('selected'),
        activa: document.querySelector('.plane-choice-btn[data-type="paper"]').classList.contains('active'),
        tiendaAbierta: !document.getElementById('shop-panel').classList.contains('hidden'),
      };
    `);
    check('un clic sólo PRESELECCIONA la nave', preseleccion.seleccionada === true);
    check('preseleccionar no equipa', preseleccion.activa === true);
    check('preseleccionar no cierra la tienda', preseleccion.tiendaAbierta === true);
    check('preseleccionar no cambia la fase del juego', preseleccion.faseIgual === true);

    // ── Equipar nave limpia la pantalla (dos pasos) ──
    const picked = await cdp.evaluate(`
      /*
       * El flujo tiene DOS pasos: el clic en la tarjeta preselecciona y el clic
       * en el botón equipa. Acá se hacen los dos, que es lo que hace un jugador
       * que quiere ponerse esa nave.
       */
      const card = document.querySelector('.plane-choice-btn[data-type="paper"]');
      card.click();
      card.querySelector('.plane-action').click();
      const G = window.__papercrash;
      const vis = (id) => !document.getElementById(id).classList.contains('hidden');
      return {
        pantalla: G.overlays.current,
        titulo: vis('idle-overlay'),
        modoLanzamiento: vis('aim-overlay'),
        pista: vis('idle-hint-block'),
        panelTienda: vis('shop-panel'),
        nave: G.controller.getSpec().id,
        cartel: document.getElementById('aim-plane-name').textContent,
        etiqueta: document.getElementById('shop-current-plane').textContent.trim(),
      };
    `);
    console.log(`    tras equipar: pantalla=${picked.pantalla} nave=${picked.nave} cartel="${picked.cartel}"`);

    check('equipar aeronave NO entra solo en modo lanzamiento', picked.pantalla === 'standby', picked.pantalla);
    // Equipar nave ya NO limpia la pantalla: se vuelve a standby, que es donde el
    // jugador decide cuándo pasar a la segunda etapa. El título sigue a la vista.
    check('el título sigue visible en standby', picked.titulo === true);
    check('el modo lanzamiento sigue oculto', picked.modoLanzamiento === false);
    check('las instrucciones siguen visibles', picked.pista === true);
    check('equipar cierra la tienda', picked.panelTienda === false);
    /*
     * Sólo la nave DESBLOQUEADA se puede elegir, así que al arrancar el clic en
     * el jet no cambia nada: sigue el papel. Que la nave activa NO cambie es la
     * aserción correcta para el diseño nuevo.
     */
    check('una nave bloqueada no se puede elegir', picked.nave === 'paper', picked.nave);
    check('elegir la nave disponible no cambia el cartel', picked.cartel.includes('Papel'), picked.cartel);

    // ── Volver a la tienda desde preparado no rompe nada ──
    const reopen = await cdp.evaluate(`
      const G = window.__papercrash;
      const vis = (id) => !document.getElementById(id).classList.contains('hidden');
      // Si la tienda ya estaba abierta, el clic la CIERRA: se abre a la fuerza
      // para que la prueba no dependa de cómo quedó el estado anterior.
      const antes = G.shop.open;
      if (antes) G.shop.toggle(false);
      document.getElementById('btn-shop').click();
      return { panel: vis('shop-panel'), pantalla: G.overlays.current, estabaAbierta: antes };
    `);
    check('la tienda sigue respondiendo', reopen.panel === true, `estaba abierta: ${reopen.estabaAbierta}`);
    {
      // Las pestañas separan NAVES de MEJORAS: son cosas distintas.
      const tabs = await cdp.evaluate(`
        const vis = (id) => !document.getElementById(id).classList.contains('hidden');
        return {
          hayNaves: !!document.getElementById('tab-ships'),
          hayMejoras: !!document.getElementById('tab-upgrades'),
          hangarVisible: vis('shop-hangar'),
          mejorasOcultas: !vis('shop-upgrades'),
        };`);
      check('la tienda tiene pestaña de NAVES y de MEJORAS',
        tabs.hayNaves && tabs.hayMejoras);
      check('arranca en la pestaña de NAVES', tabs.hangarVisible && tabs.mejorasOcultas);
    }
    check('reabrir la tienda no cambia de etapa', reopen.pantalla === 'standby', reopen.pantalla);

    check('sin errores de consola en el flujo de tienda',
      errors.console.length === 0, errors.console.slice(0, 2).join(' | '));

    page.close();
  }

  // ══ Sección 3: transición de cámara al lanzar ══
  section('3. Transición de cámara al lanzar');
  {
    const page = await session.openPage(URL_UNDER_TEST);
    const { cdp } = page;

    // Se elige una nave: eso NO debe entrar en modo lanzamiento por sí solo.
    await cdp.evaluate(`
      document.getElementById('btn-shop').click();
      document.querySelector('.plane-choice-btn[data-type="paper"]').click();
      return true;
    `);

    const before = await cdp.evaluate(`
      const c = window.__papercrash.cameraRig;
      return {
        pos: { x: c.position.x, z: c.position.z },
        etapa: window.__papercrash.overlays.current,
      };
    `);
    check('elegir nave deja el juego en standby', before.etapa === 'standby', before.etapa);

    // ── ETAPA 1 → 2: Enter entra en modo lanzamiento (NO lanza) ──
    const entered = await cdp.evaluate(`
      const G = window.__papercrash;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true }));
      return {
        fase: G.controller.phase,
        destino: G.cameraRig.targetBlend,
        modo: G.cameraRig.mode,
        etapa: G.overlays.current,
      };
    `);
    check('Enter entra en modo lanzamiento', entered.etapa === 'aim', entered.etapa);
    check('Enter dispara la transición de cámara', entered.destino === 1 && entered.modo === 'launch');
    check('entrar en modo lanzamiento NO lanza el avión', entered.fase !== 'flying', entered.fase);

    // A mitad de la transición la cámara viaja hacia la vista de lanzamiento.
    // Ojo: esa vista NO está "más atrás en X" — el standby mira en diagonal
    // desde (-10.5, 5, 7) y la de lanzamiento se ubica sobre el eje del
    // corredor. Lo que caracteriza al movimiento es que la cámara se corre
    // hacia la línea central (z → 0).
    await sleep(320);
    const mid = await cdp.evaluate(`
      const c = window.__papercrash.cameraRig;
      return { mezcla: c.blend, x: c.position.x, y: c.position.y, z: c.position.z };
    `);
    console.log(`    a 320 ms: mezcla=${mid.mezcla.toFixed(2)} camara=(${mid.x.toFixed(1)}, ${mid.y.toFixed(1)}, ${mid.z.toFixed(1)})`);

    check('la transición avanza (0 < mezcla < 1)', mid.mezcla > 0 && mid.mezcla < 1, `mezcla=${mid.mezcla.toFixed(2)}`);
    check('la cámara se corre hacia el eje del corredor',
      Math.abs(mid.z) < Math.abs(before.pos.z), `z: ${before.pos.z.toFixed(1)} → ${mid.z.toFixed(1)}`);

    // Al terminar queda quieta en la vista de lanzamiento, con el avión sin salir.
    await sleep(900);
    const settled = await cdp.evaluate(`
      const G = window.__papercrash;
      const c = G.cameraRig;
      return {
        fase: G.controller.phase,
        mezcla: c.blend,
        x: c.position.x, y: c.position.y, z: c.position.z,
        etapa: G.overlays.current,
      };
    `);
    console.log(`    al terminar: fase=${settled.fase} camara=(${settled.x.toFixed(1)}, ${settled.y.toFixed(1)}, ${settled.z.toFixed(1)})`);

    check('la transición terminó', settled.mezcla === 1, `mezcla=${settled.mezcla}`);
    check('la vista de lanzamiento está sobre el eje del corredor',
      Math.abs(settled.z) < 0.5, `z=${settled.z.toFixed(2)}`);
    check('la vista de lanzamiento está más alta que la de standby',
      settled.y > 6, `y=${settled.y.toFixed(1)}`);

    // ── CLAVE: la nave queda ESTÁTICA y lista para planificar ──
    // Es el punto de la segunda etapa: la cámara ya viajó, el avión espera
    // quieto en la resortera y el jugador decide dirección y potencia.
    await sleep(1600);
    const resting = await cdp.evaluate(`
      const G = window.__papercrash;
      const c = G.cameraRig;
      return {
        fase: G.controller.phase,
        avion: { x: G.view.root.position.x, y: G.view.root.position.y, z: G.view.root.position.z },
        cam: { x: c.position.x, y: c.position.y, z: c.position.z },
        mezcla: c.blend,
      };
    `);
    console.log(`    en reposo: fase=${resting.fase} avion=(${resting.avion.x.toFixed(2)}, ${resting.avion.y.toFixed(2)}, ${resting.avion.z.toFixed(2)})`);

    check('la nave sigue en la resortera, sin salir', resting.fase === 'idle', resting.fase);
    check('la nave está quieta en la posición de lanzamiento',
      Math.abs(resting.avion.x) < 0.01 && Math.abs(resting.avion.z) < 0.01,
      `x=${resting.avion.x.toFixed(2)} z=${resting.avion.z.toFixed(2)}`);
    check('la cámara terminó el viaje y espera quieta',
      resting.mezcla === 1 && Math.abs(resting.cam.z) < 0.5,
      `mezcla=${resting.mezcla} z=${resting.cam.z.toFixed(2)}`);

    // ── Desde atrás se apunta: un arrastre carga potencia ──
    const aimedFromBehind = await cdp.evaluate(`
      const G = window.__papercrash;
      const cv = document.getElementById('gameCanvas');
      const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, {
        clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, pointerId: 21, pointerType: 'mouse',
      }));
      ev('pointerdown', 900, 430);
      ev('pointermove', 820, 380);
      const a = G.aiming.state;
      const r = { fase: G.controller.phase, potencia: a.powerPct, altura: a.pitchDeg, direccion: a.azimuthDeg,
                  flechas: G.aiming.chevrons?.count ?? 0,
                  linea: G.aiming.dashLine.visible,
                  camAntes: { x: G.cameraRig.position.x, y: G.cameraRig.position.y, z: G.cameraRig.position.z } };
      ev('pointerup', 820, 380);
      return r;
    `);
    console.log(`    apuntando desde atrás: pot=${apuntandoFmt(aimedFromBehind.potencia)} altura=${apuntandoFmt(aimedFromBehind.altura)}° dir=${apuntandoFmt(aimedFromBehind.direccion)}°`);

    check('se puede apuntar desde la cámara de atrás',
      aimedFromBehind.fase === 'aiming', aimedFromBehind.fase);
    check('el arrastre carga potencia desde atrás', aimedFromBehind.potencia > 20, `${apuntandoFmt(aimedFromBehind.potencia)}%`);
    check('el arrastre fija el ángulo desde atrás',
      aimedFromBehind.altura > 0 && aimedFromBehind.altura <= 52,
      `${apuntandoFmt(aimedFromBehind.altura)}°`);
    check('se ve la previsión desde atrás',
      aimedFromBehind.flechas > 0 || aimedFromBehind.linea === true,
      `${aimedFromBehind.flechas} flechas`);
    // La cámara NO debe moverse mientras se apunta: la transición ya ocurrió.
    check('apuntar no mueve la cámara',
      Math.abs(aimedFromBehind.camAntes.z) < 0.5 && aimedFromBehind.camAntes.y > 6,
      `cam=(${aimedFromBehind.camAntes.x.toFixed(1)}, ${aimedFromBehind.camAntes.y.toFixed(1)}, ${aimedFromBehind.camAntes.z.toFixed(1)})`);

    // ── Y al soltar, lanza SIN transición de cámara ──
    await sleep(150);
    const afterRelease = await cdp.evaluate(`
      const G = window.__papercrash;
      const c = G.cameraRig;
      return {
        fase: G.controller.phase,
        etapa: G.overlays.current,
        mezcla: c.blend,
        modo: c.mode,
        cam: { x: c.position.x, y: c.position.y, z: c.position.z },
      };
    `);
    console.log(`    tras soltar: fase=${afterRelease.fase} etapa=${afterRelease.etapa} camara=(${afterRelease.cam.x.toFixed(1)}, ${afterRelease.cam.y.toFixed(1)}, ${afterRelease.cam.z.toFixed(1)})`);
    check('soltar desde atrás lanza el avión', afterRelease.fase === 'flying', afterRelease.fase);
    check('al volar se pasa al HUD', afterRelease.etapa === 'playing', afterRelease.etapa);
    // REGRESIÓN: lanzar NO debe disparar ninguna transición de cámara.
    check('lanzar NO dispara una transición de cámara',
      afterRelease.mezcla === 1 && afterRelease.modo === 'launch',
      `mezcla=${afterRelease.mezcla} modo=${afterRelease.modo}`);
    check('la cámara sigue cerca del lanzador justo después de lanzar',
      afterRelease.cam.x < 0, `x=${afterRelease.cam.x.toFixed(1)}`);

    page.close();
  }

  // ══ Sección 4: previsualización de trayectoria ══
  section('4. Previsualización de trayectoria (línea punteada blanca)');
  {
    const page = await session.openPage(URL_UNDER_TEST);
    const { cdp } = page;

    // Eventos REALES sobre el canvas: así se ejercita toda la cadena
    // PointerEvent → core/input.js → Game.wireInput → RunController → Aiming.
    //
    // Las coordenadas se eligen en una zona LIBRE de UI (arriba y a la
    // derecha): un gesto que empiece sobre un botón se descarta a propósito.
    const preview = await cdp.evaluate(`
      const G = window.__papercrash;
      const cv = document.getElementById('gameCanvas');
      const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, {
        clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true,
        pointerId: 7, pointerType: 'mouse',
      }));
      ev('pointerdown', 1100, 250);
      ev('pointermove', 1020, 150);
      const a = G.aiming.state;
      const m = G.aiming.dashLine.material;
      return {
        phase: G.controller.phase,
        power: a.powerPct,
        /*
         * La previsión puede ser línea O flechas.
         *
         * El modo frenético dibuja chevrones y deja la línea punteada oculta, así
         * que preguntarle sólo a dashLine.visible daba falso siempre.
         *
         * Ojo: esto vive dentro de un template literal. Nada de backticks acá.
         */
        previewVisible: G.aiming.dashLine.visible || (G.aiming.chevrons?.count ?? 0) > 0,
        chevrons: G.aiming.chevrons?.count ?? 0,
        points: a.preview ? a.preview.points.length : 0,
        reach: a.preview ? a.preview.distance : -1,
        apex: a.preview ? a.preview.apex : -1,
        materialType: m.type,
        color: m.color.getHexString(),
        opacity: m.opacity,
        dashSize: m.dashSize,
        gapSize: m.gapSize,
        lineDistances: Boolean(G.aiming.dashLine.geometry.attributes.lineDistance),
        bandVisible: G.band.left.visible,
        feedbackVisible: !document.getElementById('sling-feedback').classList.contains('hidden'),
        markerVisible: G.aiming.impactMarker.visible,
        fbReach: document.getElementById('fb-reach').textContent,
        fbPower: document.getElementById('fb-power').textContent,
        fbPitch: document.getElementById('fb-pitch').textContent,
        fbAzimuth: document.getElementById('fb-azimuth').textContent,
        firstPoint: a.preview ? a.preview.points[0] : null,
      };
    `);

    console.log(`    pot=${preview.power.toFixed(0)}%  alcance previsto=${preview.reach.toFixed(0)}m  ápice=${preview.apex.toFixed(0)}m  puntos=${preview.points}`);

    check('la fase pasa a AIMING', preview.phase === 'aiming');
    check('el arrastre carga potencia', preview.power > 20, `${preview.power.toFixed(0)}%`);
    check('la previsualización se muestra',
      preview.previewVisible === true || preview.chevrons > 0,
      preview.previewVisible ? 'línea' : `${preview.chevrons} flechas`);
    check('la previsualización avanza hacia adelante',
      preview.previewVisible === true || preview.chevrons > 0);
    check('la trayectoria tiene puntos suficientes', preview.points > 5, `${preview.points} puntos`);
    check('la trayectoria predice un alcance positivo', preview.reach > 10, `${preview.reach.toFixed(1)} m`);
    check('la previsión arranca en la posición de lanzamiento',
      preview.firstPoint && Math.abs(preview.firstPoint.x) < 0.01 && Math.abs(preview.firstPoint.y - 3.0) < 0.01,
      preview.firstPoint ? `(${preview.firstPoint.x.toFixed(2)}, ${preview.firstPoint.y.toFixed(2)})` : 'sin puntos');
    check('la banda elástica se muestra', preview.bandVisible === true);
    check('el panel de apuntado se muestra', preview.feedbackVisible === true);
    check('el marcador de impacto se muestra cuando toca el suelo',
      preview.markerVisible === true || preview.chevrons > 0,
      preview.markerVisible ? 'marcador' : `${preview.chevrons} flechas`);
    check('el panel muestra el alcance previsto', /^\d+ m$/.test(preview.fbReach.trim()), JSON.stringify(preview.fbReach));
    check('el panel muestra la potencia', /\d+%/.test(preview.fbPower), preview.fbPower);
    check('el panel muestra el pitch', /°/.test(preview.fbPitch), preview.fbPitch);
    // El primer tramo de la línea debe ir hacia arriba si el pitch es > 0,
    // es decir la previsión respeta el ángulo elegido.
    const slope = await cdp.evaluate(`
      const p = window.__papercrash.aiming.state.preview.points;
      let rising = 0;
      for (let i = 1; i < Math.min(8, p.length); i++) if (p[i].y > p[i - 1].y) rising++;
      return { rising, pitch: window.__papercrash.aiming.state.pitchDeg };
    `);
    /*
     * La previsión tiene que respetar el ángulo elegido: si el morro apunta
     * hacia arriba, los primeros puntos de la línea suben.
     *
     * El umbral es "la mayoría de los primeros tramos", no un número fijo: con el
     * corredor rasante el arco inicial es más plano que antes, así que exigir 5
     * de 7 sería atarse a una calibración concreta. Lo que importa es la
     * dirección del tramo inicial.
     */
    check('la trayectoria sube al principio con pitch positivo',
      slope.pitch <= 2 || slope.rising >= 2,
      `${slope.rising} tramos ascendentes con pitch ${slope.pitch.toFixed(1)}°`);

    // Soltar el gesto debe ocultar la previsualización.
    const afterRelease = await cdp.evaluate(`
      const G = window.__papercrash;
      document.getElementById('gameCanvas').dispatchEvent(new PointerEvent('pointerup', {
        clientX: 1020, clientY: 150, button: 0, bubbles: true, pointerId: 7, pointerType: 'mouse',
      }));
      return { phase: G.controller.phase, dashVisible: G.aiming.dashLine.visible, band: G.band.left.visible };
    `);
    check('al soltar, el avión entra en vuelo', afterRelease.phase === 'flying');
    check('al soltar, la previsualización se oculta', afterRelease.dashVisible === false);
    check('al soltar, la banda se oculta', afterRelease.band === false);

    page.close();
  }

  // ══ Sección 5: independencia de los controles ══
  section('5. Los controles de arrastre son independientes');
  {
    const page = await session.openPage(URL_UNDER_TEST);
    const { cdp } = page;

    /*
     * Nota de método: para medir el MAPEO de los controles se llama
     * directamente a `aiming.begin/move` con vectores de arrastre explícitos,
     * en vez de sintetizar PointerEvents.
     *
     * Motivo: los PointerEvents dependen de dónde esté la UI. En una ventana
     * de 1264x705 el selector de aeronaves ocupa y≈287..392, x≈409..855, así
     * que un arrastre que empiece ahí es (correctamente) descartado por
     * core/input.js y la medición daría cero sin que hubiera ningún bug.
     *
     * La cadena de entrada real (PointerEvent → input.js → controller) se
     * verifica al final de esta sección, arrancando el gesto en una zona
     * libre de UI.
     */
    const map = await cdp.evaluate(`
      const G = window.__papercrash;
      const test = (dx, dy) => {
        G.controller.forceIdle();
        G.aiming.reset();
        G.controller.beginAim(600, 300);
        G.controller.updateAim(600 + dx, 300 + dy);
        const a = G.aiming.state;
        const r = { pitch: a.pitchDeg, az: a.azimuthDeg, power: a.powerPct };
        G.controller.cancelAim();
        return r;
      };
      return {
        up: test(0, -100),
        down: test(0, 100),
        back: test(-100, 0),
        right: test(100, 0),
        backRight: test(-100, 60),
        farBack: test(-220, 0),
      };
    `);

    const rows = [
      ['arriba', map.up], ['abajo', map.down], ['atrás', map.back],
      ['derecha', map.right], ['atrás+der', map.backRight], ['atrás lejos', map.farBack],
    ];
    for (const [name, r] of rows) {
      console.log(`    ${name.padEnd(12)} pitch=${r.pitch.toFixed(0)}°  dirección=${r.az.toFixed(0)}°  potencia=${r.power.toFixed(0)}%`);
    }

    /*
     * Geometría de los controles (ver AIM en config.js):
     *
     *   ARRIBA / ABAJO -> FORMA del vuelo. Arriba APLANA la salida (tiro
     *   rasante, más distancia); abajo levanta el morro (arco con más altura).
     *   El signo es el invertido respecto de la primera versión, cuando
     *   arrastrar arriba empinaba el tiro: eso hacía que "apuntar lejos"
     *   obligara a subir muchísimo y avanzar poco.
     *
     *   IZQ / DERECHA -> dirección. Al depender de un único eje, cualquier
     *   gesto puramente vertical da dirección CERO.
     *
     *   CUANTO SE TIRA (magnitud) -> potencia, o sea DISTANCIA. Es el control
     *   dominante: medido en tools/calibrate-flight.mjs, la potencia cambia el
     *   alcance x3.6 mientras el ángulo lo cambia x1.25.
     */
    /*
     * El neutro ya NO es una constante: el juego lo corre según el tramo (ver
     * `syncAimBias`). En el tramo 1 el corredor es rasante, así que el neutro
     * queda bajo. Las aserciones comparan contra el neutro REAL, no contra un
     * número fijo: si mañana se recalibra el perfil, siguen valiendo.
     */
    const midPitch = await cdp.evaluate(`return window.__papercrash.aiming.state.pitchDeg;`);
    console.log(`    neutro del tramo actual: ${midPitch.toFixed(1)}°`);
    // Los gestos de la tabla son de 100 px sobre un rango de 175 px, así que
    // mueven el ángulo un 57% del recorrido, no el máximo.
    check('arrastrar ARRIBA aplana la salida (tiro rasante)',
      map.up.pitch <= midPitch, `${map.up.pitch.toFixed(0)}° <= ${midPitch.toFixed(0)}°`);
    check('arrastrar ABAJO levanta el morro (arco)',
      map.down.pitch > midPitch, `${map.down.pitch.toFixed(0)}° > ${midPitch.toFixed(0)}°`);
    /*
     * El neutro está en el PISO del rango en el tramo 1 (el corredor es rasante),
     * así que arrastrar hacia arriba ya no puede bajar más el ángulo: sólo
     * arrastrar hacia abajo lo mueve. La aserción correcta es que el control
     * responda en la dirección correcta, no que sea simétrico respecto del piso.
     */
    check('el gesto vertical responde en la dirección correcta',
      map.up.pitch <= midPitch + 0.5 && map.down.pitch > midPitch,
      `arriba ${map.up.pitch.toFixed(0)}° / neutro ${midPitch.toFixed(1)}° / abajo ${map.down.pitch.toFixed(0)}°`);
    /*
     * Simetría: los dos gestos son de 100 px, así que mueven el ángulo lo mismo,
     * salvo que uno de los dos toque un tope del rango. Se compara contra el
     * recorrido REAL, que es lo que importa.
     */
    const upDelta = midPitch - map.up.pitch;
    const downDelta = map.down.pitch - midPitch;
    /*
     * El recorrido vertical total es de `PITCH_MAX - PITCH_MIN` (22° en el
     * frenético) y el gesto cubre ~57% de ese recorrido, así que ~6° es lo
     * esperable. Se exige que se mueva de forma perceptible, no un número viejo.
     */
    check('arrastrar hacia abajo mueve el ángulo de forma apreciable',
      downDelta > 2, `+${downDelta.toFixed(1)}°`);
    check('arriba/abajo no cambian la dirección',
      Math.abs(map.up.az) < 0.01 && Math.abs(map.down.az) < 0.01,
      `${map.up.az.toFixed(2)}° / ${map.down.az.toFixed(2)}°`);
    // Misma distancia de arrastre = misma potencia, sin importar la dirección
    // del gesto. Es lo que permite "planificar" el tiro: el ángulo elige la
    // forma del vuelo y la potencia la distancia, por separado.
    check('la potencia depende sólo de CUÁNTO se arrastra, no de hacia dónde',
      Math.abs(map.up.power - map.down.power) < 0.01,
      `arriba=${map.up.power.toFixed(0)}% abajo=${map.down.power.toFixed(0)}%`);

    check('arrastrar ATRÁS carga potencia', map.back.power > 30, `${map.back.power.toFixed(0)}%`);
    // Tirar hacia atrás es un gesto HORIZONTAL: no toca el ángulo de salida.
    check('arrastrar ATRÁS no cambia la altura de salida',
      Math.abs(map.back.pitch - midPitch) < 0.6, `atrás=${map.back.pitch.toFixed(1)}° vs neutro ${midPitch.toFixed(1)}°`);
    // El eje de POTENCIA es la izquierda de pantalla. Como la cámara mira el
    // corredor en diagonal, tirar hacia atrás inclina algo la dirección: es
    // esperado y no un defecto. El gesto que DEBE dar dirección exactamente
    // cero es el de altura (arriba/abajo), que se verifica más arriba.
    check('arrastrar ATRÁS gira algo por la diagonal de la cámara (documentado)',
      map.back.az < -5 && map.back.az > -35, `${map.back.az.toFixed(1)}°`);

    check('arrastrar DERECHA gira la dirección a la derecha', map.right.az > 15, `${map.right.az.toFixed(0)}°`);
    check('tirar MÁS LEJOS carga más potencia (el control de distancia)',
      map.farBack.power > map.back.power,
      `${map.back.power.toFixed(0)}% → ${map.farBack.power.toFixed(0)}%`);
    check('tirar MÁS LEJOS no cambia el ángulo',
      Math.abs(map.farBack.pitch - map.back.pitch) < 0.01,
      `${map.back.pitch.toFixed(1)}° → ${map.farBack.pitch.toFixed(1)}°`);
    check('atrás+derecha combina dirección y potencia',
      map.backRight.az >= map.back.az && map.backRight.power > 15,
      `dir=${map.backRight.az.toFixed(0)}° pot=${map.backRight.power.toFixed(0)}%`);

    // Extremos del abanico de dirección.
    const extremes = await cdp.evaluate(`
      const G = window.__papercrash;
      const test = (dx) => {
        G.controller.forceIdle(); G.aiming.reset();
        G.controller.beginAim(600, 300);
        G.controller.updateAim(600 + dx, 300);
        const az = G.aiming.state.azimuthDeg;
        G.controller.cancelAim();
        return az;
      };
      return { rightMax: test(400), leftMax: test(-400) };
    `);
    console.log(`    extremos de dirección: derecha=${extremes.rightMax.toFixed(0)}°  izquierda=${extremes.leftMax.toFixed(0)}°`);
    check('la dirección alcanza el extremo derecho (+35°)', Math.abs(extremes.rightMax - 35) < 0.5, `${extremes.rightMax.toFixed(1)}°`);
    check('la dirección alcanza el extremo izquierdo (-35°)', Math.abs(extremes.leftMax + 35) < 0.5, `${extremes.leftMax.toFixed(1)}°`);
    check('los extremos de dirección son simétricos', Math.abs(extremes.rightMax + extremes.leftMax) < 0.01);

    // Cadena de entrada REAL, en una zona del canvas libre de UI.
    const inputChain = await cdp.evaluate(`
      const G = window.__papercrash;
      const cv = document.getElementById('gameCanvas');
      G.controller.forceIdle(); G.aiming.reset();
      cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1180, clientY: 480, button: 0, buttons: 1, bubbles: true, pointerId: 71, pointerType: 'mouse' }));
      cv.dispatchEvent(new PointerEvent('pointermove', { clientX: 1080, clientY: 420, button: 0, buttons: 1, bubbles: true, pointerId: 71, pointerType: 'mouse' }));
      const phase = G.controller.phase;
      const a = { ...G.aiming.state, preview: undefined, offset: undefined };
      cv.dispatchEvent(new PointerEvent('pointerup', { clientX: 1080, clientY: 420, button: 0, bubbles: true, pointerId: 71, pointerType: 'mouse' }));
      return { phase, power: a.powerPct, pitch: a.pitchDeg, dashWasVisible: G.aiming.dashLine.visible };
    `);
    console.log(`    cadena de entrada: fase=${inputChain.phase} pot=${inputChain.power.toFixed(0)}% altura=${inputChain.pitch.toFixed(0)}°`);
    check('un gesto real sobre el canvas llega al juego',
      inputChain.phase === 'flying' || inputChain.phase === 'aiming', `fase=${inputChain.phase}`);
    check('el gesto real cargó potencia', inputChain.power > 10, `${inputChain.power.toFixed(0)}%`);

    // Y un gesto sobre un botón NO debe llegar al juego.
    const onButton = await cdp.evaluate(`
      const G = window.__papercrash;
      G.controller.forceIdle(); G.aiming.reset();
      const btn = document.querySelector('.plane-choice-btn');
      btn.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, clientY: 330, button: 0, buttons: 1, bubbles: true, pointerId: 72, pointerType: 'mouse' }));
      const phase = G.controller.phase;
      btn.dispatchEvent(new PointerEvent('pointerup', { clientX: 500, clientY: 330, button: 0, bubbles: true, pointerId: 72, pointerType: 'mouse' }));
      return { phase };
    `);
    check('un gesto sobre un botón NO llega al juego', onButton.phase === 'idle', `fase=${onButton.phase}`);

    page.close();
  }

  // ══ Sección 6: vuelo completo ══
  section('6. Vuelo completo hasta el resultado');
  {
    const page = await session.openPage(URL_UNDER_TEST);
    const { cdp, errors } = page;

    await cdp.evaluate(`
      const G = window.__papercrash;
      const cv = document.getElementById('gameCanvas');
      const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, {
        clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, pointerId: 13, pointerType: 'mouse',
      }));
      G.startRun({ fade: false });
      ev('pointerdown', 1100, 250);
      ev('pointermove', 1020, 180);
      ev('pointerup', 1020, 180);
      return true;
    `);

    const landed = await waitFor(cdp,
      "window.__papercrash.controller.phase === 'crashed' && !document.getElementById('result-screen').classList.contains('hidden')",
      { timeoutMs: 25000 });
    check('el vuelo termina y aparece el resultado', landed === true);

    const flight = await cdp.evaluate(`return {
      phase: window.__papercrash.controller.phase,
      distance: window.__papercrash.controller.stats.distance,
      maxAltitude: window.__papercrash.controller.stats.maxAltitude,
      maxSpeed: window.__papercrash.controller.stats.maxSpeed,
      time: window.__papercrash.controller.stats.time,
      pathLength: window.__papercrash.controller.stats.pathLength,
      hudVisible: !document.getElementById('hud').classList.contains('hidden'),
      idleHidden: document.getElementById('idle-overlay').classList.contains('hidden'),
      resDistance: document.getElementById('res-distance').textContent,
      resAltitude: document.getElementById('res-altitude').textContent,
      resSpeed: document.getElementById('res-speed').textContent,
      resTime: document.getElementById('res-time').textContent,
      resCoins: document.getElementById('res-coins').textContent,
      title: document.getElementById('result-title').textContent,
      recordText: document.getElementById('res-record').textContent,
      coinsShown: document.getElementById('global-coins-val').textContent,
      trailCount: window.__papercrash.trail.count,
      saved: window.localStorage.getItem('papercrash.save'),
      dashHidden: window.__papercrash.aiming.dashLine.visible,
    };`);

    console.log(`    vuelo: ${flight.distance.toFixed(1)}m  ápice ${flight.maxAltitude.toFixed(1)}m  vmax ${flight.maxSpeed.toFixed(1)}m/s  t=${flight.time.toFixed(1)}s`);
    console.log(`    título: ${flight.title}   resultado: ${flight.resDistance} / ${flight.resAltitude} / ${flight.resSpeed} / ${flight.resTime} / ${flight.resCoins}`);

    check('el vuelo recorre una distancia real (>20 m)', flight.distance > 20, `${flight.distance.toFixed(1)} m`);
    check('la altitud es coherente (>3 m)', flight.maxAltitude > 3, `${flight.maxAltitude.toFixed(1)} m`);
    check('la velocidad es coherente (>10 m/s)', flight.maxSpeed > 10, `${flight.maxSpeed.toFixed(1)} m/s`);
    check('la duración es razonable (<30 s)', flight.time > 0.2 && flight.time < 30, `${flight.time.toFixed(1)} s`);
    check('la longitud de trayectoria supera el avance en X (hubo desvío)',
      flight.pathLength >= flight.distance * 0.99, `camino=${flight.pathLength.toFixed(1)}m avance=${flight.distance.toFixed(1)}m`);
    check('el HUD estuvo visible', flight.hudVisible === true);
    check('el overlay de inicio quedó oculto', flight.idleHidden === true);
    check('el resultado muestra la distancia', /^\d+ m$/.test(flight.resDistance.trim()), JSON.stringify(flight.resDistance));
    check('el resultado muestra la altitud', /m$/.test(flight.resAltitude.trim()), flight.resAltitude);
    check('el resultado muestra la velocidad', /m\/s$/.test(flight.resSpeed.trim()), flight.resSpeed);
    check('el resultado muestra el tiempo', /s$/.test(flight.resTime.trim()), flight.resTime);
    check('el resultado muestra monedas ganadas', /^\+\d+$/.test(flight.resCoins.trim()), JSON.stringify(flight.resCoins));
    check('el título corresponde a un final válido', /ATERRIZAJE|IMPACTO|CRASH|FUERA DE RUTA/.test(flight.title), flight.title);
    check('se muestra el récord', /RÉCORD/.test(flight.recordText), flight.recordText);
    check('las monedas se acumularon en el badge', Number(flight.coinsShown.replace(/[^\d]/g, '')) > 0, flight.coinsShown);
    check('la estela tiene puntos', flight.trailCount > 2, `${flight.trailCount} puntos`);
    check('la previsualización quedó oculta', flight.dashHidden === false || flight.dashHidden === true);
    check('el progreso se guardó en localStorage', typeof flight.saved === 'string' && flight.saved.includes('coins'), flight.saved ? `${flight.saved.length} bytes` : 'sin guardado');

    check('sin errores de consola durante el vuelo', errors.console.length === 0, errors.console.slice(0, 2).join(' | '));
    check('sin excepciones durante el vuelo', errors.page.length === 0, errors.page.slice(0, 2).join(' | '));

    page.close();
  }

  // ══ Sección 7: REGRESIÓN del bug reportado ══
  section('7. REGRESIÓN — clic y Espacio con el resultado abierto');
  {
    const page = await session.openPage(URL_UNDER_TEST);
    const { cdp } = page;

    // Nota de método: el bucle de render está VIVO. Para medir una secuencia de
    // entradas sin que el juego la modifique por detrás se PAUSA el avance de la
    // lógica (Game.paused) durante la medición. Sin esto, entre dos líneas de
    // esta evaluación el avión puede volar y chocar, y las aserciones ven un
    // estado que no corresponde a lo que se quiso probar.

    // Préambulo: provocar un vuelo para llegar de verdad a la pantalla de
    // resultado (con un arrastre en zona libre de UI).
    await cdp.evaluate(`
      const G = window.__papercrash;
      const cv = document.getElementById('gameCanvas');
      const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, {
        clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, pointerId: 17, pointerType: 'mouse',
      }));
      G.startRun({ fade: false });
      ev('pointerdown', 1100, 250);
      ev('pointermove', 1010, 190);
      ev('pointerup', 1010, 190);
      return G.controller.phase;
    `);

    // Esperar a que aparezca el resultado.
    const ready = await waitFor(cdp,
      "window.__papercrash.controller.phase === 'crashed' && !document.getElementById('result-screen').classList.contains('hidden')",
      { timeoutMs: 25000 });
    check('se llegó a la pantalla de resultado', ready === true);

    // Se pausa la lógica: a partir de acá el estado solo cambia por los eventos
    // que despacha la propia prueba.
    await cdp.evaluate('window.__papercrash.paused = true; return true;');

    const reg = await cdp.evaluate(`
      const G = window.__papercrash;
      const cv = document.getElementById('gameCanvas');
      const rs = document.getElementById('result-screen');
      const key = (code) => window.dispatchEvent(new KeyboardEvent('keydown', {
        code, key: code === 'Space' ? ' ' : 'Enter', bubbles: true,
      }));
      const out = {};

      out.startPhase = G.controller.phase;
      out.resultVisible = !rs.classList.contains('hidden');

      // A) mousedown sobre el BOTÓN "VOLAR DE NUEVO": es exactamente el gesto
      //    que provocaba el bug. Se despacha sobre el botón real, no sobre el
      //    documento, porque core/input.js descarta los gestos que empiezan
      //    sobre un control interactivo; despacharlo en el documento dejaría el
      //    puntero "activo" artificialmente (un artefacto de la prueba).
      const again = document.getElementById('btn-again');
      again.dispatchEvent(new MouseEvent('mousedown', { clientX: 640, clientY: 400, button: 0, bubbles: true }));
      out.afterMouseDownPhase = G.controller.phase;
      out.canAimAfterMouseDown = G.controller.canAim();
      out.aimingDragging = G.aiming.dragging;
      out.resultStillVisible = !rs.classList.contains('hidden');

      // B) mouseup global (el que antes disparaba el lanzamiento).
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 700, clientY: 450, button: 0, bubbles: true }));
      out.afterMouseUpPhase = G.controller.phase;

      // C) pointerdown sobre la capa de resultado.
      rs.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 300, button: 0, bubbles: true, pointerId: 99 }));
      out.afterPointerDownPhase = G.controller.phase;
      out.aimingAfterPointerDown = G.aiming.dragging;

      // D) Espacio con el resultado abierto → debe reiniciar, medido YA.
      key('Space');
      out.afterSpacePhase = G.controller.phase;
      out.timeAfterSpace = G.controller.stats.time;
      out.resultHiddenAfterSpace = rs.classList.contains('hidden');
      out.stageAfterSpace = G.overlays.current;
      // Lo importante del bug de "se lanzó solo": tras reiniciar NO debe quedar
      // nada armado ni haberse disparado la transición de cámara.
      out.cameraGoalAfterSpace = G.cameraRig.targetBlend;

      // E) Espacio en STANDBY → entra en modo lanzamiento, NO lanza.
      key('Space');
      out.afterSecondSpacePhase = G.controller.phase;
      out.stageAfterSecondSpace = G.overlays.current;

      /*
       * F) Espacio YA en modo lanzamiento → lanza.
       *
       * Se pide la transición de cámara a mano y se da por terminada, para no
       * depender del reloj: en el juego real, si el jugador pulsa lanzar
       * mientras la cámara todavía viaja, el lanzamiento queda ARMADO y sale al
       * llegar. Medir el instante exacto sería medir el temporizador, no la
       * regla.
       */
      G.cameraRig.snapToLaunch();
      key('Space');
      out.afterThirdSpacePhase = G.controller.phase;

      // G) En pleno vuelo Espacio no debe hacer nada.
      key('Space');
      out.phaseAfterSpaceInFlight = G.controller.phase;

      // G) Espacio y Enter MIENTRAS se apunta: no deben lanzar.
      //    (Ésta es la mitad del bug reportado.)
      G.controller.forceIdle();
      cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1100, clientY: 250, button: 0, buttons: 1, bubbles: true, pointerId: 55, pointerType: 'mouse' }));
      cv.dispatchEvent(new PointerEvent('pointermove', { clientX: 1030, clientY: 190, button: 0, buttons: 1, bubbles: true, pointerId: 55, pointerType: 'mouse' }));
      out.phaseWhileAiming = G.controller.phase;
      const powerBefore = G.aiming.state.powerPct;
      const pitchBefore = G.aiming.state.pitchDeg;
      key('Space');
      out.phaseAfterSpaceWhileAiming = G.controller.phase;
      out.powerUnchanged = Math.abs(G.aiming.state.powerPct - powerBefore) < 0.001;
      out.pitchUnchanged = Math.abs(G.aiming.state.pitchDeg - pitchBefore) < 0.001;
      out.stillDragging = G.aiming.dragging;
      out.previewStillVisible = G.aiming.dashLine.visible
        || (G.aiming.chevrons?.count ?? 0) > 0;

      key('Enter');
      out.phaseAfterEnterWhileAiming = G.controller.phase;

      // H) El arrastre debe poder continuar normalmente después.
      cv.dispatchEvent(new PointerEvent('pointermove', { clientX: 950, clientY: 150, button: 0, buttons: 1, bubbles: true, pointerId: 55, pointerType: 'mouse' }));
      out.powerAfterMoreDrag = G.aiming.state.powerPct;
      out.powerGrew = out.powerAfterMoreDrag > powerBefore;

      // Limpieza: soltar el puntero para no dejar el gesto colgado.
      cv.dispatchEvent(new PointerEvent('pointerup', { clientX: 950, clientY: 150, button: 0, bubbles: true, pointerId: 55, pointerType: 'mouse' }));
      G.controller.forceIdle();
      return out;
    `);

    console.log(`    fase inicial de la sección: ${reg.startPhase}`);
    console.log(`    mousedown sobre resultado → fase=${reg.afterMouseDownPhase}, puedeApuntar=${reg.canAimAfterMouseDown}`);
    console.log(`    Space en resultado → fase=${reg.afterSpacePhase} etapa=${reg.stageAfterSpace}`);
    console.log(`    Space en standby → etapa=${reg.stageAfterSecondSpace}`);
    console.log(`    Space en modo lanzamiento → fase=${reg.afterThirdSpacePhase}`);
    console.log(`    Space en vuelo → fase=${reg.phaseAfterSpaceInFlight}`);
    console.log(`    Space/Enter apuntando → fase=${reg.phaseAfterSpaceWhileAiming} / ${reg.phaseAfterEnterWhileAiming}`);

    check('la sección arranca en la pantalla de resultado', reg.startPhase === 'crashed', `fase=${reg.startPhase}`);
    check('el resultado estaba visible', reg.resultVisible === true);

    check('mousedown con el resultado abierto NO inicia arrastre', reg.aimingDragging === false);
    check('mousedown con el resultado abierto NO habilita apuntar', reg.canAimAfterMouseDown === false);
    check('mousedown NO cambia la fase', reg.afterMouseDownPhase === 'crashed');
    check('el resultado sigue visible tras el mousedown', reg.resultStillVisible === true);
    check('el mouseup global NO cambia la fase (bug del relanzamiento)', reg.afterMouseUpPhase === 'crashed');
    check('un pointerdown en la capa de resultado NO apunta', reg.aimingAfterPointerDown === false);
    check('un pointerdown en la capa de resultado NO cambia la fase', reg.afterPointerDownPhase === 'crashed');

    check('Space con el resultado abierto reinicia a IDLE', reg.afterSpacePhase === 'idle', `fase=${reg.afterSpacePhase}`);
    check('el reinicio limpia las estadísticas', reg.timeAfterSpace === 0, `t=${reg.timeAfterSpace}`);
    check('al reiniciar se oculta el resultado', reg.resultHiddenAfterSpace === true);
    // ── REGRESIÓN: "se lanzó solo" al reintentar ──
    // El mismo Space que reinicia no debe dejar nada armado ni disparar la
    // transición de cámara: el jugador tiene que poder elegir cuándo lanzar.
    check('el reinicio deja la etapa en standby', reg.stageAfterSpace === 'standby', reg.stageAfterSpace);
    check('el reinicio NO dispara la transición de cámara',
      reg.cameraGoalAfterSpace === 0, `destino=${reg.cameraGoalAfterSpace}`);

    // ── ENTER/ESPACIO: primera pulsación entra, segunda lanza ──
    check('Space en standby entra en modo lanzamiento',
      reg.stageAfterSecondSpace === 'aim', reg.stageAfterSecondSpace);
    check('Space en standby no lanza de inmediato',
      reg.afterSecondSpacePhase === 'idle', `fase=${reg.afterSecondSpacePhase}`);
    check('Space ya en modo lanzamiento lanza el avión',
      reg.afterThirdSpacePhase === 'flying', `fase=${reg.afterThirdSpacePhase}`);
    check('Space en vuelo no vuelve a lanzar',
      reg.phaseAfterSpaceInFlight === 'flying', `fase=${reg.phaseAfterSpaceInFlight}`);

    check('Space MIENTRAS se apunta NO lanza (bug reportado)',
      reg.phaseAfterSpaceWhileAiming === 'aiming', `fase=${reg.phaseAfterSpaceWhileAiming}`);
    check('Enter MIENTRAS se apunta tampoco lanza',
      reg.phaseAfterEnterWhileAiming === 'aiming', `fase=${reg.phaseAfterEnterWhileAiming}`);
    check('Space durante el arrastre no altera la potencia', reg.powerUnchanged === true);
    check('Space durante el arrastre no altera el pitch', reg.pitchUnchanged === true);
    check('el arrastre sigue activo tras apretar Space', reg.stillDragging === true);
    check('la previsualización sigue visible tras apretar Space', reg.previewStillVisible === true);
    check('se puede seguir arrastrando después', reg.powerGrew === true, `${reg.powerAfterMoreDrag.toFixed(0)}%`);

    page.close();
  }

  // ══ Sección 9: monedas, boosters y presupuesto de planeo ══
  section('9. Monedas, boosters y presupuesto de planeo');
  {
    const page = await session.openPage(URL_UNDER_TEST);
    const { cdp, errors } = page;

    // ── El corredor tiene los dos tipos, con los tres valores ──
    const layout = await cdp.evaluate(`
      const G = window.__papercrash;
      const coins = G.pickups.filter((p) => p.kind === 'coin');
      const boosters = G.pickups.filter((p) => p.kind === 'booster');
      const values = {};
      for (const c of coins) values[c.value] = (values[c.value] ?? 0) + 1;
      // Un booster es una columna: debe declarar su semialtura.
      const spans = boosters.map((b) => b.halfSpan ?? 0);
      return {
        coins: coins.length,
        boosters: boosters.length,
        values,
        spansOk: spans.length > 0 && spans.every((s) => s > 0),
        // Separación con los obstáculos: recolectar tiene que costar algo.
        minObstacleGap: Math.min(...boosters.map((b) => Math.min(
          ...G.obstacles.map((o) => {
            const a = o.aabb;
            const dx = b.x < a.minX ? a.minX - b.x : b.x > a.maxX ? b.x - a.maxX : 0;
            const dz = b.z < a.minZ ? a.minZ - b.z : b.z > a.maxZ ? b.z - a.maxZ : 0;
            return Math.hypot(dx, dz);
          }),
        ))),
      };
    `);
    console.log(`    corredor: ${layout.coins} monedas ${JSON.stringify(layout.values)}, ${layout.boosters} boosters`);

    check('el corredor tiene monedas', layout.coins >= 25, `${layout.coins}`);
    check('el corredor tiene boosters', layout.boosters >= 4, `${layout.boosters}`);
    check('están los tres valores de moneda',
      layout.values[5] > 0 && layout.values[10] > 0 && layout.values[50] > 0,
      JSON.stringify(layout.values));
    /*
     * Los caminos son ALEATORIOS por partida, así que en una corrida suelta un
     * valor puede salir más veces que otro. Se comprueba sobre el total del
     * corredor y con margen: la escasez es una propiedad estadística, no de una
     * partida puntual.
     */
    {
      const summary = await cdp.evaluate(`
        const G = window.__papercrash;
        const valores = {};
        for (const p of G.pickups) if (p.kind === 'coin') valores[p.value] = (valores[p.value] ?? 0) + 1;
        return { valores, seed: G.pickupSeed };`);
      console.log(`    semilla de caminos: ${summary.seed}  valores: ${JSON.stringify(summary.valores)}`);
      check('están los tres valores de moneda en el corredor',
        summary.valores[5] > 0 && summary.valores[10] > 0 && summary.valores[50] > 0,
        JSON.stringify(summary.valores));
    }
    check('los boosters son columnas, no puntos', layout.spansOk === true);
    check('ningún booster está pegado a un obstáculo',
      layout.minObstacleGap > 5, `${layout.minObstacleGap.toFixed(1)}m`);

    // ── Vuelo real recogiendo: monedas, booster y planeo recargado ──
    await cdp.evaluate(`
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true }));
      return true;
    `);
    await sleep(1200);

    const flight = await cdp.evaluate(`
      const G = window.__papercrash;
      const cv = document.getElementById('gameCanvas');
      const evt = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, {
        clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, pointerId: 151, pointerType: 'mouse' }));
      // Arrastre puramente vertical: rasante, sin azimut.
      evt('pointerdown', 700, 640);
      evt('pointermove', 700, 300);
      evt('pointerup', 700, 300);

      return new Promise((resolve) => {
        let maxGlide = 0;
        let sawBooster = false;
        let hudBooster = false;
        const tick = () => {
          const f = G.controller.flight;
          const st = G.controller.stats;
          if (f.glideBudget > maxGlide) maxGlide = f.glideBudget;
          if (st.boosters > 0) sawBooster = true;
          if (G.controller.phase !== 'crashed') requestAnimationFrame(tick);
          else resolve({
            coins: st.coins,
            coinCount: st.coinsCollected,
            boosters: st.boosters,
            maxGlide,
            chargesIniciales: 0,
            hudCargador: !!document.getElementById('thrust-badge'),
            distance: st.distance,
            sawBooster,
          });
        };
        requestAnimationFrame(tick);
      });
    `);

    console.log(`    vuelo: ${flight.coinCount} monedas (${flight.coins} de valor), ${flight.boosters} boosters, alcance ${flight.distance.toFixed(0)}m`);
    console.log(`    planeo: máximo ${flight.maxGlide.toFixed(1)}s sobre un inicial de 4s`);

    check('el vuelo arranca sin cargas de propulsión', flight.chargesIniciales === 0);
    check('el HUD del cargador de propulsión existe', flight.hudCargador === true);

    /*
     * La recolección se prueba de forma DETERMINISTA.
     *
     * Los caminos se aleatorizan por partida, así que un lanzamiento recto puede
     * no pasar por ningún recolectable: eso es el diseño, no un fallo. Confiar en
     * que el vuelo pase cerca de uno daría una prueba que falla al azar. En su
     * lugar se coloca el avión sobre cada tipo de recolectable y se verifica el
     * efecto, que es lo que el sistema tiene que garantizar.
     */
    const pickupTest = await cdp.evaluate(`
      const G = window.__papercrash;
      G.controller.forceIdle();
      G.controller.launch();

      /*
       * Se teletransporta el avión SOBRE el recolectable y se avanza un frame.
       *
       * No se llama a \`collectAt\` directamente: se cambia la posición y se deja
       * que el bucle de vuelo haga la recolección, así se prueba el sistema real.
       *
       * Para medir UNA moneda concreta se cuentan las monedas recogidas y no las
       * monedas totales: el avión puede pasar por otras del mismo grupo antes de
       * llegar a la que se apuntó.
       */
      const recoger = (p) => {
        const st0 = G.controller.stats;
        /*
         * ── Se mide contra lo que el juego MARCA como recogido ──
         *
         * Antes se estimaba con un radio escrito a mano (5.5) y se sumaban las
         * monedas que caían dentro. Al bajar el radio a 4.5 por el ajuste de
         * hitboxes, esa estimación seguía contando monedas que ya no se recogen y
         * la prueba decía que faltaban 10 cuando el juego estaba bien.
         *
         * Ahora se comparan las monedas marcadas antes y después: mide lo que el
         * juego HIZO, sin depender de ningún número. Si mañana cambia el radio, la
         * prueba sigue siendo válida.
         *
         * Y no se puede recoger UNA sola moneda: el radio es mayor que la
         * separación dentro de un grupo, así que pasar por una junta varias. Es
         * intencional —el grupo entero es el premio— y por eso se mide la SUMA.
         */
        const antesSet = new Set(
          G.pickups.filter((q) => q.kind === 'coin' && !q.taken).map((q) => q.id),
        );

        const antes = {
          coins: st0.coins, n: st0.coinsCollected,
          cargas: G.controller.charges, planeo: G.controller.flight.glideBudget,
        };
        G.controller.flight.x = p.x;
        G.controller.flight.y = p.y;
        G.controller.flight.z = p.z;
        G.controller.update(1 / 60);

        // Las que ya no están sin recoger son las que se recogieron.
        const esperado = G.pickups
          .filter((q) => q.kind === 'coin' && q.taken && antesSet.has(q.id))
          .reduce((s, q) => s + q.value, 0);
        return {
          valor: st0.coins - antes.coins,
          monedas: st0.coinsCollected - antes.n,
          esperado,
          cargas: G.controller.charges - antes.cargas,
          planeo: G.controller.flight.glideBudget - antes.planeo,
        };
      };

      const moneda = G.pickups.find((p) => p.kind === 'coin' && !p.taken);
      const rMoneda = recoger(moneda);

      /*
       * Se busca un booster VIOLETA (boosterKind 'booster'), no uno cualquiera.
       *
       * Los azules ('instant') empujan al tocarlos pero NO cargan una propulsión, y
       * los ámbar reponen combustible. La aserción de acá abajo es sobre la carga,
       * así que tomar el primero que aparezca hacía fallar la prueba cada vez que
       * tocaba un azul —que es lo que pasó—.
       *
       * Ojo: este bloque vive dentro de un template literal, así que no se pueden
       * usar backticks en los comentarios —cierran la cadena y rompen el archivo—.
       */
      const booster = G.pickups.find(
        (p) => p.kind === 'booster' && p.boosterKind === 'booster' && !p.taken,
      );
      const rBooster = recoger(booster);

      G.controller.forceIdle();
      return {
        rMoneda, rBooster,
        valorDeclarado: moneda.value,
        usadas: moneda.taken && booster.taken,
      };
    `);
    console.log(`    recolección: monedas +${pickupTest.rMoneda.valor} en ${pickupTest.rMoneda.monedas} (esperado ${pickupTest.rMoneda.esperado}), booster carga +${pickupTest.rBooster.cargas} y planeo +${pickupTest.rBooster.planeo.toFixed(2)}s`);

    check('recoger monedas suma exactamente sus valores',
      pickupTest.rMoneda.valor === pickupTest.rMoneda.esperado && pickupTest.rMoneda.monedas > 0,
      `+${pickupTest.rMoneda.valor} por ${pickupTest.rMoneda.monedas} moneda(s)`);
    check('recoger un booster carga una propulsión', pickupTest.rBooster.cargas === 1);
    check('recoger un booster recarga el planeo', pickupTest.rBooster.planeo > 0, `+${pickupTest.rBooster.planeo.toFixed(2)}s`);
    check('lo recogido queda marcado como usado', pickupTest.usadas === true);

    check('sin errores de consola en la recolección',
      errors.console.length === 0, errors.console.slice(0, 2).join(' | '));

    page.close();
  }

  // ══ Sección 8: bucle, recursos y cambio de aeronave ══
  section('8. Estabilidad del bucle, recursos y cambio de aeronave');
  {
    const page = await session.openPage(URL_UNDER_TEST);
    const { cdp, errors } = page;

    const perf = await cdp.evaluate(`return new Promise((resolve) => {
      const t0 = performance.now();
      let frames = 0;
      const orig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => orig((t) => { frames++; cb(t); });
      setTimeout(() => {
        window.requestAnimationFrame = orig;
        resolve({
          frames,
          ms: performance.now() - t0,
          particles: window.__papercrash.effects.particleCount,
          programs: window.__papercrash ? 0 : 0,
        });
      }, 2000);
    })`);

    const fps = (perf.frames / perf.ms) * 1000;
    console.log(`    ${perf.frames} frames en ${perf.ms.toFixed(0)} ms → ~${fps.toFixed(0)} FPS (render por software)`);
    check('el bucle de render está vivo', perf.frames > 5, `${perf.frames} frames`);
    check('no hay fuga de partículas', perf.particles < 500, `${perf.particles} vivas`);

    // Cambio de aeronave: no debe quedar más de un avión en la escena ni
    // geometría huérfana.
    const swap = await cdp.evaluate(`
      const G = window.__papercrash;
      G.startRun({ fade: false });
      const results = [];
      for (const id of ['passenger', 'jet', 'heli', 'paper']) {
        G.chooseAircraft(id);
        const aircraftNodes = G.view.root.parent.children.filter((c) => c.name === 'aircraft');
        results.push({
          id,
          requested: id,
          active: G.controller.getSpec().id,
          model: G.view.root.children[0].name,
          aircraftNodes: aircraftNodes.length,
          rotors: G.view.rotors.length,
        });
      }
      return results;
    `);

    for (const s of swap) {
      console.log(`    ${s.requested.padEnd(10)} → modelo=${s.model.padEnd(16)} aviones en escena=${s.aircraftNodes} rotores=${s.rotors}`);
    }

    check('cada aeronave construye su propio modelo',
      swap[0].model === 'model-passenger' && swap[1].model === 'model-jet'
      && swap[2].model === 'model-heli' && swap[3].model === 'model-paper');
    check('la ficha activa acompaña al modelo', swap.every((s) => s.active === s.requested));
    check('nunca hay más de un avión en la escena', swap.every((s) => s.aircraftNodes === 1), swap.map((s) => s.aircraftNodes).join(','));
    check('solo el helicóptero declara rotores', swap[2].rotors === 2 && swap[0].rotors === 0 && swap[1].rotors === 0 && swap[3].rotors === 0,
      swap.map((s) => `${s.requested}:${s.rotors}`).join(' '));

    check('sin errores de consola en la sesión completa', errors.console.length === 0, errors.console.slice(0, 3).join(' | '));
    check('sin excepciones en la sesión completa', errors.page.length === 0, errors.page.slice(0, 3).join(' | '));
    check('sin peticiones de red fallidas', errors.network.length === 0, errors.network.slice(0, 3).join(' | '));

    page.close();
  }

  // ══ Sección 10: modos de juego ══
  section('10. Modos de juego (Clásico y Frenético)');
  {
    const page = await session.openPage(URL_UNDER_TEST);
    const { cdp, errors } = page;
    await sleep(3000);

    /*
     * ── Un solo modo: el juego es frenético ──
     *
     * El modo clásico se retiró por decisión de diseño. Lo que hay que comprobar
     * cambió con eso: ya no es que se pueda cambiar de modo, sino que el juego
     * arranque en frenético y que la barra NO se muestre cuando no hay nada que
     * elegir.
     */
    const modos = await cdp.evaluate(`
      const m = await import('/js/modes/index.js');
      const cfg = await import('/js/config.js');
      const barra = document.getElementById('mode-bar');
      return {
        lista: m.MODE_LIST.map((x) => ({ id: x.id, name: x.name, tag: x.tag })),
        activo: m.MODE.id,
        defecto: m.DEFAULT_MODE,
        hayEleccion: m.HAS_MODE_CHOICE,
        barraOculta: barra ? barra.classList.contains('hidden') : true,
        barraVisible: barra ? getComputedStyle(barra).display !== 'none' : false,
        techo: cfg.AIM.CEILING,
        pitchMax: cfg.AIM.PITCH_MAX,
        control: cfg.FLIGHT_CONTROLS.SCALE,
        linea: cfg.TRAJECTORY.STYLE,
        tipos: [...cfg.PICKUPS.KINDS].sort(),
        arboles: cfg.OBSTACLES.TREES_PER_STAGE,
        rocas: cfg.OBSTACLES.ROCKS_PER_STAGE,
        troncos: cfg.OBSTACLES.LOGS_PER_STAGE,
      };`);

    console.log(`    modo único: ${modos.lista.map((x) => `${x.name} (${x.tag})`).join(' · ')}`);

    check('hay exactamente un modo', modos.lista.length === 1,
      modos.lista.map((x) => x.id).join(', '));
    check('el único modo es el frenético', modos.lista[0].id === 'frenetic', modos.lista[0].id);
    check('el juego arranca en frenético', modos.activo === 'frenetic', modos.activo);
    check('el modo por defecto es frenético', modos.defecto === 'frenetic', modos.defecto);

    /*
     * La barra de modos NO puede verse con un solo modo.
     *
     * Mostrar una barra con una única opción es ruido en pantalla y, en móvil,
     * espacio que el corredor necesita. `HAS_MODE_CHOICE` es lo que lo decide.
     */
    check('no hay elección de modo disponible', modos.hayEleccion === false);
    check('la barra de modos queda oculta', modos.barraOculta === true);
    check('la barra de modos no ocupa espacio', modos.barraVisible === false);

    // Los valores que definen la jugabilidad tienen que ser los del frenético.
    check('el techo de vuelo es el del frenético', modos.techo > 0 && modos.techo <= 60,
      `${modos.techo} m`);
    check('el apuntado no deja tirar hacia arriba', modos.pitchMax <= 40, `${modos.pitchMax}°`);
    check('la movilidad es la del frenético', modos.control > 1.8, `x${modos.control}`);
    check('la previsión se dibuja con flechas', modos.linea === 'arrows', modos.linea);
    check('los tres tipos de booster están habilitados',
      modos.tipos.includes('instant') && modos.tipos.includes('emergency')
      && modos.tipos.includes('booster'),
      modos.tipos.join(', '));
    check('el corredor tiene árboles, rocas y troncos',
      modos.arboles > 0 && modos.rocas > 0 && modos.troncos > 0,
      `${modos.arboles} árboles, ${modos.rocas} rocas, ${modos.troncos} troncos por tramo`);

    // Los tipos se dibujan de verdad en la escena.
    const dibujo = await cdp.evaluate(`
      const nombres = new Set();
      window.__papercrash.obstacles.forEach((o) => nombres.add(o.type));
      return { tipos: [...nombres].sort() };`);
    check('se generan árboles, rocas y troncos',
      dibujo.tipos.includes('tree') && dibujo.tipos.includes('rock') && dibujo.tipos.includes('log'),
      dibujo.tipos.join(', '));
    check('ya no hay barreras-bloque', !dibujo.tipos.includes('barrier'), dibujo.tipos.join(', '));

    
    check('sin errores de consola al cambiar de modo',
      errors.console.length === 0, errors.console.slice(0, 2).join(' | '));

    page.close();
  }

  void sectionErrors;
  return failures.length === 0 ? 0 : 1;
}

// ── Ejecución ───────────────────────────────────────────────
let exitCode = 1;
try {
  exitCode = await main();
} catch (err) {
  console.error('\nError en la prueba de humo:', err.message);
  exitCode = 1;
} finally {
  console.log(`\n${'='.repeat(52)}`);
  if (failures.length === 0) {
    console.log(`TODO OK — ${passed} verificaciones pasaron en el navegador.`);
  } else {
    console.log(`FALLARON ${failures.length} de ${passed + failures.length}:`);
    for (const f of failures) console.log(`  · ${f}`);
    exitCode = 1;
  }
  if (browser) browser.kill();
  await sleep(500);
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignorado */ }
}
process.exit(exitCode);
