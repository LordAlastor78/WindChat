# Análisis Criptográfico: Signal Protocol vs Ratchet actual

## Contexto
El usuario pregunta: "¿qué es más seguro?" para elegir entre migrar a Signal Protocol (libsignal) o reutilizar el ratchet actual (ECDH P-256 + HMAC-SHA256 + SAS).

---

## Matrix comparativa (seguridad real, no marketing)

| Criterio | Ratchet actual (ECDH P-256 + HMAC-SHA256) | Signal Protocol (libsignal) | Veredicto |
|---|---|---|---|
| **Forward secrecy** | ✅ Sí (HMAC-SHA256 chain ratchet por mensaje). Un mensaje comprometido no revela mensajes anteriores ni posteriores. | ✅ Sí (Double Ratchet: chain key + DH ratchet). | EMPATE |
| **Break-in recovery** | ❌ **NO.** Si una clave de mensaje es comprometida (device theft en ese momento), un atacante que capture tráfico futuro... el ratchet HMAC avanza, pero no hay DH ratchet para "curar" la clave raíz. Mensajes futuros siguen usando la misma cadena derivada de la raíz comprometida. | ✅ Sí (DH ratchet: cada mensaje genera un nuevo par DH, refrescando la raíz). Un device comprometido "se cura" al recibir un nuevo DH pubkey. | **Signal ventaja clara** |
| **Crypto deniability** | ✅ Sí (ECDH P-256 → SAS, no hay signatures que vinculen a identidad criptográficamente a un mensaje). El SAS es un fingerprint mutuo, no un proof de envío. | ✅ Sí (Ed25519 signatures solo para prekeys, no para mensajes; X3DH → Double Ratchet = deniable). | EMPATE |
| **Authenticación previa a la conversación (MITM)** | ✅ Sí (SAS anti-MITM: ambos comparan safety number. Si coincide, no hay MITM). Pero requiere intercambio manual fuera de banda (QR/audio). | ✅ Sí (X3DH: Ed25519-signed prekeys + identidad). En P2P, igual requiere verificación SAS fuera de banda (el artículo positive-intentions confirma). | EMPATE |
| **Out-of-order delivery** | ✅ Sí (MAX_SALTO_SKIP=256, cached skipped keys). | ✅ Sí (Double Ratchet maneja N messages out-of-order con cache). | EMPATE |
| **One-time prekeys (PFS inicial)** | ✅ Sí (ECDH efímero por sesión → PFS desde el primer mensaje). | ✅ Sí (one-time prekeys en X3DH). En P2P sin servidor, se hace real-time (3 DH, sin prekeys), según artículo positive-intentions. | EMPATE |
| **Auditoría / criptografía revisada** | ⚠️ Ratchet custom. El algoritmo es correcto (sigue las recetas de Signal Protocol pero simplificado). **No es revisado por terceros.** Riesgo: bugs sutiles de implementación. | ✅ **Revisado y auditado** por Signal Foundation + comunidad. Usado en producción por Signal/WhatsApp. **Código auditado.** | **Signal ventaja clara** |
| **Implementación de referencia oficial** | ❌ No. | ✅ `libsignal` es el código de referencia oficial. | **Signal ventaja clara** |
| **Complejidad (superficie de ataque)** | ✅ Baja (P-256 + HKDF + AES-GCM + HMAC). 4 primitivas bien entendidas. Menor superficie. | ⚠️ Media-alta (X3DH + Double Ratchet con DH ratchet + chain ratchet + sesión state machine). Más estados, más posibilidades de error. | **Ratchet actual ventaja ligera** (menos complejo) |
| **Madurez en Rust** | ❌ El ratchet actual está en TS, usando WebCrypto (C-speed). Portar a Rust requiere `p256`/`aes-gcm`/`hkdf` crates. | ⚠️ `libsignal-rust` = **experimental** (1 versión, 1.4k descargas). `libsignal-node` (TS) es estable production-ready. | **Ratchet actual ventaja** (p256/aes-gcm crates son maduras) |
| **Madurez en browser (TS/JS)** | ✅ WebCrypto nativo (SubtleCrypto). | ✅ `libsignal` (npm: `@privacyresearch/libsignal` o el oficial Signal no tiene npm público oficial para JS... realmente `libsignal` no expone npm oficial; hay forks como `npmjs.com/package/libsignal`). | Empate / leve ventaja Signal |
| **Tamaño/bundle** | ✅ Muy pequeño (usar WebCrypto, ~0 deps). | ⚠️ libsignal es ~2-3x más grande (X3DH + sesión state + prekeys). | **Ratchet actual ventaja** |

---

## Análisis profesional (como security engineer)

### ¿Es "más seguro" Signal Protocol?
**Sí, en sentido estricto**:
1. **Break-in recovery** es el feature killer que el ratchet actual NO tiene. En amenazas reales (device comprometido temporalmente), Signal Protocol "se cura"; el ratchet actual no.
2. **Auditoría de terceros**: el ratchet actual es "correcto por inspección" pero no auditado. Signal Protocol ha sido auditado múltiples veces.
3. **Implementación de referencia**: Signal Protocol elimina riesgo de bugs criptográficos de implementación (el peor enemigo del crypto engineering).

### ¿Es "menos seguro" el ratchet actual?
**No significativamente**:
1. El ratchet HMAC-SHA256 + AES-256-GCM es **criptográficamente sólido**. El "missing feature" (break-in recovery) es un **atributo de robustez operacional**, no un agujero de seguridad que haga que el cifrado actual sea roto.
2. La superficie de ataque es menor → menos bugs.
3. P-256 es NIST-approved, WebCrypto usa implementaciones C validadas.

### Trade-off real:
| Ventaja Signal | Coste |
|---|---|
| Break-in recovery + código auditado | + complejidad (DH ratchet state machine) |
| Código de referencia oficial | + dependencia en Rust es **experimental** (`libsignal-rust` 1 versión / 1.4k descargas) |
| Features avanzadas (prekeys, sender keys para grupos) | + bundle size +3x |

⚠️ **Riesgo clave en Rust**: `libsignal-rust` tiene **1 versión publicada** (es alpha/early beta). Para desktop en Rust, usarlo es arriesgado. La alternativa estable sería `libsignal-node` (TypeScript) sobre el V8 runtime de Tauri, pero añade una capa JS.

### Recomendación (security engineer, no marketing)
1. **Para la FASE 1 (MVP desktop P2P)**: migrar a Signal Protocol usando `libsignal-node` (TypeScript) dentro del Tauri WebView. Es **production-ready**, auditado, y Tauri ya ejecuta JS por lo tanto el coste es marginal. Esto da break-in recovery + código auditado SIN depender del experimental `libsignal-rust`.
2. **Para Android**: `libsignal` Java (oficial, production-ready) → JNI a Kotlin.
3. **Para el browser**: `libsignal` JS (browser build) sobre `RTCPeerConnection`.
4. **El ratchet actual NO se tira**: se mantiene como **opción alternativa** (modo "light crypto") o como baseline de test para validar que Signal Protocol produce el mismo nivel de forward secrecy.

### Conclusión para el usuario
> **Signal Protocol es "más seguro" pero no "menos seguro" el actual.**
> La diferencia real es **break-in recovery** (device comprometido → se cura) y **auditoría externa**.
> Para producción, **Signal Protocol gana**. El riesgo es **madurez en Rust** (`libsignal-rust` experimental) → mitigar usando `libsignal-node` (TS) dentro del WebView de Tauri.

---

## Decisión recomendada
**Usar Signal Protocol (`libsignal-node`) como capa cripto** sobre:
- Desktop Tauri: WebView ejecuta TS con `@privacyresearch/libsignal` (fork auditado) o el bindings oficial — el CryptoManager TS se reemplaza por libsignal Session.
- Browser: libsignal JS sobre `RTCPeerConnection`.
- Android: `libsignal` Java nativo.

**No usar `libsignal-rust`** (experimental).
