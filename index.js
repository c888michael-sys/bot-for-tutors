const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const commands = require('./src/commands');
const reminders = require('./src/reminders');
const storage = require('./src/save');

// ── Pairing code HTTP server ───────────────────────────────────────────────

let httpServer = null;
let pairingCode = null;

function startHttpServer() {
  if (httpServer) return;
  httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    const content = pairingCode
      ? `<h2>WhatsApp Pairing Code</h2>
         <div class="code">${pairingCode}</div>
         <p>Open WhatsApp → Settings → Linked Devices → Link a Device → <b>Link with phone number</b> → enter the code above.</p>
         <p style="color:#aaa;font-size:13px">Page auto-refreshes every 15 seconds.</p>`
      : `<h2>Requesting pairing code...</h2><p>Refresh in a few seconds.</p>`;

    res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Tutor Bot — Link WhatsApp</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="15">
  <style>
    body { font-family: sans-serif; text-align: center; padding: 30px; background: #f5f5f5; }
    .code { font-size: 48px; font-weight: bold; letter-spacing: 8px; color: #128C7E;
            background: white; padding: 20px 30px; border-radius: 12px;
            display: inline-block; margin: 20px 0; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
    p { color: #555; line-height: 1.6; }
  </style>
</head>
<body>${content}</body>
</html>`);
  });
  httpServer.listen(8080, () => console.log('Pairing page ready at http://YOUR_SERVER_IP:8080'));
}

function stopHttpServer() {
  pairingCode = null;
  if (httpServer) { httpServer.close(); httpServer = null; }
}

// ── Bot ───────────────────────────────────────────────────────────────────────

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('.baileys_auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Tutor Bot', 'Chrome', '1.0'],
    logger: pino({ level: 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false
  });

  sock.ev.on('creds.update', saveCreds);

  // Request pairing code if not yet registered
  if (!sock.authState.creds.registered) {
    startHttpServer();
    const data = storage.getData();
    const phone = data.tutorChatId ? data.tutorChatId.split('@')[0] : null;
    if (phone) {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phone);
          pairingCode = code;
          console.log('Pairing code:', code);
        } catch (e) {
          console.error('Failed to get pairing code:', e.message);
        }
      }, 3000);
    } else {
      console.log('No phone number stored yet. Please set tutorChatId in data/storage.json first.');
    }
  }

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      stopHttpServer();
      console.log('Tutor bot ready. Send "menu" to get started.\n');
      const jid = sock.user?.id?.replace(/:\d+@/, '@') || sock.user?.id;
      if (jid) {
        storage.setTutorChatId(jid);
        console.log('Tutor JID saved:', jid);
      }
      reminders.init(sock);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('Logged out. Send "reset bot" on WhatsApp to re-link.');
      } else {
        console.log('Reconnecting...');
        startBot();
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const raw of messages) {
      if (!raw.key.fromMe) continue;
      if (raw.key.remoteJid?.endsWith('@g.us')) continue;
      const msg = wrapMessage(sock, raw);
      try {
        await commands.handle(msg, sock);
      } catch (err) {
        console.error('Error handling message:', err);
      }
    }
  });
}

function wrapMessage(sock, raw) {
  const jid = raw.key.remoteJid;
  const body = raw.message?.conversation ||
               raw.message?.extendedTextMessage?.text || '';
  return {
    body,
    from: jid,
    fromMe: raw.key.fromMe,
    type: 'chat',
    reply: async (text) => {
      await sock.sendMessage(jid, { text: String(text) }, { quoted: raw });
    }
  };
}

process.on('unhandledRejection', err => {
  console.error('Unhandled error:', err?.message || err);
});

startBot();
