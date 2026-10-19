package com.papercrash.game;

import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Bloquea la navegación fuera del APK.
 *
 * ── Por qué es una clase con nombre y no una anónima ──
 * Con una clase anónima (`new WebViewClient() { ... }`) `d8` —la herramienta que
 * convierte el bytecode a DEX— fallaba con una NullPointerException interna al
 * procesar `MainActivity$1`. Con una clase con nombre compila sin problema.
 *
 * El bug es de la versión de d8 8.2.2-dev que viene con build-tools 34. La
 * solución no cuesta nada y evita depender de una versión puntual de la
 * herramienta.
 */
class GameWebViewClient extends WebViewClient {

    /**
     * Todo el juego vive adentro del APK (`file:///android_asset/...`).
     *
     * Cualquier otro esquema se rechaza: si un enlace intentara abrir una web, la
     * app quedaría mostrando una página externa sin barra de direcciones, de la
     * que no se puede volver.
     */
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return !url.startsWith("file://");
    }
}
