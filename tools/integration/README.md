Integration runner

This folder contains a lightweight integration runner to start the `server` and two simulated clients.

Purpose
- Reproduce reconnection/typing edge cases by forcing a client disconnect and observing server/client behavior.

Quick start (local)

```bash
# from repo root
cd server
npm install
cd ..
npm install
npm run test:integration
```

What it does
- Ensures `server/node_modules` exists (runs `npm install` if missing).
- Starts `npm run dev` in `server/` and waits for HTTP to respond.
- Spawns two Node-based clients (`client_sim.js`) that join the same room, send typing true/false and a message.
- Forces one client to terminate to simulate a network drop and observes how the remaining client reacts.
- Writes logs to `tools/integration/logs/` for server and clients.

Notes
- The runner uses `taskkill` on Windows and process group kill on POSIX systems.
- For CI runs, consider containerizing this runner for deterministic behavior.
