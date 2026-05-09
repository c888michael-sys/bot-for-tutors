function parseDate(input) {
  if (!input) return null;
  const withYear = /\d{4}/.test(input) ? input : `${input} ${new Date().getFullYear()}`;
  const d = new Date(withYear);
  return isNaN(d.getTime()) ? null : d;
}

function parseTime(input) {
  if (!input) return null;
  const s = input.trim().toLowerCase();

  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = parseInt(ampm[2] || '0');
    if (ampm[3] === 'pm' && h !== 12) h += 12;
    if (ampm[3] === 'am' && h === 12) h = 0;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const plain = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (plain) {
    const h = parseInt(plain[1]);
    const m = parseInt(plain[2] || '0');
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59)
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return null;
}

function formatTime(hhmm) {
  if (!hhmm) return 'not set';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')}${period}`;
}

// Returns "YYYY-MM-DD" in Sydney time for a given Date object
function sydneyDate(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

// Returns current Sydney time as total minutes since midnight
function sydneyMinutes() {
  const t = new Date().toLocaleTimeString('en-AU', {
    timeZone: 'Australia/Sydney',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

module.exports = { parseDate, parseTime, formatTime, sydneyDate, sydneyMinutes };
