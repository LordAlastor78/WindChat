const NOTIFICATIONS_STORAGE_KEY = "windchat_notifications_enabled";

type PermissionResult = "enabled" | "denied" | "unsupported";

export default class NotificationManager {
  private enabled = false;

  constructor() {
    this.restorePreference();
  }

  private hasSupport(): boolean {
    return typeof window !== "undefined" && "Notification" in window;
  }

  private restorePreference(): void {
    if (!this.hasSupport()) return;

    const saved = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    const preferred = saved === "true";
    this.enabled = preferred && Notification.permission === "granted";
  }

  private savePreference(preferred: boolean): void {
    try {
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, String(preferred));
    } catch {
      // Ignore persistence errors to avoid blocking notification flow.
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  disable(): void {
    this.enabled = false;
    this.savePreference(false);
  }

  async enable(): Promise<PermissionResult> {
    if (!this.hasSupport()) {
      return "unsupported";
    }

    if (Notification.permission === "granted") {
      this.enabled = true;
      this.savePreference(true);
      return "enabled";
    }

    if (Notification.permission === "denied") {
      this.enabled = false;
      this.savePreference(false);
      return "denied";
    }

    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      this.enabled = true;
      this.savePreference(true);
      return "enabled";
    }

    this.enabled = false;
    this.savePreference(false);
    return "denied";
  }

  showMessageNotification(senderName: string, messagePreview: string): void {
    if (!this.enabled || !this.hasSupport()) return;
    if (document.visibilityState === "visible") return;

    const body =
      messagePreview.length > 50
        ? `${messagePreview.slice(0, 47)}...`
        : messagePreview;

    const notification = new Notification(`💬 ${senderName}`, {
      body,
      tag: "windchat-message",
      requireInteraction: false,
      silent: false,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    window.setTimeout(() => notification.close(), 5000);
  }
}
