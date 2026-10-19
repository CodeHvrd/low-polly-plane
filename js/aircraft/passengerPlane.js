/**
 * PAPERCRASH — aircraft/passengerPlane.js
 * Avión de línea comercial. Morro hacia +X.
 */
import { lambert } from './shared.js';

export function buildPassengerPlane() {
  const grp = new THREE.Group();
  grp.name = 'model-passenger';

  const white = lambert(0xf0f4f8);
  const blue = lambert(0x0057b8);
  const glass = lambert(0x1a2634);
  const metal = lambert(0x8892a0);

  // Fuselaje
  const bodyGeo = new THREE.CylinderGeometry(0.38, 0.35, 4.2, 8);
  bodyGeo.rotateZ(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, white);
  grp.add(body);

  // Morro cónico (+X)
  const noseGeo = new THREE.ConeGeometry(0.38, 1.1, 8);
  noseGeo.rotateZ(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, white);
  nose.position.set(2.65, 0, 0);
  grp.add(nose);

  // Cabina
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.42), glass);
  cockpit.position.set(2.4, 0.18, 0);
  grp.add(cockpit);

  // Cono de cola (-X)
  const tailGeo = new THREE.ConeGeometry(0.35, 1.2, 8);
  tailGeo.rotateZ(Math.PI / 2);
  const tail = new THREE.Mesh(tailGeo, blue);
  tail.position.set(-2.7, 0, 0);
  grp.add(tail);

  // Deriva vertical
  const vFin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.08), blue);
  vFin.position.set(-2.3, 0.75, 0);
  vFin.rotation.z = -0.25;
  grp.add(vFin);

  // Estabilizadores horizontales
  const hFin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 1.6), blue);
  hFin.position.set(-2.6, 0.15, 0);
  grp.add(hFin);

  // Alas principales
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 4.8), white);
  wing.position.set(0.3, -0.05, 0);
  grp.add(wing);

  // Motores bajo las alas
  for (const z of [-1.1, 1.1]) {
    const engGeo = new THREE.CylinderGeometry(0.18, 0.16, 0.85, 7);
    engGeo.rotateZ(Math.PI / 2);
    const eng = new THREE.Mesh(engGeo, metal);
    eng.position.set(0.4, -0.35, z);
    grp.add(eng);

    const intakeGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.15, 7);
    intakeGeo.rotateZ(Math.PI / 2);
    const intake = new THREE.Mesh(intakeGeo, glass);
    intake.position.set(0.85, -0.35, z);
    grp.add(intake);
  }

  return grp;
}
