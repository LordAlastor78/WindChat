# PR: Verificación anti-MITM (SAS) + endurecimiento de seguridad

## Contexto

Auditoría del proyecto. La criptografía base ya era correcta (ECDH P-256 →
HKDF-SHA256 → AES-256-GCM, IV aleatorio por mensaje, timestamp dentro del
ciphertext), pero faltaba la pieza que convierte el claim "E2EE" en algo
verificable, y había una vulnerabilidad explotable en el servido de estáticos.

---

## 1. Safety Number (SAS) — verificación anti-MITM  ⬅️ lo importante

### El problema

El servidor era la **autoridad de claves**: en `broadcastPeerJoined()` reparte
la clave pública de cada peer al otro. Un servidor malicioso —o quien controle
el túnel de Cloudflare— podía hacer un **doble handshake**: entregar su propia
clave a cada lado, descifrar, leer y volver a cifrar. Ambos clientes verían
"🔐 Cifrado listo" sin que nada fallara.

La premisa "córrelo en tu propio PC" mitiga esto socialmente, no
criptográficamente.

### La solución

Se deriva un **Short Authentication String** a partir de **ambas** claves
públicas + el roomId:

```
SHA-256( "WindChat-SAS-v1|<roomId>|" || pubA || pubB )
```

Las claves se ordenan lexicográficamente antes de hashear, así ambos extremos
obtienen el mismo valor sin negociar roles. Se presenta como:

- **6 grupos de 5 dígitos** (estilo Signal safety number)
- **5 emojis** de un alfabeto de 64 (comparación visual rápida)
- 8 bytes en hex

Si hay un MITM, cada lado calcula un SAS **distinto** → los usuarios lo
detectan comparándolo por voz o en persona.

### En la UI

- Badge `⚠️ Sin verificar` / `✅ Sesión verificada` en la barra de sala
- Panel desplegable con emojis, dígitos, instrucciones y aviso de no-coincidencia
- Botón "Coincide, verificar"
- El SAS se **invalida** al reconectar (se regeneran las claves ECDH) y al
  desconectarse el peer

---

## 2. Path traversal en el servido de estáticos (vulnerabilidad real)

El handler hacía `path.join(clientDistPath, req.originalUrl)`. `originalUrl`
**no** está normalizado por Express.

Verificado explotable con la lógica original:

```
200  escapes_dist=true  /../../package.json         -> WindChat\package.json
200  escapes_dist=true  /../../server/src/index.ts  -> WindChat\server\src\index.ts
```

**Arreglado** sustituyéndolo por `express.static` (normaliza y bloquea `../`,
`%2e%2e` y bytes nulos) + fallback SPA que no construye rutas con entrada del
cliente. `dotfiles: "ignore"` para `.env` y similares.

Verificado tras el arreglo con curl contra el servidor real: todos los payloads
devuelven `index.html`, ninguno filtra el archivo.

---

## 3. Fin de la triplicación del protocolo

`shared/protocol.ts`, `client/src/protocol.ts` y `server/src/protocol.ts` eran
tres archivos distintos que ya habían divergido:

- el cliente no tenía `ping`/`pong`
- el servidor no tenía ni `ping`/`pong` ni los tipos de fichero

Ahora `shared/protocol.ts` es la **fuente única de verdad** y las copias se
generan con `scripts/sync-protocol.js`:

```bash
npm run sync:protocol   # regenera las copias
npm run check:protocol  # falla si están desincronizadas (corre en npm test)
```

Se añadió también `ServerStatusMessage` al union (antes se colaba con `as any`).

---

## 4. Robustez y privacidad del servidor

- **Heartbeat O(n²) eliminado.** Hacía `Array.from(rooms.values()).flatMap(...).find(...)`
  por cada cliente en cada barrido, más un `setTimeout` por cliente y barrido.
  Reemplazado por el patrón estándar `__isAlive` de dos fases. El resultado ni
  siquiera se usaba.
- **Validación de tamaño antes de `JSON.parse`.** Antes se parseaban hasta 10 MB
  de JSON *y después* se comprobaba el tamaño.
- **Validación de clave P-256 en el servidor** (65 bytes, empieza por `0x04`).
  Antes solo se comprobaba que fuese base64, así que el servidor podía reenviar
  basura que rompía al peer.
- **Logging con fugas de metadatos silenciado por defecto.** Registraba roomId,
  displayName, tamaño de cada mensaje y quién hablaba con quién — incoherente
  con el objetivo de zero telemetría. Ahora tras `VERBOSE_LOGS=true`.
- Guarda de tipo para mensajes sin `type` válido.
- Eliminado `client/tsconfig copy.json`.

---

## 5. `npm test` ahora ejecuta tests

`"test": "npm run build && npm run start"` compilaba y **arrancaba el
servidor** — no ejecutaba ni un test. Los tests había que lanzarlos a mano.

```json
"test": "npm run check:protocol && vitest run -c client/vitest.config.ts"
```

---

## Verificación

| Comprobación | Resultado |
|---|---|
| `npm test` | **55/55** (antes 41; +14 nuevos) |
| `npm run build` | verde (server tsc + client tsc/vite) |
| `tsc --noEmit` client y server | sin errores |
| E2E contra servidor real | 11/11 comprobaciones |
| Path traversal (curl, 8 payloads) | todos bloqueados |
| Navegador real, 2 peers | SAS idéntico en ambos |
| Errores JS en consola | 0 |

**SAS confirmado en navegador vs peer independiente:**

```
navegador (Alice): 65601 42690 15129 27280 80328 74978   📷 🌲 🐵 🍕 🌽
peer headless (Bob): 65601 42690 15129 27280 80328 74978   📷 🌲 🐵 🍕 🌽
```

Tests nuevos:
- `client/src/tests/safety-number.test.ts` (9) — incluye el test clave: un MITM
  que interpone su clave con cada lado produce SAS distintos
- `client/src/tests/path-traversal.test.ts` (5) — documenta la regresión

Herramientas:
- `tools/integration/e2e_sas_check.js` — E2E completo contra servidor real
- `tools/integration/peer_hold.js` — peer headless para probar la UI

---

## Riesgo residual (no abordado en este PR)

- **Sin PFS por mensaje.** Una sola clave de sesión por conversación: si se
  compromete, cae todo el historial de esa sala. Siguiente escalón: un ratchet,
  aunque sea rotando cada N mensajes.
- **El SAS requiere acción del usuario.** Si nadie lo compara, no protege de
  nada. Es la limitación inherente de un SAS; la alternativa es TOFU con claves
  persistentes.
- La verificación no se persiste entre sesiones (efímero por diseño).

## Orden de revisión sugerido

1. `client/src/crypto.ts` — derivación del SAS (lo importante)
2. `client/src/tests/safety-number.test.ts` — sobre todo el test de MITM
3. `server/src/index.ts` — `express.static` y el heartbeat
4. `scripts/sync-protocol.js` — el mecanismo anti-divergencia
