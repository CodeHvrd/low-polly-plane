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
    /**
     * Estado de las cuatro flechas del D-pad.
     *
     * ── Por qué flechas y no una rueda ──
     * La rueda analógica ACOPLA los dos ejes: para sostener el morro arriba hay
     * que dejar el pulgar quieto en un punto exacto, y cualquier temblor cambia
     * también el rumbo. En la PC W y A/D son teclas independientes, y ahí volar
     * resulta cómodo.
     *
     * Cuatro flechas dan autoridad BINARIA: apretado = 100%. Es exactamente la
     * paridad con el teclado, que es lo que la rueda nunca pudo dar.
     */
    this.dir = { left: false, right: false, up: false, down: false };
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

    this.dpad = this._crearDpad();
    cont.appendChild(this.dpad.raiz);

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
   * Crea el D-pad de cuatro flechas.
   *
   * ── Por qué binario y no analógico ──
   * Cada flecha entrega autoridad PLENA: apretada = 100%. Es exactamente lo que
   * dan W y A/D en la PC, y es lo que la rueda nunca pudo igualar, porque
   * sostenía los dos ejes con un solo pulgar.
   *
   * ── Por qué captura el puntero ──
   * Cada flecha captura SU dedo, así se pueden mantener dos a la vez (diagonal) y
   * el pulgar del booster no interfiere con el de la dirección.
   *
   * @returns {{raiz: HTMLDivElement}}
   */
  _crearDpad() {
    const raiz = document.createElement('div');
    raiz.className = 'touch-dpad';

    /**
     * Crea una flecha.
     *
     * @param {string} id       id del elemento
     * @param {string} icono    ▲ ▼ ◀ ▶
     * @param {string} etiqueta descripción para lectores de pantalla
     * @param {'left'|'right'|'up'|'down'} tecla
     */
    const flecha = (id, icono, etiqueta, tecla) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = id;
      b.className = 'touch-dir';
      b.textContent = icono;
      b.setAttribute('aria-label', etiqueta);
      b.dataset.dir = tecla;

      const soltar = (e) => {
        e.preventDefault();
        b.classList.remove('activo');
        this.dir[tecla] = false;
        this._aplicar();
      };

      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        /*
         * ── Primero el estado, después la captura ──
         *
         * ── El bug que esto arregla ──
         * `setPointerCapture` LANZA una excepción si el puntero no es válido
         * (eventos sintéticos, o cuando el navegador ya soltó el dedo). Al
         * llamarlo ANTES de guardar el estado, la excepción abortaba el handler y
         * la flecha nunca quedaba apretada.
         *
         * Ésa fue la razón de que los botones ▲▼ de la versión 10 "no engancharan"
         * nunca: el evento llegaba, pero moría antes de aplicarse.
         *
         * Ahora el estado se guarda primero y la captura es opcional: si falla, la
         * flecha funciona igual y sólo se pierde el seguimiento al salir del botón.
         */
        this.dir[tecla] = true;
        b.classList.add('activo');
        try {
          b.setPointerCapture?.(e.pointerId);
        } catch {
          // Sin captura la flecha igual funciona mientras el dedo esté encima.
        }
        this._aplicar();
      });

      for (const tipo of ['pointerup', 'pointercancel']) {
        b.addEventListener(tipo, soltar);
      }

      return b;
    };

    raiz.append(
      flecha('touch-left', '◀', 'Girar a la izquierda', 'left'),
      flecha('touch-up', '▲', 'Subir el morro', 'up'),
      flecha('touch-down', '▼', 'Bajar el morro', 'down'),
      flecha('touch-right', '▶', 'Girar a la derecha', 'right'),
    );

    return { raiz };
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
   * Vuelca las flechas apretadas al input compartido.
   *
   * ── Autoridad binaria ──
   * Cada flecha vale 1 o 0, sin valores intermedios. Es la paridad exacta con el
   * teclado: en la PC A/D dan ±1 siempre, y ésa es la razón de que ahí se pueda
   * esquivar bien y con la rueda costara.
   *
   * Al poder mantener dos flechas a la vez, la diagonal sale sola: ▲+▶ da morro
   * arriba y rumbo a la derecha al mismo tiempo, sin que uno contamine al otro.
   */
  _aplicar() {
    setTouchAxes({
      // Derecha menos izquierda: -1, 0 o +1.
      steer: (this.dir.right ? 1 : 0) - (this.dir.left ? 1 : 0),
      // Arriba menos abajo: +1 sube, -1 baja.
      nose: (this.dir.up ? 1 : 0) - (this.dir.down ? 1 : 0),
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
    /*
     * ── Al OCULTAR se resetea siempre, aunque ya estuviera oculto ──
     *
     * ── El bug que esto arregla ──
     * Antes había un `if (this.visible === visible) return;` antes del reset. Si
     * los mandos ya estaban ocultos y una flecha quedaba apretada (por ejemplo el
     * vuelo terminó con el dedo apoyado), volver a ocultarlos no limpiaba nada y
     * el eje quedaba pegado para la partida siguiente.
     *
     * Mostrar sigue siendo idempotente; ocultar siempre limpia.
     */
    if (visible && this.visible) return;
    this.visible = visible;
    document.getElementById('touch-controls')?.classList.toggle('hidden', !visible);
    if (!visible) {
      // Al ocultarse se sueltan los ejes: si no, un dedo apoyado al terminar el
      // vuelo dejaría el mando apretado en el vuelo siguiente.
      this._resetDpad();
      this.thrustHeld = false;
      releaseTouchAxes();
    }
  }

  /**
   * Suelta todas las flechas y les quita el estado visual.
   *
   * Se llama al ocultar los mandos y al terminar un vuelo, para que un dedo
   * apoyado no arrastre la dirección a la partida siguiente.
   */
  _resetDpad() {
    for (const tecla of Object.keys(this.dir)) this.dir[tecla] = false;
    const raiz = document.getElementById('touch-controls');
    raiz?.querySelectorAll('.touch-dir').forEach((b) => b.classList.remove('activo'));
  }
}
