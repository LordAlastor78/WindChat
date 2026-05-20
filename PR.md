# PR Summary: Security Hardening + Express Migration

## What changed
- Migrated the server from raw `http` handling to Express.
- Integrated `helmet` middleware on the server.
- Kept WebSocket support attached to the Express-backed HTTP server.
- Preserved the security header helper and request-size validation.
- Kept the service worker hardening and client WSS normalization.
- Added a security header test and a CI workflow for security checks.

## Verification
- Client test suite passed: 38/38 tests.
- Security header test passed.

## Files to review
- `server/src/index.ts`
- `server/src/security-headers.ts`
- `server/package.json`
- `client/public/service-worker.js`
- `client/src/websocket.ts`
- `client/src/tests/security-headers.test.ts`
- `.github/workflows/security.yml`

## Notes
- `helmet` is enabled with CSP disabled because CSP is managed by the existing helper.
- HSTS remains environment-aware to avoid breaking local development.
- The server still serves static files and the WebSocket endpoint from the same port.

## Residual risk
- Local HTTPS for the Node server is not yet enabled. The app still assumes HTTPS/WSS when served behind a secure proxy or in production.
- If you want strict local parity, the next step is adding a dev TLS mode with mkcert or origin certs.

## Suggested review order
1. Confirm the Express migration preserves static file serving.
2. Confirm `helmet` headers do not conflict with the existing helper.
3. Confirm the WebSocket upgrade path still works in your deployment.
