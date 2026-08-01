/**
 * Peer headless que se une a una sala y se mantiene conectado,
 * para verificar la UI del SAS en un navegador real.
 *
 * Uso: node tools/integration/peer_hold.js <roomId> [ws://127.0.0.1:8099] [segundos]
 */

const WebSocket = require('ws');
const crypto = require('crypto');

const ROOM = process.argv[2];
const URL = process.argv[3] || 'ws://127.0.0.1:8099';
const SECONDS = parseInt(process.argv[4] || '90', 10);

if (!ROOM) {
    console.error('Falta el roomId');
    process.exit(2);
}

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

function cmp(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
}

function sas(mine, theirs, roomId) {
    const first = cmp(mine, theirs) <= 0 ? mine : theirs;
    const second = cmp(mine, theirs) <= 0 ? theirs : mine;
    const bytes = crypto.createHash('sha256')
        .update(Buffer.concat([Buffer.from(`WindChat-SAS-v1|${roomId}|`), first, second]))
        .digest();

    const groups = [];
    for (let i = 0; i < 6; i++) {
        const o = i * 3;
        groups.push(String((((bytes[o] << 16) | (bytes[o + 1] << 8) | bytes[o + 2]) % 100000)).padStart(5, '0'));
    }
    const em = [];
    for (let i = 0; i < 5; i++) em.push(SAS_EMOJI[bytes[18 + i] % SAS_EMOJI.length]);
    return { digits: groups.join(' '), emojis: em.join(' ') };
}

const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();

const ws = new WebSocket(URL);

ws.on('open', () => {
    ws.send(JSON.stringify({
        type: 'join',
        roomId: ROOM,
        publicKey: ecdh.getPublicKey().toString('base64'),
        displayName: 'Bob',
    }));
    console.log(`Bob conectado a ${ROOM}`);
});

ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'peer_joined') {
        const theirs = Buffer.from(m.theirPublicKey, 'base64');
        const s = sas(ecdh.getPublicKey(), theirs, ROOM);
        console.log('SAS_DIGITS=' + s.digits);
        console.log('SAS_EMOJIS=' + s.emojis);
    }
});

ws.on('error', (e) => console.error('error:', e.message));

setTimeout(() => { ws.close(); process.exit(0); }, SECONDS * 1000);
