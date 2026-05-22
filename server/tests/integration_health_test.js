// Integration health test for WindChat server (ESM)
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
const toolsRoot = path.resolve(serverRoot, '..', 'tools', 'integration');
const clientSimModule = await import(pathToFileURL(path.join(toolsRoot, 'client_sim.js')).href);
const clientSim = clientSimModule.default || clientSimModule;
const PORT = process.env.PORT || 8080;

function waitForHttp(url, timeout = 15000) {
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

(async () => {
    // env overrides to make server react quickly
    const env = Object.assign({}, process.env, {
        HEALTH_WINDOW_MS: '10000',
        HEARTBEAT_INTERVAL_MS: '2000',
        PONG_TIMEOUT_MS: '500',
        DEGRADED_THRESHOLD: '1',
        ALERT_THRESHOLD: '2',
        EVALUATE_INTERVAL_MS: '1000',
        DEBUG_USER: 'debug',
        DEBUG_PASS: 'debug',
        PORT: String(PORT),
    });

    console.log('[test] Starting server with test env (fast intervals)');
    const serverProc = spawn('npm', ['run', 'dev'], { cwd: serverRoot, env, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
    serverProc.stdout.pipe(process.stdout);
    serverProc.stderr.pipe(process.stderr);

    try {
        await waitForHttp(`http://localhost:${PORT}`, 10000);
        console.log('[test] Server HTTP responsive');
    } catch (err) {
        console.error('[test] Server did not come online', err);
        serverProc.kill();
        process.exit(2);
    }

    // spawn two clients and force one to terminate to create disconnects
    console.log('[test] Creating clients');
    const alice = await clientSim.connect(`ws://localhost:${PORT}`, 'test-room', 'Alice');
    const bob = await clientSim.connect(`ws://localhost:${PORT}`, 'test-room', 'Bob');

    // Send some messages and then terminate Alice to create a disconnect
    alice.send(clientSim.makeMessageMsg('hi from alice'));
    bob.send(clientSim.makeMessageMsg('hi from bob'));

    // terminate alice after short delay
    setTimeout(() => {
        try { alice.terminate(); console.log('[test] Alice terminated to provoke disconnect'); } catch (e) { }
    }, 700);

    // wait a bit for server to evaluate
    await new Promise(r => setTimeout(r, 3000));

    // Query debug/health with basic auth
    const auth = Buffer.from('debug:debug').toString('base64');
    const options = {
        hostname: 'localhost', port: PORT, path: '/debug/health', method: 'GET', headers: { Authorization: `Basic ${auth}` }
    };

    const health = await new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let buf = '';
            res.on('data', d => buf += d.toString());
            res.on('end', () => {
                try { resolve(JSON.parse(buf)); } catch (e) {
                    console.error('[test] Failed to parse /debug/health JSON. Raw body:\n', buf);
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });

    console.log('[test] /debug/health ->', health);
    const level = health && health.serverHealth;
    if (level === 'degraded' || level === 'alert') {
        console.log('[test] SUCCESS: serverHealth is', level);
        serverProc.kill();
        process.exit(0);
    } else {
        console.error('[test] FAILURE: unexpected serverHealth:', level);
        serverProc.kill();
        process.exit(3);
    }
})().catch(err => { console.error(err); process.exit(4); });
