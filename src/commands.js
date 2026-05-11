const storage = require('./save');
const reminders = require('./reminders');
const telegram = require('./telegram');
const { parseDate } = require('./utils');

async function handle(msg, client) {
  const raw = msg.body.trim();
  if (!raw) return;

  const chatId = msg.from;
  const tokens = raw.split(/\s+/);
  const lower = tokens.map(t => t.toLowerCase());


  const cmd0 = lower[0];

  // ── Stop reminders (no input/output prefix) ──────────────────────────────
  if ((cmd0 === 'homework' || cmd0 === 'lesson') && lower[lower.length - 1] === 'done') {
    const name = tokens.slice(1, -1).join(' ');
    return handleStopReminder(msg, cmd0, name);
  }

  // ── Set next lesson date: lesson [name] date [date text] ─────────────────
  if (cmd0 === 'lesson' && lower[2] === 'date') {
    const name = tokens[1];
    const dateText = tokens.slice(3).join(' ').trim();
    return handleSetLessonDate(msg, name, dateText);
  }

  // ── Student management ───────────────────────────────────────────────────
  if (cmd0 === 'student') return handleStudentCmd(msg, tokens, lower);

  // ── Menu / help ──────────────────────────────────────────────────────────
  if (cmd0 === 'menu' || cmd0 === 'help') return msg.reply('Use /menu to open the menu.');

  // ── input / output ───────────────────────────────────────────────────────
  if (cmd0 === 'input') {
    const sub = lower[1];
    if (sub === 'status')   return handleInputStatus(msg, tokens, lower);
    if (sub === 'homework') return handleInputContent(msg, tokens, 'homework');
    if (sub === 'lesson')   return handleInputContent(msg, tokens, 'lesson');
    return msg.reply('Unknown input type. Use: status / homework / lesson');
  }

  if (cmd0 === 'output') {
    const sub = lower[1];
    if (sub === 'status')   return handleOutputStatus(msg, tokens);
    if (sub === 'homework') return handleOutputType(msg, tokens, 'homework');
    if (sub === 'lesson')   return handleOutputType(msg, tokens, 'lesson');
    return msg.reply('Unknown output type. Use: status / homework / lesson');
  }
  // Unknown — silently ignore to avoid spam
}

// ── Handler implementations ──────────────────────────────────────────────────

async function handleStopReminder(msg, type, name) {
  if (!name) return msg.reply(`Usage: ${type} [student name] done`);
  const fn = type === 'homework' ? reminders.stopHomeworkReminder : reminders.stopLessonReminder;
  const key = fn(msg.from, name);
  if (!key) return msg.reply(`Student "${name}" not found.`);
  const label = type === 'homework' ? 'Homework' : 'Lesson plan';
  return msg.reply(`✅ ${label} reminder stopped for *${key}*.`);
}

async function handleSetLessonDate(msg, name, dateText) {
  const chatId = msg.from;
  if (!name) return msg.reply('Usage: lesson [name] date [date]');
  const r = storage.getStudent(chatId, name);
  if (!r) return msg.reply(`Student "${name}" not found.`);
  if (!dateText) {
    const current = r.student.nextLesson ? new Date(r.student.nextLesson).toDateString() : 'not set';
    return msg.reply(`*${r.key}*'s next lesson: ${current}`);
  }
  const parsed = parseDate(dateText);
  if (!parsed) return msg.reply(`Couldn't parse "${dateText}". Try: 12 May`);
  r.student.nextLesson = parsed.toISOString();
  storage.saveStudent(chatId, r.key, r.student);
  return msg.reply(`✅ Next lesson for *${r.key}* set to: ${parsed.toDateString()}`);
}

async function handleStudentCmd(msg, tokens, lower) {
  const chatId = msg.from;
  const action = lower[1];

  if (action === 'add') {
    const name = tokens.slice(2).join(' ').trim();
    if (!name) return msg.reply('Usage: student add [name]');
    const ok = storage.addStudent(chatId, name);
    return msg.reply(ok ? `✅ Student *${name}* added.` : `"${name}" already exists.`);
  }
  if (action === 'rename') {
    const oldName = tokens[2];
    const newName = tokens.slice(3).join(' ').trim();
    if (!oldName || !newName) return msg.reply('Usage: student rename [old] [new]');
    const r = storage.renameStudent(chatId, oldName, newName);
    if (r === 'not_found') return msg.reply(`"${oldName}" not found.`);
    if (r === 'exists')    return msg.reply(`"${newName}" already exists.`);
    return msg.reply(`✅ Renamed *${oldName}* → *${newName}*.`);
  }
  if (action === 'delete') {
    const name = tokens.slice(2).join(' ').trim();
    if (!name) return msg.reply('Usage: student delete [name]');
    const ok = storage.deleteStudent(chatId, name);
    return msg.reply(ok ? `✅ Student *${name}* deleted.` : `"${name}" not found.`);
  }
  if (action === 'year') {
    const name = tokens[2], year = tokens[3];
    if (!name || !year) return msg.reply('Usage: student year [name] [year]');
    const r = storage.getStudent(chatId, name);
    if (!r) return msg.reply(`"${name}" not found.`);
    r.student.year = year;
    storage.saveStudent(chatId, r.key, r.student);
    return msg.reply(`✅ Set *${r.key}* to ${year}.`);
  }
  return msg.reply('Usage: student add / rename / delete / year [name]');
}

async function handleInputStatus(msg, tokens, lower) {
  // input status [add|remove] <topic...> [rating] <student>
  if (tokens.length < 4) return msg.reply(
    'Usage:\n' +
    '`input status add [topic] [1-3] [name]`\n' +
    '`input status [topic] [1-3] [name]`\n' +
    '`input status remove [topic] [name]`'
  );

  const modifier = lower[2]; // 'add', 'remove', or first word of topic
  const isAdd    = modifier === 'add';
  const isRemove = modifier === 'remove';
  const bodyStart = (isAdd || isRemove) ? 3 : 2; // index where topic/name body starts
  const bodyTokens = tokens.slice(bodyStart);     // everything after the modifier

  const chatId = msg.from;

  if (isRemove) {
    const match = storage.resolveStudentSuffix(chatId, bodyTokens);
    if (!match) return msg.reply('Student not found. Check the name at the end.');
    const topic = bodyTokens.slice(0, bodyTokens.length - match.nameLen).join(' ');
    if (!topic) return msg.reply('Please include a topic name to remove.');
    const { key, student } = match;
    const topicKey = findTopicKey(student.status, topic);
    if (!topicKey) return msg.reply(`Error: topic "${topic}" not found for ${key}.`);
    telegram.askConfirmRemoveTopic(chatId, key, topicKey);
    return msg.reply(`Remove *${topicKey}* from *${key}*?\n\nType *yes* to confirm or anything else to cancel.`);
  }

  for (let nameLen = Math.min(3, bodyTokens.length - 1); nameLen >= 1; nameLen--) {
    const candidate = bodyTokens.slice(bodyTokens.length - nameLen).join(' ');
    const key = storage.findStudentKey(chatId, candidate);
    if (!key) continue;
    const ratingIdx = bodyTokens.length - nameLen - 1;
    if (ratingIdx < 0) continue;
    const rating = parseInt(bodyTokens[ratingIdx]);
    if (isNaN(rating) || rating < 1 || rating > 3) continue;
    const topic = bodyTokens.slice(0, ratingIdx).join(' ');
    if (!topic) return msg.reply('Please include a topic name.');
    const r = storage.getStudent(chatId, key);
    const student = r.student;
    const existingKey = findTopicKey(student.status, topic);
    const label = rating === 1 ? 'Poor/Not learnt' : rating === 2 ? 'Getting there' : 'Good';
    if (isAdd) {
      if (existingKey) return msg.reply(`"${existingKey}" already exists. Omit "add" to modify it.`);
      student.status[topic] = rating;
      storage.saveStudent(chatId, key, student);
      return msg.reply(`✅ Added "${topic}" (${rating}/3 — ${label}) for *${key}*.`);
    } else {
      if (!existingKey) return msg.reply(`Error: topic "${topic}" not found for ${key}.`);
      student.status[existingKey] = rating;
      storage.saveStudent(chatId, key, student);
      return msg.reply(`✅ Updated "${existingKey}" → ${rating}/3 (${label}) for *${key}*.`);
    }
  }

  return msg.reply('Could not parse command. Check student name and rating (1–3).\nExample: `input status add algebra 2 Josh`');
}

async function handleInputContent(msg, tokens, type) {
  const chatId = msg.from;
  let nameLen = 0, key = null;
  for (let len = Math.min(3, tokens.length - 3); len >= 1; len--) {
    const candidate = tokens.slice(2, 2 + len).join(' ');
    key = storage.findStudentKey(chatId, candidate);
    if (key) { nameLen = len; break; }
  }
  if (!key) return msg.reply(`Usage: input ${type} [student name] [content]\nStudent not found.`);
  const content = tokens.slice(2 + nameLen).join(' ').trim();
  if (!content) return msg.reply(`Please include the ${type} content after the student name.`);
  const r = storage.getStudent(chatId, key);
  r.student[type] = content;
  storage.saveStudent(chatId, key, r.student);
  return msg.reply(`✅ ${cap(type)} saved for *${key}*:\n${content}`);
}

async function handleOutputStatus(msg, tokens) {
  const name = tokens.slice(2).join(' ').trim();
  if (!name) return msg.reply('Usage: output status [student name]');
  return telegram.outputStatus(msg, name);
}

async function handleOutputType(msg, tokens, type) {
  const name = tokens.slice(2).join(' ').trim();
  if (!name) return msg.reply(`Usage: output ${type} [student name]`);
  return type === 'homework'
    ? telegram.outputHomework(msg, name)
    : telegram.outputLesson(msg, name);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findTopicKey(status, topic) {
  return Object.keys(status).find(k => k.toLowerCase() === topic.toLowerCase()) || null;
}

function cap(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = { handle };
