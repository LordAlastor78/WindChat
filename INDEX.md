# 🌬️ WindChat — Punto de inicio

Bienvenido a **WindChat**.  
Chat web cifrado E2EE, efímero y ultra-ligero.

---

## 🎯 ¿Qué quieres hacer?

### 🚀 "Quiero empezar YA"
👉 [QUICKSTART.md](QUICKSTART.md)
- Setup en 2 minutos
- Testing en 3 pasos
- Troubleshooting básico

### 📚 "Quiero entender el proyecto"
👉 [README.md](README.md)
- Arquitectura completa
- Especificación criptográfica
- Seguridad y limitaciones
- Deployment

### 📋 "Quiero ver los scripts disponibles"
👉 [SCRIPTS.md](SCRIPTS.md)
- `.\setup.ps1` — Setup inicial
- `.\dev.ps1` — Dev diario (⭐ MÁS USADO)
- `.\build.ps1` — Build producción
- npm comandos

### 📖 "Quiero revisar el plan original"
👉 [PROJECT_PLAN.md](PROJECT_PLAN.md)
- Plan paso a paso del desarrollo
- Stack técnico justificado
- Checklist pre-implementación

---

## 🔥 Empezar (3 comandos)

```powershell
# 1. Setup inicial (primera vez)
.\setup.ps1

# 2. Desarrollo
.\dev.ps1

# 3. Abre navegador
# https://localhost:3000
```

Eso es todo. Ambos están en desarrollo con hot reload.

---

## 🗂️ Estructura del código

```
windchat/
├── ⭐ server/src/index.ts        # Servidor WebSocket
├── ⭐ client/src/
│   ├── crypto.ts                # Criptografía (el corazón)
│   ├── websocket.ts             # Cliente WS
│   ├── ui.ts                    # DOM helpers
│   └── main.ts                  # Orquestación
├── shared/protocol.ts           # Tipos compartidos
└── (configs, docs, etc)
```

**⭐** = archivos críticos para entender

---

## 🔐 Seguridad (1 minuto)

✅ **E2EE real:** AES-256-GCM autenticado  
✅ **Intercambio de claves:** ECDH P-256 (nativo)  
✅ **Derivación:** HKDF-SHA256  
✅ **Servidor ciego:** No ve contenido  
✅ **Efímero:** Sin persistencia  

⚠️ **Limitaciones MVP (por diseño):**
- No tiene forward secrecy por mensaje (viene en v2)
- No autentica identidad de usuarios (confía en enlace compartido)
- Metadata visible (quién conecta cuándo)

---

## 📊 Stack

| Parte | Tech | Por qué |
|------|------|---------|
| Server | Node.js + ws | Ligero, rápido, suficiente |
| Client | TypeScript + Vite | Type-safe + dev experience |
| Crypto | Web Crypto API | Nativo, no deps externas |
| UI | HTML5 + CSS | Minimalista, celeste |
| Deploy | Cloudflare Tunnel | HTTPS gratis, fácil |

---

## 🎯 Estado actual

| Aspecto | Estado |
|---------|--------|
| Criptografía | ✅ Funcional |
| Server | ✅ Funcional |
| Client | ✅ Funcional |
| UI | ✅ Funcional |
| Testing | ✅ Manual |
| Deploy | ✅ Listo |
| Docs | ✅ Completa |

**Fase 1 (MVP) = Terminada** ✅

---

## 📋 Archivos principales

| Archivo | Lee esto si... | Tiempo |
|---------|----------------|--------|
| [QUICKSTART.md](QUICKSTART.md) | Quieres empezar | 5 min |
| [SCRIPTS.md](SCRIPTS.md) | No sabes qué comando usar | 3 min |
| [README.md](README.md) | Quieres entender todo | 15 min |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | Quieres el plan detallado | 20 min |
| `server/src/index.ts` | Quieres ver el servidor | 10 min |
| `client/src/crypto.ts` | Quieres ver la criptografía | 15 min |
| `.env.example` | Quieres configurar parámetros | 2 min |

---

## ❓ Preguntas frecuentes

**P: ¿Qué necesito instalar?**  
R: Node.js 20+ ([descargar](https://nodejs.org)). Eso es todo.

**P: ¿Funciona en mi navegador?**  
R: Chrome 92+, Firefox 91+, Safari 15+ (Web Crypto nativa)

**P: ¿Puedo deployar a la web?**  
R: Sí, con Cloudflare Tunnel es gratis. Ver README.md sección "Deploy"

**P: ¿Es realmente seguro?**  
R: Sí, dentro de  su alcance (MVP). Ver limitaciones conocidas.

**P: ¿Puedo meterle cambios?**  
R: Claro. Todo está comentado y bien estructurado.

---

## 🚀 Próximas fases

### Fase 2 (1-2 semanas)
- [ ] Adjuntos cifrados
- [ ] Double Ratchet (forward secrecy)
- [ ] Key verification (fingerprints)
- [ ] Tests automatizados

### Fase 3 (opcional)
- [ ] WebRTC P2P
- [ ] Persistencia cifrada (IndexedDB)
- [ ] Mobile app (React Native)

---

## 🎬 ¡Listo!

```powershell
.\dev.ps1
```

Abre `https://localhost:3000` y disfruta. 🎉

---

**Dudas?** Revisa [README.md](README.md#-debugging) sección debugging.  
**Stuck?** [QUICKSTART.md](QUICKSTART.md#-si-algo-falla)
