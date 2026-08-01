/**
 * Cliente zombi: se conecta, hace el handshake y luego NO responde a los
 * pings del servidor (se desactiva el pong automático del protocolo).
 *
 * Sirve para comprobar que el barrido de heartbeat cierra sockets muertos.
 *
 * Uso: node tools/integration/zombie_client.js <ws-url> <segundos>
 */

const WebSocket = require('ws');
const crypto = require('crypto');

const URL = process.argv[2] || 'ws://127.0.0.1:8098';
const SECONDS = parseInt(process.argv[3] || '15', 10);

const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();

const ws = new WebSocket(URL);

ws.on('open', () => {
    // Silenciar el pong automático: así el servidor nos verá como muertos.
    ws._receiver.removeAllListeners('ping');
    ws._receiver.on('ping', () => {
        console.log('ping recibido — IGNORADO a propósito');
    });

    ws.send(JSON.stringify({
        type: 'join',
        roomId: 'sala-zombi',
        publicKey: ecdh.getPublicKey().toString('base64'),
        displayName: 'Zombi',
    }));
    console.log('zombi conectado, no responderá a pings');
});

const started = Date.now();

ws.on('close', (code) => {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`CERRADO_POR_SERVIDOR code=${code} tras ${secs}s`);
    process.exit(0);
});

ws.on('error', (e) => console.error('error:', e.message));

setTimeout(() => {
    console.log('NO_CERRADO: el zombi seguía vivo al acabar el tiempo');
    process.exit(1);
}, SECONDS * 1000);
