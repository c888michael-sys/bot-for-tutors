const storage = require('./save');

const sessions = new Map();

function hasSession(chatId) { return sessions.has(chatId); }
function setSession(chatId, state, data = {}) { sessions.set(chatId, { state, data }); }
function clearSession(chatId) { sessions.delete(chatId); }

// ─── Menus ───────────────────────────────────────────────────────────────────

async function sendMainMenu(msg, client) {
  const chatId = msg.from;
  setSession(chatId, 'MAIN_MENU');
  return msg.reply(
    `*Tutor Bot Menu*\n\n` +
    `1 — View/manage a student\n` +
    `2 — Add a student\n` +
    `3 — Help & commands\n\n` +
    `_Reply with a number._`
  );
}

async function sendStudentList(msg, nextState) {
  const chatId = msg.from;
  const data = storage.getData();
  const names = Object.keys(data.students);

  if (names.length === 0) {
    clearSession(chatId);
    return msg.reply('No students yet.\nType: student add [name]');
  }

  const list = names.map((n, i) => `${i + 1} — ${n}`).join('\n');
  setSession(chatId, nextState, { names });
  return msg.reply(`*Select a student:*\n\n${list}\n\n_Reply with a number._`);
}

async function sendStudentMenu(msg, studentName) {
  const chatId = msg.from;
  const r = storage.getStudent(studentName);
  const nextLesson = r?.student?.nextLesson
    ? new Date(r.student.nextLesson).toDateString()
    : 'not set';
  setSession(chatId, 'STUDENT_MENU', { studentName });
  return msg.reply(
    `*${studentName}*\n📅 Next lesson: ${nextLesson}\n\n` +
    `1 — View status\n` +
    `2 — View homework topics\n` +
    `3 — View lesson topics\n` +
    `4 — Set homework content\n` +
    `5 — Set lesson plan content\n` +
    `6 — Set next lesson date\n\n` +
    `_Reply with a number._`
  );
}

// ─── Response router ──────────────────────────────────────────────────────────

async function handleResponse(msg, client) {
  const chatId = msg.from;
  const session = sessions.get(chatId);
  if (!session) return;

  const body = msg.body.trim();
  const { state, data: sd } = session;

  if (state === 'MAIN_MENU') {
    clearSession(chatId);
    if (body === '1') return sendStudentList(msg, 'SELECT_STUDENT');
    if (body === '2') {
      setSession(chatId, 'AWAITING_NEW_STUDENT');
      return msg.reply('Enter the new student\'s name:');
    }
    if (body === '3') return sendHelp(msg);
    return msg.reply('Please reply with 1, 2, or 3.');
  }

  if (state === 'AWAITING_NEW_STUDENT') {
    clearSession(chatId);
    const name = body.trim();
    if (!name) return msg.reply('Name cannot be empty.');
    const ok = storage.addStudent(name);
    return msg.reply(ok ? `✅ Student *${name}* added.` : `"${name}" already exists.`);
  }

  if (state === 'SELECT_STUDENT') {
    const { names } = sd;
    const idx = parseInt(body) - 1;
    if (isNaN(idx) || idx < 0 || idx >= names.length) {
      return msg.reply(`Please reply with a number between 1 and ${names.length}.`);
    }
    const studentName = names[idx];
    return sendStudentMenu(msg, studentName);
  }

  if (state === 'STUDENT_MENU') {
    const { studentName } = sd;
    clearSession(chatId);

    if (body === '1') return outputStatus(msg, studentName);
    if (body === '2') return outputHomework(msg, studentName);
    if (body === '3') return outputLesson(msg, studentName);
    if (body === '4') {
      setSession(chatId, 'SET_HOMEWORK', { studentName });
      return msg.reply(`Enter homework content for *${studentName}*:`);
    }
    if (body === '5') {
      setSession(chatId, 'SET_LESSON', { studentName });
      return msg.reply(`Enter lesson plan for *${studentName}*:`);
    }
    if (body === '6') {
      setSession(chatId, 'SET_LESSON_DATE', { studentName });
      return msg.reply(`Enter the next lesson date for *${studentName}*:\n_(e.g. 12 May, May 12, 2026-05-12)_`);
    }
    return msg.reply('Please reply with a number between 1 and 6.');
  }

  if (state === 'SET_LESSON_DATE') {
    clearSession(chatId);
    const { studentName } = sd;
    const parsed = new Date(body);
    if (isNaN(parsed.getTime())) {
      return msg.reply(`Couldn't parse "${body}" as a date.\nTry: 12 May, May 12, 2026-05-12`);
    }
    const r = storage.getStudent(studentName);
    if (!r) return msg.reply('Student not found.');
    r.student.nextLesson = parsed.toISOString();
    storage.saveStudent(r.key, r.student);
    return msg.reply(`✅ Next lesson for *${r.key}* set to: ${parsed.toDateString()}`);
  }

  if (state === 'SET_HOMEWORK') {
    clearSession(chatId);
    const r = storage.getStudent(sd.studentName);
    if (!r) return msg.reply('Student not found.');
    r.student.homework = body;
    storage.saveStudent(r.key, r.student);
    return msg.reply(`✅ Homework saved for *${r.key}*:\n${body}`);
  }

  if (state === 'SET_LESSON') {
    clearSession(chatId);
    const r = storage.getStudent(sd.studentName);
    if (!r) return msg.reply('Student not found.');
    r.student.lesson = body;
    storage.saveStudent(r.key, r.student);
    return msg.reply(`✅ Lesson plan saved for *${r.key}*:\n${body}`);
  }

  clearSession(chatId);
}

// ─── Output helpers (also called directly by commands.js) ────────────────────

async function outputStatus(msg, studentName) {
  const r = storage.getStudent(studentName);
  if (!r) return msg.reply(`Student "${studentName}" not found.`);
  const { key, student } = r;
  const entries = Object.entries(student.status);
  if (entries.length === 0)
    return msg.reply(`*${key}*'s status is empty.\nAdd topics with:\ninput status add [topic] [1-3] ${key}`);

  const good = entries.filter(([, v]) => v === 3);
  const mid  = entries.filter(([, v]) => v === 2);
  const weak = entries.filter(([, v]) => v === 1);

  let out = `📊 *Status: ${key}*`;
  if (good.length) out += `\n\n✅ *Strong (3/3)*\n${good.map(([t]) => `• ${t}`).join('\n')}`;
  if (mid.length)  out += `\n\n🔄 *Progressing (2/3)*\n${mid.map(([t]) => `• ${t}`).join('\n')}`;
  if (weak.length) out += `\n\n⚠️ *Needs Work (1/3)*\n${weak.map(([t]) => `• ${t}`).join('\n')}`;
  return msg.reply(out);
}

async function outputHomework(msg, studentName) {
  const r = storage.getStudent(studentName);
  if (!r) return msg.reply(`Student "${studentName}" not found.`);
  const { key, student } = r;
  const topics = Object.entries(student.status).filter(([, v]) => v === 2).map(([t]) => t);

  let out = `📚 *Homework Topics: ${key}*\n_(rating 2/3 — getting there)_\n\n`;
  out += topics.length ? topics.map(t => `• ${t}`).join('\n') : '_None at level 2 yet._';
  if (student.homework) out += `\n\n*Current homework:*\n${student.homework}`;
  return msg.reply(out);
}

async function outputLesson(msg, studentName) {
  const r = storage.getStudent(studentName);
  if (!r) return msg.reply(`Student "${studentName}" not found.`);
  const { key, student } = r;
  const topics = Object.entries(student.status).filter(([, v]) => v === 1).map(([t]) => t);

  let out = `📋 *Lesson Topics: ${key}*\n_(rating 1/3 — needs work)_\n\n`;
  out += topics.length ? topics.map(t => `• ${t}`).join('\n') : '_None at level 1 yet._';
  if (student.lesson) out += `\n\n*Current lesson plan:*\n${student.lesson}`;
  return msg.reply(out);
}

async function sendHelp(msg) {
  return msg.reply(
    `*Commands*\n\n` +
    `*Status:*\n` +
    `input status add [topic] [1-3] [name]\n` +
    `input status [topic] [1-3] [name]\n` +
    `input status remove [topic] [name]\n` +
    `output status [name]\n\n` +
    `*Homework & lesson:*\n` +
    `input homework [name] [content]\n` +
    `input lesson [name] [content]\n` +
    `output homework [name]\n` +
    `output lesson [name]\n\n` +
    `*Reminders:*\n` +
    `lesson [name] end\n` +
    `homework [name] done\n` +
    `lesson [name] done\n\n` +
    `*Students:*\n` +
    `student add / rename / delete [name]\n\n` +
    `_Type *menu* anytime to return here._`
  );
}

module.exports = { hasSession, handleResponse, sendMainMenu, outputStatus, outputHomework, outputLesson };
