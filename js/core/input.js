/**
 * PAPERCRASH — core/input.js
 * ============================================================
 * Capa de entrada agnóstica del dispositivo.
 *
 * Traduce mouse, touch y Pointer Events a un único flujo de gestos
 * (`drag:start` / `drag:move` / `drag:end`) y normaliza el teclado.
 *
 * Punto clave de arquitectura: este módulo NO conoce fases del juego
 * ni reglas. Solo entrega eventos. Quien decide si un gesto es válido
 * es el controlador (RunController), lo que elimina la clase de bug en
 * la que un atajo de teclado "atraviesa" una pantalla de UI.
 * ============================================================
 */

/** @typedef {{x:number, y:number, id:number}} PointerSample */

const dragListeners = { start: new Set(), move: new Set(), end: new Set(), cancel: new Set() };
const keyListeners = new Set();

/**
 * Teclas apretadas ahora mismo.
 *
 * Vive acá arriba, con el resto del estado del módulo: los listeners se
 * registran al cargar el archivo, así que cualquier `const` declarado más abajo
 * quedaría en zona muerta temporal y el primer evento fallaría.
 *
 * @type {Set<string>}
 */
const heldKeys = new Set();

function emit(set, payload) {
  for (const fn of set) {
    try {
      fn(payload);
    } catch (err) {
      console.error('[input] listener error', err);
    }
  }
}

/**
 * @param {'start'|'move'|'end'|'cancel'} type
 * @param {(e: PointerSample & {source:string, button:number}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onDrag(type, fn) {
  dragListeners[type].add(fn);
  return () => dragListeners[type].delete(fn);
}

/**
 * @param {(e: {code:string, key:string, repeat:boolean, target:EventTarget|null, preventDefault:()=>void}) => void} fn
 */
export function onKey(fn) {
  keyListeners.add(fn);
  return () => keyListeners.delete(fn);
}

/** ¿El evento se originó en un control de formulario / zona interactiva? */
function isInteractiveTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('button, input, select, textarea, a, [data-ui-interactive]'));
}

// ── Pointer Events ──────────────────────────────────────────
// Un único set de listeners cubre mouse + touch + stylus donde el
// navegador lo soporta. `setPointerCapture` garantiza que seguimos
// recibiendo el move aunque el cursor salga del canvas.
const USE_POINTER_EVENTS = typeof window !== 'undefined' && 'PointerEvent' in window;

let activePointerId = null;

function pointerSample(e, source) {
  return { x: e.clientX, y: e.clientY, id: e.pointerId ?? 0, source, button: e.button ?? 0 };
}

if (USE_POINTER_EVENTS) {
  window.addEventListener(
    'pointerdown',
    (e) => {
      // Solo botón principal; y nunca sobre controles de UI.
      if (e.button !== 0) return;
      if (isInteractiveTarget(e.target)) return;
      if (activePointerId !== null) return; // un solo gesto a la vez
      activePointerId = e.pointerId;
      emit(dragListeners.start, pointerSample(e, 'pointer'));
    },
    { passive: true },
  );

  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerId !== activePointerId) return;
      emit(dragListeners.move, pointerSample(e, 'pointer'));
    },
    { passive: true },
  );

  const finish = (e, type) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    emit(dragListeners[type], pointerSample(e, 'pointer'));
  };

  window.addEventListener('pointerup', (e) => finish(e, 'end'), { passive: true });
  window.addEventListener('pointercancel', (e) => finish(e, 'cancel'), { passive: true });
  // Si la ventana pierde el foco a mitad de un gesto, no dejamos el arrastre colgado.
  window.addEventListener('blur', () => {
    if (activePointerId === null) return;
    activePointerId = null;
    emit(dragListeners.cancel, { x: 0, y: 0, id: -1, source: 'blur', button: 0 });
  });
} else {
  // ── Fallback: mouse + touch separados ─────────────────────
  let mouseDown = false;

  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || isInteractiveTarget(e.target) || mouseDown) return;
    mouseDown = true;
    emit(dragListeners.start, { x: e.clientX, y: e.clientY, id: 0, source: 'mouse', button: 0 });
  });
  window.addEventListener('mousemove', (e) => {
    if (!mouseDown) return;
    emit(dragListeners.move, { x: e.clientX, y: e.clientY, id: 0, source: 'mouse', button: 0 });
  });
  window.addEventListener('mouseup', (e) => {
    if (!mouseDown) return;
    mouseDown = false;
    emit(dragListeners.end, { x: e.clientX, y: e.clientY, id: 0, source: 'mouse', button: 0 });
  });
  window.addEventListener('blur', () => {
    if (!mouseDown) return;
    mouseDown = false;
    emit(dragListeners.cancel, { x: 0, y: 0, id: -1, source: 'blur', button: 0 });
  });

  const touch = (e) => e.touches[0] || e.changedTouches[0];
  const canvasEl = document.getElementById('gameCanvas');

  canvasEl.addEventListener(
    'touchstart',
    (e) => {
      const t = touch(e);
      if (!t) return;
      if (isInteractiveTarget(e.target)) return;
      e.preventDefault();
      emit(dragListeners.start, { x: t.clientX, y: t.clientY, id: t.identifier, source: 'touch', button: 0 });
    },
    { passive: false },
  );
  canvasEl.addEventListener(
    'touchmove',
    (e) => {
      const t = touch(e);
      if (!t) return;
      e.preventDefault();
      emit(dragListeners.move, { x: t.clientX, y: t.clientY, id: t.identifier, source: 'touch', button: 0 });
    },
    { passive: false },
  );
  const touchEnd = (e) => {
    const t = touch(e);
    if (!t) return;
    emit(dragListeners.end, { x: t.clientX, y: t.clientY, id: t.identifier, source: 'touch', button: 0 });
  };
  canvasEl.addEventListener('touchend', touchEnd);
  canvasEl.addEventListener('touchcancel', touchEnd);
}

/*
 * ── Sin menú contextual ──
 *
 * El clic derecho abría el menú del navegador (copiar, guardar imagen, inspeccionar)
 * encima del canvas. En un juego que se maneja arrastrando, eso es fatal: el menú
 * tapa la acción, se come el arrastre siguiente y algunos ítems recargan la
 * página y pierden la partida.
 *
 * Se bloquea en toda la ventana y no sólo en el canvas: el menú igual aparece si
 * el clic cae en un overlay, y no hay ningún lugar del juego donde el menú del
 * navegador sea útil.
 */
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

// ── Teclado ─────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  // No secuestrar atajos del navegador (F5, DevTools, etc.).
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  trackHeldKey(e.code, true);
  emit(keyListeners, {
    code: e.code,
    key: e.key,
    repeat: e.repeat,
    target: e.target,
    preventDefault: () => e.preventDefault(),
  });
});

window.addEventListener('keyup', (e) => {
  trackHeldKey(e.code, false);
});

/*
 * Pérdida de foco: se sueltan TODAS las teclas.
 *
 * Sin esto, cambiar de pestaña mientras se mantiene W deja la tecla "apretada"
 * para siempre: al volver, el avión sigue subiendo solo. Es el mismo tipo de
 * fuga que tiene el puntero cuando se sale de la ventana arrastrando.
 */
window.addEventListener('blur', () => {
  heldKeys.clear();
});

/** Teclas que están apretadas ahora mismo. @type {Set<string>} */
function trackHeldKey(code, down) {
  if (down) heldKeys.add(code);
  else heldKeys.delete(code);
}

/**
 * ¿Está apretada esta tecla? Para mandos SOSTENIDOS (A/D/W/S y la propulsión).
 *
 * Se consulta por `code` y no por `key` porque `key` cambia con el layout y con
 * Shift: `code` identifica la tecla física, que es lo que quiere un control de
 * juego.
 *
 * @param {string} code  por ejemplo 'KeyA', 'Space'
 */
export function isKeyHeld(code) {
  return heldKeys.has(code);
}

/**
 * Estado de los mandos de vuelo, ya normalizado a los ejes del juego.
 *
 * Devuelve `steer` (+ derecha, - izquierda) y `nose` (+ arriba, - abajo) en
 * [-1, 1], más si se está pidiendo la propulsión.
 *
 * ── Teclado y táctil entran por acá ──
 * Los mandos táctiles (@see `ui/touchControls.js`) NO reescriben este estado:
 * se suman al del teclado y se normalizan. Así los dos conviven (útil para
 * probar en el escritorio con emulación táctil) y hay un solo lugar donde se
 * decide la correspondencia mando → eje.
 *
 * @returns {{steer:number, nose:number, thrust:boolean}}
 */
export function readFlightControls() {
  let steer = 0;
  let nose = 0;
  if (isKeyHeld('KeyA') || isKeyHeld('ArrowLeft')) steer -= 1;
  if (isKeyHeld('KeyD') || isKeyHeld('ArrowRight')) steer += 1;
  if (isKeyHeld('KeyW') || isKeyHeld('ArrowUp')) nose += 1;
  if (isKeyHeld('KeyS') || isKeyHeld('ArrowDown')) nose -= 1;

  return {
    steer: clampUnit(steer + touchAxes.steer),
    nose: clampUnit(nose + touchAxes.nose),
    thrust: isKeyHeld('Space') || touchAxes.thrust,
  };
}

/** Recorta a [-1, 1]. */
function clampUnit(v) {
  return v > 1 ? 1 : v < -1 ? -1 : v;
}

/**
 * Ejes que aportan los mandos táctiles.
 *
 * Es estado compartido a propósito: el módulo de controles táctiles lo escribe y
 * `readFlightControls` lo lee. La alternativa —que el táctil simule eventos de
 * teclado— ensuciaría el manejo de teclas con códigos que el jugador nunca
 * apretó, y rompería la detección de flanco de la propulsión.
 *
 * @type {{steer:number, nose:number, thrust:boolean}}
 */
const touchAxes = { steer: 0, nose: 0, thrust: false };

/**
 * Fija los ejes táctiles.
 *
 * @param {{steer?:number, nose?:number, thrust?:boolean}} ejes
 */
export function setTouchAxes(ejes) {
  touchAxes.steer = clampUnit(ejes.steer ?? 0);
  touchAxes.nose = clampUnit(ejes.nose ?? 0);
  if (typeof ejes.thrust === 'boolean') touchAxes.thrust = ejes.thrust;
}

/**
 * Suelta todos los ejes táctiles.
 *
 * Se llama al perder el foco o al cambiar de pantalla: sin esto, un dedo que se
 * levanta fuera de la pantalla deja el mando "apretado" para siempre, que es el
 * mismo problema que tiene el teclado al cambiar de pestaña.
 */
export function releaseTouchAxes() {
  touchAxes.steer = 0;
  touchAxes.nose = 0;
  touchAxes.thrust = false;
}

/** ¿El dispositivo tiene pantalla táctil? Sirve para decidir qué UI mostrar. */
export function isTouchDevice() {
  return (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
}

/** ¿El foco está en un campo de texto? (para no disparar atajos mientras se escribe) */
export function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}
