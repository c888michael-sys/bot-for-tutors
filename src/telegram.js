const { Markup } = require('telegraf');
const storage = require('./save');
const { parseDate, parseTime, formatTime } = require('./utils');

const sessions = new Map();
const SESSION_TIMEOUT = 10 * 60 * 1000;

const btn = (text, data) => Markup.button.callback(text, data);

// ── Session management ────────────────────────────────────────────────────────

function hasSession(chatId) {
  const s = sessions.get(chatId);
  if (!s) return false;
  if (Date.now() - s.lastActive > SESSION_TIMEOUT) { sessions.delete(chatId); return false; }
  return true;
}
function setSession(chatId, state, data = {}) {
  sessions.set(chatId, { state, data, lastActive: Date.now() });
}
function clearSession(chatId) { sessions.delete(chatId); }
function refreshSession(chatId) { const s = sessions.get(chatId); if (s) s.lastActive = Date.now(); }

// ── Keyboards ─────────────────────────────────────────────────────────────────

const mainMenuKeyboard = (isAdmin) => Markup.inlineKeyboard([
  [btn('👤 Students', 'students'), btn('🔔 Reminders', 'reminders')],
  [btn('➕ Add Student', 'setup'), btn('📖 Help', 'help')],
  ...(isAdmin ? [[btn('👑 Admin Panel', 'admin')]] : []),
]);

const studentListKeyboard = (names) => {
  const rows = names.map(n => [btn(n, `s:${n}`)]);
  rows.push([btn('⬅️ Back', 'menu')]);
  return Markup.inlineKeyboard(rows);
};

const studentMenuKeyboard = (name) => Markup.inlineKeyboard([
  [btn('📊 Status', `s:${name}:status`)],
  [btn('➕ Add Topic', `s:${name}:add_topic`), btn('✏️ Update Rating', `s:${name}:upd_topic`)],
  [btn('📝 Exam Results', `s:${name}:exams`)],
  [btn('📚 Homework', `s:${name}:hw`),      btn('📋 Lesson', `s:${name}:lesson`)],
  [btn('📅 Lesson Date', `s:${name}:lesson_date`), btn('⏸ Snooze', `s:${name}:snooze`)],
  [btn('⚙️ Edit Info', `s:${name}:edit`)],
  [btn('⬅️ Back', 'students')],
]);

const editMenuKeyboard = (name) => Markup.inlineKeyboard([
  [btn('✏️ Rename', `s:${name}:edit:rename`),          btn('🎓 Year', `s:${name}:edit:year`)],
  [btn('📅 Lesson Schedule', `s:${name}:edit:schedule`),btn('⏱ Duration', `s:${name}:edit:duration`)],
  [btn('📆 Override This Week', `s:${name}:edit:override`)],
  [btn('🗑 Delete Student', `s:${name}:edit:delete`)],
  [btn('⬅️ Back', `s:${name}`)],
]);

// ── Reply helper ──────────────────────────────────────────────────────────────

const md = { parse_mode: 'Markdown' };
const reply = (ctx, text, extra = {}) =>
  ctx.callbackQuery
    ? ctx.editMessageText(text, { ...md, ...extra })
    : ctx.reply(text, { ...md, ...extra });

const cid = (ctx) => String(ctx.chat.id);

// ── Menu senders ──────────────────────────────────────────────────────────────

async function sendMainMenu(ctx) {
  await reply(ctx, '*🎓 Tutor Bot*\n\nWhat would you like to do?', mainMenuKeyboard(storage.isAdmin(cid(ctx))));
}

async function sendStudentList(ctx) {
  const names = Object.keys(storage.getStudents(cid(ctx)));
  if (names.length === 0)
    return reply(ctx, 'No students yet. Use Add Student to get started.',
      Markup.inlineKeyboard([[btn('⬅️ Back', 'menu')]]));
  await reply(ctx, '*👤 Select a Student*', studentListKeyboard(names));
}

async function sendStudentMenu(ctx, studentName) {
  const chatId = cid(ctx);
  const r = storage.getStudent(chatId, studentName);
  if (!r) return sendStudentList(ctx);
  const { key, student } = r;
  const date = student.nextLesson ? new Date(student.nextLesson).toDateString() : 'not set';
  const time = student.lessonTime ? formatTime(student.lessonTime) : 'not set';
  const day  = student.lessonDay  ? student.lessonDay + ' · ' : '';
  const year = student.year ? ` · ${student.year}` : '';
  await reply(ctx, `*${key}*${year}\n📅 ${day}${date} at ${time}`, studentMenuKeyboard(key));
}

async function sendEditMenu(ctx, studentName) {
  const chatId = cid(ctx);
  const r = storage.getStudent(chatId, studentName);
  if (!r) return sendStudentList(ctx);
  const { key, student } = r;
  const time     = student.lessonTime ? formatTime(student.lessonTime) : 'not set';
  const day      = student.lessonDay || 'not set';
  const duration = student.lessonDuration || 60;
  const year     = student.year || 'not set';
  await reply(ctx, `*✏️ Edit: ${key}* · ${year}\n📅 ${day} · ${time} · ${duration} min`, editMenuKeyboard(key));
}

// ── Callback handler ──────────────────────────────────────────────────────────

async function handleCallback(ctx, bot) {
  const cbData = ctx.callbackQuery.data;
  const chatId = cid(ctx);
  const parts  = cbData.split(':');

  if (cbData === 'menu')      return sendMainMenu(ctx);
  if (cbData === 'students')  return sendStudentList(ctx);
  if (cbData === 'reminders') return sendActiveReminders(ctx);
  if (cbData === 'help')      return sendHelp(ctx);
  if (cbData === 'admin')     return sendAdminPanel(ctx);

  // Reminder action buttons
  if (parts[0] === 'rdone') {
    const type = parts[1];
    const name = parts.slice(2).join(':');
    const reminders = require('./reminders');
    if (type === 'hw') reminders.stopHomeworkReminder(chatId, name);
    else reminders.stopLessonReminder(chatId, name);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    return ctx.reply(`✅ ${type === 'hw' ? 'Homework' : 'Lesson plan'} reminder stopped for *${name}*.`, md);
  }
  if (parts[0] === 'rsnooze') {
    const name = parts.slice(1).join(':');
    const data = storage.getData();
    const key  = storage.findStudentKey(chatId, name);
    if (key) {
      data.users[chatId].students[key].homeworkReminder.active = false;
      data.users[chatId].students[key].lessonReminder.active   = false;
      storage.saveData(data);
    }
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    return ctx.reply(`⏸ Reminders snoozed for *${name}*.`, md);
  }
  if (cbData === 'setup') {
    setSession(chatId, 'SETUP_NAME');
    return ctx.reply('Enter student name:\n\n/cancel to cancel');
  }

  // Rating callback during add-topic flow
  if (parts[0] === '_rate') {
    const session = sessions.get(chatId);
    if (session?.state !== 'ADD_TOPIC_RATING') return;
    refreshSession(chatId);
    const rating = parseInt(parts[1]);
    clearSession(chatId);
    const { studentName, topic } = session.data;
    const r = storage.getStudent(chatId, studentName);
    if (!r) return ctx.reply('Student not found.');
    const label = rating === 1 ? 'Poor/Not learnt' : rating === 2 ? 'Getting there' : 'Good';
    r.student.status[topic] = rating;
    storage.saveStudent(chatId, r.key, r.student);
    await ctx.reply(`✅ Added *${topic}* (${rating}/3 — ${label}) for *${r.key}*.`, md);
    return ctx.reply('Add another topic?', { ...md, ...Markup.inlineKeyboard([
      [btn('➕ Add Another', `s:${r.key}:add_topic`), btn('✅ Done', `s:${r.key}`)],
    ]) });
  }

  // Admin: delete user
  if (parts[0] === 'adel') {
    if (!storage.isAdmin(chatId)) return;
    const targetId = parts[1];
    const user = storage.getAllUsers()[targetId];
    if (parts[2] === 'confirm') {
      storage.deleteUser(targetId);
      await ctx.reply(`✅ *${user?.name || targetId}* deleted.`, md);
      return sendAdminPanel(ctx);
    }
    return reply(ctx, `Delete *${user?.name || targetId}*? This cannot be undone.`,
      Markup.inlineKeyboard([
        [btn('✅ Yes, delete', `adel:${targetId}:confirm`), btn('❌ Cancel', 'admin')],
      ]));
  }

  if (parts[0] !== 's') return;
  const name   = parts[1];
  const action = parts[2];

  if (!action) return sendStudentMenu(ctx, name);
  if (action === 'status') return outputStatus(ctx, name, chatId);
  if (action === 'hw')     return outputHomework(ctx, name, chatId);
  if (action === 'lesson') return outputLesson(ctx, name, chatId);
  if (action === 'exams')  return handleExamAction(ctx, chatId, name, parts);

  if (action === 'add_topic') {
    setSession(chatId, 'ADD_TOPIC_NAME', { studentName: name });
    return ctx.reply(`Enter topic name for *${name}*:\n\n/cancel to cancel`, md);
  }

  if (action === 'upd_topic' && !parts[3]) {
    const r = storage.getStudent(chatId, name);
    if (!r) return sendStudentList(ctx);
    const topics = Object.entries(r.student.status);
    if (topics.length === 0) return ctx.reply(`*${name}* has no topics yet.`, md);
    const rows = topics.map(([t, v], i) => [btn(`${t} (${v}/3)`, `s:${name}:upd:${i}`)]);
    rows.push([btn('⬅️ Back', `s:${name}`)]);
    return reply(ctx, `*Update Topic: ${name}*`, Markup.inlineKeyboard(rows));
  }

  if (action === 'upd' && parts[3] !== undefined && parts[4] === undefined) {
    const r = storage.getStudent(chatId, name);
    if (!r) return sendStudentList(ctx);
    const topics = Object.entries(r.student.status);
    const idx = parseInt(parts[3]);
    if (idx < 0 || idx >= topics.length) return sendStudentMenu(ctx, name);
    const [topicName, cur] = topics[idx];
    return reply(ctx, `*${topicName}* — currently ${cur}/3\n\nNew rating:`, Markup.inlineKeyboard([
      [btn('1 — Poor / Not learnt', `s:${name}:upd:${idx}:1`)],
      [btn('2 — Getting there',     `s:${name}:upd:${idx}:2`)],
      [btn('3 — Good',              `s:${name}:upd:${idx}:3`)],
      [btn('⬅️ Back', `s:${name}:upd_topic`)],
    ]));
  }

  if (action === 'upd' && parts[4] !== undefined) {
    const r = storage.getStudent(chatId, name);
    if (!r) return sendStudentList(ctx);
    const topics = Object.entries(r.student.status);
    const idx = parseInt(parts[3]);
    const rating = parseInt(parts[4]);
    if (idx < 0 || idx >= topics.length) return sendStudentMenu(ctx, name);
    const [topicName] = topics[idx];
    const label = rating === 1 ? 'Poor/Not learnt' : rating === 2 ? 'Getting there' : 'Good';
    r.student.status[topicName] = rating;
    storage.saveStudent(chatId, r.key, r.student);
    await ctx.reply(`✅ *${topicName}* → ${rating}/3 (${label}) for *${r.key}*.`, md);
    return ctx.reply(`*${r.key}*`, { ...md, ...studentMenuKeyboard(r.key) });
  }

  if (action === 'lesson_date') {
    setSession(chatId, 'LESSON_DATE', { studentName: name });
    return ctx.reply(`Enter next lesson date for *${name}*:\n_(e.g. 12 May)_\n\n/cancel to cancel`, md);
  }

  if (action === 'snooze') {
    const sub = parts[3];
    const r = storage.getStudent(chatId, name);
    if (!r) return sendStudentList(ctx);
    const { key, student } = r;

    const confirm = parts[4];

    // Confirmed — actually stop the reminder
    if ((sub === 'hw' || sub === 'lesson' || sub === 'both') && confirm === 'yes') {
      const data = storage.getData();
      if (sub === 'hw'     || sub === 'both') data.users[chatId].students[key].homeworkReminder.active = false;
      if (sub === 'lesson' || sub === 'both') data.users[chatId].students[key].lessonReminder.active   = false;
      storage.saveData(data);
      const label = sub === 'hw' ? 'Homework' : sub === 'lesson' ? 'Lesson plan' : 'Both reminders';
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      return ctx.reply(`✅ ${label} stopped for *${key}*.\n\nTo reactivate: \`reminder ${key} ${sub === 'hw' ? 'homework' : sub === 'lesson' ? 'lesson' : 'both'}\``, md);
    }

    // Show confirmation prompt
    if (sub === 'hw' || sub === 'lesson' || sub === 'both') {
      const label = sub === 'hw' ? 'homework' : sub === 'lesson' ? 'lesson plan' : 'both';
      return reply(ctx, `Stop *${label}* reminder for *${key}*?`, Markup.inlineKeyboard([
        [btn('✅ Yes, stop it', `s:${key}:snooze:${sub}:yes`), btn('❌ Cancel', `s:${key}:snooze`)],
      ]));
    }

    // Show which reminders are active
    const hw = student.homeworkReminder?.active;
    const ls = student.lessonReminder?.active;
    if (!hw && !ls) {
      return reply(ctx, `*${key}* has no active reminders.\n\nTo reactivate: \`reminder ${key} both\``,
        Markup.inlineKeyboard([[btn('⬅️ Back', `s:${key}`)]]));
    }
    const rows = [];
    if (hw) rows.push([btn('📚 Stop Homework Reminder',    `s:${key}:snooze:hw`)]);
    if (ls) rows.push([btn('📋 Stop Lesson Plan Reminder', `s:${key}:snooze:lesson`)]);
    if (hw && ls) rows.push([btn('🛑 Stop Both',           `s:${key}:snooze:both`)]);
    rows.push([btn('⬅️ Back', `s:${key}`)]);
    return reply(ctx, `*Active Reminders: ${key}*\nSelect which to stop:`, Markup.inlineKeyboard(rows));
  }

  if (action === 'edit') {
    const sub = parts[3];
    if (!sub) return sendEditMenu(ctx, name);

    if (sub === 'rename')   { setSession(chatId, 'RENAME_STUDENT', { studentName: name }); return ctx.reply(`Enter new name for *${name}*:\n\n/cancel to cancel`, md); }
    if (sub === 'year')     { setSession(chatId, 'SET_YEAR',        { studentName: name }); return ctx.reply(`Enter year for *${name}* (e.g. Y7, Y11):\n\n/cancel to cancel`, md); }
    if (sub === 'duration') { setSession(chatId, 'SET_DURATION',    { studentName: name }); return ctx.reply(`Enter duration for *${name}* in minutes (e.g. 60, 90):\n\n/cancel to cancel`, md); }
    if (sub === 'schedule') { setSession(chatId, 'SET_SCHEDULE_DAY',{ studentName: name }); return ctx.reply(`Enter lesson day for *${name}* (e.g. Monday):\n\n/cancel to cancel`, md); }

    if (sub === 'override') {
      const r = storage.getStudent(chatId, name);
      const curDate = r?.student?.nextLesson ? new Date(r.student.nextLesson).toDateString() : 'not set';
      const curTime = r?.student?.lessonTime  ? formatTime(r.student.lessonTime) : 'not set';
      setSession(chatId, 'OVERRIDE_DATE', { studentName: name });
      return ctx.reply(`Override this week's lesson for *${name}*\nCurrent: ${curDate} at ${curTime}\n\nEnter new date (or *skip* to keep):\n\n/cancel to cancel`, md);
    }
    if (sub === 'delete' && parts[4] !== 'confirm') {
      return reply(ctx, `Delete *${name}*? This cannot be undone.`, Markup.inlineKeyboard([
        [btn('✅ Yes, delete', `s:${name}:edit:delete:confirm`)],
        [btn('❌ Cancel',       `s:${name}:edit`)],
      ]));
    }
    if (sub === 'delete' && parts[4] === 'confirm') {
      const ok = storage.deleteStudent(chatId, name);
      await ctx.reply(ok ? `✅ *${name}* deleted.` : 'Student not found.', md);
      return sendStudentList(ctx);
    }
  }
}

// ── Text input handler ────────────────────────────────────────────────────────

async function handleTextInput(ctx, bot) {
  const chatId = cid(ctx);
  const session = sessions.get(chatId);
  if (!session) return;
  refreshSession(chatId);

  const body = ctx.message.text.trim();
  const { state, data: sd } = session;

  if (body === '/cancel') { clearSession(chatId); return ctx.reply('Cancelled.'); }

  if (state === 'SETUP_NAME') {
    if (!body || body.length > 50) return;
    if (storage.getStudent(chatId, body)) return ctx.reply(`"${body}" already exists. Enter a different name:`);
    setSession(chatId, 'SETUP_YEAR', { name: body });
    return ctx.reply(`Year for *${body}*? (e.g. Y7, Y11)\nType *n/a* to skip`, md);
  }
  if (state === 'SETUP_YEAR') {
    const year = body.toLowerCase() === 'n/a' ? null : body;
    setSession(chatId, 'SETUP_DAY', { ...sd, year });
    return ctx.reply(`Lesson day for *${sd.name}*? (e.g. Monday)\nType *n/a* to skip`, md);
  }
  if (state === 'SETUP_DAY') {
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const isNA = body.toLowerCase() === 'n/a';
    if (!isNA && !days.includes(body.trim().toLowerCase())) return ctx.reply('Enter a valid day (e.g. *Monday*) or *n/a*:', md);
    const lessonDay = isNA ? null : body.trim()[0].toUpperCase() + body.trim().slice(1).toLowerCase();
    setSession(chatId, 'SETUP_DATE', { ...sd, lessonDay });
    return ctx.reply(`Next lesson date for *${sd.name}*? (e.g. 12 May)\nType *n/a* to skip`, md);
  }
  if (state === 'SETUP_DATE') {
    const isNA = body.toLowerCase() === 'n/a';
    let nextLesson = null;
    if (!isNA) {
      const parsed = parseDate(body);
      if (!parsed) return ctx.reply(`Couldn't parse that date. Try *12 May* or *n/a*:`, md);
      nextLesson = parsed.toISOString();
    }
    setSession(chatId, 'SETUP_TIME', { ...sd, nextLesson });
    return ctx.reply(`Lesson start time for *${sd.name}*? (e.g. 3pm, 15:00)\nType *n/a* to skip`, md);
  }
  if (state === 'SETUP_TIME') {
    const isNA = body.toLowerCase() === 'n/a';
    const lessonTime = isNA ? null : parseTime(body);
    if (!isNA && !lessonTime) return ctx.reply(`Couldn't parse that time. Try *3pm* or *n/a*:`, md);
    setSession(chatId, 'SETUP_DURATION', { ...sd, lessonTime });
    return ctx.reply(`Lesson duration in minutes (e.g. 60, 90)?\nType *n/a* for default (60 min)`, md);
  }
  if (state === 'SETUP_DURATION') {
    const isNA = body.toLowerCase() === 'n/a';
    const duration = isNA ? 60 : parseInt(body);
    if (!isNA && (isNaN(duration) || duration < 1 || duration > 480)) return ctx.reply('Enter minutes (e.g. 60, 90) or *n/a*:', md);
    clearSession(chatId);
    storage.addStudent(chatId, sd.name);
    const r = storage.getStudent(chatId, sd.name);
    if (sd.year)       r.student.year           = sd.year;
    if (sd.lessonDay)  r.student.lessonDay       = sd.lessonDay;
    if (sd.nextLesson) r.student.nextLesson      = sd.nextLesson;
    if (sd.lessonTime) r.student.lessonTime      = sd.lessonTime;
    r.student.lessonDuration = duration;
    storage.saveStudent(chatId, r.key, r.student);
    await ctx.reply(
      `✅ *${r.key}* added!\nYear: ${sd.year || 'not set'}\nDay: ${sd.lessonDay || 'not set'}\n` +
      `Next lesson: ${sd.nextLesson ? new Date(sd.nextLesson).toDateString() : 'not set'}` +
      `${sd.lessonTime ? ` at ${formatTime(sd.lessonTime)}` : ''}\nDuration: ${duration} min`, md);
    return ctx.reply(`*${r.key}*`, { ...md, ...studentMenuKeyboard(r.key) });
  }

  if (state === 'ADD_TOPIC_NAME') {
    if (!body || body.length > 100) return;
    setSession(chatId, 'ADD_TOPIC_RATING', { ...sd, topic: body });
    return ctx.reply(`Rating for *${body}*:`, { ...md, ...Markup.inlineKeyboard([
      [btn('1 — Poor / Not learnt', '_rate:1')],
      [btn('2 — Getting there',     '_rate:2')],
      [btn('3 — Good',              '_rate:3')],
    ])});
  }

  if (state === 'LESSON_DATE') {
    const parsed = parseDate(body);
    if (!parsed) return ctx.reply(`Couldn't parse that date. Try *12 May*:`, md);
    clearSession(chatId);
    const r = storage.getStudent(chatId, sd.studentName);
    if (!r) return ctx.reply('Student not found.');
    r.student.nextLesson = parsed.toISOString();
    storage.saveStudent(chatId, r.key, r.student);
    await ctx.reply(`✅ Next lesson for *${r.key}* set to: ${parsed.toDateString()}`, md);
    return ctx.reply(`*${r.key}*`, { ...md, ...studentMenuKeyboard(r.key) });
  }

  if (state === 'RENAME_STUDENT') {
    if (!body || body.length > 50) return;
    clearSession(chatId);
    const result = storage.renameStudent(chatId, sd.studentName, body);
    if (result === 'exists')    return ctx.reply(`"${body}" already exists.`);
    if (result === 'not_found') return ctx.reply('Student not found.');
    await ctx.reply(`✅ Renamed to *${body}*.`, md);
    return ctx.reply(`*${body}*`, { ...md, ...studentMenuKeyboard(body) });
  }

  if (state === 'SET_YEAR') {
    if (!body || body.length > 10) return;
    clearSession(chatId);
    const r = storage.getStudent(chatId, sd.studentName);
    if (!r) return ctx.reply('Student not found.');
    r.student.year = body;
    storage.saveStudent(chatId, r.key, r.student);
    await ctx.reply(`✅ Year set to *${body}*.`, md);
    return sendEditMenu(ctx, r.key);
  }

  if (state === 'SET_SCHEDULE_DAY') {
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    if (!days.includes(body.trim().toLowerCase())) return ctx.reply('Enter a valid day (e.g. *Monday*):', md);
    const formatted = body.trim()[0].toUpperCase() + body.trim().slice(1).toLowerCase();
    setSession(chatId, 'SET_SCHEDULE_TIME', { ...sd, lessonDay: formatted });
    return ctx.reply(`Lesson time for *${sd.studentName}*? (e.g. 3pm, 15:00):`, md);
  }

  if (state === 'SET_SCHEDULE_TIME') {
    const time = parseTime(body);
    if (!time) return ctx.reply(`Couldn't parse that time. Try *3pm* or *15:00*:`, md);
    clearSession(chatId);
    const r = storage.getStudent(chatId, sd.studentName);
    if (!r) return ctx.reply('Student not found.');
    r.student.lessonDay  = sd.lessonDay;
    r.student.lessonTime = time;
    storage.saveStudent(chatId, r.key, r.student);
    await ctx.reply(`✅ Lesson set to *${sd.lessonDay}s* at *${formatTime(time)}*.`, md);
    return sendEditMenu(ctx, r.key);
  }

  if (state === 'SET_DURATION') {
    const duration = parseInt(body);
    if (isNaN(duration) || duration < 1 || duration > 480) return ctx.reply('Enter minutes (e.g. 60, 90):');
    clearSession(chatId);
    const r = storage.getStudent(chatId, sd.studentName);
    if (!r) return ctx.reply('Student not found.');
    r.student.lessonDuration = duration;
    storage.saveStudent(chatId, r.key, r.student);
    await ctx.reply(`✅ Duration set to *${duration} min*.`, md);
    return sendEditMenu(ctx, r.key);
  }

  if (state === 'OVERRIDE_DATE') {
    let nextLesson = null;
    if (body.toLowerCase() !== 'skip') {
      const parsed = parseDate(body);
      if (!parsed) return ctx.reply(`Couldn't parse that date. Try *12 May* or *skip*:`, md);
      nextLesson = parsed.toISOString();
    }
    const r = storage.getStudent(chatId, sd.studentName);
    const curTime = r?.student?.lessonTime ? formatTime(r.student.lessonTime) : 'not set';
    setSession(chatId, 'OVERRIDE_TIME', { ...sd, nextLesson });
    return ctx.reply(`Enter new time (or *skip* to keep current: ${curTime}):`, md);
  }

  if (state === 'OVERRIDE_TIME') {
    clearSession(chatId);
    const r = storage.getStudent(chatId, sd.studentName);
    if (!r) return ctx.reply('Student not found.');
    if (sd.nextLesson) r.student.nextLesson = sd.nextLesson;
    if (body.toLowerCase() !== 'skip') {
      const time = parseTime(body);
      if (!time) return ctx.reply('Cancelled — invalid time.');
      r.student.lessonTime = time;
    }
    storage.saveStudent(chatId, r.key, r.student);
    const dateStr = r.student.nextLesson ? new Date(r.student.nextLesson).toDateString() : 'unchanged';
    const timeStr = r.student.lessonTime ? formatTime(r.student.lessonTime) : 'unchanged';
    await ctx.reply(`✅ This week: ${dateStr} at ${timeStr}\n_Recurring schedule unchanged._`, md);
    return ctx.reply(`*${r.key}*`, { ...md, ...studentMenuKeyboard(r.key) });
  }

  if (state === 'EXAM_NAME') {
    if (!body || body.length > 100) return;
    setSession(chatId, 'EXAM_MARK', { ...sd, examName: body });
    return ctx.reply(`Mark for *${body}*?\n_(e.g. 75/100)_\n\n/cancel to cancel`, md);
  }

  if (state === 'EXAM_MARK') {
    const match = body.match(/^(\d+\.?\d*)\s*[\/out of]+\s*(\d+\.?\d*)$/i) ||
                  body.match(/^(\d+\.?\d*)\/(\d+\.?\d*)$/);
    if (!match) return ctx.reply(`Couldn't parse that. Try format: *75/100*`, md);
    const mark = parseFloat(match[1]);
    const total = parseFloat(match[2]);
    clearSession(chatId);
    const r = storage.getStudent(chatId, sd.studentName);
    if (!r) return ctx.reply('Student not found.');
    if (!r.student.exams) r.student.exams = [];
    const today = new Date().toISOString().split('T')[0];
    const pct = Math.round((mark / total) * 100);
    r.student.exams.push({ id: Date.now(), name: sd.examName, mark, total, date: today });
    storage.saveStudent(chatId, r.key, r.student);
    await ctx.reply(`✅ Added *${sd.examName}* — ${mark}/${total} (${pct}%) for *${r.key}*.`, md);
    return ctx.reply(`*${r.key}*`, { ...md, ...studentMenuKeyboard(r.key) });
  }

  if (state === 'EXAM_EDIT_MARK') {
    const match = body.match(/^(\d+\.?\d*)\s*[\/out of]+\s*(\d+\.?\d*)$/i) ||
                  body.match(/^(\d+\.?\d*)\/(\d+\.?\d*)$/);
    if (!match) return ctx.reply(`Couldn't parse that. Try format: *75/100*`, md);
    const mark = parseFloat(match[1]);
    const total = parseFloat(match[2]);
    clearSession(chatId);
    const r = storage.getStudent(chatId, sd.studentName);
    if (!r) return ctx.reply('Student not found.');
    const idx = (r.student.exams || []).findIndex(e => e.id === sd.examId);
    if (idx === -1) return ctx.reply('Exam not found.');
    r.student.exams[idx].mark  = mark;
    r.student.exams[idx].total = total;
    storage.saveStudent(chatId, r.key, r.student);
    const pct = Math.round((mark / total) * 100);
    return ctx.reply(`✅ Updated *${r.student.exams[idx].name}* → ${mark}/${total} (${pct}%).`, md);
  }

  if (state === 'CONFIRM_REMOVE_TOPIC') {
    clearSession(chatId);
    if (body.toLowerCase() === 'yes') {
      const r = storage.getStudent(chatId, sd.studentName);
      if (!r) return ctx.reply('Student not found.');
      delete r.student.status[sd.topicKey];
      storage.saveStudent(chatId, r.key, r.student);
      return ctx.reply(`✅ Removed *${sd.topicKey}* from *${r.key}*.`, md);
    }
    return ctx.reply('Cancelled.');
  }
}

// ── Exam handler ─────────────────────────────────────────────────────────────

async function handleExamAction(ctx, chatId, name, parts) {
  const r = storage.getStudent(chatId, name);
  if (!r) return sendStudentList(ctx);
  const { key, student } = r;
  const exams = student.exams || [];
  const sub = parts[3]; // add | del | edit | (undefined = list)

  // Show exam list
  if (!sub) {
    const sorted = [...exams].sort((a, b) => new Date(b.date) - new Date(a.date));
    const lines = sorted.length
      ? sorted.map(e => {
          const pct = Math.round((e.mark / e.total) * 100);
          return `• *${e.name}* — ${e.mark}/${e.total} (${pct}%) — ${new Date(e.date).toDateString()}`;
        }).join('\n')
      : '_No exams recorded yet._';
    const rows = sorted.map(e => [
      btn(`✏️ ${e.name}`, `s:${key}:exams:edit:${e.id}`),
      btn(`🗑`, `s:${key}:exams:del:${e.id}`),
    ]);
    rows.unshift([btn('➕ Add Exam Result', `s:${key}:exams:add`)]);
    rows.push([btn('⬅️ Back', `s:${key}`)]);
    return reply(ctx, `*📝 Exam Results: ${key}*\n\n${lines}`, Markup.inlineKeyboard(rows));
  }

  if (sub === 'add') {
    setSession(chatId, 'EXAM_NAME', { studentName: key });
    return ctx.reply(`Exam name for *${key}*? (e.g. Algebra Test)\n\n/cancel to cancel`, md);
  }

  const examId = parseInt(parts[4]);
  const examIdx = exams.findIndex(e => e.id === examId);

  if (sub === 'del') {
    if (parts[5] === 'yes') {
      if (examIdx !== -1) {
        exams.splice(examIdx, 1);
        student.exams = exams;
        storage.saveStudent(chatId, key, student);
      }
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      return ctx.reply(`✅ Exam deleted.`, md);
    }
    const exam = exams[examIdx];
    return reply(ctx, `Delete *${exam?.name || 'this exam'}*?`, Markup.inlineKeyboard([
      [btn('✅ Yes', `s:${key}:exams:del:${examId}:yes`), btn('❌ Cancel', `s:${key}:exams`)],
    ]));
  }

  if (sub === 'edit') {
    if (examIdx === -1) return ctx.reply('Exam not found.');
    setSession(chatId, 'EXAM_EDIT_MARK', { studentName: key, examId });
    return ctx.reply(
      `Enter new mark for *${exams[examIdx].name}*:\n_(e.g. 85/100)_\n\n/cancel to cancel`, md);
  }
}

// ── Output helpers ────────────────────────────────────────────────────────────

async function outputStatus(ctxOrMsg, studentName, chatId) {
  const id = chatId || ctxOrMsg.from;
  const r  = storage.getStudent(id, studentName);
  if (!r) return doReply(ctxOrMsg, `Student "${studentName}" not found.`);
  const { key, student } = r;
  const entries = Object.entries(student.status);
  if (entries.length === 0) return doReply(ctxOrMsg, `*${key}*'s status is empty. Use Add Topic to get started.`);
  const good = entries.filter(([,v]) => v === 3);
  const mid  = entries.filter(([,v]) => v === 2);
  const weak = entries.filter(([,v]) => v === 1);
  const year = student.year ? ` · ${student.year}` : '';
  let out = `📊 *Status: ${key}*${year}`;
  if (good.length) out += `\n\n✅ *Strong (3/3)*\n${good.map(([t]) => `• ${t}`).join('\n')}`;
  if (mid.length)  out += `\n\n🔄 *Progressing (2/3)*\n${mid.map(([t]) => `• ${t}`).join('\n')}`;
  if (weak.length) out += `\n\n⚠️ *Needs Work (1/3)*\n${weak.map(([t]) => `• ${t}`).join('\n')}`;
  return doReply(ctxOrMsg, out);
}

async function outputHomework(ctxOrMsg, studentName, chatId) {
  const id = chatId || ctxOrMsg.from;
  const r  = storage.getStudent(id, studentName);
  if (!r) return doReply(ctxOrMsg, `Student "${studentName}" not found.`);
  const { key, student } = r;
  const topics = Object.entries(student.status).filter(([,v]) => v === 2).map(([t]) => t);
  let out = `📚 *Homework Topics: ${key}*\n_rating 2/3_\n\n`;
  out += topics.length ? topics.map(t => `• ${t}`).join('\n') : '_None at level 2 yet._';
  if (student.homework) out += `\n\n*Current homework:*\n${student.homework}`;
  return doReply(ctxOrMsg, out);
}

async function outputLesson(ctxOrMsg, studentName, chatId) {
  const id = chatId || ctxOrMsg.from;
  const r  = storage.getStudent(id, studentName);
  if (!r) return doReply(ctxOrMsg, `Student "${studentName}" not found.`);
  const { key, student } = r;
  const topics = Object.entries(student.status).filter(([,v]) => v === 1).map(([t]) => t);
  let out = `📋 *Lesson Topics: ${key}*\n_rating 1/3_\n\n`;
  out += topics.length ? topics.map(t => `• ${t}`).join('\n') : '_None at level 1 yet._';
  if (student.lesson) out += `\n\n*Current lesson plan:*\n${student.lesson}`;
  return doReply(ctxOrMsg, out);
}

async function sendActiveReminders(ctx) {
  const chatId  = cid(ctx);
  const students = storage.getStudents(chatId);
  const lines = [];
  for (const [name, student] of Object.entries(students)) {
    const hw = student.homeworkReminder?.active;
    const ls = student.lessonReminder?.active;
    if (!hw && !ls) continue;
    const next = student.nextLesson ? new Date(student.nextLesson).toDateString() : 'not set';
    let entry = `*${name}*${student.year ? ` · ${student.year}` : ''}`;
    if (hw) entry += `\n  📚 Homework reminder active`;
    if (ls) entry += `\n  📋 Lesson plan reminder · next ${next}`;
    lines.push(entry);
  }
  const text = lines.length ? `*🔔 Active Reminders*\n\n${lines.join('\n\n')}` : '🔕 No active reminders.';
  await reply(ctx, text, Markup.inlineKeyboard([[btn('⬅️ Back', 'menu')]]));
}

async function sendHelp(ctx) {
  await reply(ctx,
    `*📖 All Commands*\n\n` +

    `*📊 Topic tracking:*\n` +
    `\`input status add [topic] [1-3] [name]\`\n` +
    `\`input status [topic] [1-3] [name]\` — update rating\n` +
    `\`input status remove [topic] [name]\` — removes with confirm\n` +
    `\`output status [name]\`\n` +
    `\`output homework [name]\` — topics rated 2\n` +
    `\`output lesson [name]\` — topics rated 1\n\n` +

    `*📝 Content:*\n` +
    `\`input homework [name] [content]\`\n` +
    `\`input lesson [name] [content]\`\n\n` +

    `*🔔 Reminders:*\n` +
    `\`reminders on\` / \`reminders off\` — global toggle\n` +
    `\`reminder [name] homework/lesson/both\` — reactivate\n` +
    `\`homework [name] done\` — stop homework reminder\n` +
    `\`lesson [name] done\` — stop lesson plan reminder\n\n` +

    `*📅 Lesson date:*\n` +
    `\`lesson [name] date [date]\` — e.g. 12 May\n\n` +

    `*👤 Students:*\n` +
    `\`student add [name]\`\n` +
    `\`student rename [old] [new]\`\n` +
    `\`student delete [name]\`\n` +
    `\`student year [name] [year]\`\n\n` +

    `*👑 Admin only:*\n` +
    `\`/password\` — view current password\n` +
    `\`/newpassword\` — generate new password\n` +
    `\`/testnotify\` — send test to all users\n\n` +

    `*🔘 Menu buttons do:*\n` +
    `Status · Add Topic · Update Rating\n` +
    `Homework/Lesson view · Lesson Date\n` +
    `Snooze (per reminder) · Edit Info\n` +
    `_(Edit: rename, year, schedule, duration, override this week, delete)_\n\n` +

    `_Type /menu anytime to open the menu._`,
    Markup.inlineKeyboard([[btn('⬅️ Back', 'menu')]]));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendAdminPanel(ctx) {
  if (!storage.isAdmin(cid(ctx))) return ctx.reply('⛔ Admin only.');
  const users = storage.getAllUsers();
  const entries = Object.entries(users);
  if (entries.length === 0) return reply(ctx, '*👑 Admin Panel*\n\nNo users.', Markup.inlineKeyboard([[btn('⬅️ Back', 'menu')]]));

  const lines = entries.map(([id, u]) => `• *${u.name || 'Unnamed'}*`).join('\n');
  const rows = entries.map(([id, u]) => [btn(`🗑 Delete ${u.name || id}`, `adel:${id}`)]);
  rows.push([btn('⬅️ Back', 'menu')]);
  await reply(ctx, `*👑 Admin Panel*\n\n*Users:*\n${lines}`, Markup.inlineKeyboard(rows));
}

function doReply(ctxOrMsg, text) {
  return ctxOrMsg.reply(text, md);
}

function wrapMsg(ctx) {
  return {
    body: ctx.message?.text || '',
    from: String(ctx.chat.id),
    fromMe: true,
    type: 'chat',
    reply: (text) => ctx.reply(text, md),
  };
}

function askConfirmRemoveTopic(chatId, studentName, topicKey) {
  setSession(chatId, 'CONFIRM_REMOVE_TOPIC', { studentName, topicKey });
}

module.exports = {
  hasSession, handleCallback, handleTextInput,
  sendMainMenu, sendStudentMenu, outputStatus, outputHomework, outputLesson,
  sendActiveReminders, wrapMsg, askConfirmRemoveTopic,
};
