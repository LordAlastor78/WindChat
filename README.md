# WindChat - Plataforma de Mensajería Cifrada End-to-End

**WindChat** es una solución de mensajería web instantánea con cifrado extremo a extremo (E2EE) certificado por estándares criptográficos modernos. Implementa un sistema de comunicación seguro, efímero y de arquitectura zero-knowledge donde el servidor actúa únicamente como relay de mensajes sin capacidad de descifrar el contenido.

<img src="https://raw.githubusercontent.com/LordAlastor78/WindChat.png" width="100">

---

## Tabla de Contenidos

- [Resumen Ejecutivo](#resumen-ejecutivo)
- [Características Técnicas](#características-técnicas)
- [Arquitectura del Sistema](#arquitectura-del-sistema)
- [Especificación Criptográfica](#especificación-criptográfica)
- [Instalación y Configuración](#instalación-y-configuración)
- [Despliegue en Producción](#despliegue-en-producción)
- [Pruebas y Validación](#pruebas-y-validación)
- [Seguridad y Auditoría](#seguridad-y-auditoría)
- [Limitaciones Conocidas](#limitaciones-conocidas)
- [Roadmap y Desarrollo Futuro](#roadmap-y-desarrollo-futuro)
- [Contribución y Licencia](#contribución-y-licencia)

---

## Resumen Ejecutivo

WindChat proporciona un canal de comunicación bidireccional con las siguientes garantías:

- **Confidencialidad absoluta**: Los mensajes son cifrados en el cliente usando AES-256-GCM antes de la transmisión
- **Autenticación criptográfica**: Cada mensaje incluye un tag de autenticación que garantiza integridad
- **Arquitectura zero-knowledge**: El servidor no almacena ni puede acceder al contenido de las comunicaciones
- **Ephemeral by design**: No existe persistencia de datos; todas las comunicaciones residen exclusivamente en memoria
- **Footprint mínimo**: Implementación ligera con menos de 5MB de recursos descargables

### Casos de Uso

- Comunicaciones confidenciales entre dos partes
- Intercambio de información sensible sin persistencia
- Entornos que requieren compliance con regulaciones de privacidad (GDPR, HIPAA)
- Prototipado de sistemas de mensajería segura

---

## Características Técnicas

### Seguridad

| Componente | Implementación | Estándar |
|------------|----------------|----------|
| Cifrado simétrico | AES-256-GCM | NIST FIPS 197, NIST SP 800-38D |
| Intercambio de claves | ECDH P-256 | NIST FIPS 186-4, RFC 6090 |
| Derivación de claves | HKDF-SHA-256 | RFC 5869 |
| Vector de inicialización | 96 bits aleatorios (crypto.getRandomValues) | NIST SP 800-38D |
| Autenticación | GCM Authentication Tag (128 bits) | NIST SP 800-38D |

### Infraestructura

- **Backend**: Node.js con WebSocket (ws library)
- **Frontend**: TypeScript, Vite, Web Crypto API nativa
- **Protocolo**: WebSocket sobre TLS (WSS en producción)
- **Arquitectura**: Monorepo con workspaces npm
- **Testing**: Vitest con 36 test suites

### Rendimiento

- **Latencia de cifrado**: < 5ms por mensaje (promedio)
- **Tamaño de bundle**: 33.42 KB (JavaScript), 22.25 KB (HTML)
- **Capacidad**: 2 usuarios por sala (diseño intencional)
- **Límite de mensaje**: 10 MB por defecto (configurable)

---

[![Soporte al Proyecto](https://storage.ko-fi.com/cdn/kofi6.png?v=4)](https://ko-fi.com/alastor78)



## Arquitectura del Sistema

### Estructura del Proyecto

```
windchat/
├── server/                    # Servidor WebSocket (Node.js + TypeScript)
│   ├── src/
│   │   ├── index.ts          # Lógica principal del servidor
│   │   └── protocol.ts       # Definiciones de protocolo del servidor
│   ├── package.json
│   └── tsconfig.json
│
├── client/                    # Aplicación cliente (TypeScript + Vite)
│   ├── src/
│   │   ├── main.ts           # Punto de entrada y orquestación
│   │   ├── crypto.ts         # Módulo criptográfico (Web Crypto API)
│   │   ├── websocket.ts      # Cliente WebSocket con reconexión automática
│   │   ├── ui.ts             # Gestión de interfaz y DOM
│   │   ├── protocol.ts       # Definiciones de protocolo del cliente
│   │   └── i18n.ts           # Internacionalización
│   ├── public/
│   │   ├── index.html        # HTML estático
│   │   └── manifest.json     # PWA manifest
│   ├── chat.html             # Interfaz de chat
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── shared/                    # Definiciones de tipos compartidas
│   └── protocol.ts           # Contrato de comunicación cliente-servidor
│
├── run.ps1                   # Script de gestión para Windows
├── setup.ps1                 # Script de instalación inicial
└── package.json              # Configuración del workspace monorepo
```

### Diagrama de Flujo de Comunicación

```
┌─────────────┐                    ┌─────────────┐                    ┌─────────────┐
│  Cliente A  │                    │   Servidor  │                    │  Cliente B  │
│             │                    │ (WebSocket) │                    │             │
└──────┬──────┘                    └──────┬──────┘                    └──────┬──────┘
       │                                  │                                  │
       │ 1. Genera KeyPair P-256          │                                  │
       │────────────────────────────────> │                                  │
       │                                  │                                  │
       │                                  │ 2. Genera KeyPair P-256          │
       │                                  │ <────────────────────────────────│
       │                                  │                                  │
       │ 3. Intercambia claves públicas   │ 4. Intercambia claves públicas   │
       │ <────────────────────────────────│─────────────────────────────────>│
       │                                  │                                  │
       │ 5. Deriva clave compartida (ECDH + HKDF)                            │
       │                                  │   Deriva clave compartida (ECDH + HKDF) 
       │                                  │                                  │
       │ 6. Cifra mensaje con AES-GCM     │                                  │
       │────────────────────────────────> │                                  │
       │                                  │ 7. Relay ciego (sin descifrar)   │
       │                                  │─────────────────────────────────>│
       │                                  │                                  │
       │                                  │     8. Descifra con AES-GCM      │
       │                                  │                                  │
```

**Principio fundamental**: El servidor actúa como un relay opaco. Solo conoce metadatos de conexión (timestamp, tamaño del mensaje, identificadores de sala) pero nunca el contenido del mensaje.

---

## Especificación Criptográfica

### Primitivas Criptográficas

| Componente | Algoritmo | Detalles Técnicos |
|-----------|----------|-------------------|
| **Intercambio de claves** | ECDH P-256 (secp256r1) | Curva elíptica de 256 bits, implementación nativa en Web Crypto API |
| **Derivación de claves** | HKDF-SHA-256 | Key Derivation Function con SHA-256, salt derivado de hash(roomId) |
| **Cifrado simétrico** | AES-256-GCM | Advanced Encryption Standard con Galois/Counter Mode, clave de 256 bits |
| **Vector de inicialización** | Random 96 bits | Generado con crypto.getRandomValues() por mensaje, nunca reutilizado |
| **Autenticación** | GCM Authentication Tag | Tag de 128 bits incluido en el ciphertext, valida integridad |
| **Codificación** | Base64 | Para serialización de datos binarios en JSON |
| **Timestamp** | Incluido en plaintext | Cifrado junto con el mensaje, no visible para el servidor |

### Protocolo Criptográfico Detallado

#### Fase 1: Establecimiento de Conexión

1. **Generación de Par de Claves**: Cada cliente genera un par de claves ECDH P-256
2. **Exportación**: Claves públicas se exportan en formato raw y codifican en base64
3. **Envío**: Ambos clientes envían sus claves públicas al servidor con el roomId
4. **Intercambio**: El servidor retransmite las claves públicas entre clientes

#### Fase 2: Derivación de Clave Compartida

5. **ECDH**: Cada cliente calcula el secreto compartido usando su clave privada y la clave pública del peer
6. **HKDF**: El secreto compartido se deriva usando HKDF-SHA-256 con salt = hash(roomId) para obtener la clave AES-256

**Nota crítica**: El servidor nunca participa en el cálculo del secreto compartido. Solo actúa como intermediario para el intercambio de claves públicas.

#### Fase 3: Cifrado y Transmisión

7. **Cifrado**: 
   - Se genera un IV aleatorio de 96 bits para cada mensaje
   - El mensaje se cifra con AES-256-GCM usando la clave derivada
   - El resultado incluye el ciphertext y el authentication tag
   
8. **Transmisión**: El paquete {iv, ciphertext} se envía al servidor en formato JSON
9. **Relay**: El servidor retransmite el paquete sin modificarlo ni intentar descifrarlo
10. **Descifrado**: El cliente receptor descifra usando la misma clave AES-256 y verifica el authentication tag

### Garantías Criptográficas

- **Confidencialidad**: Protección contra lectura no autorizada mediante AES-256
- **Integridad**: Detección de modificaciones mediante GCM authentication tag
- **Autenticidad**: Verificación de origen mediante clave compartida
- **Forward Secrecy**: No implementado en v1 stable (roadmap para v2.0)
- **Zero-Knowledge Server**: El servidor no puede descifrar ningún contenido

---

## Instalación y Configuración

### Requisitos Previos

- **Node.js**: v18.0.0 o superior
- **npm**: v8.0.0 o superior
- **Sistema operativo**: Windows, macOS, o Linux
- **Navegador**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+ (compatibilidad con Web Crypto API)

### Instalación Rápida (Windows)

Para sistemas Windows, se incluyen scripts PowerShell automatizados:

```powershell
# Instalación inicial (primera vez)
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
.\setup.ps1

# Ejecución posterior
.\run.ps1
```

El script `run.ps1` proporciona un menú interactivo con las siguientes opciones:
- Iniciar servidor y cliente en modo desarrollo
- Compilar para producción
- Ejecutar tests
- Gestión de procesos de Cloudflare Tunnel

### Instalación Manual (Multiplataforma)

#### 1. Instalación de Dependencias

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/windchat.git
cd windchat

# Instalar dependencias del workspace
npm install

# Instalar dependencias de servidor y cliente
npm install --workspace=server --workspace=client
```

#### 2. Configuración de Variables de Entorno

Crear archivo de configuración (opcional):

```bash
cp .env.example .env
```

Editar `.env` según requerimientos:

```bash
# Puerto del servidor WebSocket
PORT=8080

# Límite de usuarios por sala
MAX_USERS_PER_ROOM=2

# Tamaño máximo de mensaje (bytes)
MAX_MESSAGE_SIZE=10485760
```

#### 3. Compilación del Proyecto

```bash
# Compilar servidor
npm run build --workspace=server

# Compilar cliente
npm run build --workspace=client
```

#### 4. Ejecución en Modo Desarrollo

**Terminal 1 - Servidor:**
```bash
cd server
npm run dev
```

**Terminal 2 - Cliente:**
```bash
cd client
npm run dev
```

El servidor escuchará en `http://localhost:8080` y el cliente en `http://localhost:3000`.

### Validación de la Instalación

1. Abrir `http://localhost:3000` en el navegador A
2. Hacer clic en "Crear / Conectar" para generar una sala
3. Copiar el Room ID que aparece en la interfaz
4. Abrir `http://localhost:3000` en el navegador B (pestaña de incógnito o navegador diferente)
5. Pegar el Room ID y hacer clic en "Conectar"
6. Verificar que ambos clientes se conectan y pueden intercambiar mensajes

**Documentación adicional**: Consultar [QUICKSTART.md](QUICKSTART.md) para guías detalladas y [SCRIPTS.md](SCRIPTS.md) para información sobre scripts de gestión.

---

## Despliegue en Producción

### Construcción de Artefactos

```bash
# Construcción completa del proyecto
npm run build

# O por separado
npm run build --workspace=server
npm run build --workspace=client
```

Resultados de la compilación:
- **Servidor**: `server/dist/index.js` (aplicación Node.js compilada)
- **Cliente**: `client/dist/` (assets estáticos listos para servir)

### Opciones de Despliegue

#### Opción 1: Servidor Dedicado (VPS/Cloud)

**Requisitos del servidor:**
- Node.js 18+ instalado
- Puerto 8080 abierto (o configurado)
- Certificado SSL para WSS (WebSocket Secure)
- Reverse proxy recomendado (nginx/caddy)

**Configuración de nginx:**

```nginx
server {
    listen 443 ssl http2;
    server_name tu-dominio.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # Cliente estático
    location / {
        root /path/to/windchat/client/dist;
        try_files $uri $uri/ /index.html;
    }
    
    # WebSocket proxy
    location /ws {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

**Iniciar servidor:**

```bash
cd server
node dist/index.js

# O con PM2 para gestión de procesos
npm install -g pm2
pm2 start dist/index.js --name windchat-server
pm2 startup
pm2 save
```

#### Opción 2: Cloudflare Tunnel (Recomendado para Desarrollo)

Cloudflare Tunnel proporciona HTTPS automático sin necesidad de configurar certificados.

**1. Instalación de cloudflared:**

```bash
# Windows (PowerShell como administrador)
choco install cloudflared

# macOS
brew install cloudflare/cloudflare/cloudflared

# Linux
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

**2. Construcción y ejecución:**

```bash
# Terminal 1: Compilar y ejecutar servidor
cd server
npm run build
node dist/index.js

# Terminal 2: Crear tunnel
cloudflared tunnel --url http://localhost:8080
```

Cloudflared generará una URL pública:
```
https://random-name-1234.trycloudflare.com
```

**3. Configurar cliente para usar el tunnel:**

```bash
VITE_SERVER_URL=https://random-name-1234.trycloudflare.com npm run dev:client
```

#### Opción 3: Despliegue con Docker

**Dockerfile para servidor:**

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY server/package*.json ./server/

RUN npm install --workspace=server --production

COPY server/dist ./server/dist

EXPOSE 8080

CMD ["node", "server/dist/index.js"]
```

**Docker Compose:**

```yaml
version: '3.8'

services:
  windchat-server:
    build: .
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
      - MAX_USERS_PER_ROOM=2
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
    volumes:
      - ./client/dist:/usr/share/nginx/html
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
      - ./certs:/etc/nginx/certs
    depends_on:
      - windchat-server
    restart: unless-stopped
```

### Consideraciones de Seguridad en Producción

1. **Usar HTTPS/WSS obligatoriamente**: Web Crypto API requiere contexto seguro
2. **Rate limiting**: Implementar límites de conexión por IP
3. **CORS configurado correctamente**: Restricción de orígenes permitidos
4. **Headers de seguridad**:
   ```
   Content-Security-Policy: default-src 'self'
   X-Frame-Options: DENY
   X-Content-Type-Options: nosniff
   ```
5. **Monitoreo**: Implementar logging y alertas para conexiones anómalas
6. **Firewall**: Restringir acceso a puerto del servidor solo a través de proxy

### Configuración de Performance

**Variables de entorno para producción:**

```bash
NODE_ENV=production
PORT=8080
MAX_USERS_PER_ROOM=2
MAX_MESSAGE_SIZE=10485760  # 10MB
LOG_LEVEL=error            # Reducir logging en producción
```



---

## Pruebas y Validación

### Suite de Tests Automatizados

El proyecto incluye 36 tests automatizados que validan:

```bash
# Ejecutar todos los tests
npm test

# Ejecutar tests con UI interactiva
cd client
npm run test:ui

# Ejecutar tests con cobertura
npm run test:coverage
```

**Categorías de tests:**

1. **Tests Criptográficos** (`crypto.test.ts`)
   - Generación de pares de claves ECDH P-256
   - Derivación correcta de claves compartidas
   - Cifrado/descifrado con AES-256-GCM
   - Unicidad de IVs
   - Validación de authentication tags

2. **Tests de Integración** (`integration.test.ts`)
   - Handshake completo entre dos clientes
   - Intercambio de claves públicas
   - Transmisión de mensajes cifrados
   - Descifrado correcto en el receptor

3. **Tests de WebSocket** (`websocket.test.ts`)
   - Establecimiento de conexión
   - Reconexión automática con backoff exponencial
   - Manejo de desconexiones
   - Validación de límites de sala

### Checklist de Validación Manual

#### Seguridad Criptográfica

- [ ] Claves ECDH P-256 se generan correctamente en ambos clientes
- [ ] Claves públicas se intercambian a través del servidor
- [ ] Ambos clientes derivan el mismo secreto compartido (validar en console)
- [ ] Cada mensaje utiliza un IV único (verificar logs de console)
- [ ] Authentication tags se validan correctamente
- [ ] Mensajes manipulados fallan al descifrar
- [ ] Servidor no registra contenido de mensajes en logs

#### Funcionalidad de Red

- [ ] Handshake WebSocket se completa sin errores
- [ ] Máximo 2 usuarios pueden conectarse por sala
- [ ] Tercera conexión a la misma sala es rechazada con error apropiado
- [ ] Desconexión de un cliente notifica al otro
- [ ] Reconexión automática funciona tras desconexión temporal
- [ ] Mensajes se transmiten en orden correcto
- [ ] Latencia de mensajes es aceptable (< 100ms en red local)

#### Interfaz de Usuario

- [ ] Room ID se genera y se muestra correctamente
- [ ] Botón de copiar Room ID funciona
- [ ] Mensajes propios se muestran a la derecha
- [ ] Mensajes del peer se muestran a la izquierda
- [ ] Timestamps son precisos y legibles
- [ ] Indicador "escribiendo..." aparece cuando el peer está escribiendo
- [ ] Tema claro/oscuro funciona correctamente
- [ ] Notificaciones de sonido funcionan (si están habilitadas)
- [ ] Interfaz responsive en móvil

#### Seguridad de Producción
- [ ] HTTPS/WSS están activos en producción (no HTTP/WS)
- [ ] No hay datos sensibles en URL o parámetros GET
- [ ] No se usa `innerHTML` para contenido dinámico (solo `textContent`)
- [ ] Headers de seguridad CSP configurados
- [ ] No hay warnings de Mixed Content en console
- [ ] Certificados SSL son válidos y no auto-firmados

### Debugging y Diagnóstico

#### Logs de Consola del Cliente

Abrir Chrome DevTools (F12) → Console para ver el flujo criptográfico:

```
✅ KeyPair generado exitosamente
📤 Enviando clave pública al servidor
🔑 Clave pública del peer recibida
✅ Secreto compartido derivado con éxito
🔒 Mensaje cifrado: IV=abc123...
📤 Mensaje enviado al servidor
📬 Mensaje recibido del peer
🔓 Mensaje descifrado exitosamente
```

#### Inspección de Tráfico WebSocket

DevTools → Network → Filtrar por "WS" para ver frames:

```json
// Handshake
{
  "type": "handshake",
  "publicKey": "BHx2Y...",
  "roomId": "a1b2c3"
}

// Mensaje cifrado
{
  "type": "message",
  "iv": "dGVzdGl2MTIzNA==",
  "ciphertext": "ZW5jcnlwdGVkX2RhdGE="
}
```

**Nota**: El servidor nunca debe poder ver el contenido del mensaje en texto plano.

#### Logs del Servidor

El servidor en modo desarrollo registra:

```
[INFO] Cliente conectado: id=abc123, room=room-xyz
[INFO] Handshake recibido de cliente abc123
[INFO] Intercambio de claves completado en room room-xyz
[INFO] Mensaje retransmitido: de=abc123 a=def456 size=234 bytes
```

**Importante**: No debe haber logs con contenido descifrado de mensajes.

### Análisis de Performance

Para medir el rendimiento del cifrado:

```javascript
// En console del navegador
console.time('encrypt');
await cryptoManager.encrypt('mensaje de prueba');
console.timeEnd('encrypt');
// Resultado esperado: < 5ms
```



---

## Seguridad y Auditoría

### Modelo de Amenazas

#### Amenazas Mitigadas

| Amenaza | Mitigación | Estado |
|---------|--------------|--------|
| **Man-in-the-Middle** | Intercambio ECDH + HTTPS/WSS obligatorio | ✅ Mitigado |
| **Tampering de mensajes** | GCM Authentication Tag | ✅ Mitigado |
| **Replay attacks** | IV único por mensaje + timestamps | ✅ Mitigado |
| **Brute force de cifrado** | AES-256 (2^256 espacio de claves) | ✅ Mitigado |
| **Compromiso del servidor** | Arquitectura zero-knowledge | ✅ Mitigado |
| **Inyección XSS** | `textContent` solo, sin `innerHTML` | ✅ Mitigado |
| **Ataques de sincronización** | Implementación en tiempo constante de GCM | ✅ Mitigado |

#### Amenazas No Mitigadas (Limitaciones Conocidas)

| Amenaza | Razón | Roadmap |
|---------|--------|--------|
| **Forward Secrecy por mensaje** | Complejidad vs MVP | v2.0 (Double Ratchet) |
| **Autenticación de identidad** | Fuera del scope de MVP | v2.0 (Key fingerprints) |
| **Análisis de metadata** | Inherente a cualquier E2EE | Mitigación parcial posible |
| **Compromiso del endpoint** | No prevenible por software | Educación del usuario |
| **Ataques de denegación de servicio** | Sin rate limiting implementado | v2.0 |

### Características de Seguridad Implementadas

#### Generación de Números Aleatorios

- **Fuente**: `crypto.getRandomValues()` (Web Crypto API)
- **Calidad**: Criptográficamente seguro (CSPRNG)
- **Uso**: Generación de IVs, claves privadas

#### Derivación de Claves

- **Algoritmo**: HKDF-SHA-256 (RFC 5869)
- **Salt**: Derivado de hash SHA-256 del Room ID
- **Info**: Ninguno (campo vacío)
- **Output**: 256 bits para AES-256

#### Sanitización de Entrada

- **DOM**: Solo `textContent`, nunca `innerHTML` para contenido dinámico
- **URL**: No se almacenan datos sensibles en parámetros GET
- **Validación**: Tamaño máximo de mensaje aplicado en servidor

#### Manejo de Claves

- **Almacenamiento**: Solo en memoria, nunca en localStorage/sessionStorage
- **Ciclo de vida**: Claves destruidas al cerrar conexión
- **Exportación**: Claves privadas nunca salen del cliente
- **Formato**: Claves públicas en formato raw para intercambio

### Recomendaciones de Seguridad para Usuarios

1. **Usar solo en conexiones HTTPS/WSS**: El navegador bloqueará Web Crypto API en HTTP
2. **No compartir Room ID públicamente**: Es el único secreto compartido
3. **Verificar identidad por canal alternativo**: No hay autenticación de identidad implementada
4. **Usar en dispositivos confiables**: El endpoint puede estar comprometido
5. **No confiar en persistencia**: Los mensajes no se guardan; son efímeros por diseño

### Auditoría y Compliance

**Estado de auditoría**: No auditado profesionalmente. Este es un proyecto de código abierto educativo.

**Código abierto**: Todo el código fuente está disponible para revisión en GitHub.

**Estándares seguidos**:
- NIST FIPS 197 (AES)
- NIST FIPS 186-4 (ECDH)
- RFC 5869 (HKDF)
- RFC 6090 (ECC)
- NIST SP 800-38D (GCM)

**Nota importante**: Para entornos de producción críticos, se recomienda una auditoría de seguridad profesional antes del despliegue.



---

## Limitaciones Conocidas

WindChat v1 stable presenta las siguientes limitaciones conocidas:

### Limitaciones Técnicas

| Limitación | Descripción | Impacto | Plan de Mitigación |
|------------|--------------|---------|----------------------|
| **Sin Forward Secrecy** | La misma clave AES se usa para todos los mensajes de una sesión | Si la clave se compromete, todos los mensajes de esa sesión pueden descifrarse | v2.0: Implementar Double Ratchet Algorithm |
| **Sin autenticación de identidad** | No hay verificación de que el peer es quien dice ser | Vulnerable a MITM si el Room ID se intercepta | v2.0: Key fingerprints y verificación out-of-band |
| **Metadata visible** | Servidor ve timestamps, tamaño de mensajes, patrones de comunicación | Análisis de tráfico posible | Parcialmente mitigable con padding |
| **Sin persistencia** | Mensajes se pierden al cerrar la pestaña | No hay historial | Diseño intencional; v2.0 podría agregar IndexedDB local opcional |
| **Máximo 2 usuarios** | Hard limit de diseño | No soporta chats grupales | v2.0: Chats grupales con claves por participante |
| **Sin verificación de recepción** | No hay confirmación de que el mensaje fue recibido/leído | UX limitada | v2.0: Acknowledgements y read receipts |

### Limitaciones de Arquitectura ( aglunas por diseño intencional enfocado en la privacidad y seguridad)

- **In-memory storage**: Todas las salas residen en memoria; reiniciar el servidor cierra todas las conexiones
- **Single instance**: No hay distribución horizontal ni load balancing
- **Sin rate limiting**: Vulnerable a ataques de denegación de servicio
- **Sin monitoreo**: No hay métricas de rendimiento ni alertas integradas

### Comparación con Soluciones Maduras

| Característica | WindChat v1.0 | Signal | WhatsApp |
|----------------|---------------|--------|----------|
| E2EE | ✅ AES-256-GCM | ✅ Signal Protocol | ✅ Signal Protocol |
| Forward Secrecy | ❌ | ✅ Double Ratchet | ✅ Double Ratchet |
| Persistencia | ❌ | ✅ | ✅ |
| Chats grupales | ❌ | ✅ | ✅ |
| Autenticación | ❌ | ✅ | ✅ |
| Adjuntos | ❌ | ✅ | ✅ |
| Open source | ✅ | ✅ (cliente) | ❌ |
| Auditoría | ❌ | ✅ | ✅ (parcial) |

---

## Roadmap y Desarrollo Futuro

### Versión 2.0 (Q2-Q3 2026)

**Prioridad Alta:**
- [ ] **Double Ratchet Algorithm**: Implementar forward secrecy por mensaje
- [ ] **Key Verification**: Fingerprints de claves públicas para verificación out-of-band
- [ ] **Persistencia local**: IndexedDB para guardar historial cifrado en el cliente
- [ ] **Adjuntos cifrados**: Soporte para imágenes, videos, y archivos (< 25MB)
- [ ] **Rate limiting**: Protección contra abuso y DoS

**Prioridad Media:**
- [ ] **Read receipts**: Confirmación de recepción y lectura de mensajes
- [ ] **Reacciones a mensajes**: Emojis y reacciones rápidas
- [ ] **Responder mensajes**: Threading y quotes
- [ ] **Notificaciones push**: Usando Service Workers (PWA)
- [ ] **Chats grupales**: Soporte para 3-10 participantes

**Prioridad Baja:**
- [ ] **WebRTC P2P**: Modo P2P opcional sin servidor relay
- [ ] **Videollamadas**: Integración de video cifrado
- [ ] **Temas personalizables**: Sistema de themes avanzado
- [ ] **Bots y automatización**: API para bots

### Versión 3.0 (2027+)

- [ ] **Distribución horizontal**: Redis para state sharing entre instancias
- [ ] **App nativa**: Electron para desktop, React Native para móvil
- [ ] **Autenticación de usuarios**: Sistema opcional de cuentas


---

## Contribución y Licencia

### Cómo Contribuir

Las contribuciones son bienvenidas. Por favor:

1. **Fork** el repositorio
2. **Crear branch** para tu feature: `git checkout -b feature/nueva-funcionalidad`
3. **Commit** tus cambios: `git commit -am 'Agregar nueva funcionalidad'`
4. **Push** al branch: `git push origin feature/nueva-funcionalidad`
5. **Crear Pull Request** con descripción detallada

**Lineamientos:**
- Seguir el estilo de código existente
- Agregar tests para nuevas funcionalidades
- Actualizar documentación cuando sea necesario
- Commits descriptivos en español o inglés

### Áreas de Contribución

**Seguridad**: Reportes de vulnerabilidades (usar GitHub Security Advisories)
**Código**: Nuevas funcionalidades, bug fixes, optimizaciones
**Documentación**: Mejoras al README, guías, tutoriales
**Testing**: Nuevos tests, mejoras de cobertura
**Diseño**: UI/UX improvements
**Traducciones**: Internacionalización a otros idiomas

### Licencia

**GNU Affero General Public License v3.0 (AGPL-3.0)**

Copyright (c) 2026 WindChat Contributors

Este proyecto se distribuye bajo los terminos de la licencia **GNU AGPL v3.0**.

Puedes consultar el texto oficial completo aqui:

- https://www.gnu.org/licenses/agpl-3.0.html
- https://www.gnu.org/licenses/agpl-3.0.txt

Resumen:

- Permite usar, estudiar, modificar y redistribuir el software.
- Obliga a mantener el codigo fuente disponible bajo la misma licencia.
- Si se ofrece el software como servicio por red, tambien exige poner a disposicion el codigo fuente modificado a los usuarios de ese servicio.

---

## Información del Proyecto

**Fecha de inicio**: 4 de marzo de 2026  
**Versión actual**: v1 stable  
**Stack tecnológico**: Node.js, TypeScript, Web Crypto API, WebSocket, Vite  
**Licencia**: GNU AGPL v3.0  
**Mantenedor**: [@LordAlastor78](https://ko-fi.com/alastor78)

**Propósito**: Proporcionar una implementación de referencia de mensajería E2EE con arquitectura zero-knowledge, priorizando simplicidad, transparencia y seguridad sobre prácticas criptográficas modernas.

**Seguridad**: Cifrado extremo a extremo real sin base de datos ni persistencia. El servidor actúa como relay ciego sin capacidad de descifrar mensajes. Comparte tu info solo con realmente quierers hacerlo. Adiós a los mensajes que se quedan en la nube para siempre.

---

## Contacto y Soporte

[![Soporte al Proyecto](https://storage.ko-fi.com/cdn/kofi6.png?v=4)](https://ko-fi.com/alastor78)

- **Issues**: [GitHub Issues](https://github.com/LordAlastor78/windchat/issues)
- **Discussions**: [GitHub Discussions](https://github.com/LordAlastor78/windchat/discussions)
- **Soporte**: [![Ko-fi](https://storage.ko-fi.com/cdn/kofi6.png?v=6)](https://ko-fi.com/alastor78)

**Nota**: Esta versión se considera estable para uso general, pero puede contener fallos no detectados todavía. Para preguntas, sugerencias o reportes de bugs, por favor utiliza los canales de GitHub o apóyanos en Ko-fi para acelerar el desarrollo. ¡Gracias por tu interés en WindChat! 

