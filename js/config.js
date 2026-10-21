/**
 * PAPERCRASH — core/config.js
 * ============================================================
 * Configuración COMÚN a todos los modos de juego.
 *
 * ── Qué vive acá y qué no ──
 * Acá está lo que NO depende del modo: simulación, gravedad, economía, guardado,
 * audio y las constantes de presentación.
 *
 * Lo que SÍ depende del modo —rango de apuntado, mandos, relieve, tipos de
 * recolectable, propelente— se lee de `MODE` mediante getters. Los getters no
 * son un capricho: los sistemas guardan una referencia a estos objetos y leen
 * sus campos al usarlos, así que un cambio de modo tiene efecto inmediato sin
 * reiniciar. Si los valores se copiaran al arrancar, cambiar de modo no haría
 * nada hasta recargar la página.
 *
 * Ver `modes/index.js` para el registro y `modes/*.js` para los valores.
 *
 * Convención de unidades (sistema métrico):
 *   · distancias  → metros
 *   · velocidades → m/s
 *   · ángulos     → grados en config/UI, radianes solo dentro de physics
 *   · tiempo      → segundos
 *
 * Ejes del mundo:
 *   +X = avance del jugador (hacia el horizonte)
 *   +Y = arriba
 *   +Z = lateral (izquierda/derecha del corredor de vuelo)
 * ============================================================
 */
import { MODE } from './modes/index.js';


// ── Simulación / bucle ──────────────────────────────────────
export const SIM = {
  /** Paso fijo de integración. Desacopla la física de los FPS. */
  FIXED_DT: 1 / 120,
  /** Techo de tiempo real asimilable en un frame (evita "tunneling" tras un tab-out). */
  MAX_FRAME_DT: 0.1,
  /** Sub-pasos máximos por frame: guarda de rendimiento. */
  MAX_SUBSTEPS: 400,
  /** Cambio relativo de velocidad permitido por sub-paso (estabilidad del integrador). */
  CFL: 0.05,
  /**
   * Techo absoluto de velocidad. Con el rango válido de stats (~10..100 m/s)
   * está muy por encima de lo alcanzable; solo actúa como red de seguridad
   * si el jugador edita el guardado y deja los coeficientes fuera de rango.
   */
  MAX_SPEED: 400,
  /**
   * ── Tope de duración de un vuelo (s) ──
   *
   * ── El bug que esto arregla ──
   * Valía 90 s y CORTABA EL VUELO EN EL AIRE. Con las mejoras al máximo el jugador
   * supera esa marca con facilidad, así que el avión "explotaba" a media altura
   * sin haber chocado con nada — y peor, se reportaba como `ground`, así que
   * parecía un choque contra el suelo.
   *
   * Esto no es una regla de juego: es una red de seguridad para que un vuelo no
   * quede colgado para siempre (por ejemplo, si algo lo dejara planeando sin
   * descender). Con 600 s sigue cumpliendo esa función y ningún jugador real lo
   * alcanza.
   */
  MAX_FLIGHT_TIME: 600,
};

/**
 * Cuántas muestras de física por frame de render se permiten.
 * Evita que un upgrade muy potente convierta un frame en una avalancha de sub-pasos.
 */
export const MAX_SUBSTEPS_PER_FRAME = SIM.MAX_SUBSTEPS;

// ── Mundo ───────────────────────────────────────────────────
export const WORLD = {
  /**
   * Longitud total del corredor (m).
   *
   * Se extendió de 600 a 2500 al aparecer los tramos: con vuelos de 250-400 m,
   * 600 m se terminaban en dos lanzamientos buenos y no había progresión que
   * mostrar.
   */
  COURSE_LENGTH: 2500,
  /** Ancho jugable (m): límite de |z| antes de salirse del corredor. */
  COURSE_HALF_WIDTH: 70,
  /**
   * Ancho de la malla del terreno (m).
   *
   * Se ensanchó junto con el corredor: con 120 m las paredes laterales quedaban
   * a la vista en cuanto el corredor se alejaba del centro.
   */
  TERRAIN_WIDTH: 420,
  /** Zona plana inicial alrededor de la resortera (m), hacia adelante. */
  FLAT_ZONE: 24,
  /**
   * Plataforma plana HACIA ATRÁS del lanzador (m).
   *
   * La malla del terreno arrancaba en x = 0, así que desde la cámara se veía el
   * borde del mundo justo detrás de la resortera. Con esto el suelo se extiende
   * hacia atrás y sube en una loma que tapa ese corte.
   */
  PAD_BACK_LENGTH: 40,
  /**
   * Cuánto terreno se construye DETRÁS de la plataforma (m).
   *
   * El valor se elige junto con la niebla: con `FOG_DENSITY` de abajo, a ~180 m
   * ya casi no se ve nada, así que alcanza para que el borde de la malla quede
   * siempre oculto, mire donde mire la cámara.
   */
  BEHIND_LENGTH: 420,
  /** Densidad de la niebla exponencial (1/m). Sube con la distancia al ojo. */
  FOG_DENSITY: 0.0055,
};

// ── Tramos ──────────────────────────────────────────────────
/**
 * El corredor se divide en tramos de `SEGMENT_LENGTH` metros que van cambiando
 * de aspecto y de dificultad.
 *
 * La idea: los primeros son rasantes, planos y con pocos obstáculos, para que
 * la experiencia inicial sea esquivar y juntar. La altura y la densidad llegan
 * después, cuando el jugador ya domina el planeo y la propulsión.
 */
export const STAGES = {
  /** Longitud de cada tramo (m). */
  SEGMENT_LENGTH: 500,
  /**
   * Cuántos tramos se mantienen generados.
   *
   * ── Por qué hace falta un límite ──
   * El corredor se prolonga indefinidamente (ver `world/obstacles.js`), pero no
   * se puede tener todo generado: medido, un vuelo con boosters llega a ~29 km, y
   * a la densidad del modo frenético eso son decenas de miles de obstáculos.
   *
   * Se genera una VENTANA alrededor del avión y el resto se descarta. Los tramos
   * se pueden regenerar cuando haga falta porque su semilla sale del índice: el
   * mismo tramo da siempre el mismo contenido.
   *
   * Los valores son asimétricos a propósito: hacia atrás el jugador ya pasó y no
   * necesita ver nada, hacia adelante necesita tener el corredor listo antes de
   * llegar.
   */
  CHUNKS_BEHIND: 1,
  /**
   * ── Por qué 3 y no 4 ──
   * Medido, con 4 la ventana generaba 810 obstáculos. Con 3 son ~600, y alcanza:
   * la niebla del corredor no deja ver más de dos tramos hacia adelante, así que
   * el cuarto no se veía nunca.
   */
  CHUNKS_AHEAD: 3,
  /**
   * Cuánto crece la ALTURA del entorno a lo largo del corredor.
   *
   * 0 = todos los tramos igual de planos. Con 0.75 el último tramo tiene un
   * relieve bastante más alto, que es lo que obliga a volar alto.
   */
  HEIGHT_GROWTH: 0.75,
  /**
   * Escala del relieve: la pone el MODO.
   *
   * El clásico tiene lomas que hay que sobrevolar; el frenético es una llanura
   * donde el desafío son los obstáculos y no el suelo.
   */
  get GROUND_AMPLITUDE() { return MODE.terrain.amplitude; },
  /**
   * Paletas por tramo. Se repiten en ciclo si hay más tramos que paletas.
   *
   * `sky` y `fog` son colores; `name` se muestra en el HUD al entrar al tramo.
   */
  PALETTES: [
    { name: 'LLANURA', sky: 0x0a0e1a, fog: 0x0a0e1a, ground: 0x2f4a2a, rock: 0x4a4038, accent: 0x66ffaa },
    { name: 'BOSQUE', sky: 0x0d1a14, fog: 0x0d1a14, ground: 0x24421f, rock: 0x3a4a34, accent: 0x9be564 },
    { name: 'CAÑÓN', sky: 0x140d1a, fog: 0x140d1a, ground: 0x4a3a26, rock: 0x6b5540, accent: 0xffb020 },
    { name: 'CORDILLERA', sky: 0x0a1020, fog: 0x101828, ground: 0x3a3a4a, rock: 0x7a8296, accent: 0x00e5ff },
    { name: 'CREPÚSCULO', sky: 0x1a0f22, fog: 0x1a0f22, ground: 0x3d2a3a, rock: 0x6a4a5c, accent: 0xff4f8b },
  ],
  /**
   * Cuántos obstáculos se agregan por tramo respecto del primero.
   *
   * La dificultad tiene que SENTIRSE creciente: mismo corredor, cada vez más
   * apretado.
   */
  DENSITY_PER_STAGE: 0.22,

  /**
   * Tramo a partir del cual la dificultad deja de crecer.
   *
   * ── Por qué hace falta un techo ──
   * La densidad se calculaba con el número de tramo ABSOLUTO, lo cual estaba bien
   * cuando el corredor tenía cinco. Con el corredor indefinido, en el tramo 20 la
   * fórmula pedía 17 árboles por tramo y, medido, una ventana de seis tramos
   * generaba 1912 obstáculos: el juego se arrastraba y el corredor era un muro.
   *
   * Con el techo la dificultad crece hasta el tramo 6 y de ahí en adelante se
   * mantiene: el desafío sigue siendo alto pero la carga es constante, así que un
   * vuelo de 10 km cuesta lo mismo que uno de 3 km.
   */
  MAX_DENSITY_STAGE: 6,
};

// ── Propulsión ──────────────────────────────────────────────
/**
 * La propulsión es una HABILIDAD ACTIVA, no un efecto de recoger un objeto.
 *
 * Recoger un booster carga una unidad; el jugador decide CUÁNDO gastarla
 * apretando Espacio en el aire. Eso convierte el booster en una decisión táctica
 * (¿la gasto ahora para llegar a ese aro, o la guardo?) en vez de un premio
 * automático.
 */
export const PROPULSION = {
  /** Empuje, como fracción de la velocidad de lanzamiento por segundo. */
  get THRUST() { return MODE.propulsion.thrust; },
  /** Duración de cada uso (s). */
  get BURN_TIME() { return MODE.propulsion.burnTime; },
  /** Tope de velocidad durante el empuje (m/s), para no salirse del corredor. */
  get MAX_SPEED() { return MODE.id === 'frenetic' ? 92 : 78; },
  /**
   * Empujón vertical extra si se usa la propulsión CON W apretada (m/s).
   *
   * Es el pedido: propulsar y tirar del morro hacia arriba da un envión, y
   * después el avión sigue planeando con la velocidad que traía.
   */
  CLIMB_KICK: 9.5,
  /** Velocidad de ascenso máxima que puede dar el empujón (m/s). */
  CLIMB_KICK_MAX_VY: 16,
  /** Cuánto combustible repone cada booster violeta (s). */
  get GLIDE_BONUS() { return MODE.fuel.glideRefill; },
  /** Tope del planeo acumulado (s). */
  get GLIDE_MAX() { return MODE.fuel.glideMax; },
  /**
   * Presupuesto de planeo inicial (s).
   *
   * En el CLÁSICO es el recurso central: se agota y el avión se cae. En el
   * FRENÉTICO vale 0 a propósito —no se juega planeando— y el recurso pasa a ser
   * el combustible de vuelo (`FUEL_MAX` / `FUEL_COST`).
   */
  get BASE_GLIDE() { return MODE.fuel.glide; },
  /** Combustible de vuelo con el que se arranca (s). */
  get FUEL_MAX() { return MODE.fuel.seconds; },
  /** Coste de cada propulsión en combustible de vuelo (s). */
  get FUEL_COST() { return MODE.fuel.thrustCost; },
  /** Cuánto combustible repone un booster violeta (s). */
  get FUEL_REFILL() { return MODE.fuel.fuelRefill ?? 0; },
  /**
   * Unidades máximas que se pueden llevar guardadas.
   *
   * Con tope: sin él, un vuelo largo acumularía propulsiones infinitas y la
   * habilidad dejaría de ser una decisión.
   */
  get MAX_CHARGES() { return MODE.propulsion.maxCharges; },
  /**
   * Enfriamiento entre usos (s).
   *
   * ── Tiene que ser MAYOR que BURN_TIME ──
   * El enfriamiento se cuenta desde que se PULSA, y la puerta que impide
   * encadenar es "el quemado anterior sigue activo". Si el enfriamiento termina
   * antes que el quemado, el jugador puede volver a pulsar mientras el anterior
   * sigue encendido: la pulsación se rechaza, y como cada rechazo reinicia el
   * enfriamiento, la propulsión queda BLOQUEADA PARA SIEMPRE. Ese fue el bug de
   * "después de un booster no te deja usar más".
   *
   * Medido: con 0.2 s contra un quemado de 1.1 s, el segundo uso se rechazaba
   * indefinidamente. Ahora el enfriamiento arranca después, cuando el quemado ya
   * terminó, así que la puerta se abre sola.
   */
  get COOLDOWN() { return MODE.id === 'frenetic' ? 1.3 : 0.35; },
};

// ── Controles en vuelo ──────────────────────────────────────
/**
 * Mandos del planeo: A/D para moverse de lado, W/S para subir o bajar la punta.
 *
 * El FRENÉTICO multiplica todo por `MODE.motion.controlScale`: ahí la movilidad
 * es la herramienta principal del jugador, no un ajuste fino.
 */
export const FLIGHT_CONTROLS = {
  /**
   * Aceleración lateral (m/s²). Es lo que define cuánto TARDA en responder.
   *
   * ── Por qué subió de 15 a 90 ──
   * Medido, con 15 el avión tardaba 0.56 s en llegar al 90% de su velocidad
   * lateral. En ese medio segundo recorría 16 m hacia adelante, así que para
   * cuando el giro se completaba ya estaba en otro lado: se sentía como si el
   * mando llegara tarde y obligaba a corregir de nuevo en cada curva.
   *
   * Con 90 el tope se alcanza en ~0.15 s. Sigue habiendo rampa —no es un
   * teletransporte— pero deja de sentirse como un retardo.
   */
  LATERAL_ACCEL: 90,
  /**
   * ── Tope lateral PROPORCIONAL a la velocidad ──
   *
   * El tope fijo de 34 m/s hacía que esquivar fuera más difícil cuanto más rápido
   * volabas: el ratio "metros de costado por metro de avance" caía de 0.85 a 40
   * m/s a 0.52 a 65 m/s, así que el corredor se angostaba en tiempo útil.
   *
   * Con un RATIO constante, la maniobrabilidad es la misma a cualquier velocidad.
   */
  get LATERAL_RATIO() { return MODE.motion.lateralRatio ?? 0.85; },
  /** Piso del tope (m/s): a baja velocidad hace falta un mínimo para girar. */
  LATERAL_MAX_MIN: 20,
  /** Techo del tope (m/s): evita que a velocidades absurdas sea teletransporte. */
  LATERAL_MAX_MAX: 90,

  /** Velocidad lateral máxima (m/s) a la velocidad de referencia. Sólo informativo. */
  get LATERAL_MAX() { return MODE.id === 'frenetic' ? 34 : 19; },
  /**
   * Amortiguación lateral al soltar (1/s).
   *
   * Subió de 2.2 a 4.5: con la amortiguación vieja el avión seguía derivando casi
   * un segundo después de centrar el mando, y eso también se lee como falta de
   * respuesta. Ahora suelta en ~0.25 s y conserva algo de inercia.
   */
  LATERAL_DAMP: 4.5,
  /** Aceleración vertical al subir el morro (m/s²). */
  get NOSE_UP_ACCEL() { return MODE.id === 'frenetic' ? 17 : 7.5; },
  /** Aceleración vertical al bajar el morro (m/s²). */
  get NOSE_DOWN_ACCEL() { return MODE.id === 'frenetic' ? 15 : 9; },
  /**
   * Tope de ascenso por control (m/s).
   *
   * Sin tope, mantener W convertiría el avión en un cohete y el juego dejaría de
   * ser sobre volar. Con tope, W sirve para alcanzar algo que quedó alto y
   * después hay que seguir.
   */
  get NOSE_UP_MAX_VY() { return MODE.id === 'frenetic' ? 13 : 7; },
  /** Multiplicador global de los mandos, por modo. */
  get SCALE() { return MODE.motion.controlScale; },

  /**
   * ── Tope SUAVE de la autoridad de los mandos ──
   *
   * Hasta `CONTROL_KNEE` la respuesta es lineal: cada mejora se nota tal cual.
   * Por encima, la curva se aplana y tiende a `CONTROL_MAX` sin llegar nunca.
   *
   * ── Por qué hace falta ──
   * La autoridad se multiplicaba sin techo (nave × modo × mejoras). Con todo al
   * máximo la respuesta se volvía vertiginosa: el avión cambiaba de dirección tan
   * rápido que no se podía dosificar, y pasaba de esquivable a ingobernable.
   *
   * El tope SUAVE en vez de un `Math.min` es a propósito: con un clamp duro,
   * seguir mejorando dejaría de notarse de golpe y la mejora se sentiría "rota".
   */
  CONTROL_KNEE: 2.8,
  /** Asíntota de la autoridad: nunca se llega, pero no se pasa. */
  CONTROL_MAX: 3.8,
  /**
   * Autoridad mínima del morro con el planeo agotado (0..1).
   *
   * No es 0 para que el control no quede muerto de golpe en los últimos
   * segundos: el jugador tiene que sentir que pierde fuerza, no que se rompió.
   */
  CLIMB_MIN_AUTHORITY: 0.12,
  /** Planeo (s) a partir del cual el morro tiene autoridad plena. */
  CLIMB_FULL_AUTHORITY: 2.0,
  /**
   * Cuánto más caro es SUBIR que planear, en planeo por segundo.
   *
   * Con 1.2, forzar al avión a subir consume ~2.2x lo que consume un planeo
   * normal. Es lo que impide que bombear W sea una forma de volar gratis.
   */
  CLIMB_COST: 1.2,
  /** Cuánto gira visualmente el avión con el control lateral (rad). */
  BANK_RATE: 1.8,
  /** Inclinación máxima al girar (rad). */
  BANK_MAX: 0.72,
};

/** Posición del avión sobre la resortera (también es el origen de la física). */
export const LAUNCH_POS = { x: 0, y: 3.0, z: 0 };

/**
 * Origen del sistema de coordenadas de la FÍSICA.
 * Es siempre LAUNCH_POS: el modelo puede desplazarse visualmente mientras se
 * carga la banda, pero el vuelo arranca desde este punto fijo. La línea
 * punteada se calcula desde acá, por eso coincide con el lanzamiento real.
 */
export const PHYSICS_ORIGIN = { x: LAUNCH_POS.x, y: LAUNCH_POS.y, z: LAUNCH_POS.z };

// ── Constantes físicas reales ───────────────────────────────
export const GRAVITY = -9.8;
export const AIR_DENSITY = 1.225;

// ── Esquema de puntería (resortera) ─────────────────────────
/**
 * Esquema de control, pensado para responder a lo que el jugador espera ver
 * en pantalla:
 *
 *   · IZQUIERDA / DERECHA → la dirección del avión.
 *   · ARRIBA / ABAJO      → la altura de salida.
 *   · CUÁNTO SE TIRA      → la potencia.
 *
 * La clave es cómo se reparten los tres controles sobre un único vector de
 * arrastre, sin que se pisen entre sí:
 *
 *   - La DIRECCIÓN sale SOLO de la componente horizontal de pantalla.
 *   - La ALTURA sale de la componente vertical, más un extra por estiramiento.
 *   - La POTENCIA es la magnitud del estiramiento.
 *
 * Se usan los ejes de la PANTALLA y no los del mundo: en pantalla "derecha" y
 * "arriba" son perpendiculares por construcción, así que la descomposición es
 * exacta y los controles quedan desacoplados. Proyectar sobre la base de la
 * cámara (que mira el corredor en diagonal) acoplaba los ejes: arrastrar
 * hacia atrás movía también la dirección.
 */
export const AIM = {
  /** Px de estiramiento para alcanzar el 100% de potencia. */
  POWER_RANGE_PX: 220,
  /**
   * Px de arrastre vertical que corresponde a la elevación completa del morro.
   * Más grande = el control de ángulo es menos sensible.
   */
  ELEVATION_RANGE_PX: 175,
  /**
   * Grados de pitch que restan llevar el arrastre vertical al máximo.
   *
   * El signo vive en `aiming.js`: arrastrar ARRIBA aplana la salida. Acá sólo
   * se guarda cuánto cambia, no en qué dirección.
   */
  get PITCH_ELEVATION_SPAN() { return 22 * MODE.aim.pitchSensitivity; },
  /*
   * ── Límites de ángulo: los pone el MODO ──
   *
   * El clásico apunta alto (18°..52°) y vuela en arco. El frenético tiene un
   * rango angosto y bajo (8°..34°) porque su lanzamiento es de DIRECCIÓN: si se
   * pudiera apuntar alto, el avión pasaría por encima de los aros y de los
   * recolectables en vez de atravesarlos.
   */
  get PITCH_MIN() { return MODE.aim.pitchMin; },
  get PITCH_MAX() { return MODE.aim.pitchMax; },
  /**
   * Pitch base: el que se obtiene con un arrastre vertical neutro.
   *
   * Es el punto medio del rango del modo, y el juego lo corre por tramo con
   * `setPitchBias`. En el clásico los tramos rasantes piden apuntar más bajo;
   * en el frenético el rango ya es bajo de por sí.
   */
  get PITCH_DEFAULT() { return (MODE.aim.pitchMin + MODE.aim.pitchMax) / 2; },
  /**
   * Cuánto se corre el centro del control de ángulo (grados).
   *
   * Positivo = el neutro apunta más arriba. Lo fija el perfil de vuelo en cada
   * tramo para que "no arrastrar nada" apunte a la línea correcta.
   */
  PITCH_BIAS: 0,
  /** Tope absoluto de altura del modo (m). El avión no debe superarlo. */
  get CEILING() { return MODE.aim.ceiling; },
  /**
   * Px de desplazamiento HORIZONTAL que satura la dirección.
   * Más grande = el abanico de dirección es menos sensible.
   */
  AZIMUTH_REFERENCE_PX: 150,
  /** Zona muerta: por debajo de esto no se lanza. */
  DEADZONE_PX: 12,
  /**
   * Ángulo (grados) de desviación lateral del gesto que corresponde a la
   * dirección máxima. Se conserva por si en el futuro se vuelve a un mapeo
   * por ángulo en vez de por píxeles.
   */
  AZIMUTH_FULL_ANGLE_DEG: 55,

  /** Rango de azimut (grados). */
  AZIMUTH_MIN: -35,
  AZIMUTH_MAX: 35,

  /** Potencia mínima para que al soltar cuente como lanzamiento (%). */
  MIN_POWER_TO_LAUNCH: 5,

  /** Cuánto se estira el avión hacia atrás en el mundo (m). */
  MAX_PULL_VISUAL: 1.9,
  /**
   * Cuánto baja el avión al cargar la banda (m).
   *
   * El modelo nunca sube por encima de LAUNCH_POS: el origen de la física es
   * fijo, así que elevarlo provocaría un salto al soltar. La altura de salida
   * se comunica con la inclinación del morro, que además coincide con el
   * primer tramo de la línea punteada.
   */
  MAX_PULL_DROP: 0.55,
};

// ── Previsualización de trayectoria ─────────────────────────
export const TRAJECTORY = {
  /**
   * Puntos máximos de la línea punteada.
   *
   * Un lanzamiento empinado vuela 8-10 s. Con 150 puntos, el paso de muestreo
   * debe ser de ~1/16 s para cubrir el arco COMPLETO. Antes era 1/30 s, y con
   * eso la previsión se cortaba a media altura: el punto de impacto quedaba
   * sin calcular y el panel mostraba "0 m" de alcance en los tiros altos.
   */
  MAX_POINTS: 150,
  /** Paso temporal de muestreo (s). Más grande = puntos más separados. */
  SAMPLE_DT: 1 / 16,
  /**
   * Presupuesto de tiempo SIMULADO para la previsualización (s).
   *
   * No confundir con `MAX_POINTS`: los puntos que se DIBUJAN y los pasos que se
   * SIMULAN son cosas distintas, y atarlas fue un error.
   *
   * La simulación corre hasta que el avión toca el suelo, y de todos esos pasos
   * se conserva uno de cada `stride` para no pasar de `MAX_POINTS` puntos. Antes
   * el bucle estaba limitado por `MAX_POINTS + 8` pasos, o sea ~10 s de vuelo:
   * con el planeo, un lanzamiento alto tarda más en bajar, el bucle terminaba
   * antes de tocar el suelo y el punto de impacto quedaba sin calcular. Se veía
   * como "0 m" de alcance en los tiros altos.
   *
   * 60 s es un techo de seguridad, no un valor esperado: ningún lanzamiento
   * razonable se acerca.
   */
  MAX_SIM_TIME: 60,
  /** Longitud del guion/espacio de la línea punteada (m). */
  DASH_SIZE: 1.5,
  GAP_SIZE: 1.5,
  /** Color blanco translúcido pedido para la línea. */
  COLOR: 0xffffff,
  OPACITY: 0.55,
  /** Radio del anillo marcador del punto de impacto (m). */
  MARKER_RADIUS: 1.2,

  /*
   * ── Cómo se muestra la dirección: lo decide el MODO ──
   *
   *   'dashed' → línea punteada desde el lanzador (clásico)
   *   'arrows' → flechas detrás de la nave (frenético)
   *
   * La diferencia no es estética. La línea dice "por acá VAS A PASAR" y se lee
   * antes de salir; las flechas dicen "por acá VAS AHORA" y se leen volando. Un
   * modo de reacción necesita lo segundo.
   */
  get STYLE() { return MODE.trajectoryLine; },

  /*
   * ── Flechas de la PREVISIÓN ──
   *
   * La previsión se dibuja como una línea punteada con flechas encima. Se pidió
   * expresamente que no fueran guiones sino flechas, para que el trazo indique
   * el SENTIDO y no sólo la forma del arco.
   *
   * La línea de guiones se conserva debajo: da la continuidad del trazo. Con
   * flechas solas el arco se lee como puntos sueltos y no como una trayectoria.
   */
  CHEVRON: {
    /** Cuántas flechas como máximo. Acotan el coste en un solo dibujo. */
    COUNT: 26,
    /** Separación entre flechas, medida sobre el ARCO recorrido (m). */
    SPACING: 6.5,
    /** A qué distancia del lanzador va la primera (m). */
    FIRST_AT: 5,
    /** Tamaño base de cada flecha (m). */
    SIZE: 1.15,
    /** Cuánto crecen con la distancia. Sin esto los lejanos no se ven. */
    GROW: 1.6,
    /** Gris claro translúcido, como se pidió. */
    COLOR: 0xdfe6f2,
    OPACITY: 0.85,
  },

  // ── Flechas de dirección (modo frenético) ──
  ARROWS: {
    /** Cuántas flechas forman la estela. */
    COUNT: 9,
    /** Separación entre flechas (m). */
    SPACING: 2.6,
    /** Tamaño de cada flecha (m). */
    SIZE: 0.7,
    /** Radio del tubo que forma la flecha (m). */
    THICKNESS: 0.11,
    /** Color gris translúcido, como se pidió. */
    COLOR: 0x9aa4b2,
    OPACITY: 0.4,
    /**
     * Animación de aceleración: cuánto se estira la flecha al acelerar, en
     * fracción de su tamaño. Es lo que hace que la propulsión se SIENTA en la
     * estela y no sólo en el marcador de velocidad.
     */
    STRETCH: 1.5,
    /** Cada cuánto sale una flecha nueva (s). */
    EMIT_INTERVAL: 0.045,
    /** Cuánto vive una flecha antes de apagarse (s). */
    LIFETIME: 1.1,
  },
};

// ── Cámara ──────────────────────────────────────────────────
export const CAMERA = {
  FOV: 65,
  NEAR: 0.1,
  FAR: 3000,

  /**
   * Vista STANDBY: tres cuartos sobre la resortera, mirando en diagonal.
   * Es la que se ve al llegar, con el título, la tienda y las instrucciones.
   */
  STANDBY_POS: { x: -10.5, y: 5.0, z: 7.0 },
  STANDBY_TARGET: { x: 1.0, y: 3.2, z: 0 },

  /**
   * Vista LAUNCH: detrás del lanzador, mirando recto hacia el corredor.
   *
   * Está deliberadamente ALTA (por encima del plano de tiro) para que la línea
   * punteada se proyecte hacia adelante y se lea completa desde atrás. Si la
   * cámara quedara a la altura del avión, la trayectoria se vería de canto.
   */
  /*
   * ── Cámara de apuntado ──
   *
   * Subió de y=6.6 a y=11.5 y se alejó.
   *
   * Con la altura vieja el horizonte quedaba alto y los obstáculos se recortaban
   * contra el cielo: oscuros sobre oscuro, invisibles. Desde arriba el corredor
   * entra en cuadro contra el pasto y se puede planear la salida.
   */
  LAUNCH_POS: { x: -20, y: 11.5, z: 0 },
  /*
   * El objetivo de la vista de apuntado mira un poco MÁS ABAJO y más lejos.
   *
   * Con y=4.0 la cámara quedaba casi nivelada: el horizonte alto y el corredor
   * aplastado en una franja fina. Bajando el objetivo a 2.2 el corredor se abre y
   * los obstáculos se leen antes de lanzar.
   */
  /*
   * El objetivo vuelve a y=4.0.
   *
   * Se probó bajarlo a 2.2 para "abrir" el corredor en el apuntado, pero eso
   * aplana el tiro por defecto: medido, el vuelo de prueba caía a los 18.6 m en
   * vez de superar los 20. El corredor se abre mejor acortando la pista libre
   * (ver CLEAR_RUNWAY), que no toca la física.
   */
  LAUNCH_TARGET: { x: 42, y: 4.0, z: 0 },

  /**
   * Duración de la transición entre las dos vistas, en segundos.
   * Ida y vuelta usan el mismo valor.
   */
  TRANSITION_TIME: 0.8,

  /**
   * Vista de VUELO: tercera persona, sostenida detrás y por ENCIMA del avión.
   *
   * La altura es el punto importante. Con la cámara a la altura del avión (o
   * siguiendo el vector velocidad sin más) la perspectiva se caía cuando el
   * avión bajaba: se terminaba viendo el vuelo desde abajo. Sosteniéndola por
   * encima se mantiene la lectura de tercera persona durante todo el viaje,
   * tanto en el ascenso como en el planeo.
   *
   * `*_PER_SPEED` escala las dos cosas con la velocidad, para que a más
   * velocidad la cámara se aleje y el avión no llene la pantalla.
   */
  FOLLOW_DIST: 9.0,
  FOLLOW_HEIGHT: 3.4,
  FOLLOW_DIST_PER_SPEED: 0.10,
  FOLLOW_HEIGHT_PER_SPEED: 0.035,
  /**
   * Cuánto pesa la dirección de vuelo (y) contra el "arriba del mundo" (y=1)
   * al decidir dónde poner la cámara.
   *
   * 0 = siempre por encima del avión, sin importar adónde apunte.
   * 1 = siempre detrás del vector velocidad, que en picada deja la cámara
   *     abajo y se pierde la tercera persona.
   *
   * Se deja mayormente en el mundo para que la cámara no se hunda, con algo de
   * la dirección de vuelo para que acompañe el movimiento.
   */
  FOLLOW_VERTICAL_BLEND: 0.28,
  /**
   * Cuántos metros por encima del avión se mantiene la cámara como mínimo.
   *
   * Sin este piso, en un ascenso fuerte la cámara (que se apoya en la dirección
   * de vuelo) queda por debajo del avión y el vuelo se ve desde abajo.
   */
  FOLLOW_MIN_ABOVE: 2.2,
  /** Suavizado de la cámara durante el vuelo (1/s). */
  FOLLOW_LERP: 4.5,
  TARGET_LERP: 5.0,
  /** Inclinación lateral de la cámara al girar (rad por unidad de giro). */
  FOLLOW_ROLL: 0.55,
  /** Tope de esa inclinación (rad). */
  FOLLOW_ROLL_MAX: 0.26,

  /** Factor de viento lateral que se refleja en el alabeo visual del avión. */
  WIND_ROLL: 0.05,
};

// ── Obstáculos ──────────────────────────────────────────────
export const OBSTACLES = {
  /** Semilla del generador determinista: el corredor es igual en cada partida. */
  SEED: 20240517,
  /** Los primeros metros quedan libres para que el jugador aprenda a apuntar. */
  /*
   * ── Pista libre inicial (m) ──
   *
   * Bajó de 45 a 34. Con 45 m vacíos, más la separación del primer obstáculo, la
   * vista de apuntado mostraba una franja de pasto enorme y los objetos quedaban
   * aplastados contra el horizonte: parecía que no había nada.
   *
   * Además acorta la distancia al primer booster, que era lo que hacía costoso
   * arrancar.
   *
   * ── Por qué no más corto ──
   * Con 22 el primer obstáculo podía quedar centrado en 22 m, y su caja se
   * extiende varios metros hacia ATRÁS: medido, el vuelo de prueba chocaba a los
   * 18.6 m sin haber llegado a la pista. 34 deja margen para que el avión tome
   * velocidad y el obstáculo más cercano siga estando delante.
   */
  CLEAR_RUNWAY: 34,
  /** Separación mínima entre obstáculos (m). */
  MIN_SPACING: 22,
  /** Separación máxima entre obstáculos (m). */
  MAX_SPACING: 40,
  /** Colisión contra el terreno (además de la altura 0). */
  TERRAIN_COLLISION: true,

  /*
   * ── Herramientas del entorno: las pone el MODO ──
   *
   * El pedido es que los escenarios avanzados sean realmente desafiantes pero
   * con buena cantidad de recursos para sortearlos. Estos tres son esos
   * recursos: vegetación para leer el terreno, barreras con huecos para
   * atravesar, y aros como recompensa por volar bien.
   */
  /** Árboles por tramo. */
  get TREES_PER_STAGE() { return MODE.terrain.trees; },
  /**
   * Rocas por tramo: aglomeraciones de piedra.
   *
   * ── Por qué rocas y no barreras ──
   * La primera versión del modo frenético usaba BARRERAS: muros con huecos que
   * había que atravesar. Se pidió sacarlas —"no quiero barreras horizontales que
   * sean bloques"— porque un muro artificial en medio de un paisaje natural
   * ensucia la escena y rompe la lectura de que los obstáculos SON el entorno.
   *
   * Una aglomeración de rocas cumple la misma función —bloquea un tramo del
   * corredor y obliga a elegir por dónde pasar— pero es parte del paisaje.
   */
  get ROCKS_PER_STAGE() { return MODE.terrain.rocks; },
  /** Troncos caídos por tramo: el obstáculo alargado, natural en un bosque. */
  get LOGS_PER_STAGE() { return MODE.terrain.logs; },
  /** Aros de recompensa por tramo. */
  get RINGS_PER_STAGE() { return MODE.terrain.rings; },
  /** Cuántos huecos tiene cada barrera: son los caminos posibles. */
  get BARRIER_GAPS() { return MODE.id === 'frenetic' ? 3 : 2; },
  /** Ancho de cada hueco de barrera (m). */
  BARRIER_GAP_WIDTH: 13,
  /** Grosor de la barrera (m). */
  BARRIER_DEPTH: 3.2,
};

// ── Recolectables ───────────────────────────────────────────
/**
 * Monedas y boosters repartidos por el corredor.
 *
 * Idea de diseño: el tiro rasante llega más lejos, pero el avión pierde energía
 * y baja. Los BOOSTERS son los que sostienen el vuelo, así que la distancia
 * total la decide cuántos juntás esquivando obstáculos, no el ángulo de salida.
 * Sin boosters el vuelo se termina solo.
 */
export const PICKUPS = {
  /**
   * Semilla base del reparto.
   *
   * En cada partida se le suma un número distinto para que los CAMINOS cambien:
   * el mapa es fijo, pero la ruta que conviene volar no. Ver
   * `world/collectibles.js`.
   */
  SEED: 90210,
  /** Altura de respaldo si nadie inyecta el perfil de vuelo (m). */
  FALLBACK_ALTITUDE: 15,
  /**
   * Radio de recolección (m).
   *
   * Generoso a propósito. Medido, el avión pasa a 3-6 m de los recolectables
   * cuando va bien encaminado: con un radio chico la recolección dependía de
   * centésimas de trayectoria y se sentía injusta. La habilidad tiene que estar
   * en ELEGIR la línea de vuelo, no en acertar al centímetro.
   */
  /**
   * Radio de recolección (m).
   *
   * Bajó de 5.5 a 4.5 al reducir las hitboxes en general: con 5.5 se recogía
   * pasando bastante lejos del objeto, y la sensación era la contraria a la que
   * se busca ahora, que es poder volar fino cerca de las cosas.
   */
  RADIUS: 4.5,
  /** Altura mínima sobre el suelo para cualquier recolectable (m). */
  MIN_CLEARANCE: 2.5,

  /*
   * ── Qué hay y cuánto: lo decide el MODO ──
   *
   * El clásico usa el violeta (se activa con Space) y el azul instantáneo. El
   * frenético suma el de EMERGENCIA, que sólo aparece cuando queda poco
   * combustible: es la red que evita que un vuelo bueno termine por un descuido.
   */
  /** Tipos de recolectable habilitados. */
  get KINDS() { return MODE.items.kinds; },
  /** Carriles por tramo: cuántos caminos distintos hay para elegir. */
  get LANES() { return MODE.items.lanes; },
  /** Boosters de emergencia por vuelo. */
  get EMERGENCY() { return MODE.items.emergency; },
  /**
   * Ángulo del tiro que define la "línea nominal" de vuelo (grados).
   *
   * Es la referencia sobre la que se colocan todos los recolectables. Ver
   * `world/collectibles.js`: anclar las alturas al SUELO no funciona, porque el
   * avión vuela a alturas absolutas y el terreno del corredor va subiendo.
   */
  NOMINAL_PITCH: 18,

  COINS: {
    /*
     * Mezcla de valores. `share` es el peso relativo y `arc` la forma en que se
     * reparte el grupo por el corredor:
     *   'row'  → hilera recta, fácil de embocar
     *   'zig'  → en zigzag, obliga a corregir la dirección
     *   'high' → más arriba que la línea de vuelo, hay que arquea el tiro
     *
     * `rise` son metros POR ENCIMA de la trayectoria nominal (ver
     * NOMINAL_PITCH), no sobre el suelo. Anclar las alturas al suelo no
     * funciona: el avión vuela a alturas absolutas y el terreno del corredor
     * sube, así que un valor fijo dejaba los recolectables inalcanzables.
     */
    MIX: [
      { value: 5, share: 0.50, arc: 'row', rise: 0 },
      { value: 10, share: 0.32, arc: 'zig', rise: 1.5 },
      { value: 50, share: 0.18, arc: 'high', rise: 2.5 },
    ],
    /** Monedas por grupo. */
    CLUSTER_MIN: 3,
    CLUSTER_MAX: 6,
    /** Separación entre monedas del mismo grupo (m). */
    SPACING: 4.5,
    /** Separación entre grupos (m). */
    GROUP_GAP_MIN: 30,
    GROUP_GAP_MAX: 56,
    /** Cuánto sube cada moneda siguiente en un grupo 'high' (m). */
    HIGH_RISE: 2.0,
    /**
     * Cuánto serpentea un grupo 'zig' (m).
     *
     * Moderado a propósito: con el corredor de 140 m de ancho un zigzag amplio
     * haría imposible juntar el grupo entero, y la idea es que cueste, no que
     * sea una lotería.
     */
    ZIG_AMPLITUDE: 3,
  },

  /**
   * ══════════════════════════════════════════════════════════
   * DOS CIRCUITOS POR TRAMO
   * ══════════════════════════════════════════════════════════
   *
   * ── La idea ──
   * Cada tramo elige UNO de dos perfiles de vuelo, y los aros, las monedas y los
   * boosters se alinean a esa elección. Sin esta alineación, un aro puede quedar
   * a una altura a la que el jugador no llega desde su línea de vuelo.
   *
   *   'alto'    → aros a 15-30 m del suelo, espaciados, pocos boosters.
   *               Se juega planeando: elegir el momento de picar y remontar.
   *   'rasante' → aros a 5-12 m, en seguidilla, muchas monedas en fila.
   *               Se juega con velocidad y reflejos, cerca del piso.
   */
  /**
   * ══════════════════════════════════════════════════════════
   * VENDAVAL (corriente ascendente)
   * ══════════════════════════════════════════════════════════
   *
   * ── El problema que resuelve ──
   * En el circuito rasante los aros están a 5-12 m del suelo. Para pasarlos hay
   * que picar, y después NO queda aceleración para volver a subir: el jugador
   * quedaba atrapado abajo hasta estrellarse.
   *
   * Se pidió una mecánica que lo levante 10-15 m sin regalarle el empuje del
   * booster celeste, para que pueda seguir jugando y enganchar algo en la subida.
   *
   * Sube y da un empujón CHICO (5% de la velocidad de lanzamiento, contra el 16%
   * del celeste): sirve para remontar, no para ganar la partida.
   */
  UPDRAFT: {
    /** Aceleración vertical que aplica mientras se está dentro (m/s²). */
    LIFT: 30,
    /** Tope de velocidad vertical ganada (m/s): evita salir disparado al cielo. */
    LIFT_MAX: 15,
    /** Empujón horizontal, fracción de la velocidad de lanzamiento. */
    SPEED_BONUS: 0.05,
    /** Radio de la columna (m). */
    RADIUS: 7,
    /** Alto de la columna (m): se extiende hasta bien arriba del corredor. */
    HEIGHT: 40,
    /** Separación entre columnas dentro de un tramo rasante (m). */
    SPACING: 100,
  },

  CIRCUITOS: {
    alto: {
      ringMin: 15, ringMax: 30,
      /** Probabilidad de que un obstáculo del tramo sea un aro. */
      ringChance: 0.16,
      /** Corrimiento de los caminos de monedas respecto de la línea nominal. */
      liftBase: 5,
      /** Separa los boosters: en el circuito alto se cuentan. */
      boostSpacing: 110,
    },
    rasante: {
      ringMin: 5, ringMax: 12,
      ringChance: 0.32,
      liftBase: -2,
      boostSpacing: 70,
    },
  },

  BOOSTERS: {
    /**
     * Cada cuántos metros aparece uno. La regularidad es a propósito: el jugador
     * tiene que poder planear el vuelo contando con ellos.
     */
    SPACING: 85,
    /** El primero, más cerca, para que la mecánica se entienda enseguida. */
    FIRST_AT: 55,
    /**
     * Cuántos metros dentro del tramo aparece el primer booster.
     *
     * Los tramos son de 500 m y los boosters cada 85: sin este desfase, el
     * primero de cada tramo caería a la misma distancia relativa y el corredor
     * se sentiría repetitivo.
     */
    OFFSET_IN_SEGMENT: 30,
    /** Separación mínima con un obstáculo (m), para que no sea un regalo. */
    /**
   * Aire libre que necesita un booster alrededor (m).
   *
   * Bajó de 13 a 7: con las hitboxes achicadas y el corredor más poblado, 13 m de
   * exclusión dejaban casi todos los intentos sin hueco. Medido, la ventana
   * generaba 4 boosters en vez de los ~35 que corresponden por espaciado.
   */
  CLEAR_OF_OBSTACLE: 7,
    /**
     * Altura total de la columna de cada booster (m).
     *
     * El booster no es un punto: es una columna vertical centrada en la línea
     * nominal. Hace falta porque cada ángulo de salida vuela a su propia altura,
     * y entre 20° y 24° hay unos 9 m de diferencia a media distancia. Con una
     * columna se atraviesa desde cualquier altura razonable.
     *
     * Debe ser al menos la separación vertical entre dos ángulos vecinos
     * utilizables, o quedan ángulos "muertos" que no recogen nada.
     *
     * ── Por qué bajó de 12 a 8 ──
     * Se pidió reducir la hitbox de los boosters. La columna sigue siendo generosa
     * —se recogen pasando a cualquier altura DENTRO de ella— pero 12 m absorbían
     * un cuarto de tramo: se "chupaba" el booster volando bastante por encima o
     * por debajo, y eso impide volar fino.
     */
    SPAN: 8.0,
    /** Radio de la esfera visual (m). */
    VISUAL_RADIUS: 1.15,

    /**
     * Cuánto acelera un booster, como fracción de la VELOCIDAD DE LANZAMIENTO
     * INICIAL.
     *
     * Es lo pedido: un 50% de la potencia con la que salió el avión, no un valor
     * fijo. Así el booster sigue siendo relevante después de comprar mejoras.
     */
    /**
     * Empuje del booster CELESTE, como fracción de la velocidad de lanzamiento.
     *
     * ── Por qué bajó de 0.5 a 0.16 ──
     * Antes el celeste era el que daba el empuje grande. Ahora ese papel pasó a
     * los AROS: cinco aros dan el empujón de verdad. El celeste queda como una
     * ayuda chica, para estirar un poco el vuelo, no para resolverlo.
     */
    SPEED_FRACTION: 0.16,

    /**
     * ── Aros: el nuevo premio grande ──
     *
     * Cada `RING_COMBO` aros seguidos dan un empuje considerable. Es más que el
     * viejo booster (0.5) a propósito: los aros pasan a ser el objetivo del vuelo,
     * y el jugador tiene que seguirlos en vez de ir juntando boosters sueltos.
     *
     * `SPEED_FRACTION` se aplica sobre la velocidad de lanzamiento, y
     * `BURN_TIME` sobre el empuje sostenido de la propulsión.
     */
    RING_COMBO: {
      /** Cuántos aros hacen falta. */
      EVERY: 4,
      /** Empuje por combo, como fracción de la velocidad de lanzamiento. */
      SPEED_FRACTION: 0.65,
      /** Tope de velocidad después del combo (m/s). */
      MAX_SPEED: 72,
      /** Duración del empuje sostenido (s). */
      BURN_TIME: 1.1,
      /** Combustible de planeo que regala. */
      GLIDE_BONUS: 1.6,
    },
    /** Tope de velocidad tras el impulso (m/s), para no salirse del corredor. */
    MAX_SPEED: 64,
    /** Duración del empuje sostenido tras recogerlo (s). */
    BURN_TIME: 1.5,

    /**
     * Cuánto suma cada booster al PRESUPUESTO DE PLANEO (s), acumulable.
     *
     * Es el recurso que se agota, y la pieza que hace que juntar boosters sea la
     * forma de llegar lejos: el avión arranca con `BASE_GLIDE` segundos de
     * planeo, cada booster agrega más, y cuando se termina el avión baja y se
     * cae. Por eso la distancia depende de recolectar y no de apuntar alto.
     */
    GLIDE_BONUS: 1.4,
    /**
     * Presupuesto de planeo inicial (s). Deliberadamente corto: sin juntar
     * boosters el vuelo se termina solo, que es lo que hace que la mecánica
     * importe.
     */
    BASE_GLIDE: 4.0,
    /** Tope del presupuesto acumulado (s): nunca hay planeo infinito. */
    GLIDE_BONUS_MAX: 12.0,
  },
};

// ── Estela de vuelo ─────────────────────────────────────────
export const TRAIL = {
  MAX_POINTS: 160,
  COLOR: 0x00e5ff,
  OPACITY: 0.42,
  /** Cada cuántos metros se agrega un punto (evita densidades absurdas). */
  MIN_SEGMENT: 0.55,
};

// ── Progresión / economía ───────────────────────────────────
export const ECONOMY = {
  /**
   * Recompensa por desempeño del vuelo:
   * monedas = distancia*D + altitud*A + velocidad*S + tiempo*T (mínimo 1).
   *
   * Aparte y ENTERAS se suman las monedas RECOGIDAS en el corredor (ver
   * PICKUPS.COINS): son el premio por arriesgar una línea de vuelo para
   * juntarlas, así que no se promedian con la fórmula.
   */
  COIN_PER_METER: 0.30,
  COIN_PER_ALTITUDE: 0.50,
  COIN_PER_SPEED: 0.80,
  COIN_PER_SECOND: 0.50,
  /** Monedas extra por cada aro atravesado. */
  COIN_PER_RING: 12,
  /** Retardo antes de mostrar la pantalla de resultados (deja ver el impacto). */
  RESULT_DELAY_MS: 1600,
};

// ── Persistencia ────────────────────────────────────────────
export const SAVE = {
  KEY: 'papercrash.save',
  VERSION: 1,
  /** Guardado automático tras cada vuelo y compra. */
  AUTOSAVE: true,
};

// ── Audio ───────────────────────────────────────────────────
export const AUDIO = {
  MASTER_VOLUME: 0.35,
  DEFAULT_MUTED: false,
};
