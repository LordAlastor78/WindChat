#!/usr/bin/env node
// Integration runner: improved with path escaping, cross-platform shutdown, logging, and install precheck.
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const serverDir = path.resolve(__dirname, '../../server');
const clientSim = path.resolve(__dirname, 'client_sim.js');
const clientSimLiteral = JSON.stringify(clientSim);
const WS_PORT = process.env.PORT || 8080;
const WS_URL = `ws://localhost:${WS_PORT}`;
const ROOM = 'integration-room';
const LOG_DIR = path.resolve(__dirname, 'logs');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function waitForHttp(url, timeout = 10000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function check() {
            http.get(url, (res) => { resolve(); }).on('error', () => {
                if (Date.now() - start > timeout) return reject(new Error('timeout'));
                setTimeout(check, 300);
            });
        })();
    });
}

function runNpmInstallIfMissing(dir) {
    return new Promise((resolve, reject) => {
        const nm = path.join(dir, 'node_modules');
        if (fs.existsSync(nm)) return resolve();
        console.log(`[runner] node_modules missing in ${dir}, running npm install`);
        const p = spawn('npm', ['install'], { cwd: dir, stdio: 'inherit', shell: true });
        p.on('exit', (code) => code === 0 ? resolve() : reject(new Error('npm install failed')));
    });
}

function killProcessTree(pid) {
    if (!pid) return;
    if (process.platform === 'win32') {
        exec(`taskkill /PID ${pid} /T /F`, (err, stdout, stderr) => {
            if (err) console.error('[runner] taskkill failed', err);
            else console.log('[runner] taskkill output', stdout || stderr);
        });
    } else {
        try { process.kill(-pid, 'SIGTERM'); } catch (e) {
            try { process.kill(pid, 'SIGTERM'); } catch (e2) { console.error('[runner] kill failed', e2); }
        }
    }
}

(async () => {
    ensureDir(LOG_DIR);

    console.log('[runner] Preparing environment');
    try {
        await runNpmInstallIfMissing(serverDir);
    } catch (e) {
        console.warn('[runner] npm install in server failed or was skipped:', e.message);
    }

    console.log('[runner] Starting server (npm run dev in server/)');
    const timestamp = Date.now();
    const outLog = fs.createWriteStream(path.join(LOG_DIR, `server-${timestamp}.out.log`));
    const errLog = fs.createWriteStream(path.join(LOG_DIR, `server-${timestamp}.err.log`));

    const serverProc = spawn('npm', ['run', 'dev'], { cwd: serverDir, stdio: ['ignore', 'pipe', 'pipe'], shell: true, detached: true });
    serverProc.stdout.pipe(process.stdout);
    serverProc.stderr.pipe(process.stderr);
    serverProc.stdout.pipe(outLog);
    serverProc.stderr.pipe(errLog);

    try {
        await waitForHttp(`http://localhost:${WS_PORT}`, 15000);
        console.log('[runner] Server HTTP responsive');
    } catch (err) {
        console.error('[runner] Server did not start in time', err);
        killProcessTree(serverProc.pid);
        process.exit(1);
    }

    // Spawn two client processes (child node instances running inline code using client_sim)
    const nodeBin = process.execPath;

    function spawnClient(name, actionScript) {
        // embed clientSim path safely
        const code = `const clientSim = require(${clientSimLiteral});(async()=>{console.log('[client-${name}] connecting to ${WS_URL}');const ws = await clientSim.connect('${WS_URL}','${ROOM}','${name}');ws.on('message',m=>console.log('[client-${name}] msg:',m.toString()));ws.send(clientSim.makeTypingMsg(true));await new Promise(r=>setTimeout(r,400));ws.send(clientSim.makeTypingMsg(false));await new Promise(r=>setTimeout(r,400));ws.send(clientSim.makeMessageMsg('hello from ${name}'));if(${actionScript}){await new Promise(r=>setTimeout(r,1200));console.log('[client-${name}] performing forced close');ws.terminate()}await new Promise(r=>setTimeout(r,2000));console.log('[client-${name}] exiting normally');process.exit(0)})().catch(e=>{console.error(e);process.exit(2)});`;
        const child = spawn(nodeBin, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
        return child;
    }

    const cA = spawnClient('Alice', true);
    const cB = spawnClient('Bob', false);

    // pipe client logs to files as well
    const cALog = fs.createWriteStream(path.join(LOG_DIR, `client-Alice-${timestamp}.log`));
    const cBLog = fs.createWriteStream(path.join(LOG_DIR, `client-Bob-${timestamp}.log`));
    cA.stdout.pipe(process.stdout); cA.stderr.pipe(process.stderr); cA.stdout.pipe(cALog); cA.stderr.pipe(cALog);
    cB.stdout.pipe(process.stdout); cB.stderr.pipe(process.stderr); cB.stdout.pipe(cBLog); cB.stderr.pipe(cBLog);

    // Wait for clients to finish
    const proms = [
        new Promise(r => cA.on('exit', r)),
        new Promise(r => cB.on('exit', r))
    ];
    await Promise.all(proms);

    console.log('[runner] Clients finished, shutting down server');
    killProcessTree(serverProc.pid);
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
