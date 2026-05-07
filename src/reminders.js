const cron = require('node-cron');
const storage = require('./save');

let botClient = null;

function init(client) {
  botClient = client;
  cron.schedule('*/30 * * * *', checkReminders);
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
        // Lesson has passed — start reminders and clear the date so it doesn't re-trigger
        student.homeworkReminder = { active: true, lastSent: null };
        student.lessonReminder = { active: true, lastSent: null, nextLesson: student.nextLesson };
        student.nextLesson = null;
        changed = true;
        await botClient.sendMessage(data.tutorChatId,
          `📅 Lesson with *${name}* has ended.\nReminders started:\n• Homework: every 24 hours\n• Lesson plan: every 48 hours`
        );
      }
    }

    if (student.homeworkReminder.active) {
      const last = student.homeworkReminder.lastSent
        ? new Date(student.homeworkReminder.lastSent).getTime()
        : 0;
      if (now - last >= 24 * 60 * 60 * 1000) {
        await botClient.sendMessage(data.tutorChatId,
          `📚 *Homework Reminder*\nPlease create homework for *${name}*.\n\nReply: _homework ${name} done_ when ready.`
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
          `📋 *Lesson Plan Reminder*\nPlease prepare a lesson plan for *${name}*.\n📅 Next lesson: *${nextLessonDisplay}*\n\nReply: _lesson ${name} done_ when ready.`
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
