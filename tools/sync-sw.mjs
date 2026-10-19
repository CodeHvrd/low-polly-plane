/**
 * Sincroniza la lista de archivos del service worker con el disco.
 *
 * ── Por qué se genera y no se escribe a mano ──
 * La primera versión listaba los módulos a mano y estaba MAL: `effects.js` está
 * en `js/game/` y no en `js/fx/`, `launcher.js` en `js/aircraft/`, y faltaban
 * `AircraftView.js`, `aimFeedback.js` y `resultScreen.js`. Como `cache.addAll`
 * es atómico, un solo archivo inexistente hace fallar la instalación ENTERA y la
 * app no queda instalable, sin ningún error visible.
 *
 * Generar la lista desde el disco elimina esa clase de error: si un archivo se
 * renombra o se agrega, el service worker se actualiza solo. Ver `tools/release.mjs`.
 *
 * Uso: node tools/sync-sw.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Recorre un directorio y devuelve rutas relativas con barras normales. */
function listar(dir, filtro, acumulado = []) {
  for (const nombre of readdirSync(dir).sort()) {
    const completo = join(dir, nombre);
    if (statSync(completo).isDirectory()) listar(completo, filtro, acumulado);
    else if (filtro(nombre)) acumulado.push(relative('.', completo).split(sep).join('/'));
  }
  return acumulado;
}

const modulos = listar('js', (n) => n.endsWith('.js'));
console.log(`  módulos encontrados: ${modulos.length}`);

const f = 'sw.js';
let t = readFileSync(f, 'utf8');

/*
 * Se reemplaza sólo el CONTENIDO del array, conservando el comentario que
 * explica por qué existe. Reescribir el bloque entero borraría la explicación.
 */
const inicio = t.indexOf('const MODULOS = [');
const fin = t.indexOf('];', inicio);
if (inicio < 0 || fin < 0) {
  console.error('  NO se encontró el array MODULOS en sw.js');
  process.exit(1);
}

const cuerpo = modulos.map((m) => `  './${m}',`).join('\n');
const nuevo = t.slice(0, inicio) + `const MODULOS = [\n${cuerpo}\n` + t.slice(fin);
writeFileSync(f, nuevo, 'utf8');
console.log(`  sw.js actualizado con ${modulos.length} módulos`);


/* ── --bump: sube la versión del cache ──
 *
 * El service worker cachea el juego para que ande offline. Si la versión no
 * cambia, el teléfono sigue sirviendo la copia vieja aunque el servidor tenga la
 * nueva: el jugador no ve las actualizaciones.
 *
 * Este flag sube el último número de la versión, que es lo que invalida el cache.
 * Se usa antes de cada push:
 *
 *   node tools/sync-sw.mjs --bump
 */
if (process.argv.includes('--bump')) {
  /*
   * Sube también el CONTADOR de build.
   *
   * El contador es lo que muestra la esquina inferior izquierda del juego: es la
   * única forma de saber si el teléfono está corriendo la última versión o una
   * cacheada por el service worker.
   */
  {
    const rutaV = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'core', 'version.js');
    let v = readFileSync(rutaV, 'utf8');
    const mv = v.match(/export const BUILD = (\d+)/);
    if (mv) {
      const siguiente = Number(mv[1]) + 1;
      v = v.replace(mv[0], `export const BUILD = ${siguiente}`);
      writeFileSync(rutaV, v, 'utf8');
      console.log(`  build: ${siguiente}`);
    }
  }
  const ruta = join(dirname(fileURLToPath(import.meta.url)), '..', 'sw.js');
  let sw = readFileSync(ruta, 'utf8');
  const m = sw.match(/const VERSION = '([^']+)'/);
  if (m) {
    const partes = m[1].split('.');
    partes[partes.length - 1] = String(Number(partes[partes.length - 1]) + 1);
    const nueva = partes.join('.');
    sw = sw.replace(m[0], `const VERSION = '${nueva}'`);
    writeFileSync(ruta, sw, 'utf8');
    console.log(`  versión del cache: ${nueva}`);
  }
}
