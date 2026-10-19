/**
 * PAPERCRASH — game/Game.js
 * ============================================================
 * ORQUESTADOR. Es el único módulo que conoce a todos los demás y el que
 * cablea la entrada del usuario con las reglas del juego.
 *
 * Regla arquitectónica del proyecto:
 *   los sistemas (física, vista, efectos, UI) no se conocen entre sí;
 *   se comunican por eventos que este orquestador enruta.
 *
 * Esto es lo que hace que el bug de reentrada sea imposible por diseño:
 * la entrada se interpreta UNA vez, acá, consultando la fase real.
 * ============================================================
 */
import { adaptQuality, renderer, scene, camera } from '../core/engine.js';
import { onDrag, onKey, isTypingTarget, readFlightControls } from '../core/input.js';
import { loadSave, persistSave, clearSave } from '../core/storage.js';
import { initEnvironment, setStagePalette, stageName } from '../world/environment.js';
import { buildLaunchPad } from '../world/launchpad.js';
import { buildLauncher } from '../aircraft/launcher.js';
import { generateCourse, setCourseAltitudeProvider } from '../world/obstacles.js';
import { buildObstacleMeshes, setObstacleMeshesVisible, disposeObstacleMeshes } from '../world/obstacleMeshes.js';
import { generatePickups, setAltitudeProvider } from '../world/collectibles.js';
import { setTerrainAmplitudeProvider, terrainHeightAt } from '../world/terrainField.js';
import { updateTerrainWindow } from '../world/terrainMesh.js';
import {
  buildProfile,
  desiredAltitudeAt,
  valueAt,
} from './flightProfile.js';
import { buildPickupMeshes, updatePickupMeshes, disposePickupMeshes } from '../world/pickupMeshes.js';
import { initDirectionArrows, hideDirectionArrows, layDirectionArrows, tickDirectionArrows } from '../world/directionArrows.js';
import { paramsFromSpec } from '../physics/flightModel.js';
import { getSpec, AIRCRAFT_LIST } from '../physics/specs.js';
import { AIM, ECONOMY, SIM, LAUNCH_POS, OBSTACLES, PICKUPS, PROPULSION, STAGES, TRAJECTORY, WORLD } from '../config.js';
import { clamp } from '../core/math.js';
import { sfx, unlock, setMuted, toggleMuted, isMuted } from '../core/audio.js';

import {
  STATE,
  UPGRADE_IDS,
  hydrate,
  initUpgradeLevels,
  initOwnedAircraft,
  getUpgradeMods,
  purchaseUpgrade,
  toSaveObject,
} from './state.js';
import { AircraftView } from './AircraftView.js';
import { AimingSystem } from './aiming.js';
import { SlingshotBand } from './slingshotBand.js';
import { CameraRig, CameraMode } from './cameraRig.js';
import { Trail } from './trail.js';
import { Effects } from './effects.js';
import { RunController, PHASE } from './RunController.js';
import { MODE, MODE_LIST, HAS_MODE_CHOICE, setMode, hasMode } from '../modes/index.js';

import { UI, show, hide, setText, showBootError } from '../ui/dom.js';
import { HUD } from '../ui/hud.js';
import { AimFeedback } from '../ui/aimFeedback.js';
import { Overlays, Screen } from '../ui/overlays.js';
import { ResultScreen } from '../ui/resultScreen.js';
import { Shop } from '../ui/shop.js';
import { AircraftSelector } from '../ui/aircraftSelector.js';
import { TouchControls } from '../ui/touchControls.js';

export class Game {
  constructor() {
    this.running = false;
    /**
     * Pausa el avance del juego (física y efectos) sin detener el render.
     *
     * Sirve para instrumentación y pruebas: permite medir una secuencia de
     * entradas SIN que el bucle de render la modifique por detrás. Sin esto,
     * una aserción tomada unos milisegundos después puede ver otro estado
     * (el avión ya voló y chocó solo) y producir un falso negativo.
     */
    this.paused = false;
    /** Reloj acumulado para animar los recolectables (s). */
    this.pickupClock = 0;
    this.lastTime = 0;
    /** Acumulador para el tope de tiempo del resultado. */
    this.resultTimer = null;

    this.overlays = new Overlays();

    // ── Mundo ──
    this.buildWorld();

    // ── Sistemas ──
    this.view = new AircraftView();
    this.cameraRig = new CameraRig();
    this.aiming = new AimingSystem(
      () => getSpec(STATE.aircraft),
      () => this._liveParams(),
      () => getUpgradeMods(),
      /*
       * Cada cambio de puntería recoloca las flechas de dirección.
       *
       * Sin este aviso las flechas sólo se colocaban al entrar al modo
       * lanzamiento, así que quedaban con el ángulo viejo mientras el jugador
       * movía el dedo: se veían, pero no indicaban nada útil.
       */
      () => this.updateDirectionArrows(),
    );
    this.band = new SlingshotBand();
    this.trail = new Trail();
    this.effects = new Effects();

    this.controller = new RunController({
      view: this.view,
      aiming: this.aiming,
      cameraRig: this.cameraRig,
      trail: this.trail,
      effects: this.effects,
      getMods: () => getUpgradeMods(),
      getSpec: () => getSpec(STATE.aircraft),
      obstacles: this.obstacles,
      pickups: this.pickups,
      /*
       * Los mandos se inyectan en vez de que el controlador importe el módulo de
       * input: así la lógica de vuelo no depende del teclado y las pruebas pueden
       * pasarle mandos falsos.
       */
      readControls: () => readFlightControls(),
      onEvent: (name, payload) => this.handleEvent(name, payload),
    });

    assertApi(this);

    // ── UI ──
    this.shop = new Shop(
      (id) => this.buyUpgrade(id),
      () => this.syncCoins(),
    );
    this.selector = new AircraftSelector(
      (id) => this.chooseAircraft(id),
      // Al comprar hay que refrescar TODO lo que muestra monedas: el contador,
      // las mejoras (que ahora podrían no alcanzar) y el propio selector.
      () => {
        HUD.updateCoins(STATE.coins);
        this.shop.sync();
        HUD.invalidate();
      },
    );

    this.wireUiButtons();
    this.wireInput();
  }

  // ── Parámetros de vista previa ────────────────────────────
  /**
   * Parámetros aerodinámicos actuales para la previsualización.
   * El viento queda en cero: la línea punteada predice SIN viento, que es
   * la información honesta (el viento es una perturbación posterior).
   */
  _liveParams() {
    return paramsFromSpec(getSpec(STATE.aircraft), getUpgradeMods());
  }

  // ── Arranque ──────────────────────────────────────────────
  start() {
    hydrate(loadSave(UPGRADE_IDS, AIRCRAFT_LIST.map((s) => s.id)));
    initUpgradeLevels();
    setMuted(STATE.muted ?? false);
    this.syncMuteButton();

    this.selector.build();
    this.selector.sync();
    this.selector.syncDockLabel();
    this.shop.build();

    this.view.setType(STATE.aircraft);
    this.syncCoins();
    this.syncAimCallout();
    this.cameraRig.snapToAim();

    // Arranca en la pantalla inicial (título + tienda), que es donde se elige
    // la nave. `startRun` deja todo listo pero ya no decide la pantalla: de eso
    // se encarga `overlays.set()`.
    this.startRun({ fade: false });
    this.syncAimBias(0);
    this.overlays.set(Screen.STANDBY);

    this.running = true;

    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ── Ciclo de partida ──────────────────────────────────────
  /**
   * Prepara una partida nueva.
   *
   * IMPORTANTE: el reset del ESTADO es siempre SÍNCRONO. Antes todo el reset
   * quedaba detrás del fundido, así que apretar Espacio en la pantalla de
   * resultado parecía no hacer nada durante ~190 ms: la fase seguía en
   * `crashed` y el jugador volvía a apretar. Encima, si el temporizador del
   * fundido quedaba pendiente, podía pisar un reset posterior.
   *
   * Ahora el fundido es solo un efecto visual: la lógica cambia de inmediato
   * y `overlays.cancelFade()` garantiza que ningún temporizador viejo revierta
   * el estado nuevo.
   *
   * @param {{fade?:boolean, screen?:string}} [opts]
   *   `screen` fuerza la pantalla de destino. Por defecto se vuelve a READY
   *   (lanzador limpio con la nave e instrucciones), que es donde se apunta.
   */
  startRun(opts = {}) {
    /*
     * Camino nuevo en cada intento. Va ANTES de reiniciar el controlador porque
     * `reset()` limpia el estado de los recolectables y necesita los nuevos.
     */
    this.rerollPickupPaths(this.chunkRange?.from, this.chunkRange?.to);

    this.overlays.cancelFade();

    // Cancelar también el sondeo del resultado: si el jugador reinicia antes
    // de que aparezca, no debe saltar la pantalla de resultado del vuelo
    // anterior encima de la partida nueva.
    if (this.resultTimer) {
      clearTimeout(this.resultTimer);
      this.resultTimer = null;
    }

    this.controller.setRecordBaseline(STATE.bestDistance);
    this.controller.reset();
    this.aiming.refresh();
    // Tras un vuelo se vuelve a la PRIMERA etapa: cámara lateral, con el
    // título y la tienda a la vista. El jugador decide cuándo pasar a la
    // segunda (clic / Enter), en vez de arrancar ya en modo lanzamiento.
    this.cameraRig.snapToAim();
    /*
     * OJO: NO se resetea el tramo ni el sesgo de ángulo.
     *
     * Si el avión murió en el tramo 4, el próximo lanzamiento tiene que apuntar
     * como corresponde al tramo 4: la progresión del corredor es del JUGADOR, no
     * de cada vuelo. Resetear acá hacía que cada tiro volviera a apuntar como el
     * primero y el avión nunca pasara del tramo 1.
     */
    HUD.invalidate();
    HUD.updateCoins(STATE.coins);
    setObstacleMeshesVisible(true);
    // Al empezar una partida la tienda vuelve a mostrar las NAVES: es lo que
    // se elige antes de volar.
    this.setShopSection('ships');
    this.overlays.set(opts.screen ?? Screen.STANDBY);
    AimFeedback.hide();
    this.band.setVisible(false);
    this.syncAimCallout();
    // Los recolectables vuelven a estar disponibles y el HUD se limpia.
    hide(UI.boosterBadge);
    HUD.invalidate();
    HUD.updateGlide(PICKUPS.BOOSTERS.BASE_GLIDE, PICKUPS.BOOSTERS.GLIDE_BONUS_MAX);

    // Solo el velo es diferido, y solo si se pidió.
    if (opts.fade === true) {
      this.overlays.fade(() => {});
    }
  }

  /**
   * Muestra u oculta una sección del panel de tienda.
   * @param {'hangar'|'upgrades'} which
   * @param {boolean} visible
   */
  /**
   * Elige qué pestaña de la tienda se ve.
   *
   * Reemplaza al viejo `setShopSection`, que prendía y apagaba secciones
   * sueltas: con dos pestañas eso dejaba estados imposibles (las dos visibles,
   * o ninguna). Ahora hay una sola activa y siempre se ve algo.
   *
   * @param {'ships'|'upgrades'} which
   */
  setShopSection(which) {
    this.shop.setTab(which);
  }

  /** Fin de vuelo: aplica recompensas y muestra el resultado. */
  finishRun() {
    /*
     * Se recuerda el tramo alcanzado para el próximo lanzamiento: si el avión
     * murió en el tramo 4, el neutro del siguiente tiro tiene que ser el del 4 y
     * no el del 1. `startRun` NO lo resetea a propósito.
     */
    this.controller.settleNow();
    const result = this.controller.computeResult();

    STATE.coins += result.coins;
    if (result.distance > STATE.bestDistance) STATE.bestDistance = result.distance;
    STATE.runs++;

    this.persist();
    this.syncCoins();
    this.shop.sync();
    this.selector.setActive(STATE.aircraft);

    ResultScreen.show(result);

    // El HUD queda visible de fondo mostrando las cifras finales.
    this.overlays.showResult();

    if (result.coins > 0) sfx.coin();
  }

  persist() {
    persistSave(STATE);
  }

  /** Marca el modo activo en la barra de modos. */
  syncModeButtons() {
    for (const btn of UI.modeButtons?.querySelectorAll('.mode-btn') ?? []) {
      const activo = btn.dataset.mode === MODE.id;
      btn.classList.toggle('active', activo);
      btn.setAttribute('aria-pressed', String(activo));
    }
  }

  /**
   * Coloca las flechas de dirección según el modo y la puntería actual.
   *
   * Se ven SÓLO mientras se apunta en un modo que use flechas. En el clásico no
   * se muestran: ahí la dirección la comunica la línea punteada.
   */
  updateDirectionArrows() {
    const usaFlechas = TRAJECTORY.STYLE === 'arrows';
    const apuntando = this.controller.canAimEditable
      && (this.overlays.current === Screen.AIM || this.overlays.current === Screen.STANDBY);

    if (!usaFlechas || !apuntando) {
      hideDirectionArrows();
      return;
    }

    const a = this.aiming.state;
    layDirectionArrows(a.pitchDeg, a.azimuthDeg, LAUNCH_POS, true);
  }

  // ── Mundo y modos ─────────────────────────────────────────
  /**
   * Construye el mundo: perfil de vuelo, escenario, obstáculos y recolectables.
   *
   * Está en su propio método —y no dentro del constructor— porque cambiar de
   * MODO necesita rehacerlo todo: el modo cambia el relieve, la cantidad de
   * obstáculos y los tipos de recolectable. Sin esta separación, cambiar de modo
   * exigiría recargar la página.
   */
  buildWorld() {
    /*
     * Perfil de vuelo, ANTES de construir nada del mundo.
     *
     * Tanto el terreno como los recolectables necesitan saber a qué altura se
     * vuela en cada tramo, así que el perfil se arma primero y se inyecta. Es el
     * único lugar donde vive esa decisión; ver `game/flightProfile.js`.
     */
    this.profile = buildProfile({
      stageCount: Math.max(1, Math.ceil(WORLD.COURSE_LENGTH / STAGES.SEGMENT_LENGTH)),
      segmentLength: STAGES.SEGMENT_LENGTH,
      courseLength: WORLD.COURSE_LENGTH,
      heightGrowth: STAGES.HEIGHT_GROWTH,
      groundAmplitude: STAGES.GROUND_AMPLITUDE,
    });
    this.currentStage = -1;
    setTerrainAmplitudeProvider((x) => valueAt(this.profile, x, 'amplitude', 1));
    setAltitudeProvider((x, terrainY = 0) => desiredAltitudeAt(this.profile, x, WORLD.COURSE_LENGTH, terrainY));
    /*
     * Las barreras también necesitan la línea de vuelo: garantizan que su hueco
     * más bajo sea alcanzable. Ver `setCourseAltitudeProvider`.
     */
    setCourseAltitudeProvider((x, groundY = 0) => desiredAltitudeAt(this.profile, x, WORLD.COURSE_LENGTH, groundY));

    // El escenario (cielo, terreno, cordillera) se construye dentro de
    // initEnvironment; la resortera y su plataforma son piezas aparte.
    initEnvironment();
    initDirectionArrows();
    buildLauncher();
    buildLaunchPad();

    /*
     * El corredor se genera por TRAMOS alrededor de la posición de partida.
     *
     * `updateChunkWindow` se encarga de regenerar la ventana cuando el avión
     * avanza, así que esto sólo tiene que dejar el primer tramo listo.
     */
    this.chunkCenter = 0;
    this.obstacles = [];
    this.updateChunkWindow(0, true);
    buildObstacleMeshes(this.obstacles);

    /*
     * Los recolectables se generan DESPUÉS que los obstáculos: necesitan saber
     * dónde están para no aparecer encimados a una piedra.
     *
     * La semilla sale del reloj, así que los CAMINOS cambian en cada partida. El
     * mapa (terreno y obstáculos) sigue siendo fijo y determinista: lo que varía
     * es por dónde conviene volar.
     */
    /*
     * La semilla de los caminos cambia en CADA INTENTO, no sólo al reconstruir
     * el mundo.
     *
     * ── El bug que esto arregla ──
     * La semilla se sorteaba acá, o sea una sola vez al construir el mundo. Como
     * el mundo no se reconstruye al reintentar, cada intento volvía a mostrar el
     * MISMO camino de monedas y boosters: se podía memorizar la ruta en vez de
     * volar. Ahora `startRun` vuelve a sortearla. Ver `rerollPickupPaths`.
     */
    this.rerollPickupPaths(this.chunkRange?.from, this.chunkRange?.to);
  }

  /**
   * Sortea de nuevo los caminos de recolectables.
   *
   * Se llama al empezar cada vuelo. El MAPA (terreno, obstáculos) no cambia: lo
   * que cambia es por dónde conviene volar, que es lo que mantiene el juego
   * fresco intento tras intento sin obligar a regenerar el escenario.
   */
  rerollPickupPaths(desde, hasta, conservarSemilla = false) {
    /*
     * ── La semilla se conserva al correr la ventana ──
     *
     * Se sortea de nuevo al EMPEZAR cada vuelo, que es lo que mantiene el juego
     * fresco intento tras intento. Pero durante un mismo vuelo la ventana se corre
     * cada 500 m, y sortear ahí cambiaba las rutas a mitad de camino: el jugador
     * apuntaba a un grupo de monedas y al llegar ya no estaban.
     *
     * En el aire se reusa la semilla, así que las rutas son las mismas y sólo se
     * extienden hacia adelante.
     */
    if (!conservarSemilla) this.pickupSeed = (Math.random() * 1e9) | 0;
    /*
     * El rango es opcional: sin él se genera el corredor completo del modo, que
     * es lo que necesita el arranque. Durante el vuelo se le pasa la ventana de
     * tramos activa, para que no se generen recolectables a 20 km de distancia.
     */
    this.pickups = generatePickups(this.obstacles, PICKUPS.SEED + this.pickupSeed, desde, hasta);

    /*
     * Las mallas se rehacen porque la cantidad y la posición cambiaron. Es más
     * simple que recolocar las existentes, y este camino corre una vez por
     * vuelo, no por frame.
     */
    disposePickupMeshes();
    buildPickupMeshes(this.pickups);
    if (this.controller) this.controller.pickups = this.pickups;
  }

  /**
   * Mantiene generada una VENTANA de tramos alrededor del avión.
   *
   * ── El problema que resuelve ──
   * El corredor se prolonga sin fin, pero no se puede tener todo generado: un
   * vuelo con boosters llega a ~29 km, y a esta densidad son decenas de miles de
   * obstáculos. Sin límite, el juego se arrastra y la lista de colisiones crece
   * hasta que cada paso de física recorre miles de cajas.
   *
   * ── Cómo funciona ──
   * Se generan `CHUNKS_BEHIND` tramos hacia atrás y `CHUNKS_AHEAD` hacia adelante
   * del avión, y el resto se descarta. Cuando el avión cruza al tramo siguiente,
   * la ventana se corre: se sueltan los de atrás y se generan los de adelante.
   *
   * Regenerar es posible —y barato— porque la semilla de cada tramo sale de su
   * ÍNDICE: el mismo tramo da siempre el mismo contenido, así que volver a
   * generarlo no cambia el mundo.
   *
   * @param {number} x  posición del avión
   * @param {boolean} [forzar]  regenerar aunque la ventana no haya cambiado
   * @returns {boolean} si se regeneró
   */
  updateChunkWindow(x, forzar = false) {
    const seg = STAGES.SEGMENT_LENGTH;
    const centro = Math.floor(x / seg);
    if (!forzar && centro === this.chunkCenter) return false;

    this.chunkCenter = centro;
    const desde = Math.max(
      OBSTACLES.CLEAR_RUNWAY - seg,
      (centro - STAGES.CHUNKS_BEHIND) * seg,
    );
    const hasta = (centro + STAGES.CHUNKS_AHEAD + 1) * seg;

    /*
     * Los identificadores se reasignan desde cero en cada regeneración.
     *
     * Importa porque el estado de los aros (`passed`) y de las colisiones se
     * indexa por id: reusar ids viejos haría que un aro nuevo naciera ya marcado
     * como pasado.
     */
    this.obstacles = generateCourse({ from: desde, to: hasta, startId: centro * 1000 });
    /*
     * ── El rango se guarda ──
     *
     * Lo usa el bucle de vuelo para regenerar los recolectables dentro de la
     * misma ventana. Sin esto quedaba `undefined` y `generatePickups` caía en su
     * valor por defecto: el corredor de 2500 m. Por eso pasado ese punto no había
     * ni monedas ni boosters.
     */
    this.chunkRange = { from: desde, to: hasta };
    return true;
  }

  /**
   * Rehace el mundo para el modo activo.
   *
   * Se reconstruye todo en vez de actualizar en el lugar: es más simple, más
   * seguro, y cambiar de modo es una acción rara que no necesita ser instantánea.
   */
  rebuildForMode() {
    disposePickupMeshes();
    disposeObstacleMeshes();
    this.buildWorld();
    /*
     * El controlador guarda REFERENCIAS a los arrays de obstáculos y
     * recolectables. Al reconstruir el mundo se crean arrays nuevos, así que hay
     * que reemplazárselos: sin esto seguiría colisionando contra los obstáculos
     * viejos, que ya no están en la escena.
     */
    this.controller.obstacles = this.obstacles;
    this.controller.pickups = this.pickups;
    this.aiming.refresh();
    HUD.invalidate();
  }

  /**
   * Cambia el modo de juego.
   *
   * @param {string} id  'classic' o 'frenetic'
   * @returns {boolean} true si el modo existe y se aplicó
   */
  setGameMode(id) {
    if (!hasMode(id)) return false;
    // No se cambia de modo en pleno vuelo: el avión está a medio camino de un
    // corredor que dejaría de existir.
    if (this.controller.phase === PHASE.FLYING) return false;

    setMode(id);
    this.rebuildForMode();
    // El modo cambia el rango de ángulo: hay que reencuadrar la puntería.
    this.currentStage = -1;
    this.syncAimBias(0);
    this.startRun({ fade: true });
    this.overlays.set(Screen.STANDBY);
    HUD.updateMode?.(MODE.name, MODE.tag);
    return true;
  }

  // ── Acciones de UI ────────────────────────────────────────
  syncCoins() {
    HUD.updateCoins(STATE.coins);
    this.shop.refreshAffordability();
  }

  buyUpgrade(id) {
    const res = purchaseUpgrade(id);
    if (!res.ok) {
      sfx.click();
      return;
    }
    sfx.buy();
    this.persist();
    this.syncCoins();
    this.shop.sync();
    // Las mejoras cambian la velocidad de salida: la previsión queda vieja.
    this.aiming.refresh();
  }

  chooseAircraft(id) {
    if (this.controller.phase === PHASE.FLYING) return; // no cambiar en vuelo

    STATE.aircraft = id;
    initOwnedAircraft();
    this.selector.sync();
    this.selector.syncDockLabel();
    this.view.setType(id);
    this.view.setVisible(true);
    this.view.setLoadedPosition({ x: LAUNCH_POS.x, y: LAUNCH_POS.y, z: LAUNCH_POS.z });
    this.aiming.refresh();
    this.persist();
    sfx.click();

    // Elegir nave NO entra en modo lanzamiento por sí solo: se cierra la tienda
    // y se vuelve a la vista standby, que es desde donde el jugador decide
    // cuándo pasar a la segunda etapa. Si estaba en modo lanzamiento (abrió la
    // tienda desde ahí), se queda en modo lanzamiento con la nave nueva.
    this.shop.toggle(false);
    this.syncAimCallout();
    this.aiming.refresh();

    if (!this.controller.canAimEditable) {
      // En vuelo o en el resultado no se toca la etapa.
      return;
    }
    if (this.cameraRig.atLaunch) this.enterLaunchMode({ silent: true });
    else this.overlays.set(Screen.STANDBY);
  }

  /**
   * Pasa a la SEGUNDA ETAPA: la cámara viaja detrás del lanzador y la pantalla
   * queda limpia. Desde ahí se apunta, se carga y se lanza.
   *
   * @param {{silent?:boolean}} [opts] `silent` salta la animación (ya se está ahí)
   */
  enterLaunchMode(opts = {}) {
    if (!this.controller.canAimEditable) return false;

    /*
     * Se recalcula el neutro del control de ángulo para el tramo en el que está
     * el avión. Sin esto, apuntar en el tramo 1 usaba el neutro del arranque
     * (38°) cuando la línea de ese tramo está a 15 m: el avión salía demasiado
     * alto y pasaba por encima de todo.
     */
    this.syncAimBias(this.currentStage >= 0 ? this.currentStage : 0);
    this.syncAimCallout();
    // `set()` ya se encarga de apagar la pista en esta etapa: el cartel tapaba
    // justo el avión y la línea punteada, que es lo que hay que mirar acá.
    this.overlays.set(Screen.AIM);

    if (opts.silent) {
      this.cameraRig.snapToLaunch();
      return true;
    }
    // Si ya está en la vista de lanzamiento, `goTo` devuelve false y no se
    // reinicia la animación (evita el salto de volver a empezarla).
    if (!this.cameraRig.goTo(CameraMode.LAUNCH)) this.cameraRig.snapToLaunch();
    sfx.click();
    return true;
  }

  /**
   * Vuelve a la primera etapa: cámara lateral, título y tienda a la vista.
   * Se cancela cualquier apuntado en curso.
   */
  exitLaunchMode() {
    if (!this.controller.canAimEditable) return false;
    if (this.controller.phase === PHASE.AIMING) this.controller.cancelAim();
    this.aiming.setPreviewEnabled(false);
    this.band.setVisible(false);
    AimFeedback.hide();

    this.cameraRig.goTo(CameraMode.STANDBY);
    this.overlays.set(Screen.STANDBY);
    sfx.click();
    return true;
  }

  /**
   * Cambia el escenario cuando el avión entra a otro tramo.
   *
   * Se llama desde el evento de vuelo, así que corre una vez por frame: el
   * guardado de `currentStage` evita reescribir la escena cuando el tramo no
   * cambió.
   *
   * @param {number} stage @param {number} x
   */
  syncStage(stage, x) {
    if (stage !== this.currentStage) {
      this.currentStage = stage;
      /*
       * El neutro del control de ángulo sigue al tramo.
       *
       * Cada tramo tiene su altura de crucero, así que "no arrastrar nada" tiene
       * que apuntar distinto en cada uno. Se recalcula acá y no en cada frame
       * porque el cambio de tramo es un evento, no un continuo.
       */
      this.syncAimBias(stage);
      // Sin dt: el cambio de tramo salta directo, no transiciona desde el
      // anterior (si no, se vería un barrido de color en cada frontera).
      setStagePalette(stage, 0);
      HUD.updateStage(stageName(stage), x % STAGES.SEGMENT_LENGTH);
      return;
    }
    HUD.updateStage(stageName(stage), x % STAGES.SEGMENT_LENGTH);
  }

  /**
   * Ajusta el centro del control de ángulo al tramo indicado.
   *
   * Se busca el ángulo con el que el avión pasaría cerca de la línea de vuelo de
   * ese tramo. Es una aproximación geométrica, y está bien que lo sea: sólo tiene
   * que acercar el neutro, el jugador ajusta el resto.
   *
   * @param {number} stage
   */
  syncAimBias(stage) {
    const programado = this.profile[Math.min(stage, this.profile.length - 1)];
    if (!programado) return;

    // Distancia típica de un lanzamiento, para saber a qué altura apuntar.
    const alcance = 170;
    const objetivo = desiredAltitudeAt(
      this.profile,
      programado.from + alcance * 0.6,
      WORLD.COURSE_LENGTH,
      terrainHeightAt(programado.from + alcance * 0.6, 0),
    );
    const subida = Math.max(2, objetivo - LAUNCH_POS.y);
    const pitch = (Math.atan2(subida, alcance * 0.6) * 180) / Math.PI;

    // El sesgo es cuánto se corre el neutro respecto de PITCH_DEFAULT.
    AIM.PITCH_BIAS = Math.max(-20, Math.min(14, pitch - AIM.PITCH_DEFAULT));
    this.aiming.refresh();
  }

  /** Refresca el cartelito con el nombre de la nave activa (modo lanzamiento). */
  syncAimCallout() {
    const spec = getSpec(STATE.aircraft);
    setText(UI.aimPlaneIcon, spec.icon);
    setText(UI.aimPlaneName, spec.name);
    setText(UI.aimPlaneTag, spec.tag);
  }

  toggleMute() {
    const muted = toggleMuted();
    STATE.muted = muted;
    this.syncMuteButton();
    this.persist();
    if (!muted) sfx.click();
  }

  syncMuteButton() {
    const btn = UI.btnMute;
    if (!btn) return;
    const muted = isMuted();
    btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-label', muted ? 'Activar sonido' : 'Silenciar');
  }

  wireUiButtons() {
    UI.btnAgain?.addEventListener('click', (e) => {
      // Evitar que el clic se propague al gestor de arrastre.
      e.stopPropagation();
      sfx.click();
      this.startRun({ fade: true });
    });

    // ── Tienda ──
    UI.btnShop?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.shop.toggle();
    });

    // ── Botones de MODO ──
    /*
     * Se construyen desde MODE_LIST y no a mano en el HTML: agregar un modo no
     * puede requerir acordarse de tocar dos archivos.
     */
    /*
     * ── Mandos táctiles ──
     *
     * Sólo se construyen en dispositivos táctiles; en escritorio no aparecen ni
     * ocupan lugar, así que la misma build sirve para los dos.
     *
     * La propulsión se engancha al MISMO camino que el Espacio del teclado
     * (`useThrust`), así que comparten enfriamiento y consumo de cargas: no hay
     * dos lógicas que puedan desincronizarse.
     */
    this.touch = new TouchControls();
    this.touch.build({
      onThrust: () => {
        if (this.controller.phase !== PHASE.FLYING) return;
        this.controller.useThrust();
      },
      onBack: () => {
        if (this.controller.canAimEditable && this.overlays.current === Screen.AIM) {
          this.exitLaunchMode();
        }
      },
    });

    /*
     * ── El selector se oculta si hay un solo modo ──
     *
     * Con un único modo la barra sería una opción que no se puede cambiar: ruido
     * en pantalla y, en móvil, espacio que el juego necesita. Se oculta con
     * `hidden` en el contenedor en vez de no construirla, para que agregar un modo
     * más adelante la haga reaparecer sin tocar nada de esto.
     */
    if (!HAS_MODE_CHOICE && UI.modeBar) UI.modeBar.classList.add('hidden');

    UI.modeButtons?.replaceChildren(...MODE_LIST.map((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mode-btn';
      btn.dataset.mode = m.id;
      btn.textContent = m.name;
      btn.title = m.desc;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (m.id === MODE.id) return;
        sfx.click();
        this.setGameMode(m.id);
        this.syncModeButtons();
      });
      return btn;
    }));
    this.syncModeButtons();

    UI.tabShips?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.setShopSection('ships');
    });

    UI.tabUpgrades?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.setShopSection('upgrades');
      this.shop.sync();
    });

    UI.btnShopClose?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.shop.toggle(false);
    });

    UI.btnOpenShop?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      // Ahora sí: el jugador quiere gastar. Se muestran las mejoras y se abre
      // el panel. La pantalla de resultado se oculta para poder ver la tienda,
      // pero las monedas ya se acreditaron y el progreso ya está guardado.
      hide(UI.resultScreen);
      // Desde el resultado el jugador viene a GASTAR, así que se abre
      // directamente en MEJORAS.
      this.setShopSection('upgrades');
      this.shop.toggle(true);
      this.shop.sync();
    });

    UI.btnMute?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMute();
    });

    UI.btnResetSave?.addEventListener('click', (e) => {
      e.stopPropagation();
      // Reinicio destructivo: se confirma antes de borrar el progreso.
      if (!window.confirm('¿Borrar todo el progreso guardado (monedas y mejoras)?')) return;
      clearSave();
      STATE.coins = 0;
      STATE.bestDistance = 0;
      STATE.runs = 0;
      STATE.aircraft = 'paper';
      for (const id of UPGRADE_IDS) STATE.upgrades[id] = 0;
      // Sin esto quedarían "compradas" las naves de un guardado anterior.
      STATE.aircraftOwned = [];
      initOwnedAircraft();
      this.persist();
      this.selector.sync();
      this.selector.syncDockLabel();
      this.view.setType(STATE.aircraft);
      this.shop.sync();
      this.syncCoins();
      this.startRun({ fade: true });
    });

    // Volver a la primera etapa desde el modo lanzamiento.
    UI.btnBackStandby?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exitLaunchMode();
    });

    // La pista de control: en standby entra en modo lanzamiento; ahí lanza.
    // La pista de control también lanza (es un botón encubierto).
    UI.hintBlock?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.tryLaunchByButton();
    });
  }

  // ── Entrada ───────────────────────────────────────────────
  wireInput() {
    // ── Arrastre ──
    onDrag('start', (e) => {
      unlock();
      // GUARDA CLAVE: solo se empieza a apuntar desde IDLE.
      if (!this.controller.canAim()) return;
      // Si el elemento apuntado es un botón/UI, no es un gesto de juego.
      // (core/input.js ya lo filtra, esto es una segunda red de seguridad.)
      if (e.target instanceof Element && e.target.closest('button, [data-ui-interactive]')) return;

      /*
       * Se recuerda en qué etapa ARRANCÓ el gesto.
       *
       * Hace falta porque entrar en modo lanzamiento ocurre DURANTE el mismo
       * gesto (abajo), así que al soltar la etapa ya cambió. Sin este dato, un
       * clic seco en standby se leería como "clic en modo lanzamiento" y el
       * avión saldría solo al entrar: justo lo que no queremos.
       */
      this.gestureStage = this.overlays.current;

      // Si se arrastra desde STANDBY, el mismo gesto entra en modo lanzamiento:
      // la cámara viaja y el arrastre sigue vivo, así que se puede cargar sin
      // soltar. Sin esto, arrastrar en standby no haría nada visible.
      if (this.gestureStage === Screen.STANDBY) this.enterLaunchMode();

      this.controller.beginAim(e.x, e.y);
      if (this.controller.phase === PHASE.AIMING) {
        AimFeedback.show();
        this.band.setVisible(true);
      }
    });

    onDrag('move', (e) => {
      if (!this.controller.updateAim(e.x, e.y)) return;
      const aim = this.aiming.state;
      AimFeedback.update(aim);

      // El avión y la goma siguen al puntero.
      const root = this.view.root;
      if (root) {
        this.band.update(root.position);
      }
      sfx.stretch(aim.power01);
    });

    onDrag('end', (e) => {
      this.band.setVisible(false);
      AimFeedback.hide();

      /*
       * Un CLIC SECO se interpreta según la etapa en la que ARRANCÓ el gesto:
       *
       *   · STANDBY → ya se entró en modo lanzamiento al presionar. No se lanza:
       *     el jugador todavía no apuntó nada.
       *   · AIM     → lanza con la puntería actual. Antes un tap no hacía nada
       *     (el controlador exige arrastre mínimo) y parecía que el juego no
       *     respondía.
       *
       * Un ARRASTRE real siempre lo resuelve el controlador, que además valida
       * la potencia mínima.
       */
      const tapped = !this.controller.aimingWasDragged();
      if (tapped && this.gestureStage === Screen.AIM) {
        this.controller.cancelAim();
        this.launch();
        return;
      }
      this.controller.endAim();
      void e;
    });

    onDrag('cancel', () => {
      this.band.setVisible(false);
      AimFeedback.hide();
      this.controller.cancelAim();
    });

    // ── Teclado ──
    onKey((e) => {
      if (isTypingTarget(e.target)) return;
      unlock();

      // M: silenciar, disponible siempre.
      if (e.code === 'KeyM') {
        this.toggleMute();
        return;
      }

      // Esc: volver a la primera etapa (vista lateral con tienda y título).
      if (e.code === 'Escape') {
        if (this.controller.canAimEditable && this.overlays.current === Screen.AIM) {
          e.preventDefault();
          this.exitLaunchMode();
        }
        return;
      }

      /*
       * Space EN VUELO: dispara la propulsión.
       *
       * Tiene que ir ANTES de las guardas de puntería, porque durante el vuelo
       * `canLaunchByKey()` es false y el evento se consumiría sin efecto.
       *
       * Acá sólo se GASTA la carga: el empuje lo aplica el controlador en cada
       * frame. Por eso se ignora el auto-repeat, que si no gastaría varias
       * unidades de golpe con una sola pulsación larga.
       */
      if (e.code === 'Space' && this.controller.phase === PHASE.FLYING) {
        e.preventDefault();
        if (!e.repeat) {
          const usado = this.controller.useThrust();
          if (!usado && this.controller.charges === 0) HUD.updateCharges(0, PROPULSION.MAX_CHARGES, true);
        }
        return;
      }

      const isConfirm = e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter';
      if (!isConfirm) return;

      // Resultado visible → reiniciar.
      if (this.controller.canReset()) {
        e.preventDefault();
        this.startRun({ fade: true });
        return;
      }

      // En reposo, Enter/Espacio entra en la SEGUNDA ETAPA (modo lanzamiento):
      // la cámara se pone detrás del lanzador y desde ahí se apunta y se lanza.
      // Desde standby, volver a pulsar lanza con la puntería actual.
      //
      // Ojo con el reinicio: cuando el resultado está abierto, `canReset()` ya
      // se llevó el evento más arriba, así que este Enter no dispara nada por
      // su cuenta. Ése era el bug de "se lanzó solo" al reintentar.
      if (this.controller.canLaunchByKey()) {
        e.preventDefault();
        this.aiming.refresh();
        if (this.overlays.current === Screen.AIM) this.launch();
        else this.enterLaunchMode();
        return;
      }

      // En cualquier otro caso (volando, o apuntando) el atajo se consume
      // sin efecto, para no dejar que llegue a otro manejador.
      if (this.controller.phase === PHASE.FLYING || this.controller.phase === PHASE.AIMING) {
        e.preventDefault();
      }
    });
  }

  /**
   * Botón/pista de control.
   *
   * Desde standby entra en modo lanzamiento (es el gesto que se pidió: clic =
   * pasar a la segunda etapa). Desde el modo lanzamiento, lanza.
   */
  tryLaunchByButton() {
    if (!this.controller.canAimEditable) return;
    this.aiming.refresh();
    if (this.overlays.current === Screen.AIM) this.launch();
    else this.enterLaunchMode();
  }

  /**
   * Lanza el avión. Sin transición de cámara.
   *
   * La transición pertenece a `enterLaunchMode()` y ocurre ANTES, al pasar a la
   * segunda etapa: ahí la cámara viaja, el avión queda quieto en la resortera y
   * el jugador planifica la dirección y carga el tiro con la línea punteada a la
   * vista. Lanzar es sólo soltar.
   *
   * Antes la transición se disparaba acá, al lanzar, y se veía como si la cámara
   * se moviera sola justo cuando el avión salía. Además obligaba a bloquear el
   * avión con un "lanzamiento armado" y a esperar la animación para soltarlo.
   *
   * La única guarda que queda es de coherencia: si por algún camino llegara una
   * orden de lanzar estando todavía en standby, se salta a la vista de
   * lanzamiento sin animar. Es defensivo, no un camino normal.
   */
  launch() {
    if (this.controller.phase === PHASE.FLYING) return;

    /*
     * La estela de flechas arranca limpia en cada lanzamiento: si no, las del
     * vuelo anterior quedarían flotando al principio del nuevo y el jugador
     * leería una dirección que ya no existe.
     */
    // Al lanzar, las flechas desaparecen: ya no hay dirección que indicar.
    hideDirectionArrows();

    this.aiming.refresh();
    if (this.cameraRig.mode !== CameraMode.LAUNCH) {
      this.enterLaunchMode({ silent: true });
    }
    this.controller.launch();
  }

  // ── Eventos del controlador ───────────────────────────────
  handleEvent(name, payload) {
    switch (name) {
      case 'phase':
        if (payload.phase === PHASE.FLYING) {
          // Al empezar el vuelo se vuelve al tramo 1: el avión sale de la
          // resortera, no de donde terminó el vuelo anterior.
          this.currentStage = -1;
          this.overlays.set(Screen.PLAYING);
          this.trail.clear();
        } else if (payload.phase === PHASE.IDLE) {
          // El controlador volvió a reposo (gesto cancelado, reinicio). Si
          // veníamos de volar, se vuelve a la primera etapa; si no, se respeta
          // la etapa actual (por ejemplo, seguir en modo lanzamiento).
          if (this.overlays.current === Screen.PLAYING) {
            this.overlays.set(Screen.STANDBY);
          }
        }
        break;

      case 'launch':
        sfx.launch(clamp(payload.power01 ?? 0.5, 0, 1));
        break;

      case 'flight':
        HUD.update(payload);
        HUD.updateGlide(payload.state.glideBudget, PROPULSION.GLIDE_MAX);
        HUD.updateCharges(payload.charges ?? 0, PROPULSION.MAX_CHARGES);
        this.syncStage(payload.stage ?? 0, payload.state.x);
        break;

      case 'ring':
        sfx.ring();
        break;

      /*
       * ── Combo de aros: el empuje grande ──
       *
       * Cada N aros el vuelo recibe un empujón considerable. Es el premio por
       * seguir el circuito, y reemplaza al viejo booster como la recompensa
       * principal de velocidad.
       *
       * El aviso visual es a propósito más fuerte que el del aro suelto: el
       * jugador tiene que SENTIR que esta vez ganó algo de verdad.
       */
      case 'ringCombo':
        /*
         * Sonido propio y golpe visual múltiple.
         *
         * Reusando ring() + booster() no se distinguía del aro suelto: los dos
         * eventos suenan casi juntos y el oído no separa "pasé un aro" de
         * "completé el combo". Ahora es un arpegio y una explosión de tres
         * estallidos, que se lee como premio y no como paso.
         */
        sfx.combo();
        for (let i = 0; i < 3; i++) {
          this.effects.ringBurst(payload.x + i * 1.2, payload.y + i * 0.6, payload.z);
        }
        this.effects.boosterBurst(payload.x, payload.y, payload.z);
        HUD.flashCombo?.();
        break;

      case 'coin':
        sfx.coin(payload.value);
        this.effects.coinPop(payload.pickup.x, payload.pickup.y, payload.pickup.z, payload.value);
        // El HUD de monedas muestra lo del vuelo; el global se acredita al final.
        HUD.updateCoins(STATE.coins + payload.coins);
        break;

      case 'booster':
        sfx.booster();
        // El booster ya no empuja: CARGA una propulsión. El aviso es la carga,
        // no un impulso.
        HUD.updateCharges(payload.charges, PROPULSION.MAX_CHARGES, true);
        break;

      case 'thrust':
        sfx.booster();
        HUD.updateCharges(payload.charges, PROPULSION.MAX_CHARGES, false);
        // El empujón de morro arriba tiene su propio aviso: el jugador tiene que
        // notar que la combinación hizo algo distinto.
        if (payload.climbed) this.overlays.flash(0.18);
        break;

      case 'bounce':
        sfx.bounce(clamp(payload.speed / 12, 0, 1));
        this.overlays.flash(0.25);
        break;

      case 'impact': {
        const severity = clamp(payload.speed / 30, 0, 1);
        sfx.crash(severity);
        this.overlays.flash(payload.kind === 'crash' ? severity : severity * 0.6);
        this.scheduleResult();
        break;
      }

      default:
        break;
    }
  }

  /**
   * Programa el fin de la partida.
   *
   * Se espera a que el avión termine de deslizarse (o a un tope de tiempo),
   * en vez de usar un `setTimeout` fijo de 1.8 s: antes la pantalla de
   * resultado aparecía antes de que el avión se detuviera y, peor, el
   * temporizador no se cancelaba al reiniciar.
   */
  scheduleResult() {
    if (this.resultTimer) clearTimeout(this.resultTimer);

    const waitForSettle = () => {
      if (this.controller.isSettled()) {
        this.resultTimer = null;
        this.finishRun();
        return;
      }
      this.resultTimer = setTimeout(waitForSettle, 100);
    };

    // Tope duro: pase lo que pase, el resultado aparece.
    this.resultTimer = setTimeout(waitForSettle, 150);
    setTimeout(() => {
      if (this.resultTimer && this.controller.phase === PHASE.CRASHED) {
        this.controller.settleNow();
      }
    }, ECONOMY.RESULT_DELAY_MS);
  }

  // ── Bucle principal ───────────────────────────────────────
  frame(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.frame(t));

    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Un frame largo (cambio de pestaña, tirón del sistema) no debe teletransportar
    // la física: se acota el dt real que se le entrega.
    const dt = Math.min(Math.max(rawDt, 0), SIM.MAX_FRAME_DT);

    // En pausa se sigue renderizando (para poder capturar la pantalla) pero no
    // avanza nada de lógica.
    if (this.paused) {
      renderer.render(scene, camera);
      return;
    }

    this.controller.update(dt);
    this.effects.update(dt);

    /*
     * Ventana de tramos: se corre cuando el avión cruza al tramo siguiente.
     *
     * Va acá y no dentro de la física: regenerar el mundo es caro y la física
     * corre cientos de veces por frame. El evento es raro (una vez cada 500 m) y
     * ocurre fuera del paso fijo.
     */
    if (this.controller.phase === PHASE.FLYING) {
      const x = this.controller.flight.x;

      /*
       * El suelo se desplaza con el avión.
       *
       * Sin esto la malla terminaba donde terminaba el corredor original y
       * pasado ese punto el avión volaba sobre el vacío: era la pantalla negra.
       */
      updateTerrainWindow(x);

      const corrio = this.updateChunkWindow(x);
      if (corrio) {
        disposeObstacleMeshes();
        buildObstacleMeshes(this.obstacles);
        /*
         * ── Los recolectables se regeneran con la ventana ──
         *
         * Esto FALTABA. Los obstáculos seguían al avión pero las monedas y los
         * boosters no: se generaban una sola vez al empezar el vuelo, con el rango
         * por defecto (el corredor de 2500 m). Pasado ese punto el corredor estaba
         * vacío —ni monedas ni boosters— aunque hubiera obstáculos.
         *
         * La semilla se CONSERVA (`true`): dentro de un mismo vuelo las rutas no
         * cambian. Sortear de nuevo acá haría que las monedas a las que estabas
         * apuntando desaparecieran al cruzar el tramo.
         */
        this.rerollPickupPaths(this.chunkRange.from, this.chunkRange.to, true);
        // El controlador guarda las REFERENCIAS: si no se le pasan las nuevas,
        // sigue colisionando y recogiendo contra las listas viejas.
        this.controller.obstacles = this.obstacles;
        this.controller.pickups = this.pickups;
      }
    }

    // Los mandos táctiles se ven SÓLO volando: antes se apunta arrastrando y en
    // el resultado ya no hay nada que pilotar.
    this.touch?.setVisible(this.controller.phase === PHASE.FLYING);

    // Reloj propio de la presentación: los recolectables flotan y laten con él.
    this.pickupClock += dt;
    updatePickupMeshes(this.pickups, dt, this.pickupClock);

    /*
     * Flechas de dirección (modo frenético).
     *
     * Se ANIMAN siempre (para que el ciclo no se congele) y se COLOCAN al
     * apuntar. No siguen al avión: son un indicador de orientación, no una
     * previsión de trayectoria. Ver `world/directionArrows.js`.
     */
    tickDirectionArrows(dt);
    this.updateDirectionArrows();

    // La goma sigue al avión también cuando no hay gesto activo (por ejemplo
    // durante el retroceso al cancelar).
    if (this.view.root && this.band.left?.visible) {
      this.band.update(this.view.root.position);
    }

    renderer.render(scene, camera);
    adaptQuality(dt);
  }

  stop() {
    this.running = false;
    if (this.resultTimer) clearTimeout(this.resultTimer);
  }
}

/** Muestra el error de arranque de forma legible. */
export function reportBootError(err) {
  console.error('[papercrash] fallo al arrancar', err);
  const detail = err && err.stack ? String(err.stack).split('\n').slice(0, 4).join('\n') : String(err);
  showBootError(
    'No se pudo iniciar el juego. Revisá la consola para más detalle.',
    detail,
  );
}

/**
 * Interfaz que `RunController` espera de cada sistema.
 *
 * Existe porque un renombre a un solo lado de la llamada rompe el juego EN
 * EJECUCIÓN y sin aviso: `this.aiming.setPreviewEnabled(...)` sobre un método
 * que ya no existe lanza un TypeError recién cuando el jugador empieza a
 * apuntar. Comprobar los nombres al arrancar convierte ese fallo silencioso en
 * un error inmediato y con mensaje claro.
 *
 * @type {Array<[string, string[]]>}
 */
const REQUIRED_API = [
  ['view', ['setType', 'setLoadedPosition', 'aimAt', 'syncToFlight', 'setVisible', 'updateRotors']],
  ['aiming', ['begin', 'move', 'end', 'cancel', 'reset', 'refresh', 'setPreviewEnabled']],
  ['cameraRig', ['update', 'snapToAim']],
  ['trail', ['clear', 'push']],
  ['effects', ['launchBurst', 'crash', 'obstacleImpact', 'corridorExit', 'bounceDust', 'ringBurst', 'coinPop', 'boosterBurst', 'update']],
  ['controller', ['reset', 'launch', 'beginAim', 'updateAim', 'endAim', 'cancelAim', 'update', 'computeResult']],
];

/**
 * Verifica que los sistemas expongan los métodos que se les van a llamar.
 * @param {Game} game
 */
function assertApi(game) {
  const missing = [];
  for (const [prop, methods] of REQUIRED_API) {
    const target = game[prop];
    if (!target) {
      missing.push(`${prop} (no existe)`);
      continue;
    }
    for (const m of methods) {
      if (typeof target[m] !== 'function') missing.push(`${prop}.${m}()`);
    }
  }
  if (missing.length) {
    throw new Error(
      `Interfaz incompleta entre módulos: falta ${missing.join(', ')}. `
      + 'Revisá que los nombres coincidan en el emisor y en el receptor.',
    );
  }
}
