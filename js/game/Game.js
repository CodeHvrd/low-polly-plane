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
import { initEnvironment, setStagePalette, stageName, stagePalette, updateEnvironmentScenery } from '../world/environment.js';
import { buildLaunchPad } from '../world/launchpad.js';
import { buildLauncher } from '../aircraft/launcher.js';
import { generateCourse, setCourseAltitudeProvider } from '../world/obstacles.js';
import { buildObstacleMeshes, setObstacleMeshesVisible, disposeObstacleMeshes, precalentarVendaval } from '../world/obstacleMeshes.js';
import { generatePickups, setAltitudeProvider } from '../world/collectibles.js';
import { setTerrainAmplitudeProvider, terrainHeightAt } from '../world/terrainField.js';
import { updateTerrainWindow } from '../world/terrainMesh.js';
import {
  buildProfile,
  desiredAltitudeAt,
  valueAt,
} from './flightProfile.js';
import { buildPickupMeshes, updatePickupMeshes, clearPickupMeshes, disposePickupMeshes } from '../world/pickupMeshes.js';
import { initDirectionArrows, hideDirectionArrows, layDirectionArrows, tickDirectionArrows } from '../world/directionArrows.js';
import { paramsFromSpec } from '../physics/flightModel.js';
import { getSpec, AIRCRAFT_LIST } from '../physics/specs.js';
import { AIM, ECONOMY, SIM, LAUNCH_POS, OBSTACLES, PICKUPS, PROPULSION, STAGES, TRAJECTORY, WORLD } from '../config.js';
import { clamp, formatNumber } from '../core/math.js';
import { sfx, unlock, setMuted, toggleMuted, isMuted, suspendAudio, resumeAudio } from '../core/audio.js';
import { music, pistaParaTramo } from '../core/music.js';
import { applyDomTranslations, cycleLang, t } from '../core/i18n.js';
import { precargarGLB } from '../world/glbLoader.js';
import {
  setPointerFollow,
  setPointerPosition,
  setTouchAnchor,
  setTouchRelativePosition,
  setTouchInvertY,
  pointerFollowInfo,
  isTouchDevice,
} from '../core/input.js';
import { BUILD } from '../core/version.js';

import {
  STATE,
  UPGRADE_IDS,
  hydrate,
  initUpgradeLevels,
  initOwnedAircraft,
  getUpgradeMods,
  purchaseUpgrade,
  toSaveObject,
  statsVacios,
  nivelesDe,
} from './state.js';
import { todosLosLogros } from './achievements.js';
import { crearPayloadOnline, crearRegistro, guardarEnRanking, leerRanking, leerRankingFiltrado } from './ranking.js';
import { computeRunScoreBreakdown, getPilotRank } from './score.js';
import {
  initRemoteBackend,
  startRemoteRun,
  submitRemoteRun,
  fetchGlobalLeaderboard,
  getStoredAuth,
  getGoogleClientId,
  updatePilotDisplayName,
  registerLocalUser,
  loginLocalUser,
  loginGoogleToken,
  switchToFreshGuest,
  fetchCloudProfile,
  syncCloudProfile,
} from '../net/apiClient.js';
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
import { evaluateMissions, advanceCompletedMission, recordFlightProgress } from './missions.js';
import { STORY_LEVELS, getStoryLevel, evaluateStoryResult, sanitizeStorySave } from '../modes/storyLevels.js';
import { preloadStoryProps, buildStoryProps, disposeStoryProps } from '../world/storyProps.js';
import { AdManager } from '../ads/adManager.js';
import {
  AD_CONFIG,
  AD_PLACEMENTS,
  canDoubleRunCoins,
  canClaimShopCoins,
  shouldShowInterstitial,
  defaultAdsState,
} from './adPolicy.js';

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
    /** Misiones completadas durante el vuelo actual para evitar toasts duplicados. */
    this._completedThisFlight = new Set();
    /** Nivel activo del Modo Historia (null = Modo Endless). */
    this.activeStoryLevel = null;

    this.overlays = new Overlays();
    this.ads = new AdManager({
      onPauseForAd: (active) => {
        if (active && !this.paused && this.controller?.phase === PHASE.FLYING) {
          this.setPaused(true);
        }
      },
    });
    this.overlays.onChange = (screen) => this.ads.syncBanner(screen, STATE.ads);
    this._lastRunCoinsForAd = 0;
    this._lastRunCoinsDoubled = false;
    this._lastFlightTimeSec = 0;
    this._watchedRewardedThisResult = false;
    this._shopAdTimer = null;

    // ── Mundo ──
    this.buildWorld();

    // ── Sistemas ──
    this.view = new AircraftView();
    this.cameraRig = new CameraRig();
    this.aiming = new AimingSystem(
      () => getSpec(this.getActiveAircraftId()),
      () => this._liveParams(),
      () => getUpgradeMods(this.getActiveAircraftId()),
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
      getMods: () => getUpgradeMods(this.getActiveAircraftId()),
      getSpec: () => getSpec(this.getActiveAircraftId()),
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
  /** Aeronave activa en vuelo (la asignada por el nivel de Campaña o la equipada en Hangar). */
  getActiveAircraftId() {
    return this.activeStoryLevel?.aircraft || STATE.aircraft;
  }

  _liveParams() {
    const shipId = this.getActiveAircraftId();
    return paramsFromSpec(getSpec(shipId), getUpgradeMods(shipId));
  }

  // ── Arranque ──────────────────────────────────────────────
  start() {
    hydrate(loadSave(UPGRADE_IDS, AIRCRAFT_LIST.map((s) => s.id)));
    if (STATE.cursorFollow === null || STATE.cursorFollow === undefined) {
      STATE.cursorFollow = isTouchDevice();
    }
    setTouchInvertY(Boolean(STATE.invertY));
    this.touch?.setFollowMode(Boolean(STATE.cursorFollow));
    this.syncOptionsPanel();
    initUpgradeLevels();
    setMuted(STATE.muted ?? false);
    this.syncMuteButton();
    this.applyOrientation(STATE.orientationPref ?? 'auto', false);

    // 1) Abrir primero el Gate/Login antes de revelar el lobby si aún no ingresó.
    {
      const stAuth = getStoredAuth();
      const isGuest = !stAuth?.provider || stAuth.provider === 'guest' || !stAuth.token;
      let ack = false;
      try { ack = sessionStorage.getItem('papercrash.guestAck') === '1'; } catch { /* noop */ }
      if (isGuest && !ack) {
        this._openAccountGate?.();
      }
    }

    // 2) Preparar todo el mundo y UI detrás mientras la pantalla de carga sigue activa.
    this.selector.build();
    this.selector.sync();
    this.selector.syncDockLabel();
    this.shop.build();

    this.view.setType(STATE.aircraft);
    this.syncCoins();
    this.renderMisiones();
    this.syncAimCallout();
    this.cameraRig.snapToAim();

    this.startRun({ fade: false });
    this.syncAimBias(0);
    this.overlays.set(Screen.STANDBY);

    this.running = true;
    applyDomTranslations();
    this._syncEndlessLockUi?.();
    this._syncAccountUi?.();
    this._syncQuickBar?.();

    const remoteBoot = initRemoteBackend().then(async (res) => {
      if (!this.running) return;
      this._syncAccountUi?.();
      const isGuest = !res?.user?.provider || res.user.provider === 'guest' || !res.user.token;
      if (isGuest) {
        let ack = false;
        try { ack = sessionStorage.getItem('papercrash.guestAck') === '1'; } catch { /* noop */ }
        if (!ack && this.overlays.current === Screen.STANDBY) {
          this._openAccountGate?.();
        }
      } else if (res?.online) {
        try {
          const prof = await fetchCloudProfile();
          if (prof && this.controller.phase !== PHASE.FLYING) this._applyCloudProfile?.(prof);
        } catch { /* noop */ }
      }
      if (res?.online && !this._remoteChallenge?.challengeToken && this.controller.phase !== PHASE.FLYING) {
        this._refreshRemoteChallenge?.();
      }
    }).catch(() => {});

    const storyBoot = preloadStoryProps().then(() => {
      if (this.running) this.rebuildStoryProps();
    }).catch(() => {});

    // Promesa con tope de seguridad para no colgar la pantalla de carga si no hay red.
    this.whenReady = Promise.race([
      Promise.allSettled([remoteBoot, storyBoot]),
      new Promise((resolve) => setTimeout(resolve, 2600)),
    ]);

    this._wireLifecycle();
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    return this.whenReady;
  }

  /** Pausa física, audio y música automáticamente cuando la app pasa a segundo plano (mobile/PWA/pestaña). */
  _wireLifecycle() {
    if (this._lifecycleWired) return;
    this._lifecycleWired = true;
    this._suspendBg = false;

    const onBackground = () => {
      this._suspendBg = true;
      music.suspender();
      suspendAudio();
      if (this.controller?.phase === PHASE.FLYING && !this.paused) {
        this.setPaused(true);
      }
    };

    const onForeground = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      this._suspendBg = false;
      this.lastTime = performance.now();
      music.reanudar();
      resumeAudio();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) onBackground();
        else onForeground();
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', onBackground);
      window.addEventListener('pageshow', onForeground);
      window.addEventListener('blur', () => {
        if (isTouchDevice()) onBackground();
      });
      window.addEventListener('focus', () => {
        if (!document.hidden) onForeground();
      });
    }
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
     * ══════════════════════════════════════════════════════════
     * LA VENTANA DEL CORREDOR VUELVE AL INICIO
     * ══════════════════════════════════════════════════════════
     *
     * ── El bug que esto arregla ──
     * La ventana de tramos sólo se movía DURANTE el vuelo, siguiendo al avión.
     * Al terminar una partida larga los obstáculos quedaban centrados donde cayó
     * el avión —a 1200, 3000, 8000 m— y el lanzador está en x≈0.
     *
     * Resultado: en el lanzador se veía el piso y las montañas (que son fijas)
     * pero NINGÚN obstáculo, moneda, booster ni aro, porque todos estaban lejos,
     * fuera de cuadro. En cuanto se lanzaba, la ventana se recentraba y aparecían.
     *
     * Era intermitente porque dependía de dónde hubiera terminado la partida
     * anterior: cayendo a 30 m no se notaba.
     *
     * Se reinicia acá, ANTES de sortear los recolectables, para que éstos también
     * se generen en la ventana correcta.
     */
    this.updateChunkWindow(0, true);
    const _t1 = performance.now();
    disposeObstacleMeshes();
    buildObstacleMeshes(this.obstacles);
    this._meshMs = performance.now() - _t1;
    this._lastRebuild = Math.round((this._genMs ?? 0) + (this._meshMs ?? 0));
    if (this._lastRebuild > 30) {
      console.warn('[papercrash] regenerar ventana:', this._lastRebuild + ' ms (generar ' + Math.round(this._genMs ?? 0) + ' + mallas ' + Math.round(this._meshMs ?? 0) + ')');
    }
    this.controller.obstacles = this.obstacles;
    updateTerrainWindow(0, true);
    updateEnvironmentScenery(0, true);

    /*
     * Camino nuevo en cada intento. Va ANTES de reiniciar el controlador porque
     * `reset()` limpia el estado de los recolectables y necesita los nuevos.
     */
    this.rerollPickupPaths(this.chunkRange?.from, this.chunkRange?.to);
    this._remoteChallenge = null;
    startRemoteRun({
      modeId: MODE.id,
      storyLevel: this.activeStoryLevel?.number ?? null,
    }).then((ch) => {
      if (!ch || this.controller.phase === PHASE.FLYING) return;
      this._remoteChallenge = ch;
      this.pickupSeed = ch.seed;
      this.controller?.setFlightSeed(ch.seed);
      this.rerollPickupPaths(this.chunkRange?.from, this.chunkRange?.to, true);
    }).catch(() => {});

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
    this._completedThisFlight.clear();
    this.renderMisiones();
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
    if (!STATE.ads) STATE.ads = defaultAdsState();
    STATE.ads.runsSinceInterstitial = (STATE.ads.runsSinceInterstitial ?? 0) + 1;
    this._lastRunCoinsForAd = Math.max(0, Math.floor(result.coins ?? 0));
    this._lastRunCoinsDoubled = false;
    this._lastFlightTimeSec = result.time ?? 0;
    this._watchedRewardedThisResult = false;

    /*
     * ── Estadísticas acumuladas ──
     *
     * Se suman acá y no en el controlador porque éste se reinicia en cada vuelo:
     * el acumulador tiene que sobrevivir a la partida y guardarse.
     *
     * `bestDistance` se guarda también dentro de `stats` para que los logros lean
     * de un solo lugar.
     */
    const st = STATE.stats;
    st.runs += 1;
    st.rings += result.rings ?? 0;
    st.boosters += result.boosters ?? 0;
    st.coinsCollected += result.coinsCollected ?? 0;
    st.nearMisses = (st.nearMisses ?? 0) + (result.nearMisses ?? 0);
    st.ringCombos = (st.ringCombos ?? 0) + (result.ringCombos ?? 0);
    st.totalDistance = (st.totalDistance ?? 0) + (result.distance ?? 0);
    st.thrustsUsed = (st.thrustsUsed ?? 0) + (result.thrustsUsed ?? 0);
    st.playMs += Math.round((result.time ?? 0) * 1000);
    if (result.distance > st.bestDistance) st.bestDistance = result.distance;

    // Acumular progreso en misiones acumulativas y evaluar misiones completadas en este vuelo
    if (STATE.missions?.active) {
      STATE.missions.progress = recordFlightProgress(
        STATE.missions.active,
        result,
        STATE.missions.progress,
      );
    }
    this.checkMissionsProgress(result);
    result.missionsCompleted = this._completedThisFlight.size;
    const scoreData = computeRunScoreBreakdown(result, result.missionsCompleted);
    result.totalScore = scoreData.totalScore;
    /*
     * ── Ranking local ──
     *
     * Se guarda el registro COMPLETO (semilla, nave, mejoras, resultado), no sólo
     * el puntaje: es el mismo formato que después va a validar el servidor para el
     * ranking global. Ver game/ranking.js.
     */
    const activeShip = this.getActiveAircraftId();
    const registro = crearRegistro({
      seed: this.pickupSeed ?? 0,
      ship: activeShip,
      upgrades: { ...nivelesDe(activeShip) },
      result,
      score: scoreData,
    });
    this.rankingPos = guardarEnRanking(registro);
    if (this._remoteChallenge?.challengeToken) {
      const ch = this._remoteChallenge;
      this._remoteChallenge = null;
      submitRemoteRun({
        ...crearPayloadOnline(registro, ch.challengeToken),
        missionsCompleted: result.missionsCompleted ?? 0,
      }).then((res) => {
        if (res?.ok) {
          this._renderResultRanking?.();
          this._renderMissionsRanking?.();
        }
      }).catch(() => {});
    }

    if (result.cause === 'obstacle') st.crashes += 1;
    else if (result.cause === 'ground') st.landings += 1;
    else if (result.cause === 'corridor') st.corridorExits += 1;

    document.getElementById('story-hint-banner')?.classList.add('hidden');
    let storySummary = null;
    if (this.activeStoryLevel) {
      const lvl = this.activeStoryLevel;
      const ev = evaluateStoryResult(lvl, result);
      storySummary = { lvl, ev };
      if (ev.passed) {
        const prev = STATE.story.stars[lvl.id] ?? 0;
        const nextLvl = getStoryLevel(lvl.number + 1);
        const isFinalPlayable = !nextLvl || nextLvl.comingSoon;
        STATE.story.stars[lvl.id] = Math.max(prev, ev.starsEarned);
        if (lvl.number >= STATE.story.unlockedLevel && nextLvl && !nextLvl.comingSoon) {
          STATE.story.unlockedLevel = nextLvl.number;
        }
        if (isFinalPlayable) {
          STATE.story.endlessUnlocked = true;
        }
        this._syncEndlessLockUi?.();
        STATE.coins += ev.rewardCoins;
        sfx.missionComplete();
        const starIcons = '⭐'.repeat(ev.starsEarned);
        const unlockNotes = [];
        if (lvl.number === 3 && prev === 0) unlockNotes.push('¡Misiones Desbloqueadas!');
        if (isFinalPlayable) unlockNotes.push('¡Ranking y Sin Fin Desbloqueados!');
        const extraNote = unlockNotes.length ? ` · ${unlockNotes.join(' ')}` : '';
        this.showToast(`🏆 ¡NIVEL ${lvl.number} SUPERADO!`, `${starIcons} +${ev.rewardCoins} 🪙${extraNote}`, 'mission');
      }
    }

    this.persist();
    this.syncCoins();
    this.shop.sync();
    this.selector.setActive(STATE.aircraft);

    ResultScreen.show(result);
    this.checkMissionsProgress(result);
    this.renderMisiones(result);
    if (!this._isRankingUnlocked?.()) {
      document.getElementById('res-pane-obj')?.classList.remove('hidden');
      document.getElementById('res-pane-rank')?.classList.add('hidden');
      document.getElementById('res-tab-obj')?.classList.add('active');
      document.getElementById('res-tab-rank')?.classList.remove('active');
    } else {
      this._renderResultRanking?.();
    }
    if (storySummary && UI.resultMissions) {
      this._prependStoryResult(storySummary.lvl, storySummary.ev);
    }

    const nextBtn = UI.btnNextLevel || document.getElementById('btn-next-level');
    const nextLbl = UI.btnNextLevelLabel || document.getElementById('btn-next-level-label');
    if (storySummary?.ev?.passed && nextBtn) {
      const lvl = storySummary.lvl;
      const nextLvl = getStoryLevel(lvl.number + 1);
      if (nextLvl && !nextLvl.comingSoon) {
        if (nextLbl) nextLbl.textContent = `${t('nextLevelBtn')} (${nextLvl.number})`;
        this._nextStoryAction = () => this.startStoryLevel(nextLvl.number);
      } else {
        if (nextLbl) nextLbl.textContent = t('goToEndless');
        this._nextStoryAction = () => {
          this.exitStoryMode();
          this.startRun({ fade: false });
          this.enterLaunchMode();
        };
      }
      nextBtn.classList.remove('hidden');
    } else if (nextBtn) {
      this._nextStoryAction = null;
      nextBtn.classList.add('hidden');
    }

    // El HUD queda visible de fondo mostrando las cifras finales.
    this.overlays.showResult();
    this._syncDoubleCoinsButton?.();
    music.setModo('menu');

    if (result.coins > 0) sfx.coin();
  }

  _syncDoubleCoinsButton() {
    const btn = document.getElementById('btn-ad-double-coins');
    const lbl = document.getElementById('btn-ad-double-label');
    if (!btn || !lbl) return;

    const check = canDoubleRunCoins(this._lastRunCoinsForAd, this._lastRunCoinsDoubled);
    if (this._lastRunCoinsDoubled) {
      btn.classList.remove('hidden');
      btn.classList.add('claimed');
      btn.disabled = true;
      const bonus = canDoubleRunCoins(this._lastRunCoinsForAd, false).bonus;
      lbl.textContent = `${t('adDoubleClaimed')} (+${bonus})`;
      return;
    }

    if (!check.ok) {
      btn.classList.add('hidden');
      btn.classList.remove('claimed');
      btn.disabled = false;
      return;
    }

    btn.classList.remove('hidden', 'claimed');
    btn.disabled = false;
    lbl.textContent = `${t('adDoubleLabel')} (+${formatNumber(check.bonus)})`;
  }

  _syncShopAdUi() {
    const btn = document.getElementById('btn-shop-ad-coins');
    const lbl = document.getElementById('btn-shop-ad-label');
    const hint = document.getElementById('shop-ad-hint');
    if (!btn || !lbl || !hint) return;

    const status = canClaimShopCoins(STATE.ads);
    lbl.textContent = t('adShopBtn').replace('{n}', String(status.reward));

    if (!status.ok) {
      btn.classList.add('cooldown');
      btn.disabled = true;
      if (status.reason === 'daily_cap') {
        hint.textContent = t('adShopDailyCap');
      } else {
        const m = Math.floor(status.remainingCooldownSec / 60);
        const s = String(status.remainingCooldownSec % 60).padStart(2, '0');
        hint.textContent = t('adShopCooldown').replace('{time}', `${m}:${s}`);
      }
      return;
    }

    btn.classList.remove('cooldown');
    btn.disabled = false;
    hint.textContent = t('adShopHintReady');
  }

  async _claimDoubleCoinsAd() {
    const check = canDoubleRunCoins(this._lastRunCoinsForAd, this._lastRunCoinsDoubled);
    if (!check.ok) return;

    const res = await this.ads.showRewarded(AD_PLACEMENTS.RESULT_DOUBLE_COINS);
    if (!res.ok || !res.rewarded) {
      if (res.error === 'no_sdk') {
        this.showToast(`📺 ${t('adNotReadyTitle')}`, t('adNotReadyDesc'), 'mission');
      }
      return;
    }

    this._lastRunCoinsDoubled = true;
    this._watchedRewardedThisResult = true;
    STATE.coins += check.bonus;
    if (!STATE.ads) STATE.ads = defaultAdsState();
    STATE.ads.lastRewardedAt = Date.now();
    STATE.ads.rewardedTotal = (STATE.ads.rewardedTotal ?? 0) + 1;

    setText(UI.resCoins, `+${formatNumber(this._lastRunCoinsForAd + check.bonus)}`);
    sfx.coin(50);
    this.persist();
    this.syncCoins();
    this.shop.sync();
    this._syncDoubleCoinsButton();
    this._syncShopAdUi();
  }

  async _claimShopCoinsAd() {
    const status = canClaimShopCoins(STATE.ads);
    if (!status.ok) return;

    const res = await this.ads.showRewarded(AD_PLACEMENTS.SHOP_FREE_COINS);
    if (!res.ok || !res.rewarded) {
      if (res.error === 'no_sdk') {
        this.showToast(`📺 ${t('adNotReadyTitle')}`, t('adNotReadyDesc'), 'mission');
      }
      return;
    }

    const nowMs = Date.now();
    STATE.coins += status.reward;
    if (!STATE.ads) STATE.ads = defaultAdsState(undefined);
    STATE.ads.lastShopAdAt = nowMs;
    STATE.ads.lastRewardedAt = nowMs;
    STATE.ads.shopClaimsToday = (STATE.ads.shopClaimsToday ?? 0) + 1;
    STATE.ads.rewardedTotal = (STATE.ads.rewardedTotal ?? 0) + 1;

    sfx.coin(50);
    this.persist();
    this.syncCoins();
    this.shop.sync();
    this.selector.sync();
    this._syncShopAdUi();
    this.showToast('🪙 +' + status.reward, t('adShopHintReady'), 'mission');
  }

  async _runWithInterstitialCheck(action) {
    if (this._interstitialRunning) return;
    const caps = this.ads.getCapabilities();
    const decision = shouldShowInterstitial({
      adsState: STATE.ads,
      nowMs: Date.now(),
      totalRuns: STATE.runs,
      flightTimeSec: this._lastFlightTimeSec ?? 0,
      justWatchedRewarded: Boolean(this._watchedRewardedThisResult),
    });

    if (decision.show && caps.interstitialReady) {
      this._interstitialRunning = true;
      try {
        const res = await this.ads.showInterstitial(AD_PLACEMENTS.BETWEEN_RUNS_INTERSTITIAL);
        if (res?.ok) {
          if (!STATE.ads) STATE.ads = defaultAdsState();
          STATE.ads.lastInterstitialAt = Date.now();
          STATE.ads.runsSinceInterstitial = 0;
          STATE.ads.interstitialTotal = (STATE.ads.interstitialTotal ?? 0) + 1;
          this.persist();
        }
      } finally {
        this._interstitialRunning = false;
      }
    }
    action();
  }

  persist() {
    persistSave(STATE);
    if (this._cloudSyncTimer) clearTimeout(this._cloudSyncTimer);
    this._cloudSyncTimer = setTimeout(() => {
      syncCloudProfile(toSaveObject(STATE)).catch(() => {});
    }, 1500);
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
    const storyAmp = this.activeStoryLevel?.groundAmplitude;
    this.profile = buildProfile({
      stageCount: Math.max(1, Math.ceil(WORLD.COURSE_LENGTH / STAGES.SEGMENT_LENGTH)),
      segmentLength: STAGES.SEGMENT_LENGTH,
      courseLength: WORLD.COURSE_LENGTH,
      heightGrowth: STAGES.HEIGHT_GROWTH,
      groundAmplitude: typeof storyAmp === 'number' ? storyAmp : STAGES.GROUND_AMPLITUDE,
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
    this.rebuildStoryProps();

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

  /** Reconstruye los props 3D de Historia/entorno (portal de meta, boyas, nubes, balizas). */
  rebuildStoryProps() {
    const lvl = this.activeStoryLevel;
    buildStoryProps({
      targetDistance: lvl?.targetDistance ?? null,
      courseLength: lvl?.courseLength ?? 2000,
      showBeacons: Boolean(lvl && lvl.number <= 3),
    });
  }

  /** Inicia un nivel específico (1..6) del Modo Historia. */
  startStoryLevel(levelNumber) {
    const lvl = getStoryLevel(levelNumber);
    if (!lvl || lvl.comingSoon) return;
    this.activeStoryLevel = lvl;
    this.controller?.setFinishDistance(lvl.targetDistance);

    if (lvl.aircraft) {
      if (!Array.isArray(STATE.story.usedAircraft)) STATE.story.usedAircraft = ['paper'];
      if (!STATE.story.usedAircraft.includes(lvl.aircraft)) {
        STATE.story.usedAircraft.push(lvl.aircraft);
      }
    }
    this.view.setType(this.getActiveAircraftId());
    this.selector.sync();
    this.selector.syncDockLabel();
    this.shop.sync();
    this.syncAimCallout();
    this.persist();

    this.rebuildForMode();
    this.startRun({ fade: false });
    setStagePalette(lvl.paletteIndex);
    document.getElementById('story-panel')?.classList.add('hidden');
    document.getElementById('main-menu')?.classList.remove('hidden');
    this.enterLaunchMode();

    const banner = UI.storyHintBanner || document.getElementById('story-hint-banner');
    if (banner) {
      banner.textContent = `🗺️ Nivel ${lvl.number}: ${lvl.name} — ${lvl.hint}`;
      banner.classList.remove('hidden');
    }
  }

  /** Sale del Modo Historia y vuelve a la configuración Endless estándar. */
  exitStoryMode() {
    if (!this.activeStoryLevel) return;
    this.activeStoryLevel = null;
    this.controller?.setFinishDistance(null);
    this.view.setType(STATE.aircraft);
    this.syncAimCallout();
    const banner = UI.storyHintBanner || document.getElementById('story-hint-banner');
    if (banner) banner.classList.add('hidden');
    this.rebuildForMode();
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
    if (!conservarSemilla) {
      this.pickupSeed = (Math.random() * 1e9) | 0;
      this.controller?.setFlightSeed(this.pickupSeed);
    }
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
    clearPickupMeshes();
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

  // ── Misiones y Notificaciones Flotantes ───────────────────
  /**
   * Muestra un toast emergente flotante en pantalla (misión cumplida, info, etc.).
   * @param {string} title
   * @param {string} subtitle
   * @param {'mission'|'info'} [type='mission']
   */
  showToast(title, subtitle, type = 'mission') {
    const layer = UI.toastLayer || document.getElementById('toast-layer');
    if (!layer) return;

    const toast = document.createElement('div');
    toast.className = `game-toast toast-${type}`;

    const tTitle = document.createElement('div');
    tTitle.className = 'toast-title';
    tTitle.textContent = title;

    const tSub = document.createElement('div');
    tSub.className = 'toast-sub';
    tSub.textContent = subtitle;

    toast.append(tTitle, tSub);
    layer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-leaving');
      setTimeout(() => {
        toast.remove();
      }, 350);
    }, 2800);
  }

  /**
   * Muestra un texto emergente directamente cerca del objeto rozado (Near Miss).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} [bonusCoins=15]
   */
  showNearMissPop(x, y, z, bonusCoins = 15) {
    const container = UI.worldPopups || document.getElementById('world-popups');
    if (!container || typeof THREE === 'undefined' || !camera) return;

    const v = new THREE.Vector3(x, y + 1.2, z);
    v.project(camera);

    // Si queda detrás del plano de la cámara, descartar
    if (v.z > 1) return;

    const sx = ((v.x + 1) * 0.5) * window.innerWidth;
    const sy = ((-v.y + 1) * 0.5) * window.innerHeight;

    const pop = document.createElement('div');
    pop.className = 'near-miss-pop';
    pop.innerHTML = `<span class="nm-tag">¡ROZADO!</span> <span class="nm-coins">+${bonusCoins} 🪙</span>`;
    pop.style.left = `${Math.round(sx)}px`;
    pop.style.top = `${Math.round(sy)}px`;

    container.appendChild(pop);

    setTimeout(() => {
      pop.remove();
    }, 1100);
  }

  /**
   * Construye el elemento DOM de una tarjeta de misión para widgets y paneles.
   * @private
   */
  _createMissionCard(m) {
    const card = document.createElement('div');
    card.className = 'mission-card' + (m.isCompleted ? ' completed' : '');

    const icon = document.createElement('div');
    icon.className = 'mission-icon';
    icon.textContent = m.icon || '🎯';

    const body = document.createElement('div');
    body.className = 'mission-body';

    const titleRow = document.createElement('div');
    titleRow.className = 'mission-title-row';

    const title = document.createElement('div');
    title.className = 'mission-title';
    title.textContent = m.title;

    const reward = document.createElement('div');
    reward.className = 'mission-reward';
    reward.textContent = `+${m.reward} 🪙`;

    titleRow.append(title, reward);

    const desc = document.createElement('div');
    desc.className = 'mission-desc';
    desc.textContent = m.desc;

    const bar = document.createElement('div');
    bar.className = 'mission-bar';

    const fill = document.createElement('div');
    fill.className = 'mission-fill';
    fill.style.width = `${m.pct}%`;

    const txt = document.createElement('div');
    txt.className = 'mission-bar-text';
    txt.textContent = m.isCompleted ? '✓ ¡COMPLETADA!' : `${m.progress} / ${m.target}`;

    bar.append(fill, txt);
    body.append(titleRow, desc, bar);
    card.append(icon, body);
    return card;
  }

  /**
   * Evalúa el progreso de las 3 misiones activas en tiempo real o al final del vuelo.
   * @param {object} [finalStats=null]
   */
  checkMissionsProgress(finalStats = null) {
    if (!this._isMissionsUnlocked?.()) return;
    if (!STATE.missions?.active) return;
    const fl = this.controller?.flight;
    const runStats = this.controller?.stats;
    const flightStats = finalStats || {
      distance: Math.max(0, Math.round(fl?.x ?? runStats?.distance ?? 0)),
      maxSpeed: runStats?.maxSpeed ?? 0,
      maxAltitude: Math.max(0, (fl?.y ?? runStats?.maxAltitude ?? 0) - LAUNCH_POS.y),
      coinsCollected: runStats?.coinsCollected ?? 0,
      rings: runStats?.rings ?? 0,
      boosters: runStats?.boosters ?? 0,
      nearMisses: runStats?.nearMisses ?? 0,
      ringCombos: runStats?.ringCombos ?? 0,
      thrustsUsed: runStats?.thrustsUsed ?? 0,
      time: runStats?.time ?? 0,
    };

    const evalList = evaluateMissions(STATE.missions.active, flightStats, STATE.missions.progress);
    let changed = false;
    for (const m of evalList) {
      if (m.isCompleted && !this._completedThisFlight.has(m.id)) {
        this._completedThisFlight.add(m.id);
        STATE.coins += m.reward;
        sfx.missionComplete();
        this.cameraRig?.triggerShake(0.35);
        this.showToast('🎯 ¡MISIÓN CUMPLIDA!', `${m.title} (+${m.reward} 🪙)`, 'mission');

        const { nextActive, nextCompleted, nextProgress } = advanceCompletedMission(
          STATE.missions.active,
          STATE.missions.completed,
          m.id,
          STATE.missions.progress,
        );
        STATE.missions.active = nextActive;
        STATE.missions.completed = nextCompleted;
        STATE.missions.progress = nextProgress;
        changed = true;
      }
    }

    if (changed) {
      this.persist();
      this.syncCoins();
      this.renderMisiones(flightStats);
    }
  }

  /**
   * Actualiza la visualización de las misiones en el lobby, panel de premios, pausa y pantalla de resultados.
   * @param {object} [flightStats=null]
   */
  renderMisiones(flightStats = null) {
    if (!this._isMissionsUnlocked?.()) {
      UI.missionsWidgetList?.replaceChildren();
      UI.missionsPanelList?.replaceChildren();
      UI.pauseMissionsList?.replaceChildren();
      document.getElementById('result-missions-list')?.replaceChildren();
      return;
    }
    if (!STATE.missions?.active) return;
    const list = evaluateMissions(STATE.missions.active, flightStats, STATE.missions.progress);

    if (UI.missionsWidgetList) {
      UI.missionsWidgetList.replaceChildren(...list.map((m) => this._createMissionCard(m)));
    }
    if (UI.missionsPanelList) {
      UI.missionsPanelList.replaceChildren(...list.map((m) => this._createMissionCard(m)));
    }
    if (UI.pauseMissionsList) {
      UI.pauseMissionsList.replaceChildren(...list.map((m) => this._createMissionCard(m)));
    }
    const resList = document.getElementById('result-missions-list');
    if (resList) {
      resList.replaceChildren(...list.map((m) => this._createMissionCard(m)));
    } else if (UI.resultMissions) {
      const heading = document.createElement('div');
      heading.className = 'result-missions-title';
      heading.textContent = '🎯 OBJETIVOS Y MISIONES';
      UI.resultMissions.replaceChildren(heading, ...list.map((m) => this._createMissionCard(m)));
    }
  }

  /** Muestra el resumen de estrellas y objetivos del nivel de Historia en resultados. */
  _prependStoryResult(lvl, ev) {
    const target = document.getElementById('result-missions-list') || UI.resultMissions;
    if (!target) return;
    const box = document.createElement('div');
    box.className = 'story-result-card ' + (ev.passed ? 'passed' : 'failed');

    const title = document.createElement('div');
    title.className = 'story-result-title';
    const stars = '⭐'.repeat(ev.starsEarned) + '☆'.repeat(3 - ev.starsEarned);
    title.textContent = ev.passed
      ? `🗺️ NIVEL ${lvl.number}: ¡SUPERADO! ${stars}`
      : `🗺️ NIVEL ${lvl.number}: META ${lvl.targetDistance} m`;
    box.appendChild(title);

    for (const s of ev.starDetails) {
      const row = document.createElement('div');
      row.className = 'story-star-row' + (s.earned ? ' earned' : '');
      row.textContent = `${s.earned ? '⭐' : '○'} ${s.label}`;
      box.appendChild(row);
    }

    target.prepend(box);
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
    const spec = getSpec(id);
    if ((spec.price ?? 0) > 0 && !(STATE.aircraftOwned ?? []).includes(spec.id)) return;

    STATE.aircraft = id;
    initOwnedAircraft();
    this.selector.sync();
    this.selector.syncDockLabel();
    this.view.setType(this.getActiveAircraftId());
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
    if (!this.activeStoryLevel && !this._isEndlessUnlocked?.()) return false;
    music.setModo('aim');

    /*
     * ── Sello de tiempo para ignorar el gesto que abrió esta pantalla ──
     *
     * ── El bug que esto arregla ──
     * Al pulsar "Nueva partida" con el mouse, el navegador manda pointerdown y
     * pointerup sobre el botón, y ese pointerup también llega al canvas. El gestor
     * de arrastre lo tomaba como "soltar para lanzar" y disparaba el avión EN
     * PLENA transición de cámara: salía de costado.
     *
     * Con teclado no pasaba porque Enter no genera eventos de puntero.
     *
     * Los manejadores de puntero del canvas ignoran todo durante este margen.
     */
    this._aimEnteredAt = performance.now();

    /*
     * ── Calentamiento del vendaval ──
     *
     * Se reportó que el PRIMER vendaval warpea el avión hacia adelante y el
     * segundo ya funciona bien. Es el costo de compilar el material transparente
     * la primera vez que se dibuja: ese tirón hace que la física acumule varios
     * pasos y el avión salte.
     *
     * Dibujar una columna fuera de cámara durante la carga hace que el costo se
     * pague antes de volar, no en el primer vendaval.
     */
    /*
     * El calentamiento NUNCA puede romper la entrada al lanzador.
     *
     * Va en try/catch a propósito: es una optimización de rendimiento, no una
     * parte del juego. Si falla, se pierde el precalentado y nada más.
     */
    try {
      const calentamiento = precalentarVendaval();
      if (calentamiento && !calentamiento.parent) scene.add(calentamiento);
    } catch (err) {
      console.warn('[papercrash] no se pudo precalentar el vendaval:', err.message);
    }

    /*
     * ── El modelo del avión siempre tiene que estar ──
     *
     * Se reportó: tras hacer una run corta, tocar "menú" y luego "nueva partida",
     * el avión desaparece y sólo se ve la estela celeste volando.
     *
     * Pasa cuando el grupo raíz del avión quedó fuera de la escena o invisible
     * tras cambiar de pantalla. Se fuerza visible y en escena en cada entrada al
     * lanzador: es barato y evita quedarse sin nave sin poder hacer nada.
     */
    if (this.view?.root) {
      if (!this.view.root.parent) scene.add(this.view.root);
      if (!this.view.root.visible) this.view.root.visible = true;
    }

    /*
     * ── Red de seguridad: mallas que faltan ──
     *
     * Se reportó que al entrar al lanzador desaparecen obstáculos, monedas,
     * boosters y aros (las montañas NO, que son otro grupo). Si los datos existen
     * pero las mallas no están en la escena, se reconstruyen.
     *
     * Es barato —ocurre una vez por intento de lanzamiento— y convierte un fallo
     * visual intermitente en algo que se autorrepara.
     */
    const grupoObst = scene.getObjectByName('obstacles');
    if (this.obstacles?.length && !grupoObst) {
      buildObstacleMeshes(this.obstacles);
      console.warn('[papercrash] faltaban las mallas de obstáculos: reconstruidas');
    }
    const grupoRec = scene.getObjectByName('pickups');
    if (this.pickups?.length && !grupoRec) {
      buildPickupMeshes(this.pickups);
      console.warn('[papercrash] faltaban las mallas de recolectables: reconstruidas');
    }

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
    if (!this._remoteChallenge?.challengeToken) this._refreshRemoteChallenge?.();
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
    music.setModo('menu');
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
      this.syncAimBias(stage);
      setStagePalette(stage, 0);
    }
    const segLen = Math.max(1, STAGES.SEGMENT_LENGTH);
    const pct01 = clamp((x % segLen) / segLen, 0, 1);
    const pal = stagePalette(stage);
    HUD.updateStage(stageName(stage), pct01, pal?.accent ?? null);
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
    const spec = getSpec(this.getActiveAircraftId());
    setText(UI.aimPlaneIcon, spec.icon);
    setText(UI.aimPlaneName, spec.name);
    setText(UI.aimPlaneTag, spec.tag);
  }

  /**
   * Cartel de diagnóstico: qué causó el último choque y dónde.
   *
   * Sólo se ve con la tecla O apretada (`body.modo-diagnostico`).
   */
  /**
   * Estado de los grupos de la escena.
   *
   * ── Por qué ──
   * Se reportó que al entrar al lanzador desaparecen las piedras, árboles,
   * boosters, monedas y aros, pero las pirámides de fondo SÍ se ven. Eso descarta
   * un problema de render general: son grupos distintos.
   *
   * Esta función dice, grupo por grupo, cuántos hijos tiene, si está en la escena
   * y si está visible. Con eso el bug deja de ser "no se ven los objetos".
   *
   * Se puede llamar desde la consola: __escena()
   */
  estadoEscena() {
    const nombre = (o) => o.name || o.type;
    const salida = {};
    for (const hijo of scene.children) {
      const clave = nombre(hijo);
      if (!['obstacles', 'pickups', 'mountains', 'terrain', 'aircraft', 'launcher'].includes(clave)) continue;
      let total = 0;
      let visibles = 0;
      hijo.traverse((o) => { if (o.isMesh) { total++; if (o.visible) visibles++; } });
      salida[clave] = { enEscena: hijo.parent === scene, visible: hijo.visible, meshes: `${visibles}/${total}` };
    }
    return {
      grupos: salida,
      datos: {
        obstaculos: this.obstacles?.length ?? 0,
        recolectables: this.pickups?.length ?? 0,
        fase: this.controller?.phase,
        pantalla: this.overlays?.current,
      },
    };
  }

  syncDiagnostico() {
    let el = document.getElementById('diag-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'diag-overlay';
      document.body.appendChild(el);
    }
    const g = this.estadoEscena();
    const lineasEscena = Object.entries(g.grupos).map(([k, v]) =>
      `${k}: ${v.meshes}${v.visible ? '' : ' [OCULTO]'}${v.enEscena ? '' : ' [FUERA]'}`);
    const datos = `datos: obst ${g.datos.obstaculos} · rec ${g.datos.recolectables} · ${g.datos.fase}/${g.datos.pantalla}`;
    const rebuild = 'última regeneración: ' + (this._lastRebuild ?? '—') + ' ms';
    const pf = pointerFollowInfo();
    const cursor = 'cursor: activo=' + pf.activo + ' eventos=' + pf.eventos + ' steer=' + pf.steer + ' nose=' + pf.nose;

    const d = this.controller.impactDebug;
    if (!d) {
      el.textContent = ['DIAGNÓSTICO · todavía no chocaste', cursor, '', ...lineasEscena, datos].join('\n');
      return;
    }
    el.textContent = [
      `causa: ${d.cause}`,
      `obstáculo: ${d.type ?? '—'}`,
      d.oy !== null ? `obst. x${d.ox} y${d.oy} z${d.oz} · techo ${d.topY}` : '',
      `avión  x${d.px} y${d.py} z${d.pz}`,
      cursor,
    ].filter(Boolean).join('\n');
  }

  /**
   * Pausa o reanuda la partida.
   *
   * ── Qué congela ──
   * El bucle de `frame` deja de avanzar la lógica: física, efectos y ventana del
   * corredor quedan quietos. El render sigue, así que la escena se ve congelada en
   * vez de quedar en negro.
   *
   * ── Por qué no se reinicia nada ──
   * Es una PAUSA, no una salida: al reanudar el vuelo continúa con la misma
   * velocidad, altura, cargas y combustible. Por eso no se toca el controlador ni
   * el estado, sólo la bandera.
   *
   * @param {boolean} valor
   */
  setPaused(valor) {
    const nuevo = Boolean(valor);
    if (this.paused === nuevo) return;
    this.paused = nuevo;

    const cartel = document.getElementById('pause-overlay');
    if (cartel) cartel.classList.toggle('hidden', !nuevo);

    if (nuevo) {
      /*
       * Al pausar se suelta el cursor: si el jugador tenía una dirección tomada,
       * al reanudar no debe seguir aplicándose sola.
       */
      setPointerFollow(false);
      this.renderMisiones();
    } else {
      /*
       * Se descarta el tiempo transcurrido en pausa.
       *
       * Sin esto, el primer frame al reanudar recibiría un dt enorme y la física
       * daría un salto.
       */
      this.lastTime = performance.now();
      setPointerFollow(STATE.cursorFollow);
      this.touch?.setFollowMode(Boolean(STATE.cursorFollow));
      document.getElementById('pause-missions-box')?.classList.add('hidden');

    /*
     * ── Música ──
     *
     * Arranca al lanzar, con el clima que corresponde al tramo. El `unlock()` de
     * audio ya desbloqueó el contexto con el gesto del lanzamiento.
     */
    /*
     * La música ya viene sonando desde la intro; acá sólo se asegura que el clima
     * corresponda al tramo y que no esté silenciada.
     */
    music.setMudo(STATE.musicOff === true);
    }
  }

  toggleMusic() {
    STATE.musicOff = !STATE.musicOff;
    music.setMudo(STATE.musicOff);
    this.syncOptionsPanel();
    this._syncQuickBar?.();
    this.persist();
  }

  toggleMute() {
    const muted = toggleMuted();
    STATE.muted = muted;
    this.syncMuteButton();
    this._syncQuickBar?.();
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

  syncOptionsPanel() {
    const btnMute = document.getElementById('btn-options-mute');
    if (btnMute) btnMute.textContent = isMuted() ? 'OFF' : 'ON';

    const btnMusic = document.getElementById('btn-options-music');
    if (btnMusic) btnMusic.textContent = STATE.musicOff ? 'OFF' : 'ON';
    this._syncQuickBar?.();

    const lblCur = document.getElementById('lbl-options-cursor');
    if (lblCur && isTouchDevice()) lblCur.textContent = t('cursorFollow');

    const btnCur = document.getElementById('btn-options-cursor');
    if (btnCur) btnCur.textContent = STATE.cursorFollow ? 'ON' : 'OFF';

    const btnInvY = document.getElementById('btn-options-invert-y');
    if (btnInvY) btnInvY.textContent = STATE.invertY ? t('invertYInverted') : t('invertYNormal');

    const btnOri = document.getElementById('btn-options-orientation');
    if (btnOri) {
      const labels = { auto: 'AUTO', portrait: 'VERTICAL', landscape: 'HORIZONTAL' };
      btnOri.textContent = labels[STATE.orientationPref] ?? 'AUTO';
    }
  }

  applyOrientation(pref, shouldPersist = true) {
    const valid = ['auto', 'portrait', 'landscape'].includes(pref) ? pref : 'auto';
    STATE.orientationPref = valid;
    this.syncOptionsPanel();

    if (typeof document !== 'undefined' && document.body) {
      document.body.dataset.orientacion = valid;
    }

    try {
      if (typeof screen !== 'undefined' && screen?.orientation) {
        if (valid === 'portrait') {
          screen.orientation.lock('portrait').catch(() => {});
        } else if (valid === 'landscape') {
          screen.orientation.lock('landscape').catch(() => {});
        } else {
          screen.orientation.unlock();
        }
      }
    } catch (_) {
      // Ignorar si el navegador no permite bloqueo fuera de fullscreen
    }

    this.cameraRig?.applyAspect();

    if (shouldPersist) {
      this.persist();
    }
  }

  wireUiButtons() {
    UI.btnAgain?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this._runWithInterstitialCheck(() => {
        if (this.activeStoryLevel) {
          this.startStoryLevel(this.activeStoryLevel.number);
          return;
        }
        this.startRun({ fade: true });
        this.enterLaunchMode();
      });
    });

    UI.btnNextLevel?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this._runWithInterstitialCheck(() => {
        this._nextStoryAction?.();
      });
    });

    document.getElementById('btn-ad-double-coins')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this._claimDoubleCoinsAd();
    });

    document.getElementById('btn-shop-ad-coins')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this._claimShopCoinsAd();
    });

    const refreshShopAdBar = () => {
      this._syncShopAdUi();
      if (this._shopAdTimer) {
        clearInterval(this._shopAdTimer);
        this._shopAdTimer = null;
      }
      if (this.shop.open) {
        this._shopAdTimer = setInterval(() => {
          if (!this.shop.open) {
            clearInterval(this._shopAdTimer);
            this._shopAdTimer = null;
            return;
          }
          this._syncShopAdUi();
        }, 1000);
      }
    };
    this._refreshShopAdBar = refreshShopAdBar;

    // ── Tienda ──
    UI.btnShop?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.shop.toggle();
      refreshShopAdBar();
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
    this.touch.setFollowMode(Boolean(STATE.cursorFollow));

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
      this._refreshShopAdBar?.();
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
      this._refreshShopAdBar?.();
    });

    /*
     * ══════════════════════════════════════════════════════════
     * MENÚ PRINCIPAL
     * ══════════════════════════════════════════════════════════
     *
     * "Premios" y "Opciones" no navegan: muestran un panel encima del menú. Es una
     * sola página, así que cambiar de capa sin recargar conserva el estado y es
     * instantáneo.
     */
    const menu = document.getElementById('main-menu');
    const awardsPanel = document.getElementById('awards-panel');
    const optionsPanel = document.getElementById('options-panel');
    const storyPanel = document.getElementById('story-panel');
    const accountPanel = document.getElementById('account-panel');

    const closeSideDrawers = () => {
      document.getElementById('missions-drawer')?.classList.add('hidden');
      document.getElementById('ranking-drawer')?.classList.add('hidden');
      document.getElementById('btn-lobby-missions')?.classList.remove('active');
      document.getElementById('btn-lobby-ranking')?.classList.remove('active');
    };

    const mostrarPanel = (panel) => {
      menu?.classList.toggle('hidden', Boolean(panel));
      document.getElementById('pc-quick-bar')?.classList.toggle('hidden', Boolean(panel) && panel !== accountPanel);
      closeSideDrawers();
      awardsPanel?.classList.toggle('hidden', panel !== awardsPanel);
      optionsPanel?.classList.toggle('hidden', panel !== optionsPanel);
      storyPanel?.classList.toggle('hidden', panel !== storyPanel);
      accountPanel?.classList.toggle('hidden', panel !== accountPanel);
      if (!panel) HUD.invalidate();
    };

    this._hasBlockingLobbyPanel = () => {
      const ids = ['account-panel', 'options-panel', 'story-panel', 'awards-panel', 'missions-drawer', 'ranking-drawer', 'shop-panel'];
      return ids.some((id) => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
      });
    };

    const showAuthView = (viewName) => {
      const views = {
        gate: document.getElementById('auth-gate-view'),
        login: document.getElementById('auth-login-view'),
        register: document.getElementById('auth-register-view'),
        profile: document.getElementById('auth-profile-view'),
      };
      for (const [k, el] of Object.entries(views)) {
        el?.classList.toggle('hidden', k !== viewName);
      }
      setAuthFeedback('');
    };

    this._openAccountGate = () => {
      this._syncAccountUi?.();
      showAuthView('gate');
      mostrarPanel(accountPanel);
    };

    this._openAccountPanel = () => {
      this._syncAccountUi?.();
      showAuthView('profile');
      mostrarPanel(accountPanel);
    };

    this._syncQuickBar = () => {
      const btnMus = document.getElementById('btn-quick-music');
      const btnSfx = document.getElementById('btn-quick-sfx');
      if (btnMus) {
        const off = STATE.musicOff === true;
        btnMus.classList.toggle('off', off);
        btnMus.textContent = off ? '🎵' : '🎵';
        btnMus.title = off ? 'Música: OFF' : 'Música: ON';
      }
      if (btnSfx) {
        const off = isMuted();
        btnSfx.classList.toggle('off', off);
        btnSfx.textContent = off ? '🔇' : '🔊';
        btnSfx.title = off ? 'Sonidos: OFF' : 'Sonidos: ON';
      }
    };

    const refreshAfterLangChange = () => {
      this._syncEndlessLockUi?.();
      this.syncOptionsPanel?.();
      this._syncDoubleCoinsButton?.();
      this._syncShopAdUi?.();
      this.selector.sync();
      this._renderMissionsRanking?.();
      this._renderResultRanking?.();
    };

    document.getElementById('btn-quick-lang')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      cycleLang();
      refreshAfterLangChange();
    });

    document.getElementById('btn-options-lang')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      cycleLang();
      refreshAfterLangChange();
    });

    document.getElementById('btn-quick-music')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.toggleMusic();
    });

    document.getElementById('btn-quick-sfx')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMute();
      this.syncOptionsPanel();
      this._syncQuickBar();
    });

    const setAuthFeedback = (msg, isError = false) => {
      const fb = document.getElementById('auth-feedback');
      if (!fb) return;
      fb.textContent = msg || '';
      fb.classList.toggle('hidden', !msg);
      fb.classList.toggle('error', Boolean(isError));
    };

    this._syncAccountUi = () => {
      const auth = getStoredAuth();
      const name = auth.displayName || 'Piloto';
      const prov = auth.provider || 'guest';
      const isGuest = prov === 'guest' || !auth.token;

      const badgeLbl = document.getElementById('pilot-name-label');
      if (badgeLbl) badgeLbl.textContent = name;

      const statusName = document.getElementById('account-status-name');
      if (statusName) statusName.textContent = name;

      const pill = document.getElementById('account-provider-pill');
      if (pill) {
        const labels = { guest: 'INVITADO', local: 'CUENTA', google: 'GOOGLE', google_play: 'PLAY', steam: 'STEAM' };
        pill.textContent = labels[prov] || 'CUENTA';
        pill.classList.toggle('verified', !isGuest);
      }

      const inpName = document.getElementById('inp-pilot-name');
      if (inpName && document.activeElement !== inpName) inpName.value = name;

      document.getElementById('auth-logged-actions')?.classList.toggle('hidden', isGuest);
      document.getElementById('auth-guest-profile-cta')?.classList.toggle('hidden', !isGuest);

      const detail = document.getElementById('auth-logged-detail');
      if (detail) {
        if (prov === 'local' && auth.username) detail.textContent = `@${auth.username}${auth.email ? ` · ${auth.email}` : ''}`;
        else if (prov === 'google' && auth.email) detail.textContent = `Vinculado con ${auth.email}`;
        else detail.textContent = 'Sesión conectada en la nube.';
      }
    };

    this._applyCloudProfile = (prof) => {
      if (!prof) return;
      clearSave();
      const cleanSave = loadSave(UPGRADE_IDS, AIRCRAFT_LIST.map((s) => s.id));
      const w = prof.wallet;
      const upgradesObj = {};
      const owned = [];
      for (const row of prof.inventory || []) {
        if (row.item_type === 'aircraft') owned.push(row.item_id);
        else if (row.item_type === 'upgrade' && row.metadata && typeof row.metadata === 'object') {
          upgradesObj[row.item_id] = row.metadata;
        }
      }
      const rawStars = prof.story?.stars_by_level || {};
      const nextSave = {
        ...cleanSave,
        coins: Number(w?.coins ?? 0),
        bestDistance: Number(w?.best_distance ?? 0),
        aircraft: w?.active_aircraft || 'paper',
        aircraftOwned: owned.length ? owned : ['paper'],
        upgrades: upgradesObj,
        story: prof.story ? {
          unlockedLevel: prof.story.unlocked_level ?? 1,
          endlessUnlocked: Boolean(prof.story.endless_unlocked),
          stars: rawStars,
          usedAircraft: Array.isArray(rawStars._usedAircraft) ? rawStars._usedAircraft : [],
        } : cleanSave.story,
        missions: prof.missions ? {
          active: prof.missions.active_ids || [],
          completed: prof.missions.completed_ids || [],
          progress: prof.missions.progress || {},
        } : cleanSave.missions,
        stats: prof.stats ? {
          ...cleanSave.stats,
          runs: prof.stats.runs ?? 0,
          totalDistance: Number(prof.stats.total_distance ?? 0),
          playMs: Number(prof.stats.play_ms ?? 0),
          rings: prof.stats.rings ?? 0,
          boosters: prof.stats.boosters ?? 0,
          coinsCollected: prof.stats.coins_collected ?? 0,
          nearMisses: prof.stats.near_misses ?? 0,
          crashes: prof.stats.crashes ?? 0,
          landings: prof.stats.landings ?? 0,
        } : cleanSave.stats,
      };
      hydrate(nextSave);
      setTouchInvertY(Boolean(STATE.invertY));
      this.touch?.setFollowMode(Boolean(STATE.cursorFollow));
      this.syncOptionsPanel();
      initUpgradeLevels();
      initOwnedAircraft();
      persistSave(STATE);
      this.view.setType(STATE.aircraft);
      this.syncCoins();
      this.selector.sync();
      this.selector.syncDockLabel();
      this.shop.sync();
      this.renderMisiones();
      this.syncAimCallout();
      this._syncEndlessLockUi?.();
    };

    const triggerGoogleAuth = (linkCurrent = true) => {
      const clientId = getGoogleClientId();
      if (!clientId) {
        setAuthFeedback('Falta configurar GOOGLE_CLIENT_ID en Vercel → Settings → Environment Variables.', true);
        return;
      }

      const startTokenFlow = () => {
        if (!window.google?.accounts?.oauth2) {
          setAuthFeedback('No se pudo cargar Google Identity Services.', true);
          return;
        }
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'openid email profile',
          callback: async (tokenResp) => {
            if (!tokenResp?.access_token) {
              setAuthFeedback('Inicio de sesión con Google cancelado.', true);
              return;
            }
            setAuthFeedback('Conectando con Google…');
            const res = await loginGoogleToken({ accessToken: tokenResp.access_token }, linkCurrent);
            if (!res.ok) {
              setAuthFeedback(res.error || 'No se pudo iniciar con Google', true);
              return;
            }
            const prof = await fetchCloudProfile();
            if (prof && (prof.wallet?.coins > 0 || prof.wallet?.best_distance > 0)) {
              this._applyCloudProfile(prof);
            } else {
              await syncCloudProfile(toSaveObject(STATE)).catch(() => {});
            }
            this._syncAccountUi();
            mostrarPanel(null);
          },
        });
        tokenClient.requestAccessToken();
      };

      if (window.google?.accounts?.oauth2) {
        startTokenFlow();
      } else {
        setAuthFeedback('Abriendo Google…');
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = startTokenFlow;
        script.onerror = () => setAuthFeedback('No se pudo conectar con Google.', true);
        document.head.appendChild(script);
      }
    };

    document.getElementById('btn-account')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      const st = getStoredAuth();
      const isGuest = !st?.provider || st.provider === 'guest' || !st.token;
      let ack = false;
      try { ack = sessionStorage.getItem('papercrash.guestAck') === '1'; } catch { /* noop */ }
      if (isGuest && !ack) this._openAccountGate?.();
      else this._openAccountPanel?.();
    });

    document.getElementById('btn-gate-login')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      showAuthView('login');
    });

    document.getElementById('btn-to-register')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      showAuthView('register');
    });

    document.getElementById('btn-to-login')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      showAuthView('login');
    });

    document.getElementById('btn-login-to-gate')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      showAuthView('gate');
    });

    document.getElementById('btn-reg-to-gate')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      showAuthView('gate');
    });

    document.getElementById('btn-profile-switch-login')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      showAuthView('login');
    });

    document.getElementById('btn-google-login')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      triggerGoogleAuth(true);
    });

    document.getElementById('btn-google-register')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      triggerGoogleAuth(Boolean(document.getElementById('chk-link-guest')?.checked));
    });

    document.getElementById('btn-continue-guest')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      try { sessionStorage.setItem('papercrash.guestAck', '1'); } catch { /* noop */ }
      mostrarPanel(null);
    });

    document.getElementById('btn-account-back')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      mostrarPanel(null);
    });

    document.getElementById('btn-save-pilot-name')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      sfx.click();
      const inp = document.getElementById('inp-pilot-name');
      const name = inp?.value?.trim() || '';
      if (name.length < 2) {
        setAuthFeedback('Elegí al menos 2 caracteres para tu alias.', true);
        return;
      }
      setAuthFeedback('Guardando alias…');
      const res = await updatePilotDisplayName(name);
      if (!res.ok) {
        setAuthFeedback(res.error || 'No se pudo actualizar', true);
        return;
      }
      this._syncAccountUi();
      setAuthFeedback(`Alias actualizado a "${res.session.displayName}"`);
    });

    this._refreshRemoteChallenge = () => {
      this._remoteChallenge = null;
      startRemoteRun({
        modeId: MODE.id,
        storyLevel: this.activeStoryLevel?.number ?? null,
      }).then((ch) => {
        if (!ch || this.controller.phase === PHASE.FLYING) return;
        this._remoteChallenge = ch;
        this.pickupSeed = ch.seed;
        this.controller?.setFlightSeed(ch.seed);
        this.rerollPickupPaths(this.chunkRange?.from, this.chunkRange?.to, true);
      }).catch(() => {});
    };

    document.getElementById('auth-login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      sfx.click();
      const identifier = document.getElementById('inp-login-user')?.value?.trim() || '';
      const password = document.getElementById('inp-login-pass')?.value || '';
      if (!identifier || !password) {
        setAuthFeedback('Ingresá tu usuario y contraseña.', true);
        return;
      }
      setAuthFeedback('Iniciando sesión…');
      const res = await loginLocalUser({ identifier, password });
      if (!res.ok) {
        setAuthFeedback(res.error || 'Usuario o contraseña incorrectos.', true);
        return;
      }
      const prof = await fetchCloudProfile();
      if (prof) this._applyCloudProfile(prof);
      const passEl = document.getElementById('inp-login-pass');
      if (passEl) passEl.value = '';
      this._syncAccountUi();
      this._refreshRemoteChallenge();
      mostrarPanel(null);
    });

    document.getElementById('auth-register-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      sfx.click();
      const email = document.getElementById('inp-reg-email')?.value?.trim() || '';
      const username = document.getElementById('inp-reg-user')?.value?.trim() || '';
      const password = document.getElementById('inp-reg-pass')?.value || '';
      const linkCurrent = Boolean(document.getElementById('chk-link-guest')?.checked);

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        setAuthFeedback('Ingresá un correo electrónico válido.', true);
        return;
      }
      if (password.length < 6 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        setAuthFeedback('La contraseña debe tener mínimo 6 caracteres con letras y números.', true);
        return;
      }

      setAuthFeedback('Creando cuenta…');
      const res = await registerLocalUser({
        email,
        username,
        password,
        displayName: username,
        linkCurrentAccount: linkCurrent,
      });
      if (!res.ok) {
        setAuthFeedback(res.error || 'No se pudo crear la cuenta.', true);
        return;
      }

      if (linkCurrent) {
        await syncCloudProfile(toSaveObject(STATE)).catch(() => {});
      } else {
        const prof = await fetchCloudProfile();
        if (prof) this._applyCloudProfile(prof);
      }

      const passEl = document.getElementById('inp-reg-pass');
      if (passEl) passEl.value = '';
      this._syncAccountUi();
      this._refreshRemoteChallenge();
      mostrarPanel(null);
    });

    document.getElementById('btn-auth-logout')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      sfx.click();
      setAuthFeedback('Cerrando sesión…');
      try { sessionStorage.removeItem('papercrash.guestAck'); } catch { /* noop */ }
      try {
        await switchToFreshGuest();
      } catch { /* fallback offline */ }
      clearSave();
      this.activeStoryLevel = null;
      this.controller?.setFinishDistance(null);
      const freshSave = loadSave(UPGRADE_IDS, AIRCRAFT_LIST.map((s) => s.id));
      hydrate(freshSave);
      setTouchInvertY(Boolean(STATE.invertY));
      this.touch?.setFollowMode(Boolean(STATE.cursorFollow));
      this.syncOptionsPanel();
      initUpgradeLevels();
      initOwnedAircraft();
      persistSave(STATE);
      this.view.setType(STATE.aircraft);
      this.syncCoins();
      this.selector.sync();
      this.selector.syncDockLabel();
      this.shop.sync();
      this.renderMisiones();
      this.syncAimCallout();
      this._syncEndlessLockUi?.();
      this._syncAccountUi();
      this._refreshRemoteChallenge();
      showAuthView('gate');
      setAuthFeedback('');
    });

    const btnNew = document.getElementById('btn-new-game');
    const btnMissionsSquare = document.getElementById('btn-lobby-missions');
    const btnRankingSquare = document.getElementById('btn-lobby-ranking');
    this._isMissionsUnlocked = () =>
      Boolean((STATE.story?.stars?.['story-3'] ?? 0) > 0 || (STATE.story?.unlockedLevel ?? 1) >= 4 || STATE.story?.endlessUnlocked);
    this._isRankingUnlocked = () =>
      Boolean((STATE.story?.stars?.['story-5'] ?? 0) > 0 || (STATE.story?.unlockedLevel ?? 1) >= 6 || STATE.story?.endlessUnlocked);
    this._isEndlessUnlocked = () =>
      Boolean(STATE.story?.endlessUnlocked || (STATE.story?.stars?.['story-5'] ?? 0) > 0 || (STATE.story?.stars?.['story-6'] ?? 0) > 0);
    this._syncEndlessLockUi = () => {
      const endlessUnlocked = this._isEndlessUnlocked();
      const missionsUnlocked = this._isMissionsUnlocked();
      const rankingUnlocked = this._isRankingUnlocked();

      if (btnNew) {
        btnNew.classList.toggle('locked', !endlessUnlocked);
        btnNew.setAttribute('aria-disabled', String(!endlessUnlocked));
        btnNew.textContent = endlessUnlocked ? t('endlessBtn') : `🔒 ${t('endlessBtn')}`;
        btnNew.title = endlessUnlocked ? '' : t('endlessLockedHint');
      }
      if (btnMissionsSquare) {
        btnMissionsSquare.classList.toggle('locked', !missionsUnlocked);
        btnMissionsSquare.setAttribute('aria-disabled', String(!missionsUnlocked));
        btnMissionsSquare.title = missionsUnlocked ? 'Misiones' : t('missionsLockedHint');
      }
      if (btnRankingSquare) {
        btnRankingSquare.classList.toggle('locked', !rankingUnlocked);
        btnRankingSquare.setAttribute('aria-disabled', String(!rankingUnlocked));
        btnRankingSquare.title = rankingUnlocked ? 'Ranking' : t('rankingLockedHint');
      }
      document.getElementById('res-tab-obj')?.classList.toggle('locked', !missionsUnlocked);
      document.getElementById('res-tab-rank')?.classList.toggle('locked', !rankingUnlocked);
      document.getElementById('btn-pause-missions')?.classList.toggle('hidden', !missionsUnlocked);
      document.querySelector('#result-missions .result-tabs')?.classList.toggle('hidden', !missionsUnlocked && !rankingUnlocked);
      if (UI.modeBar) {
        UI.modeBar.classList.toggle('hidden', !endlessUnlocked || !HAS_MODE_CHOICE);
      }
    };
    this._syncEndlessLockUi();

    /*
     * Se cortan TODOS los eventos de puntero del botón, no sólo el `click`.
     *
     * El clic genera pointerdown → pointerup → click. Sólo frenar el `click` deja
     * pasar el pointerup al canvas, y el gestor de arrastre lo interpreta como
     * "soltar para lanzar": el avión salía disparado a mitad de la transición de
     * cámara, de costado.
     */
    for (const tipo of ['pointerdown', 'pointerup', 'pointermove']) {
      btnNew?.addEventListener(tipo, (e) => e.stopPropagation());
    }

    btnNew?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      if (!this._isEndlessUnlocked()) {
        this.showToast(`🔒 ${t('endlessLockedTitle')}`, t('endlessLockedHint'), 'mission');
        return;
      }
      this.exitStoryMode();
      this.enterLaunchMode();
    });

    const renderStoryPanel = () => {
      const listEl = UI.storyLevelsList || document.getElementById('story-levels-list');
      if (!listEl) return;
      const unlocked = STATE.story?.unlockedLevel ?? 1;
      const starsMap = STATE.story?.stars ?? {};

      listEl.replaceChildren(...STORY_LEVELS.map((lvl) => {
        const isComing = Boolean(lvl.comingSoon);
        const isUnlocked = !isComing && lvl.number <= unlocked;
        const earned = starsMap[lvl.id] ?? 0;

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'story-level-card' + (isUnlocked ? '' : ' locked') + (isComing ? ' coming-soon' : '');
        card.disabled = !isUnlocked;

        const left = document.createElement('div');
        left.className = 'story-lvl-num';
        left.textContent = isUnlocked ? `${lvl.number}` : '🔒';

        const mid = document.createElement('div');
        mid.className = 'story-lvl-body';
        const head = document.createElement('div');
        head.className = 'story-lvl-head';
        const title = document.createElement('div');
        title.className = 'story-lvl-name';
        title.textContent = lvl.name;
        head.appendChild(title);
        if (isComing) {
          const badge = document.createElement('span');
          badge.className = 'story-coming-badge';
          badge.textContent = t('comingSoon');
          head.appendChild(badge);
        }
        const sub = document.createElement('div');
        sub.className = 'story-lvl-sub' + (isComing ? ' blurred-text' : '');
        sub.textContent = `${lvl.subtitle} · Meta ${lvl.targetDistance} m`;
        mid.append(head, sub);

        const right = document.createElement('div');
        right.className = 'story-lvl-stars';
        right.textContent = isUnlocked ? '⭐'.repeat(earned) + '☆'.repeat(3 - earned) : '';

        card.append(left, mid, right);
        if (isUnlocked) {
          card.addEventListener('click', (e) => {
            e.stopPropagation();
            sfx.click();
            this.startStoryLevel(lvl.number);
          });
        }
        return card;
      }));
    };

    document.getElementById('btn-story-mode')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      renderStoryPanel();
      mostrarPanel(storyPanel);
    });

    document.getElementById('btn-story-back')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      mostrarPanel(null);
    });

    const measureRankingMarquees = (root) => {
      if (!root) return;
      requestAnimationFrame(() => {
        root.querySelectorAll('.ranking-guest-notice').forEach((banner) => {
          const box = banner.querySelector('.ranking-guest-marquee');
          const track = banner.querySelector('.ranking-guest-track');
          const first = track?.querySelector('.ranking-guest-text');
          if (!box || !track || !first) return;
          banner.classList.remove('scrolling');
          banner.style.removeProperty('--conveyor-dur');
          track.querySelectorAll('.ranking-guest-clone').forEach((n) => n.remove());
          const avail = box.clientWidth;
          const needed = first.scrollWidth;
          if (avail > 0 && needed > avail + 2) {
            const clone = first.cloneNode(true);
            clone.classList.add('ranking-guest-clone');
            clone.setAttribute('aria-hidden', 'true');
            track.appendChild(clone);
            const durSec = Math.max(8, (needed + 42) / 36);
            banner.style.setProperty('--conveyor-dur', `${durSec.toFixed(1)}s`);
            banner.classList.add('scrolling');
          }
        });
      });
    };

    const createGuestRankingNotice = () => {
      const notice = document.createElement('div');
      notice.className = 'ranking-guest-notice';
      notice.setAttribute('role', 'status');
      const marquee = document.createElement('div');
      marquee.className = 'ranking-guest-marquee';
      const track = document.createElement('div');
      track.className = 'ranking-guest-track';
      const txt = document.createElement('span');
      txt.className = 'ranking-guest-text';
      txt.textContent = t('guestRankingAlert');
      track.appendChild(txt);
      marquee.appendChild(track);
      notice.appendChild(marquee);
      return notice;
    };

    const fillRankingContainer = (cont, period, limit = 8) => {
      if (!cont) return;
      const auth = getStoredAuth();
      const isGuest = !auth.provider || auth.provider === 'guest' || !auth.token;
      const paintRows = (items, isGlobal = false, emptyText = null) => {
        const nodes = [];
        if (isGuest) {
          nodes.push(createGuestRankingNotice());
        }
        if (!items.length) {
          const vacio = document.createElement('p');
          vacio.className = 'ach-desc';
          vacio.textContent = emptyText || 'Todavía no hay vuelos en este período.';
          nodes.push(vacio);
          cont.replaceChildren(...nodes);
          measureRankingMarquees(cont);
          return;
        }
        for (let i = 0; i < items.length; i++) {
          const r = items[i];
          const row = document.createElement('div');
          row.className = 'profile-row ranking-row';

          const puesto = document.createElement('span');
          puesto.className = 'rank-pos';
          puesto.textContent = `#${i + 1}`;

          const val = Number(r.total_score ?? r.score ?? r.distance ?? 0);
          const rankBasis = Number(r.best_score ?? val);
          const rankTier = getPilotRank(rankBasis);
          const rawName = (isGlobal && r.display_name)
            ? r.display_name
            : (auth.displayName || 'Piloto');
          const guestSuffix = (isGlobal && r.is_guest) ? ' · Inv.' : '';

          const userCell = document.createElement('span');
          userCell.className = 'rank-user';
          userCell.textContent = `${rawName}${guestSuffix} `;
          const rankSpan = document.createElement('span');
          rankSpan.className = 'rank-tier';
          rankSpan.textContent = `(${rankTier.label})`;
          userCell.appendChild(rankSpan);

          const dist = document.createElement('span');
          dist.className = 'rank-dist';
          dist.textContent = `${Math.round(Number(r.distance ?? 0)).toLocaleString('es-AR')} m`;

          const pts = document.createElement('strong');
          pts.className = 'rank-pts';
          pts.textContent = `${val.toLocaleString('es-AR')} pts`;

          row.append(puesto, userCell, dist, pts);
          nodes.push(row);
        }
        cont.replaceChildren(...nodes);
        measureRankingMarquees(cont);
      };

      const reqId = (cont._rankReqId = (cont._rankReqId || 0) + 1);
      // Los invitados solo participan en el ranking diario: no consultar ni mezclar otros períodos.
      if (isGuest && period !== 'daily') {
        paintRows([], true, 'Creá una cuenta para competir en este ranking.');
        return;
      }

      paintRows([], true, 'Cargando ranking…');

      fetchGlobalLeaderboard(period, limit).then((remote) => {
        if (cont._rankReqId !== reqId) return;
        if (Array.isArray(remote)) {
          paintRows(remote, true);
        } else {
          const localItems = leerRankingFiltrado(period).slice(0, limit);
          paintRows(localItems, false);
        }
      }).catch(() => {
        if (cont._rankReqId !== reqId) return;
        const localItems = leerRankingFiltrado(period).slice(0, limit);
        paintRows(localItems, false);
      });
    };

    window.addEventListener('resize', () => {
      measureRankingMarquees(document.getElementById('missions-ranking-list'));
      measureRankingMarquees(document.getElementById('result-ranking-list'));
    });

    let activeRankPeriod = 'daily';
    const renderMissionsRanking = () => {
      fillRankingContainer(document.getElementById('missions-ranking-list'), activeRankPeriod, 8);
    };
    this._renderMissionsRanking = renderMissionsRanking;

    let activeResRankPeriod = 'daily';
    this._renderResultRanking = () => {
      fillRankingContainer(document.getElementById('result-ranking-list'), activeResRankPeriod, 5);
    };

    const setResultTab = (tab) => {
      const isRank = tab === 'ranking';
      document.getElementById('res-tab-obj')?.classList.toggle('active', !isRank);
      document.getElementById('res-tab-rank')?.classList.toggle('active', isRank);
      document.getElementById('res-pane-obj')?.classList.toggle('hidden', isRank);
      document.getElementById('res-pane-rank')?.classList.toggle('hidden', !isRank);
      if (isRank) this._renderResultRanking();
      else this.renderMisiones();
    };

    document.getElementById('res-tab-obj')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      if (!this._isMissionsUnlocked?.()) {
        this.showToast(`🔒 ${t('missionsLockedTitle')}`, t('missionsLockedHint'), 'mission');
        return;
      }
      setResultTab('missions');
    });

    document.getElementById('res-tab-rank')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      if (!this._isRankingUnlocked?.()) {
        this.showToast(`🔒 ${t('rankingLockedTitle')}`, t('rankingLockedHint'), 'mission');
        return;
      }
      setResultTab('ranking');
    });

    document.querySelectorAll('.res-period-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx.click();
        activeResRankPeriod = btn.dataset.period || 'all';
        document.querySelectorAll('.res-period-btn').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        this._renderResultRanking();
      });
    });

    document.querySelectorAll('.ranking-period-btn:not(.res-period-btn)').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx.click();
        activeRankPeriod = btn.dataset.period || 'all';
        document.querySelectorAll('.ranking-period-btn:not(.res-period-btn)').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        renderMissionsRanking();
      });
    });

    const toggleSideDrawer = (which) => {
      const mDrawer = document.getElementById('missions-drawer');
      const rDrawer = document.getElementById('ranking-drawer');
      const isMissions = which === 'missions';
      const target = isMissions ? mDrawer : rDrawer;
      const other = isMissions ? rDrawer : mDrawer;
      const targetBtn = document.getElementById(isMissions ? 'btn-lobby-missions' : 'btn-lobby-ranking');
      const otherBtn = document.getElementById(isMissions ? 'btn-lobby-ranking' : 'btn-lobby-missions');
      if (!target) return;

      const willOpen = target.classList.contains('hidden');
      other?.classList.add('hidden');
      otherBtn?.classList.remove('active');

      if (!willOpen) {
        target.classList.add('hidden');
        targetBtn?.classList.remove('active');
        return;
      }

      target.classList.remove('hidden');
      targetBtn?.classList.add('active');
      if (isMissions) this.renderMisiones();
      else renderMissionsRanking();
    };

    document.getElementById('btn-lobby-missions')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      if (!this._isMissionsUnlocked?.()) {
        this.showToast(`🔒 ${t('missionsLockedTitle')}`, t('missionsLockedHint'), 'mission');
        return;
      }
      toggleSideDrawer('missions');
    });

    document.getElementById('btn-lobby-ranking')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      if (!this._isRankingUnlocked?.()) {
        this.showToast(`🔒 ${t('rankingLockedTitle')}`, t('rankingLockedHint'), 'mission');
        return;
      }
      toggleSideDrawer('ranking');
    });

    document.getElementById('btn-missions-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      closeSideDrawers();
    });

    document.getElementById('btn-ranking-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      closeSideDrawers();
    });

    /*
     * Se dibujan al abrir, no al construir: los totales cambian con cada vuelo y
     * regenerar la lista en cada apertura es más simple que mantenerla sincronizada.
     */
    const renderLogros = () => {
      const cont = document.getElementById('awards-list');
      if (!cont) return;
      const logros = todosLosLogros(STATE.stats);
      cont.replaceChildren(...logros.map((a) => {
        const card = document.createElement('div');
        card.className = 'ach-card' + (a.unlocked ? ' unlocked' : '');
        const icon = document.createElement('span');
        icon.className = 'ach-icon';
        icon.textContent = a.unlocked ? '🏆' : '🔒';
        const body = document.createElement('div');
        body.className = 'ach-body';
        const name = document.createElement('strong');
        name.textContent = a.name;
        const desc = document.createElement('span');
        desc.className = 'ach-desc';
        desc.textContent = a.desc;
        const prog = document.createElement('span');
        prog.className = 'ach-progress';
        prog.textContent = `${a.progress} / ${a.target}`;
        const bar = document.createElement('div');
        bar.className = 'ach-bar';
        const fill = document.createElement('div');
        fill.className = 'ach-fill';
        fill.style.width = `${a.pct}%`;
        bar.appendChild(fill);
        body.append(name, desc, prog, bar);
        card.append(icon, body);
        return card;
      }));
      const cuenta = document.getElementById('awards-count');
      if (cuenta) {
        cuenta.textContent = `${logros.filter((a) => a.unlocked).length} / ${logros.length}`;
      }
    };

    /*
     * Ranking local: los mejores vuelos guardados.
     *
     * Se muestra la distancia y la nave, que es lo que hace comparable una marca
     * con otra. El registro completo (semilla, mejoras) ya está guardado: cuando
     * haya ranking online es lo que se envía al servidor.
     */
    const renderRanking = () => {
      const cont = document.getElementById('ranking-list');
      if (!cont) return;
      const lista = leerRanking().slice(0, 5);
      if (!lista.length) {
        const vacio = document.createElement('p');
        vacio.className = 'ach-desc';
        vacio.textContent = 'Todavía no hay vuelos guardados.';
        cont.replaceChildren(vacio);
        return;
      }
      cont.replaceChildren(...lista.map((r, i) => {
        const row = document.createElement('div');
        row.className = 'profile-row ranking-row';
        const puesto = document.createElement('span');
        puesto.className = 'rank-pos';
        puesto.textContent = `${i + 1}.`;
        const nave = document.createElement('span');
        nave.className = 'rank-ship';
        nave.textContent = r.ship ?? '—';
        const dist = document.createElement('strong');
        dist.textContent = `${r.distance} m`;
        row.append(puesto, nave, dist);
        return row;
      }));
    };

    const renderPerfil = () => {
      const cont = document.getElementById('profile-list');
      if (!cont) return;
      const s = STATE.stats;
      const horas = (s.playMs / 3600000);
      const filas = [
        ['Vuelos totales', String(s.runs)],
        ['Horas de vuelo', horas < 1 ? `${Math.round(s.playMs / 60000)} min` : `${horas.toFixed(1)} h`],
        ['Mejor distancia', `${Math.round(s.bestDistance)} m`],
        ['Aros cruzados', String(s.rings)],
        ['Boosters juntados', String(s.boosters)],
        ['Monedas juntadas', String(s.coinsCollected)],
        ['Choques con obstáculo', String(s.crashes)],
        ['Aterrizajes', String(s.landings)],
        ['Salidas del corredor', String(s.corridorExits)],
      ];
      cont.replaceChildren(...filas.map(([k, v]) => {
        const row = document.createElement('div');
        row.className = 'profile-row';
        const label = document.createElement('span');
        label.textContent = k;
        const val = document.createElement('strong');
        val.textContent = v;
        row.append(label, val);
        return row;
      }));
    };

    document.getElementById('btn-awards')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.renderMisiones();
      renderLogros();
      renderRanking();
      renderPerfil();
      mostrarPanel(awardsPanel);
    });

    document.getElementById('btn-options')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.syncOptionsPanel();
      mostrarPanel(optionsPanel);
    });

    document.getElementById('btn-awards-back')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      mostrarPanel(null);
    });

    document.getElementById('btn-options-back')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      mostrarPanel(null);
      /*
       * Si las opciones se abrieron desde la pausa, se vuelve a la pausa: el menú se
       * oculta de nuevo y el vuelo sigue congelado (nunca se despausó).
       */
      if (this._opcionesDesdePausa) {
        this._opcionesDesdePausa = false;
        hide(UI.idleOverlay);
        document.getElementById('pause-overlay')?.classList.remove('hidden');
      }
    });

    document.getElementById('btn-options-mute')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMute();
      e.currentTarget.textContent = isMuted() ? 'OFF' : 'ON';
    });

    /*
     * ── Música ──
     *
     * Todavía NO hay pista de música: el juego sólo tiene efectos. El interruptor
     * se deja igual porque el estado ya se guarda, así cuando se agregue la música
     * no hay que tocar la UI.
     */
    const btnMusic = document.getElementById('btn-options-music');
    if (btnMusic) {
      btnMusic.textContent = STATE.musicOff ? 'OFF' : 'ON';
      btnMusic.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx.click();
        this.toggleMusic();
        e.currentTarget.textContent = STATE.musicOff ? 'OFF' : 'ON';
      });
    }

    document.getElementById('btn-options-reset')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      // Sin confirmación nativa: un `confirm()` bloquea el bucle de juego.
      /*
       * Se dispara el botón OCULTO en vez de duplicar la lógica.
       *
       * Así el reinicio pasa por el mismo camino ya verificado (con su
       * confirmación y su guardado) en vez de una copia que se desincroniza.
       */
      document.getElementById('btn-reset-save')?.click();
      e.currentTarget.textContent = 'BORRAR';
    });

    /*
     * ══════════════════════════════════════════════════════════
     * FORZAR ACTUALIZACIÓN
     * ══════════════════════════════════════════════════════════
     *
     * ── Por qué hace falta ──
     * En el teléfono, con la app INSTALADA como PWA, el juego tiene su propio
     * contenedor de almacenamiento. Borrar "datos del sitio" desde el navegador no
     * lo toca, así que el jugador puede quedar pegado a una versión vieja sin
     * ninguna forma de salir.
     *
     * Esto es la salida de emergencia: desregistra el service worker, vacía todos
     * los cachés y recarga con un parámetro que saltea el caché del navegador.
     */
    /*
     * ── Botones de la pausa ──
     *
     * Continuar reanuda el mismo vuelo. Opciones abre el panel sin perder la
     * partida (la pausa sigue activa detrás). Salir abandona el vuelo y vuelve al
     * menú, que es lo único que descarta la partida en curso.
     */
    document.getElementById('btn-pause-resume')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.setPaused(false);
    });

    document.getElementById('btn-pause-missions')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      const box = document.getElementById('pause-missions-box');
      if (box) {
        const willShow = box.classList.contains('hidden');
        box.classList.toggle('hidden', !willShow);
        if (willShow) this.renderMisiones();
      }
    });

    document.getElementById('btn-pause-options')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      /*
       * Se destapa la pausa para poder ver el panel de opciones, pero la partida
       * NO se reanuda: `paused` sigue en true y el vuelo queda congelado.
       */
      /*
       * ── El panel de opciones vive en #idle-overlay ──
       *
       * ── El bug que esto arregla ──
       * El panel estaba dentro de la capa del menú, que en pleno vuelo está OCULTA.
       * Al pulsar OPCIONES desde la pausa sólo se destapaba la pausa, pero el panel
       * seguía invisible: quedaba último en el orden del documento y sin capa que lo
       * mostrara. Recién aparecía al pulsar SALIR, porque ahí el menú sí se abre.
       *
       * Ahora se muestra la capa del menú mientras las opciones están abiertas, y se
       * vuelve a ocultar al salir de ellas.
       */
      this._opcionesDesdePausa = true;
      show(UI.idleOverlay);
      document.getElementById('pause-overlay')?.classList.add('hidden');
      this.syncOptionsPanel();
      mostrarPanel(optionsPanel);
    });

    document.getElementById('btn-pause-quit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      // Salir SÍ descarta el vuelo: se vuelve al menú principal.
      this.setPaused(false);
      this.exitStoryMode();
      this.controller.forceIdle();
      this.overlays.set(Screen.STANDBY);
    });

    /*
     * ── Interruptor del vuelo con cursor ──
     *
     * Guarda la preferencia y la aplica en el acto: si se apaga en pleno vuelo, el
     * avión deja de seguir el mouse inmediatamente y queda sólo el teclado.
     */
    const btnCursor = document.getElementById('btn-options-cursor');
    if (btnCursor) {
      btnCursor.textContent = STATE.cursorFollow ? 'ON' : 'OFF';
      btnCursor.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx.click();
        STATE.cursorFollow = !STATE.cursorFollow;
        btnCursor.textContent = STATE.cursorFollow ? 'ON' : 'OFF';
        setPointerFollow(STATE.cursorFollow && this.controller.phase === PHASE.FLYING);
        this.touch?.setFollowMode(Boolean(STATE.cursorFollow));
        this.persist();
      });
    }

    const btnInvertY = document.getElementById('btn-options-invert-y');
    if (btnInvertY) {
      btnInvertY.textContent = STATE.invertY ? t('invertYInverted') : t('invertYNormal');
      btnInvertY.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx.click();
        STATE.invertY = !STATE.invertY;
        setTouchInvertY(STATE.invertY);
        btnInvertY.textContent = STATE.invertY ? t('invertYInverted') : t('invertYNormal');
        this.persist();
      });
    }

    const btnOrientation = document.getElementById('btn-options-orientation');
    if (btnOrientation) {
      const ciclo = { auto: 'portrait', portrait: 'landscape', landscape: 'auto' };
      btnOrientation.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx.click();
        const prox = ciclo[STATE.orientationPref] || 'auto';
        this.applyOrientation(prox, true);
      });
    }

    document.getElementById('btn-options-update')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      btn.textContent = 'ACTUALIZANDO…';
      try {
        // 1. Fuera los service workers.
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        // 2. Fuera los cachés.
        if ('caches' in window) {
          const claves = await caches.keys();
          await Promise.all(claves.map((k) => caches.delete(k)));
        }
      } catch (err) {
        console.warn('[papercrash] no se pudo limpiar del todo:', err?.message);
      }
      /*
       * El parámetro en la URL es clave: sin él, el navegador puede volver a
       * servir el index.html de su caché HTTP y todo el trabajo anterior no se
       * nota. Con `?v=<tiempo>` la petición es distinta y va sí o sí a la red.
       */
      const url = new URL(window.location.href);
      url.searchParams.set('v', String(Date.now()));
      window.location.replace(url.toString());
    });

    /*
     * "Exit": una página web no se puede cerrar sola.
     *
     * En el APK el botón Atrás de Android hace `moveTaskToBack`, pero desde la web
     * `window.close()` sólo funciona si la pestaña la abrió un script. Se intenta
     * igual y, si no se cierra, se avisa en vez de dejar al jugador sin respuesta.
     */
    document.getElementById('btn-exit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      window.close();
      setTimeout(() => {
        if (!window.closed) {
          const btn = e.currentTarget;
          btn.textContent = 'CERRÁ LA PESTAÑA';
          setTimeout(() => { btn.textContent = 'EXIT'; }, 2200);
        }
      }, 250);
    });

    /*
     * ── Precarga de modelos 3D ──
     *
     * Se bajan al arrancar, no al equipar la nave. Así el modelo ya está en caché
     * cuando el jugador lo elige y NO aparece primero el procedural.
     *
     * Si falla, no pasa nada: cada nave cae en su geometría procedural.
     */
    precargarGLB([
      'assets/models/paper_chrome.glb',
      'assets/models/airliner_chrome.glb',
      'assets/models/plane_chrome.glb',
      'assets/models/heli_chrome.glb',
      'assets/models/heli_main_rotor_chrome.glb',
      'assets/models/heli_tail_rotor_chrome.glb',
      'assets/models/rock_chrome.glb',
      'assets/models/ring_chrome.glb',
      'assets/models/spire_chrome.glb',
      'assets/models/mesa_chrome.glb',
      'assets/models/updraft_chrome.glb',
      'assets/models/tree_chrome.glb',
      'assets/models/log_chrome.glb',
      'assets/models/booster_chrome.glb',
      'assets/models/coin_chrome.glb',
      'assets/models/launcher_chrome.glb',
    ]).then(() => {
      /*
       * Las mallas del corredor se armaron al arrancar, cuando los modelos todavía
       * no estaban. Se reconstruyen una vez para que obstáculos y recolectables
       * usen ya su geometría real.
       */
      if (this.obstacles?.length) {
        disposeObstacleMeshes();
        buildObstacleMeshes(this.obstacles);
      }
      if (this.pickups?.length) {
        disposePickupMeshes();
        buildPickupMeshes(this.pickups);
      }
    });

    /*
     * ══════════════════════════════════════════════════════════
     * LA MÚSICA ARRANCA EN LA INTRO
     * ══════════════════════════════════════════════════════════
     *
     * ── Por qué en el primer gesto y no al cargar ──
     * Los navegadores crean el audio SUSPENDIDO hasta que el usuario interactúa. Si
     * se arranca al cargar, no suena nada hasta el siguiente clic — y el jugador
     * percibe que "la música empieza recién cuando toco pausa".
     *
     * Se engancha una sola vez al primer clic o tecla: ahí la música entra desde el
     * menú y acompaña toda la sesión, no sólo el vuelo.
     */
    const arrancarMusica = () => {
      if (music.sonando) return;
      music.asegurarContexto();
      music.setMudo(STATE.musicOff === true);
      music.start(0);
      // En el menú suena tranquila pero presente.
      music.setIntensidad(0.15);
    };
    window.addEventListener('pointerdown', arrancarMusica, { once: true, capture: true });
    window.addEventListener('keydown', arrancarMusica, { once: true, capture: true });

    /*
     * ══════════════════════════════════════════════════════════
     * VUELO CON EL CURSOR (experimento de escritorio)
     * ══════════════════════════════════════════════════════════
     *
     * ── La idea ──
     * En vez de A/D/W/S, el avión vuela hacia donde está el puntero. El centro de la
     * pantalla es neutro, el borde derecho gira a la derecha y el borde superior
     * sube el morro.
     *
     * ── Por qué el eje del teclado sigue sumando ──
     * El cursor no tiene posición "soltada": si el jugador deja el mouse en un
     * borde, el avión seguiría girando. La vigencia de 900 ms en `input.js` corta
     * eso, y el teclado queda como corrección fina cuando hace falta.
     */
    /*
     * ── En fase de CAPTURA ──
     *
     * ── Por qué ──
     * Con el escucha normal (burbuja), cualquier manejador intermedio que llame a
     * `stopPropagation` deja el evento sin llegar a `window` y el avión deja de
     * seguir el cursor sin ningún error visible.
     *
     * La captura corre de arriba hacia abajo ANTES del resto, así que el juego se
     * entera del movimiento pase lo que pase después.
     */
    /*
     * ── Se escuchan DOS eventos para el mismo dato ──
     *
     * ── Por qué los dos ──
     * `pointermove` puede no llegar cuando el gesto de apuntado dejó una CAPTURA DE
     * PUNTERO activa sobre el canvas: en ese caso el evento se redirige al elemento
     * que capturó y el seguimiento se queda sin datos sin dar ningún error.
     *
     * `mousemove` es un evento aparte que la captura de puntero no intercepta, así
     * que sirve como red de seguridad. Si los dos llegan, el segundo sólo reescribe
     * la misma posición.
     */
    const seguirCursor = (e) => {
      setPointerPosition(e.clientX, e.clientY);
    };
    this._followTouchId = null;
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      if (this.controller.phase !== PHASE.FLYING || !STATE.cursorFollow) return;
      if (e.target?.closest?.('#touch-controls, [data-ui-interactive]')) return;
      if (this._followTouchId === null) {
        this._followTouchId = e.pointerId;
        const sample = setTouchAnchor(e.clientX, e.clientY);
        this.touch?.showFloatingStick(sample.anchorX, sample.anchorY, sample.range);
      }
    }, { capture: true });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (e.pointerId === this._followTouchId && this.controller.phase === PHASE.FLYING && STATE.cursorFollow) {
          const sample = setTouchRelativePosition(e.clientX, e.clientY);
          if (sample) this.touch?.moveFloatingStick(sample);
        }
        return;
      }
      seguirCursor(e);
    }, { capture: true });
    const soltarDedoSeguir = (e) => {
      if (e.pointerType === 'touch' && e.pointerId === this._followTouchId) {
        this._followTouchId = null;
        this.touch?.hideFloatingStick();
        if (this.controller.phase === PHASE.FLYING && STATE.cursorFollow) {
          setPointerFollow(true); // vuelve a neutro al levantar el dedo
        }
      }
    };
    window.addEventListener('pointerup', soltarDedoSeguir, { capture: true });
    window.addEventListener('pointercancel', soltarDedoSeguir, { capture: true });
    window.addEventListener('mousemove', seguirCursor, { capture: true });

    /*
     * La RUEDA del mouse dispara la propulsión.
     *
     * `passive: false` es necesario para poder llamar a `preventDefault` y evitar
     * que el navegador haga scroll de la página al girar la rueda.
     */
    /*
     * ── La rueda NO depende del seguimiento del cursor ──
     *
     * Antes salía temprano si el seguimiento estaba apagado, y eso la hacía fallar
     * sin motivo: la propulsión con rueda sirve también volando con teclado.
     *
     * Ahora la única condición es estar volando.
     */
    /*
     * ── Clic central = propulsión ──
     *
     * Se pidió que sea al PRESIONAR la rueda y no al girarla: girar obliga a soltar
     * el mouse para moverlo, mientras que el clic central deja la mano en su lugar.
     *
     * `button === 1` es el botón central. Se usa `pointerdown` y no `click` porque
     * el clic central no dispara `click` en todos los navegadores.
     */
    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 1) return;
      if (this.controller.phase !== PHASE.FLYING) return;
      // Evita el autoscroll del navegador al apretar el botón central.
      e.preventDefault();
      this.controller.useThrust();
    }, { capture: true });

    /*
     * Se bloquea el autoscroll que dispara el clic central.
     *
     * Sin esto, el navegador entra en modo desplazamiento y el mouse deja de mover
     * el avión: parece que el juego "se soltó".
     */
    window.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault();
    }, { capture: true });

    /* Botones de la pantalla de derrota. */
    document.getElementById('btn-result-menu')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this._runWithInterstitialCheck(() => {
        this.exitStoryMode();
        this.controller.forceIdle();
        this.overlays.set(Screen.STANDBY);
      });
    });

    document.getElementById('btn-result-options')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      hide(UI.resultScreen);
      this.exitStoryMode();
      this.controller.forceIdle();
      this.overlays.set(Screen.STANDBY);
      this.syncOptionsPanel();
      mostrarPanel(optionsPanel);
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
      // Los totales acumulados también se reinician: si no, los logros quedarían.
      STATE.stats = statsVacios();
      STATE.aircraft = 'paper';
      /*
       * Se vacían las mejoras de TODAS las naves, no sólo de la activa.
       *
       * Las mejoras son por nave: borrar el progreso tiene que dejar a la flota
       * entera en cero, no sólo a la que está equipada.
       */
      STATE.upgrades = {};
      // Sin esto quedarían "compradas" las naves de un guardado anterior.
      STATE.aircraftOwned = [];
      STATE.story = sanitizeStorySave(null);
      STATE.ads = defaultAdsState();
      STATE.invertY = false;
      setTouchInvertY(false);
      this.syncOptionsPanel();
      this._syncShopAdUi?.();
      this.activeStoryLevel = null;
      this.controller?.setFinishDistance(null);
      initOwnedAircraft();
      this.persist();
      this.selector.sync();
      this.selector.syncDockLabel();
      this.view.setType(STATE.aircraft);
      this.shop.sync();
      this.syncCoins();
      this._syncEndlessLockUi?.();
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
      // GUARDA CLAVE: solo se empieza a apuntar desde IDLE y sin paneles/login abiertos.
      if (!this.controller.canAim()) return;
      if (this._hasBlockingLobbyPanel?.()) return;
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

      // Si se arrastra desde STANDBY, solo entra si está en Campaña o Endless ya desbloqueado.
      if (this.gestureStage === Screen.STANDBY) {
        if (!this.activeStoryLevel && !this._isEndlessUnlocked?.()) return;
        this.enterLaunchMode();
      }

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

      // M: activar/desactivar música en todo el juego (PC).
      if (e.code === 'KeyM') {
        e.preventDefault();
        this.toggleMusic();
        return;
      }

      // Esc: volver a la primera etapa (vista lateral con tienda y título).
      if (e.code === 'Escape') {
        e.preventDefault();
        /*
         * ── Esc durante el vuelo = PAUSA ──
         *
         * Congela la partida y la deja retomable: no se pierde el vuelo ni las
         * cargas. Volver a apretar Esc reanuda exactamente donde estaba.
         *
         * Se distingue del Esc de la etapa de apuntado, que sí aborta el lanzamiento
         * (ahí todavía no hay nada que conservar).
         */
        if (this.controller.phase === PHASE.FLYING) {
          this.setPaused(!this.paused);
          return;
        }
        if (this.controller.canAimEditable && this.overlays.current === Screen.AIM) {
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
      /*
       * ── Tecla O: modo diagnóstico ──
       *
       * Se reportaron choques contra "algo invisible" y una captura no alcanza: la
       * pantalla de derrota tapa la escena y el jugador no llega a fotografiar
       * contra qué chocó.
       *
       * O hace transparente TODA la interfaz y muestra en pantalla el motivo del
       * choque y el tipo de obstáculo. Es lo que convierte "chocué con algo" en un
       * dato reproducible.
       */
      if (e.code === 'KeyO') {
        e.preventDefault();
        document.body.classList.toggle('modo-diagnostico');
        this.syncDiagnostico();
        return;
      }

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
        this._runWithInterstitialCheck(() => {
          this.startRun({ fade: true });
        });
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
        if (this._hasBlockingLobbyPanel?.()) return;
        e.preventDefault();
        if (this.overlays.current !== Screen.AIM && !this.activeStoryLevel && !this._isEndlessUnlocked?.()) {
          this.showToast(`🔒 ${t('endlessLockedTitle')}`, t('endlessLockedHint'), 'mission');
          return;
        }
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
    if (this._hasBlockingLobbyPanel?.()) return;
    if (this.overlays.current !== Screen.AIM && !this.activeStoryLevel && !this._isEndlessUnlocked?.()) {
      this.showToast(`🔒 ${t('endlessLockedTitle')}`, t('endlessLockedHint'), 'mission');
      return;
    }
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

    /*
     * ── Vuelo con seguimiento del cursor (escritorio) ──
     *
     * Se activa al lanzar y se apaga al terminar el vuelo. El eje del teclado sigue
     * sumando, así que A/D y W/S funcionan como corrección fina.
     */
    /*
     * Se activa SIEMPRE: en el teléfono no hay mouse, así que no llega ningún
     * movimiento de puntero y el seguimiento queda inerte sin necesidad de una
     * condición extra. Con un detector de dispositivo, en cambio, alcanza con que
     * falle la detección para que la función no ande.
     */
    setPointerFollow(STATE.cursorFollow);
    /*
     * Log de diagnóstico.
     *
     * Sirve para distinguir de un vistazo si el problema es de la versión que está
     * corriendo o de los eventos que no llegan. Se puede borrar cuando el vuelo con
     * cursor quede estable.
     */
    console.info(
      '[papercrash] vuelo con cursor ' + (STATE.cursorFollow ? 'ACTIVO' : 'APAGADO') + ' · build ' + BUILD +
      ' · eventos recibidos hasta ahora: ' + pointerFollowInfo().eventos,
    );

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
          /*
           * Se activa acá y no sólo en `launch()`: así queda cubierto cualquier
           * camino que inicie un vuelo (un reinicio, una repetición, un salto de
           * pantalla) y no depende de haber pasado por un método puntual.
           */
          /*
           * Se respeta la PREFERENCIA del jugador.
           *
           * Acá estaba fijo en `true`, así que apagar el interruptor no servía:
           * al entrar en vuelo se volvía a encender igual.
           */
          setPointerFollow(STATE.cursorFollow);
          music.setModo('flight');
          music.setIntensidad(0.35, 30);
          // Al empezar el vuelo se vuelve al tramo 1: el avión sale de la
          // resortera, no de donde terminó el vuelo anterior.
          this.currentStage = -1;
          this.overlays.set(Screen.PLAYING);
          this.trail.clear();
        } else if (payload.phase === PHASE.IDLE) {
          // Al terminar el vuelo se suelta el cursor: si no, el avión del próximo
          // lanzamiento ya saldría girando hacia donde quedó el mouse.
          // Se apaga durante el reposo y se vuelve a aplicar al lanzar.
          setPointerFollow(false);
          this._followTouchId = null;
          this.touch?.hideFloatingStick();
          /*
           * La música NO se corta al terminar: sigue sonando en el resultado y en el
           * menú. Es la banda sonora de la sesión, no del vuelo.
           */
          music.setModo('menu');
          music.setIntensidad(0.15, 0);
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
        this.touch?.updateThrustCharges(payload.charges ?? 0);
        /*
         * Combustible: es el recurso que alarga el quemado.
         *
         * Se pinta junto con las cargas porque se gastan en la misma acción: si hay
         * cargas pero no combustible, conviene verlo antes de apretar y no después.
         */
        HUD.updateFuel(payload.fuel ?? 0, PROPULSION.FUEL_MAX);

        /*
         * ── La música responde a la velocidad ──
         *
         * 0.35 de la velocidad es "tranquilo" y el tope del modo es "a fondo". Con
         * eso el tempo sube, el filtro se cierra y la reverberación crece: la misma
         * pista se vuelve más rápida y más oscura a medida que el avión acelera.
         */
        {
          const st = payload.state ?? {};
          const x = st.x ?? 0;
          const vel = Math.hypot(st.vx ?? 0, st.vy ?? 0, st.vz ?? 0);
          const tope = PROPULSION.MAX_SPEED > 0 ? PROPULSION.MAX_SPEED : 90;

          /*
           * ── Crescendo por DISTANCIA ──
           *
           * Cada 2500 m sube un escalón de intensidad, hasta saturar a los 12.500 m.
           * Es el eje principal de la progresión: la música se va oscureciendo y
           * acelerando a medida que el corredor avanza, sin importar cuánto vuele el
           * jugador con cuidado.
           */
          const escalon = Math.min(1, x / 12500);

          /*
           * ── Y un extra por VELOCIDAD ──
           *
           * La velocidad aporta, pero no es indispensable: sin ella la música ya
           * progresó por distancia. Antes dependía SÓLO de la velocidad, así que
           * volar despacio dejaba el tema plano.
           */
          const porVelocidad = Math.max(0, (vel / tope - 0.28) / 0.72);

          music.setIntensidad(Math.min(1, escalon * 0.85 + porVelocidad * 0.35), vel);

          /*
           * ── Clima cada 2500 m ──
           *
           * Cambia de pista al cruzar cada tramo de 2500 m, SIN cortar el sonido: la
           * siguiente nota ya pertenece al clima nuevo. Así la progresión armónica
           * acompaña a la del tempo y la oscuridad.
           */
          music.setPista(Math.min(2, Math.floor(x / 2500)));
        }
        this.syncStage(payload.stage ?? 0, payload.state.x);
        this._missionTick = (this._missionTick || 0) + 1;
        if (this._missionTick % 10 === 0) {
          this.checkMissionsProgress();
        }
        break;

      /*
       * ── Cargador de aros ──
       *
       * Se muestran tantos segmentos encendidos como aros lleve el combo actual.
       * El total sale de la config, así que cambiarlo ahí ajusta también el HUD.
       */
      case 'ring': {
        HUD.setRingCharge(payload.total ?? 0, PICKUPS.BOOSTERS.RING_COMBO.EVERY);
        /*
         * Cada aro suma una nota de bajo.
         *
         * Es la semilla de la idea: que el bajista del tema sea el circuito y cada
         * aro atravesado aporte su nota.
         */
        music.ringPing(payload.total ?? 0);
        sfx.ring(payload.streak ?? 1);
        this.checkMissionsProgress();
        break;
      }

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
        this.cameraRig.triggerShake(0.35);
        for (let i = 0; i < 3; i++) {
          this.effects.ringBurst(payload.x + i * 1.2, payload.y + i * 0.6, payload.z);
        }
        this.effects.boosterBurst(payload.x, payload.y, payload.z);
        HUD.flashCombo?.();
        this.showToast('¡COMBO DE AROS!', '🚀 Súper Impulso + Carga', 'mission');
        this.checkMissionsProgress();
        break;

      case 'nearMiss':
        sfx.nearMiss();
        this.cameraRig.triggerShake(0.25);
        this.effects.nearMiss(payload.x, payload.y, payload.z);
        HUD.updateCoins(STATE.coins + (this.controller.stats?.coins ?? 0));
        this.showNearMissPop(payload.x, payload.y, payload.z, payload.bonusCoins);
        this.checkMissionsProgress();
        break;

      case 'coin':
        sfx.coin(payload.value);
        this.effects.coinPop(payload.pickup.x, payload.pickup.y, payload.pickup.z, payload.value);
        // El HUD de monedas muestra lo del vuelo; el global se acredita al final.
        HUD.updateCoins(STATE.coins + payload.coins);
        this.checkMissionsProgress();
        break;

      case 'booster':
        sfx.booster();
        // El booster ya no empuja: CARGA una propulsión. El aviso es la carga,
        // no un impulso.
        HUD.updateCharges(payload.charges, PROPULSION.MAX_CHARGES, true);
        this.touch?.updateThrustCharges(payload.charges);
        this.checkMissionsProgress();
        break;

      case 'thrust':
        sfx.thrust();
        this.cameraRig.triggerShake(0.28);
        HUD.updateCharges(payload.charges, PROPULSION.MAX_CHARGES, false);
        this.touch?.updateThrustCharges(payload.charges);
        // El empujón de morro arriba tiene su propio aviso: el jugador tiene que
        // notar que la combinación hizo algo distinto.
        if (payload.climbed) this.overlays.flash(0.18);
        this.checkMissionsProgress();
        break;

      case 'bounce':
        sfx.bounce(clamp(payload.speed / 12, 0, 1));
        this.overlays.flash(0.25);
        break;

      case 'impact': {
        if (payload.cause === 'finish') {
          sfx.missionComplete();
          music.setModo('menu');
          this.overlays.flash(0.25);
          this.scheduleResult();
          break;
        }
        const severity = clamp(payload.speed / 30, 0, 1);
        sfx.crash(severity);
        music.onCrash(severity);
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

    if (this._suspendBg || (typeof document !== 'undefined' && document.hidden)) {
      this.lastTime = now;
      return;
    }

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

    if (this.controller.phase === PHASE.FLYING && this.controller.flight) {
      const fl = this.controller.flight;
      this.effects.updateSpeedLines(fl.x, fl.y, fl.z, fl.vx, fl.vy, fl.vz, dt);
    } else {
      this.effects.updateSpeedLines(0, 0, 0, 0, 0, 0, dt);
    }

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
      updateEnvironmentScenery(x);

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
    const focusX = this.controller.phase === PHASE.FLYING ? (this.controller.flight?.x ?? 0) : 0;
    updatePickupMeshes(this.pickups, dt, this.pickupClock, focusX);

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
