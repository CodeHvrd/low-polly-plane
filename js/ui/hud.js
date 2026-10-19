/**
 * PAPERCRASH — ui/hud.js
 * ============================================================
 * HUD de vuelo: distancia, altitud, velocidad, viento y monedas.
 *
 * Se escribe solo lo que cambió (`setTextIfChanged`). Sin esa guarda, el
 * HUD escribiría ~8 nodos de texto por frame; a 60 FPS son 480 escrituras
 * por segundo que fuerzan recálculo de layout sin ninguna ganancia visual.
 * ============================================================
 */
import { UI, setText, show, hide } from './dom.js';
import { formatNumber, round, clamp01 } from '../core/math.js';

const last = {
  distance: null,
  glide: null,
  charges: null,
  stageName: null,
  stageProgress: null,
  altitude: null,
  speed: null,
  wind: null,
  windDir: null,
  coins: null,
};

function setIfChanged(key, node, value) {
  if (last[key] === value) return;
  last[key] = value;
  setText(node, value);
}

export const HUD = {
  show() {
    show(UI.hud);
  },

  hide() {
    hide(UI.hud);
  },

  /**
   * @param {{state:object, stats:object, speed:number, wind:{x:number,z:number}}} data
   */
  update(data) {
    const { stats, speed, wind } = data;
    setIfChanged('distance', UI.valDistance, `${Math.round(stats.distance)} m`);
    setIfChanged('altitude', UI.valAltitude, `${round(data.state.y, 1)} m`);
    setIfChanged('speed', UI.valSpeed, `${round(speed, 1)} m/s`);

    // Se muestra el viento lateral (el que desvía) porque es el que importa
    // para apuntar; el longitudinal altera la distancia pero no la dirección.
    const lateral = wind.z;
    setIfChanged('wind', UI.valWind, `${Math.abs(lateral).toFixed(1)} m/s`);

    const dir = lateral > 0.05 ? '0deg' : lateral < -0.05 ? '180deg' : '90deg';
    if (last.windDir !== dir) {
      last.windDir = dir;
      if (UI.windArrow) UI.windArrow.style.transform = `rotate(${dir})`;
    }
  },

  /** Monedas: se reflejan en los tres lugares donde se muestran. */
  updateCoins(coins) {
    if (last.coins === coins) return;
    last.coins = coins;
    const label = formatNumber(coins);
    setText(UI.globalCoinsVal, label);
    setText(UI.valCoins, label);
    setText(UI.totalCoinsVal, label);
  },

  /**
   * Cargador de propulsión: cuántas unidades quedan disponibles.
   *
   * Es la información táctica del vuelo. Se muestran las cargas como marcas y no
   * como un número suelto porque el jugador necesita ver de un vistazo cuántas
   * le quedan, no leer un dígito.
   *
   * @param {number} charges
   * @param {number} max
   * @param {boolean} [justGained]
   */
  updateCharges(charges, max, justGained = false) {
    if (last.charges === charges && !justGained) return;
    last.charges = charges;

    const node = UI.thrustBadge;
    if (!node) return;

    node.classList.toggle('hidden', charges <= 0 && !justGained);
    setText(UI.thrustCount, String(charges));

    // Marca visual de cada carga: se ve cuántas quedan sin leer el número.
    node.classList.toggle('empty', charges <= 0);
    node.classList.toggle('full', charges >= max);

    if (justGained) {
      // Reiniciar la animación: sin el reflow, quitar y poner la clase en el
      // mismo frame no vuelve a dispararla.
      node.classList.remove('pulse');
      void node.offsetWidth;
      node.classList.add('pulse');
    }
  },

  /**
   * Tramo actual.
   * @param {string} name @param {number} progress metros dentro del tramo
   */
  updateStage(name, progress) {
    const node = UI.stageBadge;
    if (!node) return;
    if (last.stageName !== name) {
      last.stageName = name;
      setText(UI.stageName, name);
      node.classList.remove('hidden');
      node.classList.remove('enter');
      void node.offsetWidth;
      node.classList.add('enter');
    }
    const rounded = Math.round(progress);
    if (last.stageProgress !== rounded) {
      last.stageProgress = rounded;
      setText(UI.stageProgress, `${rounded} m`);
    }
  },

  /**
   * Barra del presupuesto de planeo.
   *
   * Es la información táctica más importante del vuelo: dice cuánto queda antes
   * de que el avión empiece a caer, o sea cuándo hay que buscar el próximo
   * booster. Se actualiza con el porcentaje redondeado para no repintar en cada
   * frame por una décima.
   *
   * @param {number} glideBudget segundos restantes
   * @param {number} max
   */
  updateGlide(glideBudget, max) {
    const pct = max > 0 ? Math.round(clamp01(glideBudget / max) * 100) : 0;
    if (last.glide === pct) return;
    last.glide = pct;

    if (UI.glideFill) {
      UI.glideFill.style.width = `${pct}%`;
      // Aviso visual cuando queda poco: es el momento de buscar un booster.
      UI.glideFill.classList.toggle('low', pct <= 25);
    }
    if (UI.glidePct) setText(UI.glidePct, `${pct}%`);
  },

  /** Invalida la caché: fuerza a repintar aunque el valor coincida. */
  invalidate() {
    for (const k of Object.keys(last)) last[k] = null;
  },
};
