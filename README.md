# Tutor Bot

A WhatsApp bot for managing tutoring sessions — tracks student progress, sends homework and lesson plan reminders automatically.

---

## Requirements

- [Node.js](https://nodejs.org) v18 or higher
- A WhatsApp account (the bot runs on your own number)

---

## Installation

```bash
git clone https://github.com/c888michael-sys/bot-for-tutors.git
cd bot-for-tutors
npm install
npm start
```

Scan the QR code that appears with WhatsApp on your phone:
**WhatsApp → Settings → Linked Devices → Link a Device**

The bot is now running. Message yourself (Saved Messages) and type `menu`.

---

## Running 24/7 (without keeping terminal open)

```bash
npm install -g pm2
pm2 start index.js --name tutor-bot
pm2 save
pm2 startup   # run the command it prints
```

To prevent your Mac from sleeping while plugged in:
```bash
sudo pmset -a sleep 0 disablesleep 1
```

---

## Menu Navigation

Type `menu` at any time to open the main menu. Reply with numbers to navigate. Type `0` to go back a step.

---

## Commands

### Status tracking
```
input status add [topic] [1-3] [name]    — add a new topic
input status [topic] [1-3] [name]        — update a topic's rating
input status remove [topic] [name]       — remove a topic
output status [name]                     — view full status breakdown
```
Ratings: `1` = poor/not learnt · `2` = getting there · `3` = good

### Homework & lesson content
```
input homework [name] [content]          — set homework to assign
input lesson [name] [content]            — set lesson plan content
output homework [name]                   — topics rated 2 + saved homework
output lesson [name]                     — topics rated 1 + saved lesson plan
```

### Lesson date & reminders
```
lesson [name] date [date]                — set next lesson date (e.g. 12 May)
homework [name] done                     — stop homework reminder
lesson [name] done                       — stop lesson plan reminder
```

Reminders fire automatically at **10am** after a lesson date passes:
- Homework reminder every **24 hours**
- Lesson plan reminder every **48 hours**

### Student management
```
student add [name]
student rename [old name] [new name]
student delete [name]
student year [name] [year]               — e.g. student year Josh Y7
```

---

## Data

All student data is stored locally in `data/storage.json`. This file is excluded from GitHub — it stays on your machine only.

---

## Restart bot

```bash
pkill -f Chrome && pkill -f "node index.js" && npm start
```
