#!/usr/bin/env node
/**
 * Genera el APK de PAPERCRASH desde cero.
 *
 * Uso: node tools/build-apk-todo.mjs
 *
 * ── Qué hace ──
 *   1. Verifica que el toolchain esté instalado y, si no, lo baja.
 *   2. Empaqueta el juego dentro de `native/assets/www`.
 *   3. Compila, alinea y firma el APK.
 *
 * ── Por qué existe además de build-android.mjs ──
 * `build-android.mjs` asume que el toolchain ya está. Este agrega la parte de
 * instalación, que es la que corre una sola vez y es la que más se rompe (rutas,
 * licencias, paquetes del SDK).
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const tool = join(raiz, '.android-build');
const sdk = join(tool, 'sdk');

const jdkOk = existsSync(join(tool, 'jdk')) &&
  existsSync(join(tool, 'sdk', 'build-tools', '34.0.0', 'aapt2.exe')) &&
  existsSync(join(sdk, 'platforms', 'android-34', 'android.jar'));

if (!jdkOk) {
  console.log('  falta el toolchain de Android; lo descargo (una sola vez)');
  const r = spawnSync(process.execPath, [join(raiz, 'tools', 'setup-android.mjs')], {
    stdio: 'inherit', cwd: raiz,
  });
  if (r.status !== 0) {
    console.error('\n  No se pudo instalar el toolchain. Ver arriba.');
    process.exit(1);
  }
}

const r = spawnSync(process.execPath, [join(raiz, 'tools', 'build-android.mjs')], {
  stdio: 'inherit', cwd: raiz,
});
process.exit(r.status ?? 1);
