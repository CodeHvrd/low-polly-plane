/**
 * PAPERCRASH / FLY OR CRASH — ads/adManager.js
 * ============================================================
 * Capa unificada de anuncios para Play Store (WebView/AdMob, Capacitor,
 * Cordova) y portales web (Poki, CrazyGames, Google H5 AdBreak o adaptador
 * personalizado).
 *
 * Responsabilidades:
 *   · Detectar automáticamente el SDK disponible en el entorno actual.
 *   · Pausar física y suspender audio/música de forma segura antes de cada ad,
 *     y restaurarlos siempre en un `finally` al cerrar o fallar.
 *   · Gestionar banners solo en pantallas seguras (STANDBY / RESULT).
 *   · Proveer un modo Preview interactivo (3 s) activable vía `?adsPreview=1`
 *     o en `localhost` para probar los flujos Rewarded/Intersticial sin SDK.
 * ============================================================
 */
import { suspendAudio, resumeAudio } from '../core/audio.js';
import { music } from '../core/music.js';
import { AD_PLACEMENTS, shouldShowBanner } from '../game/adPolicy.js';

const PREVIEW_STORAGE_KEY = 'papercrash.adsPreview';

function isPreviewEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('adsPreview') === '1') {
      window.localStorage?.setItem(PREVIEW_STORAGE_KEY, '1');
      return true;
    }
    if (q.get('adsPreview') === '0') {
      window.localStorage?.removeItem(PREVIEW_STORAGE_KEY);
      return false;
    }
    if (window.localStorage?.getItem(PREVIEW_STORAGE_KEY) === '1') return true;
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

/**
 * Resuelve el adaptador activo según el contenedor/portal donde corre el juego.
 * Orden de prioridad:
 *   1. Custom `window.FlyOrCrashAdAdapter`
 *   2. Bridge nativo Android APK `window.PaperCrashNativeAds` (AdMob en MainActivity)
 *   3. Capacitor AdMob (`window.Capacitor?.Plugins?.AdMob`)
 *   4. CrazyGames SDK (`window.CrazyGames?.SDK?.ad`)
 *   5. Poki SDK (`window.PokiSDK`)
 *   6. Google H5 Games (`window.adBreak`)
 *   7. Preview local/QA (`?adsPreview=1` o `localhost`)
 */
function detectProvider(previewFallback) {
  if (typeof window === 'undefined') return { name: 'none', adapter: null };

  if (window.FlyOrCrashAdAdapter) {
    return { name: 'custom', adapter: window.FlyOrCrashAdAdapter };
  }

  if (window.PaperCrashNativeAds) {
    const bridge = window.PaperCrashNativeAds;
    const callNative = (method, placement) => new Promise((resolve) => {
      const reqId = `ad_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const prevCb = window.__onNativeAdResult;
      const timer = setTimeout(() => resolve({ ok: false, rewarded: false, error: 'timeout' }), 45000);
      window.__onNativeAdResult = (id, payload) => {
        if (id !== reqId) {
          prevCb?.(id, payload);
          return;
        }
        clearTimeout(timer);
        window.__onNativeAdResult = prevCb;
        resolve(payload || { ok: false, rewarded: false });
      };
      try {
        bridge[method](reqId, placement);
      } catch (err) {
        clearTimeout(timer);
        window.__onNativeAdResult = prevCb;
        resolve({ ok: false, rewarded: false, error: err?.message || 'bridge_error' });
      }
    });
    return {
      name: 'android-native',
      adapter: {
        isRewardedReady: () => (bridge.isRewardedReady ? Boolean(bridge.isRewardedReady()) : true),
        isInterstitialReady: () => (bridge.isInterstitialReady ? Boolean(bridge.isInterstitialReady()) : true),
        showRewarded: (placement) => callNative('showRewarded', placement),
        showInterstitial: (placement) => callNative('showInterstitial', placement),
        showBanner: (pos, placement) => bridge.showBanner?.(pos, placement),
        hideBanner: () => bridge.hideBanner?.(),
      },
    };
  }

  if (window.Capacitor?.Plugins?.AdMob) {
    const cap = window.Capacitor.Plugins.AdMob;
    return {
      name: 'capacitor-admob',
      adapter: {
        isRewardedReady: () => true,
        isInterstitialReady: () => true,
        showRewarded: async () => {
          const res = await cap.showRewardVideoAd?.();
          return { ok: true, rewarded: Boolean(res?.amount ?? true) };
        },
        showInterstitial: async () => {
          await cap.showInterstitial?.();
          return { ok: true };
        },
        showBanner: (position) => cap.showBanner?.({ position }),
        hideBanner: () => cap.hideBanner?.(),
      },
    };
  }

  if (window.CrazyGames?.SDK?.ad) {
    const cg = window.CrazyGames.SDK.ad;
    return {
      name: 'crazygames',
      adapter: {
        isRewardedReady: () => true,
        isInterstitialReady: () => true,
        showRewarded: () => new Promise((resolve) => {
          cg.requestAd('rewarded', {
            adFinished: () => resolve({ ok: true, rewarded: true }),
            adError: () => resolve({ ok: false, rewarded: false, error: 'ad_error' }),
            adStarted: () => {},
          });
        }),
        showInterstitial: () => new Promise((resolve) => {
          cg.requestAd('midgame', {
            adFinished: () => resolve({ ok: true }),
            adError: () => resolve({ ok: false, error: 'ad_error' }),
            adStarted: () => {},
          });
        }),
      },
    };
  }

  if (window.PokiSDK) {
    const poki = window.PokiSDK;
    return {
      name: 'poki',
      adapter: {
        isRewardedReady: () => true,
        isInterstitialReady: () => true,
        showRewarded: async () => {
          const ok = await poki.rewardedBreak();
          return { ok: Boolean(ok), rewarded: Boolean(ok) };
        },
        showInterstitial: async () => {
          await poki.commercialBreak();
          return { ok: true };
        },
      },
    };
  }

  if (typeof window.adBreak === 'function') {
    return {
      name: 'google-h5',
      adapter: {
        isRewardedReady: () => true,
        isInterstitialReady: () => true,
        showRewarded: (placement) => new Promise((resolve) => {
          let granted = false;
          window.adBreak({
            type: 'reward',
            name: placement,
            beforeReward: (showAdFn) => showAdFn(),
            adDismissed: () => resolve({ ok: false, rewarded: false, error: 'dismissed' }),
            adViewed: () => { granted = true; },
            adBreakDone: () => resolve({ ok: granted, rewarded: granted }),
          });
        }),
        showInterstitial: (placement) => new Promise((resolve) => {
          window.adBreak({
            type: 'next',
            name: placement,
            adBreakDone: () => resolve({ ok: true }),
          });
        }),
      },
    };
  }

  if (previewFallback) {
    return {
      name: 'preview',
      adapter: {
        isRewardedReady: () => true,
        isInterstitialReady: () => true,
        showRewarded: (placement) => runPreviewAdOverlay('rewarded', placement),
        showInterstitial: (placement) => runPreviewAdOverlay('interstitial', placement),
      },
    };
  }

  return { name: 'none', adapter: null };
}

/** Simulador visual de 3 s cuando se prueba con `?adsPreview=1` o en `localhost`. */
function runPreviewAdOverlay(kind, placement) {
  if (typeof document === 'undefined') return Promise.resolve({ ok: false, rewarded: false });

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'ad-preview-backdrop';
    backdrop.setAttribute('data-ui-interactive', '');

    const card = document.createElement('div');
    card.className = 'ad-preview-card';

    const tag = document.createElement('div');
    tag.className = 'ad-preview-tag';
    tag.textContent = kind === 'rewarded' ? 'PREVIEW REWARDED AD' : 'PREVIEW INTERSTITIAL AD';

    const title = document.createElement('h3');
    title.className = 'ad-preview-title';
    title.textContent = kind === 'rewarded' ? 'Simulando anuncio con recompensa…' : 'Simulando pausa publicitaria…';

    const meta = document.createElement('p');
    meta.className = 'ad-preview-meta';
    meta.textContent = `Placement: ${placement}`;

    const countdown = document.createElement('div');
    countdown.className = 'ad-preview-timer';
    let left = kind === 'rewarded' ? 3 : 2;
    countdown.textContent = `${left} s`;

    const actions = document.createElement('div');
    actions.className = 'ad-preview-actions';

    const btnSkip = document.createElement('button');
    btnSkip.type = 'button';
    btnSkip.className = 'ad-preview-btn skip';
    btnSkip.textContent = kind === 'rewarded' ? 'Cancelar (sin premio)' : 'Cerrar';

    actions.appendChild(btnSkip);
    card.append(tag, title, meta, countdown, actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    let done = false;
    const finish = (ok, rewarded) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      backdrop.remove();
      resolve({ ok, rewarded });
    };

    btnSkip.addEventListener('click', (e) => {
      e.stopPropagation();
      finish(kind !== 'rewarded', false);
    });

    const timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        finish(true, kind === 'rewarded');
      } else {
        countdown.textContent = `${left} s`;
      }
    }, 1000);
  });
}

export class AdManager {
  /**
   * @param {{ onPauseForAd?: (active:boolean) => void }} [hooks]
   */
  constructor(hooks = {}) {
    this.onPauseForAd = hooks.onPauseForAd ?? null;
    this.inFlight = null;
    this.bannerVisible = false;
    this.previewEnabled = isPreviewEnabled();
    const detected = detectProvider(this.previewEnabled);
    this.providerName = detected.name;
    this.adapter = detected.adapter;
  }

  /** Reevalúa SDKs globales por si un script externo cargó después del arranque. */
  refreshProvider() {
    this.previewEnabled = isPreviewEnabled();
    const detected = detectProvider(this.previewEnabled);
    this.providerName = detected.name;
    this.adapter = detected.adapter;
  }

  getCapabilities() {
    this.refreshProvider();
    const hasAdapter = Boolean(this.adapter);
    return {
      providerName: this.providerName,
      isPreview: this.providerName === 'preview',
      rewardedReady: hasAdapter && (this.adapter.isRewardedReady?.() ?? true),
      interstitialReady: hasAdapter && (this.adapter.isInterstitialReady?.() ?? true),
      bannerSupported: Boolean(this.adapter?.showBanner && this.adapter?.hideBanner),
    };
  }

  async _runWithLifecycleLock(fn) {
    if (this.inFlight) return { ok: false, rewarded: false, error: 'busy' };
    this.refreshProvider();
    if (!this.adapter) return { ok: false, rewarded: false, error: 'no_sdk' };

    const task = (async () => {
      music.suspender();
      suspendAudio();
      this.onPauseForAd?.(true);
      try {
        return await fn(this.adapter);
      } catch (err) {
        return { ok: false, rewarded: false, error: err?.message || 'ad_failed' };
      } finally {
        this.onPauseForAd?.(false);
        music.reanudar();
        resumeAudio();
      }
    })();

    this.inFlight = task;
    try {
      return await task;
    } finally {
      this.inFlight = null;
    }
  }

  /** Ejecuta un anuncio Rewarded y devuelve `{ ok, rewarded, error }`. */
  showRewarded(placement = AD_PLACEMENTS.RESULT_DOUBLE_COINS) {
    return this._runWithLifecycleLock((adapter) => {
      if (!adapter.showRewarded) return { ok: false, rewarded: false, error: 'unsupported' };
      return adapter.showRewarded(placement);
    });
  }

  /** Ejecuta un intersticial en una transición entre partidas. */
  showInterstitial(placement = AD_PLACEMENTS.BETWEEN_RUNS_INTERSTITIAL) {
    return this._runWithLifecycleLock((adapter) => {
      if (!adapter.showInterstitial) return { ok: false, error: 'unsupported' };
      return adapter.showInterstitial(placement);
    });
  }

  /** Muestra u oculta el banner según la pantalla activa y el alto disponible. */
  syncBanner(screen, adsState = null) {
    this.refreshProvider();
    if (!this.adapter?.showBanner || !this.adapter?.hideBanner) return;
    const h = typeof window !== 'undefined' ? window.innerHeight : 800;
    const policy = shouldShowBanner(screen, h, adsState);
    if (policy.show && !this.bannerVisible) {
      this.bannerVisible = true;
      this.adapter.showBanner(policy.position, AD_PLACEMENTS.MENU_BANNER);
    } else if (!policy.show && this.bannerVisible) {
      this.bannerVisible = false;
      this.adapter.hideBanner();
    }
  }
}
