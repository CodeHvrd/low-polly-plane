/**
 * PAPERCRASH — game/RunController.js
 * ============================================================
 * CEREBRO DEL JUEGO. Máquina de estados de una partida y las reglas que
 * la gobiernan.
 *
 * ── Máquina de estados ──
 *
 *     IDLE ──drag/space──▶ AIMING ──soltar──▶ FLYING ──impacto──▶ CRASHED
 *       ▲                     │                                      │
 *       └──── reset ──────────┴──────────── reset ──────────────────┘
 *
 *   IDLE     : avión cargado, sin gesto. Acepta empezar a apuntar.
 *   AIMING   : hay un gesto activo. La puntería y la vista previa mandan.
 *   FLYING   : vuelo simulado. La entrada de apuntado está cerrada.
 *   CRASHED  : pantalla de resultados. Solo se acepta reiniciar.
 *
 * ── El bug que esto arregla ──
 * Antes, los listeners de `mousedown` y `keydown` estaban en `document`
 * sin comprobar la fase real. Al tocar "VOLAR DE NUEVO", el `mousedown`
 * atravesaba la pantalla de resultados (que seguía en el DOM durante el
 * retardo de 1.8 s), iniciaba un arrastre y, al soltar, lanzaba el avión;
 * el `mouseup` global volvía a disparar el lanzamiento. Y con Espacio
 * pasaba lo mismo en pleno arrastre.
 *
 * La solución no es "ocultar mejor" sino que TODA entrada pase por
 * `canAim()`, y que apuntar exija un gesto que empiece en IDLE.
 */

import { AIM, ECONOMY, LAUNCH_POS, SIM, WORLD, OBSTACLES, PICKUPS, PROPULSION, STAGES } from '../config.js';
import { clamp, round, distance2D } from '../core/math.js';
import {
  addGlideBudget,
  applyBoost,
  setControls,
  createState,
  velocityFromAim,
  paramsFromSpec,
  step as stepFlight,
  attitudeTarget,
} from '../physics/flightModel.js';
import { groundHeightAt } from '../world/terrainField.js';
import {
  findCollision,
  findRingsPassed,
  resetCourseState,
} from '../world/obstacles.js';
import { markRingPassed, resetRingVisuals } from '../world/obstacleMeshes.js';
import { collectAt, resetPickups } from '../world/collectibles.js';

/** Fases posibles de una partida. */
export const PHASE = {
  IDLE: 'idle',
  AIMING: 'aiming',
  FLYING: 'flying',
  CRASHED: 'crashed',
};

/** Radio de colisión del avión contra obstáculos (m). */
/**
 * Radio de colisión del avión.
 *
 * ── Por qué es más chico que el modelo ──
 * Se pidió poder ROSAR objetos sin morir, manteniendo la regla de que tocarlos sí
 * mata (nada de durabilidad ni rebotes). Achicar el radio del avión da ese margen
 * sin tocar la regla: lo que se ve como un roce no cuenta como impacto.
 *
 * 0.7 en vez de 0.85 deja ~15 cm de gracia por lado.
 */
const PLANE_RADIUS = 0.7;

/** Velocidad vertical por encima de la cual tocar el suelo es un choque. */
const HARD_LANDING_VY = 4.2;

const velScratch = { x: 0, y: 0, z: 0 };

/**
 * @typedef {Object} RunResult
 * @property {number} distance
 * @property {number} distanceZ
 * @property {number} maxAltitude
 * @property {number} maxSpeed
 * @property {number} time
 * @property {number} rings
 * @property {number} coins
 * @property {string} kind  'landing' | 'hard' | 'crash'
 * @property {string} cause 'ground' | 'obstacle' | 'corridor'
 */

/**
 * Suma (o resta, con delta negativo) combustible de vuelo.
 *
 * Es una función libre y no un método porque necesita el tope del modo, y
 * tenerla aparte deja claro que sólo toca ese campo.
 *
 * @param {RunController} ctrl
 * @param {number} delta segundos
 */
function addFuel(ctrl, delta) {
  if (!delta) return;
  ctrl.fuel = Math.max(0, Math.min(PROPULSION.FUEL_MAX, ctrl.fuel + delta));
}

export class RunController {
  /**
   * @param {Object} deps
   * @param {import('./AircraftView.js').AircraftView} deps.view
   * @param {import('./aiming.js').AimingSystem} deps.aiming
   * @param {import('./cameraRig.js').CameraRig} deps.cameraRig
   * @param {import('./trail.js').Trail} deps.trail
   * @param {import('./effects.js').Effects} deps.effects
   * @param {() => object} deps.getMods
   * @param {() => import('../physics/specs.js').FlightSpec} deps.getSpec
   * @param {Array} deps.obstacles
   * @param {(event:string, payload?:object) => void} deps.onEvent
   */
  constructor(deps) {
    this.view = deps.view;
    this.aiming = deps.aiming;
    this.cameraRig = deps.cameraRig;
    this.trail = deps.trail;
    this.effects = deps.effects;
    this.getMods = deps.getMods;
    /**
     * Lee los mandos del jugador. Se inyecta para que el controlador no dependa
     * del módulo de input: las pruebas pueden pasarle mandos falsos.
     * @type {() => {steer:number, nose:number, thrust:boolean}}
     */
    this.readControls = deps.readControls ?? (() => ({ steer: 0, nose: 0, thrust: false }));
    this.getSpec = deps.getSpec;
    this.obstacles = deps.obstacles;
    /** @type {import('../world/collectibles.js').Pickup[]} */
    this.pickups = deps.pickups ?? [];
    this.onEvent = deps.onEvent ?? (() => {});

    /** @type {'idle'|'aiming'|'flying'|'crashed'} */
    this.phase = PHASE.IDLE;

    /** Estado de vuelo. @type {ReturnType<typeof createState>} */
    this.flight = createState(LAUNCH_POS.y);
    /** Parámetros aerodinámicos congelados al lanzar. */
    this.params = paramsFromSpec(this.getSpec());

    // Estadísticas de la partida en curso.
    this.stats = this.blankStats();

    // Acumulador de tiempo fijo: la física no depende de los FPS.
    this.accumulator = 0;

    // Estado de la secuencia de impacto/aterrizaje.
    this.impact = null;
    this.impactDebug = null;
    this.lastPos = { x: 0, y: LAUNCH_POS.y, z: 0 };

    // Viento (se sortea por vuelo).
    this.wind = { x: 0, z: 0, timer: 0, nextChange: 4 };

    /*
     * Propulsión como HABILIDAD.
     *
     * Recoger un booster ya no empuja al avión: carga una unidad. El jugador
     * decide cuándo gastarla, y eso convierte al booster en una decisión táctica
     * (¿la uso para llegar a ese aro, o la guardo para el tramo difícil?) en vez
     * de un premio automático.
     */
    this.charges = 0;
    /**
     * Combustible de vuelo (s).
     *
     * En el CLÁSICO no se usa: el recurso es el planeo. En el FRENÉTICO es EL
     * recurso, y baja solo con el tiempo además de costar cada propulsión. Es lo
     * que obliga a encadenar boosters en vez de flotar.
     */
    this.fuel = 0;
    /** Enfriamiento restante entre usos (s). */
    this.thrustCooldown = 0;
    /** Cuántas propulsiones se usaron en el vuelo. */
    this.thrustsUsed = 0;
  }

  // ── Propulsión ────────────────────────────────────────────
  /**
   * ¿Se puede propulsar ahora?
   *
   * Además de tener cargas y no estar en enfriamiento, hace falta COMBUSTIBLE en
   * los modos que lo cobran. En el clásico el coste es 0, así que la condición
   * nunca bloquea.
   */
  canThrust() {
    if (this.phase !== PHASE.FLYING) return false;
    if (this.charges <= 0 || this.thrustCooldown > 0) return false;
    if (PROPULSION.FUEL_COST > 0 && this.fuel <= 0) return false;
    /*
     * No se encadena una propulsión sobre otra que sigue encendida.
     *
     * Las propulsiones no se apilan (no hay acumulación de empuje), así que
     * gastar una segunda carga durante la primera sólo desperdicia el booster.
     * Esperar a que termine el quemado es el intervalo natural entre usos, y
     * reemplaza a un enfriamiento arbitrario.
     */
    if (this.flight.burnTime > 0) return false;
    return true;
  }

  /**
   * Gasta una unidad y enciende la propulsión.
   *
   * El empujón vertical extra sale de la combinación con el morro arriba: es el
   * pedido explícito ("si usás la propulsión y tocás W te da un pequeño empujón
   * hacia arriba"). Después el avión sigue planeando con la velocidad que traía,
   * porque el empujón es un impulso y no un cambio de modo.
   *
   * @returns {boolean} true si se pudo usar
   */
  useThrust() {
    if (!this.canThrust()) return false;

    const cfg = PROPULSION;
    const launchSpeed = this.stats.launchSpeed || this.getSpec().baseSpeed;
    const accel = launchSpeed * cfg.THRUST;

    // El empujón vertical sólo si se está pidiendo subir el morro.
    const climbKick = this.flight.nose > 0 ? cfg.CLIMB_KICK * this.flight.nose : 0;

    applyBoost(this.flight, accel, cfg.BURN_TIME, climbKick);
    addGlideBudget(this.flight, cfg.GLIDE_BONUS, cfg.GLIDE_MAX);

    this.charges--;
    this.thrustsUsed++;
    this.thrustCooldown = cfg.COOLDOWN;

    // Tope de velocidad: encadenar propulsiones no debe sacar al avión del
    // corredor ni romper la lectura de la escena.
    const speed = this.clampSpeed();

    // Cada propulsión CUESTA combustible en el modo que lo usa: es lo que
    // convierte la habilidad en una decisión y no en un botón gratis.
    addFuel(this, -PROPULSION.FUEL_COST);

    this.effects.boosterBurst(this.flight.x, this.flight.y, this.flight.z);
    this.onEvent('thrust', {
      charges: this.charges,
      used: this.thrustsUsed,
      climbed: climbKick > 0,
      speed,
    });
    return true;
  }

  blankStats() {
    return {
      distance: 0,
      distanceZ: 0,
      maxAltitude: LAUNCH_POS.y,
      maxSpeed: 0,
      time: 0,
      rings: 0,
      pathLength: 0,
      bounces: 0,
      /** Monedas juntadas en el vuelo, ya sumando los valores (5/10/50). */
      coins: 0,
      /** Cuántas monedas se recogieron, sin importar el valor. */
      coinsCollected: 0,
      /** Boosters recogidos: cada uno carga una propulsión. */
      boosters: 0,
      /** Boosters AZULES recogidos: empujaron en el acto, no se guardaron. */
      instantBoosts: 0,
      /** Cargas de propulsión disponibles al terminar el vuelo. */
      charges: 0,
      /** Se intentó recoger un booster con el cargador lleno. */
      chargesFull: false,
      /** Propulsiones usadas en el vuelo. */
      thrustsUsed: 0,
      /** Velocidad que aportó el último booster (m/s), para el cartel de aviso. */
      boosterSpeed: 0,
      /**
       * Velocidad de lanzamiento de ESTE vuelo.
       *
       * La usan los boosters para calcular su empuje como un porcentaje de la
       * potencia inicial, en vez de un valor fijo.
       */
      launchSpeed: 0,
    };
  }

  // ── Consultas de fase ─────────────────────────────────────
  /**
   * ¿Se puede iniciar un gesto de apuntado?
   *
   * Es LA guarda que faltaba. Cualquier entrada nueva debe consultarla.
   * Solo se apunta desde IDLE: eso cierra la ventana en la que un clic
   * atravesaba la pantalla de resultados y relanzaba el avión.
   */
  canAim() {
    return this.phase === PHASE.IDLE;
  }

  /** ¿Se puede continuar un gesto ya empezado? */
  canContinueAim() {
    return this.phase === PHASE.AIMING;
  }

  /** ¿Se puede lanzar con el teclado? */
  canLaunchByKey() {
    // Nunca mientras se está arrastrando: apretar Espacio en pleno arrastre era
    // la otra mitad del bug reportado. Se mira `dragging` y no la fase, porque
    // la fase AIMING también cubre tener el avión cargado sin arrastrar, y ahí
    // sí se debe poder lanzar.
    return this.canAimEditable;
  }

  /**
   * ¿El gesto en curso llegó a arrastrar lo suficiente como para contar como
   * carga?
   *
   * Sirve para distinguir un CLIC SECO de un arrastre real. Se consulta antes
   * de `endAim()`, que es quien limpia el estado.
   */
  aimingWasDragged() {
    return this.aiming.totalPullPx >= AIM.DEADZONE_PX;
  }

  /** ¿Se puede reiniciar? */
  canReset() {
    return this.phase === PHASE.CRASHED;
  }

  /**
   * ¿Se puede interactuar con la puntería: cambiar de etapa, lanzar con el
   * teclado, elegir nave?
   *
   * La condición real es "no se está volando y no hay un gesto en curso". Es lo
   * que permite la secuencia pedida —Enter entra en modo lanzamiento y Enter
   * otra vez lanza— sin que un Espacio en pleno arrastre dispare nada.
   */
  get canAimEditable() {
    if (this.phase === PHASE.FLYING || this.phase === PHASE.CRASHED) return false;
    return !this.aiming.dragging;
  }

  // ── Ciclo de partida ──────────────────────────────────────
  /** Prepara una partida nueva. */
  reset() {
    this.phase = PHASE.IDLE;
    // La munición de propulsión no se hereda entre vuelos: cada lanzamiento
    // arranca sin cargas y hay que ganarlas juntando boosters.
    this.charges = 0;
    this.thrustCooldown = 0;
    this.thrustsUsed = 0;
    this.stats = this.blankStats();
    this.accumulator = 0;
    this.impact = null;
    this.flight = createState(LAUNCH_POS.y);

    this.aiming.reset();
    this.trail.clear();
    resetCourseState(this.obstacles);
    resetRingVisuals();
    resetPickups(this.pickups);

    this.view.setVisible(true);
    this.view.setLoadedPosition({ x: LAUNCH_POS.x, y: LAUNCH_POS.y, z: LAUNCH_POS.z });

    this.onEvent('phase', { phase: this.phase });
    return this;
  }

  /**
   * Inicia el apuntado desde una posición de pantalla.
   *
   * Si ya se está apuntando, REANCLA el origen del arrastre en vez de
   * rechazar la llamada. Es intencional: permite "reajustar" la puntería sin
   * soltar y hace la operación idempotente respecto de la fase.
   */
  beginAim(x, y) {
    if (!this.canAim() && !this.canContinueAim()) return false;
    this.phase = PHASE.AIMING;
    this.aiming.begin(x, y);
    this.aiming.setPreviewEnabled(true);
    this.onEvent('phase', { phase: this.phase });
    return true;
  }

  /** Actualiza el apuntado en curso. */
  updateAim(x, y) {
    if (!this.canContinueAim()) return false;
    this.aiming.move(x, y);
    return true;
  }

  /** Suelta el gesto. Lanza si hubo arrastre suficiente. */
  endAim() {
    if (!this.canContinueAim()) {
      this.aiming.cancel();
      return false;
    }
    this.aiming.setPreviewEnabled(false);
    const { shouldLaunch } = this.aiming.end();
    if (shouldLaunch) {
      this.launch();
      return true;
    }
    // Gesto demasiado corto: no se lanza, se vuelve a IDLE.
    this.phase = PHASE.IDLE;
    this.view.setLoadedPosition({ x: LAUNCH_POS.x, y: LAUNCH_POS.y, z: LAUNCH_POS.z });
    this.onEvent('phase', { phase: this.phase });
    return false;
  }

  /** Cancela el apuntado sin lanzar. */
  cancelAim() {
    if (!this.canContinueAim()) return false;
    this.aiming.setPreviewEnabled(false);
    this.aiming.cancel();
    this.phase = PHASE.IDLE;
    this.view.setLoadedPosition({ x: LAUNCH_POS.x, y: LAUNCH_POS.y, z: LAUNCH_POS.z });
    this.onEvent('phase', { phase: this.phase });
    return true;
  }

  /** Lanza el avión con la puntería actual. */
  launch() {
    if (this.phase === PHASE.FLYING) return false;

    const spec = this.getSpec();
    const mods = this.getMods();
    const { pitchDeg, azimuthDeg, speed } = this.aiming.state;

    // Parámetros congelados: las mejoras no pueden cambiar a mitad de vuelo.
    this.params = paramsFromSpec(spec, mods);
    this.rollWind();

    velocityFromAim(pitchDeg, azimuthDeg, speed, velScratch);
    const s = this.flight;
    s.x = LAUNCH_POS.x;
    s.y = LAUNCH_POS.y;
    s.z = LAUNCH_POS.z;
    s.vx = velScratch.x;
    s.vy = velScratch.y;
    s.vz = velScratch.z;
    s.time = 0;
    s.maxAltitude = LAUNCH_POS.y;
    s.maxSpeed = speed;
    s.landed = false;

    this.lastPos = { x: s.x, y: s.y, z: s.z };
    this.stats = this.blankStats();
    this.stats.maxSpeed = speed;
    /*
     * La velocidad de lanzamiento se guarda porque los boosters calculan su
     * empuje como un porcentaje de ELLA, no como un valor fijo. Así un booster
     * sigue pesando lo mismo después de comprar mejoras.
     */
    this.stats.launchSpeed = speed;
    /*
     * Y se carga el presupuesto de planeo inicial: el "tanque" que los boosters
     * van a recargar. Sin esto el avión no podría planear nunca.
     */
    addGlideBudget(s, PROPULSION.BASE_GLIDE, PROPULSION.GLIDE_MAX);
    /*
     * La munición arranca VACÍA: la propulsión se gana juntando boosters. Si
     * arrancara con cargas, el jugador podría gastarlas antes de entender para
     * qué sirven y la mecánica perdería su valor.
     */
    this.charges = 0;
    this.thrustCooldown = 0;
    this.thrustsUsed = 0;
    this.fuel = PROPULSION.FUEL_MAX;
    this.accumulator = 0;
    this.impact = null;

    this.phase = PHASE.FLYING;
    this.trail.clear();
    this.effects.launchBurst(LAUNCH_POS.x, LAUNCH_POS.y, LAUNCH_POS.z, this.aiming.state.power01);

    this.onEvent('launch', {
      spec,
      pitchDeg,
      azimuthDeg,
      speed,
      power01: this.aiming.state.power01,
    });
    this.onEvent('phase', { phase: this.phase });
    return true;
  }

  // ── Viento ────────────────────────────────────────────────
  /**
   * Sortea el viento del vuelo. Se usa un sesgo hacia el centro del
   * corredor para que el viento lateral empuje "de vuelta" en promedio:
   * un empuje siempre hacia afuera haría el juego injusto.
   */
  rollWind() {
    this.wind.x = (Math.random() - 0.5) * 1.6;
    this.wind.z = (Math.random() - 0.5) * 1.8;
    this.wind.timer = 0;
    this.wind.nextChange = 3 + Math.random() * 4;
  }

  updateWind(dt) {
    this.wind.timer += dt;
    if (this.wind.timer < this.wind.nextChange) return;
    this.wind.timer = 0;
    this.wind.nextChange = 3 + Math.random() * 4;
    this.wind.x = clamp(this.wind.x + (Math.random() - 0.5) * 1.4, -3.5, 3.5);
    this.wind.z = clamp(this.wind.z + (Math.random() - 0.5) * 1.6, -4, 4);
  }

  // ── Bucle ─────────────────────────────────────────────────
  /**
   * @param {number} dt segundos reales
   */
  update(dt) {
    this.view.updateRotors(dt);

    if (this.phase === PHASE.AIMING || this.phase === PHASE.IDLE) {
      this.updateAimPresentation();
    }

    if (this.phase === PHASE.FLYING) {
      this.updateFlight(dt);
    } else if (this.phase === PHASE.CRASHED) {
      this.updateImpactSequence(dt);
    }

    this.cameraRig.update(dt, this.phase, this.flight);
  }

  /** Coloca el avión en la posición de carga mientras se apunta. */
  updateAimPresentation() {
    const aim = this.aiming.state;
    const off = aim.offset;
    const pos = {
      x: LAUNCH_POS.x + (this.phase === PHASE.AIMING ? off.x : 0),
      y: LAUNCH_POS.y + (this.phase === PHASE.AIMING ? off.y : 0),
      z: LAUNCH_POS.z + (this.phase === PHASE.AIMING ? off.z : 0),
    };
    if (this.phase === PHASE.AIMING) {
      this.view.root?.position.set(pos.x, pos.y, pos.z);
      this.view.aimAt(aim.pitchDeg, aim.azimuthDeg, aim.power01);
    }
  }

  updateFlight(dt) {
    // ── Paso fijo con acumulador ──
    // La física avanza en incrementos constantes para que un frame lento no
    // cambie el resultado del vuelo. El viento se actualiza una vez por frame.
    this.updateWind(dt);

    /*
     * Mandos del jugador, una vez por frame.
     *
     * Van acá y no dentro del sub-paso porque son entradas: el teclado no cambia
     * entre sub-pasos, así que leerlo una vez alcanza y evita consultar el estado
     * del input cientos de veces por frame.
     */
    const controls = this.readControls();
    setControls(this.flight, controls.steer, controls.nose);
    /*
     * La propulsión NO se dispara acá.
     *
     * ── El bug que esto evita ──
     * `controls.thrust` es un ESTADO (la tecla está apretada), así que
     * comprobarlo una vez por frame significaba que mantener Espacio gastaba una
     * carga apenas se cumplía el enfriamiento. El jugador apretaba una vez y
     * perdía dos o tres boosters sin querer.
     *
     * Ahora la propulsión la dispara el FLANCO de la tecla, desde el manejador
     * de teclado (`Game`), que además ignora el auto-repeat. Una pulsación, un
     * uso.
     */
    if (this.thrustCooldown > 0) this.thrustCooldown = Math.max(0, this.thrustCooldown - dt);

    /*
     * Combustible: baja con el tiempo.
     *
     * Cuando se termina, el avión PIERDE el motor: deja de poder propulsarse y
     * el planeo se agota. No se termina el vuelo de golpe porque el avión todavía
     * puede llegar a un booster de emergencia y remontar; eso es exactamente la
     * situación que ese booster existe para resolver.
     */
    if (this.fuel > 0) this.fuel = Math.max(0, this.fuel - dt);

    this.params.windX = this.wind.x;
    this.params.windZ = this.wind.z;

    this.accumulator = Math.min(this.accumulator + dt, SIM.MAX_FRAME_DT);
    let steps = 0;
    let collided = null;
    let corridorExit = false;
    /** @type {Array} */
    const ringsHit = [];
    /** @type {Array} */
    const collected = [];

    while (this.accumulator >= SIM.FIXED_DT && steps < SIM.MAX_SUBSTEPS) {
      const prevX = this.flight.x;
      const prevZ = this.flight.z;

      stepFlight(this.flight, this.params, SIM.FIXED_DT);
      steps++;
      this.accumulator -= SIM.FIXED_DT;

      const s = this.flight;

      // Longitud real de la trayectoria (no solo el avance en X).
      this.stats.pathLength += distance2D(prevX, prevZ, s.x, s.z);
      this.stats.time += SIM.FIXED_DT;
      this.stats.distance = s.x;
      this.stats.distanceZ = s.z;
      if (s.y > this.stats.maxAltitude) this.stats.maxAltitude = s.y;

      // Aros atravesados (se comprueba el cruce del plano, no la permanencia).
      const passed = findRingsPassed(this.obstacles, prevX, s.x, s.y, s.z, PLANE_RADIUS);
      for (const ob of passed) {
        this.stats.rings++;
        ringsHit.push(ob);

        /*
         * ── Cada N aros, empuje de verdad ──
         *
         * ── Por qué acá y no en un evento aparte ──
         * Se aplica DENTRO del sub-paso, como el booster instantáneo: el empuje
         * tiene que sentirse en el mismo instante en que se cruza el aro, no un
         * frame después.
         */
        const combo = PICKUPS.BOOSTERS.RING_COMBO;
        if (this.stats.rings % combo.EVERY === 0) {
          const launchSpeed = this.stats.launchSpeed || this.getSpec().baseSpeed;
          applyBoost(this.flight, launchSpeed * combo.SPEED_FRACTION, combo.BURN_TIME, 0);
          this.clampSpeed(combo.MAX_SPEED);
          addGlideBudget(this.flight, combo.GLIDE_BONUS, PROPULSION.GLIDE_MAX);
          this.stats.ringCombos = (this.stats.ringCombos ?? 0) + 1;
          this.onEvent('ringCombo', { total: this.stats.rings, x: s.x, y: s.y, z: s.z });
        }
      }

      /*
       * ── VENDAVAL: corriente ascendente ──
       *
       * ── Por qué existe ──
       * En el circuito rasante los aros están a 5-12 m del suelo. Para pasarlos hay
       * que picar, y después no queda aceleración para volver a subir: el jugador
       * quedaba atrapado abajo hasta estrellarse contra el terreno.
       *
       * Dentro de la columna se aplica sustentación vertical y un empujón CHICO
       * (5% de la velocidad de lanzamiento, contra el 16% del celeste): alcanza
       * para remontar 10-15 m y enganchar algo en la subida, sin regalar la run.
       */
      for (const u of this.obstacles) {
        if (u.type !== 'updraft') continue;
        const r = u.params?.radius ?? 7;
        if (Math.abs(s.x - u.x) > r || Math.abs(s.z - u.z) > r) continue;
        const alto = u.params?.height ?? 40;
        const base = u.params?.baseY ?? 0;
        if (s.y > base + alto) continue;

        // Vista como aceleración con tope: sube parejo y no sale disparado.
        if (s.vy < PICKUPS.UPDRAFT.LIFT_MAX) {
          s.vy = Math.min(PICKUPS.UPDRAFT.LIFT_MAX, s.vy + PICKUPS.UPDRAFT.LIFT * SIM.FIXED_DT);
        }
        /*
         * El empujón horizontal se aplica UNA sola vez al entrar, no en cada paso:
         * si se aplicara continuo, quedarse dentro de la columna aceleraría sin
         * límite y rompería el balance.
         */
        if (!u._empujado) {
          u._empujado = true;
          applyBoost(s, this.stats.launchSpeed * PICKUPS.UPDRAFT.SPEED_BONUS, 0, 0);
          addGlideBudget(s, PROPULSION.BASE_GLIDE * 0.3, PROPULSION.GLIDE_MAX);
        }
      }

      // Obstáculos.
      const hit = findCollision(this.obstacles, s.x, s.y, s.z, PLANE_RADIUS);
      if (hit) {
        collided = hit;
        break;
      }

      /*
       * Recolectables.
       *
       * Se comprueban DENTRO del bucle de sub-pasos y no una vez por frame: a
       * 30 m/s un frame son 0.5 m, pero el radio de recolección es de 2.7 m y el
       * avión puede pasar cerca de una moneda en diagonal. Comprobar por frame
       * dejaba recolecciones al azar según los FPS.
       */
      const picked = collectAt(this.pickups, s.x, s.y, s.z);
      if (picked) {
        if (picked.kind === 'coin') {
          this.stats.coins += picked.value;
          this.stats.coinsCollected++;
        } else {
          this.collectBooster(picked);
        }
        collected.push(picked);
      }

      // Suelo.
      const groundY = OBSTACLES.TERRAIN_COLLISION ? groundHeightAt(s.x, s.z) : 0;
      if (s.y <= groundY) {
        s.y = groundY;
        this.beginImpact('ground', groundY, collided);
        break;
      }

      // Salida del corredor lateral.
      if (Math.abs(s.z) > WORLD.COURSE_HALF_WIDTH) {
        corridorExit = true;
        break;
      }

      // Tope de duración: cierra el vuelo si algo lo dejara planeando.
      if (this.stats.time > SIM.MAX_FLIGHT_TIME) {
        /*
         * ── Motivo propio, no 'ground' ──
         *
         * Se reportaba como choque contra el suelo estando el avión a 28 m de
         * altura: el jugador veía explotar el avión "contra algo invisible".
         *
         * Con un motivo propio el diagnóstico dice la verdad y, si vuelve a
         * pasar, se sabe de inmediato que fue el límite de tiempo.
         */
        this.beginImpact('timeout', s.y, null);
        break;
      }
    }

    for (const ob of ringsHit) {
      markRingPassed(ob);
      this.effects.ringBurst(ob.x, ob.params.centerY, ob.z);
      this.onEvent('ring', { obstacle: ob, total: this.stats.rings });
    }

    for (const p of collected) {
      this.onEvent(p.kind === 'coin' ? 'coin' : 'booster', {
        pickup: p,
        value: p.value,
        coins: this.stats.coins,
        boosters: this.stats.boosters,
        glideBudget: this.flight.glideBudget,
      });
    }

    if (collided) {
      this.beginImpact('obstacle', this.flight.y, collided);
    } else if (corridorExit) {
      this.beginImpact('corridor', this.flight.y, null);
    }

    // Presentación del vuelo.
    const speed = Math.hypot(this.flight.vx, this.flight.vy, this.flight.vz);
    this.view.syncToFlight(this.flight, this.getSpec().pitchRate, dt, this.wind.z, this.stats.time, speed);
    this.trail.push(this.flight.x, this.flight.y, this.flight.z);
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, speed);

    this.stats.charges = this.charges;
    this.stats.thrustsUsed = this.thrustsUsed;
    this.onEvent('flight', {
      state: this.flight,
      stats: this.stats,
      speed,
      wind: this.wind,
      charges: this.charges,
      fuel: this.fuel,
      fuelMax: PROPULSION.FUEL_MAX,
      stage: Math.floor(this.flight.x / STAGES.SEGMENT_LENGTH),
    });
  }

  /**
   * Recoge un booster: CARGA una unidad de propulsión.
   *
   * ── Qué cambió ──
   * Antes el booster empujaba al avión en el acto. Ahora sólo carga, y el
   * jugador decide cuándo gastar la propulsión apretando Espacio. Se pidió así
   * explícitamente: "el cargador de booster te tiene que dejar usarlo cuando
   * desees y sentir esa propulsión".
   *
   * Además recarga un poco el planeo al recogerse: sin eso, llegar a un booster
   * con el presupuesto agotado no serviría de nada, porque el avión ya estaría
   * cayendo antes de poder gastar la carga.
   *
   * @param {import('../world/collectibles.js').Booster} booster
   */
  collectBooster(booster) {
    const cfg = PROPULSION;
    const kind = booster.boosterKind ?? 'booster';

    this.stats.boosters++;
    this.effects.boosterBurst(booster.x, booster.y, booster.z);

    /*
     * ── AZUL: empuja AHORA ──
     *
     * No se guarda nada. El premio por volar pegado a las cosas es inmediato, y
     * eso es lo que le da el ritmo al modo frenético: no hay que decidir cuándo
     * usarlo, ya está usado.
     */
    if (kind === 'instant') {
      const launchSpeed = this.stats.launchSpeed || this.getSpec().baseSpeed;
      const accel = launchSpeed * PICKUPS.BOOSTERS.SPEED_FRACTION;
    /*
     * ── Morro arriba + recoger un booster = SUBIR ──
     *
     * ── El bug que esto arregla ──
     * Acá el empuje vertical estaba fijo en 0, así que recoger un booster daba
     * velocidad pero nada de altura, aunque el jugador estuviera apretando ▲.
     * El botón de propulsión sí lo aplicaba; este camino no.
     *
     * Misma regla que el botón, para que las dos formas de propulsar se sientan
     * iguales.
     */
    const climbKick = this.flight.nose > 0 ? cfg.CLIMB_KICK * this.flight.nose : 0;
    applyBoost(this.flight, accel, cfg.BURN_TIME, climbKick);
      this.clampSpeed();
      addGlideBudget(this.flight, cfg.GLIDE_BONUS, cfg.GLIDE_MAX);
      addFuel(this, cfg.FUEL_REFILL);
      this.stats.instantBoosts++;
      this.onEvent('instant', { speed: this.currentSpeed(), x: booster.x, y: booster.y, z: booster.z });
      return;
    }

    /*
     * ── VIOLETA y ÁMBAR: se guardan ──
     *
     * Cuestan una decisión: el jugador elige cuándo gastarlos. El ámbar
     * (emergencia) repone más combustible que el violeta, porque aparece
     * justamente cuando el vuelo se está quedando sin margen.
     */
    const gained = this.charges < cfg.MAX_CHARGES;
    if (gained) this.charges++;
    addGlideBudget(this.flight, cfg.GLIDE_BONUS, cfg.GLIDE_MAX);
    addFuel(this, kind === 'emergency' ? cfg.FUEL_REFILL * 1.6 : cfg.FUEL_REFILL);

    this.stats.charges = this.charges;
    // Si ya estaba lleno, se avisa para que el jugador entienda por qué no sube.
    this.stats.chargesFull = !gained;

    this.onEvent('charge', { charges: this.charges, full: !gained, kind });
  }

  /** Velocidad actual del avión (m/s). */
  currentSpeed() {
    const s = this.flight;
    return Math.hypot(s.vx, s.vy, s.vz);
  }

  /**
   * Recorta la velocidad al tope del modo.
   *
   * Encadenar boosters azules no debe sacar al avión del corredor ni romper la
   * lectura de la escena.
   */
  /**
   * Recorta la velocidad al tope.
   *
   * @param {number} [tope]  tope alternativo (el combo de aros usa uno más alto)
   */
  clampSpeed(tope = PROPULSION.MAX_SPEED) {
    const max = tope;
    const speed = this.currentSpeed();
    if (speed <= max) return speed;
    const k = max / speed;
    this.flight.vx *= k;
    this.flight.vy *= k;
    this.flight.vz *= k;
    return max;
  }

  /**
   * Arranca la secuencia de impacto.
   * @param {'ground'|'obstacle'|'corridor'} cause
   * @param {number} groundY
   * @param {object|null} obstacle
   */
  /**
   * Diagnóstico del impacto, para el atajo de depuración (tecla O).
   *
   * ── Por qué hace falta ──
   * Se reportaron choques contra "algo invisible" a partir de los 3000 m, pero
   * una captura no alcanza: la pantalla de derrota tapa la escena y, aunque no la
   * tapara, no se distingue contra qué se chocó.
   *
   * Guardar el tipo de obstáculo, su posición y la del avión convierte "chocué con
   * algo" en un dato concreto que se puede reproducir.
   *
   * @param {string} cause @param {object|null} obstacle @param {object} pos
   */
  setImpactDebug(cause, obstacle, pos) {
    this.impactDebug = {
      cause,
      type: obstacle?.type ?? null,
      ox: obstacle ? +obstacle.x.toFixed(1) : null,
      oy: obstacle?.aabb ? +((obstacle.aabb.minY + obstacle.aabb.maxY) / 2).toFixed(1) : null,
      oz: obstacle ? +obstacle.z.toFixed(1) : null,
      px: +pos.x.toFixed(1),
      py: +pos.y.toFixed(1),
      pz: +pos.z.toFixed(1),
      topY: obstacle?.aabb ? +obstacle.aabb.maxY.toFixed(1) : null,
    };
  }

  beginImpact(cause, groundY, obstacle) {
    /*
     * Diagnóstico del impacto, siempre y sin depender de cada llamador.
     *
     * Se hace acá y no en cada sitio de llamada porque hay CUATRO motivos de
     * impacto (suelo, obstáculo, corredor, tiempo) y olvidarse uno dejaba el
     * diagnóstico vacío justo en el caso que se quería investigar.
     */
    this.setImpactDebug(cause, obstacle, this.flight);
    const s = this.flight;
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    const vertical = Math.abs(s.vy);

    const mods = this.getMods();
    const canBounce = mods.bounceMult > 0
      && this.stats.bounces < Math.floor(mods.bounceMult * 8)
      && vertical > 1.5
      && cause === 'ground';

    if (canBounce) {
      // Rebote: sigue volando, pierde energía. Da valor real a la mejora.
      this.stats.bounces++;
      s.y = groundY + 0.12;
      s.vy = vertical * (0.35 + mods.bounceMult);
      s.vx *= 0.65;
      s.vz *= 0.65;
      this.effects.bounceDust(s.x, groundY, s.z, clamp(vertical / 12, 0, 1));
      this.onEvent('bounce', { count: this.stats.bounces, speed: vertical, mods });
      return;
    }

    // Aterrizaje suave si llega plano y no golpeó un obstáculo.
    const soft = cause === 'ground' && vertical < HARD_LANDING_VY;
    const kind = cause === 'corridor'
      ? 'crash'
      : soft
        ? 'landing'
        : 'crash';

    this.impact = {
      cause,
      kind,
      severity: clamp(speed / 30, 0, 1.4),
      // El avión se desliza hasta detenerse: es la "cola" visual del aterrizaje.
      slide: soft ? { vx: s.vx * 0.35, vz: s.vz * 0.35, t: 0 } : null,
      groundY,
    };

    s.vx = this.impact.slide ? this.impact.slide.vx : 0;
    s.vz = this.impact.slide ? this.impact.slide.vz : 0;
    s.vy = 0;
    s.y = groundY;

    this.phase = PHASE.CRASHED;

    if (cause === 'obstacle') {
      this.effects.obstacleImpact(s.x, s.y, s.z, obstacle, speed);
      this.view.setVisible(true);
    } else if (cause === 'corridor') {
      this.effects.corridorExit(s.x, s.y, s.z);
      this.view.setVisible(false);
    } else if (kind === 'crash') {
      this.effects.crash(s.x, s.y, s.z, speed);
      this.view.setVisible(false);
    } else {
      this.effects.bounceDust(s.x, groundY, s.z, 0.4);
    }

    this.onEvent('impact', {
      cause,
      kind,
      speed,
      state: s,
      stats: this.stats,
      obstacle,
    });
  }

  /** Deslizamiento final hasta detenerse. */
  updateImpactSequence(dt) {
    const imp = this.impact;
    if (!imp || !imp.slide) return;

    imp.slide.t += dt;
    const s = this.flight;
    // Rozamiento: decaimiento exponencial, se detiene solo.
    const decay = Math.exp(-4.5 * dt);
    imp.slide.vx *= decay;
    imp.slide.vz *= decay;
    s.vx = imp.slide.vx;
    s.vz = imp.slide.vz;
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    s.y = imp.groundY;

    this.stats.distance = Math.max(this.stats.distance, s.x);
    this.view.syncToFlight(s, 6, dt, 0, this.stats.time, Math.hypot(s.vx, s.vz));
    this.trail.push(s.x, s.y, s.z);

    if (Math.hypot(imp.slide.vx, imp.slide.vz) < 0.35) {
      imp.slide = null;
    }
  }

  // ── Resultado ─────────────────────────────────────────────
  /**
   * Calcula el resultado final. Función pura respecto del estado: se puede
   * llamar dos veces sin efectos secundarios.
   * @returns {RunResult}
   */
  computeResult() {
    const st = this.stats;
    const dist = Math.max(0, Math.round(st.distance));
    const altitude = Math.max(0, st.maxAltitude - LAUNCH_POS.y);

    /*
     * Recompensa del vuelo.
     *
     * Las monedas RECOGIDAS se suman enteras: son el premio por arriesgar una
     * línea de vuelo para juntarlas, y tienen que valer más que la fórmula por
     * desempeño. Si se diluyeran en un promedio, esquivar obstáculos para
     * agarrar una de 50 no tendría sentido.
     */
    const performance = Math.max(1, Math.floor(
      dist * ECONOMY.COIN_PER_METER
      + altitude * ECONOMY.COIN_PER_ALTITUDE
      + st.maxSpeed * ECONOMY.COIN_PER_SPEED
      + st.time * ECONOMY.COIN_PER_SECOND
      + st.rings * ECONOMY.COIN_PER_RING,
    ));
    const coins = performance + st.coins;

    const severity = this.impact?.severity ?? 0;
    return {
      distance: dist,
      distanceZ: round(st.distanceZ, 1),
      maxAltitude: round(st.maxAltitude, 1),
      altitudeGain: round(altitude, 1),
      maxSpeed: round(st.maxSpeed, 1),
      time: round(st.time, 1),
      rings: st.rings,
      pathLength: round(st.pathLength, 1),
      bounces: st.bounces,
      coins,
      /** Desglose de la recompensa, para que el resultado pueda explicarla. */
      coinsFromPickups: st.coins,
      coinsFromPerformance: performance,
      coinsCollected: st.coinsCollected,
      boosters: st.boosters,
      thrustsUsed: st.thrustsUsed,
      chargesLeft: st.charges,
      kind: this.impact?.kind ?? 'landing',
      cause: this.impact?.cause ?? 'ground',
      severity,
      isRecord: dist >= 1 && dist > this._recordAtLaunch,
    };
  }

  /** Marca el récord vigente para poder detectar uno nuevo en el resultado. */
  setRecordBaseline(bestDistance) {
    this._recordAtLaunch = bestDistance;
  }

  /** ¿La partida terminó y ya se puede mostrar el resultado? */
  isSettled() {
    return this.phase === PHASE.CRASHED && (!this.impact || !this.impact.slide);
  }

  /** Fuerza el fin del deslizamiento (por ejemplo al mostrarse el resultado). */
  settleNow() {
    if (this.impact) this.impact.slide = null;
  }

  /**
   * Cancela cualquier vuelo o impacto y vuelve a IDLE sin tocar estadísticas.
   *
   * Pensado para instrumentación y pruebas (y para un futuro botón de
   * "cancelar vuelo"). No es la ruta normal de reinicio: para eso está
   * `reset()`, que además limpia el corredor y la estela.
   */
  forceIdle() {
    this.aiming.setPreviewEnabled(false);
    this.aiming.cancel();
    this.impact = null;
    this.accumulator = 0;
    this.phase = PHASE.IDLE;
    this.view.setLoadedPosition({ x: LAUNCH_POS.x, y: LAUNCH_POS.y, z: LAUNCH_POS.z });
    this.onEvent('phase', { phase: this.phase });
    return this;
  }
}
