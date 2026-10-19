/**
 * PAPERCRASH — aircraft/fighterJet.js
 * Jet de combate supersónico con postquemadores. Morro hacia +X.
 */
import { lambert, buildFacetedMesh } from './shared.js';

export function buildFighterJet() {
  const grp = new THREE.Group();
  grp.name = 'model-jet';

  const dark = lambert(0x222a36);
  const thruster = lambert(0x111620);

  const verts = [
    3.0, 0, 0, // 0 morro
    1.2, -0.15, -0.4, // 1
    1.2, -0.15, 0.4, // 2
    1.2, 0.22, 0, // 3 lomo
    -0.5, -0.18, -0.7, // 4
    -0.5, -0.18, 0.7, // 5
    -0.5, 0.25, 0, // 6
    -1.8, -0.08, -2.5, // 7 punta de ala izq
    -1.8, -0.08, 2.5, // 8 punta de ala der
    -2.6, -0.12, -0.6, // 9
    -2.6, -0.12, 0.6, // 10
    -2.6, 0.2, 0, // 11
  ];

  const indices = [
    0, 3, 1, 0, 2, 3, 0, 1, 2,
    1, 3, 6, 1, 6, 4, 2, 5, 6, 2, 6, 3, 1, 4, 2, 2, 4, 5,
    4, 6, 7, 5, 8, 6, 4, 7, 9, 5, 10, 8,
    4, 9, 6, 6, 9, 11, 5, 6, 10, 6, 11, 10,
    9, 10, 11, 4, 5, 9, 5, 10, 9,
  ];

  grp.add(buildFacetedMesh(verts, indices, 0x1a2230, 0x3a4658));

  // Cúpula dorada (material metálico para que destaque)
  const canopyGeo = new THREE.ConeGeometry(0.24, 1.4, 6);
  canopyGeo.rotateZ(-Math.PI / 2);
  const canopy = new THREE.Mesh(
    canopyGeo,
    new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.1, metalness: 0.9 }),
  );
  canopy.position.set(1.5, 0.22, 0);
  grp.add(canopy);

  // Derivas gemelas inclinadas
  [-0.45, 0.45].forEach((z, i) => {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.06), dark);
    fin.position.set(-1.8, 0.6, z);
    fin.rotation.z = -0.3;
    fin.rotation.x = i === 0 ? -0.25 : 0.25;
    grp.add(fin);
  });

  // Postquemadores: toberas + anillo brillante
  for (const z of [-0.3, 0.3]) {
    const thrust = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.4, 8), thruster);
    thrust.rotation.z = Math.PI / 2;
    thrust.position.set(-2.8, -0.05, z);
    grp.add(thrust);

    const glow = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.03, 6, 12),
      new THREE.MeshBasicMaterial({ color: 0x00e5ff }),
    );
    glow.rotation.y = Math.PI / 2;
    glow.position.set(-3.0, -0.05, z);
    grp.add(glow);
  }

  return grp;
}
