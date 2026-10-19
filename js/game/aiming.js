/**
 * PAPERCRASH — game/aiming.js
 * ============================================================
 * Sistema de puntería de 2 ejes + previsualización de trayectoria.
 *
 * ── Esquema de control (lo que pidió el jugador) ──
 *   · Arrastrar HACIA ATRÁS  → carga POTENCIA (cuánto se estira la banda).
 *   · Arrastrar ARRIBA/ABAJO → PITCH (altura de salida del lanzamiento).
 *   · Arrastrar IZQ/DER      → AZIMUT (dirección lateral del avión).
 *
 * Los ejes se normalizan POR SEPARADO (cada uno con su propio rango de
 * píxeles). Si se normalizara la distancia total para los tres, arrastrar
 * mucho hacia atrás dejaría sin recorrido al control vertical.
 *
 * Convención del azimut: es "dirección de tiro" al estilo resortera.
 * Arrastrar hacia la izquierda apunta el avión hacia la derecha, igual que
 * al estirar una goma. El pitch en cambio es directo: arriba = más alto.
 *
 * ── Previsualización ──
 * La línea punteada blanca translúcida se calcula con el MISMO núcleo de
 * física que el vuelo real (physics/trajectory.js → flightModel.js). No
 * puede desincronizarse.
 * ============================================================
 */
import { scene } from '../core/engine.js';
import { AIM, LAUNCH_POS, TRAJECTORY } from '../config.js';
import { clamp, remap, degToRad } from '../core/math.js';
import { computeTrajectory } from '../physics/trajectory.js';
/**
 * @typedef {Object} AimState
 * @property {number} pitchDeg
 * @property {number} azimuthDeg
 * @property {number} power01   0..1
 * @property {number} powerPct  0..100
 * @property {number} speed     m/s resultantes
 * @property {number} pullPx    distancia de arrastre normalizada para la potencia
 * @property {{x:number,y:number,z:number}} offset  desplazamiento visual del avión
 * @property {import('../physics/trajectory.js').TrajectoryResult|null} preview
 */

const DEG = 180 / Math.PI;

export class AimingSystem {
  /** @param {() => import('../physics/specs.js').FlightSpec} getSpec */
  /** @param {() => import('../physics/flightModel.js').FlightParams} getParams */
  /** @param {() => object} getMods */
  /**
   * @param {() => object} getSpec @param {() => object} getParams @param {() => object} getMods
   * @param {((estado: object) => void)} [onAimChanged]  avisa que cambió la puntería
   */
  constructor(getSpec, getParams, getMods, onAimChanged) {
    this.getSpec = getSpec;
    this.getParams = getParams;
    this.getMods = getMods;
    /** Se llama cada vez que la puntería cambia, para que el modo recolore sus ayudas. */
    this.onAimChanged = onAimChanged;

    /** @type {AimState} */
    this.state = {
      pitchDeg: AIM.PITCH_DEFAULT,
      azimuthDeg: 0,
      power01: 0,
      powerPct: 0,
      speed: 0,
      pullPx: 0,
      offset: { x: 0, y: 0, z: 0 },
      preview: null,
    };

    /** @type {{x:number,y:number}|null} */
    this.origin = null;
    this.dragging = false;
    /** Distancia total del último arrastre (para el umbral de lanzamiento). */
    this.totalPullPx = 0;
    /**
     * La previsualización solo se dibuja mientras esto sea true. Es un flag
     * aparte de `dragging` porque `refresh()` también se llama fuera de un
     * arrastre (cambio de nave, compra de mejoras) y no debe mostrar la línea.
     */
    this.previewEnabled = false;

    this.buildPreviewObjects();
  }

  /**
   * Geometría de un CHEVRÓN: la puntita de flecha ">".
   *
   * Se arma con dos barras inclinadas en el plano XY. La punta apunta hacia +X,
   * que es el sentido de avance del mundo, así que orientarla después es sólo
   * rotar el objeto.
   *
   * @returns {object} geometría compartida
   */
  buildChevronGeometry() {
    const s = TRAJECTORY.CHEVRON.SIZE;
    const partes = [];

    // Dos barras en "V" abierta hacia atrás.
    for (const signo of [1, -1]) {
      const g = new THREE.BoxGeometry(s * 1.05, s * 0.19, s * 0.19);
      // Se inclinan para formar la punta: el extremo trasero se abre.
      g.rotateZ(signo * 0.62);
      g.translate(-s * 0.36, signo * s * 0.3, 0);
      partes.push(g);
    }

    /*
     * Se fusionan a mano en una sola geometría.
     *
     * Three.js no trae unir geometrías sin cargar un módulo extra, y acá son dos
     * cajas: se copian sus vértices a un buffer propio. Una geometría por chevrón
     * en vez de dos mallas por chevrón, y una SOLA compartida por los 24 de la
     * hilera.
     */
    const total = partes.reduce((acc, g) => acc + g.attributes.position.count, 0);
    const pos = new Float32Array(total * 3);
    let off = 0;
    for (const g of partes) {
      pos.set(g.attributes.position.array, off);
      off += g.attributes.position.count * 3;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geo;
  }

  // ── Escena de la vista previa ─────────────────────────────
  buildPreviewObjects() {
    const maxPoints = TRAJECTORY.MAX_POINTS;

    // Línea punteada blanca translúcida (Dash es la única primitiva de
    // Three.js que soporta guiones reales, y necesita lineDistances).
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3));
    const mat = new THREE.LineDashedMaterial({
      color: TRAJECTORY.COLOR,
      transparent: true,
      opacity: TRAJECTORY.OPACITY,
      dashSize: TRAJECTORY.DASH_SIZE,
      gapSize: TRAJECTORY.GAP_SIZE,
      depthWrite: false,
    });
    this.dashLine = new THREE.Line(geo, mat);
    this.dashLine.frustumCulled = false;
    // Arranca OCULTA. Sin esto, la geometría (toda en el origen) se dibujaría
    // como una línea de longitud cero sobre la resortera antes de arrastrar.
    this.dashLine.visible = false;
    this.dashLine.renderOrder = 5;
    scene.add(this.dashLine);

    /*
     * ── La hilera de FLECHAS ──
     *
     * Se pidió que la previsión no fueran guiones sino flechas: "una línea
     * punteada pero en vez de guiones, esas flechas".
     *
     * La línea de guiones SE MANTIENE y se dibuja debajo: es la que da la
     * continuidad del trazo. Los chevrones van encima, marcando el sentido. Con
     * flechas solas el arco se lee como puntos sueltos y no como una trayectoria.
     */
    const chevronGeo = this.buildChevronGeometry();
    const chevronMat = new THREE.MeshBasicMaterial({
      color: TRAJECTORY.CHEVRON.COLOR,
      transparent: true,
      opacity: TRAJECTORY.CHEVRON.OPACITY,
      depthWrite: false,
    });
    this.chevrons = new THREE.InstancedMesh(chevronGeo, chevronMat, TRAJECTORY.CHEVRON.COUNT);
    this.chevrons.frustumCulled = false;
    this.chevrons.visible = false;
    this.chevrons.renderOrder = 6;
    // Sin esto, las instancias no usadas se dibujarían en el origen.
    this.chevrons.count = 0;
    scene.add(this.chevrons);
    this.chevronMatrix = new THREE.Matrix4();
    this.chevronQuat = new THREE.Quaternion();
    this.chevronPos = new THREE.Vector3();
    this.chevronScale = new THREE.Vector3();
    this.chevronForward = new THREE.Vector3();
    this.chevronUp = new THREE.Vector3(0, 1, 0);

    // Marcador del punto de impacto.
    const markerGeo = new THREE.TorusGeometry(TRAJECTORY.MARKER_RADIUS, 0.09, 6, 20);
    markerGeo.rotateX(Math.PI / 2);
    const markerMat = new THREE.MeshBasicMaterial({
      color: TRAJECTORY.COLOR,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.impactMarker = new THREE.Mesh(markerGeo, markerMat);
    this.impactMarker.visible = false;
    this.impactMarker.renderOrder = 5;
    scene.add(this.impactMarker);
  }

  get active() {
    return this.dragging;
  }

  // ── Ciclo de vida del gesto ───────────────────────────────
  /**
   * Comienza un arrastre. Si ya había uno en curso se reinicia el origen,
   * lo que permite "reajustar" la puntería sin soltar.
   * @param {number} x @param {number} y
   */
  begin(x, y) {
    this.origin = { x, y };
    this.dragging = true;
    this.update(x, y);
  }

  /** Actualiza la puntería con la posición actual del puntero. */
  move(x, y) {
    if (!this.dragging || !this.origin) return;
    this.update(x, y);
  }

  /**
   * Finaliza el gesto.
   * @returns {{shouldLaunch:boolean, aim:AimState}}
   */
  end() {
    const wasDragging = this.dragging;
    const power = this.state.powerPct;
    this.dragging = false;
    this.origin = null;
    this.hidePreview();

    const totalPx = this.totalPullPx;
    const shouldLaunch = wasDragging
      && totalPx >= AIM.DEADZONE_PX
      && power >= AIM.MIN_POWER_TO_LAUNCH;

    return { shouldLaunch, aim: this.state, totalPx };
  }

  /** Cancela sin lanzar (pérdida de foco, etc.). */
  cancel() {
    this.dragging = false;
    this.origin = null;
    this.hidePreview();
  }

  /** Vuelve a la puntería por defecto. */
  reset() {
    this.dragging = false;
    this.origin = null;
    this.state.pitchDeg = AIM.PITCH_DEFAULT;
    this.state.azimuthDeg = 0;
    this.state.power01 = 0;
    this.state.powerPct = 0;
    this.state.pullPx = 0;
    this.state.offset = { x: 0, y: 0, z: 0 };
    this.state.preview = null;
    this.totalPullPx = 0;
    this.recomputeSpeed();
    this.hidePreview();
  }

  // ── Cálculo de la puntería ────────────────────────────────
  /**
   * Traduce el delta de pantalla a dirección / altura / potencia.
   *
   * El gesto se descompone sobre los EJES DE PANTALLA, que son perpendiculares
   * por construcción:
   *
   *   · IZQUIERDA / DERECHA → dirección (azimut).
   *   · ARRIBA / ABAJO      → altura de salida (pitch).
   *   · CUÁNTO SE TIRA      → potencia.
   *
   * Ver el detalle dentro del método.
   *
   * @param {number} x @param {number} y
   */
  update(x, y) {
    const dx = x - this.origin.x; // + = derecha
    const dy = y - this.origin.y; // + = abajo (coordenadas de pantalla)

    // ============================================================
    //  Como se reparten los tres controles sobre un solo arrastre
    // ============================================================
    //
    //  Se usan los ejes de la PANTALLA, no los del mundo. En pantalla
    //  "derecha" y "arriba" son perpendiculares por construccion, asi que la
    //  descomposicion es exacta y los controles quedan desacoplados.
    //
    //  Se probo a proyectar sobre la base de la camara y sobre el rumbo del
    //  avion: en ambos casos los ejes quedaban oblicuos y arrastrar hacia
    //  atras movia tambien la direccion. Los ejes de pantalla son la opcion
    //  simple y sin acoplamiento.
    //
    //    ARRIBA / ABAJO  -> forma del vuelo (rasante <-> con arco)
    //    IZQ / DERECHA   -> direccion (azimut)
    //    CUANTO SE TIRA  -> potencia, o sea DISTANCIA
    //
    const screenRight = dx;
    const screenUp = -dy; // dy crece hacia abajo

    const pull = Math.hypot(dx, dy);
    this.totalPullPx = pull;

    // 1) POTENCIA — magnitud del estiramiento de la banda.
    //
    //    Es el control de DISTANCIA: la velocidad de salida entra al cuadrado
    //    en la sustentacion, asi que la potencia manda mucho mas que el angulo
    //    (medido: x3.6 contra x1.25 en tools/calibrate-flight.mjs).
    this.state.power01 = clamp(pull / AIM.POWER_RANGE_PX, 0, 1);
    this.state.powerPct = this.state.power01 * 100;
    this.state.pullPx = pull;

    // 2) DIRECCION — solo la componente HORIZONTAL. Al depender de un unico
    //    eje, cualquier gesto vertical da direccion CERO: eso es lo que
    //    elimina el giro parasitario de arrastrar hacia atras.
    //
    //    Convencion: arrastrar a la DERECHA apunta el avion a la DERECHA, que
    //    es lo que el jugador espera al ver la pantalla.
    const lateralT = clamp(screenRight / AIM.AZIMUTH_REFERENCE_PX, -1, 1);
    this.state.azimuthDeg = remap(lateralT, -1, 1, AIM.AZIMUTH_MIN, AIM.AZIMUTH_MAX);

    // 3) FORMA DEL VUELO — manda la componente VERTICAL.
    //
    //    Convencion (pedida explicitamente): arrastrar hacia ARRIBA aplana la
    //    salida y arrastrar hacia ABAJO levanta el morro.
    //
    //    El signo esta invertido respecto de la version anterior, y era el
    //    problema de fondo: antes arrastrar arriba empinaba el tiro, y como el
    //    alcance depende sobre todo de la potencia, el jugador terminaba
    //    subiendo muchisimo y avanzando poco. Ahora "apuntar lejos" es
    //    arrastrar arriba, que ademas es lo intuitivo: la linea punteada se
    //    estira hacia el horizonte.
    //
    //    Ya NO se suma nada por el estiramiento de la banda: la potencia es el
    //    control de distancia y mezclarla con el angulo confundia los dos ejes.
    const verticalT = clamp(screenUp / AIM.ELEVATION_RANGE_PX, -1, 1);
    /*
     * El centro del control lo fija el SESGO, no una constante.
     *
     * `AIM.PITCH_BIAS` lo escribe el juego al empezar cada vuelo con el ángulo
     * que corresponde al tramo actual. Sin esto, el neutro quedaba en 38° para
     * todo el corredor: en el primer tramo (rasante, línea a 15 m) el jugador
     * tenía que arrastrar hacia arriba en cada lanzamiento sólo para no subir de
     * más, que es exactamente lo contrario de "neutro".
     */
    const center = AIM.PITCH_DEFAULT + AIM.PITCH_BIAS;
    this.state.pitchDeg = clamp(
      center - verticalT * AIM.PITCH_ELEVATION_SPAN,
      AIM.PITCH_MIN,
      AIM.PITCH_MAX,
    );

    // 4) Desplazamiento visual del modelo mientras se carga la banda.
    //
    //    El avion NUNCA sube por encima de LAUNCH_POS: el origen de la fisica
    //    es fijo, asi que elevarlo provocaria un salto al soltar. La altura de
    //    salida se comunica con la inclinacion del morro.
    const depth = this.state.power01;
    const pitch = degToRad(this.state.pitchDeg);
    const lateralRatio = this.state.azimuthDeg / AIM.AZIMUTH_MAX;
    this.state.offset = {
      x: -Math.cos(pitch) * depth * AIM.MAX_PULL_VISUAL,
      y: -Math.abs(Math.sin(pitch)) * depth * AIM.MAX_PULL_DROP,
      z: lateralRatio * depth * AIM.MAX_PULL_VISUAL * 0.6,
    };

    this.recomputeSpeed();
    this.refresh();
  }

  /** Velocidad de salida según la potencia y las mejoras actuales. */
  recomputeSpeed() {
    const spec = this.getSpec();
    const mods = this.getMods();
    this.state.speed = (spec.baseSpeed + this.state.power01 * spec.speedRange) * mods.launchPowerMult;
  }

  /**
   * Recalcula la previsualización.
   *
   * Se puede llamar en cualquier momento (al cambiar de aeronave, al comprar
   * una mejora, al reiniciar) porque el DIBUJO respeta `previewEnabled`: si no
   * se está apuntando, calcula los datos pero deja la línea oculta. Sin esa
   * separación, refrescar la previsión fuera de un arrastre hacía aparecer la
   * línea punteada sobre la resortera.
   */
  /**
   * Recalcula la previsualización con la puntería actual.
   *
   * Si NO hay un gesto en curso, además recompone el ángulo desde el sesgo
   * vigente. Es lo que permite que el neutro siga al tramo: `setPitchBias`
   * cambia el sesgo y después basta con refrescar, sin que el jugador tenga que
   * mover el mouse para que el cambio se note.
   */
  refresh() {
    const spec = this.getSpec();
    const params = this.getParams();

    if (!this.dragging) {
      const center = AIM.PITCH_DEFAULT + AIM.PITCH_BIAS;
      this.state.pitchDeg = clamp(center, AIM.PITCH_MIN, AIM.PITCH_MAX);
      this.recomputeSpeed();
    }

    const { pitchDeg, azimuthDeg, speed } = this.state;
    const preview = computeTrajectory(spec, params, pitchDeg, azimuthDeg, speed);
    this.state.preview = preview;
    this.drawPreview(preview);
    /*
     * Se avisa que la puntería cambió.
     *
     * Lo usa el modo frenético para recolocar sus flechas de dirección: sin este
     * aviso sólo se actualizaban al arrancar el vuelo, así que quedaban mostrando
     * el ángulo viejo mientras el jugador movía el dedo.
     */
    this.onAimChanged?.(this.state);
  }

  /**
   * Calcula los ejes del arrastre en espacio de PANTALLA.
   *
   *   · `neutralAxis`: dirección de pantalla hacia la CÁMARA, es decir hacia
   *     donde el jugador "tira hacia sí mismo". Es el eje neutro del azimut.
   *   · `forwardAxis`: la dirección opuesta (alejándose de la cámara), que es
   *     la dirección de lanzamiento. Sobre ella se mide "cuánto se estiró".
   *
   * Se obtienen proyectando puntos del mundo a píxeles. Es necesario porque
   * la cámara mira la resortera en diagonal: en pantalla, "hacia atrás" NO es
   * la horizontal izquierda.
   *
   * ── Por qué NO se usa Vector3.project() ──
   * `project()` divide por la componente w. Para la POSICIÓN DE LA CÁMARA esa
   * w vale exactamente cero (el punto está sobre el plano de la cámara), así
   * que devuelve NaN. Se usa una proyección lineal con la base ortonormal de
   * la cámara, que es exacta para puntos delante de ella y no tiene
   * singularidad.
   *
   * Detalle que también importaba: el eje se mide entre la proyección del
   * ORIGEN de lanzamiento y la de la CÁMARA, no contra el origen del mundo.
   * Comparar contra el origen del mundo daba un eje casi vertical.
   *
   * Si la cámara no está disponible (o algo se degenera) se conservan los
   * valores anteriores, así que la puntería nunca se rompe por esto.
   */
  /**
   * Vuelca los puntos calculados en la geometría de la escena.
   * @param {import('../physics/trajectory.js').TrajectoryResult} preview
   */
  drawPreview(preview) {
    const pts = preview.points;
    const n = Math.min(pts.length, TRAJECTORY.MAX_POINTS);
    const attr = this.dashLine.geometry.attributes.position;

    // Si hay menos puntos que el buffer, los sobrantes se colapsan sobre el
    // último para que no quede un segmento colgando hacia el origen.
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    const last = pts[Math.max(0, n - 1)] ?? { x: LAUNCH_POS.x, y: LAUNCH_POS.y, z: 0 };
    for (let i = n; i < attr.count; i++) {
      attr.setXYZ(i, last.x, last.y, last.z);
    }
    attr.needsUpdate = true;
    this.dashLine.geometry.setDrawRange(0, Math.max(2, n));

    // `computeLineDistances` es obligatorio para que el guionado funcione.
    this.dashLine.computeLineDistances();

    /*
     * La GEOMETRÍA se mantiene siempre al día (así el primer frame de un
     * arrastre ya muestra la trayectoria correcta), pero la VISIBILIDAD depende
     * de dos cosas: que se esté apuntando Y que el modo use línea punteada.
     *
     * En el modo frenético la dirección se muestra con flechas detrás de la nave
     * (ver `world/directionArrows.js`), así que acá no se dibuja nada. La
     * geometría se sigue actualizando igual porque el panel de puntería lee el
     * alcance previsto de `preview`, que sí se necesita.
     */
    const usaLinea = TRAJECTORY.STYLE === 'dashed';
    this.dashLine.visible = usaLinea && this.previewEnabled && n > 1;

    /*
     * ── Colocación de los chevrones ──
     *
     * Se reparten por LONGITUD DE ARCO, no por índice de punto: la previsión
     * muestrea por tiempo, así que los puntos se juntan al principio y se separan
     * al final. Repartiendo por índice las flechas quedarían apretadas en el
     * lanzamiento y dispersas en el impacto.
     */
    /*
     * ── Las flechas se dibujan SIN importar el estilo de la línea ──
     *
     * ── El bug que esto arregla ──
     * La condición era `!usaLinea`, y `usaLinea` vale `STYLE === 'dashed'`. Como el
     * modo frenético usa `'arrows'`, `usaLinea` es FALSO y las flechas nunca se
     * dibujaban: la previsualización quedaba vacía, sin línea y sin flechas.
     *
     * La línea punteada y las flechas son cosas distintas: la línea da
     * continuidad y las flechas el sentido. La flecha sólo necesita que la
     * previsualización esté activa y que haya puntos.
     */
    if (!this.previewEnabled || n < 2) {
      this.chevrons.visible = false;
      this.chevrons.count = 0;
    } else {
      const paso = TRAJECTORY.CHEVRON.SPACING;
      let acumulado = 0;
      let colocadas = 0;
      let proxima = TRAJECTORY.CHEVRON.FIRST_AT;

      for (let i = 1; i < n && colocadas < TRAJECTORY.CHEVRON.COUNT; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        acumulado += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        if (acumulado < proxima) continue;

        // Dirección del tramo, normalizada.
        const dx = b.x - a.x; const dy = b.y - a.y; const dz = b.z - a.z;
        const largo = Math.hypot(dx, dy, dz);
        if (largo < 1e-6) continue;
        this.chevronForward.set(dx / largo, dy / largo, dz / largo);

        this.chevronPos.set(b.x, b.y, b.z);
        /*
         * Orientación: el chevrón nace mirando a +X, así que se rota desde +X
         * hasta la dirección del tramo. Se usa `setFromUnitVectors`, que resuelve
         * el caso general sin construir una base completa.
         */
        this.chevronQuat.setFromUnitVectors(this.chevronForward, this.chevronForward);
        this.chevronQuat.setFromUnitVectors(
          new THREE.Vector3(1, 0, 0),
          this.chevronForward,
        );

        // Se agrandan con la distancia: si no, los lejanos son invisibles.
        const escala = 1 + Math.min(1, acumulado / 120) * TRAJECTORY.CHEVRON.GROW;
        this.chevronScale.set(escala, escala, escala);

        this.chevronMatrix.compose(this.chevronPos, this.chevronQuat, this.chevronScale);
        this.chevrons.setMatrixAt(colocadas, this.chevronMatrix);
        colocadas++;

        // El próximo va un paso más adelante, y se salta lo que sobra.
        proxima += paso;
      }

      this.chevrons.count = colocadas;
      this.chevrons.instanceMatrix.needsUpdate = true;
      this.chevrons.visible = colocadas > 0;
    }

    // Marcador de impacto: solo si la trayectoria realmente toca el suelo.
    if (usaLinea && this.previewEnabled && preview.hitGround && n > 1) {
      this.impactMarker.position.set(last.x, last.y + 0.06, last.z);
      this.impactMarker.visible = true;
    } else {
      this.impactMarker.visible = false;
    }
  }

  /**
   * Muestra u oculta la previsualización, sin tocar los datos calculados.
   *
   * Es un flag APARTE de `dragging` porque `refresh()` también se llama fuera
   * de un arrastre (cambio de nave, compra de mejoras, reinicio) y en esos
   * casos la línea debe quedar oculta aunque los datos estén al día.
   *
   * Lo invoca `RunController`, que es quien conoce la fase del juego. Los
   * nombres de ambos lados deben coincidir: `assertApi()` en `main.js` avisa
   * al arrancar si esta interfaz se rompe.
   */
  setPreviewEnabled(enabled) {
    this.previewEnabled = Boolean(enabled);
    if (this.previewEnabled) {
      if (this.state.preview) this.drawPreview(this.state.preview);
    } else {
      this.hidePreview();
    }
  }

  hidePreview() {
    this.dashLine.visible = false;
    if (this.chevrons) {
      this.chevrons.visible = false;
      this.chevrons.count = 0;
    }
    this.impactMarker.visible = false;
  }

  // ── Vector de lanzamiento ─────────────────────────────────
  /** Aceleración de sustentación disponible (para la UI de diagnóstico). */
  get liftCap() {
    return this.getParams().liftCap;
  }

  /** Pitch en radianes (útil para orientar el modelo). */
  get pitchRad() {
    return degToRad(this.state.pitchDeg);
  }

  get pitchDegLabel() {
    return `${Math.round(this.state.pitchDeg)}°`;
  }

  get azimuthDegLabel() {
    const a = this.state.azimuthDeg;
    if (Math.abs(a) < 1) return '0°';
    return `${a > 0 ? '▶' : '◀'} ${Math.abs(Math.round(a))}°`;
  }

  get powerLabel() {
    return `${Math.round(this.state.powerPct)}%`;
  }

  dispose() {
    for (const obj of [this.dashLine, this.impactMarker, this.chevrons]) {
      scene.remove(obj);
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    }
    this.dashLine = null;
    this.impactMarker = null;
  }
}

export { DEG };
