const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const commands = require('./src/commands');
const reminders = require('./src/reminders');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', qr => {
  console.log('\nScan this QR code with WhatsApp:\n');
  qrcode.generate(qr, { small: true });
  console.log('\nWaiting for scan...\n');
});

client.on('authenticated', () => console.log('Authenticated.'));

client.on('ready', () => {
  console.log('Tutor bot ready. Send "menu" from WhatsApp to get started.\n');
  reminders.init(client);
});

client.on('auth_failure', err => console.error('Auth failed:', err));
client.on('disconnected', reason => console.log('Disconnected:', reason));

const MAX_MESSAGES = 5;
const chatHistory = new Map(); // chatId -> [Message, ...]

// message_create fires for messages YOU send (needed for self-chat commands)
// msg.fromMe=true means you typed it; bot replies are also fromMe but won't match any command
client.on('message_create', async msg => {
  if (!msg.fromMe) return;
  if (msg.from.endsWith('@g.us')) return;

  // Rolling window — delete oldest when over limit
  const history = chatHistory.get(msg.from) || [];
  history.push(msg);
  if (history.length > MAX_MESSAGES) {
    const oldest = history.shift();
    try { await oldest.delete(true); } catch { /* too old or already gone */ }
  }
  chatHistory.set(msg.from, history);

  try {
    await commands.handle(msg, client);
  } catch (err) {
    console.error('Error handling message:', err);
  }
});

client.initialize();
