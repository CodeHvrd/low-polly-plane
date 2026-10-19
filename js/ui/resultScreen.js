/**
 * PAPERCRASH — ui/resultScreen.js
 * ============================================================
 * Pantalla de resultado tras cada vuelo.
 *
 * ── Nota sobre el bug de reentrada ──
 * Esta pantalla ya NO reacciona a eventos globales. Su botón "VOLAR DE
 * NUEVO" es un `<button>` normal gestionado por `ui/overlays.js`, y el
 * módulo de entrada descarta los gestos que empiezan sobre un control
 * interactivo. Antes, un `mousedown` en `document` atravesaba la pantalla
 * y relanzaba el avión en el mismo clic.
 * ============================================================
 */
import { UI, setText, show, hide } from './dom.js';
import { STATE } from '../game/state.js';
import { formatNumber } from '../core/math.js';

/** Título y color según cómo terminó el vuelo. */
function classify(result) {
  if (result.cause === 'obstacle') {
    return { title: '💥 IMPACTO', cls: 'res-crash' };
  }
  /*
   * El límite de tiempo ya no se dispara en la práctica (600 s), pero si algún
   * día pasa tiene que tener su propio cartel: reportarlo como aterrizaje o
   * impacto confundiría al jugador.
   */
  if (result.cause === 'timeout') {
    return { title: '⏱ TIEMPO AGOTADO', cls: 'res-out' };
  }
  if (result.cause === 'corridor') {
    return { title: '🚫 FUERA DE RUTA', cls: 'res-out' };
  }
  if (result.kind === 'landing' && result.severity < 0.5) {
    return { title: '🛬 ATERRIZAJE PERFECTO', cls: 'res-good' };
  }
  if (result.severity < 1.0) {
    return { title: '💨 ATERRIZAJE BRUSCO', cls: 'res-hard' };
  }
  return { title: '💥 CRASH TOTAL', cls: 'res-crash' };
}

export const ResultScreen = {
  /**
   * @param {import('../game/RunController.js').RunResult} result
   */
  show(result) {
    const { title, cls } = classify(result);
    const titleEl = UI.resultTitle;
    if (titleEl) {
      titleEl.textContent = title;
      titleEl.className = cls;
    }

    setText(UI.resDistance, `${result.distance} m`);
    setText(UI.resAltitude, `${result.maxAltitude} m`);
    setText(UI.resSpeed, `${result.maxSpeed} m/s`);
    setText(UI.resTime, `${result.time} s`);
    setText(UI.resRings, `${result.rings}`);
    setText(UI.resBoosters, `${result.boosters ?? 0}`);
    setText(UI.resCoinCount, `${result.coinsCollected ?? 0}`);
    /*
     * El PUNTAJE es la distancia recorrida.
     *
     * Es la medida natural de una buena partida en este juego: no hay combos ni
     * enemigos derrotados, así que lo que hay que superar es el propio récord.
     */
    setText(UI.resScore, formatNumber(Math.round(result.distance)));
    setText(UI.resCoins, `+${formatNumber(result.coins)}`);

    // Aviso de récord / récord actual.
    const rec = UI.resRecord;
    if (rec) {
      if (result.isRecord) {
        rec.textContent = `🏆 ¡NUEVO RÉCORD! ${result.distance} m`;
        rec.className = 'res-record is-record';
      } else {
        rec.textContent = `🏁 Récord: ${STATE.bestDistance} m`;
        rec.className = 'res-record';
      }
    }

    show(UI.resultScreen);
  },

  hide() {
    hide(UI.resultScreen);
  },

  get visible() {
    return UI.resultScreen && !UI.resultScreen.classList.contains('hidden');
  },
};

