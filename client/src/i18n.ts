// Internationalization - Auto-detect browser language
type Lang = 'es' | 'en';

const translations: Record<Lang, Record<string, string>> = {
  es: {
    // Header
    headerInfo: 'Chat cifrado extremo a extremo',
    themeToggle: '🌙',
    
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
  },
  en: {
    // Header
    headerInfo: 'End-to-end encrypted chat',
    themeToggle: '🌙',
    
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
  },
};

/**
 * Detect browser language (es/en based on navigator.language)
 */
export function detectLanguage(): Lang {
  const browserLang = navigator.language.split('-')[0].toLowerCase();
  return (browserLang === 'es' ? 'es' : 'en') as Lang;
}

/**
 * Get translation for a key
 */
export function t(key: keyof typeof translations.es): string {
  const lang = detectLanguage();
  return translations[lang][key] || translations.en[key] || key;
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
  const loginTitle = document.querySelector('.login-screen h2');
  if (loginTitle) loginTitle.textContent = t('loginTitle');
  
  const loginSubtitle = document.querySelector('.login-screen p');
  if (loginSubtitle) loginSubtitle.textContent = t('loginSubtitle');
  
  const roomInput = document.getElementById('roomInputCreate') as HTMLInputElement;
  if (roomInput) roomInput.placeholder = t('roomInputPlaceholder');
  
  const createBtn = document.getElementById('createButton') as HTMLButtonElement;
  if (createBtn) createBtn.textContent = t('createButton');
  
  const messageInput = document.getElementById('messageInput') as HTMLInputElement;
  if (messageInput) messageInput.placeholder = t('messageInputPlaceholder');
  
  const themeToggle = document.getElementById('themeToggle') as HTMLButtonElement;
  if (themeToggle) themeToggle.textContent = t('themeToggle');
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
