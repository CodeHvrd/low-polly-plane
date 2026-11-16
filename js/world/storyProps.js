/**
 * PAPERCRASH — world/storyProps.js
 * ============================================================
 * Props 3D del Modo Historia y ambiente de vuelo:
 *   - Portal de Meta (`finish_gate_chrome.glb`)
 *   - Boyas / Hitos de distancia (`milestone_chrome.glb`)
 *   - Nubes low-poly de paralaje (`cloud_chrome.glb`)
 *   - Balizas direccionales de tutorial (`arrow_beacon_chrome.glb`)
 *
 * ── Rendimiento y Reglas ──
 * Cada modelo GLB usa geometría compartida en GPU (`sharedGLB`), `castShadow = false`
 * en nubes de altura y respaldo procedural obligatorio si falla la carga GLB.
 * ============================================================
 */
import { scene } from '../core/engine.js';
import { createRng } from '../core/math.js';
import { glbCacheado, precargarGLB } from './glbLoader.js';
import { groundHeightAt } from './terrainField.js';

export const STORY_MODEL_PATHS = [
  'assets/models/finish_gate_chrome.glb',
  'assets/models/milestone_chrome.glb',
  'assets/models/cloud_chrome.glb',
  'assets/models/arrow_beacon_chrome.glb',
];

let propGroup = null;
const disposables = [];

/** Precarga en segundo plano los 4 modelos GLB generados con Meshy. */
export function preloadStoryProps() {
  return precargarGLB(STORY_MODEL_PATHS);
}

function makeFallbackGate() {
  const g = new THREE.Group();
  const matPillar = new THREE.MeshLambertMaterial({ color: 0x3a4659, flatShading: true });
  const matBeam = new THREE.MeshLambertMaterial({
    color: 0x3ddc84,
    emissive: 0x168844,
    emissiveIntensity: 0.7,
    flatShading: true,
  });
  const geoPillar = new THREE.CylinderGeometry(0.6, 0.85, 22, 6);
  const geoBeam = new THREE.BoxGeometry(1.4, 1.4, 20);
  disposables.push(matPillar, matBeam, geoPillar, geoBeam);

  const left = new THREE.Mesh(geoPillar, matPillar);
  left.position.set(0, 11, -10);
  const right = new THREE.Mesh(geoPillar, matPillar);
  right.position.set(0, 11, 10);
  const top = new THREE.Mesh(geoBeam, matBeam);
  top.position.set(0, 21.5, 0);
  g.add(left, right, top);
  return g;
}

function makeFallbackMilestone() {
  const mat = new THREE.MeshLambertMaterial({
    color: 0x00e5ff,
    emissive: 0x005577,
    emissiveIntensity: 0.5,
    flatShading: true,
  });
  const geo = new THREE.OctahedronGeometry(1.1, 0);
  disposables.push(mat, geo);
  return new THREE.Mesh(geo, mat);
}

function makeFallbackCloud() {
  const mat = new THREE.MeshLambertMaterial({
    color: 0xeaf4ff,
    flatShading: true,
  });
  const geo = new THREE.IcosahedronGeometry(1, 0);
  disposables.push(mat, geo);
  const g = new THREE.Group();
  const puffs = [
    [0, 0, 0, 3.2, 1.8, 2.4],
    [-2.4, -0.3, 0.5, 2.2, 1.3, 1.8],
    [2.5, -0.2, -0.4, 2.4, 1.4, 2.0],
  ];
  for (const [x, y, z, sx, sy, sz] of puffs) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = false;
    g.add(m);
  }
  return g;
}

function makeFallbackBeacon() {
  const mat = new THREE.MeshLambertMaterial({
    color: 0x00e5ff,
    emissive: 0x00aacc,
    emissiveIntensity: 0.7,
    flatShading: true,
  });
  const geo = new THREE.ConeGeometry(0.9, 2.4, 5);
  geo.rotateZ(-Math.PI / 2);
  disposables.push(mat, geo);
  return new THREE.Mesh(geo, mat);
}

function cloneCachedGLB(path, scaleX, scaleY, scaleZ, rotY = 0) {
  const modelo = glbCacheado(path);
  if (!modelo) return null;
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    map: modelo.textura ?? null,
    flatShading: true,
  });
  disposables.push(mat);
  const mesh = new THREE.Mesh(modelo.geometria, mat);
  mesh.scale.set(scaleX, scaleY, scaleZ);
  mesh.rotation.y = rotY;
  mesh.castShadow = false;
  return mesh;
}

/**
 * Construye los props de Historia / entorno para el corredor actual.
 * @param {object} opts
 * @param {number|null} [opts.targetDistance=null]
 * @param {number} [opts.courseLength=1200]
 * @param {boolean} [opts.showBeacons=false]
 */
export function buildStoryProps({
  targetDistance = null,
  courseLength = 1200,
  showBeacons = false,
} = {}) {
  disposeStoryProps();
  propGroup = new THREE.Group();
  propGroup.name = 'story-props';

  // 1. Portal de Meta (si hay distancia objetivo de Historia)
  if (typeof targetDistance === 'number' && targetDistance > 0) {
    const gy = groundHeightAt(targetDistance, 0);
    const gate =
      cloneCachedGLB('assets/models/finish_gate_chrome.glb', 10, 12, 10, Math.PI / 2) ||
      makeFallbackGate();
    gate.position.set(targetDistance, gy + (glbCacheado('assets/models/finish_gate_chrome.glb') ? 10 : 0), 0);
    propGroup.add(gate);
  }

  // 2. Boyas de distancia cada 100 m en ambos márgenes del corredor
  const maxDist = Math.min(courseLength, 2500);
  for (let x = 100; x <= maxDist; x += 100) {
    for (const side of [-24, 24]) {
      const gy = groundHeightAt(x, side);
      const pylon =
        cloneCachedGLB('assets/models/milestone_chrome.glb', 2.2, 4.2, 2.2) ||
        makeFallbackMilestone();
      pylon.position.set(x, gy + 4.0, side);
      propGroup.add(pylon);
    }
  }

  // 3. Nubes low-poly en altura (sin castShadow para 0 costo extra en GPU)
  const rng = createRng(777);
  for (let x = 80; x <= maxDist; x += 130) {
    const z = rng.range(-55, 55);
    const y = rng.range(42, 65);
    const s = rng.range(3.5, 6.5);
    const cloud =
      cloneCachedGLB('assets/models/cloud_chrome.glb', s * 1.4, s * 0.8, s) ||
      makeFallbackCloud();
    cloud.position.set(x, y, z);
    propGroup.add(cloud);
  }

  // 4. Balizas direccionales en niveles tutoriales 1-3
  if (showBeacons) {
    for (let x = 70; x < Math.min(maxDist, 360); x += 90) {
      const gy = groundHeightAt(x, 0);
      const beacon =
        cloneCachedGLB('assets/models/arrow_beacon_chrome.glb', 2.0, 2.0, 2.0) ||
        makeFallbackBeacon();
      beacon.position.set(x, gy + 12, 0);
      propGroup.add(beacon);
    }
  }

  scene.add(propGroup);
  return propGroup;
}

export function disposeStoryProps() {
  if (propGroup) {
    scene.remove(propGroup);
    propGroup.clear();
    propGroup = null;
  }
  for (const item of disposables) {
    item.dispose?.();
  }
  disposables.length = 0;
}
