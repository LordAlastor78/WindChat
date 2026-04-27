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
import NotificationManager from "./notifications";
import SoundManager from "./soundManager";
import FileManager from "./fileManager";
import { generateRoomId, loadTheme } from "./ui";
import { getLanguage, initializeTranslations, setLanguage, t } from "./i18n";
import { formatAbsoluteTimestamp, formatMessageTimestamp } from "./utils/time";
import type { MessagePayload } from "./protocol";

let chatClient: ChatClient | undefined;
let fileManager: FileManager | undefined;
let currentRoomId: string = "";
let currentDisplayName: string = "Anon";
let selectedFile: File | null = null; // Archivo seleccionado para enviar

class UnreadCounter {
  private count = 0;
  private readonly originalTitle = document.title;

  increment() {
    if (document.visibilityState === "visible") return;
    this.count += 1;
    this.updateTitle();
  }

  reset() {
    if (this.count === 0) return;
    this.count = 0;
    this.updateTitle();
  }

  private updateTitle() {
    document.title = this.count > 0 ? `(${this.count}) ${this.originalTitle}` : this.originalTitle;
  }
}

// Registrar Service Worker para PWA (antes de DOMContentLoaded)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        console.log('✅ Service Worker registrado:', registration.scope);
      })
      .catch((error) => {
        console.warn('⚠️ Failed to register Service Worker:', error);
      });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadTheme();
  initializeTranslations();

  const notificationManager = new NotificationManager();
  const soundManager = new SoundManager();
  const unreadCounter = new UnreadCounter();
  const connectionStatus = document.getElementById("connectionStatus") as HTMLDivElement | null;
  const connectionStatusText = document.getElementById("connectionStatusText") as HTMLSpanElement | null;
  const notificationBtn = document.getElementById("enableNotifications") as HTMLButtonElement | null;
  const soundBtn = document.getElementById("soundToggle") as HTMLButtonElement | null;
  const audioPrompt = document.getElementById("audioPrompt") as HTMLDivElement | null;
  let currentConnectionState: "connected" | "connecting" | "disconnected" = "disconnected";

  const updateConnectionStatus = (state: "connected" | "connecting" | "disconnected") => {
    currentConnectionState = state;
    if (!connectionStatus || !connectionStatusText) return;

    connectionStatus.classList.remove("connected", "connecting", "disconnected");
    connectionStatus.classList.add(state);

    if (state === "connected") {
      connectionStatusText.textContent = t("statusConnected");
      return;
    }

    if (state === "connecting") {
      connectionStatusText.textContent = t("statusConnecting");
      return;
    }

    connectionStatusText.textContent = t("statusDisconnected");
  };

  const updateNotificationButton = () => {
    if (!notificationBtn) return;
    const enabled = notificationManager.isEnabled();
    notificationBtn.textContent = enabled ? "🔔" : "🔕";
    notificationBtn.title = enabled ? t("notifDisableTitle") : t("notifEnableTitle");
  };

  const updateSoundButton = () => {
    if (!soundBtn) return;
    const enabled = soundManager.isEnabled();
    soundBtn.textContent = enabled ? "🔊" : "🔇";
    soundBtn.title = enabled ? t("soundDisableTitle") : t("soundEnableTitle");
  };

  notificationBtn?.addEventListener("click", async () => {
    if (notificationManager.isEnabled()) {
      notificationManager.disable();
      updateNotificationButton();
      return;
    }

    const result = await notificationManager.enable();
    if (result === "denied") {
      console.warn(t("notifDenied"));
    }
    if (result === "unsupported") {
      console.warn(t("notifUnsupported"));
    }

    updateNotificationButton();
  });

  soundBtn?.addEventListener("click", () => {
    soundManager.toggle();
    updateSoundButton();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      unreadCounter.reset();
    }
  });

  const initializeAudio = async () => {
    const ok = await soundManager.initialize();
    if (ok) {
      audioPrompt?.classList.remove("visible");
    }
  };

  document.body.addEventListener("pointerdown", () => {
    initializeAudio().catch((err) => {
      console.warn("Audio initialization failed", err);
    });
  }, { once: true });

  if (!soundManager.isInitialized()) {
    audioPrompt?.classList.add("visible");

    // Auto-hide the audio prompt after 8 seconds
    setTimeout(() => {
      audioPrompt?.classList.remove("visible");
    }, 8000);
  }

  document.addEventListener("windchat:languagechange", updateNotificationButton);
  document.addEventListener("windchat:languagechange", updateSoundButton);
  document.addEventListener("windchat:languagechange", () => {
    updateConnectionStatus(currentConnectionState);
  });
  updateNotificationButton();
  updateSoundButton();
  updateConnectionStatus("disconnected");

  const langSelector = document.getElementById("langSelector") as HTMLSelectElement | null;
  if (langSelector) {
    langSelector.value = getLanguage();
    langSelector.addEventListener("change", () => {
      const next = langSelector.value === "es" ? "es" : "en";
      setLanguage(next);
    });
  }

  const toggleTheme = () => {
    const html = document.documentElement;
    const currentTheme = html.getAttribute("data-theme") || "light";
    const newTheme = currentTheme === "light" ? "dark" : "light";
    html.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
  };

  const themeToggleButton = document.getElementById("themeToggle") as HTMLButtonElement | null;
  themeToggleButton?.addEventListener("click", toggleTheme);

  const configuredPublicUrl = (import.meta as any)?.env?.VITE_PUBLIC_URL as string | undefined;
  const publicLinkBox = document.getElementById("publicLinkBox");
  const publicLinkAnchor = document.getElementById("publicLinkAnchor") as HTMLAnchorElement | null;
  if (configuredPublicUrl && publicLinkBox && publicLinkAnchor) {
    publicLinkAnchor.href = configuredPublicUrl;
    publicLinkAnchor.textContent = configuredPublicUrl;
    publicLinkBox.classList.add("visible");
  }

  // Landing page button (navegar a pantalla dedicada de chat)
  const landingStartBtn = document.querySelector<HTMLButtonElement>(".hero .btn-primary");
  if (landingStartBtn) {
    landingStartBtn.addEventListener("click", () => {
      window.location.href = "/chat.html";
    });
  }

  // Chat login screen
  const username = document.getElementById("username") as HTMLInputElement | null;
  const displayNameInput = document.getElementById("displayName") as HTMLInputElement | null;
  const loginBtn = document.querySelector<HTMLButtonElement>("#loginScreen .btn-primary");

  if (!username || !loginBtn) {
    return;
  }

  const usernameInput = username;
  if (displayNameInput) {
    const savedName = localStorage.getItem("windchat_display_name");
    if (savedName) {
      displayNameInput.value = savedName;
      currentDisplayName = savedName;
    }
  }
  let isConnecting = false;

  loginBtn.addEventListener("click", () => handleChatLogin());
  usernameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleChatLogin();
    }
  });

  async function handleChatLogin() {
    if (isConnecting) {
      console.warn("[!] Connection is already in progress, please wait...");
      return;
    }

    let roomId = usernameInput.value.trim();

    if (!roomId) {
      roomId = generateRoomId();
      usernameInput.value = roomId;
    }

    currentRoomId = roomId;
    currentDisplayName = displayNameInput?.value.trim() || "Anon";
    localStorage.setItem("windchat_display_name", currentDisplayName);

    isConnecting = true;
    updateConnectionStatus("connecting");
    if (loginBtn) loginBtn.disabled = true;
    usernameInput.disabled = true;
    if (displayNameInput) displayNameInput.disabled = true;

    try {
      await connectToChat(roomId);
    } catch (err) {
      console.error("[ERROR] Connection failed:", err);
    } finally {
      // CRITICAL: Siempre resetear el flag, incluso si hubo error
      isConnecting = false;
      if (loginBtn) loginBtn.disabled = false;
      usernameInput.disabled = false;
      if (displayNameInput) displayNameInput.disabled = false;
    }
  }

  async function connectToChat(roomId: string) {
    try {
      const loginScreen = document.getElementById("loginScreen");
      const chatContainer = document.getElementById("chatContainer");
      const messagesContainer = document.getElementById("messages");
      const roomIdValue = document.getElementById("roomIdValue") as HTMLSpanElement | null;
      const copyRoomBtn = document.getElementById("copyRoomBtn") as HTMLButtonElement | null;
      const messageInput = document.getElementById("messageInput") as HTMLInputElement | null;
      const sendButton = document.querySelector("#chatContainer .icon-btn") as HTMLButtonElement | null;

      // Validar elementos críticos del DOM
      if (!loginScreen || !chatContainer || !messagesContainer || !messageInput || !sendButton) {
        throw new Error("Elementos DOM críticos no encontrados");
      }

      loginScreen.classList.add("hidden");
      chatContainer.classList.remove("hidden");

      // Mostrar Room ID actual y permitir copiar
      if (roomIdValue) {
        roomIdValue.textContent = roomId;
      }
      copyRoomBtn?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(roomId);
          copyRoomBtn.textContent = "✅";
          window.setTimeout(() => {
            copyRoomBtn.textContent = t("copyButton");
          }, 1200);
        } catch (err) {
          console.warn("Failed to copy Room ID", err);
        }
      });

      // Servidor híbrido: WebSocket en la misma URL
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const serverUrl = `${wsProtocol}//${window.location.host}`;

      console.log(`[+] Connecting to: ${serverUrl}`);
      const newMessagesIndicator = document.getElementById("newMessagesIndicator") as HTMLButtonElement | null;
      const replyBar = document.getElementById("replyBar") as HTMLDivElement | null;
      const replyText = document.getElementById("replyText") as HTMLSpanElement | null;
      const replyClose = document.getElementById("replyClose") as HTMLButtonElement | null;
      const contextMenu = document.getElementById("messageContextMenu") as HTMLDivElement | null;

      let replyTo: { id: string | null; text: string } | null = null;
      let selectedMessageText = "";
      let selectedMessageId: string | null = null;
      let timestampRefreshId: number | undefined;
      let unreadMessagesInView = 0;

      const isNearBottom = () => {
        const threshold = 56;
        const remaining =
          messagesContainer.scrollHeight -
          messagesContainer.scrollTop -
          messagesContainer.clientHeight;
        return remaining <= threshold;
      };

      const scrollToBottom = () => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      };

      const updateUnreadIndicator = () => {
        if (!newMessagesIndicator) return;

        if (unreadMessagesInView <= 0) {
          newMessagesIndicator.classList.remove("visible");
          newMessagesIndicator.textContent = "";
          return;
        }

        newMessagesIndicator.textContent = t("unreadMessagesIndicator", {
          n: unreadMessagesInView,
        });
        newMessagesIndicator.classList.add("visible");
      };

      const resetUnreadIndicator = () => {
        if (unreadMessagesInView === 0) return;
        unreadMessagesInView = 0;
        updateUnreadIndicator();
      };

      messagesContainer.addEventListener("scroll", () => {
        if (isNearBottom()) {
          resetUnreadIndicator();
        }
      });

      newMessagesIndicator?.addEventListener("click", () => {
        scrollToBottom();
        resetUnreadIndicator();
      });

      const updateVisibleTimestamps = () => {
        const now = Date.now();
        const elements = messagesContainer.querySelectorAll<HTMLElement>(
          ".message-timestamp[data-timestamp]"
        );

        elements.forEach((element) => {
          const rawValue = element.getAttribute("data-timestamp");
          if (!rawValue) return;

          const timestamp = Number.parseInt(rawValue, 10);
          if (!Number.isFinite(timestamp)) return;

          element.textContent = formatMessageTimestamp(timestamp, now);
        });
      };

      const startTimestampRefresh = () => {
        if (timestampRefreshId) {
          window.clearInterval(timestampRefreshId);
        }

        updateVisibleTimestamps();
        timestampRefreshId = window.setInterval(updateVisibleTimestamps, 60000);
      };

      const stopTimestampRefresh = () => {
        if (!timestampRefreshId) return;
        window.clearInterval(timestampRefreshId);
        timestampRefreshId = undefined;
      };

      const setReply = (value: { id: string | null; text: string } | null) => {
        replyTo = value;
        if (!replyBar || !replyText) return;

        if (!value) {
          replyBar.classList.remove("visible");
          replyText.textContent = "";
          return;
        }

        const preview = value.text.length > 90 ? `${value.text.slice(0, 87)}...` : value.text;
        replyText.textContent = t("replyingTo", { text: preview });
        replyBar.classList.add("visible");
      };

      const getReplyMeta = (replyToId?: string): { sender: string; text: string } | null => {
        if (!replyToId) return null;

        const target = messagesContainer.querySelector(
          `[data-message-id="${replyToId}"]`
        ) as HTMLDivElement | null;

        if (!target) {
          return { sender: t("messageLabel"), text: t("messageUnavailable") };
        }

        const sourceText = target.getAttribute("data-message-text") || t("messageLabel");
        const sourceSender = target.getAttribute("data-message-sender") || t("userLabel");
        return { sender: sourceSender, text: sourceText };
      };

      const buildMessageElement = (
        displayName: string,
        text: string,
        options: { side: "me" | "other"; id?: string; replyToId?: string; timestamp?: number }
      ): HTMLDivElement => {
        const msg = document.createElement("div");
        msg.classList.add("message", options.side);
        const messageTimestamp = options.timestamp ?? Date.now();

        const sender = document.createElement("span");
        sender.className = "message-sender";
        sender.textContent = displayName;
        msg.appendChild(sender);

        const replyMeta = getReplyMeta(options.replyToId);
        if (replyMeta) {
          const replyPreview = document.createElement("div");
          replyPreview.className = "reply-preview";

          const replySender = document.createElement("span");
          replySender.className = "reply-sender";
          replySender.textContent = replyMeta.sender;

          const replyTextEl = document.createElement("span");
          replyTextEl.className = "reply-text";
          const preview = replyMeta.text.length > 60
            ? `${replyMeta.text.slice(0, 57)}...`
            : replyMeta.text;
          replyTextEl.textContent = preview;

          replyPreview.appendChild(replySender);
          replyPreview.appendChild(replyTextEl);
          msg.appendChild(replyPreview);
        }

        const textEl = document.createElement("span");
        textEl.className = "message-text";
        textEl.textContent = text;
        msg.appendChild(textEl);

        const meta = document.createElement("div");
        meta.className = "message-meta";

        const timestampEl = document.createElement("span");
        timestampEl.className = "message-timestamp";
        timestampEl.setAttribute("data-timestamp", String(messageTimestamp));
        timestampEl.textContent = formatMessageTimestamp(messageTimestamp);
        timestampEl.title = formatAbsoluteTimestamp(messageTimestamp);

        meta.appendChild(timestampEl);
        msg.appendChild(meta);

        if (options.id) {
          msg.setAttribute("data-message-id", options.id);
        }
        msg.setAttribute("data-message-text", text);
        msg.setAttribute("data-message-sender", displayName);

        return msg;
      };

      const hideContextMenu = () => {
        contextMenu?.classList.remove("visible");
        selectedMessageId = null;
      };

      const showContextMenu = (
        x: number,
        y: number,
        text: string,
        messageId: string | null
      ) => {
        if (!contextMenu) return;
        selectedMessageText = text;
        selectedMessageId = messageId;
        contextMenu.style.left = `${x}px`;
        contextMenu.style.top = `${y}px`;
        contextMenu.classList.add("visible");
      };

      const attachMessageInteractions = (el: HTMLDivElement, text: string) => {
        el.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          const targetId = el.getAttribute("data-message-id");
          showContextMenu(event.clientX, event.clientY, text, targetId);
        });

        let longPressTimeout: number | undefined;
        el.addEventListener("touchstart", (event) => {
          const touch = event.touches[0];
          longPressTimeout = window.setTimeout(() => {
            const targetId = el.getAttribute("data-message-id");
            showContextMenu(touch.clientX, touch.clientY, text, targetId);
          }, 500);
        }, { passive: true });

        ["touchend", "touchcancel", "touchmove"].forEach((eventName) => {
          el.addEventListener(eventName, () => {
            if (longPressTimeout) {
              window.clearTimeout(longPressTimeout);
            }
          });
        });
      };

      // Initially disable input
      messageInput.disabled = true;
      sendButton.disabled = true;

      // Banner de reconexión
      let reconnectBanner: HTMLDivElement | null = null;

      const showReconnectBanner = (attempt: number, maxAttempts: number) => {
        if (!reconnectBanner) {
          reconnectBanner = document.createElement('div');
          reconnectBanner.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #f59e0b, #d97706);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            font-weight: 500;
            animation: slideDown 0.3s ease;
          `;
          document.body.appendChild(reconnectBanner);
        }
        reconnectBanner.innerHTML = t("reconnectingBanner", { attempt, maxAttempts });
      };

      const hideReconnectBanner = () => {
        if (reconnectBanner) {
          reconnectBanner.style.animation = 'slideUp 0.3s ease';
          setTimeout(() => {
            reconnectBanner?.remove();
            reconnectBanner = null;
          }, 300);
        }
      };

      chatClient = new ChatClient({
        onConnected: () => {
          console.log("[OK] Connected to server");
          updateConnectionStatus("connected");
          hideReconnectBanner();
          resetUnreadIndicator();
          messagesContainer.textContent = "";
          const waitingMessage = document.createElement("div");
          waitingMessage.style.textAlign = "center";
          waitingMessage.style.opacity = "0.7";
          waitingMessage.textContent = t("waitingForPeer");
          messagesContainer.appendChild(waitingMessage);
        },
        onPeerJoined: () => {
          console.log("[OK] User connected - Chat ready");
          updateConnectionStatus("connected");
          resetUnreadIndicator();
          messagesContainer.textContent = "";

          const joinedMessage = document.createElement("div");
          joinedMessage.style.textAlign = "center";
          joinedMessage.style.opacity = "0.85";
          joinedMessage.style.fontSize = "0.9rem";
          joinedMessage.textContent = t("peerJoinedMessage");
          messagesContainer.appendChild(joinedMessage);

          messageInput.disabled = false;
          sendButton.disabled = false;
          messageInput.focus();
        },
        onPeerDisconnected: () => {
          console.log("[!] Peer disconnected");
          updateConnectionStatus("disconnected");
          resetUnreadIndicator();
          messageInput.disabled = true;
          sendButton.disabled = true;
          messagesContainer.textContent = "";
          const disconnectedMessage = document.createElement("div");
          disconnectedMessage.style.textAlign = "center";
          disconnectedMessage.style.opacity = "0.7";
          disconnectedMessage.textContent = t("peerDisconnectedMessage");
          messagesContainer.appendChild(disconnectedMessage);
        },
        onMessageReceived: (payload: MessagePayload) => {
          if (payload.type === "reaction") {
            const targetId = payload.reactionToId;
            if (targetId) {
              const targetMsg = messagesContainer.querySelector(
                `[data-message-id="${targetId}"]`
              ) as HTMLDivElement | null;

              if (targetMsg) {
                const current = targetMsg.getAttribute("data-reactions") || "";
                const next = `${current} ${payload.text}`.trim();
                targetMsg.setAttribute("data-reactions", next);

                let reactionsEl = targetMsg.querySelector(".message-reactions") as HTMLDivElement | null;
                if (!reactionsEl) {
                  reactionsEl = document.createElement("div");
                  reactionsEl.className = "message-reactions";
                  reactionsEl.style.fontSize = "0.8rem";
                  reactionsEl.style.opacity = "0.9";
                  reactionsEl.style.marginTop = "0.35rem";
                  targetMsg.appendChild(reactionsEl);
                }
                reactionsEl.textContent = next;
              }
            }
            return;
          }

          const displayName = payload.displayName || "Peer";
          const shouldAutoScroll = isNearBottom();
          const msg = buildMessageElement(displayName, payload.text, {
            side: "other",
            id: payload.id,
            replyToId: payload.replyToId,
            timestamp: payload.timestamp,
          });
          attachMessageInteractions(msg, payload.text);
          messagesContainer.appendChild(msg);

          if (shouldAutoScroll) {
            scrollToBottom();
            resetUnreadIndicator();
          } else {
            unreadMessagesInView += 1;
            updateUnreadIndicator();
          }

          unreadCounter.increment();
          notificationManager.showMessageNotification(displayName, payload.text);
          soundManager.playReceiveSound();
        },
        onTyping: (isTyping: boolean) => {
          const typingDiv = document.getElementById("typingIndicator");
          if (typingDiv) {
            typingDiv.textContent = isTyping ? t("typingIndicator") : "";
          }
        },
        onError: (error: string) => {
          console.error("ERROR:", error);
          resetUnreadIndicator();
          messagesContainer.textContent = "";
          const errorMessage = document.createElement("div");
          errorMessage.style.color = "red";
          errorMessage.textContent = `${t("genericErrorPrefix")}: ${error}`;
          messagesContainer.appendChild(errorMessage);
        },
        onDisconnected: () => {
          console.warn("Disconnected");
          updateConnectionStatus("disconnected");
          messageInput.disabled = true;
          sendButton.disabled = true;
        },
        onReconnecting: (attempt: number, maxAttempts: number) => {
          console.log(`[RECONNECTING] Attempt ${attempt}/${maxAttempts}`);
          updateConnectionStatus("connecting");
          showReconnectBanner(attempt, maxAttempts);
          messageInput.disabled = true;
          sendButton.disabled = true;
        },
        onReconnected: () => {
          console.log("[✅] Reconnected successfully");
          updateConnectionStatus("connected");
          hideReconnectBanner();
          resetUnreadIndicator();

          const reconnectedMessage = document.createElement("div");
          reconnectedMessage.style.textAlign = "center";
          reconnectedMessage.style.opacity = "0.85";
          reconnectedMessage.style.fontSize = "0.9rem";
          reconnectedMessage.style.color = "#10b981";
          reconnectedMessage.textContent = t("reconnectedWaiting");
          messagesContainer.appendChild(reconnectedMessage);
        },
        onReconnectFailed: () => {
          console.error("[❌] Reconnection failed");
          updateConnectionStatus("disconnected");
          hideReconnectBanner();
          resetUnreadIndicator();

          messagesContainer.textContent = "";
          const failedMessage = document.createElement("div");
          failedMessage.style.textAlign = "center";
          failedMessage.style.color = "#ef4444";
          failedMessage.style.fontSize = "0.95rem";
          failedMessage.innerHTML = `
            ${t("reconnectFailedTitle")}<br>
            <small style="opacity: 0.8;">${t("reconnectFailedSubtitle")}</small>
          `;
          messagesContainer.appendChild(failedMessage);

          messageInput.disabled = true;
          sendButton.disabled = true;
        },
      });

      startTimestampRefresh();
      const handleLanguageChanged = () => {
        updateVisibleTimestamps();
        updateUnreadIndicator();
        if (replyTo) {
          setReply(replyTo);
        }
      };
      document.addEventListener("windchat:languagechange", handleLanguageChanged);

      chatClient.setDisplayName(currentDisplayName);
      await chatClient.connect(serverUrl, roomId);

      if (replyClose) {
        replyClose.addEventListener("click", () => setReply(null));
      }

      document.addEventListener("click", (event) => {
        if (!contextMenu) return;
        const target = event.target as HTMLElement;
        if (!contextMenu.contains(target)) {
          hideContextMenu();
        }
      });

      contextMenu?.addEventListener("click", async (event) => {
        const target = event.target as HTMLElement;
        const action = target.getAttribute("data-action");
        if (!action) return;

        if (action === "copy") {
          try {
            await navigator.clipboard.writeText(selectedMessageText);
          } catch (err) {
            console.warn("Failed to copy message", err);
          }
        }

        if (action === "reply") {
          setReply({ id: selectedMessageId, text: selectedMessageText });
          messageInput.focus();
        }

        if (action === "react-like") {
          if (chatClient && selectedMessageId) {
            chatClient.sendReaction("👍", selectedMessageId).catch((err) => {
              console.error("Failed to send reaction", err);
            });
          }
        }

        if (action === "react-heart") {
          if (chatClient && selectedMessageId) {
            chatClient.sendReaction("❤️", selectedMessageId).catch((err) => {
              console.error("Failed to send reaction", err);
            });
          }
        }

        hideContextMenu();
      });

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
      const sendMsg = async () => {
        const text = messageInput.value.trim();
        if (!text || !chatClient) return;

        const outgoingText = text;
        const messageTimestamp = Date.now();

        const localMessageId = crypto.randomUUID();

        try {
          await chatClient.sendMessage(
            outgoingText,
            localMessageId,
            replyTo?.id || undefined
          );
        } catch (err) {
          console.error("Failed to send message", err);
          return;
        }

        const msg = buildMessageElement(currentDisplayName, outgoingText, {
          side: "me",
          id: localMessageId,
          replyToId: replyTo?.id || undefined,
          timestamp: messageTimestamp,
        });
        attachMessageInteractions(msg, outgoingText);
        messagesContainer.appendChild(msg);
        scrollToBottom();
        resetUnreadIndicator();

        soundManager.playSendSound();

        messageInput.value = "";
        setReply(null);
      };

      sendButton.addEventListener("click", () => {
        sendMsg().catch((err) => {
          console.error("Error inesperado al enviar", err);
        });
      });
      messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          sendMsg().catch((err) => {
            console.error("Error inesperado al enviar", err);
          });
        }
      });

      window.addEventListener("beforeunload", (e: BeforeUnloadEvent) => {
        stopTimestampRefresh();
        document.removeEventListener("windchat:languagechange", handleLanguageChanged);

        // Si hay conexión activa, pedir confirmación
        if (chatClient && chatClient.isConnected()) {
          const message = t('confirmClose');
          e.preventDefault();
          e.returnValue = message; // Estándar moderno (Chrome ignora el mensaje custom)
          return message; // Compatibilidad con navegadores antiguos
        }

        // Limpiar recursos al cerrar
        if (chatClient) chatClient.disconnect();
      });

    } catch (err) {
      console.error("ERROR:", err);
      const errorContainer = document.getElementById("messages");
      if (errorContainer) {
        errorContainer.textContent = "";
        const errorMessage = document.createElement("div");
        errorMessage.style.color = "red";
        errorMessage.textContent = `${t("genericErrorPrefix")}: ${err}`;
        errorContainer.appendChild(errorMessage);
      }
    }
  }
});
