/**
 * PAPERCRASH / FLY OR CRASH — core/i18n.js
 * ============================================================
 * Internacionalización ligera: ES (por defecto) | EN | BR.
 * ============================================================
 */

const LANG_KEY = 'papercrash.lang.v1';
export const SUPPORTED_LANGS = ['es', 'en', 'br'];

export const LANG_LABELS = {
  es: 'ES',
  en: 'EN',
  br: 'BR',
};

const DICT = {
  es: {
    endlessBtn: 'MODO SIN FIN',
    campaignBtn: 'MODO CAMPAÑA',
    missionsRanking: 'MISIONES / RANKING',
    awards: 'PREMIOS',
    options: 'OPCIONES',
    exit: 'SALIR',
    coinsBadge: 'MONEDAS',
    shop: 'TIENDA',
    shipsTab: '✈ NAVES',
    upgradesTab: '⚙️ MEJORAS',
    close: 'Cerrar',
    back: '← VOLVER',
    welcomePilot: 'Bienvenido piloto',
    enter: 'INGRESAR',
    playGuest: 'JUGAR COMO INVITADO',
    guestRankingAlert: 'Usuarios sin cuenta solo se visualizan en el ranking diario',
    endlessLockedTitle: 'Modo Sin Fin bloqueado',
    endlessLockedHint: 'Superá el Nivel 5 del Modo Campaña para desbloquearlo',
    missionsLockedTitle: 'Misiones bloqueadas',
    missionsLockedHint: 'Superá el Nivel 3 del Modo Campaña para desbloquearlas',
    rankingLockedTitle: 'Ranking bloqueado',
    rankingLockedHint: 'Superá el Nivel 5 del Modo Campaña para desbloquearlo',
    comingSoon: 'Próximamente',
    goToEndless: 'IR AL MODO SIN FIN',
    nextLevelBtn: 'SIGUIENTE NIVEL',
    missionsDrawerTitle: '🎯 MISIONES',
    storyPanelSub: 'Completá los niveles progresivos para dominar Fly or Crash',
    campaignShort: 'Campaña Nv.',
    shipFree: 'GRATIS',
    shipInUse: 'EN USO',
    shipEquip: 'EQUIPAR',
    shipBuy: 'ADQUIRIR',
    shipMissing: 'Faltan',
    signInTitle: 'Iniciar sesión',
    loginUserLbl: 'Usuario o correo',
    loginPassLbl: 'Contraseña',
    loginUserPh: 'Usuario o mail',
    loginPassPh: 'Contraseña',
    signInBtn: 'Iniciar sesión',
    googleContinue: 'Continuar con Google',
    createAccountLink: 'Crear una cuenta',
    backShort: '← Atrás',
    createTitle: 'Crear cuenta',
    regEmailPh: 'Correo electrónico',
    regUserPh: 'Usuario (3 a 24 caracteres, letras/números)',
    regPassPh: 'Contraseña (mín. 6 caracteres, letras y números)',
    keepGuestSave: 'Conservar mis monedas y récord actuales',
    createAccountBtn: 'Crear cuenta',
    googleCreate: 'Crear cuenta con Google',
    alreadyHaveAccount: 'Ya tengo cuenta',
    accountTitle: 'CUENTA DE PILOTO',
    save: 'GUARDAR',
    logout: 'CERRAR SESIÓN',
    switchLogin: 'INGRESAR O CREAR CUENTA',
    objMissionsTab: '🎯 OBJETIVOS Y MISIONES',
    rankingTab: '🏆 RANKING',
    periodDaily: 'DIARIO',
    periodWeekly: 'SEMANAL',
    periodMonthly: 'MENSUAL',
    periodAll: 'ALL TIMES',
    sounds: 'Sonidos',
    music: 'Música',
    cursorFollow: 'Joystick / Cursor',
    invertY: 'Eje vertical (Y)',
    invertYNormal: 'NORMAL',
    invertYInverted: 'INVERTIDO',
    orientation: 'Orientación',
    resetSave: 'Borrar progreso',
    forceUpdate: 'Forzar actualización',
    language: 'Idioma',
    retry: 'REINTENTAR',
    menu: 'MENÚ',
    pauseTitle: 'PAUSA',
    resume: 'CONTINUAR',
    exitMenu: 'SALIR AL MENÚ',
    hudDist: 'DISTANCIA',
    hudAlt: 'ALTITUD',
    hudSpeed: 'VELOCIDAD',
    hudWind: 'VIENTO LAT.',
    adDoubleLabel: 'DUPLICAR MONEDAS',
    adDoubleClaimed: '✓ ×2 RECLAMADO',
    adShopBtn: '+{n} 🪙 GRATIS',
    adShopHintReady: 'Mirá un anuncio breve para sumar monedas',
    adShopHintMissing: '¡Te faltan {n} 🪙! Mirá un anuncio (+{r})',
    adShopCooldown: 'Disponible en {time}',
    adShopDailyCap: 'Límite diario de recargas alcanzado',
    adNotReadyTitle: 'Anuncios listos para SDK',
    adNotReadyDesc: 'Conectá AdMob / portal web (o probá con ?adsPreview=1)',
  },
  en: {
    endlessBtn: 'ENDLESS MODE',
    campaignBtn: 'CAMPAIGN',
    missionsRanking: 'MISSIONS / RANKING',
    awards: 'AWARDS',
    options: 'OPTIONS',
    exit: 'EXIT',
    coinsBadge: 'COINS',
    shop: 'SHOP',
    shipsTab: '✈ AIRCRAFT',
    upgradesTab: '⚙️ UPGRADES',
    close: 'Close',
    back: '← BACK',
    welcomePilot: 'Welcome pilot',
    enter: 'SIGN IN',
    playGuest: 'PLAY AS GUEST',
    guestRankingAlert: 'Users without an account only appear on the daily ranking',
    endlessLockedTitle: 'Endless Mode locked',
    endlessLockedHint: 'Beat Campaign Level 5 to unlock it',
    missionsLockedTitle: 'Missions locked',
    missionsLockedHint: 'Beat Campaign Level 3 to unlock Missions',
    rankingLockedTitle: 'Leaderboard locked',
    rankingLockedHint: 'Beat Campaign Level 5 to unlock Leaderboard',
    comingSoon: 'Coming soon',
    goToEndless: 'GO TO ENDLESS MODE',
    nextLevelBtn: 'NEXT LEVEL',
    missionsDrawerTitle: '🎯 MISSIONS',
    storyPanelSub: 'Complete the progressive Campaign levels to master Fly or Crash',
    campaignShort: 'Campaign Lv.',
    shipFree: 'FREE',
    shipInUse: 'IN USE',
    shipEquip: 'EQUIP',
    shipBuy: 'BUY',
    shipMissing: 'Need',
    signInTitle: 'Sign in',
    loginUserLbl: 'Username or email',
    loginPassLbl: 'Password',
    loginUserPh: 'Username or email',
    loginPassPh: 'Password',
    signInBtn: 'Sign in',
    googleContinue: 'Continue with Google',
    createAccountLink: 'Create an account',
    backShort: '← Back',
    createTitle: 'Create account',
    regEmailPh: 'Email address',
    regUserPh: 'Username (3–24 chars, letters/numbers)',
    regPassPh: 'Password (min. 6 chars, letters & numbers)',
    keepGuestSave: 'Keep my current coins and record',
    createAccountBtn: 'Create account',
    googleCreate: 'Sign up with Google',
    alreadyHaveAccount: 'I have an account',
    accountTitle: 'PILOT ACCOUNT',
    save: 'SAVE',
    logout: 'SIGN OUT',
    switchLogin: 'SIGN IN OR CREATE ACCOUNT',
    objMissionsTab: '🎯 OBJECTIVES & MISSIONS',
    rankingTab: '🏆 LEADERBOARD',
    periodDaily: 'DAILY',
    periodWeekly: 'WEEKLY',
    periodMonthly: 'MONTHLY',
    periodAll: 'ALL TIME',
    sounds: 'Sound FX',
    music: 'Music',
    cursorFollow: 'Floating Stick / Cursor',
    invertY: 'Vertical axis (Y)',
    invertYNormal: 'NORMAL',
    invertYInverted: 'INVERTED',
    orientation: 'Orientation',
    resetSave: 'Reset progress',
    forceUpdate: 'Force update',
    language: 'Language',
    retry: 'RETRY',
    menu: 'MENU',
    pauseTitle: 'PAUSED',
    resume: 'RESUME',
    exitMenu: 'EXIT TO MENU',
    hudDist: 'DISTANCE',
    hudAlt: 'ALTITUDE',
    hudSpeed: 'SPEED',
    hudWind: 'CROSSWIND',
    adDoubleLabel: 'DOUBLE COINS',
    adDoubleClaimed: '✓ ×2 CLAIMED',
    adShopBtn: '+{n} 🪙 FREE',
    adShopHintReady: 'Watch a short ad for bonus coins',
    adShopHintMissing: 'Need {n} more 🪙! Watch an ad (+{r})',
    adShopCooldown: 'Available in {time}',
    adShopDailyCap: 'Daily bonus limit reached',
    adNotReadyTitle: 'Ad slots ready for SDK',
    adNotReadyDesc: 'Attach AdMob / web portal SDK (or test with ?adsPreview=1)',
  },
  br: {
    endlessBtn: 'MODO INFINITO',
    campaignBtn: 'MODO CAMPANHA',
    missionsRanking: 'MISSÕES / RANKING',
    awards: 'PRÊMIOS',
    options: 'OPÇÕES',
    exit: 'SAIR',
    coinsBadge: 'MOEDAS',
    shop: 'LOJA',
    shipsTab: '✈ AERONAVES',
    upgradesTab: '⚙️ MELHORIAS',
    close: 'Fechar',
    back: '← VOLTAR',
    welcomePilot: 'Bem-vindo piloto',
    enter: 'ENTRAR',
    playGuest: 'JOGAR COMO CONVIDADO',
    guestRankingAlert: 'Usuários sem conta aparecem apenas no ranking diário',
    endlessLockedTitle: 'Modo Infinito bloqueado',
    endlessLockedHint: 'Supere o Nível 5 do Modo Campanha para desbloquear',
    missionsLockedTitle: 'Missões bloqueadas',
    missionsLockedHint: 'Supere o Nível 3 do Modo Campanha para desbloquear',
    rankingLockedTitle: 'Ranking bloqueado',
    rankingLockedHint: 'Supere o Nível 5 do Modo Campanha para desbloquear',
    comingSoon: 'Em breve',
    goToEndless: 'IR AO MODO INFINITO',
    nextLevelBtn: 'PRÓXIMO NÍVEL',
    missionsDrawerTitle: '🎯 MISSÕES',
    storyPanelSub: 'Conclua os níveis progressivos para dominar Fly or Crash',
    campaignShort: 'Campanha Nv.',
    shipFree: 'GRÁTIS',
    shipInUse: 'EM USO',
    shipEquip: 'EQUIPAR',
    shipBuy: 'COMPRAR',
    shipMissing: 'Faltam',
    signInTitle: 'Entrar',
    loginUserLbl: 'Usuário ou e-mail',
    loginPassLbl: 'Senha',
    loginUserPh: 'Usuário ou e-mail',
    loginPassPh: 'Senha',
    signInBtn: 'Entrar',
    googleContinue: 'Continuar com o Google',
    createAccountLink: 'Criar uma conta',
    backShort: '← Voltar',
    createTitle: 'Criar conta',
    regEmailPh: 'E-mail',
    regUserPh: 'Usuário (3 a 24 caracteres, letras/números)',
    regPassPh: 'Senha (mín. 6 caracteres, letras e números)',
    keepGuestSave: 'Manter minhas moedas e recordes atuais',
    createAccountBtn: 'Criar conta',
    googleCreate: 'Criar conta com o Google',
    alreadyHaveAccount: 'Já tenho conta',
    accountTitle: 'CONTA DE PILOTO',
    save: 'SALVAR',
    logout: 'SAIR DA CONTA',
    switchLogin: 'ENTRAR OU CRIAR CONTA',
    objMissionsTab: '🎯 OBJETIVOS E MISSÕES',
    rankingTab: '🏆 RANKING',
    periodDaily: 'DIÁRIO',
    periodWeekly: 'SEMANAL',
    periodMonthly: 'MENSAL',
    periodAll: 'GERAL',
    sounds: 'Sons',
    music: 'Música',
    cursorFollow: 'Joystick / Cursor',
    invertY: 'Eixo vertical (Y)',
    invertYNormal: 'NORMAL',
    invertYInverted: 'INVERTIDO',
    orientation: 'Orientação',
    resetSave: 'Apagar progresso',
    forceUpdate: 'Forçar atualização',
    language: 'Idioma',
    retry: 'REPETIR',
    menu: 'MENU',
    pauseTitle: 'PAUSA',
    resume: 'CONTINUAR',
    exitMenu: 'SAIR PARA O MENU',
    hudDist: 'DISTÂNCIA',
    hudAlt: 'ALTITUDE',
    hudSpeed: 'VELOCIDADE',
    hudWind: 'VENTO LAT.',
    adDoubleLabel: 'DOBRAR MOEDAS',
    adDoubleClaimed: '✓ ×2 RESGATADO',
    adShopBtn: '+{n} 🪙 GRÁTIS',
    adShopHintReady: 'Assista a um anúncio curto para ganhar moedas',
    adShopHintMissing: 'Faltam {n} 🪙! Veja um anúncio (+{r})',
    adShopCooldown: 'Disponível em {time}',
    adShopDailyCap: 'Limite diário atingido',
    adNotReadyTitle: 'Anúncios prontos para SDK',
    adNotReadyDesc: 'Conecte o AdMob / portal web (ou teste com ?adsPreview=1)',
  },
};

let currentLang = loadStoredLang();

function loadStoredLang() {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
    }
  } catch { /* modo privado */ }
  return 'es';
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  currentLang = SUPPORTED_LANGS.includes(lang) ? lang : 'es';
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_KEY, currentLang);
  } catch { /* modo privado */ }
  if (typeof document !== 'undefined') applyDomTranslations();
  return currentLang;
}

export function cycleLang() {
  const idx = SUPPORTED_LANGS.indexOf(currentLang);
  const next = SUPPORTED_LANGS[(idx + 1) % SUPPORTED_LANGS.length];
  return setLang(next);
}

export function t(key) {
  return DICT[currentLang]?.[key] ?? DICT.es[key] ?? key;
}

function setTxt(sel, text) {
  const el = document.querySelector(sel);
  if (el) el.textContent = text;
}

function setPh(sel, text) {
  const el = document.querySelector(sel);
  if (el) el.placeholder = text;
}

/** Aplica el idioma actual sobre el DOM. */
export function applyDomTranslations() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = currentLang === 'br' ? 'pt-BR' : currentLang;

  setTxt('#btn-quick-lang', LANG_LABELS[currentLang]);
  setTxt('#btn-options-lang', LANG_LABELS[currentLang]);
  setTxt('#lbl-options-lang', t('language'));

  // Menú principal
  const btnNew = document.getElementById('btn-new-game');
  if (btnNew) {
    btnNew.textContent = btnNew.classList.contains('locked') ? `🔒 ${t('endlessBtn')}` : t('endlessBtn');
  }
  setTxt('#btn-story-mode', t('campaignBtn'));
  setTxt('#btn-awards', t('awards'));
  setTxt('#btn-options', t('options'));
  setTxt('#btn-exit', t('exit'));

  // Monedas y tienda
  setTxt('#global-coins-badge .coin-label', t('coinsBadge'));
  setTxt('#btn-shop .shop-btn-text strong', t('shop'));
  setTxt('#tab-ships', t('shipsTab'));
  setTxt('#tab-upgrades', t('upgradesTab'));
  setTxt('#btn-shop-close', t('close'));

  // Paneles secundarios
  setTxt('#story-panel h2', t('campaignBtn'));
  setTxt('#story-panel-sub', t('storyPanelSub'));
  setTxt('#options-panel h2', t('options'));
  setTxt('#btn-story-back', t('back'));
  setTxt('#btn-awards-back', t('back'));
  setTxt('#btn-options-back', t('back'));
  setTxt('#btn-account-back', t('back'));

  // Opciones
  setTxt('#lbl-options-mute', t('sounds'));
  setTxt('#lbl-options-music', t('music'));
  setTxt('#lbl-options-cursor', t('cursorFollow'));
  setTxt('#lbl-options-invert-y', t('invertY'));
  setTxt('#lbl-options-orientation', t('orientation'));
  setTxt('#lbl-options-reset', t('resetSave'));
  setTxt('#lbl-options-update', t('forceUpdate'));

  // Gate / Login / Registro / Cuenta
  setTxt('#auth-gate-view .auth-heading', t('welcomePilot'));
  setTxt('#btn-gate-login', t('enter'));
  setTxt('#btn-continue-guest', t('playGuest'));

  setTxt('#auth-login-view .auth-heading', t('signInTitle'));
  setTxt('label[for="inp-login-user"]', t('loginUserLbl'));
  setTxt('label[for="inp-login-pass"]', t('loginPassLbl'));
  setPh('#inp-login-user', t('loginUserPh'));
  setPh('#inp-login-pass', t('loginPassPh'));
  setTxt('#btn-login-submit', t('signInBtn'));
  setTxt('#btn-google-login span', t('googleContinue'));
  setTxt('#btn-to-register', t('createAccountLink'));
  setTxt('#btn-login-to-gate', t('backShort'));

  setTxt('#auth-register-view .auth-heading', t('createTitle'));
  setPh('#inp-reg-email', t('regEmailPh'));
  setPh('#inp-reg-user', t('regUserPh'));
  setPh('#inp-reg-pass', t('regPassPh'));
  setTxt('#lbl-link-guest span', t('keepGuestSave'));
  setTxt('#btn-register-submit', t('createAccountBtn'));
  setTxt('#btn-google-register span', t('googleCreate'));
  setTxt('#btn-to-login', t('alreadyHaveAccount'));
  setTxt('#btn-reg-to-gate', t('backShort'));

  setTxt('#auth-profile-view h2', t('accountTitle'));
  setTxt('#btn-save-pilot-name', t('save'));
  setTxt('#btn-auth-logout', t('logout'));
  setTxt('#btn-profile-switch-login', t('switchLogin'));

  // Pestañas Misiones / Ranking y períodos
  setTxt('#missions-drawer-title', t('missionsDrawerTitle'));
  setTxt('#ranking-drawer-title', t('rankingTab'));
  setTxt('#res-tab-obj', t('objMissionsTab'));
  setTxt('#res-tab-rank', t('rankingTab'));
  document.querySelectorAll('[data-period="daily"]').forEach((el) => { el.textContent = t('periodDaily'); });
  document.querySelectorAll('[data-period="weekly"]').forEach((el) => { el.textContent = t('periodWeekly'); });
  document.querySelectorAll('[data-period="monthly"]').forEach((el) => { el.textContent = t('periodMonthly'); });
  document.querySelectorAll('[data-period="all"]').forEach((el) => { el.textContent = t('periodAll'); });

  // Resultado y Pausa
  setTxt('#btn-again .act-label', t('retry'));
  setTxt('#btn-result-menu .act-label', t('menu'));
  setTxt('#btn-result-options .act-label', t('options'));
  setTxt('#pause-overlay h2', t('pauseTitle'));
  setTxt('#btn-pause-resume', t('resume'));
  setTxt('#btn-pause-options', t('options'));
  setTxt('#btn-pause-exit', t('exitMenu'));

  // HUD
  const hudBoxes = document.querySelectorAll('#hud-top .stat-label');
  if (hudBoxes[0]) hudBoxes[0].textContent = t('hudDist');
  if (hudBoxes[1]) hudBoxes[1].textContent = t('hudAlt');
  if (hudBoxes[2]) hudBoxes[2].textContent = t('hudSpeed');
  setTxt('#wind-indicator .stat-label', t('hudWind'));
}
