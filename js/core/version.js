/**
 * PAPERCRASH — versión visible del build.
 *
 * ── Por qué existe ──
 * El service worker cachea el juego para que funcione offline. Eso significa que
 * después de un deploy el teléfono puede seguir mostrando la copia vieja, y no
 * había forma de saberlo: se reportaban bugs que ya estaban corregidos.
 *
 * Este número se muestra abajo a la izquierda. Coincide con el hash del commit
 * del deploy, así que si no cambia, no se recargó.
 *
 * Lo actualiza `tools/sync-sw.mjs --bump` al hacer cada deploy.
 */
export const BUILD = '44a88b0';
