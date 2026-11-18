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
    /** Modo musical actual: 'menu' | 'aim' | 'flight' | 'crash' */
    this.modo = 'menu';
    /** Velocidad actual del avión (m/s) para activar capas dinámicas. */
    this.speed = 0;
    /** Timestamp de audio hasta el cual dura el remate de choque. */
    this.crashedUntil = 0;
    /** 0 = tranquilo, 1 = a fondo. */
    this.intensidad = 0;
    /** BPM actual, suavizado para que no salte de golpe. */
    this.bpm = 86;
    /** Próximo instante (s) en el que hay que encolar el siguiente paso. */
    this.siguientePaso = 0;
    /** Índice de paso dentro del compás (0..15). */
    this.paso = 0;
    /** Número de compás acumulado para avanzar la progresión de acordes. */
    this.compas = 0;
    /** Nodo de salida de la música. */
    this.salida = null;
    this.filtro = null;
    this.reverb = null;
    this.seco = null;
    this.humedo = null;
    this.hatBuffer = null;
    this._lastParamUpdate = -1;
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
    this.modo = 'menu';
    this.paso = 0;
    this.compas = 0;
    this.speed = 0;
    this.bpm = 88;
    this.intensidad = 0.15;
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

    // Cámara espacial ligera (doble delay cruzado filtrado) en lugar de ConvolverNode:
    // suena amplio igual pero consume <2% de CPU en mobile y evita cortes/ralentizaciones.
    const tankFilter = ctx.createBiquadFilter();
    tankFilter.type = 'lowpass';
    tankFilter.frequency.value = 2100;

    const delayA = ctx.createDelay(0.5);
    delayA.delayTime.value = 0.11;
    const delayB = ctx.createDelay(0.5);
    delayB.delayTime.value = 0.17;
    const fbA = ctx.createGain();
    fbA.gain.value = 0.34;
    const fbB = ctx.createGain();
    fbB.gain.value = 0.32;

    // Reparto seco / húmedo: la parte "espacial" sube con la intensidad.
    this.seco = ctx.createGain();
    this.humedo = ctx.createGain();
    this.seco.gain.value = 0.85;
    this.humedo.gain.value = 0.15;

    this.salida = ctx.createGain();
    this.salida.gain.value = this.mudo ? 0 : 0.5;

    this.filtro.connect(this.seco);
    this.filtro.connect(tankFilter);
    tankFilter.connect(delayA);
    tankFilter.connect(delayB);
    delayA.connect(fbA);
    fbA.connect(delayB);
    delayB.connect(fbB);
    fbB.connect(delayA);
    delayA.connect(this.humedo);
    delayB.connect(this.humedo);

    this.seco.connect(this.salida);
    this.humedo.connect(this.salida);
    this.salida.connect(comp);
    this.reverb = tankFilter;

    this.hatBuffer = this._construirHatBuffer();
  }

  /**
   * Precalcula una sola vez el buffer del hi-hat (ruido agudo con caída rápida),
   * evitando asignar AudioBuffers y BiquadFilters en cada paso de semicorchea.
   */
  _construirHatBuffer() {
    const ctx = this.ctx;
    const largo = Math.max(1, Math.floor(ctx.sampleRate * 0.048));
    const buffer = ctx.createBuffer(1, largo, ctx.sampleRate);
    const datos = buffer.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < largo; i++) {
      const env = (1 - i / largo) ** 3;
      const white = Math.random() * 2 - 1;
      // Filtro paso-alto simple de 1 polo horneado en el sample.
      const hp = white - 0.84 * prev;
      prev = white;
      datos[i] = Math.max(-1, Math.min(1, hp * 0.72 * env));
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
    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx({ latencyHint: 'playback' });
      } catch {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume?.();
    return true;
  }

  /**
   * Cambia el estado musical adaptativo:
   * - 'menu': ambiente calmo sin batería, acordes cálidos y arpegio suave (~88 BPM).
   * - 'aim': tensión creciente en la resortera.
   * - 'flight': motor adaptativo completo con capas según la velocidad.
   * - 'crash': remate dramático y silencio de percusión.
   *
   * @param {'menu'|'aim'|'flight'|'crash'} modo
   */
  setModo(modo) {
    if (this.modo === modo) return;
    this.modo = modo;
    if (!this.activo || !this.ctx) return;

    const ahora = this.ctx.currentTime;
    this._lastParamUpdate = -1;
    if (modo === 'menu') {
      this.speed = 0;
      this.setPista(0);
      this.filtro.frequency.setTargetAtTime(1600, ahora, 0.5);
      this.humedo.gain.setTargetAtTime(0.32, ahora, 0.5);
      this.seco.gain.setTargetAtTime(0.68, ahora, 0.5);
      if (!this.mudo && this.salida) {
        this.salida.gain.setTargetAtTime(0.45, ahora, 0.4);
      }
    } else if (modo === 'aim') {
      this.filtro.frequency.setTargetAtTime(950, ahora, 0.35);
      this.humedo.gain.setTargetAtTime(0.24, ahora, 0.35);
      this.seco.gain.setTargetAtTime(0.76, ahora, 0.35);
      if (!this.mudo && this.salida) {
        this.salida.gain.setTargetAtTime(0.5, ahora, 0.25);
      }
    } else if (modo === 'flight') {
      if (!this.mudo && this.salida) {
        this.salida.gain.setTargetAtTime(0.55, ahora, 0.25);
      }
    }
  }

  /**
   * Remate musical de choque/aterrizaje:
   * barre el filtro hacia abajo como si se cortara el aire, suelta un sub-grave
   * de impacto y atenúa la base rítmica antes de volver al menú.
   *
   * @param {number} [severity=0.6]
   */
  onCrash(severity = 0.6) {
    this.modo = 'crash';
    if (!this.activo || !this.ctx) return;

    const ahora = this.ctx.currentTime;
    this.crashedUntil = ahora + 1.4;

    this.filtro.frequency.cancelScheduledValues(ahora);
    this.filtro.frequency.setValueAtTime(Math.max(200, this.filtro.frequency.value), ahora);
    this.filtro.frequency.exponentialRampToValueAtTime(160, ahora + 0.35);

    if (!this.mudo && this.salida) {
      this.salida.gain.cancelScheduledValues(ahora);
      this.salida.gain.setTargetAtTime(0.18, ahora, 0.15);
    }

    if (!this.mudo) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(95, ahora);
      osc.frequency.exponentialRampToValueAtTime(28, ahora + 0.55);

      const vol = 0.25 + 0.25 * Math.min(1, severity);
      g.gain.setValueAtTime(vol, ahora);
      g.gain.exponentialRampToValueAtTime(0.001, ahora + 0.65);

      osc.connect(g);
      g.connect(this.salida);
      osc.start(ahora);
      osc.stop(ahora + 0.7);
    }
  }

  /**
   * Fija la intensidad y ajusta tempo, oscuridad, espacio y capas de velocidad.
   *
   * @param {number} v 0..1
   * @param {number} [speed=this.speed] m/s
   */
  setIntensidad(v, speed = this.speed) {
    const valor = Math.max(0, Math.min(1, v));
    this.intensidad = valor;
    this.speed = speed;
    if (!this.activo || !this.ctx) return;
    if (this.modo === 'crash') return;

    const ahora = this.ctx.currentTime;

    if (this.modo === 'menu') {
      this.bpm += (88 - this.bpm) * 0.08;
      return;
    }
    if (this.modo === 'aim') {
      this.bpm += (112 - this.bpm) * 0.08;
      return;
    }

    // En vuelo: el tempo sube suavemente según intensidad y velocidad
    const objetivo = this.pista.bpmMin + (this.pista.bpmMax - this.pista.bpmMin) * valor;
    this.bpm += (objetivo - this.bpm) * 0.08;

    // Limitar cambios de AudioParams a ~12 Hz en lugar de 60 Hz para no saturar
    // la cola de automatización WebAudio en dispositivos móviles.
    if (this._lastParamUpdate >= 0 && ahora - this._lastParamUpdate < 0.08) return;
    this._lastParamUpdate = ahora;

    const corte = this.pista.padCorte * (1 - 0.45 * valor) + (speed > 55 ? 450 : 0);
    this.filtro.frequency.setTargetAtTime(Math.max(240, corte), ahora, 0.35);
    this.humedo.gain.setTargetAtTime(0.14 + 0.38 * valor, ahora, 0.4);
    this.seco.gain.setTargetAtTime(0.86 - 0.28 * valor, ahora, 0.4);
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

  /** Pausa el planificador y suspende el AudioContext al pasar a segundo plano. */
  suspender() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend?.().catch(() => {});
    }
  }

  /** Reanuda la música al volver a primer plano sin disparar ráfaga de notas atrasadas. */
  reanudar() {
    if (!this.activo || !this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume?.().catch(() => {});
    }
    this.siguientePaso = this.ctx.currentTime + 0.05;
    if (!this.timer) this._arrancarPlanificador();
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
    if (this.timer) clearInterval(this.timer);
    // Cada 40 ms se encolan las notas de los próximos 180 ms (menos wakeups en mobile).
    this.timer = setInterval(() => this._planificar(), 40);
  }

  _planificar() {
    if (!this.activo || !this.ctx) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const ahora = this.ctx.currentTime;
    // Si hubo un tirón largo de frame, descartar compases viejos para no
    // disparar una ráfaga de notas juntas que sature el audio.
    if (this.siguientePaso < ahora - 0.2) {
      this.siguientePaso = ahora + 0.02;
    }
    const horizonte = ahora + 0.18;
    while (this.siguientePaso < horizonte) {
      this._tocarPaso(this.siguientePaso, this.paso);
      // Un paso es una semicorchea: 4 pasos por tiempo.
      const durPaso = 60 / this.bpm / 4;
      this.siguientePaso += durPaso;
      this.paso = (this.paso + 1) % 16;
      if (this.paso === 0) this.compas++;
    }
  }

  /**
   * Encola lo que suena en un paso según el modo ('menu' | 'aim' | 'flight' | 'crash')
   * y las capas dinámicas de velocidad.
   *
   * @param {number} cuando @param {number} paso 0..15
   */
  _tocarPaso(cuando, paso) {
    const p = this.pista;
    const i = this.intensidad;
    const spd = this.speed;
    const compas = this.compas;
    const gradoCompas = p.progresion[compas % p.progresion.length];

    // ── PAD: acorde sostenido del compás (presente en todos los modos) ──
    if (paso === 0) {
      const base = p.raiz + p.escala[gradoCompas % p.escala.length];
      const dur = 16 * (60 / this.bpm / 4) * 0.95;
      const vol = this.modo === 'crash' ? 0.025 : 0.045;
      for (const intervalo of [0, 7, 12]) {
        this._nota(hz(base + intervalo), cuando, dur, p.padOnda, vol);
      }
    }

    // Durante el remate de choque no se dispara ritmo ni arpegios
    if (this.modo === 'crash') return;

    // ── MODO MENÚ: ambiente cálido, sin batería ──
    if (this.modo === 'menu') {
      if (paso === 0 || paso === 8) {
        const nota = p.raiz - 24 + p.escala[gradoCompas % p.escala.length];
        this._nota(hz(nota), cuando, 0.38, 'sine', 0.12);
      }
      if (paso % 4 === 0) {
        const orden = [0, 2, 4, 2];
        const grado = orden[(paso / 4) % orden.length] % p.escala.length;
        const nota = p.raiz + 12 + p.escala[grado];
        this._nota(hz(nota), cuando, 0.28, 'sine', 0.032);
      }
      return;
    }

    // ── MODO APUNTADO (RESORTERA): pulso contenido de anticipación ──
    if (this.modo === 'aim') {
      if (paso % 4 === 0) {
        const nota = p.raiz - 24 + p.escala[gradoCompas % p.escala.length];
        this._nota(hz(nota), cuando, 0.20, p.bajoOnda, 0.14);
      }
      if (paso % 4 === 2) {
        const nota = p.raiz + p.escala[(gradoCompas + 2) % p.escala.length];
        this._nota(hz(nota), cuando, 0.14, 'triangle', 0.035);
      }
      return;
    }

    // ── MODO VUELO: Capas Adaptativas por Velocidad ──
    // Capa Base (< 30 m/s): Bajo rodante continuo en semicorcheas
    {
      const nota = p.raiz - 24 + p.escala[gradoCompas % p.escala.length];
      const enTiempo = paso % 4 === 0;
      this._nota(
        hz(nota + (enTiempo ? 0 : 12)),
        cuando,
        enTiempo ? 0.16 : 0.09,
        p.bajoOnda,
        (enTiempo ? 0.15 : 0.09) + 0.05 * i,
      );
    }

    // Capa 1 (Velocidad Crucero >= 30 m/s o intensidad > 0.25): Arpegio + Hi-Hats
    if (spd >= 30 || i > 0.25) {
      if (paso % 2 === 0) {
        const orden = [0, 2, 4, 3, 1, 3, 5, 4];
        const grado = orden[(paso / 2) % orden.length] % p.escala.length;
        const nota = p.raiz + 12 + p.escala[grado];
        this._nota(hz(nota), cuando, 0.12, p.arpOnda, 0.03 + 0.055 * i);
      }
      if (paso % 2 === 1) {
        this._hat(cuando, 0.025 + 0.05 * i);
      }
    }

    // Capa 2 (Alta Velocidad >= 45 m/s o intensidad > 0.45): Bombo 4x4 impulsor
    if (spd >= 45 || i > 0.45) {
      if (paso % 4 === 0) this._golpe(cuando, 0.34 + 0.1 * i);
    } else if (paso === 0 || paso === 8) {
      // Pulso suave en tiempos 1 y 3 a baja velocidad
      this._golpe(cuando, 0.22);
    }

    // Capa 3 (Supersónico >= 60 m/s o intensidad > 0.75): Doble golpe y brillo agudo
    if (spd >= 60 || i > 0.75) {
      if (paso % 4 === 2) this._golpe(cuando, 0.26);
      if (paso % 4 === 2) {
        const nota = p.raiz + 24 + p.escala[(gradoCompas + 4) % p.escala.length];
        this._nota(hz(nota), cuando, 0.11, p.arpOnda, 0.04);
      }
    }
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
    if (!this.hatBuffer) this.hatBuffer = this._construirHatBuffer();
    const fuente = ctx.createBufferSource();
    fuente.buffer = this.hatBuffer;

    const g = ctx.createGain();
    g.gain.value = vol;

    fuente.connect(g);
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
