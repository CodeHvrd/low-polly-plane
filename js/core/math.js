/**
 * PAPERCRASH — core/math.js
 * ============================================================
 * Utilidades matemáticas puras (sin dependencias de Three.js ni DOM),
 * para poder testearlas y reutilizarlas desde Node.
 * ============================================================
 */

export const DEG2RAD = Math.PI / 180;

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const clamp01 = (v) => clamp(v, 0, 1);

export const lerp = (a, b, t) => a + (b - a) * t;

export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

/** Interpolación lineal remapeada de un rango a otro, con recorte. */
export const remap = (v, inMin, inMax, outMin, outMax) =>
  lerp(outMin, outMax, clamp01(invLerp(inMin, inMax, v)));

export const degToRad = (d) => d * DEG2RAD;

/**
 * Suavizado exponencial independiente de los FPS.
 * `rate` es "por segundo": a mayor rate, más rápido converge.
 */
export const damp = (current, target, rate, dt) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

/** Smoothstep cúbico (0..1) para rampas suaves. */
export const smoothstep = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

export const distance2D = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

/** Redondea a `decimals` decimales devolviendo número (no string). */
export const round = (v, decimals = 0) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

/**
 * Generador pseudoaleatorio determinista (mulberry32).
 * Se usa para que el corredor de obstáculos sea idéntico en cada partida
 * y para poder reproducir bugs con una semilla fija.
 */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Float en [min, max). */
    range: (min, max) => min + next() * (max - min),
    /** Entero en [min, max]. */
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    /** Elemento aleatorio de un array. */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** true con probabilidad p. */
    chance: (p) => next() < p,
  };
}

/** Formatea números grandes de monedas de forma legible (1.2K, 3.4M). */
export function formatNumber(n) {
  const v = Math.floor(n);
  if (v < 1000) return String(v);
  if (v < 1e6) return `${(v / 1e3).toFixed(v < 1e4 ? 1 : 0)}K`;
  if (v < 1e9) return `${(v / 1e6).toFixed(1)}M`;
  return `${(v / 1e9).toFixed(1)}B`;
}
