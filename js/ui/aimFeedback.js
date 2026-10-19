/**
 * PAPERCRASH — ui/aimFeedback.js
 * ============================================================
 * Panel de feedback del apuntado: pitch, azimut, potencia y el resumen
 * de la previsión (alcance y ápice).
 *
 * Mostrar el alcance previsto convierte la línea punteada en información
 * accionable: el jugador no solo ve el arco, ve el número.
 * ============================================================
 */
import { UI, setText, show, hide } from './dom.js';

export const AimFeedback = {
  show() {
    show(UI.slingFeedback);
  },

  hide() {
    hide(UI.slingFeedback);
  },

  /**
   * @param {import('../game/aiming.js').AimState} aim
   */
  update(aim) {
    setText(UI.fbPitch, `${Math.round(aim.pitchDeg)}°`);

    // El azimut se muestra con flecha porque el signo solo no dice nada
    // intuitivo en pantalla.
    const az = aim.azimuthDeg;
    const azLabel = Math.abs(az) < 1 ? '0°' : `${az > 0 ? '▶' : '◀'} ${Math.abs(Math.round(az))}°`;
    setText(UI.fbAzimuth, azLabel);

    const pct = Math.round(aim.powerPct);
    setText(UI.fbPower, `${pct}%`);
    if (UI.fbBar) UI.fbBar.style.width = `${pct}%`;

    const preview = aim.preview;
    if (preview) {
      setText(UI.fbReach, `${Math.round(preview.distance)} m`);
      setText(UI.fbApex, `${Math.round(preview.apex)} m`);
    }
  },
};
