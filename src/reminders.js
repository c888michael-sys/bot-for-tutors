const cron = require('node-cron');
const storage = require('./save');

let botClient = null;

function init(client) {
  botClient = client;
  cron.schedule('0 10 * * *', checkReminders, { timezone: 'Australia/Sydney' });
}

async function checkReminders() {
  const data = storage.getData();
  if (!data.tutorChatId || !botClient) return;

  const now = Date.now();
  let changed = false;

  for (const [name, student] of Object.entries(data.students)) {
    // Auto-start reminders when the lesson date has passed
    if (student.nextLesson && !student.homeworkReminder.active && !student.lessonReminder.active) {
      const lessonTime = new Date(student.nextLesson).getTime();
      if (now >= lessonTime) {
        // Lesson has passed — start reminders and roll date forward by 7 days
        student.homeworkReminder = { active: true, lastSent: null };
        student.lessonReminder = { active: true, lastSent: null, nextLesson: student.nextLesson };
        const nextWeek = new Date(student.nextLesson);
        nextWeek.setDate(nextWeek.getDate() + 7);
        student.nextLesson = nextWeek.toISOString();
        changed = true;
        await botClient.sendMessage(data.tutorChatId,
          { text: `📅 Lesson with *${name}* has ended.\nReminders started:\n• Homework: every 24 hours\n• Lesson plan: every 48 hours` }
        );
      }
    }

    if (student.homeworkReminder.active) {
      const last = student.homeworkReminder.lastSent
        ? new Date(student.homeworkReminder.lastSent).getTime()
        : 0;
      if (now - last >= 24 * 60 * 60 * 1000) {
        await botClient.sendMessage(data.tutorChatId,
          { text: `📚 *Homework Reminder*\nPlease create homework for *${name}*.\n\nReply: _homework ${name} done_ when ready.` }
        );
        student.homeworkReminder.lastSent = new Date().toISOString();
        changed = true;
      }
    }

    if (student.lessonReminder.active) {
      const last = student.lessonReminder.lastSent
        ? new Date(student.lessonReminder.lastSent).getTime()
        : 0;
      if (now - last >= 48 * 60 * 60 * 1000) {
        const nextLessonDisplay = student.lessonReminder.nextLesson
          ? new Date(student.lessonReminder.nextLesson).toDateString()
          : 'soon';
        await botClient.sendMessage(data.tutorChatId,
          { text: `📋 *Lesson Plan Reminder*\nPlease prepare a lesson plan for *${name}*.\n📅 Next lesson: *${nextLessonDisplay}*\n\nReply: _lesson ${name} done_ when ready.` }
        );
        student.lessonReminder.lastSent = new Date().toISOString();
        changed = true;
      }
    }
  }

  if (changed) storage.saveData(data);
}

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

module.exports = { init, checkReminders, stopHomeworkReminder, stopLessonReminder };
