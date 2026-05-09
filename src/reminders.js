const cron = require('node-cron');
const storage = require('./save');
const { sydneyDate, sydneyMinutes, formatTime } = require('./utils');

let botClient = null;

function init(client) {
  botClient = client;

  // Homework & lesson plan reminders — 10am Sydney daily
  cron.schedule('0 10 * * *', checkHomeworkReminders, { timezone: 'Australia/Sydney' });

  // Pre/post lesson reminders — every minute Sydney time
  cron.schedule('* * * * *', checkLessonTimingReminders, { timezone: 'Australia/Sydney' });

  // ── Temporary test reminder — fires once at 1:20pm Sydney May 9, auto-removes ──
  const testJob = cron.schedule('20 13 9 5 *', async () => {
    const data = storage.getData();
    if (!botClient || !data.tutorChatId) return;
    await botClient.sendMessage(data.tutorChatId, {
      text: '🧪 *Test Reminder* — the reminder system is working correctly!'
    });
    testJob.stop();
    console.log('Test reminder sent and removed.');
  }, { timezone: 'Australia/Sydney' });
}

// ── Homework & lesson plan reminders ─────────────────────────────────────────

async function checkHomeworkReminders() {
  const data = storage.getData();
  if (!data.tutorChatId || !botClient) return;

  const now = Date.now();
  let changed = false;

  for (const [name, student] of Object.entries(data.students)) {
    // Auto-start reminders when lesson date has passed
    if (student.nextLesson && !student.homeworkReminder.active && !student.lessonReminder.active) {
      const lessonTime = new Date(student.nextLesson).getTime();
      if (now >= lessonTime) {
        student.homeworkReminder = { active: true, lastSent: null };
        student.lessonReminder = { active: true, lastSent: null, nextLesson: student.nextLesson };
        const nextWeek = new Date(student.nextLesson);
        nextWeek.setDate(nextWeek.getDate() + 7);
        student.nextLesson = nextWeek.toISOString();
        student.preReminderSent = false;
        student.postReminderSent = false;
        changed = true;
        await botClient.sendMessage(data.tutorChatId, {
          text: `📅 Lesson with *${name}* has ended.\nReminders started:\n• Homework: every 24 hours\n• Lesson plan: every 48 hours`
        });
      }
    }

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

    // 1 hour before lesson
    if (!student.preReminderSent && currentMins === lessonMins - 60) {
      await botClient.sendMessage(data.tutorChatId, {
        text: `⏰ *Upcoming Lesson*\nLesson with *${name}* starts in 1 hour at ${formatTime(student.lessonTime)}.`
      });
      student.preReminderSent = true;
      changed = true;
    }

    // 10 minutes after lesson ends
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

module.exports = { init, checkHomeworkReminders, stopHomeworkReminder, stopLessonReminder };
