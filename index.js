const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const pino = require('pino');
const http = require('http');
const commands = require('./src/commands');
const reminders = require('./src/reminders');
const storage = require('./src/save');

// ── QR HTTP server ────────────────────────────────────────────────────────────

let qrServer = null;
let currentQR = null;

async function startQRServer(qr) {
  currentQR = qr;
  if (qrServer) return; // already running, just update currentQR

  qrServer = http.createServer(async (req, res) => {
    if (!currentQR) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h2 style="font-family:sans-serif;text-align:center;padding:20px">Bot is connected. No QR needed.</h2>');
      return;
    }
    const dataUrl = await QRCode.toDataURL(currentQR, { width: 400 });
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Tutor Bot — Scan QR</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="25">
  <style>
    body { font-family: sans-serif; text-align: center; padding: 20px; background: #f5f5f5; }
    img { width: 280px; border: 8px solid white; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.15); }
    p { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <h2>Scan with WhatsApp</h2>
  <img src="${dataUrl}" alt="QR Code"><br>
  <p>Open WhatsApp → Linked Devices → Link a Device → scan above.<br>Page auto-refreshes every 25 seconds.</p>
</body>
</html>`);
  });

  qrServer.listen(8080, () => {
    console.log('QR page ready at http://YOUR_SERVER_IP:8080');
  });
}

function stopQRServer() {
  currentQR = null;
  if (qrServer) { qrServer.close(); qrServer = null; }
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

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
      await startQRServer(qr);
    }

    if (connection === 'open') {
      stopQRServer();
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
        console.log('Logged out. Send "reset bot" to re-link.');
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
