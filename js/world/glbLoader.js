/**
 * PAPERCRASH — world/glbLoader.js
 * ============================================================
 * Cargador GLB mínimo, sin dependencias.
 *
 * ── Por qué no se usa el GLTFLoader de Three.js ──
 * El oficial pesa unos 100 KB y necesita ser de la misma revisión que el core
 * (acá r128). Para los modelos de este juego —UNA malla, sin texturas, sin
 * animaciones, sin esqueleto— eso es cargar un motor entero para leer dos buffers.
 *
 * Este parser cubre exactamente lo que Meshy entrega:
 *   · un solo chunk JSON + un chunk BIN
 *   · una malla con POSITION, NORMAL e índices
 *   · sin texturas, sin animaciones, sin jerarquías
 *
 * Si un archivo no entra en ese perfil, tira error y el juego usa la geometría
 * procedural de respaldo. Esa es la garantía importante: **nunca una pantalla vacía**.
 * ============================================================
 */
/*
 * Three.js se carga como script clásico en index.html, así que `THREE` es global.
 * Importarlo acá como módulo fallaría: el archivo vendoreado no tiene `export`.
 */

/** Tipos de componente glTF -> constructor de array tipado. */
const TIPOS = {
  5120: Int8Array,   // BYTE
  5121: Uint8Array,  // UNSIGNED_BYTE
  5122: Int16Array,  // SHORT
  5123: Uint16Array, // UNSIGNED_SHORT
  5125: Uint32Array, // UNSIGNED_INT
  5126: Float32Array, // FLOAT
};

/** Cuántos componentes tiene cada tipo de atributo. */
const COMPONENTES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/**
 * Lee un accessor y devuelve su array tipado.
 *
 * @param {object} gltf JSON del archivo
 * @param {ArrayBuffer} bin datos binarios
 * @param {number} indice
 * @returns {TypedArray|null}
 */
function leerAccessor(gltf, bin, indice) {
  const acc = gltf.accessors?.[indice];
  if (!acc) return null;
  const vista = gltf.bufferViews?.[acc.bufferView];
  if (!vista) return null;

  const Constructor = TIPOS[acc.componentType];
  if (!Constructor) return null;

  const componentes = COMPONENTES[acc.type] ?? 1;
  const bytesPorElemento = componentes * Constructor.BYTES_PER_ELEMENT;
  /*
   * `byteOffset` de la vista es relativo al buffer, y el del accessor a la vista.
   * Hay que sumar los dos o se leen datos corridos.
   */
  const offset = (vista.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const largo = acc.count * componentes;

  /*
   * Si el stride coincide con el tamaño del elemento se puede leer directo. Cuando
   * no coincide (datos intercalados) hay que copiar elemento por elemento.
   */
  const stride = vista.byteStride ?? bytesPorElemento;
  if (stride !== bytesPorElemento) {
    const salida = new Constructor(largo);
    const dv = new DataView(bin);
    for (let i = 0; i < acc.count; i++) {
      for (let c = 0; c < componentes; c++) {
        const p = offset + i * stride + c * Constructor.BYTES_PER_ELEMENT;
        salida[i * componentes + c] =
          acc.componentType === 5126 ? dv.getFloat32(p, true)
            : acc.componentType === 5125 ? dv.getUint32(p, true)
              : acc.componentType === 5123 ? dv.getUint16(p, true)
                : dv.getUint8(p);
      }
    }
    return salida;
  }

  return new Constructor(bin, offset, largo);
}

/**
 * Parsea un GLB y devuelve la geometría de su primera malla.
 *
 * @param {ArrayBuffer} buffer
 * @returns {{geometria: THREE.BufferGeometry, cantidadTriangulos: number}}
 */
export function parseGLB(buffer) {
  const dv = new DataView(buffer);

  // Magia "glTF": si no está, el archivo no es GLB.
  if (dv.getUint32(0, true) !== 0x46546c67) {
    throw new Error('no es un GLB');
  }

  // Chunk 0: JSON.
  const largoJSON = dv.getUint32(12, true);
  const tipoJSON = dv.getUint32(16, true);
  if (tipoJSON !== 0x4e4f534a) throw new Error('el primer chunk no es JSON');
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, largoJSON)));

  // Chunk 1: BIN (puede no existir si todo viniera en data URIs).
  let bin = null;
  const inicioBIN = 20 + largoJSON;
  if (inicioBIN + 8 <= buffer.byteLength) {
    const largoBIN = dv.getUint32(inicioBIN, true);
    const tipoBIN = dv.getUint32(inicioBIN + 4, true);
    if (tipoBIN === 0x004e4942) bin = buffer.slice(inicioBIN + 8, inicioBIN + 8 + largoBIN);
  }

  const malla = gltf.meshes?.[0];
  const primitiva = malla?.primitives?.[0];
  if (!primitiva) throw new Error('el GLB no tiene mallas');

  const posiciones = leerAccessor(gltf, bin, primitiva.attributes?.POSITION);
  if (!posiciones) throw new Error('la malla no tiene posiciones');

  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));

  const normales = leerAccessor(gltf, bin, primitiva.attributes?.NORMAL);
  if (normales) geometria.setAttribute('normal', new THREE.BufferAttribute(normales, 3));

  const indices = leerAccessor(gltf, bin, primitiva.indices);
  if (indices) {
    geometria.setIndex(new THREE.BufferAttribute(indices, 1));
  }

  /*
   * Si no vinieron normales, se calculan. Sin normales el modelo se ve plano y sin
   * volumen: un avión todo blanco.
   */
  if (!normales) geometria.computeVertexNormals();

  geometria.computeBoundingBox();
  geometria.computeBoundingSphere();
  geometria.userData.sharedGLB = true;

  const cantidadTriangulos = (indices ? indices.length : posiciones.length / 3) / 3;
  return { geometria, cantidadTriangulos };
}

/**
 * Geometrías ya cargadas, por ruta.
 *
 * ── Por qué hace falta ──
 * Sin caché, cada vez que se equipa una nave se vuelve a descargar y parsear el
 * archivo. Mientras eso pasa se ve el modelo PROCESAL anterior, y el jugador nota
 * el cambiazo.
 *
 * Con la caché, la segunda vez es instantánea; y con `precargarGLB` la primera
 * también, porque el archivo se baja antes de que el jugador llegue a elegir la nave.
 *
 * @type {Map<string, {geometria: THREE.BufferGeometry, cantidadTriangulos: number}>}
 */
const cache = new Map();

/**
 * Geometría ya cacheada, o null.
 *
 * Sirve para armar el modelo de forma SÍNCRONA cuando ya se descargó: así no hay
 * ni un frame con el modelo viejo.
 *
 * @param {string} url
 */
export function glbCacheado(url) {
  return cache.get(url) ?? null;
}

/**
 * Baja modelos de antemano, sin bloquear.
 *
 * Se llama al arrancar el juego. Los errores se ignoran: si un modelo no está, la
 * nave usa su geometría procedural.
 *
 * @param {string[]} urls
 */
export function precargarGLB(urls) {
  /*
   * Devuelve una promesa que resuelve cuando TERMINARON todas las descargas.
   *
   * Hace falta para poder reconstruir las mallas de obstáculos en cuanto los
   * modelos están disponibles: si no, las que ya se construyeron siguen usando la
   * geometría procedural hasta el próximo cambio de tramo.
   */
  return Promise.all(
    urls.map((url) => (cache.has(url) ? null : cargarGLB(url).catch(() => null))),
  );
}

/**
 * Descarga y parsea un GLB.
 *
 * Devuelve `null` en vez de tirar si algo falla: quien llama decide el respaldo.
 *
 * @param {string} url
 * @returns {Promise<{geometria: THREE.BufferGeometry, cantidadTriangulos: number}|null>}
 */
export async function cargarGLB(url) {
  // Si ya se bajó, se devuelve al instante.
  const guardado = cache.get(url);
  if (guardado) return guardado;

  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
    const resultado = parseGLB(await respuesta.arrayBuffer());
    cache.set(url, resultado);
    return resultado;
  } catch (err) {
    console.warn('[papercrash] no se pudo cargar el modelo ' + url + ':', err.message);
    return null;
  }
}
