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
    this.dispose();
    this.root = new THREE.Group();
    this.root.name = 'aircraft';

    const model = buildAircraftModel(type);
    this.root.add(model);

    // Los rotores vienen como metadatos del modelo: sin estado global.
    this.rotors = model.userData.rotors ?? [];

    scene.add(this.root);
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
