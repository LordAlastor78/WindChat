// Internationalization - Auto-detect browser language
export type Lang = 'es' | 'en';

const LANGUAGE_STORAGE_KEY = 'windchat_language';
let currentLang: Lang | null = null;

const translations: Record<Lang, Record<string, string>> = {
  es: {
    // Header
    headerInfo: 'Chat cifrado extremo a extremo',
    themeToggle: 'Tema',
    diagnoseButton: 'Diagnosticar',
    diagnoseButtonText: 'Diagnosticar',

    // Login Screen
    loginTitle: 'Conectarse a WindChat',
    loginSubtitle: 'Crea una nueva sala o únete a una existente',
    roomInputPlaceholder: 'Deja vacío para crear nueva sala',
    createButton: 'Crear / Conectar',

    // Room Info
    roomIdLabel: 'RoomID:',
    copyButton: 'Copiar',
    roomCreated: 'Sala creada',

    // Chat Screen
    messageInputPlaceholder: 'Escribe un mensaje...',
    waitingForPeer: 'Esperando al otro usuario...',
    connected: 'Conectado',
    peerConnected: 'Usuario conectado',
    peerJoinedMessage: 'La otra persona se ha unido al chat.',
    peerDisconnected: 'Usuario desconectado',
    peerDisconnectedMessage: 'El otro usuario se desconectó.',
    typingIndicator: 'escribiendo...',

    // Safety number (verificación anti-MITM)
    safetyTitle: 'Código de verificación',
    safetyHint: 'Comparad este código por voz o en persona. Si no coincide, alguien está interceptando la conversación.',
    safetyVerifyButton: 'Coincide, verificar',
    safetyVerified: 'Sesión verificada',
    safetyUnverified: 'Sin verificar',
    safetyShowTitle: 'Ver código de verificación',
    safetyMismatchWarning: 'Si el código NO coincide, cierra la sala inmediatamente.',

    // Status Messages
    connecting: 'Conectando...',
    connectionFailed: 'Falló la conexión',
    encryptionReady: 'Cifrado listo',
    sendError: 'Error al enviar',

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
    contextCopy: 'Copiar',
    contextReply: 'Responder',
    contextReact: 'Reaccionar',
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
    unreadMessagesIndicator: 'Nuevos mensajes ({n})',
    confirmClose: '¿Seguro que quieres salir? Se perderá la conexión.',
    landingSecurity: 'Seguridad',
    landingContact: 'Contacto',
    landingThemeToggle: 'Cambiar tema',
    landingHeroTitle: 'Comunicación segura en tiempo real',
    landingHeroDescription:
      'WindChat combina velocidad, cifrado avanzado y una experiencia cómoda para desarrolladores y equipos que priorizan la ciberseguridad.',
    landingStartNow: 'Comenzar ahora',
    landingPublicLinkLabel: 'Enlace público para compartir:',
    landingFeature1Title: 'Cifrado End-to-End',
    landingFeature1Description: 'Protección avanzada para cada mensaje enviado y recibido.',
    landingFeature2Title: 'Diseño cómodo',
    landingFeature2Description: 'Interfaz minimalista enfocada en productividad y confort visual.',
    landingFeature3Title: 'Optimizado para devs',
    landingFeature3Description: 'Tipografía técnica, experiencia fluida y enfoque moderno.',
    jumpToLatestMessageTitle: 'Ir al último mensaje',
    fileCancelTitle: 'Cancelar',
    attachFileTitle: 'Adjuntar archivo',
    reconnectingBanner: 'Reconectando... (intento {attempt}/{maxAttempts})',
    reconnectedWaiting: 'Reconectado. Esperando al otro usuario...',
    reconnectFailedTitle: 'Reconexión fallida.',
    reconnectFailedSubtitle: 'Por favor, recarga la página.',
    genericErrorPrefix: 'Error',
    messageLabel: 'Mensaje',
    messageUnavailable: 'mensaje original no disponible',
    userLabel: 'Usuario',
    youLabel: 'Tú',
    fileLabel: 'Archivo',

    // Time labels
    justNow: 'Ahora',
    minuteAgo: 'Hace 1 minuto',
    minutesAgo: 'Hace {n} minutos',
    hourAgo: 'Hace 1 hora',
    hoursAgo: 'Hace {n} horas',
    yesterday: 'Ayer',
    daysAgo: 'Hace {n} días',
    // App shell (sidebar, modales)
    newChat: 'Nuevo chat',
    chatsLabel: 'Chats',
    contactsLabel: 'Contactos',
    settingsLabel: 'Ajustes',
    newChatTitle: 'Nuevo chat',
    newChatHint: 'Crea una sala nueva y comparte el Room ID, o únete con uno existente.',
    createRoom: 'Crear sala nueva',
    orLabel: 'o',
    joinRoom: 'Unirse a sala',
    profileTitle: 'Perfil',
    profileName: 'Nombre',
    profileStatus: 'Estado',
    profileColor: 'Color de avatar',
    save: 'Guardar',
    cancel: 'Cancelar',
    contactsTitle: 'Contactos',
    addContact: 'Añadir contacto',
    noContacts: 'Aún no tienes contactos.',
    settingsTitle: 'Ajustes',
    themeLabel: 'Tema',
    themeDark: 'Oscuro',
    themeLight: 'Claro',
    themeStellar: 'Estelar',
    soundLabel: 'Sonidos',
    notifLabel: 'Notificaciones',
    syncSection: 'Sincronización',
    syncHint: 'Exporta tu perfil y contactos con un código. Úsalo en otro dispositivo para restaurarlos (offline, sin servidores).',
    genSync: 'Generar código',
    exportSync: 'Exportar',
    importSync: 'Importar',
    maintenanceSection: 'Mantenimiento',
    repairBtn: 'Reparar programa',
    repairDone: 'Programa reparado.',
    repairFailed: 'No se pudo reparar.',
    syncExported: 'Perfil y contactos exportados.',
    syncImported: 'Perfil y contactos importados.',
    syncBadCode: 'Código incorrecto o corrupto.',
  },
  en: {
    // Header
    headerInfo: 'End-to-end encrypted chat',
    themeToggle: 'Theme',
    diagnoseButton: 'Diagnose',
    diagnoseButtonText: 'Diagnose',

    // Login Screen
    loginTitle: 'Connect to WindChat',
    loginSubtitle: 'Create a new room or join an existing one',
    roomInputPlaceholder: 'Leave empty to create new room',
    createButton: 'Create / Connect',

    // Room Info
    roomIdLabel: 'RoomID:',
    copyButton: 'Copy',
    roomCreated: 'Room created',

    // Chat Screen
    messageInputPlaceholder: 'Type a message...',
    waitingForPeer: 'Waiting for other user...',
    connected: 'Connected',
    peerConnected: 'User connected',
    peerJoinedMessage: 'The other person has joined the chat.',
    peerDisconnected: 'User disconnected',
    peerDisconnectedMessage: 'The other user disconnected.',
    typingIndicator: 'typing...',

    // Safety number (anti-MITM verification)
    safetyTitle: 'Verification code',
    safetyHint: 'Compare this code out loud or in person. If it does not match, someone is intercepting the conversation.',
    safetyVerifyButton: 'It matches, verify',
    safetyVerified: 'Session verified',
    safetyUnverified: 'Unverified',
    safetyShowTitle: 'Show verification code',
    safetyMismatchWarning: 'If the code does NOT match, close the room immediately.',


    // Status Messages
    connecting: 'Connecting...',
    connectionFailed: 'Connection failed',
    encryptionReady: 'Encryption ready',
    sendError: 'Send failed',

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
    contextCopy: 'Copy',
    contextReply: 'Reply',
    contextReact: 'React',
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
    unreadMessagesIndicator: 'New messages ({n})',
    confirmClose: 'Are you sure you want to leave? The connection will be lost.',
    landingSecurity: 'Security',
    landingContact: 'Contact',
    landingThemeToggle: 'Toggle theme',
    landingHeroTitle: 'Secure communication in real time',
    landingHeroDescription:
      'WindChat combines speed, advanced encryption, and a smooth experience for developers and teams who prioritize cybersecurity.',
    landingStartNow: 'Start now',
    landingPublicLinkLabel: 'Public link to share:',
    landingFeature1Title: 'End-to-End Encryption',
    landingFeature1Description: 'Advanced protection for every sent and received message.',
    landingFeature2Title: 'Comfort-first design',
    landingFeature2Description: 'Minimal interface focused on productivity and visual comfort.',
    landingFeature3Title: 'Optimized for devs',
    landingFeature3Description: 'Technical typography, smooth UX, and a modern approach.',
    jumpToLatestMessageTitle: 'Jump to latest message',
    fileCancelTitle: 'Cancel',
    attachFileTitle: 'Attach file',
    reconnectingBanner: 'Reconnecting... (attempt {attempt}/{maxAttempts})',
    reconnectedWaiting: 'Reconnected. Waiting for the other user...',
    reconnectFailedTitle: 'Reconnection failed.',
    reconnectFailedSubtitle: 'Please reload the page.',
    genericErrorPrefix: 'Error',
    messageLabel: 'Message',
    messageUnavailable: 'original message not available',
    userLabel: 'User',
    youLabel: 'You',
    fileLabel: 'File',

    // Time labels
    justNow: 'Just now',
    minuteAgo: '1 minute ago',
    minutesAgo: '{n} minutes ago',
    hourAgo: '1 hour ago',
    hoursAgo: '{n} hours ago',
    yesterday: 'Yesterday',
    daysAgo: '{n} days ago',
    // App shell (sidebar, modals)
    newChat: 'New chat',
    chatsLabel: 'Chats',
    contactsLabel: 'Contacts',
    settingsLabel: 'Settings',
    newChatTitle: 'New chat',
    newChatHint: 'Create a new room and share the Room ID, or join an existing one.',
    createRoom: 'Create new room',
    orLabel: 'or',
    joinRoom: 'Join room',
    profileTitle: 'Profile',
    profileName: 'Name',
    profileStatus: 'Status',
    profileColor: 'Avatar color',
    save: 'Save',
    cancel: 'Cancel',
    contactsTitle: 'Contacts',
    addContact: 'Add contact',
    noContacts: 'You have no contacts yet.',
    settingsTitle: 'Settings',
    themeLabel: 'Theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    themeStellar: 'Stellar',
    soundLabel: 'Sounds',
    notifLabel: 'Notifications',
    syncSection: 'Sync',
    syncHint: 'Export your profile and contacts with a code. Use it on another device to restore them (offline, no servers).',
    genSync: 'Generate code',
    exportSync: 'Export',
    importSync: 'Import',
    maintenanceSection: 'Maintenance',
    repairBtn: 'Repair program',
    repairDone: 'Program repaired.',
    repairFailed: 'Could not repair.',
    syncExported: 'Profile and contacts exported.',
    syncImported: 'Profile and contacts imported.',
    syncBadCode: 'Wrong or corrupt code.',
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

  // Project default language is English unless user explicitly selects another.
  return 'en';
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
