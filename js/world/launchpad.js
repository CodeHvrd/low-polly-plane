/**
 * PAPERCRASH — world/launchpad.js
 * ============================================================
 * Plataforma física de la resortera: pedestal, aro de energía y marcas
 * de dirección. La estructura de madera vive en aircraft/launcher.js;
 * acá está el "piso" sobre el que se apoya.
 * ============================================================
 */
import { scene } from '../core/engine.js';

let group = null;

export function buildLaunchPad() {
  if (group) return group;

  group = new THREE.Group();
  group.name = 'launch-pad';

  const wood = new THREE.MeshLambertMaterial({ color: 0x5c3a21, flatShading: true });
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.3, 8), wood);
  stand.position.set(0, 0.15, 0);
  stand.receiveShadow = true;
  group.add(stand);

  // Aro de energía: marca el origen del vuelo.
  const ringGeo = new THREE.TorusGeometry(0.75, 0.03, 8, 24);
  ringGeo.rotateX(Math.PI / 2);
  const ring = new THREE.Mesh(
    ringGeo,
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.6 }),
  );
  ring.position.set(0, 0.3, 0);
  group.add(ring);

  // Marcas de dirección (+X) para leer la orientación de salida.
  const dashMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.22 });
  for (let i = 0; i < 3; i++) {
    const dashGeo = new THREE.PlaneGeometry(2.4, 0.18);
    dashGeo.rotateX(-Math.PI / 2);
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.position.set(3.0 + i * 3.0, 0.06, 0);
    group.add(dash);
  }

  scene.add(group);
  return group;
}
