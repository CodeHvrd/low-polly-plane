/**
 * PAPERCRASH — game/effects.js
 * ============================================================
 * Partículas y destellos: impacto, escombros, ráfaga de lanzamiento,
 * aros atravesados.
 *
 * ── Por qué hay un pool ──
 * La versión anterior creaba una `TetrahedronGeometry` NUEVA por cada
 * fragmento y la destruía a los pocos segundos. Un choque fuerte generaba
 * ~18 geometrías por impacto. Con el pool, la geometría se crea una sola
 * vez y se reutiliza: no hay asignaciones en el momento del impacto, que
 * es justo cuando el frame no debe titubear.
 *
 * El pool es genérico: cada partícula es una malla con una geometría
 * compartida, y lo único que cambia por instancia es la transformación y
 * el color (vía material por instancia, que sí se recicla).
 * ============================================================
 */
import { scene } from '../core/engine.js';
import { clamp } from '../core/math.js';

const GRAVITY = -9.8;

/** Forma base de los escombros: tetraedro facetado, acorde al low poly. */
function makeDebrisGeometry() {
  const geo = new THREE.TetrahedronGeometry(1, 0);
  geo.deleteAttribute('uv');
  return geo;
}

function makeParticleGeometry() {
  return new THREE.SphereGeometry(1, 4, 3);
}

/**
 * @typedef {Object} Particle
 * @property {THREE.Mesh} mesh
 * @property {{x:number,y:number,z:number}} vel
 * @property {{x:number,y:number,z:number}} angVel
 * @property {number} life @property {number} maxLife
 * @property {number} bounce
 * @property {number} drag
 * @property {number} size
 */

export class Effects {
  constructor() {
    this.debrisGeo = makeDebrisGeometry();
    this.particleGeo = makeParticleGeometry();

    /** @type {Particle[]} */
    this.active = [];
    /** @type {THREE.Mesh[]} */
    this.pool = [];
    /** @type {THREE.Mesh[]} */
    this.particlePool = [];

    /** @type {Array<{mesh:THREE.Mesh, life:number, maxLife:number, base:number}>} */
    this.flashes = [];

    this.buildFlashPool();
  }

  // ── Pools ─────────────────────────────────────────────────
  acquireDebris(color) {
    let mesh = this.pool.pop();
    if (!mesh) {
      const mat = new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide, transparent: true });
      mesh = new THREE.Mesh(this.debrisGeo, mat);
    }
    // El color va en el material (no por vértice): así se reutiliza la misma
    // geometría para todos los fragmentos y no hay que tocar buffers.
    const mat = mesh.material;
    mat.color.copy(color);
    mat.opacity = 1;
    mat.transparent = true;
    mesh.visible = true;
    scene.add(mesh);
    return mesh;
  }

  releaseDebris(mesh) {
    scene.remove(mesh);
    mesh.visible = false;
    this.pool.push(mesh);
  }

  acquireParticle(color) {
    let mesh = this.particlePool.pop();
    if (!mesh) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true });
      mesh = new THREE.Mesh(this.particleGeo, mat);
    }
    mesh.material.color.copy(color);
    mesh.material.opacity = 1;
    mesh.visible = true;
    scene.add(mesh);
    return mesh;
  }

  releaseParticle(mesh) {
    scene.remove(mesh);
    mesh.visible = false;
    this.particlePool.push(mesh);
  }

  buildFlashPool() {
    // Destellos: esferas aditivas que se expanden y se apagan.
    this.flashGeo = new THREE.SphereGeometry(1, 12, 8);
  }

  // ── Emisores ──────────────────────────────────────────────

  /**
   * Ráfaga de lanzamiento: empuje de partículas hacia atrás.
   */
  launchBurst(x, y, z, power01) {
    const count = Math.round(14 + power01 * 22);
    for (let i = 0; i < count; i++) {
      const color = new THREE.Color().setHSL(0.52, 1, 0.62 + Math.random() * 0.28);
      const mesh = this.acquireParticle(color);
      const size = 0.05 + Math.random() * 0.1;
      mesh.scale.setScalar(size);
      mesh.position.set(x, y, z);

      const spread = 0.5 + power01;
      this.active.push({
        mesh,
        vel: {
          x: -Math.random() * 4 * spread,
          y: Math.random() * 3 * spread,
          z: (Math.random() - 0.5) * 2.5 * spread,
        },
        angVel: { x: 0, y: 0, z: 0 },
        life: 0.45 + Math.random() * 0.5,
        maxLife: 0.95,
        bounce: 0,
        drag: 3.2,
        size,
      });
    }
    this.spawnFlash(x, y, z, 0.6 + power01, 0.3, 0x66e5ff);
  }

  /**
   * Choque: escombros con rebote + destello.
   */
  crash(x, y, z, speed) {
    this.emitDebris(x, y, z, speed, 1);
    this.spawnFlash(x, y, z, 0.9 + clamp(speed / 30, 0, 1), 0.32, 0xff5a22);
  }

  /** Impacto contra un obstáculo: escombros más "duros" y destello cian. */
  obstacleImpact(x, y, z, obstacle, speed) {
    this.emitDebris(x, y, z, speed, 1.15);
    this.spawnFlash(x, y, z, 0.7 + clamp(speed / 35, 0, 1), 0.26, 0xffc400);
    void obstacle;
  }

  /** Salida del corredor: sin escombros, solo un destello de aviso. */
  corridorExit(x, y, z) {
    this.spawnFlash(x, y, z, 1.0, 0.4, 0xff3355);
  }

  /** Nube de polvo del rebote. */
  bounceDust(x, y, z, strength01) {
    const count = Math.round(6 + strength01 * 14);
    for (let i = 0; i < count; i++) {
      const mesh = this.acquireParticle(new THREE.Color(0x6b6558));
      const size = 0.08 + Math.random() * 0.16;
      mesh.scale.setScalar(size);
      mesh.position.set(x, y + 0.1, z);
      this.active.push({
        mesh,
        vel: {
          x: (Math.random() - 0.5) * 3,
          y: Math.random() * 2.4,
          z: (Math.random() - 0.5) * 3,
        },
        angVel: { x: 0, y: 0, z: 0 },
        life: 0.4 + Math.random() * 0.5,
        maxLife: 0.9,
        bounce: 0,
        drag: 2.4,
        size,
      });
    }
  }

  /** Aro atravesado: anillo de chispas verdes/cian. */
  ringBurst(x, y, z) {
    for (let i = 0; i < 18; i++) {
      const color = new THREE.Color().setHSL(0.42 + Math.random() * 0.12, 1, 0.6);
      const mesh = this.acquireParticle(color);
      const size = 0.07 + Math.random() * 0.12;
      mesh.scale.setScalar(size);
      mesh.position.set(x, y, z);
      const a = (i / 18) * Math.PI * 2;
      const r = 1.6 + Math.random() * 1.2;
      this.active.push({
        mesh,
        vel: { x: 1.2, y: Math.cos(a) * r, z: Math.sin(a) * r },
        angVel: { x: 0, y: 0, z: 0 },
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.9,
        bounce: 0,
        drag: 1.4,
        size,
      });
    }
    this.spawnFlash(x, y, z, 1.1, 0.28, 0x66ffaa);
  }

  /**
   * Moneda recogida: chispas del color del valor y un destello.
   *
   * El color importa: es el único aviso de que se juntó una de 50 y no una de 5,
   * y el jugador está mirando al avión, no al marcador.
   *
   * @param {number} x @param {number} y @param {number} z
   * @param {number} value 5, 10 o 50
   */
  coinPop(x, y, z, value = 5) {
    const palette = { 5: 0xffb020, 10: 0x9be564, 50: 0xff4f8b };
    const color = palette[value] ?? palette[5];
    // Las de 50 explotan más: premio proporcional al riesgo de ir a buscarlas.
    const count = value >= 50 ? 22 : value >= 10 ? 12 : 8;

    for (let i = 0; i < count; i++) {
      const mesh = this.acquireParticle(new THREE.Color(color));
      const size = 0.06 + Math.random() * 0.1;
      mesh.scale.setScalar(size);
      mesh.position.set(x, y, z);
      this.active.push({
        mesh,
        vel: {
          x: -1 + Math.random() * 3,
          y: 1.5 + Math.random() * 3,
          z: (Math.random() - 0.5) * 4,
        },
        angVel: { x: Math.random() * 6, y: Math.random() * 6, z: 0 },
        life: 0.35 + Math.random() * 0.3,
        maxLife: 0.65,
        bounce: 0,
        drag: 2.0,
        size,
      });
    }
    this.spawnFlash(x, y, z, value >= 50 ? 1.3 : 0.8, 0.2, color);
  }

  /**
   * Booster recogido: estallido cian y un fogonazo grande.
   *
   * Tiene que sentirse como un empuje, porque además de las chispas el avión
   * acelera de verdad.
   *
   * @param {number} x @param {number} y @param {number} z
   */
  boosterBurst(x, y, z) {
    for (let i = 0; i < 26; i++) {
      const mesh = this.acquireParticle(new THREE.Color().setHSL(0.52, 1, 0.65));
      const size = 0.08 + Math.random() * 0.14;
      mesh.scale.setScalar(size);
      mesh.position.set(x, y, z);
      this.active.push({
        mesh,
        // Las chispas salen hacia ATRÁS, como el chorro de un motor.
        vel: {
          x: -6 - Math.random() * 8,
          y: (Math.random() - 0.5) * 5,
          z: (Math.random() - 0.5) * 5,
        },
        angVel: { x: 0, y: 0, z: 0 },
        life: 0.28 + Math.random() * 0.28,
        maxLife: 0.56,
        bounce: 0,
        drag: 1.1,
        size,
      });
    }
    this.spawnFlash(x, y, z, 2.0, 0.36, 0x00e5ff);
  }

  /**
   * @param {number} x @param {number} y @param {number} z
   * @param {number} speed
   * @param {number} intensity
   */
  emitDebris(x, y, z, speed, intensity) {
    const count = Math.round((8 + Math.random() * 8) * intensity);
    for (let i = 0; i < count; i++) {
      const c = new THREE.Color().lerpColors(
        new THREE.Color(0x9fb6d0),
        new THREE.Color(0xffffff),
        Math.random(),
      );
      const mesh = this.acquireDebris(c);
      const size = 0.06 + Math.random() * 0.22;
      mesh.scale.setScalar(size);
      mesh.position.set(x, y, z);
      mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);

      const burst = Math.min(14, speed * 0.35);
      this.active.push({
        mesh,
        vel: {
          x: -burst * Math.random() + 1.5,
          y: 2 + Math.random() * burst * 0.6,
          z: (Math.random() - 0.5) * burst,
        },
        angVel: {
          x: (Math.random() - 0.5) * 12,
          y: (Math.random() - 0.5) * 12,
          z: (Math.random() - 0.5) * 12,
        },
        life: 2.2 + Math.random() * 1.8,
        maxLife: 4,
        bounce: 0.3 + Math.random() * 0.35,
        drag: 0.35,
        size,
      });
    }
  }

  /** Destello expansivo (esfera aditiva que se apaga). */
  spawnFlash(x, y, z, radius, duration, color) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.flashGeo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.2);
    scene.add(mesh);
    this.flashes.push({ mesh, life: duration, maxLife: duration, base: radius });
  }

  // ── Actualización ─────────────────────────────────────────
  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.active.splice(i, 1);
        if (p.mesh.geometry === this.debrisGeo) this.releaseDebris(p.mesh);
        else this.releaseParticle(p.mesh);
        continue;
      }

      const damping = Math.exp(-p.drag * dt);
      p.vel.x *= damping;
      p.vel.z *= damping;
      p.vel.y = (p.vel.y + GRAVITY * dt) * damping;

      const m = p.mesh;
      m.position.x += p.vel.x * dt;
      m.position.y += p.vel.y * dt;
      m.position.z += p.vel.z * dt;

      if (m.position.y < 0.05) {
        m.position.y = 0.05;
        p.vel.y = Math.abs(p.vel.y) * p.bounce;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }

      m.rotation.x += p.angVel.x * dt;
      m.rotation.y += p.angVel.y * dt;
      m.rotation.z += p.angVel.z * dt;

      // Desvanecido en el último tercio de vida.
      const t = p.life / p.maxLife;
      m.material.opacity = t > 0.33 ? 1 : t / 0.33;
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        scene.remove(f.mesh);
        f.mesh.material.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      const t = 1 - f.life / f.maxLife;
      f.mesh.scale.setScalar(0.2 + t * f.base);
      f.mesh.material.opacity = (1 - t) * 0.75;
    }
  }

  /** Cantidad de partículas vivas (para el panel de diagnóstico). */
  get particleCount() {
    return this.active.length + this.flashes.length;
  }

  dispose() {
    for (const p of this.active) {
      if (p.mesh.geometry === this.debrisGeo) this.releaseDebris(p.mesh);
      else this.releaseParticle(p.mesh);
    }
    this.active.length = 0;
    for (const f of this.flashes) {
      scene.remove(f.mesh);
      f.mesh.material.dispose();
    }
    this.flashes.length = 0;
    for (const m of this.pool) m.material.dispose();
    for (const m of this.particlePool) m.material.dispose();
    this.pool.length = 0;
    this.particlePool.length = 0;
    this.debrisGeo.dispose();
    this.particleGeo.dispose();
    this.flashGeo.dispose();
  }
}
