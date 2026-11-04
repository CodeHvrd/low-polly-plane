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
  left: new THREE.Vector3(0, 6.2, 4.8),
  right: new THREE.Vector3(0, 6.2, -4.8),
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
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.45, 4.4, 6), wood);
  post.position.set(0, 2.2, 0);
  post.castShadow = true;
  procedural.add(post);

  // Horquillas (a lo largo de Z, para que el avión salga hacia +X)
  const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 3.8, 6), wood);
  leftArm.position.set(0, 5.0, 2.8);
  leftArm.rotation.x = Math.PI / 4;
  leftArm.castShadow = true;
  procedural.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 3.8, 6), wood);
  rightArm.position.set(0, 5.0, -2.8);
  rightArm.rotation.x = -Math.PI / 4;
  rightArm.castShadow = true;
  procedural.add(rightArm);

  group.add(procedural);

  // Pernos metálicos en las puntas (siempre visibles donde se ata la banda)
  const pinGeo = new THREE.CylinderGeometry(0.10, 0.10, 0.5, 6);
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
     * Se rota 90° en Y para que la horquilla abra sobre Z (de -4.8 a +4.8) y el
     * avión salga por el centro hacia +X, y se escala para que las puntas
     * coincidan con PRONGS (y=6.2, z=±4.8).
     */
    mesh.rotation.y = Math.PI / 2;
    mesh.scale.set(4.2, 6.6 / 1.9, (4.9 * 2) / 1.53);
    mesh.position.set(0, 6.6 / 2, 0);
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

