/**
 * PAPERCRASH — game/slingshotBand.js
 * ============================================================
 * Banda elástica de la resortera: dos líneas que van de las horquillas
 * al avión mientras se carga el lanzamiento.
 *
 * Se separa del sistema de puntería porque es puro render: la puntería
 * decide DÓNDE está el avión, esto solo dibuja la goma que lo ata.
 * ============================================================
 */
import { scene } from '../core/engine.js';
import { PRONGS } from '../aircraft/launcher.js';

export class SlingshotBand {
  constructor() {
    const make = () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xff7700,
        transparent: true,
        opacity: 0.95,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      return line;
    };

    this.left = make();
    this.right = make();
  }

  /**
   * Actualiza la banda para que una las horquillas con el avión.
   * @param {{x:number,y:number,z:number}} planePos
   */
  update(planePos) {
    this.setLine(this.left, PRONGS.left, planePos);
    this.setLine(this.right, PRONGS.right, planePos);
  }

  setLine(line, from, to) {
    const attr = line.geometry.attributes.position;
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }

  setVisible(v) {
    this.left.visible = v;
    this.right.visible = v;
  }

  dispose() {
    for (const line of [this.left, this.right]) {
      scene.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    }
    this.left = null;
    this.right = null;
  }
}
