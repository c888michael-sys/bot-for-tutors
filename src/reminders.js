const cron = require('node-cron');
const storage = require('./save');
const { sydneyDate, sydneyMinutes, formatTime, nextOccurrence } = require('./utils');

let botClient = null;

function init(client) {
  botClient = client;

  // Auto-trigger: check every 30 min if any lesson has passed
  cron.schedule('*/30 * * * *', checkAutoTrigger);

  // Homework & lesson plan reminder messages — 10am Sydney daily
  cron.schedule('0 10 * * *', sendDailyReminders, { timezone: 'Australia/Sydney' });

  // Pre/post lesson timing reminders — every minute
  cron.schedule('* * * * *', checkLessonTimingReminders, { timezone: 'Australia/Sydney' });

  // Run auto-trigger on startup in case lessons passed while bot was down
  setTimeout(checkAutoTrigger, 3000);
}

// ── Auto-trigger: start reminders when lesson date passes ─────────────────────

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
      // Lesson day fully passed
      shouldTrigger = true;
    } else if (lessonDay === today) {
      if (student.lessonTime) {
        // Trigger only after lesson has ended
        const [lh, lm] = student.lessonTime.split(':').map(Number);
        const lessonEndMins = lh * 60 + lm + (student.lessonDuration || 60);
        if (currentMins >= lessonEndMins) shouldTrigger = true;
      } else {
        shouldTrigger = true; // no time set, trigger on the day
      }
    }

    if (shouldTrigger) {
      student.homeworkReminder = { active: true, lastSent: null };
      student.lessonReminder = { active: true, lastSent: null, nextLesson: student.nextLesson };
      // Roll to next occurrence of recurring day, or +7 days if no day set
      student.nextLesson = nextOccurrence(student.lessonDay) || (() => {
        const d = new Date(student.nextLesson);
        d.setDate(d.getDate() + 7);
        return d.toISOString();
      })();
      student.preReminderSent = false;
      student.postReminderSent = false;
      changed = true;
      await botClient.sendMessage(data.tutorChatId, {
        text: `📅 Lesson with *${name}* has ended. Reminders started — you'll be reminded at 10am.`
      });
    }
  }

  if (changed) storage.saveData(data);
}

// ── Daily reminder messages at 10am Sydney ────────────────────────────────────

async function sendDailyReminders() {
  const data = storage.getData();
  if (!data.tutorChatId || !botClient) return;

  const now = Date.now();
  let changed = false;

  for (const [name, student] of Object.entries(data.students)) {
    if (student.homeworkReminder.active) {
      const last = student.homeworkReminder.lastSent ? new Date(student.homeworkReminder.lastSent).getTime() : 0;
      if (now - last >= 24 * 60 * 60 * 1000) {
        await botClient.sendMessage(data.tutorChatId, {
          text: `📚 *Homework Reminder*\nPlease create homework for *${name}*.\n\nReply: _homework ${name} done_ when ready.`
        });
        student.homeworkReminder.lastSent = new Date().toISOString();
        changed = true;
      }
    }

    if (student.lessonReminder.active) {
      const last = student.lessonReminder.lastSent ? new Date(student.lessonReminder.lastSent).getTime() : 0;
      if (now - last >= 48 * 60 * 60 * 1000) {
        const nextLessonDisplay = student.lessonReminder.nextLesson
          ? new Date(student.lessonReminder.nextLesson).toDateString() : 'soon';
        await botClient.sendMessage(data.tutorChatId, {
          text: `📋 *Lesson Plan Reminder*\nPlease prepare a lesson plan for *${name}*.\n📅 Next lesson: *${nextLessonDisplay}*\n\nReply: _lesson ${name} done_ when ready.`
        });
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
      await botClient.sendMessage(data.tutorChatId, {
        text: `⏰ *Upcoming Lesson*\nLesson with *${name}* starts in 1 hour at ${formatTime(student.lessonTime)}.`
      });
      student.preReminderSent = true;
      changed = true;
    }

    const duration = student.lessonDuration || 60;
    if (!student.postReminderSent && currentMins === lessonMins + duration + 10) {
      await botClient.sendMessage(data.tutorChatId, {
        text: `📝 *Log Lesson*\nLesson with *${name}* has ended.\nPlease update their progress and log the lesson content.`
      });
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
