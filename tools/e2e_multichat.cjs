const { chromium } = require('playwright');

const PORT = process.env.PORT || 4183;
const BASE = `http://localhost:${PORT}`;
const APP = `${BASE}/chat.html`;
const ROOM_A = 'alpha-multichat';
const ROOM_B = 'beta-multichat';

async function login(page, room, name) {
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForSelector('#username', { timeout: 10000 });
  await page.fill('#username', room);
  await page.fill('#displayName', name);
  await page.click('#loginScreen .btn-primary');
  await page.waitForFunction(() => {
    const c = document.getElementById('chatContainer');
    return c && !c.classList.contains('hidden');
  }, { timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctxA = await browser.newContext({ serviceWorkers: 'block' });
  const pageA = await ctxA.newPage();
  pageA.on('pageerror', e => errors.push('A: ' + e.message));

  // A entra a room alpha
  await login(pageA, ROOM_A, 'Alice');

  // Poblar el buffer de alpha simulando un mensaje recibido (sin depender del handshake E2EE)
  await pageA.evaluate(() => {
    const sm = window.__windchat?.sessionManager;
    const active = sm?.getActive();
    if (active) active.pushMessage({ id: 'm1', side: 'other', displayName: 'Bob', text: 'hola-alpha', timestamp: Date.now() });
  });

  // A crea room beta (openRoom) -> debe tener 2 sesiones conectadas, SIN desconectar alpha
  await pageA.click('#newChatBtn');
  await pageA.click('#createRoomBtn');
  await pageA.waitForTimeout(2000);

  const sessionInfo = await pageA.evaluate(() => {
    const sm = window.__windchat?.sessionManager;
    if (!sm) return { count: -1, connected: [], activeConvId: null };
    const all = sm.all();
    return {
      count: all.length,
      connected: all.map(s => s.client.isConnected()),
      activeConvId: sm.activeConvId,
      alphaStillConnected: (() => {
        const a = all.find(s => s.conv.roomId === 'alpha-multichat');
        return a ? a.client.isConnected() : false;
      })(),
    };
  });

  // A vuelve a alpha (click en la lista de chats, item que no es el activo)
  const switched = await pageA.evaluate(() => {
    const items = [...document.querySelectorAll('#chatList .chat-list-item')];
    const active = document.querySelector('#chatList .chat-list-item.active');
    const target = items.find(i => i !== active) || items[0];
    if (target) { target.click(); return target.dataset.convId; }
    return null;
  });
  await pageA.waitForTimeout(1000);

  const alphaBufferStillThere = await pageA.evaluate(() =>
    document.getElementById('messages')?.textContent.includes('hola-alpha'));

  const afterSwitchSessions = await pageA.evaluate(() => {
    const sm = window.__windchat?.sessionManager;
    const all = sm.all();
    const alpha = all.find(s => s.conv.roomId === 'alpha-multichat');
    return {
      count: all.length,
      connected: all.map(s => s.client.isConnected()),
      alphaMessagesLen: alpha ? alpha.messages.length : -1,
      alphaMessagesPreview: alpha ? alpha.messages.map(m => m.text) : [],
      domMessages: document.getElementById('messages')?.textContent.slice(0, 200),
    };
  });

  await browser.close();

  console.log(JSON.stringify({
    sessionInfo,
    switchedTo: switched,
    alphaBufferStillThere,
    afterSwitchSessions,
    errors,
  }, null, 2));

  const ok = sessionInfo.count === 2 &&
    sessionInfo.connected.every(Boolean) &&
    sessionInfo.alphaStillConnected &&
    alphaBufferStillThere &&
    afterSwitchSessions.count === 2 &&
    afterSwitchSessions.connected.every(Boolean) &&
    errors.length === 0;
  console.log(ok ? 'MULTICHAT_OK' : 'MULTICHAT_FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('E2E ERROR', e); process.exit(2); });
