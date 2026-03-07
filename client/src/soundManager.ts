const SOUND_STORAGE_KEY = "windchat_sounds_enabled";

export default class SoundManager {
  private audioContext: AudioContext | null = null;
  private initialized = false;
  private enabled = true;

  constructor() {
    this.restorePreference();
  }

  private restorePreference() {
    try {
      const saved = localStorage.getItem(SOUND_STORAGE_KEY);
      this.enabled = saved !== "false";
    } catch {
      this.enabled = true;
    }
  }

  private savePreference() {
    try {
      localStorage.setItem(SOUND_STORAGE_KEY, String(this.enabled));
    } catch {
      // Ignore persistence failures.
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.savePreference();
  }

  async initialize(): Promise<boolean> {
    if (this.initialized) {
      if (this.audioContext?.state === "suspended") {
        await this.audioContext.resume();
      }
      return true;
    }

    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      return false;
    }

    try {
      this.audioContext = new Ctx();
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      this.initialized = true;
      return true;
    } catch {
      return false;
    }
  }

  playSendSound(): void {
    this.playTone(860, 0.08, 0.045);
  }

  playReceiveSound(): void {
    this.playTone(620, 0.14, 0.06);
  }

  private playTone(frequency: number, duration: number, volume: number): void {
    if (!this.initialized || !this.enabled || !this.audioContext) {
      return;
    }

    const now = this.audioContext.currentTime;
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(this.audioContext.destination);

    oscillator.start(now);
    oscillator.stop(now + duration);
  }
}
