/**
 * Empaqueta el juego dentro de native/assets/www y genera los íconos del APK.
 *
 * Uso: node tools/build-apk.mjs
 *
 * ── Por qué existe este script ──
 * El APK NO puede apuntar a 127.0.0.1: en un teléfono esa dirección es el propio
 * teléfono, donde no hay servidor. Para que funcione offline los archivos tienen
 * que ir DENTRO del APK, en `assets/www/`. Este script los copia.
 *
 * ── Qué NO se copia ──
 * `tools/`, `.android-build/`, `native/` y los `*.md`: son de desarrollo y
 * engordan el APK sin servir para jugar.
 */
import { cpSync, mkdirSync, rmSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'native', 'assets', 'www');

/*
 * Lista BLANCA de lo que entra.
 *
 * Se enumera en vez de excluir: si mañana se agrega una carpeta de desarrollo,
 * queda afuera sola y no hay que acordarse de excluirla.
 */
const ENTRAR = [
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'icons',
  'js',      // incluye js/vendor/three.min.js
  'fonts',   // fuentes locales: sin ellas el APK queda sin tipografía
];

/**
 * Detecta recursos que necesitan RED.
 *
 * ── Por qué esta comprobación existe ──
 * El APK no pide permiso de INTERNET. El primer APK salió con Three.js cargado
 * desde `cdnjs.cloudflare.com`: sin red el script no llegaba, `THREE` quedaba
 * indefinido y el juego abría en NEGRO en el teléfono, sin ningún error visible
 * porque no hay consola.
 *
 * Este control lo detecta al compilar, que es donde sí se ve el problema.
 *
 * @param {string} dir
 * @returns {string[]} descripción de cada recurso externo encontrado
 */
function buscarRecursosExternos(dir) {
  const problemas = [];

  const revisar = (ruta, nombre) => {
    if (!/\.(html|css)$/.test(nombre)) return;
    const texto = readFileSync(ruta, 'utf8');
    const lineas = texto.split('\n');

    for (let i = 0; i < lineas.length; i++) {
      const limpia = lineas[i].trim();
      // Un `https://` dentro de un comentario no rompe nada.
      if (limpia.startsWith('//') || limpia.startsWith('*') || limpia.startsWith('/*')) continue;
      // `<script src="https://...">` o `@import url(https://...)`.
      if (/<script[^>]+src=["']https?:/i.test(limpia)) {
        problemas.push(`${nombre}:${i + 1}  ${limpia.slice(0, 90)}`);
      }
      if (/@import\s+(url\()?\s*["']?https?:/i.test(limpia)) {
        problemas.push(`${nombre}:${i + 1}  ${limpia.slice(0, 90)}`);
      }
      // `<link rel="stylesheet" href="https://...">`.
      if (/<link[^>]+href=["']https?:/i.test(limpia)) {
        problemas.push(`${nombre}:${i + 1}  ${limpia.slice(0, 90)}`);
      }
    }
  };

  const recorrer = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) recorrer(p);
      else revisar(p, p.slice(dir.length + 1));
    }
  };

  recorrer(dir);
  return problemas;
}

export function buildGameAssets() {
console.log('  empaquetando el juego en el APK...');

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });

let archivos = 0;
let bytes = 0;

for (const nombre of ENTRAR) {
  const origen = join(raiz, nombre);
  const final = join(destino, nombre);

  let info;
  try {
    info = statSync(origen);
  } catch {
    console.warn(`    aviso: falta ${nombre}`);
    continue;
  }

  if (info.isDirectory()) {
    cpSync(origen, final, { recursive: true });
    for (const f of readdirSync(origen, { recursive: true })) {
      const p = join(origen, f);
      if (statSync(p).isFile()) { archivos++; bytes += statSync(p).size; }
    }
  } else {
    cpSync(origen, final);
    archivos++;
    bytes += info.size;
  }
  console.log(`    ${nombre}`);
}

/*
 * ── El service worker NO entra ──
 *
 * En el APK los archivos ya están en el disco y se cargan con `file://`, así que
 * el service worker no aporta nada: no hay red que cachear. Además, registrar un
 * SW desde `file://` falla en Android y ensucia la consola.
 *
 * Se deja anotado porque es contraintuitivo viniendo del PWA, donde el SW es lo
 * que hace posible el modo offline.
 */
console.log('\n  service worker: omitido (los archivos ya están en el APK)');

/*
 * Control de recursos externos: si algo apunta a la red, el APK va a abrir en
 * negro y no hay forma de darse cuenta mirando el teléfono. Se corta acá.
 */
const externos = buscarRecursosExternos(destino);
if (externos.length) {
  console.error('\n  ERROR: el APK no tiene red y estos recursos la necesitan:');
  for (const p of externos) console.error('    ' + p);
  throw new Error('hay recursos externos; el APK abriría en negro');
}
console.log('  recursos externos: ninguno');

/*
 * Los íconos de la app Android necesitan tamaños propios: el `mipmap` no usa los
 * PNG del PWA, que son 192 y 512.
 */
const densidades = [
  { dir: 'mipmap-mdpi', px: 48 },
  { dir: 'mipmap-hdpi', px: 72 },
  { dir: 'mipmap-xhdpi', px: 96 },
  { dir: 'mipmap-xxhdpi', px: 144 },
  { dir: 'mipmap-xxxhdpi', px: 192 },
];

const resNative = join(raiz, 'native', 'res');
const iconoFuente = join(raiz, 'icons', 'icon-512.png');

/*
 * Se copia el mismo PNG a cada densidad con el nombre `ic_launcher.png`.
 *
 * Android resuelve `@mipmap/ic_launcher` al PNG de la densidad que corresponda y
 * lo escala al dibujar, así que no hace falta generar versiones de cada tamaño.
 * NO se agrega un alias en `mipmap-anydpi`: un `<bitmap android:src="@mipmap/
 * ic_launcher">` dentro de esa misma carpeta se referenciaría a sí mismo.
 */
for (const d of densidades) {
  const carpeta = join(resNative, d.dir);
  mkdirSync(carpeta, { recursive: true });
  cpSync(iconoFuente, join(carpeta, 'ic_launcher.png'));
}
console.log(`  íconos: ${densidades.length} densidades`);

console.log(`\n  total: ${archivos} archivos, ${(bytes / 1024).toFixed(0)} KB`);
}

// Ejecutable directamente: node tools/build-apk.mjs
if (process.argv[1] && process.argv[1].endsWith('build-apk.mjs')) {
  buildGameAssets();
}
