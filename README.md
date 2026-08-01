# WindChat - End-to-End Encrypted Messaging Platform



**WindChat** is an instant web messaging solution with end-to-end encryption (E2EE) based on modern cryptographic standards. It implements a secure, ephemeral, zero-knowledge communication system where the server can be hosted on your OWN computer, and deployed quickly in seconds. This is not a normal web-chat. Its YOUR own, personal, and private web - chat.

<div align="center">
<img src="./WindChat.png" alt="WindChat Logo" width="230">
</div>

[![Typing SVG](https://readme-typing-svg.demolab.com?font=Fira+Code&duration=6000&pause=2000&center=true&vCenter=true&width=585&height=90&lines=Fast+%2C+Private+and+Secure.+Ephemeral+as+wind)](https://git.io/typing-svg)

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Technical Features](#technical-features)
- [System Architecture](#system-architecture)
- [Cryptographic Specification](#cryptographic-specification)
- [Installation and Configuration](#installation-and-configuration)
- [Production Deployment](#production-deployment)
- [Testing and Validation](#testing-and-validation)
- [Security and Audit](#security-and-audit)
- [Known Limitations](#known-limitations)
- [Roadmap and Future Development](#roadmap-and-future-development)
- [Contributing and License](#contributing-and-license)

---

## Executive Summary

WindChat provides a bidirectional communication channel with the following guarantees:

- **Full confidentiality**: Messages are encrypted client-side with AES-256-GCM before transmission
- **Cryptographic authentication**: Each message includes an authentication tag that guarantees integrity
- **Ephemeral as wind**: This app uses ur own PC as server thanks cloudflare temp / quick tunnels. Nothing permantly here. When u close the sever , all wipes.
- **Ephemeral by design**: No data persistence; all communications live only in memory
- **Minimal footprint**: Lightweight implementation with less than 5 MB of downloadable assets

### Use Cases

- Confidential communication between two parties
- Exchange of sensitive information without persistence
- Environments requiring privacy compliance (GDPR, HIPAA)
- Prototyping secure messaging systems

---

## Technical Features

### Security

| Component | Implementation | Standard |
|-----------|----------------|----------|
| Symmetric encryption | AES-256-GCM | NIST FIPS 197, NIST SP 800-38D |
| Key exchange | ECDH P-256 | NIST FIPS 186-4, RFC 6090 |
| Key derivation | HKDF-SHA-256 | RFC 5869 |
| Initialization vector | 96 random bits (`crypto.getRandomValues`) | NIST SP 800-38D |
| Authentication | GCM Authentication Tag (128 bits) | NIST SP 800-38D |

### Infrastructure

- **Backend**: Node.js with WebSocket (`ws` library)
- **Frontend**: TypeScript, Vite, native Web Crypto API
- **Protocol**: WebSocket over TLS (WSS in production)
- **Architecture**: Monorepo with npm workspaces
- **Testing**: Vitest with 36 test suites

### Performance

- **Encryption latency**: < 5 ms per message (average)
- **Bundle size**: 33.42 KB (JavaScript), 22.25 KB (HTML)
- **Capacity**: 2 users per room (intentional design : u, and ur partner)
- **Message limit**: 10 MB by default (configurable)

---

[![Support the Project](https://storage.ko-fi.com/cdn/kofi6.png?v=4)](https://ko-fi.com/alastor78)

## System Architecture

### Project Structure

```
windchat/
├── server/                    # WebSocket server (Node.js + TypeScript)
│   ├── src/
│   │   ├── index.ts          # Main server logic
│   │   └── protocol.ts       # Server protocol definitions
│   ├── package.json
│   └── tsconfig.json
│
├── client/                    # Client application (TypeScript + Vite)
│   ├── src/
│   │   ├── main.ts           # Entry point and orchestration
│   │   ├── crypto.ts         # Cryptographic module (Web Crypto API)
│   │   ├── websocket.ts      # WebSocket client with auto-reconnect
│   │   ├── ui.ts             # UI and DOM management
│   │   ├── protocol.ts       # Client protocol definitions
│   │   └── i18n.ts           # Internationalization
│   ├── public/
│   │   ├── index.html        # Static HTML
│   │   └── manifest.json     # PWA manifest
│   ├── chat.html             # Chat interface
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── shared/                    # Shared type definitions
│   └── protocol.ts           # Client-server communication contract
│
├── run.ps1                   # Windows management script
├── setup.ps1                 # Initial setup script
└── package.json              # Monorepo workspace configuration
```

### Communication Flow Diagram

```
┌─────────────┐                    ┌─────────────┐                    ┌─────────────┐
│  Client A   │                    │   Server    │                    │  Client B   │
│             │                    │ (WebSocket) │                    │             │
└──────┬──────┘                    └──────┬──────┘                    └──────┬──────┘
       │                                  │                                  │
       │ 1. Generate P-256 key pair       │                                  │
       │────────────────────────────────> │                                  │
       │                                  │                                  │
       │                                  │ 2. Generate P-256 key pair       │
       │                                  │ <────────────────────────────────│
       │                                  │                                  │
       │ 3. Exchange public keys          │ 4. Exchange public keys          │
       │ <────────────────────────────────│─────────────────────────────────>│
       │                                  │                                  │
       │ 5. Derive shared key (ECDH + HKDF)                                  │
       │                                  │   Derive shared key (ECDH + HKDF)
       │                                  │                                  │
       │ 6. Encrypt message with AES-GCM  │                                  │
       │────────────────────────────────> │                                  │
       │                                  │ 7. Blind relay (no decryption)   │
       │                                  │─────────────────────────────────>│
       │                                  │                                  │
       │                                  │     8. Decrypt with AES-GCM      │
       │                                  │                                  │
```

**Core principle**: This app focuses on your self-hosted server. The key idea is that everything is temporary: the rooms, the URL used to access the chat, and even the server itself. It is designed to start when needed, share information, and then shut down as if it had never existed — secure and private.

---

## Cryptographic Specification

### Cryptographic Primitives

| Component | Algorithm | Technical Details |
|-----------|-----------|-------------------|
| **Key exchange** | ECDH P-256 (`secp256r1`) | 256-bit elliptic curve, native Web Crypto API implementation |
| **Key derivation** | HKDF-SHA-256 | Key Derivation Function with SHA-256, salt derived from `hash(roomId)` |
| **Symmetric encryption** | AES-256-GCM | Advanced Encryption Standard with Galois/Counter Mode, 256-bit key |
| **Initialization vector** | Random 96 bits | Generated with `crypto.getRandomValues()` per message, never reused |
| **Authentication** | GCM Authentication Tag | 128-bit tag included in ciphertext, validates integrity |
| **Encoding** | Base64 | For serializing binary data in JSON |
| **Timestamp** | Included in plaintext | Encrypted together with message, not visible to the server |

### Detailed Cryptographic Protocol

#### Phase 1: Connection Establishment

1. **Key pair generation**: Each client generates an ECDH P-256 key pair
2. **Export**: Public keys are exported in raw format and encoded as Base64
3. **Send**: Both clients send their public keys to the server with `roomId`
4. **Exchange**: The server relays public keys between clients

#### Phase 2: Shared Key Derivation

5. **ECDH**: Each client computes the shared secret using its private key and peer public key
6. **HKDF**: The shared secret is derived with HKDF-SHA-256 and `salt = hash(roomId)` to obtain the AES-256 key

**Critical note**: The server never participates in shared secret calculation. It only relays public keys.

#### Phase 3: Encryption and Transmission

7. **Encryption**:
   - A random 96-bit IV is generated per message
   - The message is encrypted with AES-256-GCM using the derived key
   - Output includes ciphertext and authentication tag

8. **Transmission**: The `{iv, ciphertext}` packet is sent to the server as JSON
9. **Relay**: The server relays the packet without modifying or attempting to decrypt it (but its on your OWN computer so this feature if its deployed on a permanent domain and u offer to unknown people, as in future versions it will be avaliable for give it a try without install the project.
10. **Decryption**: The receiving client decrypts with the same AES-256 key and verifies the authentication tag

### Cryptographic Guarantees

- **Confidentiality**: Protection against unauthorized reading using AES-256
- **Integrity**: Modification detection through GCM authentication tags
- **Authenticity**: Origin verification through shared key
- **Forward secrecy**: Per-message. A symmetric-key ratchet (HMAC-SHA256) derives a
  unique AES-256 key for each message; the previous chain key is overwritten with
  zeros after every step, so compromising the current state cannot decrypt past
  messages. The ratchet counter travels in clear but is authenticated as GCM AAD,
  so tampering with it is detected.
- **Zero-knowledge server**: Server cannot decrypt any content

---

## Installation and Configuration

### Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v8.0.0 or higher
- **Operating system**: Windows, macOS, or Linux
- **Browser**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+ (Web Crypto API support)

### Quick Setup (Windows)

For Windows systems, automated PowerShell scripts are included:

```powershell
# Initial setup (first time)
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
.\setup.ps1

# Later runs
.\run.ps1
```

The `run.ps1` script provides an interactive menu with these options:
- Start server and client in development mode
- Build for production
- Run tests
- Manage Cloudflare Tunnel processes

### Manual Setup (Cross-platform)

#### 1. Install Dependencies

```bash
# Clone repository
git clone https://github.com/your-user/windchat.git
cd windchat

# Install workspace dependencies
npm install

# Install server and client dependencies
npm install --workspace=server --workspace=client
```

### Linux / macOS notes

Use the Bash helpers in `./scripts/` on Linux or macOS. Examples:

```bash
# Initial setup (first time)
./scripts/setup.sh

# Start development (server + client)
./scripts/dev.sh

# Run the integrated healthcheck
npm run healthcheck
```

These scripts call the same npm workspace commands used on Windows and provide a lightweight, cross-platform workflow.

#### 2. Configure Environment Variables

Create config file (optional):

```bash
cp .env.example .env
```

Edit `.env` as needed:

```bash
# WebSocket server port
PORT=8080

# Optional local TLS for the Node server
LOCAL_HTTPS=true
HTTPS_KEY_PATH=./certs/localhost-key.pem
HTTPS_CERT_PATH=./certs/localhost-cert.pem

# Optional password if the private key is encrypted
# HTTPS_PASSPHRASE=changeit

# Per-message metadata logging (roomId, display names, sizes).
# OFF by default so the server does not record who talks to whom.
# Enable only for local debugging.
# VERBOSE_LOGS=true

# Optional client-side dev HTTPS
DEV_HTTPS=true

# Room user limit
MAX_USERS_PER_ROOM=2


If you enable local TLS, generate a dev certificate pair first with `mkcert` or a similar local CA tool, then point `HTTPS_KEY_PATH` and `HTTPS_CERT_PATH` at the generated files. The client dev server can also be launched over HTTPS with `DEV_HTTPS=true` so the browser uses `wss://` for the chat socket.
# Max message size (bytes)
MAX_MESSAGE_SIZE=10485760
```

#### 3. Build the Project

```bash
# Build server
npm run build --workspace=server

# Build client
npm run build --workspace=client
```

#### 4. Run in Development Mode

**Terminal 1 - Server:**
```bash
cd server
npm run dev
```

**Terminal 2 - Client:**
```bash
cd client
npm run dev
```

Server runs on `http://localhost:8080` and client on `http://localhost:3000`.

### Installation Validation

1. Open `http://localhost:3000` in browser A
2. Click "Create / Connect" to generate a room
3. Copy the Room ID shown in the UI
4. Open `http://localhost:3000` in browser B (incognito tab or different browser)
5. Paste the Room ID and click "Connect"
6. Verify both clients connect and can exchange messages



---

## Production Deployment

### Build Artifacts

```bash
# Full project build
npm run build

# Or separately
npm run build --workspace=server
npm run build --workspace=client
```

Build output:
- **Server**: `server/dist/index.js` (compiled Node.js app)
- **Client**: `client/dist/` (static assets ready to serve)

### Deployment Options

#### Option 1: Dedicated Server (VPS/Cloud)

**Server requirements:**
- Node.js 18+ installed
- Port 8080 open (or configured)
- SSL certificate for WSS (WebSocket Secure)
- Reverse proxy recommended (nginx/caddy)

**nginx config:**

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Static client
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

**Start server:**

```bash
cd server
node dist/index.js

# Or with PM2 for process management
npm install -g pm2
pm2 start dist/index.js --name windchat-server
pm2 startup
pm2 save
```

#### Option 2: Cloudflare Tunnel (Recommended for Development)

Cloudflare Tunnel provides automatic HTTPS without manual certificate setup.

**1. Install `cloudflared`:**

```bash
# Windows (PowerShell as administrator)
choco install cloudflared

# macOS
brew install cloudflare/cloudflare/cloudflared

# Linux
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

**2. Build and run:**

```bash
# Terminal 1: Build and run server
cd server
npm run build
node dist/index.js

# Terminal 2: Create tunnel
cloudflared tunnel --url http://localhost:8080
```

Cloudflared will generate a public URL:
```
https://random-name-1234.trycloudflare.com
```

**3. Configure client to use the tunnel:**

```bash
VITE_SERVER_URL=https://random-name-1234.trycloudflare.com npm run dev:client
```

#### Option 3: Docker Deployment

**Server Dockerfile:**

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

### Production Security Considerations

1. **Use HTTPS/WSS only**: Web Crypto API requires a secure context
2. **Rate limiting**: Implement connection limits per IP
3. **Correct CORS setup**: Restrict allowed origins
4. **Security headers**:
   ```
   Content-Security-Policy: default-src 'self'
   X-Frame-Options: DENY
   X-Content-Type-Options: nosniff
   ```
5. **Monitoring**: Add logging and alerts for unusual connections
6. **Firewall**: Restrict server port access through proxy only

### Performance Configuration

**Recommended production env vars:**

```bash
NODE_ENV=production
PORT=8080
MAX_USERS_PER_ROOM=2
MAX_MESSAGE_SIZE=10485760  # 10MB
LOG_LEVEL=error            # Reduce production logging
```

---

## Testing and Validation

### Automated Test Suite

The project includes 36 automated tests that validate:

```bash
# Run all tests
npm test

# Run tests with interactive UI
cd client
npm run test:ui

# Run tests with coverage
npm run test:coverage
```

**Test categories:**

1. **Cryptographic tests** (`crypto.test.ts`)
   - ECDH P-256 key pair generation
   - Correct shared key derivation
   - AES-256-GCM encryption/decryption
   - IV uniqueness
   - Authentication tag validation

2. **Integration tests** (`integration.test.ts`)
   - Complete handshake between two clients
   - Public key exchange
   - Encrypted message transmission
   - Correct receiver-side decryption

3. **WebSocket tests** (`websocket.test.ts`)
   - Connection establishment
   - Auto-reconnection with exponential backoff
   - Disconnect handling
   - Room limit validation

### Manual Validation Checklist

#### Cryptographic Security

- [ ] ECDH P-256 keys are correctly generated on both clients
- [ ] Public keys are exchanged through the server
- [ ] Both clients derive the same shared secret (validate in console)
- [ ] Each message uses a unique IV (check console logs)
- [ ] Authentication tags are correctly validated
- [ ] Tampered messages fail to decrypt
- [ ] Server logs do not contain message content

#### Network Behavior

- [ ] WebSocket handshake completes without errors
- [ ] Maximum of 2 users can join each room
- [ ] Third connection to same room is rejected with proper error
- [ ] Client disconnection notifies the other side
- [ ] Auto-reconnect works after temporary disconnect
- [ ] Messages are delivered in order
- [ ] Message latency is acceptable (< 100ms on local network)

#### User Interface

- [ ] Room ID is generated and displayed correctly
- [ ] Copy Room ID button works
- [ ] Own messages are shown on the right
- [ ] Peer messages are shown on the left
- [ ] Timestamps are accurate and readable
- [ ] "typing..." indicator appears while peer is typing
- [ ] Light/dark theme works correctly
- [ ] Sound notifications work (if enabled)
- [ ] Mobile responsive interface works

#### Production Security

- [ ] HTTPS/WSS is active in production (not HTTP/WS)
- [ ] No sensitive data is present in URL or GET parameters
- [ ] `innerHTML` is not used for dynamic content (`textContent` only)
- [ ] CSP security headers are configured
- [ ] No Mixed Content warnings in console
- [ ] SSL certificates are valid and not self-signed

### Debugging and Diagnostics

#### Client Console Logs

Open Chrome DevTools (F12) -> Console to inspect cryptographic flow:

```text
KeyPair generated successfully
Sending public key to server
Peer public key received
Shared secret derived successfully
Message encrypted: IV=abc123...
Message sent to server
Message received from peer
Message decrypted successfully
```

#### WebSocket Traffic Inspection

DevTools -> Network -> Filter by "WS" to inspect frames:

```json
// Handshake
{
  "type": "handshake",
  "publicKey": "BHx2Y...",
  "roomId": "a1b2c3"
}

// Encrypted message
{
  "type": "message",
  "iv": "dGVzdGl2MTIzNA==",
  "ciphertext": "ZW5jcnlwdGVkX2RhdGE="
}
```

**Note**: The server must never be able to view plaintext message content.

#### Server Logs

In development mode, server logs include:

```text
[INFO] Client connected: id=abc123, room=room-xyz
[INFO] Handshake received from client abc123
[INFO] Key exchange completed in room room-xyz
[INFO] Message relayed: from=abc123 to=def456 size=234 bytes
```



### Performance Analysis

To benchmark encryption speed:

```javascript
// In browser console
console.time('encrypt');
await cryptoManager.encrypt('test message');
console.timeEnd('encrypt');
// Expected result: < 5ms
```

---

## Security and Audit

### Threat Model

#### Mitigated Threats

| Threat | Mitigation | Status |
|--------|------------|--------|
| **Man-in-the-Middle** | ECDH + HTTPS/WSS + **safety number (SAS) compared out-of-band** | Mitigated *only if users compare the code* |
| **Message tampering** | GCM Authentication Tag | Mitigated |
| **Replay attacks** | Unique IV per message + timestamps | Mitigated |
| **Encryption brute force** | AES-256 (`2^256` key space) | Mitigated |
| **Server compromise** | Zero-knowledge architecture + SAS detects key substitution | Mitigated |
| **Path traversal** | `express.static` with normalisation (no manual path building) | Mitigated |
| **XSS injection** | `textContent` only, no `innerHTML` | Mitigated |
| **Timing attacks** | Constant-time GCM implementation | Mitigated |
| **DoS via oversized messages** | Size checked *before* `JSON.parse` + rate limiting | Mitigated |

> **Important about MITM:** the server is the one distributing public keys. A
> malicious server can attempt a double handshake. What stops it is the
> **safety number**: each side derives it from *both* public keys, so an
> interception produces different codes on each end. **This only protects you
> if both users actually compare the code** through another channel (voice,
> in person). If nobody compares it, MITM is *not* mitigated.

#### Unmitigated Threats (Known Limitations)

| Threat | Reason | Roadmap |
|--------|--------|---------|
| **Automatic identity authentication** | Requires persistent identities (TOFU) | v2.0 |
| **Metadata analysis** | Inherent to any E2EE system | Partial mitigation possible |
| **Endpoint compromise** | Not preventable in software alone | User education |

### Verifying a session (safety number)

When the second person joins, a badge appears in the room bar:

- `⚠️ Unverified` — a code has been derived but nobody confirmed it
- `✅ Session verified` — you confirmed it matches

Click the badge to see 5 emojis and 6 groups of 5 digits, e.g.:

```
📷 🌲 🐵 🍕 🌽
65601 42690 15129 27280 80328 74978
```

Both people must see **exactly** the same thing. Compare it by voice, in person
or over another trusted channel — never inside WindChat itself, since that is
precisely the channel a MITM would control.

If it does not match, **close the room immediately**: someone is intercepting.

The code is invalidated on reconnect (new ECDH keys) and must be compared again.

### Implemented Security Features

#### Random Number Generation

- **Source**: `crypto.getRandomValues()` (Web Crypto API)
- **Quality**: Cryptographically secure (CSPRNG)
- **Usage**: IV generation, private keys

#### Key Derivation

- **Algorithm**: HKDF-SHA-256 (RFC 5869)
- **Salt**: Derived from SHA-256 hash of Room ID
- **Info**: None (empty field)
- **Output**: 256 bits for AES-256

#### Input Sanitization

- **DOM**: `textContent` only, never `innerHTML` for dynamic content
- **URL**: No sensitive data in GET parameters
- **Validation**: Max message size enforced on server

#### Key Handling

- **Storage**: Memory only, never localStorage/sessionStorage
- **Lifecycle**: Keys are destroyed when connection closes
- **Export**: Private keys never leave the client
- **Format**: Public keys exported in raw format for exchange

### Security Recommendations for Users

1. **Use only with HTTPS/WSS**: Browsers block Web Crypto API on HTTP
2. **Do not share Room ID publicly**: It is the only shared secret, acts as password of the room.
3. **Verify identity out-of-band**: Identity authentication is not implemented
4. **Use trusted devices**: Endpoints can be compromised
5. **Do not expect persistence**: Messages are ephemeral by design

### Audit and Compliance

**Audit status**: Not professionally audited. This is an educational open-source project.

**Open source**: All source code is available for public review on GitHub.

**Standards followed**:
- NIST FIPS 197 (AES)
- NIST FIPS 186-4 (ECDH)
- RFC 5869 (HKDF)
- RFC 6090 (ECC)
- NIST SP 800-38D (GCM)

**Important note**: For critical production environments, a professional security audit is strongly recommended before deployment.

---

## Known Limitations

WindChat v1 stable has the following known limitations:

### Technical Limitations

| Limitation | Description | Impact | Mitigation Plan |
|------------|-------------|--------|-----------------|
| **No identity authentication** | No persistent identities; peers are anonymous per session | MITM is possible **unless the safety number is compared** out-of-band | Implemented: SAS. v2.0: TOFU with persistent keys |
| **Visible metadata** | Server can see timestamps, message size, communication patterns | Traffic analysis is possible | Partially mitigable with padding |
| **No persistence** | Messages are lost when tab closes | No message history | Intentional design; v2.0 may add optional local IndexedDB |
| **Max 2 users** | Hard design limit | No group chats | v2.0: Group chats with per-participant keys ( this feature add posible vulnerabilities. Ex.: third unknown join a room of two if they get the roomID, would needed more steps of verification) |
| **No delivery/read verification** | No confirmation that message was received/read | Limited UX | v2.0: Acknowledgements and read receipts |

### Architecture Limitations (some are intentional for privacy/security focus)

- **In-memory storage**: All rooms live in memory; restarting server closes all sessions
- **Single instance**: No horizontal scaling or load balancing
- **No rate limiting**: Vulnerable to denial-of-service attacks
- **No monitoring**: No built-in performance metrics or alerts

### Comparison with Mature Solutions

| Feature | WindChat v1.0 | Signal | WhatsApp |
|---------|---------------|--------|----------|
| E2EE | AES-256-GCM | Signal Protocol | Signal Protocol |
| Forward secrecy | Yes (per-message symmetric ratchet) | Double Ratchet | Double Ratchet |
| Persistence | No | Yes | Yes |
| Group chats | No | Yes | Yes |
| Authentication | No (SAS out-of-band) | Yes | Yes |
| Attachments | No | Yes | Yes |
| Open source | Yes | Yes (client) | No |
| Audit | No | Yes | Yes (partial) |

---

## Roadmap and Future Development

### Version 2.0 (Q2-Q3 2026)

**High priority:**
- [x] **Per-message forward secrecy**: Symmetric-key ratchet (HMAC-SHA256) implemented in v1.1
- [ ] **Key verification**: Public key fingerprints for out-of-band verification
- [ ] **Local persistence**: IndexedDB for encrypted local history
- [ ] **Encrypted attachments**: Support for images, videos, and files (< 25MB)
- [x] **Rate limiting**: Abuse and DoS protection (10 msg/s per connection)

**Medium priority:**
- [ ] **Read receipts**: Delivery and read confirmations
- [ ] **Message reactions**: Emoji quick reactions
- [ ] **Reply to messages**: Threading and quotes
- [ ] **Push notifications**: Service Worker based (PWA)
- [ ] **Group chats**: Support for 3-10 participants

**Low priority:**
- [ ] **WebRTC P2P**: Optional peer-to-peer mode without relay server
- [ ] **Video calls**: Encrypted video integration
- [ ] **Custom themes**: Advanced theming system
- [ ] **Bots and automation**: Bot API

### Version 3.0 (2027+)

- [ ] **Horizontal scaling**: Redis state sharing between instances
- [ ] **Native app**: Electron desktop, React Native mobile
- [ ] **User authentication**: Optional account system

---

## Contributing and License

### How to Contribute

Contributions are welcome. Please:

1. **Fork** the repository
2. **Create a branch** for your feature: `git checkout -b feature/new-feature`
3. **Commit** your changes: `git commit -am 'Add new feature'`
4. **Push** the branch: `git push origin feature/new-feature`
5. **Open a Pull Request** with a detailed description

**Guidelines:**
- Follow existing code style
- Add tests for new functionality
- Update docs when needed
- Use descriptive commits in Spanish or English

### Contribution Areas

**Security**: Vulnerability reports (use GitHub Security Advisories)
**Code**: New features, bug fixes, optimizations
**Documentation**: README improvements, guides, tutorials
**Testing**: New tests, better coverage
**Design**: UI/UX improvements
**Translations**: Internationalization into other languages

### License

**GNU Affero General Public License v3.0 (AGPL-3.0)**

Copyright (c) 2026 WindChat Contributors

This project is distributed under the terms of the **GNU AGPL v3.0** license.

You can read the full official text here:

- https://www.gnu.org/licenses/agpl-3.0.html
- https://www.gnu.org/licenses/agpl-3.0.txt

Summary:

- Allows using, studying, modifying, and redistributing the software.
- Requires source code to remain available under the same license.
- If offered as a network service, it also requires making modified source code available to service users.

---

## Project Information

**Start date**: March 4, 2026
**Current version**: v1 stable
**Tech stack**: Node.js, TypeScript, Web Crypto API, WebSocket, Vite
**License**: GNU AGPL v3.0
**Maintainer**: [@LordAlastor78](https://ko-fi.com/alastor78)

**Purpose**: Provide a reference implementation of E2EE messaging with zero-knowledge architecture, prioritizing simplicity, transparency, and modern cryptographic security practices.

**Security**: True end-to-end encryption with no database and no persistence. The server is a blind relay with no ability to decrypt messages, but the key is host u in ur own device. Share information only with whoever you actually choose. No more messages left forever in the cloud. Ur server, ur chat, ur info.

---

## Contact and Support

[![Support the Project](https://storage.ko-fi.com/cdn/kofi6.png?v=4)](https://ko-fi.com/alastor78)

- **Issues**: [GitHub Issues](https://github.com/LordAlastor78/windchat/issues)
- **Discussions**: [GitHub Discussions](https://github.com/LordAlastor78/windchat/discussions)
- **Support**: [![Ko-fi](https://storage.ko-fi.com/cdn/kofi6.png?v=6)](https://ko-fi.com/alastor78)

**Note**: This version is considered stable for general use, but it may still contain undetected bugs. For questions, suggestions, or bug reports, please use GitHub channels or support us on Ko-fi to speed up development. Thank you for your interest in WindChat.
