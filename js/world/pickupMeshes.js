/**
 * PAPERCRASH — world/pickupMeshes.js
 * ============================================================
 * Mallas de las monedas y los boosters.
 *
 * ── Decisiones de rendimiento ──
 * Cada moneda es una malla propia porque tienen que girar y desaparecer de a
 * una. Para que eso sea barato:
 *   · La geometría y el material se comparten entre todas las del mismo valor
 *     (tres geometrías y tres materiales en total, no cientos).
 *   · El giro se aplica sobre la rotación de la malla, sin tocar vértices.
 *   · Recoger no borra nada: se oculta la malla y se reutiliza al reiniciar.
 *
 * El color distingue el valor de un vistazo, que es lo que hace que las de 50
 * sean un objetivo visible desde lejos.
 * ============================================================
 */
import { scene } from '../core/engine.js';
import { PICKUPS } from '../config.js';

/** Color por valor de moneda. */
const COIN_COLORS = {
  5: 0xffb020,
  10: 0x9be564,
  50: 0xff4f8b,
};

/** Material compartido por valor: se crea una sola vez. */
const coinMaterials = new Map();
/** Geometría compartida por todas las monedas. */
let coinGeometry = null;
/** Geometría compartida por todos los boosters (el color lo pone el material). */
let boosterGeometry = null;

let group = null;
/** @type {Map<number, import('three').Object3D>} */
const meshes = new Map();

/**
 * Geometría del booster: un octaedro.
 *
 * Pura lectura low poly y visualmente distinto de una moneda. Se comparte entre
 * TODOS los boosters y tipos: lo que cambia entre azul y violeta es el material,
 * no la forma, así que no hay razón para tener tres geometrías.
 */
function getBoosterGeometry() {
  if (!boosterGeometry) {
    boosterGeometry = new THREE.OctahedronGeometry(PICKUPS.BOOSTERS.VISUAL_RADIUS, 0);
  }
  return boosterGeometry;
}

function getCoinGeometry() {
  if (!coinGeometry) {
    // Cilindro achatado y facetado: lee como moneda y mantiene el look low poly.
    coinGeometry = new THREE.CylinderGeometry(0.9, 0.9, 0.18, 8);
    // Apoyada de canto: se ve de frente mientras vuela hacia ella.
    coinGeometry.rotateX(Math.PI / 2);
  }
  return coinGeometry;
}

function getCoinMaterial(value) {
  let mat = coinMaterials.get(value);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({
      color: COIN_COLORS[value] ?? 0xffb020,
      emissive: COIN_COLORS[value] ?? 0xffb020,
      emissiveIntensity: 0.45,
      flatShading: true,
    });
    coinMaterials.set(value, mat);
  }
  return mat;
}

/**
 * ── Boosters: color y letra ──
 *
 * El pedido es que se lean de un vistazo y sin leyenda:
 *
 *   · AZUL    → boost INSTANTÁNEO: empuja al tocarlo, no se guarda.
 *   · VIOLETA → boost ACTIVABLE: se guarda y se usa con Space.
 *   · ÁMBAR   → boost de EMERGENCIA: aparece cuando queda poco combustible.
 *
 * Los tres son la misma forma (un octaedro) con distinto color y una "B"
 * adentro. La letra es lo que los hace inconfundibles cuando están lejos o
 * detrás de un obstáculo, donde el color solo no alcanza.
 */
const BOOSTER_STYLE = {
  /** Activación con Space (el violeta del pedido). */
  booster: { color: 0xa855f7, letter: '#f3e8ff' },
  /** Instantáneo (el azul del pedido). */
  instant: { color: 0x2f7dff, letter: '#e8f1ff' },
  /** De emergencia, cuando queda poco combustible. */
  emergency: { color: 0xff8a1f, letter: '#fff4e8' },
};

/** Material y textura por tipo: se crean una sola vez. */
const boosterMaterials = new Map();
const boosterLetters = new Map();

/**
 * Textura con la letra "B".
 *
 * Se dibuja en un canvas en vez de usar un modelo 3D de la letra: una geometría
 * de texto costaría cientos de triángulos por booster y esto son dos.
 *
 * @param {string} color
 */
function getLetterTexture(color) {
  let tex = boosterLetters.get(color);
  if (tex) return tex;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Fondo transparente y la letra centrada, con un contorno oscuro para que se
  // lea también contra el cielo claro.
  ctx.clearRect(0, 0, size, size);
  ctx.font = 'bold 46px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(6, 10, 20, 0.85)';
  ctx.strokeText('B', size / 2, size / 2 + 2);
  ctx.fillStyle = color;
  ctx.fillText('B', size / 2, size / 2 + 2);

  tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 2;
  boosterLetters.set(color, tex);
  return tex;
}

function getBoosterMaterial(kind) {
  const style = BOOSTER_STYLE[kind] ?? BOOSTER_STYLE.booster;
  let mat = boosterMaterials.get(kind);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({
      color: style.color,
      emissive: style.color,
      // El instantáneo brilla más: tiene que gritar "agarrame ahora".
      emissiveIntensity: kind === 'instant' ? 0.85 : 0.55,
      flatShading: true,
    });
    boosterMaterials.set(kind, mat);
  }
  return mat;
}

/** Plano con la letra B, mirando siempre a cámara. */
function makeLetterSprite(kind) {
  const style = BOOSTER_STYLE[kind] ?? BOOSTER_STYLE.booster;
  const mat = new THREE.SpriteMaterial({
    map: getLetterTexture(style.letter),
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(PICKUPS.BOOSTERS.VISUAL_RADIUS * 1.9);
  return sprite;
}

/**
 * Construye una malla por recolectable. Idempotente.
 * @param {import('./collectibles.js').Pickup[]} pickups
 */
export function buildPickupMeshes(pickups) {
  if (group) return group;

  group = new THREE.Group();
  group.name = 'pickups';

  for (const p of pickups) {
    if (p.kind === 'coin') {
      const mesh = new THREE.Mesh(getCoinGeometry(), getCoinMaterial(p.value));
      mesh.position.set(p.x, p.y, p.z);
      mesh.name = `coin-${p.id}`;
      group.add(mesh);
      meshes.set(p.id, mesh);
      continue;
    }

    /*
     * El booster es una COLUMNA de recolección (ver `collectAt`), así que se
     * dibuja como tal: varias esferas apiladas que marcan el tramo vertical por
     * el que hay que pasar.
     *
     * Dibujarlo como un punto sería mentir sobre la mecánica: el jugador vería
     * una bolita a una altura que no es la única a la que se puede recoger.
     */
    const stack = new THREE.Group();
    stack.name = `booster-${p.id}`;
    stack.position.set(p.x, p.y, p.z);

    const kind = p.boosterKind ?? 'booster';
    const half = p.halfSpan ?? 0;
    const beads = half > 0 ? Math.max(2, Math.round(p.halfSpan / 2.2)) : 1;
    for (let i = 0; i < beads; i++) {
      const t = beads === 1 ? 0.5 : i / (beads - 1);
      const bead = new THREE.Mesh(getBoosterGeometry(), getBoosterMaterial(kind));
      bead.position.y = -half + t * half * 2;
      // Los extremos más chicos: la columna se lee como un pasillo, no como un muro.
      const edge = 1 - Math.abs(t - 0.5) * 0.7;
      bead.scale.setScalar(edge);
      stack.add(bead);
    }

    /*
     * La letra va en el CENTRO de la columna, no en cada esfera: repetida en
     * todas se leería como ruido, y el jugador necesita saber qué tipo es, no
     * cuántas esferas tiene.
     */
    const letter = makeLetterSprite(kind);
    letter.position.y = 0;
    stack.add(letter);

    group.add(stack);
    meshes.set(p.id, stack);
  }

  scene.add(group);
  return group;
}

/**
 * Sincroniza las mallas con el estado de los recolectables y las anima.
 *
 * Se llama una vez por frame: gira lo que sigue disponible y oculta lo ya
 * recogido. No asigna memoria.
 *
 * @param {import('./collectibles.js').Pickup[]} pickups
 * @param {number} dt
 * @param {number} [time]  reloj acumulado, para el flotado
 */
export function updatePickupMeshes(pickups, dt, time = 0) {
  if (!group) return;

  for (const p of pickups) {
    const mesh = meshes.get(p.id);
    if (!mesh) continue;

    /*
     * La visibilidad sigue a los DATOS en las dos direcciones.
     *
     * Antes sólo se ocultaba al recoger, así que al reiniciar la partida los
     * recolectables volvían a estar disponibles en los datos pero seguían
     * invisibles: se podían volver a agarrar sin verlos. Es el bug que había que
     * arreglar, y la causa era un `if` que sólo iba en una dirección.
     */
    const shouldShow = !p.taken;
    if (mesh.visible !== shouldShow) mesh.visible = shouldShow;
    if (!shouldShow) continue;

    if (p.kind === 'coin') {
      // Giro sobre su eje + un flotado suave, para que se lea como recogible.
      mesh.rotation.z += dt * 2.6;
      mesh.position.y = p.y + Math.sin(time * 2.2 + p.x * 0.35) * 0.22;
    } else {
      // La columna gira entera y late, para que se vea desde lejos.
      mesh.rotation.y += dt * 1.5;
      const pulse = 1 + Math.sin(time * 5 + p.x * 0.1) * 0.1;
      mesh.scale.set(pulse, 1, pulse);
    }
  }
}

/** Libera la geometría y los materiales compartidos. */
export function disposePickupMeshes() {
  if (!group) return;
  scene.remove(group);
  group.clear();
  meshes.clear();
  group = null;

  coinGeometry?.dispose();
  coinGeometry = null;
  boosterGeometry?.dispose();
  boosterGeometry = null;
  for (const mat of coinMaterials.values()) mat.dispose();
  coinMaterials.clear();
  // Un material y una textura por tipo de booster: sin esto, cada recarga
  // dejaría una textura de canvas viva en la GPU.
  for (const mat of boosterMaterials.values()) mat.dispose();
  boosterMaterials.clear();
  for (const tex of boosterLetters.values()) tex.dispose();
  boosterLetters.clear();
}
