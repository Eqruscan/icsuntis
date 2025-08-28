import express from 'express';
import { createEvents } from 'ics';
import { WebUntis } from 'webuntis';
import { DateTime } from 'luxon';

const app = express();
const port = process.env.PORT || 3979;

// In-memory Cache
const calendarCache = { data: null, timestamp: 0, ttl: 10 * 60 * 1000 };

// === REMAP: Nur hier die Fächer umbenennen ===
const remapSubjects = { 
  'Mathematik': 'Math', 
  'eng_LK_5': 'ENGLISCH LK',
  'Englisch': 'ENGLISCH'
};

// Helper: Nur Subjects remappen
const applyRemap = (lesson) => {
  const subjects = (lesson.su || []).map(sub => remapSubjects[sub.longname] || sub.longname).join(', ') || 'Stunde';
  const rooms = lesson.ro ? lesson.ro.map(r => r.name).join(', ') : 'No room specified';
  const teachers = lesson.te ? lesson.te.map(t => t.longname).join(', ') : 'No teacher specified';
  const inf = lesson.info ? `\n\nInfo: ${lesson.info}` : '';
  const fullinfo = `Teacher: ${teachers}${inf}`;
  return { subjects, rooms, fullinfo };
};

// Helper: Env or query
const getCred = (queryValue, envVar) => queryValue || envVar;

// === CALENDAR ROUTE ===
app.get('/calendar.ics', async (req, res) => {
  try {
    // Cache prüfen
    if (calendarCache.data && Date.now() - calendarCache.timestamp < calendarCache.ttl) {
      return res.set({
        'Content-Disposition': 'attachment; filename="timetable.ics"',
        'Content-Type': 'text/calendar'
      }).send(calendarCache.data);
    }

    const { server, school, username, password } = req.query;
    const WEBUNTIS_SERVER = getCred(server, process.env.WEBUNTIS_SERVER);
    const WEBUNTIS_SCHOOL = getCred(school, process.env.WEBUNTIS_SCHOOL);
    const WEBUNTIS_USER = getCred(username, process.env.WEBUNTIS_USER);
    const WEBUNTIS_PASSWORD = getCred(password, process.env.WEBUNTIS_PASSWORD);

    if (!WEBUNTIS_SERVER || !WEBUNTIS_SCHOOL || !WEBUNTIS_USER || !WEBUNTIS_PASSWORD) {
      return res.status(400).send('Missing WebUntis credentials.');
    }

    const untis = new WebUntis(WEBUNTIS_SCHOOL, WEBUNTIS_USER, WEBUNTIS_PASSWORD, WEBUNTIS_SERVER);
    await untis.login();

    const startDate = DateTime.now().minus({ months: 2 }).toJSDate();
    const endDate = DateTime.now().plus({ months: 2 }).toJSDate();
    const timetable = await untis.getOwnTimetableForRange(startDate, endDate);

    const events = timetable
      .filter(l => l.code !== 'cancelled')
      .map(lesson => {
        const dateStr = String(lesson.date).padStart(8, '0');
        const year = parseInt(dateStr.slice(0, 4));
        const month = parseInt(dateStr.slice(4, 6));
        const day = parseInt(dateStr.slice(6, 8));
        const startHour = Math.floor(lesson.startTime / 100);
        const startMinute = lesson.startTime % 100;
        const endHour = Math.floor(lesson.endTime / 100);
        const endMinute = lesson.endTime % 100;
        const { subjects, rooms, fullinfo } = applyRemap(lesson);

        const startDT = DateTime.fromObject(
          { year, month, day, hour: startHour, minute: startMinute }, 
          { zone: 'Europe/Berlin' }
        ).toUTC();

        const endDT = DateTime.fromObject(
          { year, month, day, hour: endHour, minute: endMinute }, 
          { zone: 'Europe/Berlin' }
        ).toUTC();

        return {
          start: [startDT.year, startDT.month, startDT.day, startDT.hour, startDT.minute],
          end:   [endDT.year, endDT.month, endDT.day, endDT.hour, endDT.minute],
          title: subjects,
          location: rooms,
          description: fullinfo
        };
      });

    // Merge consecutive events
    const mergedEvents = [];
    let current = events[0];
    for (let i = 1; i < events.length; i++) {
      const next = events[i];
      if (
        current.title === next.title &&
        current.location === next.location &&
        current.description === next.description &&
        current.end.join() === next.start.join()
      ) {
        current.end = next.end;
      } else {
        mergedEvents.push(current);
        current = next;
      }
    }
    if (current) mergedEvents.push(current);

    createEvents(mergedEvents, (err, value) => {
      if (err) return res.status(500).send('Error generating calendar.');
      calendarCache.data = value;
      calendarCache.timestamp = Date.now();
      res.set({
        'Content-Disposition': 'attachment; filename="timetable.ics"',
        'Content-Type': 'text/calendar'
      }).send(value);
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching timetable.');
  }
});

// Root redirects to calendar
app.get('/', (req, res) => {
  const params = new URLSearchParams({
    server: process.env.WEBUNTIS_SERVER,
    school: process.env.WEBUNTIS_SCHOOL,
    username: process.env.WEBUNTIS_USER,
    password: process.env.WEBUNTIS_PASSWORD
  });
  res.redirect(`/calendar.ics?${params.toString()}`);
});

app.listen(port, () => console.log(`ICSUntis running on port ${port}`));
