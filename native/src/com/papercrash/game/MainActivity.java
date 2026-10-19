package com.papercrash.game;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

/**
 * PAPERCRASH — contenedor nativo.
 *
 * ── Por qué un WebView y no un motor nativo ──
 * El juego ya está escrito en WebGL y verificado en el navegador. Reescribirlo en
 * Java obligaría a duplicar física, mundo y render, y a mantener dos versiones del
 * mismo juego. Un WebView con los archivos empaquetados da el APK sin tocar el
 * juego.
 *
 * ── Offline de verdad ──
 * La página se carga desde `file:///android_asset/www/index.html`, o sea desde
 * DENTRO del APK. No hay red de por medio: el juego no pide permiso de INTERNET y
 * no lo necesita. Por eso funciona en modo avión.
 *
 * ── Detalles que no se pueden omitir ──
 * · `setAllowFileAccessFromFileURLs`: los módulos ES se importan entre archivos
 *   del propio APK; sin esto el navegador los bloquea por origen y la página queda
 *   en blanco.
 * · `setMediaPlaybackRequiresUserGesture(false)`: los efectos de sonido son
 *   disparos cortos que no nacen de un gesto del usuario.
 * · `LAYER_TYPE_HARDWARE`: sin capa por hardware el canvas WebGL no compone y va
 *   a una fracción de los fps.
 */
public class MainActivity extends Activity {

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Pantalla siempre encendida mientras se juega.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Pantalla completa inmersiva: sin barras el canvas tiene toda la altura.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        }
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);

        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);

        // Negro detrás del canvas: si tarda un frame en pintar, no se ve un
        // destello blanco al abrir.
        getWindow().getDecorView().setBackgroundColor(Color.BLACK);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        // Sin caché agresiva: los archivos son locales y siempre queremos los del
        // APK, no una copia vieja de una versión anterior.
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        // Los errores de JS se ven en logcat, sin esto no se diagnostica nada.
        WebView.setWebContentsDebuggingEnabled(true);

        // El cliente de navegación es una clase con nombre aparte: ver
        // GameWebViewClient, donde está explicado por qué `d8` no acepta una
        // clase anónima acá.
        webView.setWebViewClient(new GameWebViewClient());
        webView.setWebChromeClient(new WebChromeClient());

        setContentView(webView, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    /** Al volver del segundo plano, el bucle de juego se reactiva solo. */
    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    /**
     * El botón Atrás sale del juego.
     *
     * Sin esto Android lo usa para navegar el historial del WebView, que en una
     * app de una sola página no lleva a ningún lado y deja al jugador atrapado.
     */
    @Override
    public void onBackPressed() {
        moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
