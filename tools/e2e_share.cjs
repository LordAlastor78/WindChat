// E2E de Fase 3 (web-first): botón "Crear enlace público".
// Arranca relay + launcher local (STUB de cloudflared) y verifica en el navegador:
//  - pulsar "Crear enlace" muestra una URL https://*.trycloudflare.com
//  - pulsar "Detener enlace" mata el túnel (sin procesos huérfanos)
// Requiere: relay en :8080 y e2e_server en :4183 (proxy WS al relay).
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const http = require("http");

const ROOT = __dirname + "/..";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitServer(url, timeout = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, (res) => { res.destroy(); resolve(true); })
        .on("error", () => {
          if (Date.now() - start > timeout) reject(new Error("timeout " + url));
          else setTimeout(tick, 250);
        });
    };
    tick();
  });
}

(async () => {
  let relay, launcher, browser, ctx, page;
  let failed = false;
  const log = (...a) => console.log(...a);
  const fail = (m) => { failed = true; console.log("  ✗ " + m); };
  const ok = (m) => console.log("  ✓ " + m);

  try {
    // 1) relay ya debe estar vivo en :8080 (lo arrancamos aparte en la sesión)
    //    Si no está, el test fallará al conectar; lo asumimos vivo.
    // relay = spawn("target/release/relay-rust.exe", [], { cwd: ROOT + "/relay-rust", windowsHide: true });
    // await waitServer("http://localhost:8080").catch(() => {});
    await sleep(300);

    // 2) launcher local con stub
    launcher = spawn("node", ["tools/link_launcher.cjs"], {
      cwd: ROOT, env: { ...process.env, CLOUDFLARED_STUB: "1" }, windowsHide: true,
    });
    await waitServer("http://localhost:4300/").catch(() => {});
    await sleep(300);

    // 3) navegador
    browser = await chromium.launch();
    ctx = await browser.newContext({ serviceWorkers: "block" });
    page = await ctx.newPage();
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

    await page.goto("http://localhost:4183/chat.html", { waitUntil: "networkidle" });
    await page.waitForSelector("#displayName", { timeout: 8000 });

    // login mínimo
    await page.fill("#displayName", "Tester");
    await page.fill("#username", "share-room-" + Date.now());
    await page.click("button.btn-primary");
    await sleep(1500);

    // 4) abrir modal de share y pulsar "Crear enlace"
    await page.click("#shareLinkBtn");
    await page.waitForSelector("#shareLinkModal:not(.hidden)", { timeout: 4000 });
    ok("modal de enlace abierto");

    await page.click("#shareLinkCreateBtn");
    // esperar la URL en #shareLinkUrl
    await page.waitForFunction(
      () => {
        const v = document.getElementById("shareLinkUrl")?.value || "";
        return /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(v);
      },
      { timeout: 10000 }
    );
    const url = await page.$eval("#shareLinkUrl", (el) => el.value);
    ok("URL de túnel generada: " + url);
    const stopVisible = await page.$eval("#shareLinkStopBtn", (el) => !el.classList.contains("hidden"));
    if (stopVisible) ok('botón "Detener enlace" visible'); else fail('falta botón "Detener enlace"');

    // 5) detener enlace
    await page.click("#shareLinkStopBtn");
    await sleep(800);
    const stopped = await page.$eval("#shareLinkStatus", (el) => el.textContent || "");
    if (/detenido|stopped/i.test(stopped)) ok("enlace detenido confirmado"); else fail("no confirmó detención: " + stopped);

    // 6) verificar que el túnel murió (sin proceso huérfano): el launcher reporta active:false
    const status = await new Promise((resolve) => {
      http.get("http://localhost:4300/status", (res) => {
        let body = ""; res.on("data", (d) => (body += d));
        res.on("end", () => resolve(JSON.parse(body || "{}")));
      }).on("error", () => resolve({ active: true }));
    });
    if (status.active === false) ok("túnel muerto tras detener (sin proceso huérfano)");
    else fail("el túnel siguió vivo tras detener: " + JSON.stringify(status));

    if (consoleErrors.length) fail("errores consola: " + JSON.stringify(consoleErrors));
    else ok("0 errores de consola");

  } catch (e) {
    failed = true;
    console.log("  ✗ EXCEPCIÓN: " + e.message);
  } finally {
    if (page) await page.close().catch(() => {});
    if (ctx) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (launcher) try { launcher.kill("SIGTERM"); } catch {}
    // No matamos el relay compartido (ya estaba vivo en la sesión).
  }

  console.log(failed ? "\nSHARE_E2E_FAIL" : "\nSHARE_E2E_OK");
  process.exit(failed ? 1 : 0);
})();
