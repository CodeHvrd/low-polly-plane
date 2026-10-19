/**
 * Genera los iconos de la PWA.
 *
 * Se dibujan por código y se rasterizan con el canvas de Chrome, que ya se usa
 * para las pruebas. Evita depender de un editor de imágenes o de una librería
 * de gráficos: los iconos son formas simples (el avión de papel del juego) y se
 * pueden describir en unas pocas líneas.
 *
 * Uso: node tools/make-icons.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9471;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Tamaños a generar.
 *
 * `any` para el icono normal y `maskable` para Android, que recorta el icono en
 * forma de círculo o cuadrado redondeado: el maskable necesita margen, así que
 * se dibuja con el avión más chico y sobre un fondo que llena todo el cuadrado.
 * Sin el maskable Android deja un borde blanco feo alrededor.
 */
const ICONOS = [
  { nombre: 'icon-192.png', tam: 192, maskable: false },
  { nombre: 'icon-512.png', tam: 512, maskable: false },
  { nombre: 'icon-maskable-512.png', tam: 512, maskable: true },
];

mkdirSync('icons', { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'pc-ico-'));
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch { /* reintento */ }
  await sleep(250);
}

const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener('open', res, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'error en la pagina');
  return r.result?.result?.value;
};

await send('Runtime.enable');

for (const ico of ICONOS) {
  /*
   * El dibujo: fondo con el azul del juego, un resplandor y el avión de papel
   * (una silueta triangular con el pliegue marcado).
   */
  const dataUrl = await ev(`
    (() => {
      const S = ${ico.tam};
      const M = ${ico.maskable};
      const c = document.createElement('canvas');
      c.width = S; c.height = S;
      const g = c.getContext('2d');

      // Fondo: degradado diagonal del azul profundo al violeta del juego.
      const fondo = g.createLinearGradient(0, 0, S, S);
      fondo.addColorStop(0, '#0a0e1a');
      fondo.addColorStop(0.55, '#141a33');
      fondo.addColorStop(1, '#2a1740');
      g.fillStyle = fondo;
      g.fillRect(0, 0, S, S);

      // Resplandor cian detrás del avión.
      const halo = g.createRadialGradient(S * 0.5, S * 0.48, S * 0.02, S * 0.5, S * 0.5, S * 0.5);
      halo.addColorStop(0, 'rgba(0, 229, 255, 0.30)');
      halo.addColorStop(1, 'rgba(0, 229, 255, 0)');
      g.fillStyle = halo;
      g.fillRect(0, 0, S, S);

      // El avión ocupa menos en maskable: Android recorta hasta un 20% del borde.
      const esc = M ? 0.52 : 0.68;
      const cx = S / 2, cy = S / 2;
      const u = S * esc;

      // Silueta del avión de papel mirando hacia arriba-derecha.
      g.save();
      g.translate(cx, cy);
      g.rotate(-Math.PI / 4.6);
      g.translate(-cx, -cy);

      const morro = { x: cx, y: cy - u * 0.5 };
      const colaIzq = { x: cx - u * 0.42, y: cy + u * 0.42 };
      const colaDer = { x: cx + u * 0.42, y: cy + u * 0.42 };
      const panza = { x: cx, y: cy + u * 0.16 };

      // Ala izquierda (sombra).
      g.beginPath();
      g.moveTo(morro.x, morro.y);
      g.lineTo(colaIzq.x, colaIzq.y);
      g.lineTo(panza.x, panza.y);
      g.closePath();
      g.fillStyle = '#1f7fa8';
      g.fill();

      // Ala derecha (luz).
      g.beginPath();
      g.moveTo(morro.x, morro.y);
      g.lineTo(colaDer.x, colaDer.y);
      g.lineTo(panza.x, panza.y);
      g.closePath();
      g.fillStyle = '#7fe9ff';
      g.fill();

      // Pliegue central.
      g.beginPath();
      g.moveTo(morro.x, morro.y);
      g.lineTo(panza.x, panza.y);
      g.strokeStyle = 'rgba(6, 10, 20, 0.75)';
      g.lineWidth = Math.max(2, S * 0.014);
      g.stroke();

      // Contorno.
      g.beginPath();
      g.moveTo(morro.x, morro.y);
      g.lineTo(colaDer.x, colaDer.y);
      g.lineTo(panza.x, panza.y);
      g.lineTo(colaIzq.x, colaIzq.y);
      g.closePath();
      g.strokeStyle = 'rgba(0, 229, 255, 0.9)';
      g.lineWidth = Math.max(2, S * 0.012);
      g.lineJoin = 'round';
      g.stroke();
      g.restore();

      return c.toDataURL('image/png');
    })()
  `);

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync(join('icons', ico.nombre), Buffer.from(base64, 'base64'));
  console.log(`  icons/${ico.nombre.padEnd(26)} ${ico.tam}x${ico.tam}${ico.maskable ? '  (maskable)' : ''}`);
}

browser.kill();
await sleep(300);
rmSync(profile, { recursive: true, force: true });
process.exit(0);
