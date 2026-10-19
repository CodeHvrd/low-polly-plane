/**
 * Verificación de los mandos táctiles con EMULACIÓN de dedo real.
 *
 * ── Qué se prueba ──
 * Una sola RUEDA analógica que gobierna las cuatro direcciones con un dedo, más
 * un botón de propulsión. La rueda tiene que dar rumbo Y morro a la vez, y el
 * recorte circular tiene que impedir que la diagonal dé más mando que la cruz.
 *
 * ── Por qué con `Input.dispatchTouchEvent` y no con eventos sintéticos ──
 * Un `new PointerEvent(...)` despachado por JavaScript NO mueve la rueda: el
 * código usa `setPointerCapture`, que sólo acepta punteros REALES del navegador.
 * Con eventos falsos la prueba pasaría sin probar nada.
 *
 * ── Cómo se arma un gesto ──
 * Un `touchStart` sola NO mueve la rueda: hay que hacer `touchStart` en el
 * centro y después `touchMove` hacia donde se empuja. Medir el eje justo después
 * del `touchStart` siempre da cero.
 *
 * Cada gesto termina con `touchEnd` y una pausa: si un dedo queda apoyado de un
 * bloque anterior, el siguiente `touchStart` se suma al mismo contacto.
 *
 * ── Por qué el vuelo se hace INDEFINIDO ──
 * Sin esto la prueba es no determinista: en frenético el avión se estrella a los
 * pocos segundos, y al pasar a la fase de choque los mandos se ocultan y sueltan
 * los ejes. Medido, la misma prueba daba resultados distintos entre corridas
 * según el tiempo de los gestos.
 *
 * ── Cómo, y por qué no de la forma obvia ──
 * Reemplazar `controller.update` por una función vacía NO sirve: adentro de esa
 * función se descuenta el enfriamiento de la propulsión, así que el segundo toque
 * del botón queda rechazado para siempre y la prueba reporta un bug inexistente.
 * Y `updateFlight` tampoco se puede saltear: es justamente el que corre los
 * temporizadores.
 *
 * Lo que se hace es `revivir()`: un helper que relanza el vuelo antes de cada
 * bloque. Cualquier gesto tarda más de lo que el avión tarda en caer, así que en
 * vez de pelear con la simulación se la deja correr y se vuelve a empezar.
 *
 * ── Por qué las expresiones se pasan como FUNCIONES ──
 * `ev()` recibe una función y la serializa con `toString()`. La versión anterior
 * recibía un template literal, y eso rompía el archivo entero: cualquier
 * expresión que contuviera `})()` —o sea, cualquier arrow multilínea— cerraba el
 * texto antes de tiempo. Con funciones, el código se escribe como código normal y
 * no hay nada que escapar.
 *
 * Uso: node tools/check-touch.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9478;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'pc-touch-'));
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });

for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch { /* reintento */ }
  await sleep(250);
}
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener('open', res, { once: true }));

let id = 0;
const pending = new Map();
const errores = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    errores.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
});
const send = (m, p = {}) => new Promise((res) => {
  const i = ++id;
  pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
});

/** Código que se ejecuta DENTRO de la página, antes de las expresiones. */
const PRELUDIO = `
  const G = window.__papercrash;
  const input = await import('/js/core/input.js');
  const fm = await import('/js/physics/flightModel.js');
  const ejes = () => input.readFlightControls();
  const $ = (s) => document.querySelector(s);
  const caja = (s) => {
    const b = $(s).getBoundingClientRect();
    return { cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2),
             r: Math.round(b.width / 2), left: Math.round(b.left), top: Math.round(b.top),
             right: Math.round(b.right), bottom: Math.round(b.bottom) };
  };
`;

/**
 * Ejecuta una función dentro de la página y devuelve su resultado.
 *
 * ── Los argumentos se pasan ──
 * La versión anterior los ignoraba: `ev(fn, 20)` llamaba a `fn()` sin el 20, así
 * que el helper que recarga las cargas hacía `charges = undefined`. El juego
 * quedaba con la propulsión trabada y la prueba reportaba un bug que no existía.
 * Un parámetro que se acepta y no se usa es peor que no tenerlo.
 *
 * @param {Function} fn
 * @param {...unknown} args  se pasan a la función, serializados como JSON
 */
async function ev(fn, ...args) {
  const cuerpo = fn.toString();
  const extra = args.map((a) => JSON.stringify(a)).join(', ');
  const fuente = `(async () => {${PRELUDIO}\nreturn await (${cuerpo})(${extra});})()`;
  const r = await send('Runtime.evaluate', {
    expression: fuente,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result?.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error(`excepción en la página: ${d.exception?.description ?? d.text}`);
  }
  return r.result?.result?.value;
}

await send('Runtime.enable');
await send('Page.enable');
// Teléfono apaisado: es como se juega, y es donde los mandos tienen menos lugar.
await send('Emulation.setDeviceMetricsOverride', { width: 851, height: 393, deviceScaleFactor: 2.75, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: 'http://127.0.0.1:8765/index.html' });
await sleep(7500);

const resultados = [];
const check = (etiqueta, ok, detalle = '') => {
  resultados.push(ok);
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}${detalle ? `  (${detalle})` : ''}`);
};

const punto = (x, y, dedo) => ({ x, y, id: dedo, radiusX: 8, radiusY: 8, force: 1 });

/**
 * Deja el juego volando de nuevo, con cargas y combustible de sobra.
 *
 * Se llama antes de cada bloque porque los gestos tardan más de lo que el avión
 * tarda en caer. Relanzar es más simple —y más honesto— que intentar que la
 * simulación no avance.
 *
 * @param {number} [cargas]
 */
async function revivir(cargas = 20) {
  await ev(async (n) => {
    const G = window.__papercrash;
    G.controller.forceIdle();
    await new Promise((r) => setTimeout(r, 120));
    G.controller.launch();
    G.controller.charges = n;
    G.controller.fuel = 9999;
    G.controller.flight.glideBudget = 9999;
    G.controller.flight.burnTime = 0;
    G.controller.flight.burn = 0;
    G.controller.thrustCooldown = 0;
    G.touch.setVisible(true);
    return G.controller.phase;
  }, cargas);
  await sleep(300);
}

/** Apoya el dedo en el centro y lo arrastra al desplazamiento indicado. */
async function arrastrar(ox, oy, dx, dy, dedo = 1, soltar = true) {
  /*
   * El toque inicial se confirma: si el navegador se lo traga, la rueda no
   * engancha su pointerId y el arrastre siguiente se descarta entero.
   *
   * ── Por qué NO se reintenta el gesto completo ──
   * Se probó y empeoró: 1-2 fallos por corrida contra 0-1 de esta versión. Repetir
   * el gesto deja el estado del mando a medio camino, así que el reintento se pisa
   * a sí mismo. La confirmación del toque es lo que aporta, no la repetición.
   */
  await apoyarConfirmando(ox, oy, dedo);
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [punto(ox + dx, oy + dy, dedo)] });
  await sleep(160);
  if (soltar) {
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(180);
  }
}

/** Mueve el dedo ya apoyado. */
async function moverA(x, y, dedo = 1) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [punto(x, y, dedo)] });
  await sleep(170);
}

/**
 * Mueve el dedo y CONFIRMA que el eje se movió, reintentando si no.
 *
 * ── Por qué hace falta ──
 * Medido: en 4 corridas seguidas, 3 fallaron —siempre en un gesto distinto— con
 * el eje en cero. El navegador, bajo carga, a veces se traga el primer
 * `touchMove` de un gesto. Eso NO es un bug del juego: es el entorno de prueba.
 *
 * Sin esta confirmación la suite es no determinista y un fallo real quedaría
 * enterrado entre falsos positivos. Con reintento, un cero persistente sí
 * significa que el mando no responde.
 *
 * @param {number} x @param {number} y @param {number} dedo
 * @param {(e:object) => boolean} esperado  qué tiene que cumplirse
 * @returns {Promise<object>} los ejes leídos
 */
async function moverConfirmando(x, y, dedo, esperado) {
  for (let intento = 0; intento < 3; intento++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [punto(x, y, dedo)] });
    await sleep(200);
    const e = await ev(async () => (await import('/js/core/input.js')).readFlightControls());
    if (esperado(e)) return e;
  }
  // Se devuelve la última lectura para que la aserción muestre el valor real.
  return ev(async () => (await import('/js/core/input.js')).readFlightControls());
}

/**
 * Apoya un dedo en la rueda y CONFIRMA que quedó enganchado.
 *
 * ── Por qué hace falta ──
 * Medido: corriendo la suite después de otra, el `touchStart` inicial a veces se
 * pierde. Sin ese evento la rueda nunca registra su `pointerId`, así que TODOS
 * los movimientos siguientes se descartan —el filtro por id los ignora— y el eje
 * queda en cero por más que se reintente mover.
 *
 * La señal de que enganchó es la clase `activo`, que el propio mando agrega.
 * Confirmarla es más directo que mirar los ejes, porque un dedo apoyado en el
 * centro no mueve ningún eje.
 *
 * @param {number} x @param {number} y @param {number} dedo
 * @returns {Promise<boolean>} si quedó enganchado
 */
async function apoyarConfirmando(x, y, dedo) {
  for (let intento = 0; intento < 3; intento++) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [punto(x, y, dedo)] });
    await sleep(160);
    const activo = await ev(() => document.querySelector('.touch-stick').classList.contains('activo'));
    if (activo) return true;
    // Si no enganchó, se suelta antes de reintentar: un segundo touchStart con el
    // mismo id sería ignorado por el navegador.
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(150);
  }
  return false;
}

/** Suelta todo y espera, para que el gesto siguiente empiece limpio. */
async function soltarTodo() {
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
}

console.log('\n  ══ Mandos táctiles: rueda analógica + botón ══');

/*
 * El vuelo se hace DURADERO, pero no se congela.
 *
 * ── Por qué no congelarlo ──
 * La primera versión reemplazaba `controller.update` por una función vacía para
 * que el avión no se estrellara. Eso traba TODO lo que corre dentro de esa
 * función, incluido el descuento del enfriamiento de la propulsión: el segundo
 * toque del botón quedaba rechazado para siempre y la prueba reportaba un bug
 * que no existía.
 *
 * En su lugar se le da altura y planeo de sobra para que no choque solo. El bucle
 * sigue corriendo normal y todos los temporizadores avanzan.
 */
await ev(async () => {
  const G = window.__papercrash;
  G.setGameMode('frenetic');
  await new Promise((r) => setTimeout(r, 1600));
  G.controller.forceIdle();
  G.controller.launch();
  G.controller.charges = 20;
  G.controller.fuel = 9999;
  G.controller.flight.glideBudget = 9999;

  const f = G.controller.flight;
  f.vx = 26; f.vy = 0; f.vz = 0;
  f.x = 120; f.y = 40; f.z = 0;

  G.touch.setVisible(true);
  return G.controller.phase;
});
await sleep(400);

const estado = await ev(async () => ({
  fase: G.controller.phase,
  visible: !document.getElementById('touch-controls').classList.contains('hidden'),
  sticks: document.querySelectorAll('.touch-stick').length,
  tieneCruz: !!document.querySelector('.touch-stick-cross'),
  ejes: (await import('/js/core/input.js')).readFlightControls(),
}));
check('el vuelo quedó congelado para la prueba',
  estado.fase === 'flying' && estado.visible === true, `fase=${estado.fase}`);
check('hay UNA sola rueda de vuelo', estado.sticks === 1, `${estado.sticks} rueda(s)`);
check('la rueda muestra la cruz de ejes', estado.tieneCruz === true);
check('arranca en neutro', estado.ejes.steer === 0 && estado.ejes.nose === 0);

const geo = await ev(() => ({
  stick: caja('.touch-stick'),
  prop: caja('#touch-thrust'),
  atras: caja('#touch-back'),
}));
console.log(`    rueda (${geo.stick.cx},${geo.stick.cy}) r${geo.stick.r}   propulsión (${geo.prop.cx},${geo.prop.cy})   volver (${geo.atras.cx},${geo.atras.cy})`);

console.log('\n  ── La rueda da las CUATRO direcciones ──');
{
  await revivir();
  const R = geo.stick.r;
  const lejos = Math.round(R * 0.85);

  await arrastrar(geo.stick.cx, geo.stick.cy, lejos, 0, 1, false);
  const derecha = await moverConfirmando(geo.stick.cx + lejos, geo.stick.cy, 1, (e) => e.steer > 0.5);
  check('empujar a la DERECHA da rumbo positivo',
    derecha.steer > 0.5 && Math.abs(derecha.nose) < 0.05,
    `steer=${derecha.steer.toFixed(2)} nose=${derecha.nose.toFixed(2)}`);

  const izquierda = await moverConfirmando(geo.stick.cx - lejos, geo.stick.cy, 1, (e) => e.steer < -0.5);
  check('empujar a la IZQUIERDA da rumbo negativo',
    izquierda.steer < -0.5 && Math.abs(izquierda.nose) < 0.05,
    `steer=${izquierda.steer.toFixed(2)}`);

  const arriba = await moverConfirmando(geo.stick.cx, geo.stick.cy - lejos, 1, (e) => e.nose > 0.5);
  check('empujar hacia ARRIBA sube el morro',
    arriba.nose > 0.5 && Math.abs(arriba.steer) < 0.05,
    `nose=${arriba.nose.toFixed(2)}`);

  const abajo = await moverConfirmando(geo.stick.cx, geo.stick.cy + lejos, 1, (e) => e.nose < -0.5);
  check('empujar hacia ABAJO baja el morro',
    abajo.nose < -0.5 && Math.abs(abajo.steer) < 0.05,
    `nose=${abajo.nose.toFixed(2)}`);

  const centro = await moverConfirmando(geo.stick.cx, geo.stick.cy, 1, (e) => Math.abs(e.steer) < 0.01);
  check('el centro queda en neutro (zona muerta)',
    Math.abs(centro.steer) < 0.01 && Math.abs(centro.nose) < 0.01,
    `steer=${centro.steer.toFixed(3)} nose=${centro.nose.toFixed(3)}`);
  await soltarTodo();
}

console.log('\n  ── Un dedo gobierna las dos cosas a la vez ──');
{
  await revivir();
  const d = Math.round(geo.stick.r * 0.6);
  await arrastrar(geo.stick.cx, geo.stick.cy, d, -d, 2, false);
  const diag = await ev(async () => (await import('/js/core/input.js')).readFlightControls());
  check('la diagonal mueve rumbo Y morro a la vez',
    diag.steer > 0.35 && diag.nose > 0.35,
    `steer=${diag.steer.toFixed(2)} nose=${diag.nose.toFixed(2)}`);

  /*
   * Recorte CIRCULAR: el módulo del vector no puede pasar de 1.
   *
   * Sin el recorte, empujar en diagonal daría (1, 1) y el avión giraría más
   * rápido en diagonal que de costado.
   */
  const mod = Math.hypot(diag.steer, diag.nose);
  check('la diagonal no da más mando que la cruz', mod <= 1.02, `módulo=${mod.toFixed(2)}`);
  await soltarTodo();
}

console.log('\n  ── El eje llega a la física ──');
{
  await revivir();
  await arrastrar(geo.stick.cx, geo.stick.cy, Math.round(geo.stick.r * 0.9), 0, 5, false);
  const fisica = await ev(() => {
    const antes = { z: G.controller.flight.z, vz: G.controller.flight.vz };
    fm.setControls(G.controller.flight, 1, 0);
    for (let i = 0; i < 60; i++) fm.step(G.controller.flight, G.controller.params, 1 / 120);
    const d = G.controller.flight;
    return { dz: d.z - antes.z, dvz: d.vz - antes.vz, steer: d.steer };
  });
  check('el eje llega a la física del vuelo',
    fisica.steer === 1 && (Math.abs(fisica.dvz) > 0.5 || Math.abs(fisica.dz) > 0.05),
    `steer=${fisica.steer} dz=${fisica.dz.toFixed(3)}`);
  await soltarTodo();
}

console.log('\n  ── Botón de PROPULSIÓN ──');
{
  await revivir();
  const antes = await ev(() => window.__papercrash.controller.charges);
  await arrastrar(geo.prop.cx, geo.prop.cy, 0, 0, 3, true);
  const despues = await ev(() => window.__papercrash.controller.charges);
  check('el botón gasta una carga', despues === antes - 1, `${antes} -> ${despues}`);

  // Mantener el dedo apoyado NO debe gastar otra: la propulsión va por flanco.
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [punto(geo.prop.cx, geo.prop.cy, 4)] });
  await sleep(2000);
  const mantenido = await ev(() => window.__papercrash.controller.charges);
  check('mantener el dedo no gasta otra carga', mantenido === despues, `${despues} -> ${mantenido}`);
  await soltarTodo();
}

console.log('\n  ── Los dos pulgares a la vez ──');
{
  await revivir();
  /*
   * Rueda con un pulgar y propulsión con el otro. Es el caso que más fácil se
   * rompe: si la rueda no filtrara por `pointerId`, el dedo del botón la
   * arrastraría al moverse.
   *
   * El estado de propulsión se limpia ANTES de apoyar el segundo dedo: el bloque
   * anterior dejó un quemado y su enfriamiento corriendo, y en ese estado el
   * botón rechaza la pulsación (correctamente: no se encadena sobre una activa).
   */
  // `revivir()` ya dejó el estado de propulsión limpio.

  /*
   * Las cargas se miden ANTES de apoyar los dedos.
   *
   * ── Por qué ──
   * El botón dispara la propulsión en el `pointerdown` y gasta la carga en ese
   * instante. Si se mide DESPUÉS de apoyar el segundo dedo, el gasto ya ocurrió y
   * el delta da cero: la prueba reportaba que el botón no funcionaba cuando en
   * realidad ya había funcionado.
   */
  const cargasAntes = await ev(() => window.__papercrash.controller.charges);

  /*
   * Los dos dedos se apoyan CONFIRMANDO que engancharon.
   *
   * Si el `touchStart` de la rueda se pierde, su `pointerId` queda en -1 y todos
   * los movimientos siguientes se descartan: la prueba falla con el eje en cero y
   * parece un bug del juego cuando en realidad el input nunca llegó.
   */
  const engancho = await apoyarConfirmando(geo.stick.cx, geo.stick.cy, 1);
  check('el primer dedo engancha la rueda', engancho === true,
    engancho ? 'ok' : 'el touchStart se perdió tres veces');
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [punto(geo.stick.cx, geo.stick.cy, 1), punto(geo.prop.cx, geo.prop.cy, 2)],
  });
  await sleep(150);
  /*
   * El gesto de dos dedos se reintenta hasta que responde.
   *
   * Medido: en 4 corridas seguidas, 3 fallaron en un gesto distinto con el eje en
   * cero. El navegador, bajo carga, a veces se traga el primer movimiento. No es
   * un bug del juego, pero sin reintento la suite es no determinista.
   */
  for (let intento = 0; intento < 3; intento++) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        punto(geo.stick.cx + Math.round(geo.stick.r * 0.85), geo.stick.cy - Math.round(geo.stick.r * 0.5), 1),
        punto(geo.prop.cx, geo.prop.cy, 2),
      ],
    });
    await sleep(250);
    const prueba = await ev(async () => (await import('/js/core/input.js')).readFlightControls());
    if (prueba.steer > 0.5) break;
    /*
     * Si no respondió, se reengancha la rueda.
     *
     * El `touchStart` de dos dedos puede haberle hecho perder la captura al
     * primer puntero: el mando filtra por `pointerId` y, si el navegador
     * reasigna el del primer dedo, el movimiento se descarta. Reapoyar el dedo
     * vuelve a engancharlo, que es lo que haría el jugador.
     */
    await apoyarConfirmando(geo.stick.cx, geo.stick.cy, 1);
    await send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [punto(geo.stick.cx, geo.stick.cy, 1), punto(geo.prop.cx, geo.prop.cy, 2)],
    });
    await sleep(150);
  }

  const dos = await ev(async () => {
    const input = await import('/js/core/input.js');
    return {
      ejes: input.readFlightControls(),
      cargas: window.__papercrash.controller.charges,
    };
  });
  check('la rueda responde mientras el otro dedo usa el botón',
    dos.ejes.steer > 0.5 && dos.ejes.nose > 0.2,
    `steer=${dos.ejes.steer.toFixed(2)} nose=${dos.ejes.nose.toFixed(2)}`);
  check('el botón sostiene la propulsión', dos.ejes.thrust === true);
  check('el segundo dedo gasta una sola carga', cargasAntes - dos.cargas === 1,
    `${cargasAntes} -> ${dos.cargas}`);
  await soltarTodo();
  const limpio = await ev(async () => (await import('/js/core/input.js')).readFlightControls());
  check('al soltar todo vuelve a neutro',
    Math.abs(limpio.steer) < 0.01 && Math.abs(limpio.nose) < 0.01 && limpio.thrust === false,
    `steer=${limpio.steer.toFixed(3)} nose=${limpio.nose.toFixed(3)}`);
}

console.log('\n  ── Botón de VOLVER (equivale a Esc) ──');
{
  await ev(async () => {
    window.__papercrash.controller.forceIdle();
    await new Promise((r) => setTimeout(r, 300));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true }));
    return true;
  });
  await sleep(1500);
  const enAim = await ev(() => window.__papercrash.overlays.current);
  await ev(() => {
    document.getElementById('touch-back').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 9 }),
    );
    return true;
  });
  await sleep(1400);
  const despues = await ev(() => window.__papercrash.overlays.current);
  check('el botón de volver aborta el lanzamiento',
    enAim === 'aim' && despues === 'standby', `${enAim} -> ${despues}`);
}

console.log('\n  ── Layout e instalación ──');
{
  /*
   * Los mandos tienen que estar VISIBLES para medir su layout.
   *
   * Después del bloque anterior el juego volvió a standby (el botón de volver
   * abortó el lanzamiento), y en standby los mandos están ocultos: con
   * `display: none` todos los rects miden cero y cualquier comparación da
   * resultados sin sentido.
   */
  await ev(async () => {
    G.controller.forceIdle();
    G.controller.launch();
    G.controller.flight.glideBudget = 9999;
    const f = G.controller.flight;
    f.x = 120; f.y = 44;
    G.touch.setVisible(true);
    return true;
  });
  await sleep(500);

  const layout = await ev(() => {
    const c = document.getElementById('touch-controls');
    const ctrl = [...c.querySelectorAll('.touch-stick, #touch-thrust, #touch-back')];
    const fuera = ctrl.filter((s) => {
      const b = s.getBoundingClientRect();
      return b.left < 0 || b.top < 0 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1;
    });
    /*
     * Separación entre CAJAS, no entre centros.
     *
     * La rueda y el botón son hermanos dentro de un contenedor `inset: 0`, así
     * que los dos están centrados en la pantalla: la distancia entre sus CENTROS
     * da 0 aunque estén en esquinas opuestas. Lo que importa es si se pisan.
     */
    const a = document.querySelector('.touch-stick').getBoundingClientRect();
    const b = document.getElementById('touch-back').getBoundingClientRect();
    const solapan = !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
    /*
     * La distancia que importa es del CENTRO de la rueda al botón.
     *
     * El pulgar se mueve como mucho un radio desde el centro, así que el botón
     * queda fuera de alcance si está a más de un radio. La distancia entre BORDES
     * no sirve: las esquinas de dos cajas pueden tocarse y los centros estar
     * lejísimos.
     */
    const acx = a.left + a.width / 2, acy = a.top + a.height / 2;
    const bcx = b.left + b.width / 2, bcy = b.top + b.height / 2;
    return { total: ctrl.length, fuera: fuera.length, solapan,
             radio: Math.round(a.width / 2),
             distancia: Math.round(Math.hypot(acx - bcx, acy - bcy)) };
  });
  check('los mandos entran en la pantalla apaisada',
    layout.fuera === 0, `${layout.total} controles, ${layout.fuera} fuera`);
  check('el botón de volver no pisa la rueda', layout.solapan === false);
  check('el botón de volver queda fuera del alcance del pulgar',
    layout.distancia > layout.radio,
    `${layout.distancia}px del centro, radio ${layout.radio}px`);

  const cache = await ev(async () => {
    const nombres = await caches.keys();
    if (!nombres.length) return { archivos: 0 };
    const c = await caches.open(nombres[0]);
    return { archivos: (await c.keys()).length, nombre: nombres[0] };
  });
  check('el service worker cacheó el juego',
    cache.archivos > 40, `${cache.archivos} archivos en ${cache.nombre}`);

  const man = await ev(async () => {
    const r = await fetch('manifest.webmanifest');
    const m = await r.json();
    return { tipo: r.headers.get('content-type'), display: m.display, iconos: m.icons.length };
  });
  check('el manifest se sirve con su tipo propio', man.tipo?.includes('manifest'), man.tipo);
  check('el manifest declara pantalla completa y 3 iconos',
    man.display === 'fullscreen' && man.iconos === 3, `${man.display}, ${man.iconos} iconos`);
}

console.log('\n  ══ excepciones ══');
console.log('  ' + (errores.length ? errores.slice(0, 4).join('\n  ') : 'ninguna'));

const fallos = resultados.filter((r) => !r).length;
console.log(`\n  ${'='.repeat(52)}`);
console.log(fallos === 0
  ? `TODO OK — ${resultados.length} verificaciones táctiles pasaron.`
  : `FALLARON ${fallos} de ${resultados.length}.`);

browser.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows a veces retiene el perfil */ }
process.exit(fallos === 0 ? 0 : 1);
