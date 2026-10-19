/**
 * PAPERCRASH — ui/shop.js
 * ============================================================
 * Tienda de mejoras.
 *
 * Construye las tarjetas UNA sola vez y después solo actualiza su estado
 * (`sync`). La versión anterior rehacía `innerHTML` completo en cada
 * compra, lo que destruía y recreaba todos los nodos: se perdía el foco
 * del teclado y se saltaba el scroll.
 * ============================================================
 */
import { UI } from './dom.js';
import { UPGRADES, STATE, upgradeCost, isMaxed, nivelesDe } from '../game/state.js';
import { formatNumber } from '../core/math.js';

/**
 * @typedef {Object} ShopCard
 * @property {HTMLElement} root
 * @property {HTMLElement} name
 * @property {HTMLElement} cost
 * @property {HTMLElement} fill
 * @property {HTMLElement} status
 * @property {import('../game/state.js').UpgradeDef} def
 */

export class Shop {
  /**
   * @param {(id:string) => void} onPurchase
   * @param {() => void} onAnyChange
   */
  constructor(onPurchase, onAnyChange) {
    /** @type {ShopCard[]} */
    this.cards = [];
    this.onPurchase = onPurchase;
    this.onAnyChange = onAnyChange;
    this.built = false;
    /** @type {boolean} */
    this.open = false;
    /** Pestaña visible: 'ships' o 'upgrades'. @type {string} */
    this.tab = 'ships';
  }

  /**
   * Abre o cierra el panel de la tienda.
   *
   * El panel está SIEMPRE en el DOM y solo se alterna una clase: así el estado
   * de las tarjetas (niveles, costos, scroll) sobrevive a abrir y cerrar, y no
   * hay que reconstruir nada.
   *
   * @param {boolean} [next] si se omite, alterna
   */
  toggle(next) {
    this.open = typeof next === 'boolean' ? next : !this.open;
    UI.shopPanel?.classList.toggle('hidden', !this.open);
    UI.shopDock?.classList.toggle('open', this.open);
    UI.btnShop?.setAttribute('aria-expanded', String(this.open));
    return this.open;
  }

  /**
   * Cambia de pestaña: NAVES o MEJORAS.
   *
   * Se separaron porque son cosas distintas —una nave se elige y se compra una
   * vez, una mejora se sube de nivel muchas veces— y tenerlas en la misma lista
   * obligaba a leer todo para encontrar lo que buscabas.
   *
   * @param {'ships'|'upgrades'} which
   */
  setTab(which) {
    const ships = which !== 'upgrades';
    UI.shopHangar?.classList.toggle('hidden', !ships);
    UI.shopUpgrades?.classList.toggle('hidden', ships);
    UI.tabShips?.classList.toggle('active', ships);
    UI.tabUpgrades?.classList.toggle('active', !ships);
    UI.tabShips?.setAttribute('aria-selected', String(ships));
    UI.tabUpgrades?.setAttribute('aria-selected', String(!ships));
    this.tab = ships ? 'ships' : 'upgrades';
  }

  /** Crea las tarjetas una vez. */
  build() {
    if (this.built) return;
    const grid = UI.shopGrid;
    if (!grid) return;
    grid.innerHTML = '';

    for (const def of UPGRADES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'shop-card';
      card.dataset.upgrade = def.id;
      card.setAttribute('aria-label', `${def.name}: ${def.desc}`);

      const icon = document.createElement('div');
      icon.className = 'shop-card-icon';
      icon.textContent = def.icon;

      const name = document.createElement('div');
      name.className = 'shop-card-name';

      const desc = document.createElement('div');
      desc.className = 'shop-card-desc';
      desc.textContent = def.desc;

      const barWrap = document.createElement('div');
      barWrap.className = 'shop-card-level-bar';
      const fill = document.createElement('div');
      fill.className = 'shop-card-level-fill';
      barWrap.appendChild(fill);

      const footer = document.createElement('div');
      footer.className = 'shop-card-footer';
      const cost = document.createElement('div');
      cost.className = 'shop-card-cost';
      const status = document.createElement('div');
      status.className = 'shop-card-status';
      footer.append(cost, status);

      card.append(icon, name, desc, barWrap, footer);
      card.addEventListener('click', () => this.onPurchase(def.id));

      grid.appendChild(card);
      this.cards.push({ root: card, name, cost, fill, status, def });
    }

    this.built = true;
  }

  /** Refresca textos y estados según el progreso actual. */
  sync() {
    if (!this.built) this.build();

    for (const card of this.cards) {
      const { def } = card;
          /*
     * Nivel de la NAVE ACTIVA, no global: las mejoras ahora son por nave.
     * `nivelesDe()` devuelve el mapa de la nave que el jugador tiene equipada.
     */
    const lvl = nivelesDe()[def.id] || 0;
      const maxed = isMaxed(def.id);
      const cost = upgradeCost(def.id);
      const affordable = STATE.coins >= cost;

      card.name.textContent = maxed ? `${def.name} · MÁX` : `${def.name} · Nv.${lvl}`;
      card.fill.style.width = `${(lvl / def.maxLevel) * 100}%`;

      if (maxed) {
        card.cost.textContent = '';
        card.status.textContent = '✔ MÁXIMO';
        card.root.classList.add('maxed');
        card.root.classList.remove('locked');
        card.root.disabled = true;
      } else {
        card.cost.textContent = `💰 ${formatNumber(cost)}`;
        card.cost.classList.toggle('cant-afford', !affordable);
        card.status.textContent = affordable ? 'Comprar' : `Faltan ${formatNumber(cost - STATE.coins)}`;
        card.root.classList.remove('maxed');
        card.root.classList.toggle('locked', !affordable);
        card.root.disabled = false;
      }
    }
  }

  /** Solo actualiza la moneda mostrada en las tarjetas (sin re-render). */
  refreshAffordability() {
    if (!this.built) return;
    for (const card of this.cards) {
      if (isMaxed(card.def.id)) continue;
      const cost = upgradeCost(card.def.id);
      const affordable = STATE.coins >= cost;
      card.cost.classList.toggle('cant-afford', !affordable);
      card.status.textContent = affordable ? 'Comprar' : `Faltan ${formatNumber(cost - STATE.coins)}`;
      card.root.classList.toggle('locked', !affordable);
    }
  }
}

