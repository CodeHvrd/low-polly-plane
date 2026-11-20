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
import { computeRunScoreBreakdown } from '../game/score.js';
import { toDisplayKmh } from '../physics/specs.js';

/** Título y color según cómo terminó el vuelo: FLYED si superó el nivel, CRASH si chocó/cayó. */
function classify(result) {
  if (result.cause === 'finish') {
    return { title: '🏁 FLYED', cls: 'res-good' };
  }
  return { title: '💥 CRASH', cls: 'res-crash' };
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
    setText(UI.resSpeed, `${toDisplayKmh(result.maxSpeed, result.aircraft ?? STATE.aircraft)} km/h`);
    setText(UI.resTime, `${result.time} s`);
    setText(UI.resRings, `${result.rings}`);
    setText(UI.resBoosters, `${result.boosters ?? 0}`);
    setText(UI.resCoinCount, `${result.coinsCollected ?? 0}`);

    const breakdown = computeRunScoreBreakdown(result, result.missionsCompleted ?? 0);
    setText(UI.resScore, formatNumber(breakdown.totalScore));
    setText(UI.resCoins, `+${formatNumber(result.coins)}`);

    const elMts = document.getElementById('res-score-mts');
    if (elMts) elMts.textContent = formatNumber(breakdown.mtsScore);

    const elCoinsScore = document.getElementById('res-score-coins');
    if (elCoinsScore) elCoinsScore.textContent = `${formatNumber(breakdown.coinsScore)} pts`;

    const elCoinsDetail = document.getElementById('res-score-coins-detail');
    if (elCoinsDetail) {
      const c = breakdown.coinCounts;
      const totalGrabbed = (c.yellow || 0) + (c.pink || 0) + (c.gold || 0);
      const makeChip = (cls, text) => {
        const chip = document.createElement('span');
        chip.className = 'coin-chip';
        const dot = document.createElement('i');
        dot.className = `coin-dot ${cls}`;
        chip.append(dot, document.createTextNode(text));
        return chip;
      };
      const totalBadge = document.createElement('span');
      totalBadge.className = 'coin-total-badge';
      totalBadge.textContent = `Total: ${totalGrabbed} (+${formatNumber(result.coins)} 🪙)`;

      elCoinsDetail.replaceChildren(
        makeChip('yellow', `${c.yellow}×10`),
        makeChip('pink', `${c.pink}×25`),
        makeChip('gold', `${c.gold}×50`),
        totalBadge,
      );
    }

    const elBonusScore = document.getElementById('res-score-bonus');
    if (elBonusScore) elBonusScore.textContent = formatNumber(breakdown.bonusScore);

    const elMult = document.getElementById('res-score-mult');
    if (elMult) {
      elMult.textContent = `x${breakdown.multiplier}`;
      elMult.classList.toggle('hidden', breakdown.multiplier <= 1);
    }

    const elBonusDetail = document.getElementById('res-score-bonus-detail');
    if (elBonusDetail) {
      const b = breakdown.bonusDetails;
      elBonusDetail.textContent = `Rozes ${b.nearMisses} · Mis. ${b.missions} · Aros ${b.rings}`;
    }

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

