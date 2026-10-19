/**
 * PAPERCRASH — ui/aircraftSelector.js
 * ============================================================
 * Selector de aeronave, dentro de la pestaña NAVES de la tienda.
 *
 * Las tarjetas se generan desde `AIRCRAFT_LIST` (physics/specs.js), no desde
 * HTML escrito a mano. Así, agregar una aeronave no puede quedar
 * desincronizado entre el HTML y las fichas técnicas.
 *
 * ── Flujo de dos pasos ──
 * El pedido es que un clic PRESELECCIONE, no que compre ni equipe en el acto. Es
 * la diferencia entre mirar y decidir: el jugador compara las estadísticas de
 * varias naves sin comprometerse, y recién cuando aprieta el botón se adquiere o
 * se equipa.
 *
 *   clic en la tarjeta → selecciona (se ven los números y el botón)
 *   clic en el botón   → ADQUIRIR (si no es tuya) o EQUIPAR (si ya lo es)
 *
 * Sin este paso intermedio, un clic accidental en una nave cara gastaría las
 * monedas ahorradas. Con él, el gasto siempre es una decisión explícita.
 * ============================================================
 */
import { UI, setText } from './dom.js';
import { AIRCRAFT_LIST, isUnlocked } from '../physics/specs.js';
import { STATE, buyAircraft } from '../game/state.js';
import { formatNumber } from '../core/math.js';

/** Las estadísticas que se muestran, con su etiqueta y su unidad. */
const STAT_ROWS = [
  ['range', 'ALCANCE', (s) => `${Math.round(60 + s.ratings.range * 240)} m`],
  ['stability', 'ESTABILIDAD', (s) => `${Math.round(s.ratings.stability * 100)}%`],
  ['handling', 'MANIOBRA', (s) => `${Math.round(s.ratings.handling * 100)}%`],
  ['wind', 'VIENTO', (s) => (s.windFactor >= 2 ? 'Muy sensible' : s.windFactor >= 1 ? 'Sensible' : 'Estable')],
  ['stall', 'PÉRDIDA', (s) => `${s.stallSpeed} m/s`],
];

/**
 * ¿Se puede elegir esta aeronave?
 *
 * Hay dos condiciones independientes: estar DESBLOQUEADA (se consigue volando
 * lejos) y poder PAGARLA. Se informan por separado para que la tarjeta pueda
 * decir exactamente qué falta.
 *
 * @param {import('../physics/specs.js').FlightSpec} spec
 * @returns {{ok:boolean, reason:'locked'|'free'|'owned'|'coins'}}
 */
export function canPickAircraft(spec) {
  if (!isUnlocked(spec, STATE.bestDistance)) return { ok: false, reason: 'locked' };

  const price = spec.price ?? 0;
  if (price <= 0) return { ok: true, reason: 'free' };
  if ((STATE.aircraftOwned ?? []).includes(spec.id)) return { ok: true, reason: 'owned' };
  if (STATE.coins >= price) return { ok: true, reason: 'coins' };
  return { ok: false, reason: 'coins' };
}

export class AircraftSelector {
  /**
   * @param {(id:string) => void} onEquip  equipa la nave indicada
   * @param {() => void} [onBuy]  avisa que hubo una compra (para refrescar todo)
   */
  constructor(onEquip, onBuy) {
    this.onEquip = onEquip;
    this.onBuy = onBuy;
    /** @type {Map<string, object>} */
    this.cards = new Map();
    this.built = false;
    /**
     * Nave PRESELECCIONADA (no equipada).
     *
     * Arranca en la equipada para que el panel nunca esté vacío, pero se mueve
     * con un clic sin comprometer nada.
     * @type {string}
     */
    this.preview = STATE.aircraft;
  }

  build() {
    if (this.built) return;
    const wrap = UI.aircraftCards;
    if (!wrap) return;
    wrap.innerHTML = '';

    for (const spec of AIRCRAFT_LIST) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'plane-choice-btn';
      btn.dataset.type = spec.id;
      btn.setAttribute('aria-label', `${spec.name}: ${spec.desc}`);

      const icon = document.createElement('span');
      icon.className = 'plane-icon';
      icon.textContent = spec.icon;

      const name = document.createElement('span');
      name.className = 'plane-name';
      name.textContent = spec.name;

      const tag = document.createElement('span');
      tag.className = 'plane-tag';
      tag.textContent = spec.tag;

      const price = document.createElement('span');
      price.className = 'plane-price';

      /*
       * Barras + NÚMEROS.
       *
       * Las barras sirven para comparar de un vistazo, pero no dicen cuánto.
       * El número al lado responde "¿cuánto más?" sin obligar a comparar
       * longitudes, que es justo lo que se pide al elegir.
       */
      const stats = document.createElement('div');
      stats.className = 'plane-stats';
      const fills = new Map();
      const values = new Map();
      for (const [clave, etiqueta] of STAT_ROWS) {
        const fila = document.createElement('div');
        fila.className = 'plane-stat';

        const label = document.createElement('span');
        label.className = 'plane-stat-label';
        label.textContent = etiqueta;

        const bar = document.createElement('div');
        bar.className = 'plane-stat-bar';
        const fill = document.createElement('div');
        fill.className = 'plane-stat-fill';
        bar.appendChild(fill);

        const value = document.createElement('span');
        value.className = 'plane-stat-value';

        fila.append(label, bar, value);
        stats.appendChild(fila);
        fills.set(clave, fill);
        values.set(clave, value);
      }

      /*
       * Botón de acción, dentro de la tarjeta.
       *
       * El clic en el botón NO debe burbujear a la tarjeta: si lo hiciera, el
       * mismo clic preseleccionaría y además actuaría, y el paso intermedio
       * dejaría de existir.
       */
      const action = document.createElement('span');
      action.className = 'plane-action';
      action.setAttribute('role', 'button');

      btn.append(icon, name, tag, price, action, stats);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(spec.id);
      });

      action.addEventListener('click', (e) => {
        e.stopPropagation();
        this.act(spec.id);
      });

      wrap.appendChild(btn);
      this.cards.set(spec.id, { root: btn, price, status: action, spec, fills, values });
    }

    this.built = true;
  }

  /** Preselecciona una nave: sólo muestra sus datos, no compra ni equipa. */
  select(id) {
    if (!this.cards.has(id)) return;
    this.preview = id;
    this.sync();
  }

  /**
   * Ejecuta la acción de la nave seleccionada: comprar o equipar.
   *
   * @param {string} id
   * @returns {boolean} true si hizo algo
   */
  act(id) {
    const card = this.cards.get(id);
    if (!card) return false;

    const pick = canPickAircraft(card.spec);
    if (!pick.ok) return false;

    const owned = pick.reason === 'free' || pick.reason === 'owned';

    // Si NO es tuya: se compra. Si ya lo es: se equipa.
    if (!owned) {
      if (!buyAircraft(card.spec)) return false;
      this.onBuy?.();
    }

    this.onEquip(id);
    this.preview = id;
    this.sync();
    return true;
  }

  /** Marca la nave activa y refresca precios, números y estados. */
  sync() {
    if (!this.built) this.build();

    for (const [id, card] of this.cards) {
      const equipped = id === STATE.aircraft;
      const selected = id === this.preview;
      const pick = canPickAircraft(card.spec);
      const price = card.spec.price ?? 0;
      const owned = pick.reason === 'free' || pick.reason === 'owned';

      card.root.classList.toggle('active', equipped);
      card.root.classList.toggle('selected', selected);
      card.root.setAttribute('aria-pressed', String(equipped));

      /*
       * Los números y las barras se llenan SIEMPRE, no sólo al seleccionar.
       *
       * Así se pueden comparar las tres naves de un vistazo sin ir una por una.
       * La preselección no esconde información: agranda la de la elegida y
       * agrega el botón.
       */
      const ratings = card.spec.ratings ?? {};
      for (const [clave, , formato] of STAT_ROWS) {
        const fill = card.fills.get(clave);
        const value = card.values.get(clave);
        if (fill) {
          // El viento y la pérdida no son "más es mejor": se dibujan aparte.
          const v = clave === 'wind'
            ? 1 - Math.min(1, (card.spec.windFactor ?? 1) / 3)
            : clave === 'stall'
              ? 1 - Math.min(1, (card.spec.stallSpeed ?? 0) / 25)
              : (ratings[clave] ?? 0.5);
          fill.style.width = `${Math.round(v * 100)}%`;
          fill.dataset.low = v < 0.4 ? 'true' : 'false';
        }
        if (value) value.textContent = formato(card.spec);
      }

      card.root.classList.toggle('locked', !pick.ok);

      /*
       * El texto del botón es la pieza central del pedido:
       *   bloqueada → cuánto falta para desbloquearla
       *   sin comprar → ADQUIRIR (o cuánto falta de monedas)
       *   comprada → EQUIPAR (o EN USO si ya está puesta)
       */
      if (pick.reason === 'locked') {
        card.price.textContent = '';
        card.status.textContent = `A ${formatNumber(card.spec.unlockAt)} m`;
        card.status.classList.add('disabled');
      } else if (equipped) {
        card.price.textContent = price > 0 ? '💰 ' + formatNumber(price) : 'GRATIS';
        card.status.textContent = 'EN USO';
        card.status.classList.add('disabled');
      } else if (owned) {
        card.price.textContent = price > 0 ? '💰 ' + formatNumber(price) : 'GRATIS';
        card.status.textContent = 'EQUIPAR';
        card.status.classList.remove('disabled');
      } else if (pick.ok) {
        card.price.textContent = `💰 ${formatNumber(price)}`;
        card.status.textContent = 'ADQUIRIR';
        card.status.classList.remove('disabled');
      } else {
        card.price.textContent = `💰 ${formatNumber(price)}`;
        card.price.classList.add('cant-afford');
        card.status.textContent = `Faltan ${formatNumber(price - STATE.coins)}`;
        card.status.classList.add('disabled');
      }
    }
  }

  /** @deprecated usar `sync()`; se mantiene por compatibilidad de llamadas. */
  setActive() {
    this.sync();
  }

  /** Actualiza el nombre de la nave activa en el botón de la tienda. */
  syncDockLabel() {
    const spec = AIRCRAFT_LIST.find((s) => s.id === STATE.aircraft) ?? AIRCRAFT_LIST[0];
    setText(UI.shopCurrentPlane, `${spec.icon} ${spec.name}`);
  }
}
