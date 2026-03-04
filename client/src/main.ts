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
import { generateRoomId, loadTheme } from "./ui";
import { initializeTranslations } from "./i18n";

let chatClient: ChatClient | undefined;
let currentRoomId: string = "";

document.addEventListener("DOMContentLoaded", () => {
  loadTheme();
  initializeTranslations();

  const toggleTheme = () => {
    const html = document.documentElement;
    const currentTheme = html.getAttribute("data-theme") || "light";
    const newTheme = currentTheme === "light" ? "dark" : "light";
    html.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
  };

  document.querySelectorAll<HTMLButtonElement>(".theme-toggle").forEach((button) => {
    button.addEventListener("click", toggleTheme);
  });

  // Landing page button (navegar a pantalla dedicada de chat)
  const landingStartBtn = document.querySelector<HTMLButtonElement>(".hero .btn-primary");
  if (landingStartBtn) {
    landingStartBtn.addEventListener("click", () => {
      window.location.href = "/chat.html";
    });
  }

  // Chat login screen
  const username = document.getElementById("username") as HTMLInputElement | null;
  const loginBtn = document.querySelector<HTMLButtonElement>("#loginScreen .btn-primary");

  if (!username || !loginBtn) {
    return;
  }

  const usernameInput = username;
  
  loginBtn.addEventListener("click", () => handleChatLogin());
  usernameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleChatLogin();
  });

  async function handleChatLogin() {
    let roomId = usernameInput.value.trim();

    if (!roomId) {
      roomId = generateRoomId();
      usernameInput.value = roomId;
    }

    currentRoomId = roomId;
    connectToChat(roomId);
  }

  async function connectToChat(roomId: string) {
    try {
      document.getElementById("loginScreen")!.classList.add("hidden");
      document.getElementById("chatContainer")!.classList.remove("hidden");

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const configuredWsUrl = (import.meta as any)?.env?.VITE_WS_URL as string | undefined;
      const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const serverUrl = configuredWsUrl
        ? configuredWsUrl
        : `${protocol}//${isLocalhost ? `${window.location.hostname}:8080` : window.location.host}`;

      console.log(`[+] Conectando a: ${serverUrl}`);

      const messageInput = document.getElementById("messageInput") as HTMLInputElement;
      const sendButton = document.querySelector("#chatContainer .icon-btn") as HTMLButtonElement;
      const messagesContainer = document.getElementById("messages")!;

      // Initially disable input
      messageInput.disabled = true;
      sendButton.disabled = true;

      chatClient = new ChatClient({
        onConnected: () => {
          console.log("[OK] Conectado al servidor");
          messagesContainer.textContent = "";
          const waitingMessage = document.createElement("div");
          waitingMessage.style.textAlign = "center";
          waitingMessage.style.opacity = "0.7";
          waitingMessage.textContent = "Esperando usuario...";
          messagesContainer.appendChild(waitingMessage);
        },
        onPeerJoined: () => {
          console.log("[OK] Usuario conectado - Chat listo");
          messagesContainer.textContent = "";

          const joinedMessage = document.createElement("div");
          joinedMessage.style.textAlign = "center";
          joinedMessage.style.opacity = "0.85";
          joinedMessage.style.fontSize = "0.9rem";
          joinedMessage.textContent = "✅ La otra persona se ha unido al chat.";
          messagesContainer.appendChild(joinedMessage);

          messageInput.disabled = false;
          sendButton.disabled = false;
          messageInput.focus();
        },
        onPeerDisconnected: () => {
          console.log("[!] Peer desconectado");
          messageInput.disabled = true;
          sendButton.disabled = true;
          messagesContainer.textContent = "";
          const disconnectedMessage = document.createElement("div");
          disconnectedMessage.style.textAlign = "center";
          disconnectedMessage.style.opacity = "0.7";
          disconnectedMessage.textContent = "El otro usuario se desconectó.";
          messagesContainer.appendChild(disconnectedMessage);
        },
        onMessageReceived: (text: string, timestamp: number) => {
          const msg = document.createElement("div");
          msg.classList.add("message", "other");
          msg.textContent = text;
          messagesContainer.appendChild(msg);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        },
        onTyping: (isTyping: boolean) => {
          const typingDiv = document.getElementById("typingIndicator");
          if (typingDiv) {
            typingDiv.textContent = isTyping ? "escribiendo..." : "";
          }
        },
        onError: (error: string) => {
          console.error("ERROR:", error);
          messagesContainer.textContent = "";
          const errorMessage = document.createElement("div");
          errorMessage.style.color = "red";
          errorMessage.textContent = `Error: ${error}`;
          messagesContainer.appendChild(errorMessage);
        },
        onDisconnected: () => {
          console.warn("Desconectado");
          messageInput.disabled = true;
          sendButton.disabled = true;
        },
      });

      await chatClient.connect(serverUrl, roomId);

      let typingTimeoutId: number | undefined;
      messageInput.addEventListener("input", () => {
        if (!chatClient) return;

        chatClient.sendTyping(true);
        if (typingTimeoutId) {
          window.clearTimeout(typingTimeoutId);
        }

        typingTimeoutId = window.setTimeout(() => {
          chatClient?.sendTyping(false);
        }, 800);
      });

      // Send message handler
      const sendMsg = () => {
        const text = messageInput.value.trim();
        if (!text || !chatClient) return;

        chatClient.sendMessage(text);

        const msg = document.createElement("div");
        msg.classList.add("message", "me");
        msg.textContent = text;
        messagesContainer.appendChild(msg);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        messageInput.value = "";
      };

      sendButton.addEventListener("click", sendMsg);
      messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMsg();
      });

      window.addEventListener("beforeunload", () => {
        if (chatClient) chatClient.disconnect();
      });

    } catch (err) {
      console.error("ERROR:", err);
      const errorContainer = document.getElementById("messages");
      if (errorContainer) {
        errorContainer.textContent = "";
        const errorMessage = document.createElement("div");
        errorMessage.style.color = "red";
        errorMessage.textContent = `Error: ${err}`;
        errorContainer.appendChild(errorMessage);
      }
    }
  }
});
