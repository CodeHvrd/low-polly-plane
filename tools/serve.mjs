/**
 * PAPERCRASH — tools/serve.mjs
 * ============================================================
 * Servidor HTTP estático mínimo para desarrollo.
 *
 * ── Por qué existe ──
 * `python -m http.server` es la forma habitual de levantar un sitio estático,
 * pero este proyecto necesita algo que no dependa de que haya un Python
 * instalado: en Windows, `python` suele resolver al alias de la Microsoft Store
 * (`WindowsApps\python.exe`), que no es un intérprete sino un lanzador que abre
 * la tienda si no encontrás uno real. El resultado es un error confuso
 * ("no se encontró Python...") cuando en realidad el archivo se podría servir
 * con Node, que es una dependencia que el proyecto YA necesita para las pruebas.
 *
 * Sin dependencias externas: sólo `node:*`. Se levanta así:
 *
 *   node tools/serve.mjs              → http://127.0.0.1:8765
 *   node tools/serve.mjs 3000         → http://127.0.0.1:3000
 *   node tools/serve.mjs 0            → puerto libre, informado al arrancar
 *   node tools/serve.mjs 8765 --lan   → también accesible desde el móvil
 *
 * ── Por qué existe el modo `--lan` ──
 * Por defecto escucha SÓLO en `127.0.0.1`, que es lo correcto para desarrollar:
 * nada de la red local puede ver el proyecto. Pero eso hace imposible abrir el
 * juego desde el teléfono, que es justo lo que se necesita para probar los mandos
 * táctiles y la PWA. Con `--lan` escucha en todas las interfaces e imprime la
 * dirección de la red local, que es la que hay que tipear en el móvil.
 *
 * Es un servidor de archivos estáticos SIN autenticación: cualquiera en la misma
 * red puede leer el proyecto mientras esté levantado. Por eso no es el modo por
 * defecto y por eso conviene cerrarlo (Ctrl+C) al terminar.
 *
 * ── Por qué hace falta un servidor y no alcanza con abrir el HTML ──
 * El juego carga módulos ES (`<script type="module">`). Sobre `file://` el
 * navegador los bloquea por CORS, así que el juego no arranca. Tiene que venir
 * por HTTP.
 * ============================================================
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

/** Raíz que se sirve: la carpeta del proyecto (este archivo está en tools/). */
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  /*
   * El manifest de la PWA necesita su MIME propio. Servido como
   * application/octet-stream el navegador lo ignora y no ofrece instalarla.
   */
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

/**
 * Traduce una URL a una ruta de disco, rechazando cualquier intento de salir
 * de la raíz. Sin esta comprobación, `/../../etc/passwd` sería servible.
 *
 * @param {string} urlPath
 * @returns {string|null} ruta absoluta, o null si es inválida
 */
function resolveRequestPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // porcentaje mal formado
  }
  // Se normaliza y se vuelve relativa para que `..` no pueda escapar.
  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  const abs = resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null;
  return abs;
}

async function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

const server = createServer(async (req, res) => {
  // Sólo lectura: el servidor es para ver el juego, no para modificarlo.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Método no permitido');
  }

  const urlPath = (req.url ?? '/').split('?')[0].split('#')[0];
  const target = resolveRequestPath(urlPath);
  if (!target) return send(res, 400, 'Ruta inválida');

  let stat;
  try {
    stat = statSync(target);
  } catch {
    return send(res, 404, `No encontrado: ${urlPath}`);
  }

  // Un directorio sirve su index.html.
  let filePath = target;
  if (stat.isDirectory()) {
    filePath = join(target, 'index.html');
    try {
      stat = statSync(filePath);
    } catch {
      return send(res, 404, `Sin index.html en ${urlPath}`);
    }
  }

  const type = TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    /*
     * Sin caché: el bucle de desarrollo es editar y refrescar. Si el navegador
     * sirviera un .css o un .js viejo, se perdería tiempo depurando un cambio
     * que en realidad sí está en disco.
     */
    'Cache-Control': 'no-store, must-revalidate',
  });

  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
});

/**
 * Argumentos: puerto opcional y `--lan`.
 *
 * Se aceptan en cualquier orden para que no importe cómo se escriban:
 * `8765 --lan` y `--lan 8765` hacen lo mismo.
 */
const args = process.argv.slice(2);
const quiereLan = args.includes('--lan') || args.includes('--host');
const argPuerto = args.find((a) => !a.startsWith('--'));
const port = argPuerto === undefined ? 8765 : Number(argPuerto);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Puerto inválido: ${argPuerto}`);
  process.exit(1);
}

/**
 * Dirección IPv4 de la red local, para poder abrir el juego desde el móvil.
 *
 * Se descartan las interfaces internas y las de loopback: la primera que quede es
 * la de la red WiFi o Ethernet, que es la que el teléfono puede alcanzar.
 *
 * @returns {string|null}
 */
function ipLocal() {
  for (const lista of Object.values(networkInterfaces())) {
    for (const iface of lista ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  El puerto ${port} ya está en uso.`);
    console.error(`  Probá con otro:  node tools/serve.mjs ${port + 1}\n`);
  } else {
    console.error(`\n  No se pudo levantar el servidor: ${err.message}\n`);
  }
  process.exit(1);
});

/*
 * `0.0.0.0` escucha en TODAS las interfaces; `127.0.0.1` sólo en la propia.
 * Cuál se usa lo decide `--lan`, y la diferencia importa: con `0.0.0.0` el
 * proyecto queda visible para cualquiera en la misma red.
 */
server.listen(port, quiereLan ? '0.0.0.0' : '127.0.0.1', async () => {
  const actual = server.address().port;
  // Se lee el título del HTML para que en la consola se vea que es el proyecto
  // correcto y no otra cosa servida por error desde la misma carpeta.
  let title = '';
  try {
    const html = await readFile(join(ROOT, 'index.html'), 'utf8');
    title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
  } catch {
    /* sin título, no es crítico */
  }

  console.log('');
  console.log(`  ${title || 'PAPERCRASH'} — servidor de desarrollo`);
  console.log(`  raíz:   ${ROOT}`);
  console.log('');
  console.log(`  En esta PC:  http://127.0.0.1:${actual}/index.html`);

  if (quiereLan) {
    const ip = ipLocal();
    if (ip) {
      console.log(`  En el móvil: http://${ip}:${actual}/index.html`);
      console.log('');
      console.log('  El teléfono tiene que estar en la MISMA red WiFi.');
      console.log('  Si no carga, el Firewall de Windows puede estar bloqueando');
      console.log('  las conexiones entrantes de Node.');
    } else {
      console.log('  (no se encontró una dirección de red local para el móvil)');
    }
  } else {
    console.log('');
    console.log('  Para abrirlo también desde el móvil, cerrá esto y volvé a');
    console.log(`  levantarlo así:  node tools/serve.mjs ${actual} --lan`);
  }

  console.log('');
  console.log('  Ctrl+C para detener.');
  console.log('');
});

// Cierre ordenado para que Ctrl+C no deje el puerto tomado.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
