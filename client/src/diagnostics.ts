// diagnostics.ts — Panel de diagnóstico WindChat.
//
// Recopila el estado real del cliente (WebCrypto, conexión, ratchet, Service
// Worker, errores recientes) y genera un archivo .txt descargable para que el
// usuario lo comparta cuando algo falle, en lugar de pegar logs sueltos.
//
// Sin dependencias externas: usa la Web Crypto API y DOM.

import type { ChatClient } from "./websocket.js";

export interface DiagnosticResult {
  label: string;
  status: "OK" | "WARN" | "FAIL" | "INFO";
  detail: string;
}

function section(title: string): string {
  return `\n=== ${title} ===`;
}

async function checkWebCrypto(): Promise<DiagnosticResult> {
  try {
    if (!globalThis.crypto?.subtle) {
      return { label: "WebCrypto.subtle disponible", status: "FAIL", detail: "crypto.subtle es undefined (contexto inseguro http:// sin localhost)" };
    }
    // Roundtrip ECDH P-256 -> HKDF -> AES-GCM para confirmar que funciona
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: kp.publicKey }, kp.privateKey, 256);
    const key = await crypto.subtle.importKey("raw", shared, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("test"));
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return { label: "WebCrypto E2E (ECDH+HKDF+AES-GCM)", status: "OK", detail: "Roundtrip criptográfico correcto" };
  } catch (e) {
    return { label: "WebCrypto E2E (ECDH+HKDF+AES-GCM)", status: "FAIL", detail: `Error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function checkConnection(client: ChatClient | undefined): DiagnosticResult {
  if (!client) return { label: "Cliente inicializado", status: "FAIL", detail: "chatClient es undefined" };
  const connected = client.isConnected();
  return {
    label: "Conexión WebSocket",
    status: connected ? "OK" : "WARN",
    detail: connected ? "Conectado al servidor" : "No conectado",
  };
}

function checkRatchet(client: ChatClient | undefined): DiagnosticResult {
  if (!client) return { label: "Ratchet E2EE", status: "FAIL", detail: "cliente no disponible" };
  const ready = client.isReady();
  const send = client.getSendCounter();
  const recv = client.getRecvCounter();
  const skipped = client.getSkippedKeyCount();
  return {
    label: "Ratchet E2EE (estado de sincronización)",
    status: ready ? "OK" : "WARN",
    detail: `listo=${ready}  sendCounter=${send}  recvCounter=${recv}  skippedKeys=${skipped}  connectionId=${client.getConnectionId()}`,
  };
}

async function checkServiceWorker(): Promise<DiagnosticResult> {
  if (!("serviceWorker" in navigator)) {
    return { label: "Service Worker", status: "INFO", detail: "No soportado en este navegador" };
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { label: "Service Worker", status: "INFO", detail: "No hay SW registrado" };
    const controlled = navigator.serviceWorker.controller !== null;
    return {
      label: "Service Worker",
      status: controlled ? "WARN" : "OK",
      detail: `registrado=${!!reg.active}  controlandoPágina=${controlled}  scope=${reg.scope}${controlled ? " (si ves errores raros, haz Ctrl+F5 para forzar recarga sin caché)" : ""}`,
    };
  } catch (e) {
    return { label: "Service Worker", status: "WARN", detail: `No se pudo consultar: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function fmtErrors(client: ChatClient | undefined): string {
  if (!client) return "  (sin cliente)";
  const errs = client.getRecentErrors();
  if (errs.length === 0) return "  (ninguno)";
  return errs.map((e) => `  [${new Date(e.ts).toISOString()}] ${e.msg}`).join("\n");
}

export async function runDiagnostics(client: ChatClient | undefined): Promise<string> {
  const results: DiagnosticResult[] = [];
  results.push(await checkWebCrypto());
  results.push(checkConnection(client));
  results.push(checkRatchet(client));
  results.push(await checkServiceWorker());

  const env = {
    userAgent: navigator.userAgent,
    url: location.href,
    protocol: location.protocol,
    isLocalhost: location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname.endsWith(".trycloudflare.com"),
    now: new Date().toISOString(),
  };

  const fails = results.filter((r) => r.status === "FAIL");
  const warns = results.filter((r) => r.status === "WARN");

  const lines: string[] = [];
  lines.push("WindChat — Diagnóstico de sesión");
  lines.push(`Generado: ${env.now}`);
  lines.push(section("ENTORNO"));
  lines.push(`URL: ${env.url}`);
  lines.push(`Protocolo: ${env.protocol}`);
  lines.push(`localhost/cloudflare: ${env.isLocalhost}`);
  lines.push(`User-Agent: ${env.userAgent}`);
  lines.push(section("CHECKS"));
  for (const r of results) {
    lines.push(`[${r.status}] ${r.label}\n      ${r.detail}`);
  }
  lines.push(section("ERRORES RECIENTES (últimos 25)"));
  lines.push(fmtErrors(client));
  lines.push(section("RESUMEN"));
  lines.push(`FAIL: ${fails.length}   WARN: ${warns.length}`);
  if (fails.length > 0) {
    lines.push("Problemas críticos detectados:");
    for (const f of fails) lines.push(`  - ${f.label}: ${f.detail}`);
  } else if (warns.length > 0) {
    lines.push("Sin fallos críticos, pero hay avisos que revisar arriba.");
  } else {
    lines.push("Todo en orden. Si el chat sigue fallando, el problema está en el peer o en la red.");
  }
  lines.push("\n(fin del diagnóstico)");
  return lines.join("\n");
}

/** Ejecuta el diagnóstico y descarga un .txt */
export async function downloadDiagnostics(client: ChatClient | undefined): Promise<void> {
  const text = await runDiagnostics(client);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `windchat-diagnostics-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  console.log("📋 Diagnóstico generado:\n" + text);
}
