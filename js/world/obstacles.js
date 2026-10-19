/**
 * PAPERCRASH — world/obstacles.js
 * ============================================================
 * Generación determinista del corredor de obstáculos.
 *
 * El corredor se arma con una semilla fija (OBSTACLES.SEED), así que es
 * siempre el mismo: el jugador puede memorizarlo y mejorar, que es lo que
 * hace satisfactorio a un juego de puntería. Si fuera aleatorio en cada
 * partida, apuntar dejaría de ser una habilidad.
 *
 * Formato de datos: cada obstáculo es un objeto plano con un `type` y un
 * `aabb` (caja envolvente alineada a los ejes). La colisión es una prueba
 * de solapamiento de AABBs: barata, robusta y suficiente. No se usa
 * geometría exacta a propósito: el jugador percibe el impacto contra el
 * volumen visible, y una caja ajustada se comporta mejor que una malla.
 *
 * Módulo puro (sin Three.js): se puede testear en Node.
 * ============================================================
 */
import { OBSTACLES, WORLD, STAGES, AIM, PICKUPS } from '../config.js';
import { nivelDeCircuito } from '../game/flightProfile.js';
import { createRng, clamp } from '../core/math.js';
import { terrainHeightAt } from './terrainField.js';

/**
 * @typedef {Object} Obstacle
 * @property {number} id
 * @property {'spire'|'mesa'|'ring'} type
 * @property {number} x @property {number} z
 * @property {number} groundY   altura del suelo en (x,z)
 * @property {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}} aabb
 * @property {object} params    parámetros de construcción para el render
 * @property {boolean} passed   (solo aros) ya fue atravesado en este vuelo
 */

const HALF_DEPTH_BASE = 2.6;

/**
 * Genera el corredor completo.
 *
 * ── Dificultad creciente por tramos ──
 * El corredor está dividido en tramos de `STAGES.SEGMENT_LENGTH` metros, y cada
 * uno es más denso que el anterior: la separación entre obstáculos se acorta y
 * los tipos se van habilitando. Primero piedras sueltas, después mesetas, y los
 * aros al final (atravesarlos da monedas extra, así que se reservan para quien
 * ya domina la puntería).
 *
 * La densidad se aplica POR TRAMO y no de forma continua, para que el cambio se
 * sienta como un escalón al entrar a cada uno: es la señal de que la cosa se
 * pone más difícil.
 *
 * @returns {Obstacle[]}
 */
/**
 * Posiciones candidatas de decoración sobre una GRILLA ABSOLUTA.
 *
 * ── Por qué una grilla y no un sorteo por tramo ──
 * Sorteando dentro del tramo (`rng.range(from, to)`) la posición depende de dónde
 * caigan los bordes, así que al correr la ventana el decorado se re-sortea y el
 * jugador ve el mapa cambiar. Con una grilla absoluta cada casillero existe
 * siempre, en el mismo lugar, y sólo hace falta decidir si se ocupa.
 *
 * La `sal` separa los flujos (árboles, rocas, troncos) para que no caigan unos
 * encima de otros.
 *
 * @param {number} desde @param {number} hasta
 * @param {number} paso   separación entre casilleros (m)
 * @param {number} sal
 * @param {(x:number, rng:object) => void} colocar
 */
function porGrilla(desde, hasta, paso, sal, colocar) {
  /*
   * ── Se barren una celda de más a cada lado ──
   *
   * El jitter mueve cada objeto hasta un 30% del paso, así que un casillero que
   * cae justo fuera del rango puede terminar ADENTRO después del corrimiento. Si
   * el barrido se corta exacto en los bordes, ese objeto aparece o desaparece
   * según dónde termine la ventana: es el resto de "el mapa cambia al cruzar el
   * bioma".
   *
   * Barriendo de más y filtrando después por posición, el conjunto es el mismo sin
   * importar los bordes.
   */
  const primero = Math.ceil(Math.max(desde, OBSTACLES.CLEAR_RUNWAY) / paso) - 1;
  const ultimo = Math.floor(hasta / paso) + 1;
  for (let i = primero; i <= ultimo; i++) {
    // Semilla por casillero: el mismo casillero da siempre lo mismo.
    const rng = createRng(OBSTACLES.SEED + i * 2654435761 + sal * 104729);
    const x = i * paso + rng.range(-paso * 0.3, paso * 0.3);
    /*
     * El jitter puede empujar la posición FUERA del rango pedido.
     *
     * Sin este filtro, generar hasta 2500 m producía objetos en 2500-2550, que
     * caían en el tramo 6: al medir "obstáculos por tramo" aparecía un tramo de
     * más con 8 objetos y la curva de dificultad parecía romperse. Era un
     * artefacto de la generación, no del diseño.
     */
    if (x < desde || x >= hasta) continue;
    colocar(x, rng);
  }
}

/**
 * Generador determinista de un tramo.
 *
 * `sal` separa los flujos: el corredor principal, los árboles, las rocas y los
 * troncos usan sales distintas para que no se pisen los unos a los otros. Sin
 * eso, dos generadores con la misma semilla producirían la misma secuencia y las
 * rocas caerían exactamente donde caen los árboles.
 *
 * @param {number} tramo índice de tramo
 * @param {number} sal   número que separa un flujo de otro
 */
function rngDeTramo(tramo, sal) {
  return createRng(OBSTACLES.SEED + tramo * 7919 + sal * 104729);
}

/**
 * Altura de la línea de vuelo a esa distancia, inyectada desde afuera.
 *
 * ── Por qué inyectada ──
 * Las barreras necesitan saber a qué altura vuela el avión para garantizar que
 * al menos un hueco sea alcanzable. Esa altura la define el perfil de vuelo, que
 * vive en `game/`. Importarlo acá acoplaría `world/` con `game/` y rompería la
 * regla de que los módulos de mundo no dependen de los del juego (y sean
 * testeables sin navegador). El juego la inyecta al arrancar.
 *
 * @type {((x:number, groundY:number) => number) | null}
 */
let altitudeProvider = null;

/** Inyecta el proveedor de altura de vuelo. */
export function setCourseAltitudeProvider(fn) {
  altitudeProvider = fn;
}

/**
 * Genera el corredor, o una porción de él.
 *
 * ── Por qué acepta un rango ──
 * El corredor ya no termina: se generan tramos a medida que el jugador avanza
 * (ver `game/Game.js`). Una función que sólo supiera hacer "todo el corredor"
 * obligaría a regenerar el mundo entero cada vez, y con un corredor sin fin eso
 * es imposible.
 *
 * ── Por qué la semilla sale del TRAMO y no del corredor ──
 * Cada tramo se sortea con `SEED + índice`, así que el MISMO tramo sale siempre
 * igual sin importar cuándo se genere ni en qué orden. Eso da las dos cosas que
 * hacen falta a la vez:
 *
 *   · El mundo es determinista y reproducible entre partidas.
 *   · Un tramo se puede generar suelto, cuando el jugador se acerca, sin
 *     depender de haber generado todos los anteriores.
 *
 * ── Sobre "recursivo" ──
 * La generación no es recursiva (no se llama a sí misma), pero el EFECTO es el
 * que se pidió: el corredor se prolonga indefinidamente y cada tramo es distinto.
 * Se hace por tramos y no recursivo porque un tramo necesita saber DÓNDE está
 * para sortear su contenido: la posición es el parámetro, no un acumulador.
 *
 * @param {{from?:number, to?:number, startId?:number}} [rango]
 *   `from`/`to` acotan el corredor (por defecto, el corredor completo del modo).
 * @returns {Obstacle[]}
 */
export function generateCourse(rango = {}) {
  const desde = rango.from ?? 0;
  const hasta = rango.to ?? WORLD.COURSE_LENGTH;
  /*
   * Cada tramo de 500 m tiene su propia semilla. `Math.floor(desde / 500)` es el
   * índice del tramo, así que dos llamadas para el mismo tramo dan lo mismo.
   */
  /*
   * La semilla sale del ÍNDICE del tramo, así que el mismo tramo da siempre el
   * mismo contenido. Eso es lo que hace que el mundo sea ESTABLE: al correr la
   * ventana, los tramos que siguen en pantalla se regeneran idénticos y el
   * jugador no ve el mapa cambiar de golpe.
   */
  const tramo = Math.floor(desde / STAGES.SEGMENT_LENGTH);
  /** @type {Obstacle[]} */
  const list = [];

  /*
   * ── El punto de arranque se ALINEA al tramo ──
   *
   * ── El bug que esto arregla ──
   * El bucle arrancaba en `max(CLEAR_RUNWAY, desde)`. Como `desde` depende de
   * dónde esté la ventana, dos generaciones del mismo tramo arrancaban en puntos
   * distintos: el avance acumulado (`x += gap`) quedaba desfasado y el contenido
   * salía CORRIDO. Medido, el mismo tramo daba piedras en x=4508 desde una
   * ventana y en x=4504 desde otra — el jugador veía el mapa cambiar de golpe.
   *
   * Arrancando siempre en la frontera del tramo, la secuencia es idéntica sin
   * importar dónde empiece la ventana.
   */
  /*
   * ── El bucle arranca en la frontera del tramo y REINICIA ahí ──
   *
   * ── El bug que esto arregla ──
   * Con `x += gap` acumulado entre tramos, la posición de cada obstáculo dependía
   * del punto donde arrancara la ventana. Medido: el mismo tramo daba una mesa en
   * x=2043 desde la ventana 1500-3500 y en x=2032 desde la 2000-4000 — los mismos
   * 11 m de corrimiento.
   *
   * Al reiniciar la acumulación en cada frontera, el contenido de un tramo depende
   * sólo de sí mismo.
   */
  const arranque = Math.max(
    OBSTACLES.CLEAR_RUNWAY,
    Math.floor(desde / STAGES.SEGMENT_LENGTH) * STAGES.SEGMENT_LENGTH,
  );
  let x = arranque;
  let id = rango.startId ?? 0;

  /*
   * El generador del tramo en el que estamos parados. Se cambia al cruzar la
   * frontera, así que cada tramo consume su propia secuencia y no le importa
   * cuántos tramos se generaron antes.
   */

  /*
   * ── Un bucle POR TRAMO ──
   *
   * ── Por qué no un solo `while` ──
   * Con un único bucle que avanzaba hasta `hasta - 30` (el fin de la VENTANA), el
   * último tramo de la ventana se cortaba antes de su frontera. Al correr la
   * ventana ese tramo pasaba a ser interior y generaba 1-3 obstáculos más:
   * medido, el mismo rango daba 254 objetos desde una ventana y 256 desde la
   * siguiente, y el jugador veía el mapa cambiar al cruzar el bioma.
   *
   * Con un bucle por tramo, cada uno cierra en SU frontera y su contenido depende
   * sólo de sí mismo.
   */
  const primerTramoDatos = Math.max(
    Math.floor(arranque / STAGES.SEGMENT_LENGTH),
    Math.floor(OBSTACLES.CLEAR_RUNWAY / STAGES.SEGMENT_LENGTH),
  );
  const ultimoTramoDatos = Math.floor((hasta - 1) / STAGES.SEGMENT_LENGTH);

  for (let tramoIdx = primerTramoDatos; tramoIdx <= ultimoTramoDatos; tramoIdx++) {
    /*
     * El generador del tramo, y la posición SIEMPRE alineada a su frontera.
     *
     * Sin la alineación, `x` arrastraba los metros que se hubiera pasado el tramo
     * anterior con `x += gap`, y el contenido salía corrido.
     */
    const rngTramo = rngDeTramo(tramoIdx, 1);
    let x = Math.max(tramoIdx * STAGES.SEGMENT_LENGTH, OBSTACLES.CLEAR_RUNWAY);
    /*
     * El tramo cierra en SU frontera, no en `hasta - 30`.
     *
     * Ver la nota de arriba: cortar en el fin de la ventana hacía que el último
     * tramo quedara a medias y que al correr la ventana cambiara su contenido.
     */
    const finTramo = (tramoIdx + 1) * STAGES.SEGMENT_LENGTH;

    while (x < finTramo) {
      const progress = x / WORLD.COURSE_LENGTH;
      const stage = Math.floor(x / STAGES.SEGMENT_LENGTH);

      /*
       * Al entrar a un tramo nuevo se cambia de generador.
       *
       * Es lo que hace que el contenido de un tramo sea INDEPENDIENTE del resto:
       * sin esto el estado del generador arrastra lo que consumieron los tramos
       * anteriores, y generar la misma ventana corrida 500 m daba otro mapa.
       */

      // Cuánto se aprieta este tramo: 1.0 en el primero, más en los siguientes.
      /*
       * La densidad sigue la MISMA curva que el relieve: crece a lo largo de los
       * biomas de la lista y se satura en el último, que se repite sin fin.
       *
       * `stage` es el índice de tramo y puede crecer indefinidamente porque el
       * corredor no termina; el `min` es lo que hace que del sexto en adelante la
       * dificultad se mantenga en vez de volverse imposible.
       */
      const density = 1 + Math.min(stage, STAGES.MAX_DENSITY_STAGE) * STAGES.DENSITY_PER_STAGE;
      // Dentro del tramo se aprieta un poco más hacia el final.
      const inner = (x % STAGES.SEGMENT_LENGTH) / STAGES.SEGMENT_LENGTH;
      const pressure = density * (1 + inner * 0.25);

      // Tipo según avance. Los aros aparecen recién en el segundo tramo.
      let type = 'spire';
      if (progress > 0.06 && rngTramo.chance(0.32)) type = 'mesa';
      {
      const circ = PICKUPS.CIRCUITOS[nivelDeCircuito(tramoIdx)] ?? PICKUPS.CIRCUITOS.alto;
      if (progress > 0.18 && rngTramo.chance(circ.ringChance)) type = 'ring';
    }

      // Posición lateral: se evita el centro exacto del carril sólo en los
      // aros, para que haya que elegir una línea de vuelo.
      const z = clamp(rngTramo.range(-24, 24), -WORLD.COURSE_HALF_WIDTH + 8, WORLD.COURSE_HALF_WIDTH - 8);

      const obstacle = buildObstacle(type, id, x, z, progress, rngTramo);
      list.push(obstacle);
      id++;

      /*
       * Separación: se divide por la presión del tramo.
       *
       * El piso de 11 m es lo que impide que un tramo avanzado genere un muro
       * infranqueable: por debajo de eso el avión no tiene hueco para pasar ni
       * con el control lateral a fondo.
       */
      const gap = rngTramo.range(OBSTACLES.MIN_SPACING, OBSTACLES.MAX_SPACING) / pressure;
      x += Math.max(11, gap);
    }
  }

  /*
   * ── Herramientas y desafíos del entorno ──
   *
   * Van DESPUÉS del bucle principal para que no lo desordenen: los dos agregan
   * varios obstáculos en una misma x, y el bucle principal asume uno por paso.
   */
  addTrees(list, null, () => id++, desde, hasta);
  addRocks(list, null, () => id++, desde, hasta);
  addLogs(list, null, () => id++, desde, hasta);

  // El corredor tiene que quedar ordenado por x: varias partes del código
  // (colisiones, recolectables, HUD) lo asumen.
  list.sort((a, b) => a.x - b.x);
  /*
   * ── Aros: se despeja su interior ──
   *
   * ── El bug que esto arregla ──
   * Los aros no colisionan (ver `findCollision`), pero NADA impedía que un árbol
   * o una roca apareciera DENTRO del agujero. El jugador apuntaba al aro, cruzaba
   * limpio y chocaba contra lo que había adentro: se reportó a los 5000 m.
   *
   * Se recorre al final y se descartan los sólidos que se solapen con el volumen
   * de un aro. Es un post-proceso para no depender del orden de generación.
   */
  {
    const aros = list.filter((o) => o.type === 'ring');
    if (aros.length) {
      const MARGEN = 3;
      for (let k = list.length - 1; k >= 0; k--) {
        const o = list[k];
        if (o.type === 'ring') continue;
        const choca = aros.some((a) => {
          const ra = a.params?.radius ?? 6;
          const ac = a.params?.centerY ?? a.aabb.minY;
          /*
           * Distancia al CENTRO del aro en 3D, con el radio del aro más un margen.
           * Se usa el centro y no la AABB porque el aro es un anillo: su caja es
           * un cuadrado que no representa el agujero.
           */
          const d = Math.hypot(o.x - a.x, (o.aabb.minY + o.aabb.maxY) / 2 - ac, o.z - a.z);
          return d < ra + MARGEN;
        });
        if (choca) list.splice(k, 1);
      }
    }
  }

  return list;
}

/**
 * Árboles: la vegetación del entorno.
 *
 * ── Por qué árboles ──
 * Son el recurso que hace LEGIBLE la llanura. Sin ellos, un tramo plano es una
 * sábana vacía donde el jugador no tiene referencias de velocidad ni de altura,
 * y volar rápido se siente como flotar. Además son esquivables de forma justa:
 * son finos, así que se pasan de costado, a diferencia de una mesa.
 *
 * La cantidad crece por tramo: escasos al principio, tupidos al final.
 *
 * @param {Obstacle[]} list @param {ReturnType<typeof createRng>} rng @param {() => number} nextId
 */
function addTrees(list, _rngIgnorado, nextId, desde, hasta) {
  const perStage = OBSTACLES.TREES_PER_STAGE;
  if (perStage <= 0) return;

  const primerTramo = Math.floor(desde / STAGES.SEGMENT_LENGTH);
  /*
   * Se resta 1: el tramo que empieza EXACTAMENTE en `hasta` no pertenece al
   * rango pedido. Sin esto un corredor de 2500 m generaba objetos en 2500-2550.
   */
  const ultimoTramo = Math.floor((hasta - 1) / STAGES.SEGMENT_LENGTH);
  for (let stage = primerTramo; stage <= ultimoTramo; stage++) {
    // Generador propio del tramo: ver `rngDeTramo`.
    const rng = rngDeTramo(stage, 2);
    const from = stage * STAGES.SEGMENT_LENGTH;
    /*
     * ── El tramo cierra en SU frontera ──
     *
     * Antes era `Math.min(hasta - 30, ...)`, con `hasta` el fin de la VENTANA. En
     * el último tramo de la ventana el rango de sorteo se acortaba, y como
     * `rng.range(a, b)` escala según `b`, los árboles salían corridos unos metros.
     * Medido: el mismo árbol en x=4565 desde una ventana y en x=4568 desde otra.
     */
    const to = from + STAGES.SEGMENT_LENGTH;
    // Cada tramo tiene más que el anterior: es la parte visible de la dificultad.
    const count = Math.round(perStage * (1 + Math.min(stage, STAGES.MAX_DENSITY_STAGE) * 0.55));

    for (let i = 0; i < count; i++) {
      const x = rng.range(from + 12, to - 12);
      // `continue`, no `return`: acá SÍ hay un bucle alrededor. Con `return` la
      // función salía entera al primer árbol bajo la rampa y sólo se generaban 5.
      if (x < OBSTACLES.CLEAR_RUNWAY) continue;
      /*
       * Los árboles se reparten por TODO el ancho, incluido el corredor.
       *
       * ── Por qué volvieron adentro ──
       * Los había empujado fuera del corredor para bajar la carga de obstáculos
       * activos. Pero se pidió que lo que hay que esquivar "en primera instancia"
       * sean rocas Y árboles: sacarlos del camino los convertía en decorado y el
       * juego perdía el obstáculo que más se lee a distancia.
       *
       * La carga se controla con la DENSIDAD de la grilla, no sacándolos del
       * camino. Ver el cálculo de `paso` al principio de la función.
       */
      const z = clamp(
        rng.range(-WORLD.COURSE_HALF_WIDTH - 30, WORLD.COURSE_HALF_WIDTH + 30),
        -WORLD.TERRAIN_WIDTH / 2 + 6,
        WORLD.TERRAIN_WIDTH / 2 - 6,
      );
      const progress = x / WORLD.COURSE_LENGTH;
      list.push(buildTree(nextId(), x, z, progress, rng));
    }
  }
}

/** Un árbol: tronco fino y copa. La copa es lo que colisiona. */
function buildTree(id, x, z, progress, rng) {
  const groundY = terrainHeightAt(x, z);
  const growth = 1 + Math.min(progress, 0.35) * 0.4;
  /*
   * ── El árbol no puede llegar al techo de vuelo ──
   *
   * ── El bug que esto arregla ──
   * Medido, con el terreno del último bioma a ~13 m los árboles más altos
   * llegaban a 38-40 m, POR ENCIMA del techo del modo frenético (35 m). El
   * jugador volaba al tope, se chocaba y lo leía como "choqué contra el techo":
   * era un pino, no un límite invisible.
   *
   * El techo tiene que ser aire LIBRE, no el borde de las copas. Se recorta la
   * altura para que siempre queden unos metros de margen arriba.
   *
   * El margen sale del modo activo, así que si mañana cambia el techo los árboles
   * se acomodan solos.
   */
  const margen = 7;
  const alturaMax = Math.max(4, AIM.CEILING - margen - groundY);
  const height = Math.min(rng.range(7, 14) * growth, alturaMax);

  /*
   * ── La caja es FINA y llega sólo hasta donde llega el tronco ──
   *
   * ── Por qué se achicó ──
   * Estaba en 1.1-2.2 m de semiancho por 7-14 m de alto, y el dibujo no llena esa
   * caja: la copa es un cono que se afina hacia arriba. El resultado era una
   * hitbox desfasada —se chocaba "al lado" del pino y por encima de la punta—,
   * que es exactamente lo que se reportó.
   *
   * Ahora el ancho acompaña al tronco (0.55-0.95 m de semiancho) y el alto se
   * recorta a la parte que de verdad ocupa: la punta del cono se puede rozar.
   *
   * La consecuencia buscada: se puede volar BIEN BAJO y bien cerca sin chocar
   * contra algo invisible.
   */
  const halfX = rng.range(0.55, 0.95);
  const halfZ = halfX * rng.range(0.85, 1.15);
  // El 88% deja fuera la punta fina, que visualmente no es un obstáculo.
  /*
   * El 0.88 dejaba la caja por encima de donde la copa ya es fina. Con 0.78 se
   * puede rozar la punta del pino sin morir, que es lo que permite pasar entre
   * árboles volando bajo.
   */
  const solidTop = groundY + height * 0.78;

  return {
    id,
    type: 'tree',
    x,
    z,
    groundY,
    passed: false,
    aabb: {
      minX: x - halfX,
      maxX: x + halfX,
      minY: groundY,
      maxY: solidTop,
      minZ: z - halfZ,
      maxZ: z + halfZ,
    },
    params: { height, halfX, halfZ, rotation: rng.range(0, Math.PI * 2), sides: rng.int(4, 5) },
  };
}

/**
 * Aglomeraciones de rocas: el obstáculo "grande" del modo frenético.
 *
 * ── Por qué rocas y no barreras ──
 * La primera versión usaba muros con huecos. Se pidió sacarlos: "no quiero
 * barreras horizontales que sean bloques, quiero que el mismo entorno sean los
 * obstáculos". Un muro artificial en medio de un paisaje natural ensucia la
 * escena y rompe la lectura.
 *
 * Una aglomeración cumple la MISMA función de juego —bloquea un tramo del
 * corredor y obliga a elegir por dónde pasar— pero es parte del paisaje. Y tiene
 * una ventaja: se puede rodear, así que castiga menos que un muro y deja más
 * caminos posibles, que es justo lo que se pidió para el frenético.
 *
 * @param {Obstacle[]} list @param {ReturnType<typeof createRng>} rng @param {() => number} nextId
 */
function addRocks(list, _rngIgnorado, nextId, desde, hasta) {
  const perStage = OBSTACLES.ROCKS_PER_STAGE;
  if (perStage <= 0) return;

  // Una aglomeración cada `paso` metros, sobre grilla absoluta.
  const gruposMax = perStage * (1 + STAGES.MAX_DENSITY_STAGE * 0.4);
  const paso = Math.max(60, STAGES.SEGMENT_LENGTH / Math.max(1, gruposMax));

  porGrilla(desde, hasta, paso, 3, (x, rng) => {
      if (x < OBSTACLES.CLEAR_RUNWAY + 30) return;
      const progress = x / WORLD.COURSE_LENGTH;

      /*
       * El grupo se centra en un lado del corredor, NO en el centro.
       *
       * Es lo que garantiza que siempre quede un camino: una aglomeración en el
       * medio obligaría a pasar por un costado, pero una que tape todo el ancho
       * sería un muro. Se sortea el lado y se deja el otro libre.
       */
      const lado = rng.chance(0.5) ? -1 : 1;
      const centro = lado * rng.range(4, 22);
      const piedras = rng.int(2, 4);

      for (let i = 0; i < piedras; i++) {
        const ox = x + rng.range(-6, 6);
        // Se apelotonan alrededor del centro del grupo, sin abrirse demasiado.
        const oz = centro + rng.range(-7, 7);
        const oy = terrainHeightAt(ox, oz);
        /*
         * La caja sigue al cuerpo, no al hueco que deja el dodecaedro.
         *
         * Un dodecaedro inscrito en un radio R sobresale bastante menos que R en
         * cada eje, así que usar R tal cual dejaba una hitbox generosa: se
         * chocaba antes de tocar la piedra. El 0.82 la ajusta a la silueta.
         */
        /*
         * ── La roca tampoco puede llegar al techo ──
         *
         * Medido, en el último bioma una roca alta quedaba a 2.0 m del techo de
         * 35 m: el margen era tan fino que volar arriba era una ruleta. Se limita
         * la ALTURA de la roca (no el radio, que define el ancho) para que siempre
         * queden varios metros libres por encima.
         */
        const radio = rng.range(2.2, 5.0) * (1 + progress * 0.35);

        /*
         * ── La altura se sortea UNA vez y se usa para las dos cosas ──
         *
         * ── El bug que esto arregla ──
         * Antes había dos llamadas a \`rng.range(1.1, 1.9)\`: una para dibujar la
         * roca y otra para armar su caja de colisión. Al ser llamadas distintas
         * daban números distintos, así que la hitbox NO coincidía con el dibujo
         * —por eso se chocaba "al lado" de las rocas—.
         *
         * Y de paso se acota contra el techo del modo: en el último bioma una roca
         * alta quedaba a 2 m del techo y volar arriba era una ruleta.
         */
        const alto = Math.min(
          radio * rng.range(1.1, 1.9),
          Math.max(2, AIM.CEILING - 7 - oy),
        );

        list.push({
          id: nextId(),
          type: 'rock',
          x: ox,
          z: oz,
          groundY: oy,
          passed: false,
          /*
           * Un dodecaedro de radio R sobresale ~0.79·R en cada eje horizontal y
           * menos aún en altura. La caja usa 0.68 y 0.78: apenas por dentro de la
           * silueta, para que rozar no mate pero tampoco se pueda atravesar.
           */
          aabb: {
            minX: ox - radio * 0.68,
            maxX: ox + radio * 0.68,
            minY: oy,
            maxY: oy + alto * 0.78,
            minZ: oz - radio * 0.68,
            maxZ: oz + radio * 0.68,
          },
          params: {
            radius: radio,
            // El MISMO `alto` que usa la caja: ver la nota de arriba.
            height: alto,
            sides: rng.int(5, 7),
            rotation: rng.range(0, Math.PI * 2),
          },
        });
      }
  });
}

/**
 * Troncos caídos: el obstáculo alargado y bajo.
 *
 * ── Qué aporta ──
 * Es el "árbol gigante semi caído" que se pidió. A diferencia de una roca, que
 * es un bulto, un tronco cruza el corredor de lado: obliga a SUBIR o a rodearlo
 * por un extremo, así que ataca un eje distinto (la altura) y obliga a usar el
 * control de morro. Es la variación que evita que todos los obstáculos se
 * esquiven igual.
 *
 * Se apoya en el suelo y suele estar inclinado, así que un extremo queda más
 * alto: se puede pasar por encima del lado bajo.
 *
 * @param {Obstacle[]} list @param {ReturnType<typeof createRng>} rng @param {() => number} nextId
 */
function addLogs(list, _rngIgnorado, nextId, desde, hasta) {
  const perStage = OBSTACLES.LOGS_PER_STAGE;
  if (perStage <= 0) return;

  const paso = Math.max(80, STAGES.SEGMENT_LENGTH / Math.max(1, perStage));

  porGrilla(desde, hasta, paso, 4, (x, rng) => {
      if (x < OBSTACLES.CLEAR_RUNWAY + 25) return;

      const z = rng.range(-26, 26);
      const groundY = terrainHeightAt(x, z);
      const radio = rng.range(1.5, 2.6);
      // Largo: cruza buena parte del corredor.
      const largo = rng.range(16, 34);
      /*
       * Inclinación: el tronco "semi caído". Un extremo se apoya en el suelo y
       * el otro queda levantado, así que hay un lado por el que se pasa por
       * arriba con poco esfuerzo.
       */
      const inclinacion = rng.range(0.12, 0.38);
      const alto = groundY + Math.sin(inclinacion) * largo;

      list.push({
        id: nextId(),
        type: 'log',
        x,
        z,
        groundY,
        passed: false,
        /*
         * La caja cubre TODO el tronco. Es conservadora a propósito: el tronco
         * está inclinado y una caja ajustada dejaría huecos por los que el avión
         * pasaría "a través" de la madera.
         */
        aabb: {
          minX: x - radio * 0.95,
          maxX: x + radio * 0.95,
          minY: groundY,
          maxY: Math.max(alto, groundY + radio * 2),
          minZ: z - largo / 2,
          maxZ: z + largo / 2,
        },
        params: { radio, largo, inclinacion, rotation: rng.range(0, Math.PI * 2) },
      });
  });
}

/**
 * Construye un obstáculo concreto y su AABB.
 * @returns {Obstacle}
 */
function buildObstacle(type, id, x, z, progress, rng) {
  const groundY = terrainHeightAt(x, z);
  // La dificultad crece con el avance: obstáculos más altos y anchos.
  /*
   * El tamaño crece con el avance pero se acota: sin techo, en el tramo 20 las
   * piedras serían torres de 40 m y el corredor quedaría intransitable.
   */
  const growth = 1 + Math.min(progress, 0.35) * 0.55;

  if (type === 'ring') {
    const innerRadius = rng.range(4.2, 6.0);
    const tube = rng.range(0.55, 0.9);
    // El aro se centra a una altura que el jugador puede alcanzar y varía
    // lo suficiente para obligarlo a elegir el pitch correcto.
      /*
       * ── Altura del aro según el CIRCUITO del tramo ──
       *
       * 'alto' pone los aros a 15-30 m del suelo y 'rasante' a 5-12 m. Se acota
       * contra el techo porque en los biomas avanzados el suelo ya está a ~14 m:
       * sin el tope un aro "alto" caería por encima del techo y sería inalcanzable.
       */
      const circAro = PICKUPS.CIRCUITOS[nivelDeCircuito(Math.floor(x / STAGES.SEGMENT_LENGTH))] ?? PICKUPS.CIRCUITOS.alto;
      const centerY = Math.min(groundY + rng.range(circAro.ringMin, circAro.ringMax), AIM.CEILING - 4);
    const halfDepth = tube;

    return {
      id,
      type,
      x,
      z,
      groundY,
      passed: false,
      // AABB de la corona: si el avión la cruza, choca contra el aro.
      aabb: {
        minX: x - halfDepth,
        maxX: x + halfDepth,
        minY: centerY - innerRadius - tube,
        maxY: centerY + innerRadius + tube,
        minZ: z - innerRadius - tube,
        maxZ: z + innerRadius + tube,
      },
      // Zona de paso: estar dentro de este cilindro y cruzar el plano del
      // aro cuenta como atravesarlo (y da monedas).
      passZone: { y: centerY, radius: innerRadius - 0.25, halfDepth: halfDepth + 1.2 },
      params: { innerRadius, tube, centerY, rotationY: rng.range(-0.25, 0.25) },
    };
  }

  const isMesa = type === 'mesa';
  const height = (isMesa ? rng.range(5, 8.5) : rng.range(4, 9.5)) * growth;
  const halfZ = (isMesa ? rng.range(4.5, 8) : rng.range(1.6, 3.4)) ;
  const halfX = (isMesa ? rng.range(4, 7) : rng.range(1.8, 3.2)) * (1 + progress * 0.2);

  return {
    id,
    type,
    x,
    z,
    groundY,
    passed: false,
    aabb: {
      minX: x - halfX,
      maxX: x + halfX,
      minY: groundY,
      maxY: groundY + height,
      minZ: z - halfZ,
      maxZ: z + halfZ,
    },
    params: { height, halfX, halfZ, sides: isMesa ? rng.int(6, 8) : rng.int(5, 7), rotation: rng.range(0, Math.PI) },
  };
}

/** ¿Un punto está dentro de la caja? */
export function pointInAabb(px, py, pz, aabb) {
  return (
    px >= aabb.minX &&
    px <= aabb.maxX &&
    py >= aabb.minY &&
    py <= aabb.maxY &&
    pz >= aabb.minZ &&
    pz <= aabb.maxZ
  );
}

/**
 * Prueba si el avión (con un radio de seguridad) choca contra algún obstáculo.
 *
 * El radio es importante para la sensación de juego: sin él, el avión tiene
 * que atravesar literalmente el vértice del obstáculo y los roces "injustos"
 * se sienten como un fallo del juego.
 *
 * @param {Obstacle[]} obstacles
 * @param {number} x @param {number} y @param {number} z
 * @param {number} radius
 * @returns {Obstacle|null}
 */
export function findCollision(obstacles, x, y, z, radius) {
  for (const ob of obstacles) {
    const a = ob.aabb;
    // AABB expandida por el radio del avión.
    if (
      x >= a.minX - radius &&
      x <= a.maxX + radius &&
      y >= a.minY - radius &&
      y <= a.maxY + radius &&
      z >= a.minZ - radius &&
      z <= a.maxZ + radius
    ) {
      /*
       * ── Los aros NO son obstáculos ──
       *
       * Se pidió explícitamente: el borde del aro no debe chocar con la nave.
       * Un aro es una OPORTUNIDAD, no un peligro: si cruzás el centro limpio te
       * llevás el premio, y si lo rozás no pasa nada. Hacerlo colisionar
       * castigaba justamente al jugador que se animaba a apuntarle.
       *
       * El premio se detecta aparte, en `findRingsPassed`, que sólo cuenta el
       * cruce por DENTRO del agujero.
       */
      if (ob.type === 'ring') continue;
      return ob;
    }
  }
  return null;
}

/**
 * Detecta si el avión atravesó la zona de paso de algún aro entre dos
 * posiciones consecutivas. Devuelve los aros recién atravesados.
 *
 * Se comprueba el CRUCE del plano x del aro, no la permanencia dentro,
 * porque a 45 m/s el avión avanza ~0.75 m por frame y podría saltarse
 * por completo la ventana de detección.
 *
 * @param {Obstacle[]} obstacles
 * @param {number} prevX @param {number} x @param {number} y @param {number} z
 * @param {number} radius
 * @returns {Obstacle[]}
 */
export function findRingsPassed(obstacles, prevX, x, y, z, radius) {
  const hit = [];
  for (const ob of obstacles) {
    if (ob.type !== 'ring' || ob.passed) continue;
    const pz = ob.passZone;
    // ¿Cruzó el plano del aro en este paso?
    if (!(prevX < ob.x && x >= ob.x) && !(prevX > ob.x && x <= ob.x)) continue;
    const radial = Math.hypot(y - pz.y, z - ob.z);
    if (radial < pz.radius - radius * 0.5) {
      ob.passed = true;
      hit.push(ob);
    }
  }
  return hit;
}

/** Reinicia el estado por-vuelo de los aros. */
export function resetCourseState(obstacles) {
  for (const ob of obstacles) ob.passed = false;
}

/** Caja envolvente de todo el corredor (útil para depurar). */
export function courseBounds(obstacles) {
  let maxH = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const ob of obstacles) {
    maxH = Math.max(maxH, ob.aabb.maxY - ob.groundY);
    minX = Math.min(minX, ob.aabb.minX);
    maxX = Math.max(maxX, ob.aabb.maxX);
  }
  return { maxH, minX, maxX, count: obstacles.length };
}
