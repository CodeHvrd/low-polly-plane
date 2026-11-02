/**
 * PAPERCRASH — core/music.js
 * ============================================================
 * Banda sonora PROCEDURAL.
 *
 * ── Por qué procedural y no un archivo de audio ──
 * La música tiene que cambiar con la velocidad: empezar tranquila y volverse más
 * rápida, más espacial y más oscura a medida que el avión acelera. Un MP3 no puede
 * hacer eso; una secuencia generada y sintetizada en tiempo real, sí.
 *
 * Además no hay licencias de por medio y no pesa nada en la descarga.
 *
 * ── Las tres pistas ──
 * Son tres "climas" que se pueden repetir sin fin:
 *   1. AMANECER  — Re menor, pentatónica. Tranquila, cálida.
 *   2. TRAVESÍA  — Do dórico. Media, con más movimiento.
 *   3. ABISMO    — Fa# frigio. Oscura, tensa, para alta velocidad.
 *
 * ── Cómo se arma cada compás ──
 * Un planificador mira hacia adelante ~120 ms y va encolando notas exactas en el
 * reloj de audio. Así el ritmo no depende de los FPS: aunque el juego tenga un
 * tirón, la música sigue a tempo.
 *
 * ── Cómo responde a la velocidad ──
 * `setIntensidad(0..1)` mueve tres cosas a la vez:
 *   · tempo   — de 68 a 148 BPM según la pista
 *   · filtro  — el corte del pasa-bajos baja: el sonido se vuelve MÁS OSCURO
 *   · espacio — la mezcla de reverberación sube: más "espacialidad"
 *
 * ── Los aros suenan ──
 * `ringPing()` hace sonar una nota de bajo. Está preparado para que cada aro
 * atravesado sume una nota: la idea a futuro es que el bajista sea el circuito.
 * ============================================================
 */

/** Tipos de escala por semitonos desde la raíz. */
const ESCALAS = {
  pentatonicaMenor: [0, 3, 5, 7, 10],
  dorico: [0, 2, 3, 5, 7, 9, 10],
  frigio: [0, 1, 3, 5, 7, 8, 10],
};

/**
 * Las tres pistas.
 *
 * `progresion` son los grados de la escala que toca el bajo en cada compás; es lo
 * que le da identidad armónica a cada clima.
 */
export const PISTAS = [
  {
    id: 'amanecer',
    nombre: 'Amanecer',
    raiz: 57, // A3
    escala: ESCALAS.pentatonicaMenor,
    progresion: [0, 0, 3, 4],
    bpmMin: 124,
    bpmMax: 146,
    /** Onda del pad: seno = cálido, diente de sierra = brillante. */
    padOnda: 'sine',
    padCorte: 1500,
    arpOnda: 'triangle',
    bajoOnda: 'sine',
  },
  {
    id: 'travesia',
    nombre: 'Travesía',
    raiz: 60, // C4
    escala: ESCALAS.dorico,
    progresion: [0, 3, 4, 2],
    bpmMin: 130,
    bpmMax: 152,
    padOnda: 'triangle',
    padCorte: 1200,
    arpOnda: 'sawtooth',
    bajoOnda: 'triangle',
  },
  {
    id: 'abismo',
    nombre: 'Abismo',
    raiz: 54, // F#3
    escala: ESCALAS.frigio,
    progresion: [0, 1, 0, 4],
    bpmMin: 136,
    bpmMax: 158,
    padOnda: 'sawtooth',
    padCorte: 950,
    arpOnda: 'square',
    bajoOnda: 'sawtooth',
  },
];

/** Frecuencia de una nota MIDI. */
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/**
 * Motor de música.
 *
 * Se instancia una sola vez. `start()` y `stop()` lo activan y desactivan; el resto
 * del juego sólo llama a `setIntensidad()`.
 */
export class MusicEngine {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    /** @type {object|null} */
    this.pista = null;
    this.activo = false;
    this.mudo = false;
    /** 0 = tranquilo, 1 = a fondo. */
    this.intensidad = 0;
    /** BPM actual, suavizado para que no salte de golpe. */
    this.bpm = 68;
    /** Próximo instante (s) en el que hay que encolar el siguiente paso. */
    this.siguientePaso = 0;
    /** Índice de paso dentro del compás (0..15). */
    this.paso = 0;
    /** Nodo de salida de la música. */
    this.salida = null;
    this.filtro = null;
    this.reverb = null;
    this.seco = null;
    this.humedo = null;
    this.timer = null;
  }

  /** ¿Está sonando? */
  get sonando() {
    return this.activo;
  }

  /**
   * Arranca una pista.
   *
   * @param {number} indice 0..2
   */
  start(indice = 0) {
    if (this.activo) return;
    if (!this.asegurarContexto()) return;

    this.pista = PISTAS[Math.max(0, Math.min(PISTAS.length - 1, indice))];
    this._construirCadena();
    this.activo = true;
    this.paso = 0;
    this.bpm = this.pista.bpmMin;
    this.intensidad = 0;
    this.siguientePaso = this.ctx.currentTime + 0.1;
    this._arrancarPlanificador();
  }

  /**
   * Arma el grafo de audio: filtro → seco + reverberación → compresor → salida.
   *
   * El compresor evita que al sumarse todas las capas el volumen se dispare.
   */
  _construirCadena() {
    const ctx = this.ctx;

    // Compresor final: pegamento y protección de volumen.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);

    // Filtro general: al bajarlo la música se vuelve más oscura.
    this.filtro = ctx.createBiquadFilter();
    this.filtro.type = 'lowpass';
    this.filtro.frequency.value = this.pista.padCorte;
    this.filtro.Q.value = 0.6;

    // Reverberación generada: ruido que decae, sin cargar ningún archivo.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulso(2.8, 2.4);

    // Reparto seco / húmedo: la parte "espacial" sube con la intensidad.
    this.seco = ctx.createGain();
    this.humedo = ctx.createGain();
    this.seco.gain.value = 0.85;
    this.humedo.gain.value = 0.15;

    this.salida = ctx.createGain();
    this.salida.gain.value = this.mudo ? 0 : 0.5;

    this.filtro.connect(this.seco);
    this.filtro.connect(this.reverb);
    this.reverb.connect(this.humedo);
    this.seco.connect(this.salida);
    this.humedo.connect(this.salida);
    this.salida.connect(comp);
  }

  /**
   * Genera una respuesta de impulso: ruido con caída exponencial.
   *
   * Es lo que da la sensación de "espacio". No hace falta un archivo: un buffer de
   * ruido que se apaga solo suena a sala grande.
   *
   * @param {number} segundos @param {number} caida
   */
  _impulso(segundos, caida) {
    const ctx = this.ctx;
    const largo = Math.floor(ctx.sampleRate * segundos);
    const buffer = ctx.createBuffer(2, largo, ctx.sampleRate);
    for (let canal = 0; canal < 2; canal++) {
      const datos = buffer.getChannelData(canal);
      for (let i = 0; i < largo; i++) {
        datos[i] = (Math.random() * 2 - 1) * (1 - i / largo) ** caida;
      }
    }
    return buffer;
  }

  /**
   * Cambia la pista SIN cortar el sonido.
   *
   * ── Por qué no se reinicia ──
   * Reiniciar cortaría la música cada 2500 m, justo lo contrario de un crescendo.
   * Acá sólo se cambia el material armónico: el planificador sigue encolando notas y
   * la siguiente ya pertenece al clima nuevo.
   *
   * @param {number} indice
   */
  setPista(indice) {
    if (!this.ctx) return;
    const nueva = PISTAS[Math.max(0, Math.min(PISTAS.length - 1, indice))];
    if (this.pista && this.pista.id === nueva.id) return;
    this.pista = nueva;
    /*
     * El BPM no se toca: ya lo gobierna la intensidad. Cambiar la base del filtro sí,
     * porque cada clima tiene su brillo propio.
     */
    const ahora = this.ctx.currentTime;
    const corte = nueva.padCorte * (1 - 0.55 * this.intensidad);
    this.filtro.frequency.setTargetAtTime(Math.max(220, corte), ahora, 0.6);
  }

  /**
   * Asegura que haya un contexto de audio vivo.
   *
   * ── El bug que esto arregla ──
   * El navegador crea el AudioContext en estado "suspendido" hasta que hay un gesto
   * del usuario. Si se llamaba a `start()` sin desbloquearlo, no sonaba nada hasta
   * el siguiente clic — se reportó como "la música empieza recién cuando pongo pausa".
   *
   * @returns {boolean} si quedó listo
   */
  asegurarContexto() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    if (!this.ctx) this.ctx = new AudioCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume?.();
    return true;
  }

  /**
   * Fija la intensidad y ajusta tempo, oscuridad y espacio.
   *
   * @param {number} v 0..1
   */
  setIntensidad(v) {
    const valor = Math.max(0, Math.min(1, v));
    this.intensidad = valor;
    if (!this.activo || !this.ctx) return;

    // El tempo se suaviza: un salto brusco sonaría a error de reproducción.
    const objetivo = this.pista.bpmMin + (this.pista.bpmMax - this.pista.bpmMin) * valor;
    this.bpm += (objetivo - this.bpm) * 0.08;

    /*
     * Con más velocidad el filtro se CIERRA (más oscuro) y la reverberación sube
     * (más espacio). Las dos cosas juntas dan la sensación de entrar en una caverna
     * a toda velocidad.
     */
    const ahora = this.ctx.currentTime;
    const corte = this.pista.padCorte * (1 - 0.55 * valor);
    this.filtro.frequency.setTargetAtTime(Math.max(220, corte), ahora, 0.4);
    this.humedo.gain.setTargetAtTime(0.12 + 0.42 * valor, ahora, 0.5);
    this.seco.gain.setTargetAtTime(0.88 - 0.3 * valor, ahora, 0.5);
  }

  /** Silencia o restaura la música. */
  setMudo(valor) {
    this.mudo = Boolean(valor);
    if (this.salida && this.ctx) {
      this.salida.gain.setTargetAtTime(this.mudo ? 0 : 0.5, this.ctx.currentTime, 0.15);
    }
  }

  /** Detiene la música con una caída corta. */
  stop() {
    if (!this.activo) return;
    this.activo = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.salida && this.ctx) {
      const ahora = this.ctx.currentTime;
      this.salida.gain.cancelScheduledValues(ahora);
      this.salida.gain.setTargetAtTime(0, ahora, 0.25);
    }
  }

  /**
   * Nota de bajo para los aros.
   *
   * La idea a futuro: el bajista del tema son los aros, y cada uno que atravesás
   * suma su nota. Suena corto y con poco volumen para no tapar la música.
   *
   * @param {number} nro  número de aro (define la altura)
   */
  ringPing(nro = 0) {
    if (!this.activo || !this.ctx || this.mudo) return;
    const pista = this.pista;
    const grados = pista.escala.length;
    const grado = (nro % grados + grados) % grados;
    const midi = pista.raiz - 24 + pista.escala[grado];
    this._nota(hz(midi), this.ctx.currentTime, 0.22, pista.bajoOnda, 0.16);
  }

  /* ── Planificador ─────────────────────────────────────── */

  _arrancarPlanificador() {
    // Cada 25 ms se encolan las notas de los próximos 120 ms.
    this.timer = setInterval(() => this._planificar(), 25);
  }

  _planificar() {
    if (!this.activo || !this.ctx) return;
    const horizonte = this.ctx.currentTime + 0.12;
    while (this.siguientePaso < horizonte) {
      this._tocarPaso(this.siguientePaso, this.paso);
      // Un paso es una semicorchea: 4 pasos por tiempo.
      const durPaso = 60 / this.bpm / 4;
      this.siguientePaso += durPaso;
      this.paso = (this.paso + 1) % 16;
    }
  }

  /**
   * Encola lo que suena en un paso.
   *
   * @param {number} cuando @param {number} paso 0..15
   */
  _tocarPaso(cuando, paso) {
    const p = this.pista;
    const i = this.intensidad;
    const compas = Math.floor(this.paso / 16);

    // ── PAD: acorde sostenido del compás ──
    if (paso === 0) {
      const grado = p.progresion[compas % p.progresion.length];
      const base = p.raiz + p.escala[grado % p.escala.length];
      for (const intervalo of [0, 7, 12]) {
        this._nota(hz(base + intervalo), cuando, 16 * (60 / this.bpm / 4) * 0.95, p.padOnda, 0.045);
      }
    }

    /*
     * ── BAJO RODANTE de psy trance ──
     *
     * Suena en las SEMICORCHEAS (los 16 pasos del compás), no en los tiempos. Ese
     * pulso continuo es la firma del género y además es lo que evita que haya
     * silencios: la música está viva desde el primer segundo, sin depender de la
     * velocidad.
     *
     * La velocidad sólo lo hace más presente, no lo enciende.
     */
    {
      const grado = p.progresion[compas % p.progresion.length];
      const nota = p.raiz - 24 + p.escala[grado % p.escala.length];
      // Acento en los tiempos (más fuerte) y nota más corta en los contratiempos.
      const enTiempo = paso % 4 === 0;
      this._nota(
        hz(nota + (enTiempo ? 0 : 12)),
        cuando,
        enTiempo ? 0.16 : 0.09,
        p.bajoOnda,
        (enTiempo ? 0.16 : 0.10) + 0.04 * i,
      );
    }

    // ── ARPEGIO: aparece con la velocidad ──
    if (paso % 2 === 0) {
      const orden = [0, 2, 4, 3, 1, 3, 5, 4];
      const grado = orden[(paso / 2) % orden.length] % p.escala.length;
      const nota = p.raiz + 12 + p.escala[grado];
      this._nota(hz(nota), cuando, 0.12, p.arpOnda, 0.035 + 0.05 * i);
    }

    // ── PERCUSIÓN: bombo en los tiempos, aro en los contratiempos ──
    /*
     * ── PERCUSIÓN 4x4 ──
     *
     * El bombo en cada tiempo es el pulso del psy trance: no se apaga nunca. La
     * velocidad agrega el golpe del contratiempo y los hats, que dan la sensación de
     * urgencia sin dejar huecos.
     */
    if (paso % 4 === 0) this._golpe(cuando, 0.4);
    if (i > 0.3 && paso % 4 === 2) this._golpe(cuando, 0.22 + 0.12 * i);
    if (paso % 2 === 1) this._hat(cuando, 0.03 + 0.05 * i);
  }

  /**
   * Una nota: oscilador con envolvente corta y filtro propio.
   *
   * @param {number} freq @param {number} cuando @param {number} dur
   * @param {OscillatorType} tipo @param {number} vol
   */
  _nota(freq, cuando, dur, tipo, vol) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = tipo;
    osc.frequency.value = freq;

    // Ataque rápido y caída exponencial: suena a nota pulsada.
    g.gain.setValueAtTime(0, cuando);
    g.gain.linearRampToValueAtTime(vol, cuando + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, cuando + dur);

    osc.connect(g);
    g.connect(this.filtro);
    osc.start(cuando);
    osc.stop(cuando + dur + 0.05);
  }

  /**
   * Charles: ruido muy corto y agudo.
   *
   * Es lo que le da el aire "tech" al ritmo. Se sintetiza con ruido filtrado en
   * vez de un sample, así no hay archivos que cargar.
   *
   * @param {number} cuando @param {number} vol
   */
  _hat(cuando, vol) {
    const ctx = this.ctx;
    const largo = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, largo, ctx.sampleRate);
    const datos = buffer.getChannelData(0);
    for (let i = 0; i < largo; i++) {
      datos[i] = (Math.random() * 2 - 1) * (1 - i / largo) ** 3;
    }
    const fuente = ctx.createBufferSource();
    fuente.buffer = buffer;

    const pasoAlto = ctx.createBiquadFilter();
    pasoAlto.type = 'highpass';
    pasoAlto.frequency.value = 7000;

    const g = ctx.createGain();
    g.gain.value = vol;

    fuente.connect(pasoAlto);
    pasoAlto.connect(g);
    g.connect(this.salida);
    fuente.start(cuando);
  }

  /**
   * Golpe de percusión: golpea con un seno grave de caída rapidísima.
   *
   * @param {number} cuando @param {number} vol
   */
  _golpe(cuando, vol) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, cuando);
    osc.frequency.exponentialRampToValueAtTime(45, cuando + 0.12);

    g.gain.setValueAtTime(vol, cuando);
    g.gain.exponentialRampToValueAtTime(0.0008, cuando + 0.18);

    osc.connect(g);
    g.connect(this.salida);
    osc.start(cuando);
    osc.stop(cuando + 0.2);
  }
}

/** Instancia única. */
export const music = new MusicEngine();

/**
 * Pista que corresponde a un tramo.
 *
 * La música avanza junto con el corredor: los primeros tramos son el clima
 * tranquilo y los avanzados el oscuro. Así la progresión se siente sin necesidad de
 * que el jugador elija.
 *
 * @param {number} tramo
 * @returns {number} 0..2
 */
export function pistaParaTramo(tramo) {
  const t = Math.max(0, tramo);
  if (t < 2) return 0;
  if (t < 5) return 1;
  return 2;
}
