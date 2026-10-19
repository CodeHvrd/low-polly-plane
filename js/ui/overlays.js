/**
 * PAPERCRASH — ui/overlays.js
 * ============================================================
 * Coordinador de pantallas y del fundido.
 *
 * ── Las dos etapas del juego ──
 *
 *   STANDBY ──(clic / Enter / arrastrar)──▶ AIM ──(soltar)──▶ PLAYING
 *      ▲                                     │                  │
 *      └──────────(Esc: volver atrás)────────┘                  ▼
 *                                                            RESULT
 *                                                          (repetir →
 *                                                           STANDBY)
 *
 *   STANDBY : título, tienda y monedas a la vista. Cámara lateral.
 *   AIM     : modo lanzamiento. Cámara detrás del lanzador. Se apunta,
 *             se carga y se lanza desde ahí.
 *   PLAYING : vuelo. HUD; la pista de control desaparece.
 *   RESULT  : resultado sobre el HUD, con acceso directo a la tienda.
 *
 * Centralizar la visibilidad evita el problema clásico de estas UIs: dos
 * módulos distintos togglando la misma clase `hidden` y dejando el juego en un
 * estado imposible (por ejemplo HUD y resultado visibles a la vez, que es lo
 * que permitía el bug de reentrada).
 * ============================================================
 */
import { UI, show, hide } from './dom.js';
import { updateTerrainWindow } from '../world/terrainMesh.js';
import { setStagePalette } from '../world/environment.js';

export const Screen = {
  STANDBY: 'standby',
  AIM: 'aim',
  PLAYING: 'playing',
  RESULT: 'result',
};

export class Overlays {
  constructor() {
    /** @type {string} */
    this.current = Screen.STANDBY;
    this.faderTimer = null;
    /**
     * Si la pista de control está habilitada en la etapa actual.
     * En AIM se apaga: el jugador ya sabe qué hacer y el cartel tapa el avión
     * justo cuando hay que verlo.
     */
    this.hintEnabled = true;
  }

  /**
   * Cambia de etapa. Idempotente: llamar dos veces con el mismo valor no
   * vuelve a tocar el DOM (salvo que cambie el estado de la pista).
   * @param {string} screen
   */
  set(screen) {
    if (this.current === screen) {
      this._applyHint();
      return;
    }
    this.current = screen;

    // La pista se enciende sola al volver a una etapa donde tiene sentido; en
    // modo lanzamiento se apaga porque tapaba el avión y la línea punteada.
    this.hintEnabled = screen !== Screen.AIM;

    // Primero se oculta todo y después se muestra lo que corresponde: así
    // nunca hay dos capas visibles a la vez, ni siquiera un frame.
    hide(UI.idleOverlay);
    hide(UI.aimOverlay);
    hide(UI.hud);
    hide(UI.resultScreen);

    /*
     * ── La interfaz de FUERA del juego se apaga mientras se juega ──
     *
     * La tienda, el silenciador y el borrar-progreso son cosas de menú. Durante
     * el vuelo no se usan y en móvil se pisaban con el HUD: medido, el botón de
     * tienda quedaba debajo del cartel de propulsión.
     *
     * Se hace con una clase en el `body` y no ocultando cada nodo por separado:
     * así el CSS decide qué se esconde en cada etapa, y agregar un elemento nuevo
     * no obliga a tocar también este archivo.
     */
    document.body.classList.toggle('en-vuelo', screen === Screen.PLAYING || screen === Screen.RESULT);

    /*
     * ── El terreno vuelve a centrarse al salir del vuelo ──
     *
     * ── El bug que esto arregla ──
     * La ventana de terreno sólo se corría DURANTE el vuelo, siguiendo al avión.
     * Al volver al lobby la malla se quedaba donde terminó la run —a 3, 5 o 12 km
     * del lanzador— y el lobby mostraba el vacío: "no tiene piso ninguno de los
     * dos modos".
     *
     * Se recentra al entrar a cualquier pantalla que no sea de vuelo. El avión
     * vuelve al lanzador en esas transiciones, así que la ventana tiene que
     * volver con él.
     */
    if (screen === Screen.STANDBY || screen === Screen.AIM) {
      updateTerrainWindow(0, true);
      /*
       * ── La paleta vuelve a la del primer bioma ──
       *
       * `setStagePalette` sólo se llamaba al CAMBIAR de tramo, así que el color
       * del suelo y del cielo quedaba pegado al último bioma jugado. Volviendo al
       * lobby desde un bioma oscuro —CREPÚSCULO, CORDILLERA— el suelo quedaba a un
       * paso del color del fondo y el lobby se veía SIN PISO. Era intermitente
       * justamente porque dependía de dónde hubiera terminado la run anterior.
       */
      setStagePalette(0, 0);
    }

    switch (screen) {
      case Screen.AIM:
        // Pantalla limpia: solo el cartel de la nave activa.
        show(UI.aimOverlay);
        break;
      case Screen.PLAYING:
        show(UI.hud);
        break;
      case Screen.RESULT:
        show(UI.hud);
        show(UI.resultScreen);
        break;
      case Screen.STANDBY:
      default:
        show(UI.idleOverlay);
        break;
    }

    this._applyHint();
  }

  /** Muestra u oculta la pista de control según la etapa. */
  _applyHint() {
    const onHintScreen = this.current === Screen.STANDBY || this.current === Screen.AIM;
    if (this.hintEnabled && onHintScreen) show(UI.hintBlock);
    else hide(UI.hintBlock);
  }

  /** ¿La etapa actual admite apuntar? */
  get isAimable() {
    return this.current === Screen.STANDBY || this.current === Screen.AIM;
  }

  /** Muestra el resultado sobre el HUD (que queda de fondo, congelado). */
  showResult() {
    this.current = Screen.RESULT;
    hide(UI.idleOverlay);
    hide(UI.aimOverlay);
    hide(UI.hintBlock);
    show(UI.resultScreen);
  }

  /**
   * Destello rojo del impacto.
   * @param {number} strength 0..1
   */
  flash(strength = 1) {
    const node = UI.crashFlash;
    if (!node) return;
    node.style.transition = 'none';
    node.style.opacity = String(Math.min(1, 0.35 + strength * 0.5));
    // Forzar reflow para que el cambio de opacidad se aplique antes de
    // volver a animar; sin esto el navegador agrupa ambos cambios y no
    // se ve el destello.
    void node.offsetWidth;
    node.style.transition = 'opacity 260ms ease-out';
    node.style.opacity = '0';
  }

  /**
   * Fundido a negro y vuelta, para tapar el salto entre vuelos.
   * @param {() => void} midway  se ejecuta con la pantalla en negro
   */
  fade(midway = () => {}) {
    const node = UI.fader;
    if (!node) {
      midway();
      return;
    }
    if (this.faderTimer) clearTimeout(this.faderTimer);

    node.style.transition = 'opacity 180ms ease-in';
    // Solo durante el fundido el velo intercepta el ratón: así no se puede
    // empezar un gesto sobre una pantalla que está por desaparecer.
    node.style.pointerEvents = 'auto';
    node.style.opacity = '1';

    this.faderTimer = setTimeout(() => {
      midway();
      node.style.transition = 'opacity 260ms ease-out';
      node.style.opacity = '0';
      node.style.pointerEvents = 'none';
      this.faderTimer = null;
    }, 190);
  }

  /** Cancela un fundido en curso (evita que un temporizador viejo pise un reset nuevo). */
  cancelFade() {
    if (!this.faderTimer) return;
    clearTimeout(this.faderTimer);
    this.faderTimer = null;
    const node = UI.fader;
    if (node) {
      node.style.transition = 'opacity 150ms ease-out';
      node.style.opacity = '0';
      node.style.pointerEvents = 'none';
    }
  }
}
