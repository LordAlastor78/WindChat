/**
 * UI Module - DOM manipulation y renderizado
 * 
 * Responsabilidades:
 * - Renderizar mensajes (sanitizado con textContent, no innerHTML)
 * - Mostrar indicadores de estado
 * - Event listeners para entrada
 * - Gestión de tema claro/oscuro
 */

export interface Message {
  text: string;
  isMe: boolean;
  timestamp: number;
}

export function initializeUI(onSendMessage: (text: string) => void) {
  const messageInput = document.getElementById("messageInput") as HTMLInputElement;
  const sendButton = document.getElementById("sendButton") as HTMLButtonElement;
  const messagesContainer = document.getElementById("messages") as HTMLElement;
  const typingIndicator = document.getElementById("typingIndicator") as HTMLElement;
  const themeToggle = document.getElementById("themeToggle") as HTMLButtonElement;

  // Validar elementos
  if (!messageInput || !sendButton || !messagesContainer) {
    console.error("❌ Elementos del DOM no encontrados");
    return { renderMessage: () => {} };
  }

  // Listener: enviar al presionar Enter
  messageInput.addEventListener("keypress", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      handleSend();
    }
  });

  // Listener: enviar al hacer click
  sendButton.addEventListener("click", handleSend);

  // Listener: indicador de escritura
  let typingTimeout: NodeJS.Timeout;
  messageInput.addEventListener("input", () => {
    // Implementar en chat.ts si es necesario
  });

  // Listener: tema
  if (themeToggle) {
    themeToggle.addEventListener("click", toggleTheme);
  }

  function handleSend() {
    const text = messageInput.value.trim();
    if (!text) return;

    onSendMessage(text);
    messageInput.value = "";
  }

  function renderMessage(message: Message) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${message.isMe ? "me" : "other"}`;

    // CRÍTICO: usar textContent, NO innerHTML
    // textContent previene XSS
    msgDiv.textContent = message.text;

    // Opcional: agregar timestamp
    const timeDiv = document.createElement("span");
    timeDiv.className = "timestamp";
    const time = new Date(message.timestamp).toLocaleTimeString();
    timeDiv.textContent = time;

    msgDiv.appendChild(timeDiv);
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function showTyping(isTyping: boolean) {
    if (typingIndicator) {
      typingIndicator.textContent = isTyping ? "Escribiendo..." : "";
      if (isTyping) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }
  }

  function showStatus(text: string) {
    const statusDiv = document.createElement("div");
    statusDiv.className = "status-message";
    statusDiv.textContent = text;
    messagesContainer.appendChild(statusDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function showError(error: string) {
    const errorDiv = document.createElement("div");
    errorDiv.className = "error-message";
    errorDiv.textContent = `❌ ${error}`;
    messagesContainer.appendChild(errorDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function clear() {
    messagesContainer.innerHTML = "";
  }

  return {
    renderMessage,
    showTyping,
    showStatus,
    showError,
    clear,
  };
}

function toggleTheme() {
  const html = document.documentElement;
  const currentTheme = html.getAttribute("data-theme") || "dark";
  const order = ["dark", "stellar", "light"] as const;
  const idx = order.indexOf(currentTheme as (typeof order)[number]);
  const newTheme = order[(idx + 1) % order.length];

  html.setAttribute("data-theme", newTheme);
  localStorage.setItem("theme", newTheme);

  console.log(`🌙 Tema cambiado a: ${newTheme}`);
}

// Cargar tema guardado al iniciar (por defecto: oscuro estelar)
export function loadTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
}

// Generar roomID aleatorio (128 bits en base64)
export function generateRoomId(): string {
  const bytes = new Uint8Array(16); // 128 bits
  crypto.getRandomValues(bytes);
  // FIX §4.6: bucle `for` seguro (solo 16 bytes, pero por consistencia).
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
    .substring(0, 22);
}

// Copiar al clipboard
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    console.log("✅ Copiado al clipboard");
  } catch (err) {
    console.error("❌ Error copiando:", err);
  }
}
