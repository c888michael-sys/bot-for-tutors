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

async function send(chatId, text) {
  await botClient.sendMessage(chatId, text);
}

// ── Auto-trigger ──────────────────────────────────────────────────────────────

async function checkAutoTrigger() {
  const data = storage.getData();
  if (!data.tutorChatId || !botClient) return;

  const today = sydneyDate(new Date());
  const currentMins = sydneyMinutes();
  let changed = false;

  for (const [name, student] of Object.entries(data.students)) {
    if (!student.nextLesson) continue;
    if (student.homeworkReminder.active || student.lessonReminder.active) continue;

    const lessonDay = sydneyDate(new Date(student.nextLesson));
    let shouldTrigger = false;

    if (lessonDay < today) {
      shouldTrigger = true;
    } else if (lessonDay === today) {
      if (student.lessonTime) {
        const [lh, lm] = student.lessonTime.split(':').map(Number);
        const lessonEndMins = lh * 60 + lm + (student.lessonDuration || 60);
        if (currentMins >= lessonEndMins) shouldTrigger = true;
      } else {
        shouldTrigger = true;
      }
    }

    if (shouldTrigger) {
      student.homeworkReminder = { active: true, lastSent: null };
      student.lessonReminder = { active: true, lastSent: null, nextLesson: student.nextLesson };
      student.nextLesson = nextOccurrence(student.lessonDay) || (() => {
        const d = new Date(student.nextLesson);
        d.setDate(d.getDate() + 7);
        return d.toISOString();
      })();
      student.preReminderSent = false;
      student.postReminderSent = false;
      changed = true;
      await send(data.tutorChatId,
        `📅 Lesson with *${name}* has ended. Reminders started — you'll be reminded at 10am.`
      );
    }
  }

  if (changed) storage.saveData(data);
}

// ── Daily reminders at 10am Sydney ───────────────────────────────────────────

async function sendDailyReminders() {
  const data = storage.getData();
  if (!data.tutorChatId || !botClient) return;

  const now = Date.now();
  let changed = false;

  for (const [name, student] of Object.entries(data.students)) {
    if (student.homeworkReminder.active) {
      const last = student.homeworkReminder.lastSent ? new Date(student.homeworkReminder.lastSent).getTime() : 0;
      if (now - last >= 24 * 60 * 60 * 1000) {
        await send(data.tutorChatId,
          `📚 *Homework Reminder*\nPlease create homework for *${name}*.\n\nReply: _homework ${name} done_ when ready.`
        );
        student.homeworkReminder.lastSent = new Date().toISOString();
        changed = true;
      }
    }

    if (student.lessonReminder.active) {
      const last = student.lessonReminder.lastSent ? new Date(student.lessonReminder.lastSent).getTime() : 0;
      if (now - last >= 48 * 60 * 60 * 1000) {
        const nextLessonDisplay = student.lessonReminder.nextLesson
          ? new Date(student.lessonReminder.nextLesson).toDateString() : 'soon';
        await send(data.tutorChatId,
          `📋 *Lesson Plan Reminder*\nPlease prepare a lesson plan for *${name}*.\n📅 Next lesson: *${nextLessonDisplay}*\n\nReply: _lesson ${name} done_ when ready.`
        );
        student.lessonReminder.lastSent = new Date().toISOString();
        changed = true;
      }
    }
  }

  if (changed) storage.saveData(data);
}

// ── Pre/post lesson timing reminders ─────────────────────────────────────────

async function checkLessonTimingReminders() {
  const data = storage.getData();
  if (!data.tutorChatId || !botClient) return;

  const today = sydneyDate(new Date());
  const currentMins = sydneyMinutes();
  let changed = false;

  for (const [name, student] of Object.entries(data.students)) {
    if (!student.lessonTime || !student.nextLesson) continue;

    const lessonDay = sydneyDate(new Date(student.nextLesson));
    if (today !== lessonDay) continue;

    const [lh, lm] = student.lessonTime.split(':').map(Number);
    const lessonMins = lh * 60 + lm;

    if (!student.preReminderSent && currentMins === lessonMins - 60) {
      await send(data.tutorChatId,
        `⏰ *Upcoming Lesson*\nLesson with *${name}* starts in 1 hour at ${formatTime(student.lessonTime)}.`
      );
      student.preReminderSent = true;
      changed = true;
    }

    const duration = student.lessonDuration || 60;
    if (!student.postReminderSent && currentMins === lessonMins + duration + 10) {
      await send(data.tutorChatId,
        `📝 *Log Lesson*\nLesson with *${name}* has ended.\nPlease update their progress and log the lesson content.`
      );
      student.postReminderSent = true;
      changed = true;
    }
  }

  if (changed) storage.saveData(data);
}

// ── Stop reminders ────────────────────────────────────────────────────────────

function stopHomeworkReminder(studentName) {
  const data = storage.getData();
  const key = storage.findStudentKey(data, studentName);
  if (!key) return false;
  data.students[key].homeworkReminder.active = false;
  storage.saveData(data);
  return key;
}

function stopLessonReminder(studentName) {
  const data = storage.getData();
  const key = storage.findStudentKey(data, studentName);
  if (!key) return false;
  data.students[key].lessonReminder.active = false;
  storage.saveData(data);
  return key;
}

module.exports = { init, checkAutoTrigger, stopHomeworkReminder, stopLessonReminder };
