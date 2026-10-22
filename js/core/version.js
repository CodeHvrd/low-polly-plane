/**
 * PAPERCRASH — versión visible del build.
 *
 * ── Por qué un CONTADOR y no el hash del commit ──
 * Antes se mostraba el hash de git, pero como ese número va escrito DENTRO del
 * archivo que se commitea, siempre mostraba el commit ANTERIOR: no puede
 * referenciarse a sí mismo. Resultaba imposible saber si el teléfono corría la
 * última versión, que es justo para lo que existe este indicador.
 *
 * Un contador que se sube ANTES de commitear no tiene ese problema: el número que
 * se ve en pantalla es el del build que lo contiene.
 *
 * Se incrementa con: node tools/sync-sw.mjs --bump
 */
export const BUILD = 22;
