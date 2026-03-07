// Internationalization - Auto-detect browser language
export type Lang = 'es' | 'en';

const LANGUAGE_STORAGE_KEY = 'windchat_language';
let currentLang: Lang | null = null;

const translations: Record<Lang, Record<string, string>> = {
  es: {
    // Header
    headerInfo: 'Chat cifrado extremo a extremo',
    themeToggle: 'Tema',
    
    // Login Screen
    loginTitle: 'Conectarse a WindChat',
    loginSubtitle: 'Crea una nueva sala o únete a una existente',
    roomInputPlaceholder: 'Deja vacío para crear nueva sala',
    createButton: 'Crear / Conectar',
    
    // Room Info
    roomIdLabel: '🆔 RoomID:',
    copyButton: 'Copiar',
    roomCreated: '✅ Sala creada',
    
    // Chat Screen
    messageInputPlaceholder: 'Escribe un mensaje...',
    waitingForPeer: '⏳ Esperando al otro usuario...',
    connected: '✅ Conectado',
    peerConnected: '✅ Usuario conectado',
    peerDisconnected: '❌ Usuario desconectado',
    typingIndicator: '✏️ escribiendo...',
    
    // Status Messages
    connecting: '🔗 Conectando...',
    connectionFailed: '❌ Falló la conexión',
    encryptionReady: '🔐 Cifrado listo',
    sendError: '❌ Error al enviar',

    // Controls
    languageLabel: 'Idioma',
    languageEs: 'ES',
    languageEn: 'EN',
    chatLoginTitle: 'Conéctate de forma segura',
    displayNamePlaceholder: 'Tu nombre (opcional)',
    usernamePlaceholder: 'Room ID o crea uno...',
    loginStartButton: 'Comenzar ahora',
    replyingTo: 'Respondiendo: {text}',
    cancelReplyTitle: 'Cancelar respuesta',
    contextCopy: '📋 Copiar',
    contextReply: '↩️ Responder',
    contextReactLike: '👍 Reacción: 👍',
    contextReactHeart: '❤️ Reacción: ❤️',
    notifEnableTitle: 'Activar notificaciones',
    notifDisableTitle: 'Desactivar notificaciones',
    notifDenied: 'Notificaciones bloqueadas por el navegador',
    notifUnsupported: 'Este navegador no soporta notificaciones',
    soundEnableTitle: 'Activar sonidos',
    soundDisableTitle: 'Silenciar sonidos',
    audioPrompt: 'Toca en cualquier lugar para habilitar sonidos',
    statusConnected: 'Conectado',
    statusConnecting: 'Reconectando...',
    statusDisconnected: 'Desconectado',
    unreadMessagesIndicator: '↓ Nuevos mensajes ({n})',
    confirmClose: '¿Seguro que quieres salir? Se perderá la conexión.',

    // Time labels
    justNow: 'Ahora',
    minuteAgo: 'Hace 1 minuto',
    minutesAgo: 'Hace {n} minutos',
    hourAgo: 'Hace 1 hora',
    hoursAgo: 'Hace {n} horas',
    yesterday: 'Ayer',
    daysAgo: 'Hace {n} días',
  },
  en: {
    // Header
    headerInfo: 'End-to-end encrypted chat',
    themeToggle: 'Theme',
    
    // Login Screen
    loginTitle: 'Connect to WindChat',
    loginSubtitle: 'Create a new room or join an existing one',
    roomInputPlaceholder: 'Leave empty to create new room',
    createButton: 'Create / Connect',
    
    // Room Info
    roomIdLabel: '🆔 RoomID:',
    copyButton: 'Copy',
    roomCreated: '✅ Room created',
    
    // Chat Screen
    messageInputPlaceholder: 'Type a message...',
    waitingForPeer: '⏳ Waiting for other user...',
    connected: '✅ Connected',
    peerConnected: '✅ User connected',
    peerDisconnected: '❌ User disconnected',
    typingIndicator: '✏️ typing...',
    
    // Status Messages
    connecting: '🔗 Connecting...',
    connectionFailed: '❌ Connection failed',
    encryptionReady: '🔐 Encryption ready',
    sendError: '❌ Send failed',

    // Controls
    languageLabel: 'Language',
    languageEs: 'ES',
    languageEn: 'EN',
    chatLoginTitle: 'Connect securely',
    displayNamePlaceholder: 'Your name (optional)',
    usernamePlaceholder: 'Room ID or create one...',
    loginStartButton: 'Start now',
    replyingTo: 'Replying: {text}',
    cancelReplyTitle: 'Cancel reply',
    contextCopy: '📋 Copy',
    contextReply: '↩️ Reply',
    contextReactLike: '👍 React: 👍',
    contextReactHeart: '❤️ React: ❤️',
    notifEnableTitle: 'Enable notifications',
    notifDisableTitle: 'Disable notifications',
    notifDenied: 'Notifications are blocked by the browser',
    notifUnsupported: 'This browser does not support notifications',
    soundEnableTitle: 'Enable sounds',
    soundDisableTitle: 'Mute sounds',
    audioPrompt: 'Tap anywhere to enable sounds',
    statusConnected: 'Connected',
    statusConnecting: 'Reconnecting...',
    statusDisconnected: 'Disconnected',
    unreadMessagesIndicator: '↓ New messages ({n})',
    confirmClose: 'Are you sure you want to leave? The connection will be lost.',

    // Time labels
    justNow: 'Just now',
    minuteAgo: '1 minute ago',
    minutesAgo: '{n} minutes ago',
    hourAgo: '1 hour ago',
    hoursAgo: '{n} hours ago',
    yesterday: 'Yesterday',
    daysAgo: '{n} days ago',
  },
};

type TranslationKey = keyof typeof translations.es;

const isLang = (value: string | null): value is Lang => value === 'es' || value === 'en';

const detectBrowserLanguage = (): Lang => {
  const browserLang = navigator.language.split('-')[0].toLowerCase();
  return browserLang === 'es' ? 'es' : 'en';
};

const resolveInitialLanguage = (): Lang => {
  try {
    const savedLang = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLang(savedLang)) {
      return savedLang;
    }
  } catch {
    // Ignore localStorage access failures and fall back to browser language.
  }

  return detectBrowserLanguage();
};

/**
 * Detect browser language (es/en based on navigator.language)
 */
export function detectLanguage(): Lang {
  if (!currentLang) {
    currentLang = resolveInitialLanguage();
  }
  return currentLang;
}

/**
 * Get the active language selected by user or browser
 */
export function getLanguage(): Lang {
  return detectLanguage();
}

/**
 * Manually set language and refresh translated UI
 */
export function setLanguage(lang: Lang): void {
  currentLang = lang;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Ignore localStorage access failures.
  }

  initializeTranslations();
  document.dispatchEvent(new CustomEvent('windchat:languagechange', { detail: { lang } }));
}

/**
 * Locale (BCP-47) aligned with active language
 */
export function getLanguageLocale(): string {
  const lang = detectLanguage();
  return lang === 'es' ? 'es-ES' : 'en-US';
}

/**
 * Get translation for a key
 */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const lang = detectLanguage();
  let text = translations[lang][key] || translations.en[key] || key;

  if (params) {
    Object.entries(params).forEach(([paramKey, value]) => {
      text = text.split(`{${paramKey}}`).join(String(value));
    });
  }

  return text;
}

/**
 * Initialize all translations in the DOM
 */
export function initializeTranslations(): void {
  const lang = detectLanguage();
  
  // Set HTML lang attribute
  document.documentElement.lang = lang;
  
  // Update header info
  const headerInfo = document.getElementById('headerInfo');
  if (headerInfo) headerInfo.textContent = t('headerInfo');
  
  // Update login screen
  const loginTitle = document.getElementById('loginTitle');
  if (loginTitle) loginTitle.textContent = t('loginTitle');
  
  const loginSubtitle = document.getElementById('loginSubtitle');
  if (loginSubtitle) loginSubtitle.textContent = t('loginSubtitle');
  
  const roomInput = document.getElementById('roomInputCreate') as HTMLInputElement;
  if (roomInput) roomInput.placeholder = t('roomInputPlaceholder');
  
  const createBtn = document.getElementById('createButton') as HTMLButtonElement;
  if (createBtn) createBtn.textContent = t('createButton');
  
  // Generic data-i18n bindings for chat/main pages
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n as TranslationKey | undefined;
    if (!key || !(key in translations.es)) return;

    const attr = element.dataset.i18nAttr;
    const translated = t(key);

    if (attr === 'placeholder' && element instanceof HTMLInputElement) {
      element.placeholder = translated;
      return;
    }

    if (attr === 'title') {
      element.setAttribute('title', translated);
      return;
    }

    element.textContent = translated;
  });

  const messageInput = document.getElementById('messageInput') as HTMLInputElement;
  if (messageInput) messageInput.placeholder = t('messageInputPlaceholder');

  const langSelector = document.getElementById('langSelector') as HTMLSelectElement | null;
  if (langSelector) {
    langSelector.value = lang;
  }
}

/**
 * Get text for status/info messages (used in main.ts)
 */
export const i18n = {
  loginTitle: () => t('loginTitle'),
  loginSubtitle: () => t('loginSubtitle'),
  waitingForPeer: () => t('waitingForPeer'),
  connected: () => t('connected'),
  peerConnected: () => t('peerConnected'),
  peerDisconnected: () => t('peerDisconnected'),
  typingIndicator: () => t('typingIndicator'),
  connecting: () => t('connecting'),
  encryptionReady: () => t('encryptionReady'),
  roomIdLabel: () => t('roomIdLabel'),
  copyButton: () => t('copyButton'),
  roomCreated: () => t('roomCreated'),
};
