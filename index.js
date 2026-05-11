const { Telegraf } = require('telegraf');
const config = require('./data/config.json');
const telegram = require('./src/telegram');
const commands = require('./src/commands');
const reminders = require('./src/reminders');
const storage = require('./src/save');

const bot = new Telegraf(config.botToken);

// Register tutor chat ID on first interaction
bot.use(async (ctx, next) => {
  if (ctx.chat?.id) {
    const data = storage.getData();
    if (!data.tutorChatId) {
      storage.setTutorChatId(String(ctx.chat.id));
      console.log('Tutor chat ID saved:', ctx.chat.id);
    }
  }
  return next();
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
