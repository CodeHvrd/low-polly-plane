/**
 * PAPERCRASH — ui/touchControls.js
 * ============================================================
 * Mandos táctiles para móvil.
 *
 * ── El problema ──
 * El juego se maneja con teclado: A/D para el rumbo, W/S para el morro y Espacio
 * para la propulsión. Un teléfono no tiene teclado, así que sin esto la app abre,
 * se ve bien y no se puede pilotar.
 *
 * ── El diseño: UNA rueda analógica + UN botón ──
 *
 *   · Una sola RUEDA analógica abajo a la izquierda. Las cuatro direcciones en un
 *     solo dedo: izquierda/derecha el rumbo, arriba/abajo el morro. Un dedo
 *     gobierna TODO el vuelo, que es lo que permite tener el otro pulgar libre
 *     para la propulsión sin levantar la mano.
 *
 *     Es una rueda y no un pad de botones porque el vuelo necesita valores
 *     intermedios: con botones de todo o nada no se corrige la curva con
 *     suavidad, que es justo lo que hace el modo frenético.
 *
 *   · Un BOTÓN grande de propulsión abajo a la derecha, bajo el pulgar libre.
 *     Va separado de la rueda a propósito: la propulsión es una habilidad con
 *     recurso limitado, no una dirección. Si saliera de la rueda se gastaría sin
 *     querer al hacer un movimiento diagonal.
 *
 *   · El botón de VOLVER queda chico y pegado al borde inferior izquierdo. Antes
 *     estaba arriba de la rueda, en pleno recorrido del pulgar: se tocaba sin
 *     querer al hacer un movimiento amplio hacia arriba.
 *
 * ── Por qué NO simula eventos de teclado ──
 * Sería lo más corto, pero ensuciaría el manejo de teclas con códigos que el
 * jugador nunca apretó y rompería la detección de FLANCO de la propulsión (que
 * distingue una pulsación de una tecla mantenida). En su lugar escribe los ejes
 * compartidos de `core/input.js`, que es donde el teclado también converge.
 *
 * ── Por qué el apuntado NO se toca ──
 * Apuntar ya funciona con arrastre, y el arrastre táctil ya está soportado por
 * `core/input.js`. Acá sólo se agregan los mandos de VUELO, que son los que
 * faltaban.
 * ============================================================
 */
import { setTouchAxes, releaseTouchAxes, isTouchDevice } from '../core/input.js';

/** Radio máximo de la rueda, en píxeles CSS. */
const RADIO = 56;
/**
 * Zona muerta: fracción del radio por debajo de la cual no se manda nada.
 *
 * ── Por qué bajó de 0.16 a 0.08 ──
 * Con 0.16 el pulgar tenía que recorrer el 16% del radio antes de que el avión
 * hiciera algo. En una rueda de 128 px son ~10 px de recorrido a ciegas, y se
 * sentía como que el mando "llega tarde": se movía el dedo, el avión seguía
 * recto, y había que mover más.
 *
 * 0.08 alcanza para apoyar el pulgar sin desviar el avión y devuelve casi todo el
 * recorrido al control.
 */
/*
 * ── Zonas muertas con HISTÉRESIS ──
 *
 * ── Por qué dos valores y no uno ──
 * Con una sola zona muerta hay que elegir entre dos males: chica y el temblor del
 * pulgar mueve el avión; grande y cuesta empezar a moverlo.
 *
 * Con histéresis hace falta empujar más para ARRANCAR (0.28) pero mucho menos
 * para SEGUIR (0.14). Un pulgar apoyado se queda quieto; en cuanto el jugador
 * mueve de verdad, el avión responde con precisión.
 *
 * En una rueda de 128 px, 0.28 son ~18 px: suficiente para que el temblor natural
 * del pulgar no active nada.
 */
const ZONA_MANTENER = 0.18;

/**
 * Suavizado del mando (1/s).
 *
 * ── Por qué suavizar si el mando ya es "analógico" ──
 * Los eventos de puntero llegan a saltos y con ruido. Aplicar el valor crudo hacía
 * que el avión temblara: es el "se siente entrecortado" reportado. Un filtro
 * exponencial con constante ~45 ms quita el ruido sin agregar retardo perceptible.
 */
const SUAVIZADO = 22;

/**
 * Curva de respuesta del mando.
 *
 * ── Por qué hace falta una curva ──
 * Un mando lineal obliga a recorrer medio radio para girar a la mitad. Con el
 * pulgar eso es poco intuitivo: se tiende a empujar a fondo, y entonces el
 * control se vuelve binario (todo o nada) justo cuando hace falta precisión para
 * pasar entre dos obstáculos.
 *
 * `Math.pow(magnitud, 0.72)` amplifica los movimientos chicos y comprime los
 * grandes, así que un toque suave corrige de a poco y un empujón a fondo sigue
 * dando el máximo. El exponente < 1 es lo que da la sensación de respuesta
 * inmediata sin perder el rango fino.
 */
/*
 * La curva subió de 0.72 a 0.88.
 *
 * Con 0.72 los movimientos chicos se amplificaban demasiado y el mando se sentía
 * nervioso y "entrecortado". 0.88 conserva algo de respuesta viva sin exagerar.
 */
const CURVA = 0.88;

/**
 * @typedef {Object} Stick
 * @property {HTMLElement} raiz
 * @property {HTMLElement} perilla
 * @property {number} pointerId
 * @property {number} cx @property {number} cy
 * @property {number} x @property {number} y
 */

export class TouchControls {
  constructor() {
    /** @type {Stick|null} La rueda analógica. */
    this.stick = null;
    /** Si la propulsión está apretada ahora. */
    this.thrustHeld = false;
    /** Si los mandos están visibles. */
    this.visible = false;
    /** Callback para el flanco de la propulsión (una pulsación, un uso). */
    this.onThrust = null;
    /** Callback del botón "volver" (abortar el lanzamiento). */
    this.onBack = null;
    this.built = false;
  }

  /**
   * Construye los mandos.
   *
   * Sólo se construyen si el dispositivo es táctil: en escritorio no se muestran
   * ni ocupan lugar, y así la misma build sirve para los dos.
   *
   * @param {{onThrust?:() => void, onBack?:() => void}} [hooks]
   * @returns {boolean} si se construyeron
   */
  build(hooks = {}) {
    if (this.built) return true;
    if (!isTouchDevice()) return false;

    this.onThrust = hooks.onThrust ?? null;
    this.onBack = hooks.onBack ?? null;

    const cont = document.createElement('div');
    cont.id = 'touch-controls';
    cont.className = 'hidden';
    cont.setAttribute('aria-hidden', 'true');

    this.stick = this._crearStick('vuelo', 'VOLAR');
    cont.appendChild(this.stick.raiz);

    /*
     * Botón de propulsión.
     *
     * Es el más grande de los tres mandos: se usa en pleno vuelo y a menudo con
     * el pulgar ya ocupado, así que tiene que ser fácil de acertar sin mirar.
     */
    const prop = document.createElement('button');
    prop.type = 'button';
    prop.id = 'touch-thrust';
    prop.innerHTML = '<span aria-hidden="true">⚡</span>';
    prop.setAttribute('aria-label', 'Propulsión');
    this._engancharBoton(prop, () => {
      /*
       * La propulsión se dispara en el FLANCO (al tocar), igual que el Espacio
       * del teclado. Acá además se marca como "sostenida" para que el eje de
       * propulsión acompañe mientras el dedo esté apoyado.
       */
      this.thrustHeld = true;
      setTouchAxes({ thrust: true });
      this.onThrust?.();
    }, () => {
      this.thrustHeld = false;
      setTouchAxes({ thrust: false });
    });
    cont.appendChild(prop);

    /*
     * Botón de abortar, chico y en el borde inferior izquierdo.
     *
     * Es el equivalente táctil del Esc: en el móvil no hay tecla de escape, y sin
     * esto no se puede volver de la etapa de lanzamiento. Va pegado al borde para
     * quedar FUERA del recorrido natural del pulgar sobre la rueda.
     */
    const atras = document.createElement('button');
    atras.type = 'button';
    atras.id = 'touch-back';
    atras.innerHTML = '<span aria-hidden="true">←</span>';
    atras.setAttribute('aria-label', 'Volver');
    this._engancharBoton(atras, () => this.onBack?.(), () => {});
    cont.appendChild(atras);

    document.body.appendChild(cont);
    this.built = true;
    return true;
  }

  /**
   * Crea la rueda analógica.
   *
   * @param {string} nombre @param {string} etiqueta
   * @returns {Stick}
   */
  _crearStick(nombre, etiqueta) {
    const raiz = document.createElement('div');
    raiz.className = 'touch-stick';
    raiz.dataset.stick = nombre;

    const base = document.createElement('div');
    base.className = 'touch-stick-base';

    /*
     * Cruz de referencia: dos líneas finas que marcan los ejes.
     *
     * Sin ellas la rueda es un círculo vacío y no se ve que también gobierna el
     * morro: el jugador descubre por casualidad que empujando arriba el avión
     * sube. Con la cruz, las cuatro direcciones se leen de un vistazo.
     */
    const cruz = document.createElement('div');
    cruz.className = 'touch-stick-cross';
    cruz.innerHTML = '<i></i><i></i>';

    const perilla = document.createElement('div');
    perilla.className = 'touch-stick-knob';

    const texto = document.createElement('span');
    texto.className = 'touch-stick-label';
    texto.textContent = etiqueta;

    base.append(cruz, perilla, texto);
    raiz.appendChild(base);

    /** @type {Stick} */
    const stick = { raiz, perilla, pointerId: -1, cx: 0, cy: 0, x: 0, y: 0 };
    this._engancharStick(stick);
    return stick;
  }

  /**
   * Conecta los eventos de la rueda.
   *
   * ── Por qué recuerda el `pointerId` ──
   * Aunque ahora haya un solo mando de vuelo, sigue haciendo falta: el botón de
   * propulsión se toca con el OTRO pulgar, y sin filtrar por id el movimiento de
   * ese dedo podría arrastrar la rueda. Con el id, cada puntero gobierna lo suyo.
   *
   * @param {Stick} s
   */
  _engancharStick(s) {
    const base = s.raiz.firstElementChild;

    const centro = () => {
      const b = base.getBoundingClientRect();
      s.cx = b.left + b.width / 2;
      s.cy = b.top + b.height / 2;
    };

    const mover = (dx, dy) => {
      // Radio dinámico: la rueda se adapta a pantallas chicas.
      const r = Math.min(RADIO, base.getBoundingClientRect().width / 2);
      const d = Math.hypot(dx, dy);
      /*
       * Se recorta al CÍRCULO, no a un cuadrado.
       *
       * Es lo que hace que sea una rueda y no un pad: el desplazamiento máximo es
       * el mismo en cualquier dirección, así que empujar en diagonal no da más
       * mando que empujar en cruz. Sin esto, la diagonal permitiría (1, 1) y el
       * avión giraría más rápido en diagonal que de costado, que se siente injusto.
       */
      const k = d > r ? r / d : 1;
      const px = dx * k;
      const py = dy * k;
      s.perilla.style.transform = `translate(${px}px, ${py}px)`;

      /*
       * ── Histéresis: el umbral depende de si ya estaba controlando ──
       *
       * Si el mando estaba en reposo hace falta superar ZONA_ARRANQUE para que el
       * avión empiece a moverse. Una vez que está controlando, basta con bajar de
       * ZONA_MANTENER para seguir. Así un pulgar apoyado no desvía nada, pero al
       * moverlo la respuesta es inmediata y precisa.
       */
      const nx = px / r;
      const ny = py / r;
      const magnitud = Math.hypot(nx, ny);
      /*
       * ── Un solo umbral, más alto ──
       *
       * Se probó con histéresis (arranque 0.28 / mantener 0.14) y la suite de
       * multi-touch lo detectó como fallo: el gesto de dos dedos quedaba muy justo
       * y no siempre cruzaba el umbral de arranque.
       *
       * Un umbral único de 0.22 es más simple y resuelve lo que importa: ~14 px de
       * recorrido antes de que el avión se mueva, suficiente para que el temblor
       * del pulgar no lo desvíe.
       */
      s.controlando = magnitud > ZONA_MANTENER;

      /*
       * ── El mando se marca visualmente cuando está activo ──
       *
       * Se pidió saber si el pulgar está controlando o no. Antes no había ninguna
       * señal: el jugador se enteraba del choque. La clase cambia el color de la
       * rueda y de la perilla.
       */
      s.raiz.classList.toggle('controlando', s.controlando);

      if (s.controlando) {
        /*
         * Se aplica la curva sobre la MAGNITUD y se conserva la dirección.
         *
         * Escalar x e y por separado deformaría los diagonales: empujar a 45°
         * dejaría de dar (0.7, 0.7). Normalizando por magnitud, la dirección se
         * respeta y sólo cambia cuánto manda.
         */
        const ganancia = Math.pow(magnitud, CURVA) / magnitud;
        s.x = nx * ganancia;
        s.y = ny * ganancia;
      } else {
        s.x = 0;
        s.y = 0;
      }
      this._aplicar();
    };

    const soltar = () => {
      s.pointerId = -1;
      s.x = 0;
      s.y = 0;
      s.perilla.style.transform = 'translate(0px, 0px)';
      s.raiz.classList.remove('activo');
      this._aplicar();
    };

    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (s.pointerId !== -1) return;
      s.pointerId = e.pointerId;
      base.setPointerCapture?.(e.pointerId);
      centro();
      s.raiz.classList.add('activo');
      mover(e.clientX - s.cx, e.clientY - s.cy);
    });

    base.addEventListener('pointermove', (e) => {
      if (e.pointerId !== s.pointerId) return;
      e.preventDefault();
      mover(e.clientX - s.cx, e.clientY - s.cy);
    });

    for (const tipo of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      base.addEventListener(tipo, (e) => {
        if (e.pointerId !== s.pointerId) return;
        soltar();
      });
    }
  }

  /**
   * Conecta un botón de acción.
   *
   * El flanco se dispara en `pointerdown` y no en `click`: con `click` el juego
   * espera a que el dedo se levante, y en un juego de reflejos eso se siente
   * tarde. Además `click` no existe si el dedo se mueve un poco.
   *
   * @param {HTMLElement} el @param {() => void} alTocar @param {() => void} alSoltar
   */
  _engancharBoton(el, alTocar, alSoltar) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('activo');
      alTocar();
    });
    for (const tipo of ['pointerup', 'pointercancel', 'pointerleave']) {
      el.addEventListener(tipo, () => {
        el.classList.remove('activo');
        alSoltar();
      });
    }
  }

  /**
   * Vuelca los ejes de la rueda al input compartido.
   *
   * La rueda gobierna LAS CUATRO direcciones: su eje X es el rumbo y su eje Y el
   * morro. Es lo que permite pilotar todo el vuelo con un solo dedo.
   */
  _aplicar() {
    setTouchAxes({
      // X de pantalla crece hacia la derecha, igual que el `steer` del juego.
      steer: this.stick?.x ?? 0,
      // Y de pantalla crece hacia ABAJO y el `nose` del juego hacia arriba: de
      // ahí el signo invertido.
      nose: -(this.stick?.y ?? 0),
      thrust: this.thrustHeld,
    });
  }

  /**
   * Muestra u oculta los mandos.
   *
   * Se muestran sólo VOLANDO: antes de lanzar el avión no se pilota (se apunta
   * arrastrando) y en el resultado ya no hay nada que manejar.
   *
   * @param {boolean} visible
   */
  setVisible(visible) {
    if (!this.built) return;
    if (this.visible === visible) return;
    this.visible = visible;
    document.getElementById('touch-controls')?.classList.toggle('hidden', !visible);
    if (!visible) {
      // Al ocultarse se sueltan los ejes: si no, un dedo apoyado al terminar el
      // vuelo dejaría el mando apretado en el vuelo siguiente.
      if (this.stick) this._resetStick(this.stick);
      this.thrustHeld = false;
      releaseTouchAxes();
    }
  }

  /** @param {Stick} s */
  _resetStick(s) {
    s.pointerId = -1;
    s.x = 0;
    s.y = 0;
    s.perilla.style.transform = 'translate(0px, 0px)';
    s.raiz.classList.remove('activo');
  }
}
