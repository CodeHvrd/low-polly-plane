/**
 * PAPERCRASH — aircraft/helicopter.js
 * Helicóptero de ataque con rotores animados. Morro hacia +X.
 *
 * Los rotores se devuelven como referencias (`rotors`) en lugar de
 * guardarse en variables de módulo. Ese era el bug de diseño anterior:
 * `activeHelicopterRotor` era estado global, así que al cambiar de nave
 * quedaba apuntando a una malla ya destruida.
 */
import { lambert } from './shared.js';

export function buildHelicopter() {
  const grp = new THREE.Group();
  grp.name = 'model-heli';

  const green = lambert(0x3d4f3b);
  const dark = lambert(0x1f261d);
  const glass = lambert(0x223344, { transparent: true, opacity: 0.85 });
  const rotorMat = lambert(0x111111);

  // Cabina
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 1.0), green);
  cabin.position.set(0.2, 0.1, 0);
  grp.add(cabin);

  // Morro acristalado
  const noseGeo = new THREE.ConeGeometry(0.55, 1.1, 6);
  noseGeo.rotateZ(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, glass);
  nose.position.set(1.9, 0.1, 0);
  grp.add(nose);

  // Viga de cola
  const boomGeo = new THREE.CylinderGeometry(0.12, 0.24, 2.6, 6);
  boomGeo.rotateZ(Math.PI / 2);
  const boom = new THREE.Mesh(boomGeo, green);
  boom.position.set(-2.1, 0.25, 0);
  grp.add(boom);

  // Deriva de cola
  const tFin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.06), dark);
  tFin.position.set(-3.4, 0.5, 0);
  grp.add(tFin);

  // Patines de aterrizaje
  for (const z of [-0.45, 0.45]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.08), dark);
    skid.position.set(0.1, -0.65, z);
    grp.add(skid);

    for (const x of [-0.5, 0.7]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 5), dark);
      strut.position.set(x, -0.48, z);
      grp.add(strut);
    }
  }

  // Mástil del rotor principal
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6), dark);
  mast.position.set(0.2, 0.85, 0);
  grp.add(mast);

  // Rotor principal
  const mainRotor = new THREE.Group();
  mainRotor.name = 'rotor-main';
  mainRotor.position.set(0.2, 1.1, 0);
  mainRotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 8), dark));
  for (let i = 0; i < 4; i++) {
    const bladeGeo = new THREE.BoxGeometry(0.16, 0.02, 2.8);
    bladeGeo.rotateY((i * Math.PI) / 2);
    mainRotor.add(new THREE.Mesh(bladeGeo, rotorMat));
  }
  grp.add(mainRotor);

  // Rotor de cola
  const tailRotor = new THREE.Group();
  tailRotor.name = 'rotor-tail';
  tailRotor.position.set(-3.4, 0.6, 0.12);
  for (let i = 0; i < 2; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.02), rotorMat);
    blade.rotation.z = (i * Math.PI) / 2;
    tailRotor.add(blade);
  }
  grp.add(tailRotor);

  // Alerones porta-armas
  const stubWing = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 1.8), dark);
  stubWing.position.set(0.2, -0.05, 0);
  grp.add(stubWing);

  grp.userData.rotors = [
    { object: mainRotor, axis: 'y', speed: 32 },
    { object: tailRotor, axis: 'x', speed: 36 },
  ];

  return grp;
}
