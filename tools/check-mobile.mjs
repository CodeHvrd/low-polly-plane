/**
 * Comprobación de visualización móvil con emulación REAL de dispositivo.
 *
 * Usa la emulación de Chrome (viewport de teléfono + touch habilitado) para
 * medir el layout como lo vería un móvil, sin depender de suponer.
 *
 * Uso: node tools/check-mobile.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9470;
const URL = 'http://127.0.0.1:8765/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Teléfonos a probar: uno chico, uno común y uno grande. */
const DISPOSITIVOS = [
  { nombre: 'Pixel 5 (retrato) ', w: 393, h: 851, dpr: 2.75, movil: true },
  { nombre: 'iPhone SE (retrato)', w: 375, h: 667, dpr: 2, movil: true },
  { nombre: 'Pixel 5 (apaisado)', w: 851, h: 393, dpr: 2.75, movil: true },
  { nombre: 'Escritorio 1280   ', w: 1280, h: 800, dpr: 1, movil: false },
];

const profile = mkdtempSync(join(tmpdir(), 'pc-mob-'));
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--use-gl=angle', '--use-angle=swiftshader',
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
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description };
  return r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');

const informe = [];

for (const d of DISPOSITIVOS) {
  console.log(`\n  ══ ${d.nombre}  ${d.w}x${d.h} @${d.dpr}x ══`);

  // Emulación de dispositivo: viewport, touch y DPR.
  await send('Emulation.setDeviceMetricsOverride', {
    width: d.w, height: d.h, deviceScaleFactor: d.dpr, mobile: d.movil,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: d.movil, maxTouchPoints: 5 });
  if (d.movil) {
    await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  }

  await send('Page.navigate', { url: URL });
  await sleep(6500);

  const m = await ev(`
    const G = window.__papercrash;
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null;
      const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };

    // ¿Algo se sale de la pantalla?
    const desbordes = [];
    for (const sel of ['#mode-bar','#idle-title-block','#idle-hint-block','#shop-dock','#game-title','#global-coins']) {
      const b = r(sel);
      if (!b) continue;
      if (b.x < 0 || b.y < 0 || b.x + b.w > innerWidth + 1 || b.y + b.h > innerHeight + 1) {
        desbordes.push(sel + ' ' + JSON.stringify(b));
      }
    }

    const cv = document.getElementById('gameCanvas');
    const cb = cv ? cv.getBoundingClientRect() : null;
    return {
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      canvas: cb ? { w: Math.round(cb.width), h: Math.round(cb.height) } : null,
      canvasBuffer: cv ? [cv.width, cv.height] : null,
      ui: { modo: r('#mode-bar'), titulo: r('#game-title'), pista: r('#idle-hint-block'), tienda: r('#shop-dock') },
      desbordes,
      // ¿La pista de controles menciona el teclado?
      textoPista: document.getElementById('idle-hint-controls')?.textContent?.trim() ?? '',
      erroresArranque: 0,
    };`);

  console.log(`    viewport ${m.viewport.join('x')}  dpr ${m.dpr}  scroll ${m.scroll.join('x')}`);
  console.log(`    canvas CSS ${m.canvas?.w}x${m.canvas?.h}  buffer ${m.canvasBuffer?.join('x')}`);
  for (const [k, v] of Object.entries(m.ui)) {
    if (v) console.log(`      ${k.padEnd(8)} x${String(v.x).padStart(4)} y${String(v.y).padStart(4)}  ${v.w}x${v.h}`);
  }
  if (m.desbordes.length) {
    console.log('    ⚠ SE SALE DE PANTALLA:');
    for (const s of m.desbordes) console.log('      ' + s);
  } else {
    console.log('    ✓ nada se sale de la pantalla');
  }
  if (m.textoPista) console.log(`    instrucciones dicen: "${m.textoPista.replace(/\s+/g, ' ').slice(0, 90)}"`);

  informe.push({ dispositivo: d.nombre.trim(), viewport: m.viewport.join('x'), desbordes: m.desbordes.length, canvas: `${m.canvas?.w}x${m.canvas?.h}` });
}

console.log('\n  ══ excepciones en toda la corrida ══');
console.log('  ' + (errores.length ? errores.slice(0, 5).join('\n  ') : 'ninguna'));

writeFileSync('tools/_informe-movil.json', JSON.stringify(informe, null, 2), 'utf8');
browser.kill();
await sleep(300);
rmSync(profile, { recursive: true, force: true });
process.exit(0);
