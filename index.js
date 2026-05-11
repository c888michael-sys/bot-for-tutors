const { Telegraf } = require('telegraf');
const config = require('./data/config.json');
const telegram = require('./src/telegram');
const commands = require('./src/commands');
const reminders = require('./src/reminders');
const storage = require('./src/save');

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
    return ctx.reply(`👋 Welcome, *${text}*!${isAdmin ? ' You are the admin.' : ''}\n\nSend /menu to get started.`, { parse_mode: 'Markdown' });
  }

  const currentPassword = storage.getPassword(config.password);
  if (text === currentPassword) {
    storage.startSetup(chatId);
    return ctx.reply('✅ Password correct!\n\nWhat\'s your name? (so the admin knows who you are)');
  }
  return ctx.reply('🔒 Enter the password to use this bot:');
});

// Commands
bot.command(['start', 'menu'], ctx => telegram.sendMainMenu(ctx));

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
  // If in a session (text input expected during a flow)
  if (telegram.hasSession(chatId)) {
    return telegram.handleTextInput(ctx, bot);
  }
  // Otherwise process as text command
  const msg = telegram.wrapMsg(ctx);
  await commands.handle(msg, bot);
});

bot.launch();
reminders.init(bot);
console.log('Tutor bot running on Telegram. Message the bot to get started.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
