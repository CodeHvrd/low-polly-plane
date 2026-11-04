/**
 * PAPERCRASH — aircraft/launcher.js
 * ============================================================
 * La resortera 3D y su banda elástica.
 *
 * Expone los ganchos (`prongs`) a los que se ata la banda, para que el
 * sistema de puntería dibuje la goma sin conocer la geometría del modelo.
 * Si mañana cambia la forma de la resortera, la puntería sigue funcionando.
 * ============================================================
 */
import { scene } from '../core/engine.js';
import { cargarGLB, glbCacheado } from '../world/glbLoader.js';

const LAUNCHER_GLB = 'assets/models/launcher_chrome.glb';

/** Puntos de anclaje de la banda, en coordenadas de mundo. */
export const PRONGS = {
  left: new THREE.Vector3(0, 4.9, 3.6),
  right: new THREE.Vector3(0, 4.9, -3.6),
};

let group = null;

export function buildLauncher() {
  if (group) return group;

  group = new THREE.Group();
  group.name = 'launcher';

  const wood = new THREE.MeshLambertMaterial({ color: 0x8d5b32, flatShading: true });
  const metal = new THREE.MeshStandardMaterial({ color: 0x00e5ff, roughness: 0.3, metalness: 0.8 });

  const procedural = new THREE.Group();
  procedural.name = 'launcher-procedural';

  // Poste principal
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.35, 3.3, 6), wood);
  post.position.set(0, 1.65, 0);
  post.castShadow = true;
  procedural.add(post);

  // Horquillas (a lo largo de Z, para que el avión salga hacia +X)
  const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2.8, 6), wood);
  leftArm.position.set(0, 3.9, 2.1);
  leftArm.rotation.x = Math.PI / 4;
  leftArm.castShadow = true;
  procedural.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2.8, 6), wood);
  rightArm.position.set(0, 3.9, -2.1);
  rightArm.rotation.x = -Math.PI / 4;
  rightArm.castShadow = true;
  procedural.add(rightArm);

  group.add(procedural);

  // Pernos metálicos en las puntas (siempre visibles donde se ata la banda)
  const pinGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.4, 6);
  const leftPin = new THREE.Mesh(pinGeo, metal);
  leftPin.position.copy(PRONGS.left);
  leftPin.rotation.z = Math.PI / 2;
  group.add(leftPin);

  const rightPin = new THREE.Mesh(pinGeo, metal);
  rightPin.position.copy(PRONGS.right);
  rightPin.rotation.z = Math.PI / 2;
  group.add(rightPin);

  const aplicarGLB = (res) => {
    if (!res || !group) return;
    const matGLB = new THREE.MeshLambertMaterial({ color: 0x8d5b32 });
    const mesh = new THREE.Mesh(res.geometria, matGLB);
    /*
     * El modelo mide 1.53 (X, horquilla) × 1.90 (Y, alto) × 0.81 (Z).
     * Se rota 90° en Y para que la horquilla abra sobre Z (de -3.6 a +3.6) y el
     * avión salga por el centro hacia +X, y se escala para que las puntas
     * coincidan con PRONGS (y=4.9, z=±3.6).
     */
    mesh.rotation.y = Math.PI / 2;
    mesh.scale.set(2.8, 5.2 / 1.9, (3.7 * 2) / 1.53);
    mesh.position.set(0, 5.2 / 2, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'launcher-glb';
    procedural.visible = false;
    group.add(mesh);
  };

  const cacheado = glbCacheado(LAUNCHER_GLB);
  if (cacheado) aplicarGLB(cacheado);
  else cargarGLB(LAUNCHER_GLB).then(aplicarGLB);

  scene.add(group);
  return group;
}

