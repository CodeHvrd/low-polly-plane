/**
 * Normaliza las rutas de `assets/` dentro de un APK a barras normales (/).
 *
 * Uso: node tools/fix-apk-assets.mjs <ruta.apk>
 *
 * ── El bug que esto arregla ──
 * En Windows, `aapt2 link -A assets` mete los archivos en el APK usando el
 * separador del sistema, o sea barra invertida:
 *
 *     assets/www\index.html        ← MAL
 *     assets/www/index.html        ← lo que Android busca
 *
 * Android resuelve `file:///android_asset/www/index.html` con barras normales, así
 * que todas esas entradas son INVISIBLES para el WebView: el archivo existe dentro
 * del APK pero no se puede abrir. El resultado es la pantalla negra.
 *
 * Este script reescribe el APK renombrando las entradas. Se hace después del
 * `aapt2 link` y antes de alinear/firmar, porque cambiar el zip invalida la firma.
 *
 * ── Por qué se reescribe el zip entero ──
 * El formato ZIP no permite renombrar una entrada en el lugar: hay que crear un
 * archivo nuevo. Se copian las entradas en el mismo orden, cambiando sólo el
 * nombre de las que están bajo `assets/`.
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const ruta = process.argv[2];
if (!ruta) {
  console.error('  uso: node tools/fix-apk-assets.mjs <ruta.apk>');
  process.exit(1);
}

/*
 * ── Lector de ZIP ──
 *
 * Se implementa a mano porque no hay dependencias disponibles y el APK es un ZIP
 * sin cifrar. Se lee el Directorio Central (el índice al final del archivo), que
 * es la fuente confiable: dice dónde está cada entrada y cómo está comprimida.
 *
 * Con eso alcanza para reescribir el archivo con los nombres corregidos.
 */

/** Busca el End of Central Directory (EOCD) desde el final. */
function buscarEOCD(buf) {
  // El comentario final puede tener hasta 65535 bytes: se busca hacia atrás.
  const desde = Math.max(0, buf.length - 65535 - 22);
  for (let i = buf.length - 22; i >= desde; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

console.log(`  normalizando rutas de assets en ${ruta.split(/[\\/]/).pop()}`);

const buf = readFileSync(ruta);
const eocd = buscarEOCD(buf);
if (eocd < 0) {
  console.error('  ERROR: no parece un ZIP válido');
  process.exit(1);
}

const totalEntradas = buf.readUInt16LE(eocd + 10);
const dirOffset = buf.readUInt32LE(eocd + 16);

console.log(`  entradas: ${totalEntradas}`);

/*
 * Se recorren las entradas del Directorio Central juntando:
 *   · nombre original y nombre corregido
 *   · offset del encabezado local
 *   · datos crudos (comprimidos tal cual)
 */
const entradas = [];
let p = dirOffset;

for (let i = 0; i < totalEntradas; i++) {
  if (buf.readUInt32LE(p) !== 0x02014b50) {
    console.error(`  ERROR: directorio central corrupto en la entrada ${i}`);
    process.exit(1);
  }

  const flags = buf.readUInt16LE(p + 8);
  const metodo = buf.readUInt16LE(p + 10);
  const crc = buf.readUInt32LE(p + 16);
  const compSize = buf.readUInt32LE(p + 20);
  const sinComp = buf.readUInt32LE(p + 24);
  const largoNombre = buf.readUInt16LE(p + 28);
  const largExtra = buf.readUInt16LE(p + 30);
  const largComentario = buf.readUInt16LE(p + 32);
  const atributosExt = buf.readUInt32LE(p + 38);
  const offsetLocal = buf.readUInt32LE(p + 42);
  const nombre = buf.toString('utf8', p + 46, p + 46 + largoNombre);

  // El nombre corregido: sólo cambian las rutas de assets.
  const nombreCorregido = nombre.startsWith('assets/') || nombre.startsWith('assets\\')
    ? 'assets/' + nombre.slice(7).replace(/\\/g, '/')
    : nombre.replace(/\\/g, '/');

  // Los datos: se leen desde el encabezado local, que tiene su propio nombre y extra.
  const nombreLocal = buf.readUInt16LE(offsetLocal + 26);
  const extraLocal = buf.readUInt16LE(offsetLocal + 28);
  const inicioDatos = offsetLocal + 30 + nombreLocal + extraLocal;
  const datos = buf.subarray(inicioDatos, inicioDatos + compSize);

  // Fecha y hora originales, para no cambiarlas.
  const hora = buf.readUInt16LE(p + 12);
  const fecha = buf.readUInt16LE(p + 14);
  const versionNeeded = buf.readUInt16LE(p + 6);
  const versionMade = buf.readUInt16LE(p + 4);
  const disco = buf.readUInt16LE(p + 34);
  const atributosInt = buf.readUInt32LE(p + 36);

  entradas.push({
    nombre: nombreCorregido, datos, metodo, crc, compSize, sinComp,
    hora, fecha, versionMade, versionNeeded, flags, atributosExt, atributosInt, disco,
    cambio: nombre !== nombreCorregido,
  });

  p += 46 + largoNombre + largExtra + largComentario;
}

const cambios = entradas.filter((e) => e.cambio).length;
if (cambios === 0) {
  console.log('  las rutas ya estaban bien: no hay nada que cambiar');
  process.exit(0);
}
console.log(`  entradas a corregir: ${cambios}`);

/* ── Reescritura ── */
const partes = [];
const centrales = [];
let offset = 0;

for (const e of entradas) {
  const nombreBuf = Buffer.from(e.nombre, 'utf8');

  /*
   * Encabezado local.
   *
   * Se escribe sin campo extra y con el nombre nuevo: el tamaño comprimido y el
   * CRC no cambian porque los DATOS son los mismos bytes.
   */
  const local = Buffer.alloc(30 + nombreBuf.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(e.versionNeeded, 4);
  local.writeUInt16LE(e.flags, 6);
  local.writeUInt16LE(e.metodo, 8);
  local.writeUInt16LE(e.hora, 10);
  local.writeUInt16LE(e.fecha, 12);
  local.writeUInt32LE(e.crc, 14);
  local.writeUInt32LE(e.compSize, 18);
  local.writeUInt32LE(e.sinComp, 22);
  local.writeUInt16LE(nombreBuf.length, 26);
  local.writeUInt16LE(0, 28); // sin extra
  nombreBuf.copy(local, 30);

  const offsetLocal = offset;
  partes.push(local, e.datos);
  offset += local.length + e.datos.length;

  const central = Buffer.alloc(46 + nombreBuf.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(e.versionMade, 4);
  central.writeUInt16LE(e.versionNeeded, 6);
  central.writeUInt16LE(e.flags, 8);
  central.writeUInt16LE(e.metodo, 10);
  central.writeUInt16LE(e.hora, 12);
  central.writeUInt16LE(e.fecha, 14);
  central.writeUInt32LE(e.crc, 16);
  central.writeUInt32LE(e.compSize, 20);
  central.writeUInt32LE(e.sinComp, 24);
  central.writeUInt16LE(nombreBuf.length, 28);
  central.writeUInt16LE(0, 30); // extra
  central.writeUInt16LE(0, 32); // comentario
  central.writeUInt16LE(e.disco, 34);
  central.writeUInt16LE(0, 36); // atributos internos
  central.writeUInt32LE(e.atributosExt, 38);
  central.writeUInt32LE(offsetLocal, 42);
  nombreBuf.copy(central, 46);
  centrales.push(central);
}

const inicioCentral = offset;
for (const c of centrales) { partes.push(c); offset += c.length; }

/* End of Central Directory. */
const fin = Buffer.alloc(22);
fin.writeUInt32LE(0x06054b50, 0);
fin.writeUInt16LE(0, 4);
fin.writeUInt16LE(0, 6);
fin.writeUInt16LE(entradas.length, 8);
fin.writeUInt16LE(entradas.length, 10);
fin.writeUInt32LE(offset - inicioCentral, 12);
fin.writeUInt32LE(inicioCentral, 16);
fin.writeUInt16LE(0, 20);
partes.push(fin);

const salida = Buffer.concat(partes);
writeFileSync(ruta, salida);

console.log(`  listo: ${(salida.length / 1024 / 1024).toFixed(2)} MB`);
