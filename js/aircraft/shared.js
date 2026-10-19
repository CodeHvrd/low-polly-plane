/**
 * PAPERCRASH — aircraft/shared.js
 * ============================================================
 * Helpers compartidos por los constructores de aeronaves.
 *
 * Regla del proyecto: TODOS los modelos se orientan con el morro hacia +X,
 * porque el vuelo avanza en +X. Así el mismo código de actitud (pitch) sirve
 * para las cuatro naves sin rotaciones de compensación por modelo.
 * ============================================================
 */

/** Materiales con `flatShading`, la firma visual low-poly del juego. */
export function lambert(color, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
}

/**
 * Aplica un tinte por vértice de abajo hacia arriba.
 * Da volumen a las piezas sin necesidad de texturas.
 */
export function tintVerticesByHeight(geo, colorLow, colorHigh) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color(colorLow);
  const high = new THREE.Color(colorHigh);
  const c = new THREE.Color();

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = maxY - minY || 1;

  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / span;
    c.copy(low).lerp(high, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.deleteAttribute('uv');
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/**
 * Construye una malla desde vértices + índices con color por vértice.
 * @param {number[]} verts   posiciones aplanadas xyz
 * @param {number[]} indices triángulos
 * @param {number|number[]} colorLow  color base (o array de colores por vértice)
 * @param {number} [colorHigh]
 */
export function buildFacetedMesh(verts, indices, colorLow, colorHigh) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);

  if (Array.isArray(colorLow)) {
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colorLow, 3));
  } else {
    tintVerticesByHeight(geo, colorLow, colorHigh ?? colorLow);
  }

  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

