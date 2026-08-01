/**
 * EmojiPicker — selector de emojis tipo WhatsApp.
 *
 * Vanilla TS (sin framework). Carga perezosa del JSON de emojis
 * (client/src/reactions/emojis.json, ~8KB) solo al abrir el menú.
 *
 * API:
 *   const picker = new EmojiPicker(anchorEl);
 *   picker.onSelect = (emoji) => { ... };
 *   picker.toggle();
 */
import emojisData from "./emojis.json";

type EmojiEntry = [string, string]; // [char, nombre]
interface EmojiData {
  [category: string]: EmojiEntry[];
}

const CATEGORY_LABELS: Record<string, string> = {
  smileys: "Caras",
  gestos: "Gentos",
  amor: "Amor",
  animales: "Animales",
  comida: "Comida",
  actividades: "Actividades",
  viajes: "Viajes",
  objetos: "Objetos",
  simbolos: "Símbolos",
  banderas: "Banderas",
};

export class EmojiPicker {
  private root: HTMLDivElement;
  private anchor: HTMLElement;
  private data = emojisData as unknown as EmojiData;
  /** emoji -> [{ char, name }] para búsqueda plana */
  private flat: EmojiEntry[] = [];
  private searchInput!: HTMLInputElement;
  private grid!: HTMLDivElement;
  private open = false;

  onSelect: ((emoji: string) => void) | null = null;

  constructor(anchor: HTMLElement) {
    this.anchor = anchor;
    this.root = document.createElement("div");
    this.root.className = "emoji-picker hidden";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Seleccionar emoji");
    this.buildFlat();
    this.render();
    document.body.appendChild(this.root);
    this.wireExternalClose();
  }

  private buildFlat(): void {
    for (const cat of Object.keys(this.data)) {
      for (const e of this.data[cat]) this.flat.push(e);
    }
  }

  private render(): void {
    // Buscador
    const searchWrap = document.createElement("div");
    searchWrap.className = "emoji-picker-search";
    this.searchInput = document.createElement("input");
    this.searchInput.type = "text";
    this.searchInput.placeholder = "Buscar emoji…";
    this.searchInput.className = "emoji-picker-input";
    this.searchInput.addEventListener("input", () => this.filter(this.searchInput.value));
    searchWrap.appendChild(this.searchInput);

    // Grid
    this.grid = document.createElement("div");
    this.grid.className = "emoji-picker-grid";

    this.root.appendChild(searchWrap);
    this.root.appendChild(this.grid);
    this.renderEmojis(this.flat);
  }

  private renderEmojis(list: EmojiEntry[]): void {
    this.grid.replaceChildren();
    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "emoji-picker-empty";
      empty.textContent = "Sin resultados";
      this.grid.appendChild(empty);
      return;
    }
    for (const [char, name] of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-picker-item";
      btn.textContent = char;
      btn.title = name;
      btn.setAttribute("aria-label", name);
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.onSelect?.(char);
        this.hide();
      });
      this.grid.appendChild(btn);
    }
  }

  private filter(query: string): void {
    const q = query.trim().toLowerCase();
    if (!q) {
      this.renderEmojis(this.flat);
      return;
    }
    this.renderEmojis(this.flat.filter(([, name]) => name.toLowerCase().includes(q)));
  }

  private position(): void {
    const rect = this.anchor.getBoundingClientRect();
    const pickerH = 320;
    const spaceBelow = window.innerHeight - rect.bottom;
    let top = rect.bottom + 8;
    if (spaceBelow < pickerH) {
      top = Math.max(8, rect.top - pickerH - 8);
    }
    this.root.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
    this.root.style.top = `${top}px`;
  }

  private wireExternalClose(): void {
    document.addEventListener("click", (e) => {
      if (this.open && !this.root.contains(e.target as Node) && !this.anchor.contains(e.target as Node)) {
        this.hide();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.open) this.hide();
    });
  }

  toggle(): void {
    this.open ? this.hide() : this.show();
  }

  show(): void {
    this.open = true;
    this.position();
    this.root.classList.remove("hidden");
    this.searchInput.value = "";
    this.filter("");
    this.searchInput.focus();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add("hidden");
  }
}
