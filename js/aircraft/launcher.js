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

/** Puntos de anclaje de la banda, en coordenadas de mundo. */
export const PRONGS = {
  left: new THREE.Vector3(0, 3.85, 1.3),
  right: new THREE.Vector3(0, 3.85, -1.3),
};

let group = null;

export function buildLauncher() {
  if (group) return group;

  group = new THREE.Group();
  group.name = 'launcher';

  const wood = new THREE.MeshLambertMaterial({ color: 0x8d5b32, flatShading: true });
  const darkWood = new THREE.MeshLambertMaterial({ color: 0x5c3a21, flatShading: true });
  const metal = new THREE.MeshStandardMaterial({ color: 0x00e5ff, roughness: 0.3, metalness: 0.8 });

  // Poste principal
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 2.8, 6), wood);
  post.position.set(0, 1.4, 0);
  post.castShadow = true;
  group.add(post);

  // Horquillas (a lo largo de Z, para que el avión salga hacia +X)
  const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.6, 6), wood);
  leftArm.position.set(0, 3.2, 0.9);
  leftArm.rotation.x = Math.PI / 6;
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.6, 6), wood);
  rightArm.position.set(0, 3.2, -0.9);
  rightArm.rotation.x = -Math.PI / 6;
  rightArm.castShadow = true;
  group.add(rightArm);

  // Pernos metálicos en las puntas
  const pinGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6);
  const leftPin = new THREE.Mesh(pinGeo, metal);
  leftPin.position.copy(PRONGS.left);
  leftPin.rotation.z = Math.PI / 2;
  group.add(leftPin);

  const rightPin = new THREE.Mesh(pinGeo, metal);
  rightPin.position.copy(PRONGS.right);
  rightPin.rotation.z = Math.PI / 2;
  group.add(rightPin);

  scene.add(group);
  return group;
}

