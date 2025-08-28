import express from 'express';
import { createEvents } from 'ics';
import { WebUntis } from 'webuntis';
import { DateTime } from 'luxon';
import bodyParser from 'body-parser';

const app = express();
const port = process.env.PORT || 3979;

// Middleware to parse JSON and form data
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// In-memory cache
const calendarCache = { data: null, timestamp: 0, ttl: 10 * 60 * 1000 };

// Remapping configuration (editable via web interface)
const remap = {
  subjects: { 'Mathematik': 'Math', 'Englisch': 'English' },
  rooms: { 'Raum 101': 'Room 101' },
  teachers: { 'Müller': 'Mr. Müller' }
};

// Helper to safely get env or query param
const getCred = (queryValue, envVar) => queryValue || envVar;

// Apply remapping
const applyRemap = (lesson) => {
  const subjects = (lesson.su || []).map(sub => remap.subjects[sub.longname] || sub.longname).join(', ') || 'Stunde';
  const rooms = lesson.ro ? lesson.ro.map(r => remap.rooms[r.name] || r.name).join(', ') : 'No room specified';
  const teachers = lesson.te ? lesson.te.map(t => remap.teachers[t.longname] || t.longname).join(', ') : 'No teacher specified';
  const inf = lesson.info ? `\n\nInfo: ${lesson.info}` : '';
  const fullinfo = `Teacher: ${teachers}${inf}`;
  return { subjects, rooms, fullinfo };
};

// Generate ICS calendar
app.get('/calendar.ics', async (req, res) => {
  try {
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

        const startDT = DateTime.fromObject({ year, month, day, hour: startHour, minute: startMinute }, { zone: 'Europe/Berlin' }).toUTC();
        const endDT = DateTime.fromObject({ year, month, day, hour: endHour, minute: endMinute }, { zone: 'Europe/Berlin' }).toUTC();

        return { start: [startDT.year, startDT.month, startDT.day, startDT.hour, startDT.minute], end: [endDT.year, endDT.month, endDT.day, endDT.hour, endDT.minute], title: subjects, location: rooms, description: fullinfo };
      });

    // Merge consecutive events
    const merged = [];
    let current = events[0];
    for (let i = 1; i < events.length; i++) {
      const next = events[i];
      if (current.title === next.title && current.location === next.location && current.description === next.description && current.end.join() === next.start.join()) {
        current.end = next.end;
      } else {
        merged.push(current);
        current = next;
      }
    }
    if (current) merged.push(current);

    createEvents(merged, (err, value) => {
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

// Web interface to view and edit remapping
app.get('/remap', (req, res) => {
  const renderMap = (obj) => Object.entries(obj).map(([k,v]) => `<tr><td>${k}</td><td><input name="${k}" value="${v}" /></td></tr>`).join('');
  res.send(`
    <h2>Remap Subjects</h2>
    <form method="POST">
      <h3>Subjects</h3>
      <table>${renderMap(remap.subjects)}</table>
      <h3>Rooms</h3>
      <table>${renderMap(remap.rooms)}</table>
      <h3>Teachers</h3>
      <table>${renderMap(remap.teachers)}</table>
      <button type="submit">Update Remapping</button>
    </form>
  `);
});

// Handle remap updates
app.post('/remap', (req, res) => {
  Object.keys(remap.subjects).forEach(key => { if(req.body[key]) remap.subjects[key] = req.body[key]; });
  Object.keys(remap.rooms).forEach(key => { if(req.body[key]) remap.rooms[key] = req.body[key]; });
  Object.keys(remap.teachers).forEach(key => { if(req.body[key]) remap.teachers[key] = req.body[key]; });
  // Clear cache after remap
  calendarCache.data = null;
  res.redirect('/remap');
});

app.listen(port, () => console.log(`ICSUntis running on port ${port}`));
