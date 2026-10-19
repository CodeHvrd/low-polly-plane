/**
 * PAPERCRASH — core/audio.js
 * ============================================================
 * Audio procedural con WebAudio (sin archivos externos).
 *
 * El AudioContext se crea perezosamente en el primer gesto del usuario,
 * porque los navegadores bloquean el audio hasta que hay interacción.
 * Todos los métodos son seguros de llamar en cualquier momento: si el
 * audio no está disponible simplemente no hacen nada.
 * ============================================================
 */
import { AUDIO } from '../config.js';

let ctx = null;
let masterGain = null;
let muted = AUDIO.DEFAULT_MUTED;
let unlocked = false;

function ensureContext() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : AUDIO.MASTER_VOLUME;
    masterGain.connect(ctx.destination);
  } catch (err) {
    console.warn('[audio] no disponible', err);
    ctx = null;
  }
  return ctx;
}

/** Debe llamarse desde un handler de gesto del usuario. */
export function unlock() {
  const c = ensureContext();
  if (!c || unlocked) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  unlocked = true;
}

export function setMuted(value) {
  muted = Boolean(value);
  if (masterGain && ctx) {
    masterGain.gain.setTargetAtTime(muted ? 0 : AUDIO.MASTER_VOLUME, ctx.currentTime, 0.02);
  }
  return muted;
}

export const isMuted = () => muted;
export const toggleMuted = () => setMuted(!muted);

/**
 * Tono simple con envolvente. `type` es la forma de onda de OscillatorNode.
 * @param {{freq:number, toFreq?:number, dur:number, type?:OscillatorType, gain?:number, delay?:number}} opts
 */
function tone({ freq, toFreq, dur, type = 'sine', gain = 0.2, delay = 0 }) {
  const c = ensureContext();
  if (!c || !masterGain || muted) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (toFreq && toFreq !== freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), t0 + dur);
  }

  // Ataque muy corto + caída exponencial: suena "natural" sin clicks.
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(env);
  env.connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Ráfaga de ruido filtrado (impactos, explosiones). */
function noiseBurst({ dur = 0.3, gain = 0.3, freq = 900, q = 0.7 }) {
  const c = ensureContext();
  if (!c || !masterGain || muted) return;
  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Decaimiento dentro del propio buffer para evitar otra envolvente.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const src = c.createBufferSource();
  src.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  filter.Q.value = q;

  const env = c.createGain();
  env.gain.value = gain;

  src.connect(filter);
  filter.connect(env);
  env.connect(masterGain);
  src.start();
}

// ── Efectos del juego ───────────────────────────────────────
export const sfx = {
  /** Tensar la banda: sube de tono con la potencia. */
  stretch(power01) {
    tone({ freq: 140 + power01 * 120, dur: 0.05, type: 'triangle', gain: 0.05 });
  },

  launch(power01) {
    tone({ freq: 320 + power01 * 220, toFreq: 90, dur: 0.35, type: 'sawtooth', gain: 0.16 });
    noiseBurst({ dur: 0.22, gain: 0.12, freq: 1400 });
  },

  /** Aro atravesado: arpegio corto y brillante. */
  ring() {
    tone({ freq: 880, dur: 0.12, type: 'sine', gain: 0.18 });
    tone({ freq: 1320, dur: 0.16, type: 'sine', gain: 0.14, delay: 0.07 });
  },

  bounce(strength01) {
    const g = 0.08 + strength01 * 0.16;
    noiseBurst({ dur: 0.12, gain: g, freq: 500 });
    tone({ freq: 160, toFreq: 70, dur: 0.14, type: 'square', gain: g * 0.6 });
  },

  crash(intensity01) {
    noiseBurst({ dur: 0.55, gain: 0.28 + intensity01 * 0.22, freq: 700 });
    tone({ freq: 120, toFreq: 40, dur: 0.5, type: 'sawtooth', gain: 0.2 });
  },

  /**
   * Moneda recogida.
   *
   * El valor cambia el tono y la cantidad de notas: juntar una de 50 tiene que
   * SONAR distinto, porque el jugador está mirando al avión y no al marcador.
   * Es el aviso principal de que valió la pena desviarse.
   *
   * @param {number} [value] 5, 10 o 50
   */
  coin(value = 5) {
    tone({ freq: 1046, dur: 0.08, type: 'square', gain: 0.10 });
    tone({ freq: 1568, dur: 0.12, type: 'square', gain: 0.09, delay: 0.06 });

    if (value >= 10) {
      // Una nota más, un poco más aguda.
      tone({ freq: 2093, dur: 0.10, type: 'square', gain: 0.07, delay: 0.13 });
    }
    if (value >= 50) {
      // Arpegio ascendente: premio grande, aviso grande.
      tone({ freq: 2637, dur: 0.14, type: 'triangle', gain: 0.11, delay: 0.19 });
      tone({ freq: 3136, dur: 0.18, type: 'triangle', gain: 0.09, delay: 0.27 });
    }
  },

  /** Booster recogido: barrido ascendente con cuerpo, se siente como un empuje. */
  /*
   * ── Combo de aros ──
   *
   * ── Por qué un sonido PROPIO y no reusar ring() + booster() ──
   * Se probó reusando los dos y no alcanzaba: el oído no distingue "agarre un aro"
   * de "complete el combo" porque los dos eventos suenan casi juntos. Un arpegio
   * ascendente de tres notas es inconfundible: suena a premio, no a paso.
   */
  combo() {
    // Do–Mi–Sol ascendente, brillante y corto.
    tone({ freq: 523, dur: 0.09, type: 'triangle', gain: 0.22 });
    tone({ freq: 659, dur: 0.09, type: 'triangle', gain: 0.22, delay: 0.07 });
    tone({ freq: 784, dur: 0.22, type: 'triangle', gain: 0.26, delay: 0.14 });
    // Chispa aguda encima, para que se lea como "logro".
    tone({ freq: 1568, toFreq: 2093, dur: 0.18, type: 'sine', gain: 0.10, delay: 0.14 });
  },

  booster() {
    tone({ freq: 220, toFreq: 880, dur: 0.30, type: 'sawtooth', gain: 0.16 });
    tone({ freq: 440, toFreq: 1760, dur: 0.26, type: 'sine', gain: 0.12, delay: 0.03 });
    noiseBurst({ dur: 0.20, gain: 0.08, freq: 2600 });
  },

  buy() {
    tone({ freq: 523, dur: 0.09, type: 'triangle', gain: 0.16 });
    tone({ freq: 784, dur: 0.14, type: 'triangle', gain: 0.14, delay: 0.07 });
  },

  click() {
    tone({ freq: 640, dur: 0.05, type: 'square', gain: 0.07 });
  },
};
