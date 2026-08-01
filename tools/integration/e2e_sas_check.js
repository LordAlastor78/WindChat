/**
 * Prueba E2E manual contra un servidor WindChat real.
 * Simula dos clientes: handshake ECDH, derivación de SAS y mensaje cifrado.
 *
 * Uso: node tools/integration/e2e_sas_check.js [ws://127.0.0.1:8099]
 */

const WebSocket = require('ws');
const crypto = require('crypto');

const URL = process.argv[2] || 'ws://127.0.0.1:8099';
const ROOM = 'e2e-' + crypto.randomBytes(6).toString('hex');

const P256_SIZE = 65;

function makeKeys() {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    return ecdh;
}

/** Réplica exacta del SAS del cliente (client/src/crypto.ts) */
const SAS_EMOJI = [
    "🐶", "🐱", "🦁", "🐴", "🦄", "🐮", "🐷", "🐸",
    "🐵", "🐔", "🐧", "🦉", "🦋", "🐢", "🐬", "🐳",
    "🦀", "🐝", "🌵", "🌲", "🍄", "🌻", "🍎", "🍌",
    "🍇", "🍉", "🍒", "🥕", "🌽", "🍕", "🍔", "🍿",
    "🎂", "☕", "🍺", "⚽", "🏀", "🎾", "🏆", "🎸",
    "🎺", "🎨", "🎤", "🎧", "🔔", "🎯", "🎲", "🚗",
    "🚂", "✈️", "🚀", "⚓", "🏠", "⌛", "💡", "📷",
    "🔑", "🔒", "🔨", "⚙️", "💎", "🌙", "⭐", "🔥",
];

function compareBytes(a, b) {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
}

function computeSas(mine, theirs, roomId) {
    const mineFirst = compareBytes(mine, theirs) <= 0;
    const first = mineFirst ? mine : theirs;
    const second = mineFirst ? theirs : mine;

    const material = Buffer.concat([
        Buffer.from(`WindChat-SAS-v1|${roomId}|`, 'utf8'),
        first,
        second,
    ]);
    const bytes = crypto.createHash('sha256').update(material).digest();

    const groups = [];
    for (let i = 0; i < 6; i++) {
        const o = i * 3;
        const v = (bytes[o] << 16) | (bytes[o + 1] << 8) | bytes[o + 2];
        groups.push(String(v % 100000).padStart(5, '0'));
    }
    const emojis = [];
    for (let i = 0; i < 5; i++) emojis.push(SAS_EMOJI[bytes[18 + i] % SAS_EMOJI.length]);

    return { digits: groups.join(' '), emojis };
}

function deriveAesKey(ecdh, theirPub, roomId) {
    const shared = ecdh.computeSecret(theirPub);
    const salt = crypto.createHash('sha256').update(`WindChat-v1-${roomId}`).digest();
    // hkdfSync devuelve ArrayBuffer: envolver en Buffer para poder comparar/cifrar
    return Buffer.from(
        crypto.hkdfSync('sha256', shared, salt, Buffer.from('WindChat AES-256-GCM Key'), 32)
    );
}

function connect(name, ecdh) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(URL);
        const state = { ws, name, ecdh, peerPub: null, sas: null, received: [] };

        const timer = setTimeout(() => reject(new Error(`${name}: timeout`)), 10000);

        ws.on('open', () => {
            ws.send(JSON.stringify({
                type: 'join',
                roomId: ROOM,
                publicKey: ecdh.getPublicKey().toString('base64'),
                displayName: name,
            }));
            clearTimeout(timer);
            resolve(state);
        });
        ws.on('error', (e) => { clearTimeout(timer); reject(e); });
        ws.on('message', (raw) => {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'peer_joined') {
                state.peerPub = Buffer.from(msg.theirPublicKey, 'base64');
                state.sas = computeSas(ecdh.getPublicKey(), state.peerPub, ROOM);
            } else if (msg.type === 'message') {
                state.received.push(msg);
            }
        });
    });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    let failures = 0;
    const check = (label, cond) => {
        console.log(`${cond ? '✔' : '✖'} ${label}`);
        if (!cond) failures++;
    };

    console.log(`→ Servidor: ${URL}\n→ Room: ${ROOM}\n`);

    const aliceKeys = makeKeys();
    const bobKeys = makeKeys();

    const alice = await connect('Alice', aliceKeys);
    await wait(200);
    const bob = await connect('Bob', bobKeys);
    await wait(600);

    check('Alice recibió la clave pública de Bob', alice.peerPub !== null);
    check('Bob recibió la clave pública de Alice', bob.peerPub !== null);

    check('la clave de Bob mide 65 bytes y empieza por 0x04',
        alice.peerPub && alice.peerPub.length === P256_SIZE && alice.peerPub[0] === 0x04);

    check('el servidor NO alteró las claves (no hay MITM)',
        alice.peerPub.equals(bobKeys.getPublicKey()) &&
        bob.peerPub.equals(aliceKeys.getPublicKey()));

    // --- SAS ---
    check('ambos derivaron un SAS', alice.sas !== null && bob.sas !== null);
    check(`los SAS coinciden  [${alice.sas.digits}]  ${alice.sas.emojis.join(' ')}`,
        alice.sas.digits === bob.sas.digits);

    // --- Secreto compartido real ---
    const kA = deriveAesKey(aliceKeys, alice.peerPub, ROOM);
    const kB = deriveAesKey(bobKeys, bob.peerPub, ROOM);
    check('las claves AES derivadas son idénticas', kA.equals(kB));

    // --- Mensaje cifrado de verdad ---
    const iv = crypto.randomBytes(12);
    const payload = JSON.stringify({ id: 'm1', type: 'text', text: 'hola desde E2E', timestamp: Date.now() });
    const cipher = crypto.createCipheriv('aes-256-gcm', kA, iv);
    const ct = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final(), cipher.getAuthTag()]);

    alice.ws.send(JSON.stringify({
        type: 'message',
        iv: iv.toString('base64'),
        ciphertext: ct.toString('base64'),
    }));
    await wait(600);

    check('Bob recibió el mensaje reenviado', bob.received.length === 1);
    check('Alice NO recibió su propio mensaje (no eco)', alice.received.length === 0);

    if (bob.received.length === 1) {
        const got = bob.received[0];
        const rIv = Buffer.from(got.iv, 'base64');
        const rCt = Buffer.from(got.ciphertext, 'base64');
        const tag = rCt.subarray(rCt.length - 16);
        const body = rCt.subarray(0, rCt.length - 16);

        const decipher = crypto.createDecipheriv('aes-256-gcm', kB, rIv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
        const parsed = JSON.parse(plain);

        check(`Bob descifró el texto correcto ("${parsed.text}")`, parsed.text === 'hola desde E2E');
    }

    // --- Handshake inválido ---
    const bad = new WebSocket(URL);
    const badClosed = await new Promise((resolve) => {
        bad.on('open', () => bad.send(JSON.stringify({
            type: 'join', roomId: 'x', publicKey: 'AAAA', displayName: 'evil',
        })));
        bad.on('close', (code) => resolve(code));
        setTimeout(() => resolve(null), 3000);
    });
    check(`el servidor rechaza una clave pública inválida (close=${badClosed})`, badClosed === 1008);

    alice.ws.close();
    bob.ws.close();

    console.log(`\n${failures === 0 ? '✅ TODAS LAS COMPROBACIONES PASARON' : `❌ ${failures} fallo(s)`}`);
    process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
    console.error('✖ Error fatal:', err.message);
    process.exit(1);
});
