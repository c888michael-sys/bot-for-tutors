const { Telegraf } = require('telegraf');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./data/config.json');
const telegram = require('./src/telegram');
const commands = require('./src/commands');
const reminders = require('./src/reminders');
const storage = require('./src/save');

const DUPLICATE_ALERT_STATE = path.join(__dirname, 'data', '.duplicate_alert_count');
const DUPLICATE_ALERT_MAX = 3;

async function checkForDuplicatePoller(token) {
  const callTelegram = async (method, payload) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    return res.json().catch(() => ({ ok: false }));
  };

  const me = await callTelegram('getMe', {});
  if (!me.ok) {
    console.error('getMe failed during startup probe:', me);
    return;
  }
  console.log(`Bot @${me.result.username} starting as PID ${process.pid} (tutor bot)`);

  const probe = await callTelegram('getUpdates', { timeout: 0, limit: 1 });
  if (probe.error_code !== 409) {
    try { fs.unlinkSync(DUPLICATE_ALERT_STATE); } catch (e) { /* fine */ }
    return;
  }

  let count = 0;
  try { count = parseInt(fs.readFileSync(DUPLICATE_ALERT_STATE, 'utf8').trim()) || 0; } catch (e) { /* fine */ }

  const adminId = storage.getData().adminChatId;
  if (count < DUPLICATE_ALERT_MAX && adminId) {
    const text =
      `tutor bot: another instance is polling.\n` +
      `Host: ${os.hostname()}\n` +
      `PID refusing to start: ${process.pid}\n` +
      `Alert ${count + 1}/${DUPLICATE_ALERT_MAX} — will go silent after this.\n` +
      `Fix: ssh in, pm2 list, delete any duplicate pm2 entry pointing at this script.`;
    const sendResult = await callTelegram('sendMessage', { chat_id: adminId, text });
    if (!sendResult.ok) console.error('Failed to send duplicate-alert:', sendResult);
    try { fs.writeFileSync(DUPLICATE_ALERT_STATE, String(count + 1)); } catch (e) { console.error('Failed to write alert state:', e); }
  }

  console.error(`409 Conflict on startup probe — another instance is polling. Refusing to start (alert ${Math.min(count + 1, DUPLICATE_ALERT_MAX)}/${DUPLICATE_ALERT_MAX}).`);
  process.exit(1);
}

const bot = new Telegraf(config.botToken);

// Password gate — new users must enter password then set their name
bot.use(async (ctx, next) => {
  const chatId = String(ctx.chat?.id);
  if (!chatId) return;
  if (storage.isRegistered(chatId)) return next();

  const text = ctx.message?.text?.trim();

  if (storage.isPendingSetup(chatId)) {
    if (!text || text.startsWith('/')) return ctx.reply('Please enter your name:');
    storage.completeSetup(chatId, text);
    const isAdmin = storage.isAdmin(chatId);
    return ctx.reply(
      `👋 Welcome, *${text}*!${isAdmin ? ' You are the admin.' : ''}\n\nTap a menu button below, or type /menu anytime to refresh it.`,
      { parse_mode: 'Markdown', ...telegram.mainReplyKeyboard(isAdmin) }
    );
  }

  const currentPassword = storage.getPassword(config.password);
  if (text === currentPassword) {
    storage.startSetup(chatId);
    return ctx.reply('✅ Password correct!\n\nWhat\'s your name? (so the admin knows who you are)');
  }
  return ctx.reply('🔒 Enter the password to use this bot:');
});

// Commands
bot.command(['start', 'menu'], ctx => telegram.forceRefreshMainMenu(ctx));

bot.command('testnotify', async ctx => {
  const users = storage.getAllUsers();
  const ids = Object.keys(users);
  for (const id of ids) {
    await bot.telegram.sendMessage(id, '🧪 *Test Notification*\nReminders are working correctly!', { parse_mode: 'Markdown' });
  }
  ctx.reply(`✅ Sent test to ${ids.length} user(s).`);
});

bot.command('password', ctx => {
  if (!storage.isAdmin(String(ctx.chat.id))) return ctx.reply('⛔ Admin only.');
  const pw = storage.getPassword(config.password);
  ctx.reply(`🔑 Current password: \`${pw}\``, { parse_mode: 'Markdown' });
});

bot.command('newpassword', ctx => {
  if (!storage.isAdmin(String(ctx.chat.id))) return ctx.reply('⛔ Admin only.');
  const pw = storage.generatePassword();
  storage.setPassword(pw);
  ctx.reply(`✅ New password set: \`${pw}\`\n\nShare this with anyone you want to give access.`, { parse_mode: 'Markdown' });
});

// Button callbacks
bot.on('callback_query', async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  await telegram.handleCallback(ctx, bot);
});

// Text messages
bot.on('text', async ctx => {
  const chatId = String(ctx.chat.id);
  const text = ctx.message.text;

  // Persistent reply-keyboard buttons always navigate, even mid-session (escape hatch)
  if (telegram.isMainMenuButton(text)) {
    return telegram.handleMainMenuButton(ctx);
  }

  // If in a session (text input expected during a flow)
  if (telegram.hasSession(chatId)) {
    return telegram.handleTextInput(ctx, bot);
  }
  // Otherwise process as text command
  const msg = telegram.wrapMsg(ctx);
  await commands.handle(msg, bot);
});

(async () => {
  await checkForDuplicatePoller(config.botToken);
  await bot.launch();
  reminders.init(bot);
  console.log('Tutor bot running on Telegram. Message the bot to get started.');
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
