/**
 * PAPERCRASH — game/ranking.js
 * ============================================================
 * Registro de partidas y ranking LOCAL.
 *
 * ── Qué es un "registro de partida" ──
 * Un objeto que describe TODO lo necesario para reproducir un vuelo:
 *
 *   { build, seed, ship, upgrades, distance, coins, rings, boosters, time, at }
 *
 * ── Por qué esta forma y no sólo "puntos" ──
 * Porque es la que va a hacer falta cuando el ranking sea online. Con la semilla
 * y la configuración de la nave, el servidor puede RE-SIMULAR el vuelo y verificar
 * que la distancia es real, sin necesidad de un servidor autoritativo en tiempo
 * real (que es carísimo y no hace falta para un juego por turnos como éste).
 *
 * Es decir: este registro local es el mismo formato que después se manda al
 * servidor. Guardar sólo el puntaje obligaría a rediseñar cuando llegue el
 * ranking global.
 *
 * ── Lo que falta para online ──
 * Las ENTRADAS del jugador (cuándo giró, cuándo propulsó). Se pueden agregar
 * después al mismo objeto sin romper lo guardado: `inputs` es opcional.
 * ============================================================
 */
import { BUILD } from '../core/version.js';

const CLAVE = 'papercrash.ranking.v1';
/** Cuántas marcas se guardan. */
const TOP = 10;

/**
 * @typedef {object} RunRecord
 * @property {number} build       build del juego que la generó
 * @property {number} seed        semilla del corredor
 * @property {string} ship        nave usada
 * @property {object} upgrades    niveles de mejora de esa nave al volar
 * @property {number} distance    metros recorridos
 * @property {number} coins       monedas ganadas
 * @property {number} rings       aros cruzados
 * @property {number} boosters    boosters juntados
 * @property {number} time        segundos de vuelo
 * @property {number} at          timestamp de cuándo se jugó
 */

/** Lee el ranking guardado. Tolera basura y formato viejo. */
export function leerRanking() {
  try {
    const bruto = localStorage.getItem(CLAVE);
    if (!bruto) return [];
    const lista = JSON.parse(bruto);
    if (!Array.isArray(lista)) return [];
    // Se filtra por forma para no romper la UI con datos corruptos.
    return lista.filter((r) => r && typeof r.distance === 'number');
  } catch {
    return [];
  }
}

/**
 * Arma el registro de una partida recién terminada.
 *
 * @param {object} p
 * @param {number} p.seed @param {string} p.ship @param {object} p.upgrades
 * @param {object} p.result  resultado de `computeResult()`
 * @returns {RunRecord}
 */
export function crearRegistro({ seed, ship, upgrades, result }) {
  return {
    build: BUILD,
    seed: seed ?? 0,
    ship: ship ?? 'paper',
    upgrades: { ...(upgrades ?? {}) },
    distance: Math.round(result.distance ?? 0),
    coins: Math.round(result.coins ?? 0),
    rings: Math.round(result.rings ?? 0),
    boosters: Math.round(result.boosters ?? 0),
    time: Math.round(result.time ?? 0),
    at: Date.now(),
  };
}

/**
 * Inserta un registro y devuelve la posición que alcanzó (1-based) o 0 si no entró.
 *
 * @param {RunRecord} registro
 * @returns {number}
 */
export function guardarEnRanking(registro) {
  const lista = leerRanking();
  lista.push(registro);
  lista.sort((a, b) => b.distance - a.distance);
  const recortada = lista.slice(0, TOP);
  const pos = recortada.indexOf(registro);
  try {
    localStorage.setItem(CLAVE, JSON.stringify(recortada));
  } catch {
    // Sin almacenamiento (modo privado): el ranking simplemente no persiste.
  }
  return pos < 0 ? 0 : pos + 1;
}

/** Vacía el ranking. */
export function borrarRanking() {
  try {
    localStorage.removeItem(CLAVE);
  } catch { /* nada que hacer */ }
}
