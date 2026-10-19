/**
 * PAPERCRASH — game/trail.js
 * ============================================================
 * Estela de vuelo: la línea cian que deja el avión.
 *
 * Se usa un `Line` (no un `BufferGeometry` de puntos sueltos) para que la
 * estela sea continua. El buffer es de tamaño fijo y se reescribe en su
 * lugar: es lo que evita generar basura por frame.
 *
 * Los puntos se agregan solo si el avión se movió lo suficiente
 * (`TRAIL.MIN_SEGMENT`); sin ese umbral, a velocidad baja se acumulaban
 * cientos de puntos casi idénticos y la estela se veía como un borrón.
 * ============================================================
 */
import { scene } from '../core/engine.js';
import { TRAIL } from '../config.js';

export class Trail {
  constructor() {
    this.capacity = TRAIL.MAX_POINTS;
    this.positions = new Float32Array(this.capacity * 3);
    /** Cuántos puntos válidos hay (se dibujan desde 0 hasta count). */
    this.count = 0;
    this.last = { x: 0, y: 0, z: 0 };

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setDrawRange(0, 0);
    this.geometry = geo;

    this.material = new THREE.LineBasicMaterial({
      color: TRAIL.COLOR,
      transparent: true,
      opacity: TRAIL.OPACITY,
    });

    this.line = new THREE.Line(geo, this.material);
    this.line.frustumCulled = false;
    this.line.renderOrder = 2;
    scene.add(this.line);
  }

  /** Vacía la estela (al reiniciar o al lanzar). */
  clear() {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }

  /**
   * Agrega un punto si vale la pena.
   * @param {number} x @param {number} y @param {number} z
   */
  push(x, y, z) {
    if (this.count > 0) {
      const dx = x - this.last.x;
      const dy = y - this.last.y;
      const dz = z - this.last.z;
      if (dx * dx + dy * dy + dz * dz < TRAIL.MIN_SEGMENT * TRAIL.MIN_SEGMENT) return;
    }

    if (this.count >= this.capacity) this.shiftDown();

    const i = this.count * 3;
    this.positions[i] = x;
    this.positions[i + 1] = y;
    this.positions[i + 2] = z;
    this.count++;

    this.last = { x, y, z };
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count);
  }

  /**
   * Descarta el punto más viejo desplazando el buffer.
   * `copyWithin` es una operación nativa: mover 160 puntos así es mucho más
   * barato que reasignar un array nuevo cada vez.
   */
  shiftDown() {
    this.positions.copyWithin(0, 3);
    this.count--;
  }

  dispose() {
    scene.remove(this.line);
    this.geometry.dispose();
    this.material.dispose();
  }
}
