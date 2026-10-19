/**
 * PAPERCRASH — game/cameraRig.js
 * ============================================================
 * Cámara del juego, con dos vistas y transición REVERSIBLE entre ellas.
 *
 * ── Las dos etapas ──
 *
 *   STANDBY  : vista lateral de tres cuartos sobre la resortera. Es la que se
 *              ve al llegar: título, tienda e instrucciones a la vista.
 *   LAUNCH   : detrás del lanzador y algo más alta, mirando recto al corredor.
 *              Desde acá se apunta, se carga y se lanza, y se ve la línea
 *              punteada proyectarse hacia adelante.
 *
 * ── Por qué un tween y no un suavizado exponencial ──
 * El paso STANDBY → LAUNCH lo dispara el jugador (clic o Enter) y el inverso
 * también puede ocurrir (volver atrás). Con amortiguación exponencial el
 * movimiento se acerca al destino asintóticamente y queda un rato en un punto
 * intermedio; además, para volver atrás habría que rehacer la cuenta. Un
 * parámetro `blend` de 0 a 1 animado con `smoothstep` da ida y vuelta con el
 * mismo código, duración exacta y un aviso claro al terminar.
 *
 * La transición ocurre AL ENTRAR en modo lanzamiento, nunca al lanzar: cuando
 * el avión sale, la cámara ya está quieta detrás del lanzador y la vista pasa a
 * persecución.
 * ============================================================
 */
import { camera, onResize } from '../core/engine.js';
import { CAMERA } from '../config.js';
import { smoothstep, clamp01, clamp } from '../core/math.js';
import { PHASE } from './RunController.js';

export const CameraMode = {
  STANDBY: 'standby',
  LAUNCH: 'launch',
};

export class CameraRig {
  constructor() {
    this.target = new THREE.Vector3(CAMERA.STANDBY_TARGET.x, CAMERA.STANDBY_TARGET.y, CAMERA.STANDBY_TARGET.z);
    this.position = new THREE.Vector3(CAMERA.STANDBY_POS.x, CAMERA.STANDBY_POS.y, CAMERA.STANDBY_POS.z);

    /**
     * La `PerspectiveCamera` de Three.js. Se expone como propiedad para que
     * otros sistemas puedan consultarla sin importar el módulo de motor.
     */
    this.object = camera;

    /** @type {'standby'|'launch'} */
    this.mode = CameraMode.STANDBY;

    /**
     * 0 = completamente en STANDBY, 1 = completamente en LAUNCH.
     * Es la única fuente de verdad de la transición: la posición y el objetivo
     * se derivan de acá, así que ida y vuelta usan el mismo camino.
     */
    this.blend = 0;
    /** Hacia dónde va `blend`: 0 o 1. */
    this.targetBlend = 0;

    /**
     * Se dispara UNA vez al terminar una transición, con el modo alcanzado.
     * @type {((mode: string) => void)|null}
     */
    this.onTransitionEnd = null;

    // Vectores reutilizados: el bucle de cámara corre cada frame y no debe
    // generar basura (el recolector se nota como micro-tirones).
    this._desiredPos = new THREE.Vector3();
    this._desiredTarget = new THREE.Vector3();
    this._velDir = new THREE.Vector3();
    this._heightOffset = new THREE.Vector3();
    /** Dirección "detrás y arriba" del avión, donde se apoya la cámara. */
    this._back = new THREE.Vector3();
    /** Eje lateral del mundo, para calcular el alabeo. */
    this._right = new THREE.Vector3();

    camera.position.copy(this.position);
    camera.lookAt(this.target);

    // Un único listener de resize para toda la app (ver core/engine.js).
    onResize(() => this.applyAspect());
    this.applyAspect();
  }

  applyAspect() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  // ── Transición entre vistas ───────────────────────────────
  /**
   * Pide ir a un modo. Devuelve `false` si ya se está ahí o ya se va hacia ahí
   * (así quien llama puede evitar reiniciar una animación en curso).
   *
   * @param {'standby'|'launch'} mode
   * @param {((mode: string) => void)|null} [onDone]
   * @returns {boolean} true si arrancó una transición nueva
   */
  goTo(mode, onDone = null) {
    const goal = mode === CameraMode.LAUNCH ? 1 : 0;
    if (this.targetBlend === goal) return false;

    this.targetBlend = goal;
    this.mode = mode;
    this.onTransitionEnd = onDone ?? null;
    return true;
  }

  /** ¿Hay una transición en curso? */
  get isTransitioning() {
    return this.blend !== this.targetBlend;
  }

  /** ¿Llegó a la vista de lanzamiento? */
  get atLaunch() {
    return this.blend >= 1;
  }

  // ── Atajos sin animación ──────────────────────────────────
  /** Salta a STANDBY sin animar. */
  snapToAim() {
    this.mode = CameraMode.STANDBY;
    this.blend = 0;
    this.targetBlend = 0;
    this.onTransitionEnd = null;
    this.position.set(CAMERA.STANDBY_POS.x, CAMERA.STANDBY_POS.y, CAMERA.STANDBY_POS.z);
    this.target.set(CAMERA.STANDBY_TARGET.x, CAMERA.STANDBY_TARGET.y, CAMERA.STANDBY_TARGET.z);
    camera.position.copy(this.position);
    camera.lookAt(this.target);
  }

  /** Salta a LAUNCH sin animar. */
  snapToLaunch() {
    this.mode = CameraMode.LAUNCH;
    this.blend = 1;
    this.targetBlend = 1;
    this.onTransitionEnd = null;
    /*
     * ── En vertical la cámara de apuntado se aleja y sube ──
     *
     * ── Por qué ──
     * El campo horizontal en un teléfono vertical es de ~44° con el FOV tope, o
     * sea unos 40 m de ancho a 50 m de distancia. El corredor mide 140: desde la
     * posición de lanzamiento se veía sólo la franja central y el resto de los
     * obstáculos, monedas y boosters quedaba FUERA DE CUADRO.
     *
     * Eso se leía como "antes de lanzar no aparece nada". Aléjandose entra más
     * corredor y la vista de apuntado muestra el recorrido.
     */
    const aspecto = camera.aspect || 1;
    const vertical = aspecto < 1 ? Math.max(0.6, aspecto) : 1;
    const factor = 1 + (1 - vertical) * 1.3;

    this.position.set(
      CAMERA.LAUNCH_POS.x * factor,
      CAMERA.LAUNCH_POS.y * (1 + (factor - 1) * 0.35),
      CAMERA.LAUNCH_POS.z,
    );
    this.target.set(CAMERA.LAUNCH_TARGET.x, CAMERA.LAUNCH_TARGET.y, CAMERA.LAUNCH_TARGET.z);
    camera.position.copy(this.position);
    camera.lookAt(this.target);
  }

  /** Aplica la interpolación de `blend` a posición y objetivo. */
  _applyBlend() {
    const e = smoothstep(this.blend);
    this.position.set(
      CAMERA.STANDBY_POS.x + (CAMERA.LAUNCH_POS.x - CAMERA.STANDBY_POS.x) * e,
      CAMERA.STANDBY_POS.y + (CAMERA.LAUNCH_POS.y - CAMERA.STANDBY_POS.y) * e,
      CAMERA.STANDBY_POS.z + (CAMERA.LAUNCH_POS.z - CAMERA.STANDBY_POS.z) * e,
    );
    this.target.set(
      CAMERA.STANDBY_TARGET.x + (CAMERA.LAUNCH_TARGET.x - CAMERA.STANDBY_TARGET.x) * e,
      CAMERA.STANDBY_TARGET.y + (CAMERA.LAUNCH_TARGET.y - CAMERA.STANDBY_TARGET.y) * e,
      CAMERA.STANDBY_TARGET.z + (CAMERA.LAUNCH_TARGET.z - CAMERA.STANDBY_TARGET.z) * e,
    );
    camera.position.copy(this.position);
    camera.lookAt(this.target);
  }

  /** Avanza `blend` hacia `targetBlend` y avisa si terminó. */
  _advanceBlend(dt) {
    if (this.blend === this.targetBlend) return;

    const step = dt / Math.max(0.01, CAMERA.TRANSITION_TIME);
    const prev = this.blend;
    this.blend = this.targetBlend > prev
      ? clamp01(this.blend + step)
      : clamp01(this.blend - step);

    if (this.blend === this.targetBlend) {
      const cb = this.onTransitionEnd;
      this.onTransitionEnd = null;
      if (cb) cb(this.mode);
    }
  }

  // ── Bucle ─────────────────────────────────────────────────
  /**
   * @param {number} dt
   * @param {string} phase
   * @param {import('../physics/flightModel.js').FlightState} flight
   */
  update(dt, phase, flight) {
    const isFlying = phase === PHASE.FLYING || phase === PHASE.CRASHED;

    if (!isFlying) {
      // Quieto en la resortera: avanzar la transición, si hay alguna.
      this._advanceBlend(dt);
      this._applyBlend();
      return;
    }

    // ── Vista de persecución ──
    // Detrás del vector velocidad, con distancia y altura crecientes. Si había
    // una transición a medio camino se descarta: el avión ya está en el aire y
    // lo que importa es seguirlo.
    this.blend = 1;
    this.targetBlend = 1;
    this.onTransitionEnd = null;

    const speed = Math.hypot(flight.vx, flight.vy, flight.vz);
    this._velDir.set(flight.vx, flight.vy, flight.vz);
    if (this._velDir.lengthSq() < 1e-6) this._velDir.set(1, 0, 0);
    this._velDir.normalize();

    /*
     * Tercera persona sostenida: detrás del avión y por ENCIMA.
     *
     * El punto delicado es la altura. Si la cámara se coloca detrás del vector
     * velocidad sin más, cuando el avión baja el vector apunta al suelo y la
     * cámara se va con él: el vuelo se termina viendo desde abajo. Mezclando la
     * dirección de vuelo con el "arriba del mundo" se acompaña el movimiento
     * sin hundirse, así que ascenso y planeo se leen igual.
     */
    this._back.set(-this._velDir.x, -this._velDir.y * CAMERA.FOLLOW_VERTICAL_BLEND, -this._velDir.z);
    if (this._back.lengthSq() < 1e-4) this._back.set(-1, 0, 0); // vuelo vertical puro
    this._back.normalize();

    /*
     * ── En vertical la cámara se aleja y sube ──
     *
     * ── Por qué ──
     * En retrato el campo horizontal útil es mucho menor. Con la misma distancia
     * el avión aparece grande y abajo, y el corredor se lee como un pasillo
     * angosto: no se alcanza a ver qué viene.
     *
     * Alejar y subir achica el avión y corre el punto de interés a la franja
     * media, que es el espacio libre entre el HUD de arriba y los mandos de abajo.
     *
     * El factor sale del aspecto (ancho/alto): 1 = cuadrado, menos de 1 = vertical.
     * Se acota a 0.6 para que en pantallas muy alargadas no se vaya al infinito.
     */
    const aspecto = camera.aspect || 1;
    const vertical = aspecto < 1 ? Math.max(0.6, aspecto) : 1;
    /*
     * 1 en apaisado → ~1.6 en un teléfono vertical típico.
     *
     * Se subió de 1.35: en vertical el campo horizontal es muy angosto, así que
     * hay que compensar alejándose para que entre más corredor. Con 1.35 el avión
     * quedaba grande y el entorno se veía poco.
     */
    const factor = 1 + (1 - vertical) * 1.3;

    const behindDist = (CAMERA.FOLLOW_DIST + speed * CAMERA.FOLLOW_DIST_PER_SPEED) * factor;
    const heightOff = (CAMERA.FOLLOW_HEIGHT + speed * CAMERA.FOLLOW_HEIGHT_PER_SPEED) * factor;

    this._desiredTarget.set(flight.x, flight.y, flight.z);
    this._heightOffset.set(0, heightOff, 0);
    this._desiredPos
      .copy(this._desiredTarget)
      .addScaledVector(this._back, behindDist)
      .add(this._heightOffset);

    // Al despegar la cámara viene de la vista de lanzamiento, que está más
    // atrás: un suavizado algo más rápido los primeros metros evita que el
    // avión quede chico durante medio vuelo.
    const catchUp = speed < 6 ? CAMERA.FOLLOW_LERP * 1.6 : CAMERA.FOLLOW_LERP;
    this.position.lerp(this._desiredPos, 1 - Math.exp(-catchUp * dt));
    this.target.lerp(this._desiredTarget, 1 - Math.exp(-CAMERA.TARGET_LERP * dt));

    /*
     * La cámara nunca baja de `MIN_ABOVE` metros sobre el AVIÓN.
     *
     * Es el pedido de diseño: si la cámara sigue el vector velocidad sin más,
     * en un ascenso fuerte se queda por debajo del avión y el vuelo se ve desde
     * abajo.
     *
     * Se mide contra `flight.y` y no contra `this.target`: el objetivo está
     * amortiguado y en un ascenso rápido va retrasado, así que usarlo dejaba
     * pasar la cámara por debajo igual. Y se aplica DESPUÉS del suavizado,
     * porque en el despegue la cámara viene de la vista de lanzamiento —que
     * está más alta— y la interpolación hacia la posición de persecución la
     * hacía descender por debajo del avión.
     */
    const floor = Math.max(1.5, flight.y + CAMERA.FOLLOW_MIN_ABOVE);
    if (this.position.y < floor) this.position.y = floor;

    camera.position.copy(this.position);
    camera.lookAt(this.target);

    /*
     * Alabeo: el horizonte se inclina al girar.
     *
     * Es lo que termina de dar la sensación de tercera persona y hace visible
     * el viraje sin tener que mirar el HUD. Se calcula con la componente
     * lateral de la velocidad y se acota para que no maree.
     */
    this._right.set(1, 0, 0);
    const lateral = this._velDir.x * this._right.z - this._velDir.z * this._right.x;
    const roll = clamp(
      -lateral * CAMERA.FOLLOW_ROLL,
      -CAMERA.FOLLOW_ROLL_MAX,
      CAMERA.FOLLOW_ROLL_MAX,
    );
    camera.rotateZ(roll);
  }
}
