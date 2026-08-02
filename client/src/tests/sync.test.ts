import { describe, it, expect } from "vitest";
import { exportSync, importSync, generateSyncCode } from "../sync.js";
import Store from "../store.js";

describe("Sync (código de sincronización cifrado)", () => {
  it("exporta e importa con el mismo código reproduce el estado", async () => {
    const profile = { displayName: "Alastor", avatarColor: "#7db4ff", status: "en línea" };
    const contacts = [
      { id: "c1", displayName: "Peer1", identityPublicKey: "PUB1", addedAt: 1000 },
      { id: "c2", displayName: "Peer2", identityPublicKey: "PUB2", addedAt: 2000 },
    ];
    const code = "viento-astro-nube-fugaz";

    const blob = await exportSync(profile, contacts as any, code);
    expect(blob.split(".").length).toBe(3);

    const restored = await importSync(blob, code);
    expect(restored.profile.displayName).toBe("Alastor");
    expect(restored.contacts.length).toBe(2);
    expect(restored.contacts[1].identityPublicKey).toBe("PUB2");
  });

  it("falla con un código incorrecto", async () => {
    const profile = { displayName: "A", avatarColor: "#000", status: "" };
    const blob = await exportSync(profile, [], "codigo-correcto");
    await expect(importSync(blob, "codigo-malo")).rejects.toThrow();
  });

  it("falla con un blob corrupto", async () => {
    await expect(importSync("no.es.valido", "x")).rejects.toThrow();
  });

  it("código corto es rechazado", async () => {
    const profile = { displayName: "A", avatarColor: "#000", status: "" };
    await expect(exportSync(profile, [], "x")).rejects.toThrow();
  });

  it("aplicado vía Store restaura perfil y contactos", async () => {
    Store.clearAll();
    const profile = { displayName: "Sinc", avatarColor: "#123456", status: "ok" };
    const contacts = [{ id: "s1", displayName: "S1", addedAt: 1 }];
    const blob = await exportSync(profile, contacts as any, "mi-codigo-1234");
    const data = await importSync(blob, "mi-codigo-1234");
    Store.applySyncData(data.profile, data.contacts);
    expect(Store.getProfile().displayName).toBe("Sinc");
    expect(Store.getContacts()[0].id).toBe("s1");
  });

  it("generateSyncCode produce 4 palabras unidas por guion", () => {
    const code = generateSyncCode();
    expect(code.split("-").length).toBe(4);
  });
});
