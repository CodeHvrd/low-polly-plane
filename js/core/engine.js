/**
 * PAPERCRASH — core/engine.js
 * ============================================================
 * Renderer, escena e iluminación.
 *
 * Requiere el global `THREE` (r128 desde CDN). `main.js` valida su
 * presencia ANTES de importar este módulo, para poder mostrar un
 * error legible si el CDN no cargó.
 *
 * Se cargan como ES modules (deferred), por lo que el DOM ya existe
 * al evaluar este archivo.
 * ============================================================
 */
import { CAMERA, WORLD } from '../config.js';

// ── Renderer ────────────────────────────────────────────────
export const canvas = document.getElementById('gameCanvas');

export const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// ── Escena ──────────────────────────────────────────────────
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e1a);
// La niebla no es solo estética: oculta el borde de la malla del terreno, así
// que su densidad está coordinada con WORLD.BEHIND_LENGTH (ver config.js).
scene.fog = new THREE.FogExp2(0x0a0e1a, WORLD.FOG_DENSITY);

// ── Cámara ──────────────────────────────────────────────────
/**
 * FOV vertical, adaptado a la forma de la pantalla.
 *
 * ── Por qué el FOV cambia ──
 * three.js toma el FOV como el ángulo VERTICAL. En apaisado el ancho sobra y el
 * alto es el limitante; en vertical pasa lo contrario: con un FOV fijo de 60° en
 * un teléfono de 390x844 el corredor se ve tan angosto que no se puede anticipar
 * nada y el juego se vuelve injusto.
 *
 * Así que el FOV se abre en vertical hasta compensar. El límite de 82° es
 * deliberado: más que eso y la perspectiva se deforma tanto que cuesta leer las
 * distancias.
 */
function fovParaAspecto(aspecto) {
  const base = CAMERA.FOV;
  // En apaisado (aspecto > 1) se usa el valor base.
  if (aspecto >= 1) return base;
  /*
   * En vertical se abre el FOV. La cuenta inversa es cuánto habría que abrir para
   * conservar el mismo campo horizontal que en 16:9:
   *
   *   tan(fovH/2) = tan(fovV/2) * aspecto
   *
   * Despejando el fov vertical para que el horizontal coincida con el de
   * referencia (aspecto 16/9), y acotando el resultado.
   */
  const referencia = 16 / 9;
  const fovH = 2 * Math.atan(Math.tan((base * Math.PI) / 360) * referencia);
  const fovV = 2 * Math.atan(Math.tan(fovH / 2) / aspecto);
  const grados = (fovV * 180) / Math.PI;
  /*
   * El tope subió de 82° a 88°.
   *
   * Con 82° y un teléfono vertical (aspecto 0.46) el campo HORIZONTAL queda en
   * 44°, o sea 40 m de ancho a 50 m de distancia. El corredor mide 140 m: se ve
   * menos de un tercio, y los obstáculos y monedas de los costados quedan fuera
   * de cuadro. Subir a 88 suma ancho visible sin deformar de más.
   */
  return Math.min(88, Math.max(base, grados));
}

export const camera = new THREE.PerspectiveCamera(
  fovParaAspecto(window.innerWidth / window.innerHeight),
  window.innerWidth / window.innerHeight,
  CAMERA.NEAR,
  CAMERA.FAR,
);

// ── Iluminación ─────────────────────────────────────────────
export const ambientLight = new THREE.AmbientLight(0x1a2040, 1.2);
scene.add(ambientLight);

export const sunLight = new THREE.DirectionalLight(0xffe0b0, 1.5);
sunLight.position.set(60, 80, 30);
sunLight.castShadow = true;
sunLight.shadow.camera.far = 800;
sunLight.shadow.camera.left = -200;
sunLight.shadow.camera.right = 200;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
sunLight.shadow.mapSize.set(1024, 1024);
scene.add(sunLight);

export const rimLight = new THREE.DirectionalLight(0x00e5ff, 0.4);
rimLight.position.set(-30, 20, -40);
scene.add(rimLight);

export const fillLight = new THREE.HemisphereLight(0x1a2050, 0x0a0f1a, 0.6);
scene.add(fillLight);

// ── Resize ──────────────────────────────────────────────────
/**
 * La cámara y el renderer deben reaccionar juntos al resize.
 * Se registra un único listener y se expone una API para que cada
 * sistema (por ejemplo la cámara de juego) se enganche sin duplicar
 * listeners sobre `window`.
 */
const resizeListeners = new Set();

export function onResize(fn) {
  resizeListeners.add(fn);
  return () => resizeListeners.delete(fn);
}

function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  // El FOV también se recalcula: girar el teléfono cambia la forma de la pantalla.
  camera.fov = fovParaAspecto(camera.aspect);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  for (const fn of resizeListeners) fn(w, h);
}

window.addEventListener('resize', handleResize);

/**
 * Ajusta el pixel ratio según la carga real: si el dispositivo baja de
 * 45 FPS sostenidos, reduce la resolución para mantener jugabilidad.
 * Se llama desde el bucle principal.
 */
let qualityScale = 1;
let slowFrames = 0;

export function adaptQuality(dt) {
  const fps = 1 / Math.max(dt, 1e-6);
  if (fps < 45) slowFrames++;
  else slowFrames = Math.max(0, slowFrames - 1);

  if (slowFrames > 90 && qualityScale > 0.65) {
    qualityScale -= 0.15;
    slowFrames = 0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * qualityScale);
  }
}
