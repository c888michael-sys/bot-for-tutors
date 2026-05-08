const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const commands = require('./src/commands');
const reminders = require('./src/reminders');
const storage = require('./src/save');

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('.baileys_auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Tutor Bot', 'Chrome', '1.0'],
    logger: pino({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nScan this QR code with WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('Tutor bot ready. Send "menu" to get started.\n');
      // Save tutor JID for reminders
      const jid = sock.user?.id?.replace(':0@', '@') || sock.user?.id;
      if (jid) storage.setTutorChatId(jid);
      reminders.init(sock);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('Logged out. Delete .baileys_auth folder and restart.');
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
               raw.message?.extendedTextMessage?.text ||
               raw.message?.buttonsResponseMessage?.selectedButtonId ||
               raw.message?.listResponseMessage?.title || '';

  return {
    body,
    from: jid,
    fromMe: raw.key.fromMe,
    type: raw.message?.buttonsResponseMessage ? 'buttons_response'
        : raw.message?.listResponseMessage    ? 'list_response'
        : 'chat',
    reply: async (text) => {
      await sock.sendMessage(jid, { text: String(text) }, { quoted: raw });
    }
  };
}

startBot();
