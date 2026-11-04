/**
 * PAPERCRASH — game/AircraftView.js
 * ============================================================
 * Representación visual de una aeronave.
 *
 * Responsabilidad única: mantener un Object3D sincronizado con un estado
 * de vuelo. NO conoce las reglas del juego, ni la puntuación, ni la UI.
 * Separar esto de la física es lo que permite testear el vuelo sin
 * navegador (ver tools/verify-physics.mjs).
 * ============================================================
 */
import { scene } from '../core/engine.js';
import { buildAircraftModel, disposeAircraftModel } from '../aircraft/index.js';
import { damp, clamp } from '../core/math.js';
import { CAMERA } from '../config.js';
import { cargarGLB, glbCacheado } from '../world/glbLoader.js';

export class AircraftView {
  constructor() {
    /** @type {THREE.Group|null} */
    this.root = null;
    /** @type {Array<{object:THREE.Object3D, axis:string, speed:number}>} */
    this.rotors = [];
    /** Ángulo visual actual del morro (rad). */
    this.pitch = 0;
  }

  /**
   * (Re)construye el modelo. Libera el anterior para no acumular GPU.
   * @param {string} type id de la ficha en physics/specs.js
   */
  setType(type) {
    /*
     * Se guarda el tipo pedido: la carga del .glb es asíncrona y puede terminar
     * después de que el jugador cambie de nave. Comparando contra este valor se
     * descarta el resultado viejo en vez de superponer dos modelos.
     */
    this.tipoActual = type;
    this.dispose();
    this.root = new THREE.Group();
    this.root.name = 'aircraft';

    const model = buildAircraftModel(type);
    this.root.add(model);

    // Los rotores vienen como metadatos del modelo: sin estado global.
    this.rotors = model.userData.rotors ?? [];

    scene.add(this.root);

    /*
     * ── Modelos de Meshy, por tipo de nave ──
     *
     * Cada tipo declara su modelo, escala, orientación hacia el frente (+X) y color.
     * El que no tiene uno o falla la carga usa la geometría procedural de respaldo.
     */
    const MODELOS = {
      paper: {
        ruta: 'assets/models/paper_chrome.glb',
        escala: 2.6,
        rotY: Math.PI / 2,
        color: 0xd0e8ff,
      },
      passenger: {
        ruta: 'assets/models/airliner_chrome.glb',
        escala: 3.4,
        rotY: Math.PI,
        color: 0xdce4ee,
      },
      jet: {
        ruta: 'assets/models/plane_chrome.glb',
        escala: 5.5,
        rotY: Math.PI,
        color: 0x2b3340,
      },
      heli: {
        ruta: 'assets/models/heli_chrome.glb',
        escala: 3.6,
        rotY: Math.PI,
        color: 0x3d4f3b,
        rotores: [
          {
            ruta: 'assets/models/heli_main_rotor_chrome.glb',
            pos: [-0.36, 0.42, 0],
            escala: 1.5,
            axis: 'y',
            speed: 32,
          },
          {
            ruta: 'assets/models/heli_tail_rotor_chrome.glb',
            pos: [0.92, 0.05, 0.08],
            escala: 0.45,
            axis: 'z',
            speed: 36,
          },
        ],
      },
    };
    const cfgModelo = MODELOS[type];
    if (!cfgModelo) return;
    const rutaModelo = cfgModelo.ruta;

    const tipoPedido = type;

    /**
     * Aplica el modelo ya descargado.
     *
     * @param {{geometria: THREE.BufferGeometry}} resultado
     */
    const aplicar = (resultado) => {
      // Si mientras tanto se cambió de nave, este resultado ya no sirve.
      if (tipoPedido !== this.tipoActual) return;
      /*
       * Sin `flatShading`: MeshLambertMaterial no lo soporta y tira un aviso por
       * consola en cada carga. El modelo ya viene facetado de origen.
       */
      const material = new THREE.MeshLambertMaterial({ color: cfgModelo.color });
      const contenedor = new THREE.Group();
      contenedor.name = 'aircraft-glb';
      contenedor.scale.setScalar(cfgModelo.escala);
      contenedor.rotation.y = cfgModelo.rotY;

      const malla = new THREE.Mesh(resultado.geometria, material);
      contenedor.add(malla);

      // Rotores separados (helicóptero): se montan sobre el contenedor y reemplazan los procedurales.
      if (cfgModelo.rotores) {
        const matRotor = new THREE.MeshLambertMaterial({ color: 0x1a1e1a });
        const nuevosRotores = [];
        for (const rCfg of cfgModelo.rotores) {
          const pivote = new THREE.Group();
          pivote.position.set(rCfg.pos[0], rCfg.pos[1], rCfg.pos[2]);
          contenedor.add(pivote);
          nuevosRotores.push({ object: pivote, axis: rCfg.axis, speed: rCfg.speed });

          const poblarRotor = (resRotor) => {
            if (!resRotor || tipoPedido !== this.tipoActual) return;
            const mRotor = new THREE.Mesh(resRotor.geometria, matRotor);
            mRotor.scale.setScalar(rCfg.escala);
            pivote.add(mRotor);
          };
          const cacheRotor = glbCacheado(rCfg.ruta);
          if (cacheRotor) poblarRotor(cacheRotor);
          else cargarGLB(rCfg.ruta).then(poblarRotor);
        }
        this.rotors = nuevosRotores;
      }

      model.visible = false;
      this.root.add(contenedor);
    };

    /*
     * ── Se aplica SÍNCRONO si ya está en caché ──
     *
     * ── El problema que esto arregla ──
     * Al equipar la nave se veía PRIMERO el modelo procedural y recién después el de
     * Meshy, porque el .glb se descargaba en ese momento. Con la precarga y esta
     * rama sincrónica, el modelo correcto aparece en el mismo frame: no hay cambiazo
     * ni un solo cuadro con la nave vieja.
     */
    const yaEsta = glbCacheado(rutaModelo);
    if (yaEsta) {
      aplicar(yaEsta);
      return;
    }

    /*
     * Si todavía no está, se oculta el procedural YA.
     *
     * Se prefiere un instante sin nave a un instante con la nave equivocada: la
     * primera se lee como carga, la segunda como error. Si la descarga falla, el
     * procedural vuelve.
     */
    model.visible = false;
    cargarGLB(rutaModelo).then((resultado) => {
      if (!resultado) {
        // Falló: se devuelve la geometría procedural.
        if (tipoPedido === this.tipoActual) model.visible = true;
        return;
      }
      aplicar(resultado);
    });
  }

  /** ¿Hay modelo construido? */
  get ready() {
    return this.root !== null;
  }

  /** Coloca el avión en la posición de carga sobre la resortera. */
  setLoadedPosition(offset) {
    if (!this.root) return;
    this.root.position.set(offset.x, offset.y, offset.z);
    this.root.rotation.set(0, 0, 0);
    this.root.scale.set(1, 1, 1);
    this.pitch = 0;
  }

  /**
   * Orienta el avión según un pitch/azimut deseados (fase de apuntado).
   * El morro se levanta según el pitch y el avión gira en guiñada según el
   * azimut, de forma que "se ve" hacia dónde va a salir.
   */
  aimAt(pitchDeg, azimuthDeg, pullStrength01) {
    if (!this.root) return;
    // -pitch porque en Three.js rotar en X positivo baja el morro (+X).
    this.root.rotation.x = -pitchDeg * (Math.PI / 180);
    this.root.rotation.y = -azimuthDeg * (Math.PI / 180);
    this.root.rotation.z = 0;
    const s = clamp(pullStrength01, 0, 1);
    this.root.scale.set(1 + s * 0.06, 1 - s * 0.10, 1 - s * 0.10);
  }

  /**
   * Sincroniza posición y actitud con el estado de vuelo.
   * @param {{x:number,y:number,z:number,vx:number,vy:number,vz:number}} state
   * @param {number} pitchRate  velocidad de alineación del morro (1/s)
   * @param {number} dt
   * @param {number} windZ      viento lateral, para el alabeo visual
   * @param {number} flightTime para la turbulencia
   */
  syncToFlight(state, pitchRate, dt, windZ, flightTime, speed) {
    if (!this.root) return;

    this.root.position.set(state.x, state.y, state.z);

    // El morro persigue la dirección del vector velocidad.
    const targetPitch = Math.atan2(state.vy, Math.hypot(state.vx, state.vz));
    this.pitch = damp(this.pitch, targetPitch, pitchRate, dt);

    const targetYaw = Math.atan2(state.vz, state.vx);

    this.root.rotation.x = this.pitch;
    this.root.rotation.y = damp(this.root.rotation.y, -targetYaw, pitchRate * 0.6, dt);

    // Alabeo: por viento lateral y por turbulencia (más notoria a baja velocidad).
    const wobble = Math.sin(flightTime * 8) * 0.015 / (1 + speed * 0.1);
    const targetRoll = clamp(windZ * CAMERA.WIND_ROLL, -0.5, 0.5) + wobble;
    this.root.rotation.z = damp(this.root.rotation.z, targetRoll, 6, dt);
  }

  setVisible(v) {
    if (this.root) this.root.visible = v;
  }

  /**
   * Avanza la animación de los rotores. Solo el helicóptero los declara,
   * así que para el resto es un no-op barato.
   */
  updateRotors(dt) {
    for (const r of this.rotors) {
      r.object.rotation[r.axis] += r.speed * dt;
    }
  }

  dispose() {
    if (!this.root) return;
    scene.remove(this.root);
    disposeAircraftModel(this.root);
    this.root = null;
    this.rotors = [];
    this.pitch = 0;
  }
}
