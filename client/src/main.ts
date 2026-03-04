/**
 * WindChat - Main Entry Point
 * 
 * Orquesta:
 * - Inicialización de UI
 * - Gestión de room ID
 * - Conexión WebSocket
 * - Render de mensajes
 * - Event listeners
 */

import ChatClient from "./websocket";
import { initializeUI, generateRoomId, copyToClipboard, loadTheme } from "./ui";
import { initializeTranslations, i18n } from "./i18n";

// ===== ESTADO GLOBAL =====
let chatClient: ChatClient | undefined;
let currentRoomId: string = "";

// ===== INICIALIZACIÓN =====
document.addEventListener("DOMContentLoaded", () => {
  // Inicializar idioma
  initializeTranslations();
  
  // Cargar tema
  loadTheme();

  // UI elements
  const loginScreen = document.getElementById("loginScreen")!;
  const chatContainer = document.getElementById("chatContainer")!;
  const createButton = document.getElementById("createButton")!;
  const roomInputCreate = document.getElementById(
    "roomInputCreate"
  ) as HTMLInputElement;
  const roomIdInfo = document.getElementById("roomIdInfo")!;
  const messageInput = document.getElementById(
    "messageInput"
  ) as HTMLInputElement;
  const sendButton = document.getElementById("sendButton") as HTMLButtonElement;
  const headerInfo = document.getElementById("headerInfo")!;

  // UI module
  const ui = initializeUI(handleSendMessage);

  // ===== LOGIN FLOW =====
  createButton.addEventListener("click", () => {
    handleConnection();
  });

  roomInputCreate.addEventListener("keypress", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      handleConnection();
    }
  });

  async function handleConnection() {
    let roomId = roomInputCreate.value.trim();

    // Si no hay roomId, generar uno nuevo
    if (!roomId) {
      roomId = generateRoomId();
      console.log(`📍 Nueva sala generada: ${roomId}`);
    }

    currentRoomId = roomId;

    // Mostrar roomId y opción de copiar
    roomIdInfo.innerHTML = `
      <p><strong>${i18n.roomIdLabel()}</strong></p>
      <p>${roomId}</p>
      <button class="copy-button">${i18n.copyButton()}</button>
    `;

    const copyBtn = roomIdInfo.querySelector(".copy-button")!;
    copyBtn.addEventListener("click", () => {
      copyToClipboard(`windchat.com/#room=${roomId}`);
      copyBtn.textContent = "✅ Copiado!";
      setTimeout(() => {
        copyBtn.textContent = i18n.copyButton();
      }, 2000);
    });

    // Conectar
    connectToChat(roomId);
  }

  async function connectToChat(roomId: string) {
    try {
      createButton.disabled = true;
      createButton.textContent = i18n.connecting();

      // Determinar URL del servidor
      // En desarrollo: ws://localhost:8080
      // En producción: wss://domain.com
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const serverUrl = `${protocol}//${window.location.host}`;

      console.log(`🔗 Conectando a: ${serverUrl}`);

      // Crear cliente
      chatClient = new ChatClient({
        onConnected: () => {
          console.log("✅ Conectado al servidor");
          ui.showStatus(`${i18n.connected()} ${i18n.waitingForPeer()}`);
        },
        onPeerJoined: () => {
          console.log("👥 Peer se unió");
          ui.showStatus(`${i18n.peerConnected()} ✨`);
          messageInput.disabled = false;
          sendButton.disabled = false;
          messageInput.focus();
        },
        onMessageReceived: (text: string, timestamp: number) => {
          ui.renderMessage({ text, isMe: false, timestamp });
        },
        onTyping: (isTyping: boolean) => {
          ui.showTyping(isTyping);
        },
        onError: (error: string) => {
          console.error("❌ Error:", error);
          ui.showError(error);
        },
        onDisconnected: () => {
          ui.showStatus("👋 Desconectado");
          messageInput.disabled = true;
          sendButton.disabled = true;
        },
      });

      // Conectar
      await chatClient.connect(serverUrl, roomId);

      // Mostrar chat
      loginScreen.classList.add("hidden");
      chatContainer.classList.remove("hidden");

      // Update header
      headerInfo.textContent = `Room: ${roomId.substring(0, 10)}...`;

      ui.showStatus(i18n.waitingForPeer());

      // Listener para desconectar
      window.addEventListener("beforeunload", () => {
        if (chatClient) {
          chatClient.disconnect();
        }
      });
    } catch (err) {
      console.error("❌ Error conectando:", err);
      ui.showError(
        err instanceof Error ? err.message : "Error conectando al servidor"
      );
      createButton.disabled = false;
      createButton.textContent = i18n.createButton();
    }
  }

  async function handleSendMessage(text: string) {
    if (!chatClient) return;

    try {
      // Enviar
      await chatClient.sendMessage(text);

      // Renderizar localmente (mostrar inmediatamente)
      ui.renderMessage({ text, isMe: true, timestamp: Date.now() });

      console.log("📤 Mensaje enviado");
    } catch (err) {
      console.error("❌ Error enviando:", err);
      ui.showError(err instanceof Error ? err.message : "Error enviando");
    }
  }

  // Permitir enviar con Enter
  messageInput.addEventListener("keypress", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && messageInput.value.trim()) {
      const text = messageInput.value.trim();
      messageInput.value = "";
      handleSendMessage(text);
    }
  });

  // Botón enviar
  sendButton.addEventListener("click", () => {
    const text = messageInput.value.trim();
    if (text) {
      messageInput.value = "";
      handleSendMessage(text);
    }
  });

  console.log("✅ WindChat inicializado");
  ui.showStatus("🔐 WindChat - Chat cifrado extremo a extremo");
});
