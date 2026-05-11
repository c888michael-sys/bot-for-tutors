const cron = require('node-cron');
const storage = require('./save');
const { sydneyDate, sydneyMinutes, formatTime, nextOccurrence } = require('./utils');

let botClient = null;

function init(client) {
  botClient = client;
  cron.schedule('*/30 * * * *', checkAutoTrigger);
  cron.schedule('0 10 * * *', sendDailyReminders, { timezone: 'Australia/Sydney' });
  cron.schedule('* * * * *', checkLessonTimingReminders, { timezone: 'Australia/Sydney' });
  setTimeout(checkAutoTrigger, 3000);
}

async function send(chatId, text, buttons) {
  const opts = { parse_mode: 'Markdown' };
  if (buttons) opts.reply_markup = { inline_keyboard: buttons };
  await botClient.telegram.sendMessage(chatId, text, opts);
}

// ── Auto-trigger ──────────────────────────────────────────────────────────────

async function checkAutoTrigger() {
  if (!botClient) return;
  const data = storage.getData();
  const today = sydneyDate(new Date());
  const currentMins = sydneyMinutes();

  for (const [chatId, userData] of Object.entries(data.users || {})) {
    if (userData.remindersEnabled === false) continue;
    let changed = false;
    for (const [name, student] of Object.entries(userData.students || {})) {
      if (!student.nextLesson) continue;
      if (student.homeworkReminder.active || student.lessonReminder.active) continue;

      const lessonDay = sydneyDate(new Date(student.nextLesson));
      let shouldTrigger = false;
      if (lessonDay < today) {
        shouldTrigger = true;
      } else if (lessonDay === today) {
        if (student.lessonTime) {
          const [lh, lm] = student.lessonTime.split(':').map(Number);
          if (currentMins >= lh * 60 + lm + (student.lessonDuration || 60)) shouldTrigger = true;
        } else {
          shouldTrigger = true;
        }
      }

      if (shouldTrigger) {
        student.homeworkReminder = { active: true, lastSent: null };
        student.lessonReminder   = { active: true, lastSent: null, nextLesson: student.nextLesson };
        student.nextLesson = nextOccurrence(student.lessonDay) || (() => {
          const d = new Date(student.nextLesson); d.setDate(d.getDate() + 7); return d.toISOString();
        })();
        student.preReminderSent  = false;
        student.postReminderSent = false;
        changed = true;
        await send(chatId, `📅 Lesson with *${name}* has ended. Reminders started — you'll be reminded at 10am.`);
      }
    }
    if (changed) storage.saveData(data);
  }
}

// ── Daily reminders ───────────────────────────────────────────────────────────

async function sendDailyReminders() {
  if (!botClient) return;
  const data = storage.getData();
  const now = Date.now();

  for (const [chatId, userData] of Object.entries(data.users || {})) {
    if (userData.remindersEnabled === false) continue;
    let changed = false;
    for (const [name, student] of Object.entries(userData.students || {})) {
      if (student.homeworkReminder.active) {
        const last = student.homeworkReminder.lastSent ? new Date(student.homeworkReminder.lastSent).getTime() : 0;
        if (now - last >= 24 * 60 * 60 * 1000) {
          await send(chatId, `📚 *Homework Reminder*\nPlease create homework for *${name}*.`, [
            [{ text: '✅ Done', callback_data: `rdone:hw:${name}` }, { text: '⏸ Snooze', callback_data: `rsnooze:${name}` }]
          ]);
          student.homeworkReminder.lastSent = new Date().toISOString();
          changed = true;
        }
      }
      if (student.lessonReminder.active) {
        const last = student.lessonReminder.lastSent ? new Date(student.lessonReminder.lastSent).getTime() : 0;
        if (now - last >= 48 * 60 * 60 * 1000) {
          const next = student.lessonReminder.nextLesson ? new Date(student.lessonReminder.nextLesson).toDateString() : 'soon';
          await send(chatId, `📋 *Lesson Plan Reminder*\nPlease prepare a lesson plan for *${name}*.\n📅 Next lesson: *${next}*.`, [
            [{ text: '✅ Done', callback_data: `rdone:lesson:${name}` }, { text: '⏸ Snooze', callback_data: `rsnooze:${name}` }]
          ]);
          student.lessonReminder.lastSent = new Date().toISOString();
          changed = true;
        }
      }
    }
    if (changed) storage.saveData(data);
  }
}

// ── Lesson timing reminders ───────────────────────────────────────────────────

async function checkLessonTimingReminders() {
  if (!botClient) return;
  const data = storage.getData();
  const today = sydneyDate(new Date());
  const currentMins = sydneyMinutes();

  for (const [chatId, userData] of Object.entries(data.users || {})) {
    if (userData.remindersEnabled === false) continue;
    let changed = false;
    for (const [name, student] of Object.entries(userData.students || {})) {
      if (!student.lessonTime || !student.nextLesson) continue;
      if (sydneyDate(new Date(student.nextLesson)) !== today) continue;

      const [lh, lm] = student.lessonTime.split(':').map(Number);
      const lessonMins = lh * 60 + lm;

      if (!student.preReminderSent && currentMins === lessonMins - 60) {
        await send(chatId, `⏰ *Upcoming Lesson*\nLesson with *${name}* starts in 1 hour at ${formatTime(student.lessonTime)}.`);
        student.preReminderSent = true;
        changed = true;
      }
      const duration = student.lessonDuration || 60;
      if (!student.postReminderSent && currentMins === lessonMins + duration + 10) {
        await send(chatId, `📝 *Log Lesson*\nLesson with *${name}* has ended.\nPlease update their progress and log the lesson content.`);
        student.postReminderSent = true;
        changed = true;
      }
    }
    if (changed) storage.saveData(data);
  }
}

// ── Stop reminders ────────────────────────────────────────────────────────────

function stopHomeworkReminder(chatId, studentName) {
  const data = storage.getData();
  const key  = storage.findStudentKey(chatId, studentName);
  if (!key) return false;
  data.users[chatId].students[key].homeworkReminder.active = false;
  storage.saveData(data);
  return key;
}

function stopLessonReminder(chatId, studentName) {
  const data = storage.getData();
  const key  = storage.findStudentKey(chatId, studentName);
  if (!key) return false;
  data.users[chatId].students[key].lessonReminder.active = false;
  storage.saveData(data);
  return key;
}

module.exports = { init, checkAutoTrigger, stopHomeworkReminder, stopLessonReminder };
