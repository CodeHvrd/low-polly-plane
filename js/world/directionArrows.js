/**
 * PAPERCRASH — world/directionArrows.js
 * ============================================================
 * Flechas de dirección de lanzamiento (modo FRENÉTICO).
 *
 * ── Qué son y qué NO son ──
 * Son un indicador de ORIENTACIÓN: muestran hacia dónde va a salir el avión,
 * igual que apuntar con el dedo. NO son una previsión de trayectoria: no marcan
 * por dónde va a pasar ni dónde va a caer.
 *
 * Esa distinción es la diferencia con la línea punteada del modo clásico, que sí
 * dibuja el arco completo y el punto de impacto. El pedido es explícito: las
 * flechas indican dirección y nada más.
 *
 * ── Por qué NO siguen al avión en vuelo ──
 * La primera versión dejaba una estela de flechas detrás de la nave durante el
 * vuelo. Se pidió sacarlo: el modo es de reacción y el jugador mira el corredor,
 * no su propia estela. Además, una estela que persigue al avión se lee como
 * "objetivo" y confunde más de lo que ayuda.
 *
 * Así que: se ven mientras se apunta, y desaparecen al lanzar.
 *
 * ── Animación ──
 * Las flechas avanzan hacia adelante en ciclo, como si "tiraran" del avión. La
 * animación es de dirección: refuerza hacia dónde apunta sin prometer nada sobre
 * la trayectoria.
 * ============================================================
 */
import { scene } from '../core/engine.js';
import { TRAJECTORY, AIM } from '../config.js';
import { clamp } from '../core/math.js';

const cfg = TRAJECTORY.ARROWS;

/** Grupo con todas las flechas. */
let group = null;
/** @type {Array<{mesh:object, phase:number, baseX:number, baseY:number, baseZ:number}>} */
let arrows = [];

let arrowGeometry = null;
let arrowMaterial = null;

/** Reloj de la animación, para que el ciclo no dependa de los FPS. */
let clock = 0;

/**
 * Geometría de una flecha: una punta low poly mirando hacia +X.
 *
 * El cono nace mirando a +Y, así que se gira una vez al construirla y después
 * orientarla es sólo rotar el objeto.
 */
function getArrowGeometry() {
  if (arrowGeometry) return arrowGeometry;
  const s = cfg.SIZE;
  arrowGeometry = new THREE.ConeGeometry(s * 0.5, s * 1.7, 4);
  arrowGeometry.rotateZ(-Math.PI / 2);
  return arrowGeometry;
}

function getArrowMaterial() {
  if (!arrowMaterial) {
    arrowMaterial = new THREE.MeshBasicMaterial({
      color: cfg.COLOR,
      transparent: true,
      opacity: cfg.OPACITY,
      // Sin escritura de profundidad: las flechas se superponen entre sí y con
      // el avión, y con depthWrite se taparían con bordes duros.
      depthWrite: false,
    });
  }
  return arrowMaterial;
}

/** Arma el grupo de flechas. Idempotente. */
export function initDirectionArrows() {
  if (group) return group;

  group = new THREE.Group();
  group.name = 'direction-arrows';
  group.visible = false;

  const geo = getArrowGeometry();
  const mat = getArrowMaterial();
  for (let i = 0; i < cfg.COUNT; i++) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    group.add(mesh);
    arrows.push({ mesh, phase: i / cfg.COUNT, baseX: 0, baseY: 0, baseZ: 0 });
  }

  scene.add(group);
  return group;
}

/**
 * Coloca las flechas según la puntería actual.
 *
 * @param {number} pitchDeg  ángulo sobre la horizontal (grados)
 * @param {number} azimuthDeg  desvío lateral (grados)
 * @param {{x:number,y:number,z:number}} origin  punto de lanzamiento
 * @param {boolean} visible
 */
export function layDirectionArrows(pitchDeg, azimuthDeg, origin, visible) {
  if (!group) return;
  group.visible = visible;
  if (!visible) return;

  // Dirección de salida, en coordenadas del mundo. Es la misma convención que
  // usa `velocityFromAim`: +X avanza, +Z es lateral.
  const pitch = (pitchDeg * Math.PI) / 180;
  const azim = (azimuthDeg * Math.PI) / 180;
  const dx = Math.cos(pitch) * Math.cos(azim);
  const dy = Math.sin(pitch);
  const dz = Math.cos(pitch) * Math.sin(azim);

  /*
   * Las flechas arrancan delante del avión y se separan hacia adelante.
   *
   * El primer tramo se deja libre para que no tapen al avión: si empezaran
   * encima, el jugador no vería hacia dónde apunta el morro.
   */
  const first = cfg.SPACING * 1.4;

  for (let i = 0; i < arrows.length; i++) {
    const a = arrows[i];

    /*
     * Animación: un avance cíclico hacia adelante.
     *
     * Cada flecha se corre dentro de su "celda" de la fila y vuelve al empezar.
     * El resultado es una fila que fluye hacia adelante, que se lee como
     * dirección sin dar información de trayectoria.
     */
    const t = (a.phase + clock) % 1;
    const dist = first + (i + t) * cfg.SPACING;
    // Las más lejanas se apagan: la fila se desvanece en vez de cortarse.
    const fade = clamp(1 - i / arrows.length, 0.25, 1) * clamp(1 - t * 0.35, 0.5, 1);

    a.mesh.position.set(origin.x + dx * dist, origin.y + dy * dist, origin.z + dz * dist);
    a.mesh.visible = true;

    // Orientar el +X del cono hacia la dirección de salida.
    a.mesh.lookAt(
      a.mesh.position.x + dx,
      a.mesh.position.y + dy,
      a.mesh.position.z + dz,
    );
    // `lookAt` deja el -Z mirando al objetivo; se compensa con el giro previo.
    a.mesh.rotateY(Math.PI / 2);

    a.mesh.scale.setScalar(fade);
  }
}

/**
 * Avanza la animación.
 *
 * Se llama cada frame aunque las flechas se recoloquen sólo al apuntar: separar
 * el avance del tiempo de la POSICIÓN permite animar sin recalcular la puntería.
 *
 * @param {number} dt
 */
export function tickDirectionArrows(dt) {
  if (!group || !group.visible) return;
  // Un ciclo completo cada ~1.1 s.
  clock = (clock + dt / 1.1) % 1;
}

/** Oculta las flechas (al lanzar o al salir del modo). */
export function hideDirectionArrows() {
  if (!group) return;
  group.visible = false;
  for (const a of arrows) a.mesh.visible = false;
}

/** @deprecated usar `hideDirectionArrows`; se mantiene por compatibilidad. */
export function resetDirectionArrows() {
  clock = 0;
  hideDirectionArrows();
}

/** Libera los recursos. */
export function disposeDirectionArrows() {
  if (!group) return;
  scene.remove(group);
  group.clear();
  arrows = [];
  group = null;
  arrowGeometry?.dispose();
  arrowGeometry = null;
  arrowMaterial?.dispose();
  arrowMaterial = null;
}
