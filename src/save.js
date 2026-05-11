const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'storage.json');

const DEFAULT_STUDENT = () => ({
  year: null,
  lessonDay: null,
  lessonTime: null,
  lessonDuration: 60,
  status: {},
  homework: '',
  lesson: '',
  nextLesson: null,
  preReminderSent: false,
  postReminderSent: false,
  homeworkReminder: { active: false, lastSent: null },
  lessonReminder: { active: false, lastSent: null, nextLesson: null }
});

function getData() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    // Auto-migrate old single-user format
    if (raw.students && !raw.users) {
      const migrated = { users: {} };
      if (raw.tutorChatId) {
        migrated.users[raw.tutorChatId] = { registered: true, students: raw.students };
      }
      saveData(migrated);
      return migrated;
    }
    if (!raw.users) raw.users = {};
    return raw;
  } catch {
    return { users: {} };
  }
}

function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── User management ───────────────────────────────────────────────────────────

function isRegistered(chatId) {
  const data = getData();
  return !!data.users?.[chatId]?.registered;
}

function registerUser(chatId) {
  const data = getData();
  if (!data.users[chatId]) data.users[chatId] = { registered: true, students: {} };
  else data.users[chatId].registered = true;
  saveData(data);
}

function getAllUsers() {
  return getData().users || {};
}

// ── Student operations (all scoped to chatId) ─────────────────────────────────

function findStudentKey(chatId, name) {
  const data = getData();
  const students = data.users?.[chatId]?.students || {};
  return Object.keys(students).find(k => k.toLowerCase() === name.toLowerCase()) || null;
}

function getStudent(chatId, name) {
  const data = getData();
  const students = data.users?.[chatId]?.students || {};
  const key = Object.keys(students).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? { key, student: students[key] } : null;
}

function saveStudent(chatId, name, studentData) {
  const data = getData();
  if (!data.users[chatId]) data.users[chatId] = { registered: true, students: {} };
  const key = findStudentKey(chatId, name) || name;
  data.users[chatId].students[key] = studentData;
  saveData(data);
  return key;
}

function addStudent(chatId, name) {
  const data = getData();
  if (!data.users[chatId]) data.users[chatId] = { registered: true, students: {} };
  if (findStudentKey(chatId, name)) return false;
  data.users[chatId].students[name] = DEFAULT_STUDENT();
  saveData(data);
  return true;
}

function renameStudent(chatId, oldName, newName) {
  const data = getData();
  const students = data.users?.[chatId]?.students;
  if (!students) return 'not_found';
  const oldKey = Object.keys(students).find(k => k.toLowerCase() === oldName.toLowerCase());
  if (!oldKey) return 'not_found';
  if (Object.keys(students).find(k => k.toLowerCase() === newName.toLowerCase())) return 'exists';
  students[newName] = students[oldKey];
  delete students[oldKey];
  saveData(data);
  return 'ok';
}

function deleteStudent(chatId, name) {
  const data = getData();
  const students = data.users?.[chatId]?.students;
  if (!students) return false;
  const key = Object.keys(students).find(k => k.toLowerCase() === name.toLowerCase());
  if (!key) return false;
  delete students[key];
  saveData(data);
  return true;
}

function resolveStudentSuffix(chatId, tokens) {
  const data = getData();
  const students = data.users?.[chatId]?.students || {};
  for (let len = Math.min(3, tokens.length); len >= 1; len--) {
    const candidate = tokens.slice(tokens.length - len).join(' ');
    const key = Object.keys(students).find(k => k.toLowerCase() === candidate.toLowerCase());
    if (key) return { key, student: students[key], nameLen: len };
  }
  return null;
}

function getStudents(chatId) {
  const data = getData();
  return data.users?.[chatId]?.students || {};
}

module.exports = {
  getData, saveData,
  isRegistered, registerUser, getAllUsers,
  getStudents, findStudentKey, getStudent, saveStudent,
  addStudent, renameStudent, deleteStudent,
  resolveStudentSuffix
};
