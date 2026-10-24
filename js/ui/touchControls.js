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
    /**
     * Dedo (pointerId) -> flecha que está pisando.
     *
     * ── Por qué un mapa y no un booleano por flecha ──
     * Con dos dedos apoyados hay que saber CUÁL dedo sostiene CUÁL flecha: si se
     * guardara sólo "la flecha está apretada", levantar un dedo soltaría también la
     * flecha del otro. Con el mapa, cada dedo suelta lo suyo.
     */
    this.punteros = new Map();
    /** Botones del D-pad, para pintar el resaltado. */
    this.botones = [];
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
       *
       * ── Por qué se llama a `_aplicar()` y no a `setTouchAxes({thrust:true})` ──
       *
       * ── El bug que esto arregla ──
       * `setTouchAxes` hace `nose = ejes.nose ?? 0` y `steer = ejes.steer ?? 0`:
       * un objeto PARCIAL pone en cero los ejes que no vienen. Al apretar el boost
       * se enviaba sólo `{ thrust: true }`, así que **se borraban el morro y el
       * rumbo** de las flechas que el jugador tenía apoyadas.
       *
       * Ésa era la razón de que ▲ + boost "no funcionara": la propulsión cancelaba
       * justo la flecha que se estaba sosteniendo. Con dos dedos, el último en
       * tocarse ganaba y el otro se perdía.
       *
       * `_aplicar()` manda SIEMPRE los tres ejes juntos, así que ninguna entrada
       * pisa a la otra.
       */
      this.thrustHeld = true;
      this._aplicar();
      this.onThrust?.();
    }, () => {
      this.thrustHeld = false;
      this._aplicar();
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
   * Crea el D-pad de cuatro flechas DESLIZABLES.
   *
   * ── Qué significa "deslizable" ──
   * El pulgar no queda atado a la flecha donde tocó: si se arrastra hasta otra, el
   * mando cambia a esa. Se pasa de ◀ a ▶ con un solo gesto, sin levantar el dedo.
   *
   * ── Por qué así y no con botones sueltos ──
   * Con botones independientes, cada uno recibe su propio `pointerdown`/`pointerup`.
   * Eso obliga a SOLTAR una flecha para tocar la siguiente, y en un juego donde hay
   * que corregir el rumbo a cada rato se siente trabado. Es la misma razón por la
   * que la rueda analógica, pese a sus problemas, se extrañaba para girar.
   *
   * ── Cómo funciona ──
   * El contenedor captura el puntero y sigue su recorrido con `pointermove`. En
   * cada movimiento se pregunta qué flecha hay DEBAJO del dedo con
   * `elementFromPoint`, y se actualiza el estado. El resultado es una autoridad
   * binaria (como el teclado) que además se desliza (como un analógico).
   *
   * ── Multi-touch ──
   * Cada puntero se guarda por separado en `this.punteros`. Así dos dedos pueden
   * sostener ▲ y ▶ a la vez, y el del booster no interfiere.
   *
   * @returns {{raiz: HTMLDivElement}}
   */
  _crearDpad() {
    const raiz = document.createElement('div');
    raiz.className = 'touch-dpad';

    /**
     * Crea una flecha (sólo el aspecto: los eventos los lleva el contenedor).
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
      return b;
    };

    this.botones = [
      flecha('touch-left', '◀', 'Girar a la izquierda', 'left'),
      flecha('touch-up', '▲', 'Subir el morro', 'up'),
      flecha('touch-down', '▼', 'Bajar el morro', 'down'),
      flecha('touch-right', '▶', 'Girar a la derecha', 'right'),
    ];
    raiz.append(...this.botones);

    /**
     * Qué flecha hay debajo de un punto de la pantalla.
     *
     * `elementFromPoint` es geométrico: devuelve el elemento que se ve en ese
     * píxel, sin importar qué elemento tenga la captura del puntero. Eso es lo que
     * permite que el dedo "salte" de una flecha a otra.
     *
     * @param {number} x @param {number} y
     * @returns {'left'|'right'|'up'|'down'|null}
     */
    const teclaEn = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const boton = el?.closest?.('.touch-dir');
      return boton?.dataset?.dir ?? null;
    };

    raiz.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      /*
       * El estado se guarda ANTES de cualquier otra cosa.
       *
       * `setPointerCapture` puede lanzar si el puntero no es válido, y si eso pasa
       * antes de anotar la tecla el gesto se pierde entero (fue el bug que dejó
       * muertos los botones de morro de la versión 10).
       */
      const tecla = teclaEn(e.clientX, e.clientY);
      if (!tecla) return;
      this.punteros.set(e.pointerId, tecla);
      this._sincronizar();
      try {
        // Captura en el CONTENEDOR: así el recorrido sigue llegando aunque el dedo
        // se salga de la caja del D-pad.
        raiz.setPointerCapture?.(e.pointerId);
      } catch {
        // Sin captura el gesto funciona igual dentro del D-pad.
      }
    });

    raiz.addEventListener('pointermove', (e) => {
      if (!this.punteros.has(e.pointerId)) return;
      e.preventDefault();
      /*
       * Se recalcula la flecha bajo el dedo en CADA movimiento. Ésta es la parte
       * que hace que el mando se deslice en vez de quedar bloqueado.
       */
      const tecla = teclaEn(e.clientX, e.clientY);
      const anterior = this.punteros.get(e.pointerId);
      if (tecla === anterior) return;
      /*
       * Salir del D-pad NO suelta la flecha: el dedo puede irse un poco afuera y
       * volver. Sólo se suelta al levantar. Si se soltara al salir, el jugador
       * perdería el mando por rozar el borde.
       */
      if (!tecla) return;
      this.punteros.set(e.pointerId, tecla);
      this._sincronizar();
    });

    const soltar = (e) => {
      if (!this.punteros.has(e.pointerId)) return;
      this.punteros.delete(e.pointerId);
      this._sincronizar();
    };
    raiz.addEventListener('pointerup', soltar);
    raiz.addEventListener('pointercancel', soltar);
    raiz.addEventListener('lostpointercapture', soltar);

    return { raiz };
  }

  /**
   * Recalcula los ejes a partir de los dedos apoyados y actualiza el resaltado.
   *
   * Se deriva del conjunto de punteros, no de un booleano por flecha: así dos
   * dedos pueden sostener dos flechas sin pisarse el estado.
   */
  _sincronizar() {
    const activas = new Set(this.punteros.values());
    for (const tecla of Object.keys(this.dir)) this.dir[tecla] = activas.has(tecla);
    for (const b of this.botones ?? []) {
      b.classList.toggle('activo', activas.has(b.dataset.dir));
    }
    this._aplicar();
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
    /*
     * Se vacía el mapa de punteros, no sólo el estado.
     *
     * Si quedara un pointerId colgado, el siguiente `pointermove` de ese dedo
     * seguiría moviendo el avión aunque el jugador ya hubiera levantado.
     */
    this.punteros.clear();
    for (const tecla of Object.keys(this.dir)) this.dir[tecla] = false;
    for (const b of this.botones ?? []) b.classList.remove('activo');
  }
}
