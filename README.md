# Tutor Bot

A **Telegram bot** for managing tutoring sessions — tracks student progress per topic, records exam results, and sends automatic homework / lesson-plan reminders after each lesson.

Built on [Telegraf](https://telegraf.js.org). The first user who authenticates becomes the admin; everyone else needs the password.

---

## Requirements

- [Node.js](https://nodejs.org) v18 or higher
- A Telegram bot token (create one via [@BotFather](https://t.me/BotFather))

---

## Installation

```bash
git clone https://github.com/c888michael-sys/bot-for-tutors.git
cd bot-for-tutors
npm install
```

Create `data/config.json` (this file is gitignored — never commit it):

```json
{
  "botToken": "123456:ABC-DEF...",
  "password": "your-initial-shared-password"
}
```

Then start:

```bash
npm start
```

Open Telegram, find your bot by its `@bot_username`, send any message, enter the password, then enter a name. You're in.

---

## Using the bot

After registering, a **persistent menu bar** is pinned to the bottom of the chat:

```
👤 Students       🔔 Reminders
➕ Add Student    📖 Help
👑 Admin Panel    (admins only)
```

Tap any button to navigate. Sub-screens (student details, edit, exam list, snooze, etc.) use inline buttons inside the message.

### `/menu` — refresh the menu bar
If the menu ever looks stale (e.g. your admin row didn't appear after promotion, or you just deployed a change), tap **`/menu`**. It clears any in-progress flow and re-attaches a fresh keyboard.

### Other slash commands

| Command | Who | What |
|---|---|---|
| `/start` | anyone | First-time entry; shows the menu if already registered |
| `/menu` | anyone | Force-refresh the persistent menu bar |
| `/cancel` | anyone | Cancel the current setup/input flow |
| `/password` | admin | Show the current password |
| `/newpassword` | admin | Generate and set a new password |
| `/testnotify` | admin | Send a test push to every registered user |

---

## Text commands

You can also type these in chat — they work alongside the menu buttons.

### Status tracking
```
input status add [topic] [1-3] [name]    — add a new topic
input status [topic] [1-3] [name]        — update an existing topic's rating
input status remove [topic] [name]       — remove a topic (with confirm)
output status [name]                     — full breakdown by rating
```
Ratings: `1` = poor / not learnt · `2` = getting there · `3` = good

### Homework & lesson content
```
input homework [name] [content]          — save homework to assign
input lesson [name] [content]            — save lesson plan content
output homework [name]                   — topics rated 2 + saved homework
output lesson [name]                     — topics rated 1 + saved lesson plan
```

### Lesson date & reminders
```
lesson [name] date [date]                — set next lesson date (e.g. 12 May)
homework [name] done                     — stop homework reminder
lesson [name] done                       — stop lesson plan reminder
reminder [name] homework|lesson|both     — reactivate reminders
reminders on | reminders off             — global on/off for your account
```

### Student management
```
student add [name]
student rename [old] [new]
student delete [name]                    — with confirm
student year [name] [year]               — e.g. student year Josh Y7
```

---

## Reminders

Reminders fire automatically once a student's `nextLesson` date has passed:
- **Homework** reminder every **24 hours**
- **Lesson plan** reminder every **48 hours**

Each reminder message includes a Done / Snooze button. Use the in-menu **🔔 Reminders** view or the `Snooze` button on a student's page to stop them per-student.

---

## Running 24/7 with pm2

```bash
npm install -g pm2
pm2 start index.js --name tutor-bot
pm2 save
pm2 startup   # run the command it prints
```

### ⚠ Run exactly one instance

Telegram allows only **one** long-poll consumer per bot token. If two copies are running, every other update is dropped or served by the wrong process — symptoms include a menu that "reverts" between actions, missing button rows, and `409 Conflict: terminated by other getUpdates request` in the logs.

Check at any time:
```bash
ps -ef | grep 'node.*index.js' | grep -v grep
pm2 list
```

If pm2 shows the app twice or with `instances > 1`, fix it:
```bash
pm2 scale tutor-bot 1       # if exec_mode is cluster with >1 instance
# or:
pm2 delete <stale-id>       # if there are duplicate entries
pm2 save
pm2 restart tutor-bot
```

---

## Data

All state is in **`data/storage.json`** (gitignored). It holds:
- Registered users (chat id, display name, admin flag)
- The current password (initialized from `config.json`, then mutable via `/newpassword`)
- Each user's students, topics, exams, lesson schedule, and reminder state

Back this file up if it matters to you — `pm2 restart` doesn't touch it but a manual delete is irreversible.

---

## Restart after a code change

```bash
cd /path/to/bot-for-tutors
git pull
pm2 restart tutor-bot
pm2 logs tutor-bot --lines 30 --nostream    # verify it came up clean
```
