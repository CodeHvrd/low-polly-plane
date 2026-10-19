/**
 * PAPERCRASH — world/collectibles.js
 * ============================================================
 * Monedas y boosters repartidos en CAMINOS por el corredor.
 *
 * ── Qué cambió respecto de la versión anterior ──
 * Antes los recolectables se colocaban uno por uno, cada uno anclado a la
 * trayectoria nominal. Funcionaba, pero el corredor quedaba siempre igual: la
 * misma partida una y otra vez.
 *
 * Ahora se generan varios CAMINOS COMPLETOS por tramo —trazados coherentes de
 * monedas y boosters— y en cada partida se elige uno al azar. El esqueleto del
 * corredor no cambia (el mapa es fijo) pero la ruta que conviene volar sí, así
 * que cada lanzamiento se juega distinto sin regenerar el mundo.
 *
 * ── Por qué caminos y no posiciones sueltas ──
 * Un camino es una secuencia coherente: si lo seguís, juntás todo. Colocar
 * puntos sueltos al azar daría racimos inalcanzables —ya pasó una vez— porque
 * cada punto necesita estar sobre alguna línea de vuelo posible. Un camino ES
 * esa línea.
 *
 * Módulo puro: sin Three.js ni DOM, verificable en Node.
 * ============================================================
 */
import { PICKUPS, WORLD, STAGES } from '../config.js';
import { createRng, clamp } from '../core/math.js';
import { terrainHeightAt } from './terrainField.js';

/**
 * @typedef {Object} Coin
 * @property {'coin'} kind @property {number} id @property {number} value
 * @property {number} x @property {number} y @property {number} z
 * @property {boolean} taken
 *
 * @typedef {Object} Booster
 * @property {'booster'} kind @property {number} id
 * @property {number} x @property {number} y @property {number} z
 * @property {number} halfSpan  semialtura de la columna de recolección
 * @property {boolean} taken
 *
 * @typedef {Coin|Booster} Pickup
 *
 * @typedef {Object} Route
 * @property {number} id
 * @property {number} lane  desplazamiento lateral del camino (m)
 * @property {number} lift  cuánto vuela por encima de la línea base (m)
 * @property {boolean} rich true = camino cargado de monedas de 50
 */

/** Cuántos caminos distintos se ofrecen por tramo. */
const ROUTES_PER_SEGMENT = 3;

/* ── Altura objetivo inyectada ───────────────────────────────
 *
 * `world/` no puede importar de `game/` sin invertir la dependencia, así que la
 * función de altura objetivo se inyecta desde el arranque del juego. Si nadie la
 * inyecta se usa una altura de crucero fija, que es un respaldo razonable para
 * las pruebas.
 */
let profileFn = null;

/**
 * Registra la función de altura objetivo del corredor.
 * @param {(x:number) => number} fn
 */
export function setAltitudeProvider(fn) {
  profileFn = fn;
}

/**
 * Altura objetivo a esa distancia (m).
 *
 * Se le pasa la altura del SUELO del carril central porque en los últimos
 * tramos el relieve sube por encima de la curva deseada, y sin ese dato los
 * recolectables de ahí quedaban enterrados.
 */
function targetAltitude(x) {
  if (profileFn) return profileFn(x, terrainHeightAt(x, 0));
  return Math.max(PICKUPS.FALLBACK_ALTITUDE, terrainHeightAt(x, 0) + 9);
}

/** Tramo al que pertenece una distancia. */
function segmentOf(x) {
  return Math.floor(x / STAGES.SEGMENT_LENGTH);
}

/**
 * Genera todos los recolectables del corredor.
 *
 * @param {import('./obstacles.js').Obstacle[]} [obstacles]
 * @param {number} [seed]  semilla de la partida: distinta = caminos distintos
 * @returns {Pickup[]}
 */
export function generatePickups(obstacles = [], seed = PICKUPS.SEED, desde = 0, hasta = null) {
  /** @type {Pickup[]} */
  const list = [];
  let id = 0;

  /*
   * ── Por qué acepta un rango ──
   * El corredor se prolonga indefinidamente y los recolectables se generan por
   * VENTANA, igual que los obstáculos (ver `Game.updateChunkWindow`). Sin rango
   * se cubre el corredor completo del modo, que es lo que necesita el arranque.
   */
  const fin = hasta ?? WORLD.COURSE_LENGTH;
  const primerTramo = Math.floor(desde / STAGES.SEGMENT_LENGTH);
  /*
   * Se resta 1 por la misma razón que en los obstáculos: el tramo que EMPIEZA
   * justo en `fin` no pertenece al rango pedido.
   */
  const ultimoTramo = Math.floor((fin - 1) / STAGES.SEGMENT_LENGTH);

  for (let seg = primerTramo; seg <= ultimoTramo; seg++) {
    /*
     * ── Un generador POR TRAMO ──
     *
     * ── El bug que esto arregla ──
     * Antes había UN solo generador para toda la ventana. Como su estado depende
     * de cuántos números se consumieron antes, el contenido de un tramo cambiaba
     * según desde dónde arrancara la ventana. Medido: el tramo 2000-2500 daba
     * monedas en x=2019 desde la ventana 1500-3500 y en x=2031 desde la ventana
     * 2000-4000.
     *
     * En el juego eso se veía como que "al cruzar de bioma cambia todo el
     * recorrido": la ventana se corre cada 500 m, así que todas las monedas y
     * boosters que tenías adelante se re-sorteaban justo cuando los mirabas.
     *
     * Con la semilla derivada del ÍNDICE de tramo, el contenido de un tramo no
     * depende de nada más que de sí mismo: se puede generar suelto, en cualquier
     * orden, y sale siempre igual.
     *
     * Es la misma solución que ya usan los obstáculos (ver `rngDeTramo` en
     * obstacles.js).
     */
    const rng = createRng(seed + seg * 7919);

    const segStart = seg * STAGES.SEGMENT_LENGTH;
    /*
     * ── El tramo cierra en SU frontera, no antes ──
     *
     * Antes era `Math.min(fin - 25, ...)`: el último tramo de la ventana se
     * cortaba 25 m antes de su frontera, así que al correr la ventana ese tramo
     * generaba boosters y monedas que antes no existían. Es el mismo bug que
     * tenían los obstáculos, con otra forma.
     */
    const segEnd = segStart + STAGES.SEGMENT_LENGTH;
    if (segEnd <= segStart) continue;

    // Un camino por tramo, elegido al azar entre los generados.
    const routes = buildRoutes(rng);
    const route = routes[rng.int(0, routes.length - 1)];

    /*
     * ── El id incluye el tramo ──
     *
     * Los ids se usan para marcar lo recogido. Si dos tramos generaran ids
     * repetidos, al correr la ventana una moneda nueva podría nacer marcada como
     * recogida. Multiplicar por 1000 y sumar el índice del tramo lo garantiza.
     */
    let local = 0;
    const idBase = seg * 100000;
    placeRoute(list, route, segStart, segEnd, rng, obstacles, () => idBase + local++);
  }

  return list;
}

/**
 * Catálogo de caminos posibles.
 *
 * Cada uno describe una forma de volar: pegado al centro, abierto a un costado,
 * alto para juntar las de 50, o una mezcla. Son las rutas entre las que el
 * jugador tiene que elegir al apuntar.
 *
 * @param {ReturnType<typeof createRng>} rng
 * @returns {Route[]}
 */
function buildRoutes(rng) {
  const routes = [];
  for (let i = 0; i < ROUTES_PER_SEGMENT; i++) {
    // Se alternan caminos centrales y laterales: dos caminos pegados al mismo
    // lado no darían variedad real, sólo dos copias del mismo.
    const side = i === 0 ? rng.range(-1, 1) : rng.chance(0.5) ? -1 : 1;
    const magnitude = i === 0 ? rng.range(0, 8) : rng.range(9, 22);

    routes.push({
      id: i,
      lane: side * magnitude,
      lift: rng.range(-2.5, 4.5),
      rich: rng.chance(0.34),
    });
  }
  return routes;
}

/**
 * Reparte un camino dentro de un tramo: monedas en grupos y boosters regulares.
 *
 * @param {Pickup[]} list
 * @param {Route} route
 * @param {number} segStart @param {number} segEnd
 * @param {ReturnType<typeof createRng>} rng
 * @param {import('./obstacles.js').Obstacle[]} obstacles
 * @param {() => number} nextId
 */
function placeRoute(list, route, segStart, segEnd, rng, obstacles, nextId) {
  const coinCfg = PICKUPS.COINS;
  const boostCfg = PICKUPS.BOOSTERS;

  // ── Monedas: grupos a lo largo del camino ──
  let x = segStart + rng.range(10, 40);
  while (x < segEnd) {
    // En un camino "rico" predominan las de 50; en el resto, las baratas.
    const tier = route.rich ? pickRichTier(rng) : pickCoinTier(rng);
    const count = rng.int(coinCfg.CLUSTER_MIN, coinCfg.CLUSTER_MAX);
    const zigDir = rng.chance(0.5) ? 1 : -1;

    for (let i = 0; i < count; i++) {
      const cx = x + i * coinCfg.SPACING;
      if (cx >= segEnd) break;

      // El camino serpentea sólo si el valor lo pide.
      const z = route.lane + (tier.arc === 'zig' ? Math.sin(i * 1.1) * coinCfg.ZIG_AMPLITUDE * zigDir : 0);
      // Las de 50 vuelan más arriba dentro del mismo camino: son el premio por
      // seguirlo bien.
      const lift = route.lift + (tier.arc === 'high' ? tier.rise + i * coinCfg.HIGH_RISE : tier.rise);

      list.push({
        kind: 'coin',
        id: nextId(),
        value: tier.value,
        x: cx,
        y: placeY(cx, lift, z),
        z: clamp(z, -WORLD.COURSE_HALF_WIDTH + 4, WORLD.COURSE_HALF_WIDTH - 4),
        taken: false,
      });
    }

    x += count * coinCfg.SPACING + rng.range(coinCfg.GROUP_GAP_MIN, coinCfg.GROUP_GAP_MAX);
  }

  // ── Boosters: regulares, sobre el mismo camino ──
  const first = Math.max(segStart + boostCfg.OFFSET_IN_SEGMENT, boostCfg.FIRST_AT);
  const kinds = PICKUPS.KINDS;
  /*
   * El tipo de cada booster se sortea entre los que habilita el MODO.
   *
   * `booster` (violeta) se activa con Space y `instant` (azul) empuja al
   * tocarlo. Se garantiza que el PRIMERO de cada tramo sea violeta cuando hay
   * más de un tipo: el jugador necesita al menos una carga guardada para poder
   * usar la habilidad, y si el tramo arrancara sólo con azules la propulsión
   * quedaría inalcanzable.
   */
  let idx = 0;
  for (let bx = first; bx < segEnd; bx += boostCfg.SPACING) {
    const spot = findBoosterSpot(bx, route, rng, obstacles);
    if (spot === null) continue;

    let kind = kinds.length === 1 ? kinds[0] : rng.pick(kinds);
    if (idx === 0 && kinds.includes('booster')) kind = 'booster';

    list.push({
      kind: 'booster',
      boosterKind: kind,
      id: nextId(),
      x: spot.x,
      y: placeY(spot.x, route.lift, spot.z),
      z: spot.z,
      halfSpan: boostCfg.SPAN / 2,
      taken: false,
    });
    idx++;
  }
}

/**
 * Elige un valor dando más peso a las de 50 (caminos "ricos").
 * @param {ReturnType<typeof createRng>} rng
 */
function pickRichTier(rng) {
  const roll = rng.next();
  if (roll < 0.45) return PICKUPS.COINS.MIX[2];
  if (roll < 0.75) return PICKUPS.COINS.MIX[1];
  return PICKUPS.COINS.MIX[0];
}

/**
 * Elige un valor respetando los pesos de `COINS.MIX`.
 * @param {ReturnType<typeof createRng>} rng
 */
function pickCoinTier(rng) {
  const roll = rng.next();
  let acc = 0;
  for (const tier of PICKUPS.COINS.MIX) {
    acc += tier.share;
    if (roll <= acc) return tier;
  }
  return PICKUPS.COINS.MIX[0];
}

/**
 * Altura final de un recolectable.
 *
 * Se apoya en la línea objetivo y se le suma el desplazamiento del camino. Nunca
 * queda enterrado: si el terreno sube más que la línea, manda el terreno.
 *
 * @param {number} x @param {number} lift @param {number} z
 */
function placeY(x, lift, z) {
  const ground = terrainHeightAt(x, z);
  return Math.max(ground + PICKUPS.MIN_CLEARANCE, targetAltitude(x) + lift);
}

/**
 * Busca una posición libre de obstáculos cerca de `x`, sobre el camino.
 *
 * Se prueban unos pocos desplazamientos y si ninguno sirve se omite el booster:
 * es preferible que falte uno a que quede encajado dentro de una piedra, donde
 * el jugador no podría verlo ni alcanzarlo.
 *
 * @param {number} x
 * @param {Route} route
 * @param {ReturnType<typeof createRng>} rng
 * @param {import('./obstacles.js').Obstacle[]} obstacles
 * @returns {{x:number, z:number}|null}
 */
function findBoosterSpot(x, route, rng, obstacles) {
  const cfg = PICKUPS.BOOSTERS;

  for (let attempt = 0; attempt < 8; attempt++) {
    const px = x + rng.range(-10, 10);
    // Se insiste cerca del carril del camino: el booster tiene que estar donde
    // el jugador ya está volando, no en otro lado.
    const pz = route.lane + rng.range(-4, 4);

    const clash = obstacles.some((o) => {
      const a = o.aabb;
      const dx = px < a.minX ? a.minX - px : px > a.maxX ? px - a.maxX : 0;
      const dz = pz < a.minZ ? a.minZ - pz : pz > a.maxZ ? pz - a.maxZ : 0;
      return Math.hypot(dx, dz) < cfg.CLEAR_OF_OBSTACLE;
    });

    if (!clash) return { x: px, z: pz };
  }
  return null;
}

/**
 * Busca el recolectable más cercano al avión y lo marca si está dentro del
 * radio. Devuelve lo recolectado, o null.
 *
 * Se comprueba contra TODOS los recolectables en vez de indexar por X porque la
 * lista es corta (decenas) y así no hay que mantener un índice sincronizado con
 * los descartes. Si el corredor creciera mucho, éste es el punto a optimizar.
 *
 * @param {Pickup[]} pickups
 * @param {number} x @param {number} y @param {number} z
 * @param {number} [radius]
 * @returns {Pickup|null}
 */
export function collectAt(pickups, x, y, z, radius = PICKUPS.RADIUS) {
  let best = null;
  let bestDist = radius;

  for (const p of pickups) {
    if (p.taken) continue;
    // Descarte barato por X antes de calcular la distancia completa.
    if (Math.abs(p.x - x) > radius) continue;

    /*
     * Un recolectable con `halfSpan` es una COLUMNA: se mide la distancia a su
     * tramo vertical, no a su centro. Así un booster se recoge pasando a
     * cualquier altura dentro de la columna, que es lo que permite encadenarlos
     * sin que la puntería tenga que dar en el centímetro.
     */
    const dy = p.halfSpan ? Math.max(0, Math.abs(y - p.y) - p.halfSpan) : y - p.y;
    const d = Math.hypot(p.x - x, dy, p.z - z);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }

  if (best) best.taken = true;
  return best;
}

/**
 * Devuelve todos los recolectables a su estado inicial.
 *
 * OJO: esto toca sólo los DATOS. Las mallas se sincronizan aparte, en
 * `pickupMeshes.updatePickupMeshes`, y esa sincronización tiene que saber tanto
 * ocultar como VOLVER A MOSTRAR. Si sólo supiera ocultar, los recolectables
 * quedarían disponibles pero invisibles — que es exactamente el bug que hubo.
 *
 * @param {Pickup[]} pickups
 */
export function resetPickups(pickups) {
  for (const p of pickups) p.taken = false;
}

/**
 * Totales del corredor, para mostrar en la UI y para las pruebas.
 * @param {Pickup[]} pickups
 */
export function pickupSummary(pickups) {
  const coins = pickups.filter((p) => p.kind === 'coin');
  const boosters = pickups.filter((p) => p.kind === 'booster');
  const byValue = {};
  for (const c of coins) byValue[c.value] = (byValue[c.value] ?? 0) + 1;

  // Cuántos recolectables hay por tramo: sirve para comprobar que el reparto no
  // se concentró en un solo lugar del corredor.
  const perSegment = {};
  for (const p of pickups) {
    const s = segmentOf(p.x);
    perSegment[s] = (perSegment[s] ?? 0) + 1;
  }

  return {
    coins: coins.length,
    boosters: boosters.length,
    byValue,
    perSegment,
    maxCoinValue: coins.reduce((sum, c) => sum + c.value, 0),
  };
}
