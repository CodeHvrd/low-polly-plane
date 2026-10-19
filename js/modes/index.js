/**
 * PAPERCRASH — modes/index.js
 * ============================================================
 * Registro de modos de juego.
 *
 * ── Qué es un "modo" ──
 * Un modo es una CAPA DE CONFIGURACIÓN, no una rama de código. Los dos modos
 * comparten física, mundo, render y reglas; lo que cambia son los números de
 * `modes/classic.js` y `modes/frenetic.js`.
 *
 * Esa decisión tiene una consecuencia práctica: si un modo nuevo necesita código
 * nuevo y no sólo valores, es señal de que el diseño se está yendo por una rama
 * y conviene revisarlo antes de duplicar.
 *
 * ── Cómo se usa ──
 * `setMode('frenetic')` fija el modo activo y devuelve su configuración. Los
 * sistemas lo consultan a través de `MODE`, que es un objeto vivo: así un cambio
 * de modo se ve reflejado sin tener que reiniciar el juego.
 *
 * Los valores COMUNES (gravedad, simulación, economía, guardado) NO viven acá:
 * están en `config.js`, porque no dependen del modo.
 * ============================================================
 */
import { frenetic } from './frenetic.js';

/*
 * ── Un solo modo ──
 *
 * El modo "clásico" se retiró por decisión de diseño: el juego pasa a ser
 * frenético y se sigue trabajando sobre esa base. El archivo se borró.
 *
 * La INFRAESTRUCTURA de modos se conserva aunque haya uno solo. Es a propósito:
 * si mañana hace falta otro modo, alcanza con agregar un objeto de configuración
 * y borrar el selector oculto, sin tocar física ni mundo. Sacar la capa entera
 * para "simplificar" obligaría a rehacerla después.
 */
export const MODES = { frenetic };

/** Lista de modos, para iterar. Hoy tiene uno. */
export const MODE_LIST = Object.values(MODES);

/** Modo por defecto, que es también el único. */
export const DEFAULT_MODE = 'frenetic';

/**
 * ¿Hay más de un modo para elegir?
 *
 * La UI lo consulta para ocultar el selector cuando no hay nada que elegir. Con
 * un solo modo, mostrar una barra con una sola opción sería ruido.
 */
export const HAS_MODE_CHOICE = MODE_LIST.length > 1;

/**
 * Modo activo.
 *
 * Es un objeto VIVO a propósito: los sistemas guardan una referencia a `MODE` y
 * leen sus campos en el momento de usarlos. Si en cambio copiaran los valores al
 * arrancar, cambiar de modo no tendría efecto hasta reiniciar.
 */
export const MODE = { ...MODES[DEFAULT_MODE] };

/**
 * Cambia el modo activo.
 *
 * Muta `MODE` en vez de reemplazarlo, porque los sistemas ya tienen la
 * referencia. Reemplazarlo dejaría a todos apuntando al modo viejo.
 *
 * @param {string} id
 * @returns {boolean} true si el modo existe y se aplicó
 */
export function setMode(id) {
  const next = MODES[id];
  if (!next) return false;

  // Se limpian las claves viejas además de copiar las nuevas: si un modo tiene
  // menos campos que el anterior, dejar los viejos produciría un híbrido.
  for (const key of Object.keys(MODE)) delete MODE[key];
  Object.assign(MODE, next);
  return true;
}

/** ¿Existe este modo? */
export function hasMode(id) {
  return Object.prototype.hasOwnProperty.call(MODES, id);
}
