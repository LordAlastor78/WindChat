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

import FileManager from "./fileManager";
import { EmojiPicker } from "./reactions/EmojiPicker.js";
import { renderMarkdownSafe } from "./markdown/renderer.js";
import { getLanguage, initializeTranslations, setLanguage, t } from "./i18n";
import NotificationManager from "./notifications";
import type { MessagePayload } from "./protocol";
import SoundManager from "./soundManager";
import { generateRoomId, loadTheme } from "./ui";
import { formatAbsoluteTimestamp, formatMessageTimestamp } from "./utils/time";
import ChatClient from "./websocket";

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

  const serverStatusEl = document.getElementById('serverStatus') as HTMLDivElement | null;
  const serverStatusText = document.getElementById('serverStatusText') as HTMLSpanElement | null;
  const updateServerStatus = (level: "ok" | "degraded" | "alert", message?: string) => {
    if (!serverStatusEl || !serverStatusText) return;
    serverStatusEl.classList.remove('ok', 'degraded', 'alert');
    serverStatusEl.classList.add(level);
    serverStatusText.textContent = level === 'ok' ? 'Server' : level.toUpperCase();
    if (message) serverStatusEl.title = message;
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

      // ===== Safety number (verificación anti-MITM) =====
      const safetyBadge = document.getElementById("safetyBadge") as HTMLDivElement | null;
      const safetyBadgeText = document.getElementById("safetyBadgeText") as HTMLSpanElement | null;
      const safetyPanel = document.getElementById("safetyPanel") as HTMLDivElement | null;
      const safetyEmojis = document.getElementById("safetyEmojis") as HTMLDivElement | null;
      const safetyDigits = document.getElementById("safetyDigits") as HTMLDivElement | null;
      const safetyClose = document.getElementById("safetyClose") as HTMLButtonElement | null;
      const safetyVerifyBtn = document.getElementById("safetyVerifyBtn") as HTMLButtonElement | null;

      let safetyVerified = false;

      const renderSafetyBadge = () => {
        if (!safetyBadge || !safetyBadgeText) return;
        safetyBadge.classList.toggle("verified", safetyVerified);
        safetyBadgeText.textContent = safetyVerified
          ? t("safetyVerified")
          : t("safetyUnverified");
      };

      const showSafetyNumber = (sas?: { digits: string; emojis: string[] }) => {
        if (!safetyBadge) return;

        if (!sas) {
          safetyBadge.classList.add("hidden");
          safetyPanel?.classList.add("hidden");
          return;
        }

        // Nueva sesión de claves → la verificación previa ya no vale
        safetyVerified = false;
        renderSafetyBadge();
        safetyBadge.classList.remove("hidden");

        if (safetyEmojis) safetyEmojis.textContent = sas.emojis.join(" ");
        if (safetyDigits) safetyDigits.textContent = sas.digits;
        if (safetyVerifyBtn) {
          safetyVerifyBtn.disabled = false;
          safetyVerifyBtn.textContent = t("safetyVerifyButton");
        }
      };

      const hideSafetyUi = () => {
        safetyVerified = false;
        safetyBadge?.classList.add("hidden");
        safetyPanel?.classList.add("hidden");
      };

      const toggleSafetyPanel = () => {
        safetyPanel?.classList.toggle("hidden");
      };

      safetyBadge?.addEventListener("click", toggleSafetyPanel);
      safetyBadge?.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleSafetyPanel();
        }
      });
      safetyClose?.addEventListener("click", () => safetyPanel?.classList.add("hidden"));
      safetyVerifyBtn?.addEventListener("click", () => {
        safetyVerified = true;
        renderSafetyBadge();
        if (safetyVerifyBtn) {
          safetyVerifyBtn.disabled = true;
          safetyVerifyBtn.textContent = t("safetyVerified");
        }
        safetyPanel?.classList.add("hidden");
      });

      let replyTo: { id: string | null; text: string } | null = null;
      let selectedMessageText = "";
      let selectedMessageId: string | null = null;
      let timestampRefreshId: number | undefined;
      let unreadMessagesInView = 0;
      type MessageDeliveryState = "sent" | "delivered" | "read";
      const outgoingMessageStates = new Map<string, { container: HTMLSpanElement; state: MessageDeliveryState }>();

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

      const createReceiptIcon = (state: MessageDeliveryState): HTMLSpanElement => {
        const iconWrapper = document.createElement("span");
        iconWrapper.className = `message-receipt-icon ${state}`;
        iconWrapper.setAttribute("aria-hidden", "true");

        const createSvg = (offsetX: number) => {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("viewBox", "0 0 16 12");
          svg.setAttribute("width", "12");
          svg.setAttribute("height", "10");
          svg.setAttribute("focusable", "false");
          svg.setAttribute("fill", "none");
          svg.setAttribute("stroke", "currentColor");
          svg.setAttribute("stroke-width", "1.9");
          svg.setAttribute("stroke-linecap", "round");
          svg.setAttribute("stroke-linejoin", "round");
          svg.style.transform = `translateX(${offsetX}px)`;

          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", "M1.4 6.3l3.2 3.2L10.9 3.2");
          svg.appendChild(path);
          return svg;
        };

        iconWrapper.appendChild(createSvg(0));
        if (state !== "sent") {
          iconWrapper.appendChild(createSvg(3));
        }

        return iconWrapper;
      };

      const updateOutgoingMessageState = (messageId: string, state: MessageDeliveryState) => {
        const tracked = outgoingMessageStates.get(messageId);
        if (!tracked) return;

        if (tracked.state === state) return;

        tracked.state = state;
        tracked.container.replaceChildren(createReceiptIcon(state));
        tracked.container.setAttribute("data-state", state);
        console.log(`[tick] mensaje ${messageId} => ${state}`);
      };

      const buildMessageElement = (
        displayName: string,
        text: string,
        options: { side: "me" | "other"; id?: string; replyToId?: string; timestamp?: number; status?: MessageDeliveryState }
      ): HTMLDivElement => {
        const msg = document.createElement("div");
        msg.classList.add("message", options.side);
        const messageTimestamp = options.timestamp ?? Date.now();

        const sender = document.createElement("span");
        sender.className = "message-sender";
        sender.textContent = options.side === "me" ? t("youLabel") : displayName;
        sender.title = displayName;
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
        // Render markdown sanitizado (XSS-safe). Si el texto no es markdown,
        // marked lo deja como texto plano y DOMPurify lo limpia.
        textEl.innerHTML = renderMarkdownSafe(text);
        msg.appendChild(textEl);

        const meta = document.createElement("div");
        meta.className = "message-meta";

        const timestampEl = document.createElement("span");
        timestampEl.className = "message-timestamp";
        timestampEl.setAttribute("data-timestamp", String(messageTimestamp));
        timestampEl.textContent = formatMessageTimestamp(messageTimestamp);
        timestampEl.title = formatAbsoluteTimestamp(messageTimestamp);

        meta.appendChild(timestampEl);

        if (options.side === "me") {
          const statusEl = document.createElement("span");
          statusEl.className = "message-receipt";
          const initialStatus = options.status || "sent";
          statusEl.setAttribute("data-state", initialStatus);
          statusEl.replaceChildren(createReceiptIcon(initialStatus));
          meta.appendChild(statusEl);

          if (options.id) {
            outgoingMessageStates.set(options.id, { container: statusEl, state: initialStatus });
          }
        }

        msg.appendChild(meta);

        if (options.id) {
          msg.setAttribute("data-message-id", options.id);
        }
        msg.setAttribute("data-message-text", text);
        msg.setAttribute("data-message-sender", displayName);

        return msg;
      };

      /**
       * Aplica una reacción a un mensaje: mantiene un mapa emoji->count en
       * data-reactions (JSON) y pinta pills clicables. El toggle es local
       * (mi propia reacción) para feedback inmediato; el servidor difunde
       * add/remove del peer.
       */
      const readReactions = (el: HTMLElement): Record<string, number> => {
        try {
          return JSON.parse(el.getAttribute("data-reactions") || "{}");
        } catch {
          return {};
        }
      };

      const renderReactions = (el: HTMLElement, map: Record<string, number>) => {
        let container = el.querySelector(".message-reactions") as HTMLDivElement | null;
        if (!container) {
          container = document.createElement("div");
          container.className = "message-reactions";
          el.appendChild(container);
        }
        container.replaceChildren();
        const entries = Object.entries(map).filter(([, c]) => c > 0);
        if (entries.length === 0) {
          container.remove();
          return;
        }
        for (const [emoji, count] of entries) {
          const pill = document.createElement("button");
          pill.type = "button";
          pill.className = "reaction-pill";
          pill.textContent = count > 1 ? `${emoji} ${count}` : emoji;
          pill.title = `${count} reacción(es)`;
          pill.addEventListener("click", (ev) => {
            ev.stopPropagation();
            // Toggle propio: si ya reaccioné, quito; si no, añado
            const mine = el.getAttribute("data-my-reactions")?.includes(emoji) ?? false;
            const action = mine ? "remove" : "add";
            updateMyReaction(el, emoji, action);
            if (chatClient && el.getAttribute("data-message-id")) {
              chatClient.sendReaction(emoji, el.getAttribute("data-message-id")!, action === "remove" ? "remove" : "add").catch((err) => {
                console.error("Failed to toggle reaction", err);
              });
            }
          });
          container.appendChild(pill);
        }
      };

      const updateMyReaction = (el: HTMLElement, emoji: string, action: "add" | "remove") => {
        const mine = new Set((el.getAttribute("data-my-reactions") || "").split("|").filter(Boolean));
        if (action === "add") mine.add(emoji);
        else mine.delete(emoji);
        el.setAttribute("data-my-reactions", [...mine].join("|"));
      };

      const applyReaction = (el: HTMLElement, emoji: string, action: "add" | "remove") => {
        const map = readReactions(el);
        const current = map[emoji] ?? 0;
        map[emoji] = action === "add" ? current + 1 : Math.max(0, current - 1);
        if (map[emoji] === 0) delete map[emoji];
        el.setAttribute("data-reactions", JSON.stringify(map));
        renderReactions(el, map);
      };

      // Picker perezoso (carga el JSON de emojis solo al usarlo)
      let reactionPicker: EmojiPicker | null = null;
      const openReactionPicker = (messageId: string, anchor: HTMLElement) => {
        if (!reactionPicker) {
          reactionPicker = new EmojiPicker(anchor);
        }
        reactionPicker.onSelect = (emoji) => {
          const target = messagesContainer.querySelector(`[data-message-id="${messageId}"]`) as HTMLDivElement | null;
          if (!target) return;
          const mine = target.getAttribute("data-my-reactions")?.includes(emoji) ?? false;
          const action = mine ? "remove" : "add";
          updateMyReaction(target, emoji, action);
          applyReaction(target, emoji, action);
          if (chatClient) {
            chatClient.sendReaction(emoji, messageId, action === "remove" ? "remove" : "add").catch((err) => {
              console.error("Failed to send reaction", err);
            });
          }
        };
        reactionPicker.toggle();
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
          outgoingMessageStates.clear();
          // Reconectar regenera las claves ECDH: el SAS anterior ya no es válido
          hideSafetyUi();
          messagesContainer.textContent = "";
          const waitingMessage = document.createElement("div");
          waitingMessage.style.textAlign = "center";
          waitingMessage.style.opacity = "0.7";
          waitingMessage.textContent = t("waitingForPeer");
          messagesContainer.appendChild(waitingMessage);
        },
        onPeerJoined: (safetyNumber) => {
          console.log("[OK] User connected - Chat ready");
          updateConnectionStatus("connected");
          resetUnreadIndicator();
          outgoingMessageStates.clear();
          messagesContainer.textContent = "";

          // Mostrar el código de verificación de la sesión (anti-MITM)
          showSafetyNumber(safetyNumber);

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
          outgoingMessageStates.clear();
          hideSafetyUi();
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
          if (payload.type === "receipt") {
            if (payload.receiptForId && payload.receiptState) {
              updateOutgoingMessageState(payload.receiptForId, payload.receiptState);
              console.log(`[receipt] ${payload.receiptState} para ${payload.receiptForId}`);
            }
            return;
          }

          if (payload.type === "reaction") {
            const targetId = payload.reactionToId;
            if (targetId) {
              const targetMsg = messagesContainer.querySelector(
                `[data-message-id="${targetId}"]`
              ) as HTMLDivElement | null;
              if (targetMsg) {
                applyReaction(targetMsg, payload.text, payload.reactionAction ?? "add");
              }
            }
            return;
          }

          // ===== Manejo de archivos =====
          if (payload.type === "file_metadata" || payload.type === "file_chunk" || payload.type === "file_complete") {
            if (fileManager) {
              fileManager.handleIncomingFile(payload);
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

          if (payload.id && chatClient) {
            void chatClient.sendReceipt(payload.id, "read").catch((err) => {
              console.error("Failed to send read receipt", err);
            });
          }

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
          outgoingMessageStates.clear();
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
          outgoingMessageStates.clear();

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
        onServerStatus: (level, message) => {
          updateServerStatus(level, message);
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

        if (action === "react") {
          if (chatClient && selectedMessageId) {
            openReactionPicker(selectedMessageId, contextMenu!);
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
          status: "sent",
        });
        attachMessageInteractions(msg, outgoingText);
        messagesContainer.appendChild(msg);
        updateOutgoingMessageState(localMessageId, "sent");
        scrollToBottom();
        resetUnreadIndicator();

        soundManager.playSendSound();

        messageInput.value = "";
        setReply(null);
      };

      // Event listeners de mensajes
      messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          sendMsg().catch((err) => {
            console.error("Error inesperado al enviar", err);
          });
        }
      });

      // ===== MANEJO DE ARCHIVOS =====
      const cameraInput = document.getElementById("cameraInput") as HTMLInputElement | null;
      const galleryInput = document.getElementById("galleryInput") as HTMLInputElement | null;
      const docInput = document.getElementById("docInput") as HTMLInputElement | null;
      const attachMenu = document.getElementById("attachMenu") as HTMLDivElement | null;
      const attachFileBtn = document.getElementById("attachFileBtn") as HTMLButtonElement | null;
      const fileCancelBtn = document.getElementById("fileCancelBtn") as HTMLButtonElement | null;
      const filePreview = document.getElementById("filePreview") as HTMLDivElement | null;
      const filePreviewIcon = document.getElementById("filePreviewIcon") as HTMLSpanElement | null;
      const filePreviewName = document.getElementById("filePreviewName") as HTMLDivElement | null;
      const filePreviewSize = document.getElementById("filePreviewSize") as HTMLDivElement | null;
      const fileProgress = document.getElementById("fileProgress") as HTMLDivElement | null;
      const fileProgressBar = document.getElementById("fileProgressBar") as HTMLDivElement | null;

      if (!fileManager) {
        fileManager = new FileManager({
          onUploadProgress: (fileId: string, progress: number) => {
            if (fileProgressBar) {
              fileProgressBar.style.width = `${progress}%`;
            }
          },
          onDownloadProgress: (fileId: string, progress: number) => {
            if (fileProgressBar) {
              fileProgressBar.style.width = `${progress}%`;
            }
          },
          onFileReady: (fileId: string, file: Blob, metadata) => {
            console.log(`✅ Archivo completado: ${metadata.name}`);

            // Mostrar mensaje en el chat con el archivo descargado
            const shouldAutoScroll = isNearBottom();
            const fileMsg = document.createElement("div");
            fileMsg.className = "message other";
            fileMsg.style.maxWidth = "72%";
            fileMsg.style.display = "flex";
            fileMsg.style.flexDirection = "column";
            fileMsg.style.gap = "0.5rem";

            const sender = document.createElement("span");
            sender.className = "message-sender";
            sender.textContent = t("fileLabel");
            fileMsg.appendChild(sender);

            // Thumbnail real si es imagen/video; si no, enlace de descarga
            const url = URL.createObjectURL(file);
            if (metadata.type.startsWith("image/")) {
              const img = document.createElement("img");
              img.className = "message-img";
              img.src = url;
              img.alt = metadata.name;
              img.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
              fileMsg.appendChild(img);
            } else if (metadata.type.startsWith("video/")) {
              const video = document.createElement("video");
              video.className = "message-video";
              video.src = url;
              video.controls = true;
              video.addEventListener("loadeddata", () => URL.revokeObjectURL(url), { once: true });
              fileMsg.appendChild(video);
            } else {
              const fileLink = document.createElement("a");
              fileLink.href = url;
              fileLink.download = metadata.name;
              fileLink.style.color = "inherit";
              fileLink.style.textDecoration = "none";
              fileLink.style.display = "flex";
              fileLink.style.alignItems = "center";
              fileLink.style.gap = "0.5rem";
              fileLink.style.padding = "0.5rem";
              fileLink.style.borderRadius = "8px";
              fileLink.style.backgroundColor = "rgba(56, 189, 248, 0.2)";
              fileLink.style.cursor = "pointer";
              let icon = "📎";
              if (metadata.type === "application/pdf") icon = "📄";
              else if (metadata.type.includes("text")) icon = "📝";
              else if (metadata.type.includes("zip")) icon = "📦";
              fileLink.innerHTML = `${icon} <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${metadata.name}</span>`;
              fileMsg.appendChild(fileLink);
            }

            const timestamp = document.createElement("span");
            timestamp.className = "message-timestamp";
            timestamp.setAttribute("data-timestamp", String(Date.now()));
            timestamp.textContent = formatMessageTimestamp(Date.now());
            fileMsg.appendChild(timestamp);

            messagesContainer.appendChild(fileMsg);

            if (shouldAutoScroll) {
              scrollToBottom();
              resetUnreadIndicator();
            } else {
              unreadMessagesInView += 1;
              updateUnreadIndicator();
            }

            // Limpiar progreso
            if (fileProgress) fileProgress.classList.add("hidden");
          },
          onError: (fileId: string, error: string) => {
            console.error(`❌ Error en archivo: ${error}`);
            if (fileProgress) fileProgress.classList.add("hidden");
          },
        });
      }

      const showFilePreview = (file: File) => {
        if (!filePreview || !filePreviewName || !filePreviewSize || !filePreviewIcon) return;

        selectedFile = file;
        filePreviewName.textContent = file.name;
        filePreviewSize.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;

        // Limpiar thumbnail previo
        const prevThumb = filePreviewIcon.querySelector("img, video");
        if (prevThumb) prevThumb.remove();

        // Thumbnail real si es imagen/video; si no, icono por tipo
        if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
          const url = URL.createObjectURL(file);
          let media: HTMLImageElement | HTMLVideoElement;
          if (file.type.startsWith("image/")) {
            media = document.createElement("img");
            media.className = "file-preview-thumb";
            media.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
          } else {
            media = document.createElement("video");
            media.className = "file-preview-thumb video";
            media.controls = false;
            media.muted = true;
            media.addEventListener("loadeddata", () => URL.revokeObjectURL(url), { once: true });
          }
          media.src = url;
          filePreviewIcon.textContent = "";
          filePreviewIcon.appendChild(media);
        } else {
          let icon = "📎";
          if (file.type === "application/pdf") icon = "📄";
          else if (file.type.includes("text")) icon = "📝";
          else if (file.type.includes("zip") || file.type.includes("compress")) icon = "📦";
          filePreviewIcon.textContent = icon;
        }

        filePreview.classList.remove("hidden");
      };

      const hideFilePreview = () => {
        if (!filePreview) return;
        const thumb = filePreviewIcon?.querySelector("img, video") as HTMLImageElement | HTMLVideoElement | null;
        if (thumb && thumb.src.startsWith("blob:")) {
          // El revoke en onload cubre el caso de éxito; forzar aquí por si no cargó
          try { URL.revokeObjectURL(thumb.src); } catch { /* ya revocado */ }
        }
        filePreview.classList.add("hidden");
        selectedFile = null;
        // Reset de los inputs ocultos para poder volver a elegir el mismo archivo
        [cameraInput, galleryInput, docInput].forEach((i) => { if (i) i.value = ""; });
      };

      const sendFile = async () => {
        if (!selectedFile || !chatClient || !fileManager) return;

        try {
          // Validar archivo
          const validation = fileManager.validateFile(selectedFile);
          if (!validation.valid) {
            console.error(`❌ Archivo inválido: ${validation.error}`);
            return;
          }

          // Mostrar barra de progreso
          if (fileProgress) fileProgress.classList.remove("hidden");

          // Preparar archivo
          const { fileId, payloads } = await fileManager.prepareFileForSending(selectedFile);
          console.log(`📤 Enviando archivo en ${payloads.length} mensajes...`);

          // Enviar cada payload. Pausa de 110ms entre chunks para respetar el
          // rate limit del servidor (10 msg/s por conexión) en archivos grandes
          // (50 MB / 256 KB = 200 chunks -> ~22s sin pausa, descartados).
          for (const payload of payloads) {
            await chatClient.sendFilePayload(payload);
            if (payload.type === "file_chunk") {
              await new Promise((r) => setTimeout(r, 110));
            }
          }

          console.log(`✅ Archivo "${selectedFile.name}" enviado completamente`);
          soundManager.playSendSound();

          // ===== Mostrar archivo en el chat del sender =====
          const shouldAutoScroll = isNearBottom();
          const fileMsg = document.createElement("div");
          fileMsg.className = "message me";
          fileMsg.style.maxWidth = "72%";
          fileMsg.style.display = "flex";
          fileMsg.style.flexDirection = "column";
          fileMsg.style.gap = "0.5rem";

          const sender = document.createElement("span");
          sender.className = "message-sender";
          sender.textContent = t("fileLabel");
          fileMsg.appendChild(sender);

          // Thumbnail real si es imagen/video; si no, enlace de descarga
          const sendUrl = URL.createObjectURL(selectedFile);
          if (selectedFile.type.startsWith("image/")) {
            const img = document.createElement("img");
            img.className = "message-img";
            img.src = sendUrl;
            img.alt = selectedFile.name;
            img.addEventListener("load", () => URL.revokeObjectURL(sendUrl), { once: true });
            fileMsg.appendChild(img);
          } else if (selectedFile.type.startsWith("video/")) {
            const video = document.createElement("video");
            video.className = "message-video";
            video.src = sendUrl;
            video.controls = true;
            video.addEventListener("loadeddata", () => URL.revokeObjectURL(sendUrl), { once: true });
            fileMsg.appendChild(video);
          } else {
            const fileLink = document.createElement("a");
            fileLink.href = sendUrl;
            fileLink.download = selectedFile.name;
            fileLink.style.color = "inherit";
            fileLink.style.textDecoration = "none";
            fileLink.style.display = "flex";
            fileLink.style.alignItems = "center";
            fileLink.style.gap = "0.5rem";
            fileLink.style.padding = "0.5rem";
            fileLink.style.borderRadius = "8px";
            fileLink.style.backgroundColor = "rgba(56, 189, 248, 0.2)";
            fileLink.style.cursor = "pointer";

            let icon = "📎";
            if (selectedFile.type === "application/pdf") icon = "📄";
            else if (selectedFile.type.includes("text")) icon = "📝";
            else if (selectedFile.type.includes("zip")) icon = "📦";

            fileLink.innerHTML = `${icon} <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${selectedFile.name}</span>`;
            fileMsg.appendChild(fileLink);
          }

          const timestamp = document.createElement("span");
          timestamp.className = "message-timestamp";
          timestamp.setAttribute("data-timestamp", String(Date.now()));
          timestamp.textContent = formatMessageTimestamp(Date.now());
          fileMsg.appendChild(timestamp);

          messagesContainer.appendChild(fileMsg);

          if (shouldAutoScroll) {
            scrollToBottom();
            resetUnreadIndicator();
          }
          // =======================================

          hideFilePreview();
        } catch (err) {
          console.error("❌ Error enviando archivo:", err);
          if (fileProgress) fileProgress.classList.add("hidden");
        }
      };

      // Event listeners de archivos
      const hideAttachMenu = () => attachMenu?.classList.add("hidden");
      const toggleAttachMenu = () => attachMenu?.classList.toggle("hidden");

      if (attachFileBtn) {
        attachFileBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleAttachMenu();
        });
      }

      // Cerrar el menú al hacer click fuera o con Escape
      document.addEventListener("click", (e) => {
        if (attachMenu && !attachMenu.contains(e.target as Node) && !attachFileBtn?.contains(e.target as Node)) {
          hideAttachMenu();
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") hideAttachMenu();
      });

      // Items del menú -> disparan su input correspondiente
      const wireMenu = (selector: string, input: HTMLInputElement | null) => {
        const item = attachMenu?.querySelector<HTMLButtonElement>(`[data-target="${selector}"]`);
        item?.addEventListener("click", () => {
          hideAttachMenu();
          input?.click();
        });
      };
      wireMenu("camera", cameraInput);
      wireMenu("gallery", galleryInput);
      wireMenu("doc", docInput);

      const onFilePicked = (e: Event) => {
        const files = (e.target as HTMLInputElement).files;
        if (files && files.length > 0) {
          showFilePreview(files[0]);
        }
        (e.target as HTMLInputElement).value = "";
      };

      cameraInput?.addEventListener("change", onFilePicked);
      galleryInput?.addEventListener("change", onFilePicked);
      docInput?.addEventListener("change", onFilePicked);

      if (fileCancelBtn) {
        fileCancelBtn.addEventListener("click", () => {
          hideFilePreview();
        });
      }

      // ===== LISTENER UNIFICADO PARA ENVÍO (archivos o mensajes) =====
      sendButton.addEventListener("click", () => {
        if (selectedFile) {
          sendFile().catch((err) => {
            console.error("Error al enviar archivo", err);
          });
        } else {
          sendMsg().catch((err) => {
            console.error("Error al enviar mensaje", err);
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
