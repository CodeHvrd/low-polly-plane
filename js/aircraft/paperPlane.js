/**
 * PAPERCRASH — aircraft/paperPlane.js
 * Avión de papel plegado. Malla facetada a mano, morro hacia +X.
 */
import { buildFacetedMesh } from './shared.js';

export function buildPaperPlane() {
  const grp = new THREE.Group();
  grp.name = 'model-paper';

  const verts = [
    // 0: punta del morro
    2.2, 0, 0,
    // 1-2: cuerpo
    0.8, -0.05, -0.08,
    0.8, -0.05, 0.08,
    // 3: lomo superior
    0, 0.1, 0,
    // 4-5: cola
    -1.2, -0.12, -0.06,
    -1.2, -0.12, 0.06,
    // 6: punta de cola
    -2.4, -0.05, 0,
    // 7-8: puntas de ala
    0.3, -0.18, -1.8,
    0.3, -0.18, 1.8,
    // 9-10: ala interior trasera
    -0.8, -0.12, -0.9,
    -0.8, -0.12, 0.9,
    // 11-12: aletas laterales
    -1.6, -0.05, -0.55,
    -1.6, -0.05, 0.55,
    // 13: aleta superior
    -1.8, 0.55, 0,
  ];

  const indices = [
    0, 7, 3, 7, 9, 3, 9, 4, 3, // ala izquierda
    0, 3, 8, 8, 3, 10, 10, 3, 5, // ala derecha
    0, 3, 2, 0, 3, 1, 3, 4, 1, 3, 5, 2, // lomo
    1, 2, 0, 4, 5, 6, 1, 4, 6, 2, 5, 6, 1, 2, 6, // panza
    4, 13, 6, 5, 6, 13, 4, 5, 13, // aleta superior
    4, 11, 6, 5, 6, 12, // aletas laterales
  ];

  const body = buildFacetedMesh(verts, indices, 0xd0e8ff, 0xffffff);
  grp.add(body);

  // Retícula de alambre tenue: refuerza la lectura "papel / low poly".
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    wireframe: true,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  grp.add(new THREE.Mesh(body.geometry, wireMat));

  return grp;
}
