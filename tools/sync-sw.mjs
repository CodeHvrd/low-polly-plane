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
import { join, relative, sep } from 'node:path';

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
