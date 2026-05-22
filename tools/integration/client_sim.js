// Simple WebSocket client simulator for integration tests
const WebSocket = require('ws');

function makeJoinMsg(roomId, displayName) {
    return JSON.stringify({ type: 'join', roomId, publicKey: Buffer.from('pk-' + displayName).toString('base64'), displayName });
}

function makeTypingMsg(isTyping) {
    return JSON.stringify({ type: 'typing', isTyping });
}

function makeMessageMsg(text) {
    return JSON.stringify({ type: 'message', iv: Buffer.from('iv').toString('base64'), ciphertext: Buffer.from(text).toString('base64') });
}

module.exports = {
    connect: (url, roomId, displayName) => new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.on('open', () => {
            ws.send(makeJoinMsg(roomId, displayName));
            resolve(ws);
        });
        ws.on('error', (err) => reject(err));
    }),
    makeTypingMsg,
    makeMessageMsg
};
