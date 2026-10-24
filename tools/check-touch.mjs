/**
 * PAPERCRASH — tools/check-touch.mjs
 * ============================================================
 * Verifica los CONTROLES TÁCTILES (D-pad de cuatro flechas).
 *
 * ── Qué comprueba ──
 * Que cada flecha entregue autoridad plena, que se puedan mantener dos a la vez
 * (diagonal), que al soltar todo vuelva a cero y que la rueda vieja ya no exista.
 *
 * ── Por qué existe ──
 * Los botones ▲▼ de la versión 10 se agregaron sin una prueba que leyera los ejes,
 * y estuvieron meses sin funcionar por una excepción en `setPointerCapture`. Una
 * prueba que aprieta el botón y lee `readFlightControls()` lo habría detectado en
 * el acto.
 *
 * Uso: node tools/check-touch.mjs   (requiere node tools/serve.mjs 8765)
 * ============================================================
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.env.PAPERCRASH_URL ?? 'http://127.0.0.1:8765';
const PORT = 9720;

let ok = 0;
let fail = 0;
const fallos = [];

/** Anota una verificación. */
function check(nombre, condicion, detalle = '') {
  if (condicion) {
    ok += 1;
    console.log(`  ✓ ${nombre}${detalle ? `  (${detalle})` : ''}`);
  } else {
    fail += 1;
    fallos.push(nombre);
    console.log(`  ✗ ${nombre}${detalle ? `  (${detalle})` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Navegador ── */
const perfil = mkdtempSync(join(tmpdir(), 'pc-touch-'));
const chrome = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${perfil}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (r.ok) break;
  } catch {
    /* todavía arrancando */
  }
  await sleep(250);
}

const pestana = await (
  await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
).json();
const ws = new WebSocket(pestana.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener('open', res, { once: true }));

let idSeq = 0;
const pendientes = new Map();
const errores = [];

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pendientes.has(m.id)) {
    pendientes.get(m.id)(m);
    pendientes.delete(m.id);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errores.push((d.exception?.description ?? d.text ?? '').split('\n')[0]);
  }
});

const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++idSeq;
    pendientes.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });

/** Evalúa una función dentro de la página. */
async function ev(fn, ...args) {
  const cuerpo = fn.toString();
  const extra = args.map((a) => JSON.stringify(a)).join(', ');
  const fuente = `(async () => { return await (${cuerpo})(${extra}); })()`;
  const r = await send('Runtime.evaluate', {
    expression: fuente,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result?.exceptionDetails) {
    throw new Error(`excepción en la página: ${r.result.exceptionDetails.exception?.description}`);
  }
  return r.result?.result?.value;
}

await send('Runtime.enable');
await send('Page.enable');
// Teléfono vertical, emulado.
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `${URL_BASE}/index.html` });
await sleep(8000);

console.log('\n  ── Montaje del D-pad ──');
{
  const m = await ev(async () => {
    const dpad = document.querySelector('.touch-dpad');
    const ids = ['touch-left', 'touch-up', 'touch-down', 'touch-right'];
    return {
      dpad: Boolean(dpad),
      hijos: dpad ? dpad.querySelectorAll('.touch-dir').length : 0,
      flechas: ids.filter((i) => document.getElementById(i)).length,
      ruedaVieja: Boolean(document.querySelector('.touch-stick')),
      noseViejos: Boolean(document.getElementById('touch-nose-up')),
      boost: Boolean(document.getElementById('touch-thrust')),
      volver: Boolean(document.getElementById('touch-back')),
      arranco: typeof window.__papercrash === 'object',
    };
  });
  check('el juego arrancó', m.arranco);
  check('el D-pad existe', m.dpad);
  /*
   * El D-pad ya no es una rejilla: son cuatro piezas posicionadas en absoluto que
   * se tocan entre sí, separadas sólo por la X del centro.
   *
   * El tamaño se mide DESPUÉS de mostrar los mandos: ocultos el contenedor mide 0
   * y la comprobación fallaría sin que exista ningún problema.
   */
  check('el D-pad tiene las cuatro piezas', m.hijos === 4, m.hijos + ' piezas');
  check('tiene las CUATRO flechas', m.flechas === 4, `${m.flechas}/4`);
  check('la rueda analógica ya no está', m.ruedaVieja === false);
  check('los botones de morro viejos ya no están', m.noseViejos === false);
  check('el botón de propulsión sigue', m.boost);
  check('el botón de volver sigue', m.volver);
}

/**
 * Deja el avión VOLANDO y con planeo de sobra.
 *
 * ── Por qué hace falta ──
 * Los ejes táctiles sólo se leen durante el vuelo. Si el avión se estrella entre
 * bloques, los mandos se ocultan, los ejes vuelven a cero y las pruebas fallarían
 * sin que exista ningún bug.
 */
async function volverAlVuelo() {
  await ev(async () => {
    const G = window.__papercrash;
    G.controller.forceIdle();
    G.controller.launch();
    await new Promise((r) => setTimeout(r, 250));
    // Planeo de sobra y altura: que no se estrelle durante la prueba.
    G.controller.flight.glideBudget = 9999;
    G.controller.flight.y = Math.max(G.controller.flight.y, 24);
    G.touch.setVisible(true);
    await new Promise((r) => setTimeout(r, 120));
    return true;
  });
}

await volverAlVuelo();
{
  // Con los mandos a la vista se puede medir el tamaño real.
  const tam = await ev(async () => {
    const d = document.querySelector('.touch-dpad');
    const u = document.getElementById('touch-up');
    const boost = document.getElementById('touch-thrust');
    const rd = d.getBoundingClientRect();
    const ru = u.getBoundingClientRect();
    const rb = boost.getBoundingClientRect();
    return { pad: Math.round(rd.width), flecha: Math.round(ru.width), solapa: rd.right > rb.left };
  });
  check('el D-pad es grande y usable', tam.pad >= 150, tam.pad + ' px');
  check('cada flecha es cómoda de tocar', tam.flecha >= 55, tam.flecha + ' px');
  check('el D-pad no pisa el boost', tam.solapa === false);
}

/* Lanzar para que los ejes táctiles se lean (antes de volar no se pilota). */
await volverAlVuelo();

/**
 * Aprieta una o más flechas, lee los ejes y suelta.
 *
 * @param {string[]} ids @param {number} pointerId
 */
async function apretar(ids, pointerId = 61) {
  return ev(
    async (params) => {
      const input = await import('/js/core/input.js');
      input.releaseTouchAxes();
      const centro = (id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      for (const b of params.ids) {
        const c = centro(b);
        document.getElementById(b).dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            clientX: c.x,
            clientY: c.y,
            pointerId: params.pointerId,
            pointerType: 'touch',
          }),
        );
      }
      await new Promise((r) => setTimeout(r, 90));
      const ejes = input.readFlightControls();
      const activas = params.ids.filter((b) =>
        document.getElementById(b).classList.contains('activo'),
      ).length;
      for (const b of params.ids) {
        const c = centro(b);
        document.getElementById(b).dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            clientX: c.x,
            clientY: c.y,
            pointerId: params.pointerId,
            pointerType: 'touch',
          }),
        );
      }
      await new Promise((r) => setTimeout(r, 90));
      const trasSoltar = input.readFlightControls();
      return { ejes, trasSoltar, activas };
    },
    { ids, pointerId },
  );
}

console.log('\n  ── Cada flecha da autoridad PLENA ──');
{
  const der = await apretar(['touch-right']);
  check('▶ da rumbo +1 exacto', der.ejes.steer === 1, `steer=${der.ejes.steer}`);
  check('▶ no toca el morro', der.ejes.nose === 0, `nose=${der.ejes.nose}`);
  check('▶ se marca como apretada', der.activas === 1);

  const izq = await apretar(['touch-left']);
  check('◀ da rumbo -1 exacto', izq.ejes.steer === -1, `steer=${izq.ejes.steer}`);

  const arr = await apretar(['touch-up']);
  check('▲ da morro +1 exacto', arr.ejes.nose === 1, `nose=${arr.ejes.nose}`);
  check('▲ no toca el rumbo', arr.ejes.steer === 0, `steer=${arr.ejes.steer}`);

  const aba = await apretar(['touch-down']);
  check('▼ da morro -1 exacto', aba.ejes.nose === -1, `nose=${aba.ejes.nose}`);
}

console.log('\n  ── Al soltar, todo vuelve a cero ──');
{
  const r = await apretar(['touch-up', 'touch-right']);
  check('soltar limpia el rumbo', r.trasSoltar.steer === 0, `steer=${r.trasSoltar.steer}`);
  check('soltar limpia el morro', r.trasSoltar.nose === 0, `nose=${r.trasSoltar.nose}`);
}

console.log('\n  ── DESLIZAR el pulgar entre flechas ──');
await volverAlVuelo();
{
  /*
   * ── El pedido concreto ──
   * "No me bloquee sobre esa flecha: si arrastro hacia la de la derecha, que
   * reconozca que el dedo ya está en esa flecha y me haga doblar."
   *
   * Sin levantar el dedo: se apoya en ◀, se DESLIZA hasta ▶ y se comprueba que el
   * rumbo pasa de -1 a +1 en el mismo gesto. Es lo que hace que el D-pad se sienta
   * como un analógico de cuatro posiciones en vez de cuatro botones sueltos.
   */
  const r = await ev(async () => {
    const input = await import('/js/core/input.js');
    input.releaseTouchAxes();
    const centro = (id) => {
      const b = document.getElementById(id).getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    };
    const raiz = document.querySelector('.touch-dpad');
    const ci = centro('touch-left');
    const cd = centro('touch-right');
    const ca = centro('touch-up');

    const mover = (x, y) => {
      const dest = document.elementFromPoint(x, y) ?? raiz;
      dest.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: x,
          clientY: y,
          pointerId: 101,
          pointerType: 'touch',
        }),
      );
    };

    // 1. Apoyar el dedo en ◀
    document.getElementById('touch-left').dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: ci.x,
        clientY: ci.y,
        pointerId: 101,
        pointerType: 'touch',
      }),
    );
    await new Promise((r) => setTimeout(r, 100));
    const enIzquierda = input.readFlightControls();

    // 2. DESLIZAR el mismo dedo hasta ▶, SIN levantarlo
    mover(cd.x, cd.y);
    await new Promise((r) => setTimeout(r, 120));
    const trasDeslizar = input.readFlightControls();

    // 3. Y seguir hasta ▲
    mover(ca.x, ca.y);
    await new Promise((r) => setTimeout(r, 120));
    const trasSubir = input.readFlightControls();

    // 4. Levantar
    document.getElementById('touch-up').dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        clientX: ca.x,
        clientY: ca.y,
        pointerId: 101,
        pointerType: 'touch',
      }),
    );
    await new Promise((r) => setTimeout(r, 120));
    const trasSoltar = input.readFlightControls();
    return { enIzquierda, trasDeslizar, trasSubir, trasSoltar };
  });
  check('el dedo apoya en ◀ y gira a la izquierda', r.enIzquierda.steer === -1, `steer=${r.enIzquierda.steer}`);
  check(
    'DESLIZAR a ▶ cambia el rumbo sin levantar el dedo',
    r.trasDeslizar.steer === 1 && r.trasDeslizar.nose === 0,
    `steer=${r.trasDeslizar.steer} nose=${r.trasDeslizar.nose}`,
  );
  check(
    'DESLIZAR a ▲ sube el morro',
    r.trasSubir.nose === 1 && r.trasSubir.steer === 0,
    `steer=${r.trasSubir.steer} nose=${r.trasSubir.nose}`,
  );
  check('levantar el dedo vuelve a cero', r.trasSoltar.steer === 0 && r.trasSoltar.nose === 0,
    `steer=${r.trasSoltar.steer} nose=${r.trasSoltar.nose}`);
}

console.log('\n  ── Dos dedos: diagonal ──');
await volverAlVuelo();
{
  /*
   * Se aprietan ▲ y ▶ con punteros DISTINTOS. Es el caso real: un pulgar mantiene
   * el rumbo y el otro sube el morro. Sin poder combinarlas, el D-pad no serviría
   * para planear mientras se esquiva.
   */
  const diag = await ev(async () => {
    const input = await import('/js/core/input.js');
    input.releaseTouchAxes();
    const centro = (id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const a = document.getElementById('touch-up');
    const b = document.getElementById('touch-right');
    const ca = centro('touch-up');
    const cb = centro('touch-right');
    a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: ca.x, clientY: ca.y, pointerId: 71, pointerType: 'touch' }));
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cb.x, clientY: cb.y, pointerId: 72, pointerType: 'touch' }));
    await new Promise((r) => setTimeout(r, 120));
    const ejes = input.readFlightControls();
    const dosActivas = a.classList.contains('activo') && b.classList.contains('activo');
    // Se suelta SOLO una: la otra debe seguir mandando.
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cb.x, clientY: cb.y, pointerId: 72, pointerType: 'touch' }));
    await new Promise((r) => setTimeout(r, 120));
    const soloMorro = input.readFlightControls();
    // Se lee también el estado interno: es más estable que los ejes, que vuelven a
    // cero si el vuelo termina durante la espera.
    const estado = { ...window.__papercrash.touch.dir };
    return { ejes, dosActivas, soloMorro, estado };
  });
  check(
    '▲+▶ combina morro y rumbo',
    diag.ejes.nose === 1 && diag.ejes.steer === 1,
    `steer=${diag.ejes.steer} nose=${diag.ejes.nose}`,
  );
  check('las dos flechas quedan marcadas', diag.dosActivas);
  check(
    'soltar una deja la otra activa',
    diag.estado.up === true && diag.estado.right === false,
    `up=${diag.estado.up} right=${diag.estado.right}`,
  );
  await ev(async () => {
    const input = await import('/js/core/input.js');
    for (const b of ['touch-up', 'touch-left', 'touch-right', 'touch-down']) {
      document.getElementById(b).dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: 71, pointerType: 'touch' }),
      );
    }
    input.releaseTouchAxes();
    await new Promise((r) => setTimeout(r, 80));
    return true;
  });
}

console.log('\n  ── El botón de propulsión sigue funcionando ──');
await volverAlVuelo();
{
  const r = await ev(async () => {
    const input = await import('/js/core/input.js');
    input.releaseTouchAxes();
    const b = document.getElementById('touch-thrust');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 81, pointerType: 'touch' }));
    await new Promise((r) => setTimeout(r, 90));
    const durante = input.readFlightControls();
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 81, pointerType: 'touch' }));
    await new Promise((r) => setTimeout(r, 90));
    return { durante, despues: input.readFlightControls() };
  });
  check('el boost sostiene la propulsión', r.durante.thrust === true, `thrust=${r.durante.thrust}`);
  check('soltar corta la propulsión', r.despues.thrust === false);
}

console.log('\n  ── Al ocultarse se sueltan las flechas ──');
await volverAlVuelo();
{
  /*
   * Un dedo apoyado al terminar el vuelo no debe arrastrar la dirección a la
   * partida siguiente. Se ocultan los mandos con una flecha apretada y se verifica
   * que los ejes vuelvan a cero.
   */
  const r = await ev(async () => {
    const input = await import('/js/core/input.js');
    const G = window.__papercrash;
    input.releaseTouchAxes();
    const b = document.getElementById('touch-right');
    const rc = b.getBoundingClientRect();
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rc.left + rc.width / 2, clientY: rc.top + rc.height / 2, pointerId: 91, pointerType: 'touch' }));
    await new Promise((r) => setTimeout(r, 90));
    const antes = input.readFlightControls();
    G.touch.setVisible(false);
    await new Promise((r) => setTimeout(r, 120));
    const despues = input.readFlightControls();
    const marcada = b.classList.contains('activo');
    return { antes, despues, marcada };
  });
  check('la flecha estaba apretada antes', r.antes.steer === 1, `steer=${r.antes.steer}`);
  check('ocultar los mandos suelta el eje', r.despues.steer === 0, `steer=${r.despues.steer}`);
  check('ocultar los mandos quita el resaltado', r.marcada === false);
}


console.log('\n  ── Boost + flecha a la vez (dos dedos) ──');
await volverAlVuelo();
{
  /*
   * ── El bug que esto previene ──
   * El botón de boost enviaba `setTouchAxes({ thrust: true })`, un objeto PARCIAL.
   * Esa función pone en cero los ejes que no vienen, así que apretar boost borraba
   * el morro y el rumbo de las flechas apoyadas: ▲ + boost "no funcionaba".
   *
   * Se aprieta con dos punteros distintos y se exige que AMBOS ejes sobrevivan.
   */
  const r = await ev(async () => {
    const input = await import('/js/core/input.js');
    input.releaseTouchAxes();
    const centro = (id) => {
      const b = document.getElementById(id).getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    };
    const arr = document.getElementById('touch-up');
    const boost = document.getElementById('touch-thrust');
    const ca = centro('touch-up');
    const cb = centro('touch-thrust');

    // Dedo 1 en ▲, dedo 2 en el boost.
    arr.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: ca.x, clientY: ca.y, pointerId: 201, pointerType: 'touch' }));
    boost.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cb.x, clientY: cb.y, pointerId: 202, pointerType: 'touch' }));
    await new Promise((r) => setTimeout(r, 140));
    const ambos = input.readFlightControls();

    // Al soltar el boost, el morro debe seguir.
    boost.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cb.x, clientY: cb.y, pointerId: 202, pointerType: 'touch' }));
    await new Promise((r) => setTimeout(r, 140));
    const soloMorro = input.readFlightControls();

    arr.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: ca.x, clientY: ca.y, pointerId: 201, pointerType: 'touch' }));
    await new Promise((r) => setTimeout(r, 100));
    const limpio = input.readFlightControls();
    return { ambos, soloMorro, limpio };
  });
  check(
    'boost NO cancela la flecha ▲',
    r.ambos.nose === 1 && r.ambos.thrust === true,
    `nose=${r.ambos.nose} thrust=${r.ambos.thrust}`,
  );
  check(
    'soltar el boost deja el morro apretado',
    r.soloMorro.nose === 1 && r.soloMorro.thrust === false,
    `nose=${r.soloMorro.nose} thrust=${r.soloMorro.thrust}`,
  );
  check('al soltar todo queda en cero', r.limpio.nose === 0 && r.limpio.thrust === false);
}

console.log('\n  ── Sin excepciones ──');
check('no hubo errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));

/* ── Cierre ── */
chrome.kill();
await sleep(300);
try {
  rmSync(perfil, { recursive: true, force: true });
} catch {
  /* da igual */
}

console.log(`\n${'='.repeat(52)}`);
if (fail === 0) {
  console.log(`TODO OK — ${ok} verificaciones táctiles pasaron.`);
} else {
  console.log(`FALLARON ${fail} de ${ok + fail}:`);
  for (const f of fallos) console.log(`  · ${f}`);
}
console.log(`${'='.repeat(52)}\n`);
process.exit(fail === 0 ? 0 : 1);
