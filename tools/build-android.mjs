/**
 * Compila el APK de PAPERCRASH con el toolchain portable.
 *
 * Uso: node tools/build-android.mjs
 *
 * ── Por qué NO se usa Gradle ──
 * Gradle más el plugin de Android obligarían a bajar el wrapper y cientos de MB
 * de dependencias, y a mantener un `build.gradle` que sólo orquesta cinco pasos.
 * Las herramientas del SDK (`aapt2`, `d8`, `zipalign`, `apksigner`) hacen
 * exactamente lo mismo y ya están en `.android-build/`.
 *
 * ── Los cinco pasos ──
 *   1. aapt2 compile  → recursos (XML, íconos) a .flat
 *   2. aapt2 link     → recursos + manifiesto + assets → APK base
 *   3. javac          → Java compilado contra android.jar
 *   4. d8             → clases a DEX, que es lo que Android ejecuta
 *   5. zipalign + apksigner → alinear y FIRMAR (sin firma Android no instala)
 *
 * ── Por qué se hace en Node y no en PowerShell ──
 * La política de ejecución de Windows bloquea los `.ps1` en esta máquina, y
 * pedirle al usuario que la desactive para compilar es una mala solución.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGameAssets } from './build-apk.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const native = join(raiz, 'native');
const build = join(native, 'build');
const tool = join(raiz, '.android-build');

/* ── Toolchain ─────────────────────────────────────────────── */
const jdkDir = readdirSync(join(tool, 'jdk')).find((d) => d.startsWith('jdk'));
if (!jdkDir) throw new Error('no encontré el JDK en .android-build/jdk');
const jdkHome = join(tool, 'jdk', jdkDir);
const sdk = join(tool, 'sdk');
const bt = join(sdk, 'build-tools', '34.0.0');
const androidJar = join(sdk, 'platforms', 'android-34', 'android.jar');

const env = {
  ...process.env,
  JAVA_HOME: jdkHome,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
};

const exe = (p) => (existsSync(p) ? p : null);
const aapt2 = exe(join(bt, 'aapt2.exe'));
/*
 * ── d8 y apksigner son .bat, y eso rompe execFileSync ──
 *
 * En Windows, `execFileSync` sobre un `.bat` falla con `status: null` y sin
 * ningún mensaje: el proceso ni siquiera arranca, porque el .bat no es un
 * ejecutable sino un script que necesita cmd.exe.
 *
 * La solución es llamar al JAR directamente, que es lo que el .bat hace por
 * dentro: `java -cp d8.jar com.android.tools.r8.D8`. Así no hace falta cmd.exe y
 * los errores sí se ven.
 */
const java = exe(join(jdkHome, 'bin', 'java.exe'));
const d8Jar = join(bt, 'lib', 'd8.jar');
const apksignerJar = join(bt, 'lib', 'apksigner.jar');
const zipalign = exe(join(bt, 'zipalign.exe'));
const javac = exe(join(jdkHome, 'bin', 'javac.exe'));
const keytool = exe(join(jdkHome, 'bin', 'keytool.exe'));

for (const [nombre, ruta] of Object.entries({
  androidJar, aapt2, zipalign, javac, keytool, java,
})) {
  if (!ruta || !existsSync(ruta)) {
    throw new Error(`falta una herramienta: ${nombre}\n  esperaba: ${ruta}\n  corré primero: node tools/setup-android.mjs`);
  }
}

/**
 * Corre una herramienta y devuelve su salida.
 *
 * @param {string} cmd @param {string[]} args
 * @param {{filtro?: RegExp}} [opts]
 */
function correr(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, {
      env,
      encoding: 'utf8',
      // stderr incluido: las herramientas de Android escriben ahí el progreso.
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return out;
  } catch (err) {
    const salida = `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim();
    const lineas = salida.split('\n')
      .filter((l) => l.trim())
      .filter((l) => !(opts.filtro?.test(l)))
      .slice(-12)
      .join('\n');
    throw new Error(`${cmd} falló\n${lineas}`);
  }
}

console.log('\n=== Compilando PAPERCRASH ===');
console.log(`  JDK: ${jdkHome}`);

/* ── Limpieza ──────────────────────────────────────────────── */
if (existsSync(build)) rmSync(build, { recursive: true, force: true });
for (const d of ['compiled', 'classes', 'dex']) {
  mkdirSync(join(build, d), { recursive: true });
}

/* ── 0. Los archivos del juego ─────────────────────────────── */
console.log('\n  0/5 empaquetando el juego');
buildGameAssets();

/* ── 1. Recursos ───────────────────────────────────────────── */
console.log('  1/5 recursos (aapt2 compile)');
correr(aapt2, ['compile', '--dir', join(native, 'res'), '-o', join(build, 'compiled', 'res.zip')]);

/* ── 2. Link ───────────────────────────────────────────────── */
console.log('  2/5 empaquetado (aapt2 link)');
const sinFirmar = join(build, 'app-unsigned.apk');
correr(aapt2, [
  'link',
  '-o', sinFirmar,
  '-I', androidJar,
  '--manifest', join(native, 'AndroidManifest.xml'),
  '--min-sdk-version', '24',
  '--target-sdk-version', '34',
  '--version-code', '1',
  '--version-name', '1.0.0',
  '-A', join(native, 'assets'),
  join(build, 'compiled', 'res.zip'),
]);

/*
 * ── 2b. Rutas de assets ──
 *
 * En Windows, `aapt2 link -A assets` mete las rutas con el separador del sistema:
 * `assets/www\index.html`. Android busca `assets/www/index.html` y no encuentra
 * nada, así que el WebView abre en blanco y la app queda NEGRA —sin ningún error
 * visible, porque un APK no tiene consola—.
 *
 * Se corrige acá, entre el link y la firma: modificar el zip después de firmar
 * invalida la firma.
 */
console.log('  2b/5 rutas de assets');
correr(process.execPath, [join(raiz, 'tools', 'fix-apk-assets.mjs'), sinFirmar]);

/* ── 3. Java ───────────────────────────────────────────────── */
console.log('  3/5 java (javac)');
const fuentes = [];
(function recorrer(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) recorrer(p);
    else if (f.endsWith('.java')) fuentes.push(p);
  }
})(join(native, 'src'));

correr(javac, [
  '-source', '8', '-target', '8',
  // `-Xlint:-options` silencia el aviso de "source 8 está obsoleto": se apunta a
  // Java 8 a propósito, que es lo que corre en Android sin desugaring.
  '-Xlint:-options',
  '-bootclasspath', androidJar,
  '-classpath', androidJar,
  '-d', join(build, 'classes'),
  ...fuentes,
]);

/* ── 4. DEX ────────────────────────────────────────────────── */
console.log('  4/5 dex (d8)');
const clases = [];
(function recorrer(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) recorrer(p);
    else if (f.endsWith('.class')) clases.push(p);
  }
})(join(build, 'classes'));

correr(java, [
  '-cp', d8Jar, 'com.android.tools.r8.D8',
  '--lib', androidJar,
  '--min-api', '24',
  '--output', join(build, 'dex'),
  ...clases,
]);

/*
 * El DEX se agrega al APK como una entrada más.
 *
 * `aapt2 link` ya corrió y no sabe de DEX, así que se inyecta después. Se usa el
 * zip de Node: `classes.dex` tiene que quedar COMPRIMIDO o sin comprimir de forma
 * consistente, y zipalign se encarga de la alineación más adelante.
 */
console.log('     agregando classes.dex');
const { execFileSync: zipExec } = await import('node:child_process');
/*
 * Se usa `jar` del JDK para agregar la entrada.
 *
 * `jar uf` respeta el orden de entradas y no deja el APK en un estado raro, a
 * diferencia de reescribir el zip a mano. Es la opción más predecible sin
 * dependencias externas.
 */
const jar = exe(join(jdkHome, 'bin', 'jar.exe'));
try {
  zipExec(jar, ['uf', sinFirmar, '-C', join(build, 'dex'), 'classes.dex'], {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  throw new Error(`jar falló al agregar el DEX\n${err.stderr ?? ''}`);
}

/* ── 5. Alinear y firmar ───────────────────────────────────── */
console.log('  5/5 alinear y firmar');

/*
 * Se alinea ANTES de firmar.
 *
 * Firmar primero e alinear después invalida la firma, porque zipalign reescribe
 * offsets dentro del zip. Este orden es obligatorio.
 */
const alineado = join(build, 'app-aligned.apk');
correr(zipalign, ['-f', '-p', '4', sinFirmar, alineado]);

const keystore = join(build, 'papercrash.keystore');
const alias = 'papercrash';
const clave = 'papercrash';

if (!existsSync(keystore)) {
  console.log('     generando keystore');
  correr(keytool, [
    '-genkeypair',
    '-keystore', keystore,
    '-alias', alias,
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-storepass', clave, '-keypass', clave,
    '-dname', 'CN=PaperCrash, OU=Game, O=PaperCrash, L=, S=, C=AR',
  ]);
}

const apkFinal = join(build, 'PaperCrash-1.0.0.apk');
correr(java, [
  '-jar', apksignerJar,
  'sign',
  '--ks', keystore,
  '--ks-key-alias', alias,
  '--ks-pass', `pass:${clave}`,
  '--key-pass', `pass:${clave}`,
  '--out', apkFinal,
  alineado,
]);

/* ── Verificación ──────────────────────────────────────────── */
console.log('\n  verificando la firma');
try {
  const v = correr(java, ['-jar', apksignerJar, 'verify', '--print-certs', apkFinal]);
  for (const l of v.split('\n').slice(0, 3)) if (l.trim()) console.log(`     ${l.trim()}`);
} catch (err) {
  console.log(`     ${err.message}`);
}

const info = statSync(apkFinal);
console.log('\n=== APK listo ===');
console.log(`  ${apkFinal}`);
console.log(`  ${(info.size / 1024 / 1024).toFixed(2)} MB`);
