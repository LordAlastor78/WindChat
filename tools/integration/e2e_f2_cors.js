/**
 * E2E F-2: el launcher de share-link (localhost:4300) debe RECHAZAR (403)
 * peticiones desde un Origin no permitido (p.ej. un sitio malicioso),
 * y aceptar desde la UI local (localhost:4183).
 *
 * Uso: node tools/integration/e2e_f2_cors.js
 *       (requiere el launcher arrancado: node tools/link_launcher.cjs)
 */
const http = require("http");

function req(origin) {
  return new Promise((resolve) => {
    const r = http.request(
      { host: "localhost", port: 4300, path: "/share", method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" } },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode, acao: res.headers["access-control-allow-origin"], body }));
      }
    );
    r.on("error", (e) => resolve({ status: "ERR", error: e.message }));
    r.end();
  });
}

(async () => {
  let failed = false;
  const evil = await req("https://evil.com");
  console.log("evil.com ->", JSON.stringify(evil));
  if (evil.status !== 403) { console.log("✗ F-2: Origin malicioso NO fue rechazado (status=" + evil.status + ")"); failed = true; }
  else console.log("✅ F-2: Origin malicioso rechazado con 403");

  const good = await req("http://localhost:4183");
  console.log("localhost:4183 ->", JSON.stringify(good));
  if (good.status === 403) { console.log("✗ F-2: UI local rechazada (status=403)"); failed = true; }
  else console.log("✅ F-2: UI local permitida (status=" + good.status + ", ACAO=" + good.acao + ")");

  console.log(failed ? "F2_E2E_FAIL" : "F2_E2E_OK");
  process.exit(failed ? 1 : 0);
})();
