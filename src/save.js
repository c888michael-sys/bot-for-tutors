const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'storage.json');

function getData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { tutorChatId: null, students: {} };
  }
}

function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function findStudentKey(data, name) {
  return Object.keys(data.students).find(
    k => k.toLowerCase() === name.toLowerCase()
  ) || null;
}

function getStudent(name) {
  const data = getData();
  const key = findStudentKey(data, name);
  return key ? { key, student: data.students[key] } : null;
}

function saveStudent(name, studentData) {
  const data = getData();
  const key = findStudentKey(data, name) || name;
  data.students[key] = studentData;
  saveData(data);
  return key;
}

function addStudent(name) {
  const data = getData();
  if (findStudentKey(data, name)) return false;
  data.students[name] = {
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
  };
  saveData(data);
  return true;
}

function renameStudent(oldName, newName) {
  const data = getData();
  const oldKey = findStudentKey(data, oldName);
  if (!oldKey) return 'not_found';
  if (findStudentKey(data, newName)) return 'exists';
  data.students[newName] = data.students[oldKey];
  delete data.students[oldKey];
  saveData(data);
  return 'ok';
}

function deleteStudent(name) {
  const data = getData();
  const key = findStudentKey(data, name);
  if (!key) return false;
  delete data.students[key];
  saveData(data);
  return true;
}

function setTutorChatId(chatId) {
  const data = getData();
  data.tutorChatId = chatId;
  saveData(data);
}

// Try to resolve a student name from the end of a token array.
// Tries up to 3-word suffixes. Returns { key, student, nameLen } or null.
function resolveStudentSuffix(tokens, data) {
  for (let len = Math.min(3, tokens.length); len >= 1; len--) {
    const candidate = tokens.slice(tokens.length - len).join(' ');
    const key = findStudentKey(data, candidate);
    if (key) return { key, student: data.students[key], nameLen: len };
  }
  return null;
}

module.exports = {
  getData, saveData, findStudentKey,
  getStudent, saveStudent,
  addStudent, renameStudent, deleteStudent,
  setTutorChatId, resolveStudentSuffix
};
