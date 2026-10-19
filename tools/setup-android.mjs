/**
 * Instala el toolchain de Android dentro del proyecto (una sola vez).
 *
 * Uso: node tools/setup-android.mjs
 *
 * ── Qué instala y dónde ──
 * Todo queda en `.android-build/`, DENTRO de la carpeta del proyecto:
 *
 *   .android-build/jdk/   JDK 21 (Temurin, portable)
 *   .android-build/sdk/   Android SDK: platform-tools, build-tools 34, android-34
 *
 * No toca el sistema: no escribe en Program Files, no modifica el PATH, no pide
 * permisos de administrador. Borrar `.android-build/` desinstala todo.
 *
 * ── Por qué no se usa sdkmanager ──
 * Medido, `sdkmanager` falla con "Failed to download any source lists" en esta
 * máquina aunque los repositorios de Google respondan bien por HTTP (verificado:
 * 200 en los cuatro XML). El cliente no logra hablar con el repo.
 *
 * Así que este script hace lo mismo pero a mano: baja el XML del repositorio,
 * encuentra los ZIP de Windows de cada paquete y los extrae en la carpeta que
 * corresponde. Es más código, pero funciona y no depende de un cliente que falla.
 */
import { mkdirSync, existsSync, rmSync, readdirSync, copyFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(raiz, '.android-build');
const dl = join(base, 'dl');
const sdk = join(base, 'sdk');

const REPO = 'https://dl.google.com/android/repository/';

/** Baja una URL a un archivo, saltando si ya existe. */
async function bajar(url, destino) {
  if (existsSync(destino)) {
    console.log(`     ya está: ${destino.split(/[\\/]/).pop()}`);
    return;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`no se pudo bajar ${url} (HTTP ${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  const { writeFileSync } = await import('node:fs');
  writeFileSync(destino, buf);
  console.log(`     ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
}

/** Extrae un ZIP con PowerShell (Expand-Archive), que ya viene con Windows. */
function descomprimir(zip, destino) {
  mkdirSync(destino, { recursive: true });
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath "${zip}" -DestinationPath "${destino}" -Force`,
  ], { stdio: 'ignore' });
}

/**
 * Aplana un nivel de carpeta si el ZIP trajo un directorio contenedor.
 *
 * Los paquetes del SDK vienen como `platform-tools/adb.exe`, así que al extraer
 * en `sdk/platform-tools` queda `sdk/platform-tools/platform-tools/adb.exe`. Este
 * paso lo devuelve a su lugar.
 *
 * @param {string} dir @param {string} marca  archivo que debe quedar en la raíz
 */
function aplanar(dir, marca) {
  if (existsSync(join(dir, marca))) return;
  const sub = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  if (sub.length !== 1) return;
  const interno = join(dir, sub[0].name);
  if (!existsSync(join(interno, marca))) return;
  for (const f of readdirSync(interno)) {
    renameSync(join(interno, f), join(dir, f));
  }
  rmSync(interno, { recursive: true, force: true });
}

console.log('\n=== Instalando el toolchain de Android ===');
console.log(`  destino: ${base}\n`);
mkdirSync(dl, { recursive: true });
mkdirSync(sdk, { recursive: true });

/* ── 1. JDK ────────────────────────────────────────────────── */
console.log('  1/3 JDK 21 (Temurin)');
const jdkDir = join(base, 'jdk');
if (existsSync(jdkDir) && readdirSync(jdkDir).some((d) => d.startsWith('jdk'))) {
  console.log('     ya está');
} else {
  const zip = join(dl, 'jdk21.zip');
  await bajar(
    'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk',
    zip,
  );
  console.log('     extrayendo');
  descomprimir(zip, jdkDir);
}

/* ── 2. Repositorio del SDK ────────────────────────────────── */
console.log('\n  2/3 repositorio del SDK');
const repoXml = join(dl, 'repository2-3.xml');
await bajar(`${REPO}repository2-3.xml`, repoXml);
const { readFileSync } = await import('node:fs');
const xml = readFileSync(repoXml, 'utf8');

/**
 * Busca la URL del ZIP de Windows de un paquete.
 *
 * Se parsea por texto y no con un parser XML porque el archivo usa namespaces
 * (`sdk:remotePackage`) que en PowerShell/XPath dieron problemas, y acá sólo hace
 * falta ubicar el bloque del paquete y sacar sus `<url>`.
 *
 * @param {string} paquete ruta exacta, p. ej. "build-tools;34.0.0"
 */
function urlDelPaquete(paquete) {
  const i = xml.indexOf(`<remotePackage path="${paquete}">`);
  if (i < 0) throw new Error(`el repositorio no tiene "${paquete}"`);
  const j = xml.indexOf('</remotePackage>', i);
  const bloque = xml.slice(i, j);
  const urls = [...bloque.matchAll(/<url>([^<]+\.zip)<\/url>/g)].map((m) => m[1]);

  /*
   * Se prefiere el ZIP de Windows. Si el paquete no distingue sistemas
   * (`platforms;android-34` trae uno solo), se usa el primero.
   */
  return urls.find((u) => u.includes('windows')) ?? urls[0];
}

/* ── 3. Paquetes del SDK ───────────────────────────────────── */
console.log('\n  3/3 paquetes del SDK');

const paquetes = [
  { pkg: 'platform-tools', dir: 'platform-tools', marca: 'adb.exe' },
  { pkg: 'build-tools;34.0.0', dir: 'build-tools/34.0.0', marca: 'aapt2.exe' },
  { pkg: 'platforms;android-34', dir: 'platforms/android-34', marca: 'android.jar' },
];

for (const p of paquetes) {
  const destino = join(sdk, ...p.dir.split('/'));
  if (existsSync(join(destino, p.marca))) {
    console.log(`     ${p.pkg}: ya está`);
    continue;
  }
  const url = urlDelPaquete(p.pkg);
  const zip = join(dl, url);
  console.log(`     ${p.pkg}`);
  console.log(`       ${url}`);
  await bajar(REPO + url, zip);
  descomprimir(zip, destino);
  aplanar(destino, p.marca);
}

/* ── Verificación ──────────────────────────────────────────── */
console.log('\n  verificando');
const jdkHome = join(jdkDir, readdirSync(jdkDir).find((d) => d.startsWith('jdk')));
const controles = {
  'java': join(jdkHome, 'bin', 'java.exe'),
  'javac': join(jdkHome, 'bin', 'javac.exe'),
  'keytool': join(jdkHome, 'bin', 'keytool.exe'),
  'aapt2': join(sdk, 'build-tools', '34.0.0', 'aapt2.exe'),
  'd8.jar': join(sdk, 'build-tools', '34.0.0', 'lib', 'd8.jar'),
  'apksigner.jar': join(sdk, 'build-tools', '34.0.0', 'lib', 'apksigner.jar'),
  'zipalign': join(sdk, 'build-tools', '34.0.0', 'zipalign.exe'),
  'android.jar': join(sdk, 'platforms', 'android-34', 'android.jar'),
};

let faltan = 0;
for (const [nombre, ruta] of Object.entries(controles)) {
  const ok = existsSync(ruta);
  if (!ok) faltan++;
  console.log(`     ${ok ? 'OK ' : 'FALTA'} ${nombre}`);
}

if (faltan) {
  console.error(`\n  Faltan ${faltan} herramientas. No se puede compilar.`);
  process.exit(1);
}

const version = execFileSync(join(jdkHome, 'bin', 'java.exe'), ['-version'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).split('\n')[0];
console.log(`\n=== Toolchain listo ===`);
console.log(`  ${version.trim()}`);
console.log(`  ${sdk}`);
console.log('\n  Ahora: node tools/build-android.mjs');
