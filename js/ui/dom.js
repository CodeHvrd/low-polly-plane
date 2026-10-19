/**
 * PAPERCRASH — ui/dom.js
 * ============================================================
 * Acceso centralizado al DOM.
 *
 * Motivo: si cada módulo hiciera `document.getElementById` por su cuenta,
 * un cambio de `id` en el HTML rompería el juego en varios archivos a la
 * vez y sin aviso. Acá todos los ids viven en un solo lugar, se resuelven
 * UNA vez y se validan al arrancar (`assertRequiredDom`).
 *
 * `el()` devuelve `null` en vez de lanzar, para que la UI pueda degradarse
 * (por ejemplo si falta un elemento opcional) sin tirar abajo el juego.
 * ============================================================
 */

/** @param {string} id @returns {HTMLElement|null} */
export const el = (id) => document.getElementById(id);

/** @param {string} id @returns {HTMLElement} */
/**
 * Igual que `must` pero devuelve null en vez de tirar.
 *
 * Se usa para elementos que la UI puede no tener según la versión o la pantalla.
 * Un `must` de más rompe el arranque entero por un botón que quizá ni se usa.
 */
function optional(id) {
  return document.getElementById(id);
}

function must(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`[ui] falta el elemento #${id} en index.html`);
  return node;
}

/**
 * Mapa de elementos requeridos. Se resuelve perezosamente para que este
 * módulo pueda importarse antes de que el DOM esté listo.
 */
let cache = null;

function resolve() {
  if (cache) return cache;
  cache = {
    // Overlays
    idleOverlay: must('idle-overlay'),
    aimOverlay: must('aim-overlay'),
    resultScreen: must('result-screen'),
    hud: must('hud'),

    // Tienda (debajo del contador de monedas)
    shopDock: must('shop-dock'),
    btnShop: must('btn-shop'),
    shopPanel: must('shop-panel'),
    shopCurrentPlane: must('shop-current-plane'),
    shopUpgrades: must('shop-upgrades'),
    modeBar: must('mode-bar'),
    modeButtons: must('mode-buttons'),
    shopHangar: must('shop-hangar'),
    tabShips: must('tab-ships'),
    tabUpgrades: must('tab-upgrades'),
    btnShopClose: must('btn-shop-close'),

    // Pista de control (compartida entre inicio y preparado)
    hintBlock: must('idle-hint-block'),

    // Aeronave activa, mostrada en el overlay de preparado
    aimPlaneIcon: must('aim-plane-icon'),
    aimPlaneName: must('aim-plane-name'),
    aimPlaneTag: must('aim-plane-tag'),
    btnBackStandby: must('btn-back-standby'),

    // Monedas
    globalCoinsVal: must('global-coins-val'),
    hudCoins: must('hud-coins'),
    valCoins: must('val-coins'),
    totalCoinsVal: must('total-coins-val'),

    // HUD de vuelo
    valDistance: must('val-distance'),
    valAltitude: must('val-altitude'),
    valSpeed: must('val-speed'),
    valWind: must('val-wind'),
    windArrow: must('wind-arrow'),
    // Propulsión y tramos
    thrustBadge: must('thrust-badge'),
    thrustCount: must('thrust-count'),
    stageBadge: must('stage-badge'),
    stageName: must('stage-name'),
    stageProgress: must('stage-progress'),
    glidePct: must('glide-pct'),
    glideFill: must('glide-fill'),

    // Feedback de apuntado
    slingFeedback: must('sling-feedback'),
    fbPitch: must('fb-pitch'),
    fbAzimuth: must('fb-azimuth'),
    fbPower: must('fb-power'),
    fbBar: must('fb-bar'),
    fbReach: must('fb-reach'),
    fbApex: must('fb-apex'),

    // Selector de aeronave (dentro del panel de tienda)
    aircraftCards: must('aircraft-selector-cards'),

    // Resultado
    resultTitle: must('result-title'),
    resDistance: must('res-distance'),
    resAltitude: must('res-altitude'),
    resSpeed: must('res-speed'),
    resTime: must('res-time'),
    resRings: must('res-rings'),
    resBoosters: must('res-boosters'),
    resCoinCount: must('res-coin-count'),
    resScore: optional('res-score'),
  resCoins: must('res-coins'),
    resRecord: must('res-record'),
    shopGrid: must('shop-grid'),
    btnOpenShop: optional('btn-open-shop'),
    btnAgain: must('btn-again'),

    // Varios
    crashFlash: must('crash-flash'),
    fader: must('fader'),
    btnMute: must('btn-mute'),
    btnResetSave: must('btn-reset-save'),
    bootError: must('boot-error'),
    bootErrorMsg: must('boot-error-msg'),

    // Canvas
    canvas: must('gameCanvas'),
  };
  return cache;
}

/** Proxy de conveniencia: `UI.resultScreen` en vez de `UI.get().resultScreen`. */
export const UI = new Proxy(
  {},
  {
    get(_t, prop) {
      return resolve()[prop];
    },
    has(_t, prop) {
      return prop in resolve();
    },
    ownKeys() {
      return Reflect.ownKeys(resolve());
    },
    getOwnPropertyDescriptor(_t, prop) {
      return { configurable: true, enumerable: true, value: resolve()[prop] };
    },
  },
);

/**
 * Verifica que estén todos los elementos con `data-required` del HTML.
 * Se llama una vez al arrancar para fallar rápido y con un mensaje claro.
 * @returns {string[]} lista de ids faltantes
 */
export function findMissingRequiredDom() {
  const missing = [];
  document.querySelectorAll('[data-required]').forEach((node) => {
    const id = node.id;
    if (!id) return;
    if (!document.getElementById(id)) missing.push(id);
  });
  return missing;
}

/** Muestra el cartel de error de arranque. */
export function showBootError(message, detail = '') {
  const box = document.getElementById('boot-error');
  const msg = document.getElementById('boot-error-msg');
  if (msg) msg.textContent = message;
  if (detail && msg) {
    const pre = document.createElement('pre');
    pre.className = 'boot-error-detail';
    pre.textContent = detail;
    msg.appendChild(pre);
  }
  box?.classList.remove('hidden');
}

export const show = (node) => node?.classList.remove('hidden');
export const hide = (node) => node?.classList.add('hidden');

/** Escribe texto solo si el elemento existe. */
export function setText(node, value) {
  if (node) node.textContent = String(value);
}
