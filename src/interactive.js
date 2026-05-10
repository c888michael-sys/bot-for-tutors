const storage = require('./save');
const { parseDate, parseTime, formatTime } = require('./utils');

const sessions = new Map();
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

function hasSession(chatId) {
  const s = sessions.get(chatId);
  if (!s) return false;
  if (Date.now() - s.lastActive > SESSION_TIMEOUT) {
    sessions.delete(chatId);
    return false;
  }
  return true;
}
function setSession(chatId, state, data = {}) {
  sessions.set(chatId, { state, data, lastActive: Date.now() });
}
function clearSession(chatId) { sessions.delete(chatId); }

// ─── Menus ───────────────────────────────────────────────────────────────────

async function sendMainMenu(msg, client) {
  const chatId = msg.from;
  setSession(chatId, 'MAIN_MENU');
  return msg.reply(
    `*🎓 Tutor Bot*\n\n` +
    `1 — View / Manage a Student\n` +
    `2 — Active Reminders\n` +
    `3 — Setup (Add Student)\n` +
    `4 — Help & Commands`
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
  return msg.reply(`*👤 Select a Student*\n\n${list}\n\n0 — Back`);
}

async function sendStudentMenu(msg, studentName) {
  const chatId = msg.from;
  const r = storage.getStudent(studentName);
  const lessonDate = r?.student?.nextLesson ? new Date(r.student.nextLesson).toDateString() : 'not set';
  const lessonTime = r?.student?.lessonTime ? formatTime(r.student.lessonTime) : 'not set';
  const year = r?.student?.year || 'not set';
  setSession(chatId, 'STUDENT_MENU', { studentName });
  return msg.reply(
    `*${studentName}* · ${year}\n📅 Next Lesson: ${lessonDate} at ${lessonTime}\n\n` +
    `1 — View Status\n` +
    `2 — View Homework Topics\n` +
    `3 — View Lesson Topics\n` +
    `4 — Add Topic\n` +
    `5 — Update Topic Rating\n` +
    `6 — Set Next Lesson Date\n` +
    `7 — Snooze Reminders\n` +
    `8 — Edit Student Info\n` +
    `\n0 — Back`
  );
}

async function sendEditMenu(msg, studentName) {
  const chatId = msg.from;
  const r = storage.getStudent(studentName);
  const year = r?.student?.year || 'not set';
  setSession(chatId, 'EDIT_MENU', { studentName });
  const lessonTime = r?.student?.lessonTime ? formatTime(r.student.lessonTime) : 'not set';
  const lessonDay = r?.student?.lessonDay || 'not set';
  const duration = r?.student?.lessonDuration || 60;
  return msg.reply(
    `*✏️ Edit: ${studentName}* · ${year}\n📅 ${lessonDay} · ${lessonTime} · ${duration} min\n\n` +
    `1 — Rename Student\n` +
    `2 — Change Year\n` +
    `3 — Change Recurring Lesson Time\n` +
    `4 — Change Lesson Duration\n` +
    `5 — Override This Week's Date / Time\n` +
    `6 — Delete Student\n` +
    `\n0 — Back`
  );
}

// ─── Response router ──────────────────────────────────────────────────────────

async function handleResponse(msg, client) {
  const chatId = msg.from;
  const session = sessions.get(chatId);
  if (!session) return;

  // Refresh timeout on every interaction
  session.lastActive = Date.now();

  const body = msg.body.trim();
  const lower = body.toLowerCase();
  const { state, data: sd } = session;

  // "menu" typed anywhere → restart main menu
  if (lower === 'menu') { clearSession(chatId); return sendMainMenu(msg, client); }

  if (state === 'MAIN_MENU') {
    if (body === '1') { clearSession(chatId); return sendStudentList(msg, 'SELECT_STUDENT'); }
    if (body === '2') { clearSession(chatId); return sendActiveReminders(msg); }
    if (body === '3') { clearSession(chatId); setSession(chatId, 'SETUP_NAME'); return msg.reply(`*➕ Add Student*\n\nEnter student name:\n\n_0 — Cancel_`); }
    if (body === '4') { clearSession(chatId); return sendHelp(msg); }
    return;
  }

  if (state === 'AWAITING_NEW_STUDENT') {
    // ignore short/empty or bot-generated text
    if (!body || body.length > 50) return;
    clearSession(chatId);
    const ok = storage.addStudent(body);
    return msg.reply(ok ? `✅ Student *${body}* added.` : `"${body}" already exists.`);
  }

  if (state === 'SELECT_STUDENT') {
    if (body === '0') { clearSession(chatId); return sendMainMenu(msg, client); }
    const { names } = sd;
    const idx = parseInt(body) - 1;
    if (isNaN(idx) || idx < 0 || idx >= names.length) return; // ignore invalid
    clearSession(chatId);
    return sendStudentMenu(msg, names[idx]);
  }

  if (state === 'STUDENT_MENU') {
    const { studentName } = sd;
    if (body === '1') { clearSession(chatId); return outputStatus(msg, studentName); }
    if (body === '2') { clearSession(chatId); return outputHomework(msg, studentName); }
    if (body === '3') { clearSession(chatId); return outputLesson(msg, studentName); }
    if (body === '4') { clearSession(chatId); setSession(chatId, 'ADD_TOPIC_NAME', { studentName }); return msg.reply(`Enter topic name for *${studentName}*:\n\n0 — Back`); }
    if (body === '5') {
      clearSession(chatId);
      const r = storage.getStudent(studentName);
      if (!r) return msg.reply('Student not found.');
      const topics = Object.entries(r.student.status);
      if (topics.length === 0) return msg.reply(`*${studentName}* has no topics yet. Use option 4 to add one.`);
      const list = topics.map(([t, v], i) => `${i + 1} — ${t} (${v}/3)`).join('\n');
      setSession(chatId, 'UPDATE_TOPIC_SELECT', { studentName, topics });
      return msg.reply(`*Update Topic: ${studentName}*\n\n${list}\n\n0 — Back`);
    }
    if (body === '6') { clearSession(chatId); setSession(chatId, 'SET_LESSON_DATE', { studentName }); return msg.reply(`Enter the next lesson date for *${studentName}*:\n_(e.g. 12 May, May 12, 2026-05-12)_`); }
    if (body === '7') {
      clearSession(chatId);
      const data = storage.getData();
      const key = storage.findStudentKey(data, studentName);
      if (!key) return msg.reply('Student not found.');
      data.students[key].homeworkReminder.active = false;
      data.students[key].lessonReminder.active = false;
      storage.saveData(data);
      return msg.reply(`⏸ Reminders snoozed for *${key}*.\nThey'll restart automatically after the next lesson.`);
    }
    if (body === '8') { clearSession(chatId); return sendEditMenu(msg, studentName); }
    if (body === '0') { clearSession(chatId); return sendStudentList(msg, 'SELECT_STUDENT'); }
    return;
  }

  if (state === 'EDIT_MENU') {
    const { studentName } = sd;
    if (body === '0') { clearSession(chatId); return sendStudentMenu(msg, studentName); }
    if (body === '1') { clearSession(chatId); setSession(chatId, 'RENAME_STUDENT', { studentName }); return msg.reply(`Enter new name for *${studentName}*:`); }
    if (body === '2') { clearSession(chatId); setSession(chatId, 'SET_YEAR', { studentName }); return msg.reply(`Enter year for *${studentName}* (e.g. Y7, Y11):`); }
    if (body === '3') { clearSession(chatId); setSession(chatId, 'SET_RECURRING_DAY', { studentName }); return msg.reply(`Enter lesson day for *${studentName}*:\n_(e.g. Monday, Sunday)_\n\n0 — Back`); }
    if (body === '4') { clearSession(chatId); setSession(chatId, 'SET_DURATION', { studentName }); return msg.reply(`Enter lesson duration for *${studentName}* in minutes:\n_(e.g. 60, 90, 120)_\n\n0 — Back`); }
    if (body === '5') {
      clearSession(chatId);
      const r = storage.getStudent(studentName);
      const currentDate = r?.student?.nextLesson ? new Date(r.student.nextLesson).toDateString() : 'not set';
      const currentTime = r?.student?.lessonTime ? formatTime(r.student.lessonTime) : 'not set';
      setSession(chatId, 'OVERRIDE_DATE', { studentName });
      return msg.reply(`Override this week's lesson for *${studentName}*.\nCurrent: ${currentDate} at ${currentTime}\n\nEnter new date (or *skip* to keep current):\n\n0 — Cancel`);
    }
    if (body === '6') { clearSession(chatId); setSession(chatId, 'CONFIRM_DELETE', { studentName }); return msg.reply(`Are you sure you want to delete *${studentName}*?\n\nType *yes* to confirm or *0* to cancel.`); }
    return;
  }

  if (state === 'SET_DURATION') {
    if (body === '0') { clearSession(chatId); return sendEditMenu(msg, sd.studentName); }
    const duration = parseInt(body);
    if (isNaN(duration) || duration < 1 || duration > 480) return msg.reply(`Please enter a number of minutes (e.g. 60, 90, 120).`);
    clearSession(chatId);
    const r = storage.getStudent(sd.studentName);
    if (!r) return msg.reply('Student not found.');
    r.student.lessonDuration = duration;
    storage.saveStudent(r.key, r.student);
    return msg.reply(`✅ Lesson duration set to *${duration} min* for *${r.key}*.`);
  }

  if (state === 'SET_RECURRING_DAY') {
    if (body === '0') { clearSession(chatId); return sendEditMenu(msg, sd.studentName); }
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const day = body.trim().toLowerCase();
    if (!days.includes(day)) return msg.reply(`Please enter a valid day (e.g. *Monday*, *Sunday*):`);
    const formatted = body.trim().charAt(0).toUpperCase() + body.trim().slice(1).toLowerCase();
    setSession(chatId, 'SET_RECURRING_TIME', { ...sd, lessonDay: formatted });
    return msg.reply(`Enter lesson time for *${sd.studentName}*:\n_(e.g. 3pm, 15:00)_\n\n0 — Back`);
  }

  if (state === 'SET_RECURRING_TIME') {
    if (body === '0') { clearSession(chatId); return sendEditMenu(msg, sd.studentName); }
    const time = parseTime(body);
    if (!time) return msg.reply(`Couldn't parse that time. Try: *3pm*, *15:00*`);
    clearSession(chatId);
    const r = storage.getStudent(sd.studentName);
    if (!r) return msg.reply('Student not found.');
    r.student.lessonDay = sd.lessonDay;
    r.student.lessonTime = time;
    storage.saveStudent(r.key, r.student);
    return msg.reply(`✅ Recurring lesson set to *${sd.lessonDay}s* at *${formatTime(time)}* for *${r.key}*.`);
  }

  if (state === 'OVERRIDE_DATE') {
    if (body === '0') { clearSession(chatId); return sendEditMenu(msg, sd.studentName); }
    let nextLesson = null;
    if (body.toLowerCase() !== 'skip') {
      const parsed = parseDate(body);
      if (!parsed) return msg.reply(`Couldn't parse that date. Try: *12 May* or type *skip*.`);
      nextLesson = parsed.toISOString();
    }
    setSession(chatId, 'OVERRIDE_TIME', { ...sd, nextLesson });
    const r = storage.getStudent(sd.studentName);
    const currentTime = r?.student?.lessonTime ? formatTime(r.student.lessonTime) : 'not set';
    return msg.reply(`Enter new time (or *skip* to keep current time: ${currentTime}):\n\n0 — Cancel`);
  }

  if (state === 'OVERRIDE_TIME') {
    if (body === '0') { clearSession(chatId); return sendEditMenu(msg, sd.studentName); }
    clearSession(chatId);
    const r = storage.getStudent(sd.studentName);
    if (!r) return msg.reply('Student not found.');
    if (sd.nextLesson) r.student.nextLesson = sd.nextLesson;
    if (body.toLowerCase() !== 'skip') {
      const time = parseTime(body);
      if (!time) return msg.reply(`Couldn't parse that time. Try: *3pm*, *15:00*`);
      r.student.lessonTime = time;
    }
    storage.saveStudent(r.key, r.student);
    const dateStr = r.student.nextLesson ? new Date(r.student.nextLesson).toDateString() : 'unchanged';
    const timeStr = r.student.lessonTime ? formatTime(r.student.lessonTime) : 'unchanged';
    return msg.reply(`✅ This week's lesson for *${r.key}* updated:\n📅 ${dateStr} at ${timeStr}\n\n_Recurring schedule unchanged._`);
  }

  if (state === 'RENAME_STUDENT') {
    if (body === '0') { clearSession(chatId); return sendEditMenu(msg, sd.studentName); }
    if (!body || body.length > 50) return;
    clearSession(chatId);
    const result = storage.renameStudent(sd.studentName, body);
    if (result === 'exists') return msg.reply(`"${body}" already exists.`);
    if (result === 'not_found') return msg.reply(`Student not found.`);
    return msg.reply(`✅ Renamed to *${body}*.`);
  }

  if (state === 'SET_YEAR') {
    if (body === '0') { clearSession(chatId); return sendEditMenu(msg, sd.studentName); }
    if (!body || body.length > 10) return;
    clearSession(chatId);
    const r = storage.getStudent(sd.studentName);
    if (!r) return msg.reply('Student not found.');
    r.student.year = body;
    storage.saveStudent(r.key, r.student);
    return msg.reply(`✅ Year set to *${body}* for *${r.key}*.`);
  }

  if (state === 'CONFIRM_DELETE') {
    if (body.toLowerCase() === 'yes') {
      clearSession(chatId);
      const ok = storage.deleteStudent(sd.studentName);
      return msg.reply(ok ? `✅ *${sd.studentName}* deleted.` : 'Student not found.');
    }
    if (body === '0') { clearSession(chatId); return sendEditMenu(msg, sd.studentName); }
    return;
  }

  if (state === 'SET_LESSON_DATE') {
    if (body === '0') { clearSession(chatId); return sendStudentMenu(msg, sd.studentName); }
    const parsed = parseDate(body);
    if (!parsed) return; // ignore unparseable (e.g. bot replies)
    clearSession(chatId);
    const r = storage.getStudent(sd.studentName);
    if (!r) return msg.reply('Student not found.');
    r.student.nextLesson = parsed.toISOString();
    storage.saveStudent(r.key, r.student);
    return msg.reply(`✅ Next lesson for *${r.key}* set to: ${parsed.toDateString()}`);
  }

  if (state === 'ADD_TOPIC_NAME') {
    if (body === '0') { clearSession(chatId); return sendStudentMenu(msg, sd.studentName); }
    if (!body || body.length > 100) return;
    setSession(chatId, 'ADD_TOPIC_RATING', { ...sd, topic: body });
    return msg.reply(`Rating for *${body}*:\n\n1 — Poor / Not learnt\n2 — Getting there\n3 — Good\n\n0 — Back`);
  }

  if (state === 'ADD_TOPIC_RATING') {
    if (body === '0') { clearSession(chatId); return sendStudentMenu(msg, sd.studentName); }
    const rating = parseInt(body);
    if (isNaN(rating) || rating < 1 || rating > 3) return;
    clearSession(chatId);
    const r = storage.getStudent(sd.studentName);
    if (!r) return msg.reply('Student not found.');
    const label = rating === 1 ? 'Poor/Not learnt' : rating === 2 ? 'Getting there' : 'Good';
    r.student.status[sd.topic] = rating;
    storage.saveStudent(r.key, r.student);
    return msg.reply(`✅ Added *${sd.topic}* (${rating}/3 — ${label}) for *${r.key}*.`);
  }

  if (state === 'UPDATE_TOPIC_SELECT') {
    if (body === '0') { clearSession(chatId); return sendStudentMenu(msg, sd.studentName); }
    const idx = parseInt(body) - 1;
    if (isNaN(idx) || idx < 0 || idx >= sd.topics.length) return;
    const [topicName, currentRating] = sd.topics[idx];
    setSession(chatId, 'UPDATE_TOPIC_RATING', { ...sd, topicName });
    return msg.reply(`*${topicName}* — currently ${currentRating}/3\n\nNew rating:\n1 — Poor / Not learnt\n2 — Getting there\n3 — Good\n\n0 — Back`);
  }

  if (state === 'UPDATE_TOPIC_RATING') {
    if (body === '0') { clearSession(chatId); return sendStudentMenu(msg, sd.studentName); }
    const rating = parseInt(body);
    if (isNaN(rating) || rating < 1 || rating > 3) return;
    clearSession(chatId);
    const r = storage.getStudent(sd.studentName);
    if (!r) return msg.reply('Student not found.');
    const label = rating === 1 ? 'Poor/Not learnt' : rating === 2 ? 'Getting there' : 'Good';
    r.student.status[sd.topicName] = rating;
    storage.saveStudent(r.key, r.student);
    return msg.reply(`✅ Updated *${sd.topicName}* to ${rating}/3 (${label}) for *${r.key}*.`);
  }

  if (state === 'CONFIRM_REMOVE_TOPIC') {
    if (lower === 'yes') {
      clearSession(chatId);
      const r = storage.getStudent(sd.studentName);
      if (!r) return msg.reply('Student not found.');
      delete r.student.status[sd.topicKey];
      storage.saveStudent(r.key, r.student);
      return msg.reply(`✅ Removed *${sd.topicKey}* from *${r.key}*.`);
    }
    clearSession(chatId);
    return msg.reply('Cancelled.');
  }

  // ── Setup wizard ─────────────────────────────────────────────────────────

  if (state === 'SETUP_NAME') {
    if (body === '0') { clearSession(chatId); return sendMainMenu(msg, client); }
    if (!body || body.length > 50) return;
    if (storage.getStudent(body)) { return msg.reply(`"${body}" already exists. Enter a different name:`); }
    setSession(chatId, 'SETUP_YEAR', { name: body });
    return msg.reply(`Year for *${body}*? (e.g. Y7, Y11)\n_Type n/a to skip — 0 to cancel_`);
  }

  if (state === 'SETUP_YEAR') {
    if (body === '0') { clearSession(chatId); return sendMainMenu(msg, client); }
    if (!body || body.length > 20) return;
    const year = body.toLowerCase() === 'n/a' ? null : body;
    setSession(chatId, 'SETUP_DAY', { ...sd, year });
    return msg.reply(`What day do lessons occur for *${sd.name}*? (e.g. Monday, Sunday)\n_Type n/a to skip — 0 to cancel_`);
  }

  if (state === 'SETUP_DAY') {
    if (body === '0') { clearSession(chatId); return sendMainMenu(msg, client); }
    if (!body) return;
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const isNA = body.toLowerCase() === 'n/a';
    if (!isNA && !days.includes(body.trim().toLowerCase())) return msg.reply(`Please enter a valid day (e.g. *Monday*) or *n/a* to skip.`);
    const lessonDay = isNA ? null : body.trim().charAt(0).toUpperCase() + body.trim().slice(1).toLowerCase();
    setSession(chatId, 'SETUP_DATE', { ...sd, lessonDay });
    return msg.reply(`Next lesson date for *${sd.name}*? (e.g. 12 May)\n_Type n/a to skip — 0 to cancel_`);
  }

  if (state === 'SETUP_DATE') {
    if (body === '0') { clearSession(chatId); return sendMainMenu(msg, client); }
    if (!body) return;
    const isNA = body.toLowerCase() === 'n/a';
    let nextLesson = null;
    if (!isNA) {
      const parsed = parseDate(body);
      if (!parsed) return msg.reply(`Couldn't parse that date. Try: *12 May* or type *n/a* to skip.`);
      nextLesson = parsed.toISOString();
    }
    setSession(chatId, 'SETUP_TIME', { ...sd, nextLesson });
    return msg.reply(`What time do lessons start for *${sd.name}*? (e.g. 3pm, 15:00)\n_Type n/a to skip — 0 to cancel_`);
  }

  if (state === 'SETUP_TIME') {
    if (body === '0') { clearSession(chatId); return sendMainMenu(msg, client); }
    if (!body) return;
    const isNA = body.toLowerCase() === 'n/a';
    const lessonTime = isNA ? null : parseTime(body);
    if (!isNA && !lessonTime) return msg.reply(`Couldn't parse that time. Try: *3pm*, *15:00* or *n/a* to skip.`);
    setSession(chatId, 'SETUP_DURATION', { ...sd, lessonTime });
    return msg.reply(`How long is the lesson for *${sd.name}*? (minutes, e.g. 60, 90, 120)\n_Type n/a for default (60 min) — 0 to cancel_`);
  }

  if (state === 'SETUP_DURATION') {
    if (body === '0') { clearSession(chatId); return sendMainMenu(msg, client); }
    if (!body) return;
    const isNA = body.toLowerCase() === 'n/a';
    const duration = isNA ? 60 : parseInt(body);
    if (!isNA && (isNaN(duration) || duration < 1 || duration > 480))
      return msg.reply(`Please enter a number of minutes (e.g. 60, 90, 120) or *n/a* for default.`);
    clearSession(chatId);
    storage.addStudent(sd.name);
    const r = storage.getStudent(sd.name);
    if (sd.year) r.student.year = sd.year;
    if (sd.lessonDay) r.student.lessonDay = sd.lessonDay;
    if (sd.nextLesson) r.student.nextLesson = sd.nextLesson;
    if (sd.lessonTime) r.student.lessonTime = sd.lessonTime;
    r.student.lessonDuration = duration;
    storage.saveStudent(r.key, r.student);
    return msg.reply(
      `✅ *${r.key}* added!\n` +
      `Year: ${sd.year || 'not set'}\n` +
      `Lesson day: ${sd.lessonDay || 'not set'}\n` +
      `Next lesson: ${sd.nextLesson ? new Date(sd.nextLesson).toDateString() : 'not set'}` +
      `${sd.lessonTime ? ` at ${formatTime(sd.lessonTime)}` : ''}\n` +
      `Duration: ${duration} min\n\n` +
      `_Add topics and content from the student menu._`
    );
  }

}

// ─── Active reminders view ───────────────────────────────────────────────────

async function sendActiveReminders(msg) {
  const data = storage.getData();
  const lines = [];

  for (const [name, student] of Object.entries(data.students)) {
    const hw = student.homeworkReminder?.active;
    const ls = student.lessonReminder?.active;
    if (!hw && !ls) continue;

    const nextLesson = student.nextLesson
      ? new Date(student.nextLesson).toDateString()
      : 'not set';

    let entry = `*${name}* · ${student.year || '?'}\n`;
    if (hw) entry += `  📚 Homework reminder active\n`;
    if (ls) entry += `  📋 Lesson plan reminder active · next lesson ${nextLesson}\n`;
    lines.push(entry.trim());
  }

  if (lines.length === 0) return msg.reply('🔕 No active reminders.');
  return msg.reply(`*🔔 Active Reminders*\n\n${lines.join('\n\n')}`);
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

  const year = student.year ? ` · ${student.year}` : '';
  let out = `📊 *Status: ${key}*${year}`;
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
    `*📖 Commands*\n\n` +
    `*Topics (via menu or text):*\n` +
    `input status add [topic] [1-3] [name]\n` +
    `input status [topic] [1-3] [name] _(update)_\n` +
    `input status remove [topic] [name]\n` +
    `output status [name]\n` +
    `output homework [name] _(topics rated 2)_\n` +
    `output lesson [name] _(topics rated 1)_\n\n` +
    `*Reminders:*\n` +
    `homework [name] done _(stop homework reminder)_\n` +
    `lesson [name] done _(stop lesson plan reminder)_\n\n` +
    `*Lesson date:*\n` +
    `lesson [name] date [date] _(e.g. 12 May)_\n\n` +
    `*Students:*\n` +
    `student add [name]\n` +
    `student rename [old] [new]\n` +
    `student delete [name]\n` +
    `student year [name] [year]\n\n` +
    `_Most things are easier via the menu — type *menu* anytime._`
  );
}

function askConfirmRemoveTopic(chatId, studentName, topicKey) {
  setSession(chatId, 'CONFIRM_REMOVE_TOPIC', { studentName, topicKey });
}

module.exports = { hasSession, handleResponse, sendMainMenu, outputStatus, outputHomework, outputLesson, askConfirmRemoveTopic };
