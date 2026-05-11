const { Telegraf } = require('telegraf');
const config = require('./data/config.json');
const telegram = require('./src/telegram');
const commands = require('./src/commands');
const reminders = require('./src/reminders');
const storage = require('./src/save');

const bot = new Telegraf(config.botToken);

// Password gate — new users must enter the password to unlock the bot
bot.use(async (ctx, next) => {
  const chatId = String(ctx.chat?.id);
  if (!chatId) return;
  if (storage.isRegistered(chatId)) return next();

  const text = ctx.message?.text?.trim();
  if (text === config.password) {
    storage.registerUser(chatId);
    return ctx.reply('✅ Access granted! Send /menu to get started.');
  }
  return ctx.reply('🔒 Enter the password to use this bot:');
});

// Commands
bot.command(['start', 'menu'], ctx => telegram.sendMainMenu(ctx));

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
