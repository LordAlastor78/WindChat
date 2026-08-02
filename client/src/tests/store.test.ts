import { describe, it, expect, beforeEach } from "vitest";
import Store from "../store.js";

describe("Store (persistencia local)", () => {
  beforeEach(() => {
    Store.clearAll();
  });

  it("guarda y lee el perfil", () => {
    const saved = Store.saveProfile({ displayName: "Alastor", avatarColor: "#fff" });
    expect(saved.displayName).toBe("Alastor");
    expect(Store.getProfile().displayName).toBe("Alastor");
  });

  it("guarda y actualiza ajustes", () => {
    Store.saveSettings({ theme: "stellar" });
    expect(Store.getSettings().theme).toBe("stellar");
  });

  it("crea y recupera contactos por id y por clave pública", () => {
    const c = Store.saveContact({
      id: "c1",
      displayName: "Peer1",
      identityPublicKey: "PUB123",
      addedAt: Date.now(),
    });
    expect(Store.getContact("c1")?.displayName).toBe("Peer1");
    expect(Store.getContactByPublicKey("PUB123")?.id).toBe("c1");
  });

  it("upsertContactByPublicKey actualiza si ya existe", () => {
    Store.upsertContactByPublicKey("PUB9", { displayName: "A" });
    Store.upsertContactByPublicKey("PUB9", { displayName: "B", note: "x" });
    const list = Store.getContacts();
    expect(list.length).toBe(1);
    expect(list[0].displayName).toBe("B");
  });

  it("crea y actualiza conversaciones", () => {
    const conv = Store.createConversation({
      type: "direct",
      title: "Chat con Peer",
      roomId: "room-xyz",
      ephemeral: true,
    });
    expect(Store.getConversationByRoom("room-xyz")?.id).toBe(conv.id);
    Store.updateConversation(conv.id, { lastMessagePreview: "hola", unreadCount: 2 });
    expect(Store.getConversation(conv.id)?.unreadCount).toBe(2);
  });

  it("removeContact y removeConversation funcionan", () => {
    const c = Store.saveContact({ id: "d", displayName: "X", addedAt: 1 });
    Store.removeContact(c.id);
    expect(Store.getContact("d")).toBeUndefined();

    const conv = Store.createConversation({
      type: "direct",
      title: "t",
      roomId: "r",
      ephemeral: true,
    });
    Store.removeConversation(conv.id);
    expect(Store.getConversation(conv.id)).toBeUndefined();
  });

  it("applySyncData reemplaza perfil y contactos", () => {
    Store.saveProfile({ displayName: "Viejo" });
    Store.saveContact({ id: "old", displayName: "old", addedAt: 1 });
    Store.applySyncData(
      { displayName: "Nuevo", avatarColor: "#000", status: "hi" },
      [{ id: "k1", displayName: "Importado", addedAt: 2 }]
    );
    expect(Store.getProfile().displayName).toBe("Nuevo");
    expect(Store.getContacts().length).toBe(1);
    expect(Store.getContacts()[0].id).toBe("k1");
  });
});
