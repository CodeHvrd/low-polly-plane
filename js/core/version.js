/**
 * PAPERCRASH â€” versiÃ³n visible del build.
 *
 * â”€â”€ Por quÃ© existe â”€â”€
 * El service worker cachea el juego para que funcione offline. Eso significa que
 * despuÃ©s de un deploy el telÃ©fono puede seguir mostrando la copia vieja, y no
 * habÃ­a forma de saberlo: se reportaban bugs que ya estaban corregidos.
 *
 * Este nÃºmero se muestra abajo a la izquierda. Coincide con el hash del commit
 * del deploy, asÃ­ que si no cambia, no se recargÃ³.
 *
 * Lo actualiza `tools/sync-sw.mjs --bump` al hacer cada deploy.
 */
export const BUILD = '9fca2a9';
