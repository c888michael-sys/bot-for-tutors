const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const commands = require('./src/commands');
const reminders = require('./src/reminders');
const storage = require('./src/save');

const client = new Client({
  authStrategy: new LocalAuth(),
  authTimeoutMs: 120000,
  puppeteer: {
    headless: 'new',
    executablePath: '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--no-first-run',
      '--disable-accelerated-2d-canvas'
    ]
  }
});

client.on('qr', qr => {
  console.log('\nScan this QR code with WhatsApp:\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('Authenticated.'));

client.on('ready', () => {
  console.log('Tutor bot ready. Send "menu" to get started.\n');
  const jid = client.info?.wid?._serialized;
  if (jid) {
    storage.setTutorChatId(jid);
    console.log('Tutor JID saved:', jid);
  }
  reminders.init(client);
});

client.on('auth_failure', err => console.error('Auth failed:', err));
client.on('disconnected', reason => console.log('Disconnected:', reason));

process.on('unhandledRejection', err => {
  console.error('Unhandled error:', err?.message || err);
});

// message_create fires for messages YOU send (needed for self-chat commands)
client.on('message_create', async msg => {
  if (!msg.fromMe) return;
  if (msg.from.endsWith('@g.us')) return;
  try {
    await commands.handle(msg, client);
  } catch (err) {
    console.error('Error handling message:', err);
  }
});

client.initialize();
