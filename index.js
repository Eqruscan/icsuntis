import express from 'express';
import { createEvents } from 'ics';
import { WebUntis } from 'webuntis';
import { DateTime } from 'luxon';
import dotenv from 'dotenv';

dotenv.config(); // Lädt .env Variablen

const app = express();
const port = process.env.PORT || 3979;

// WebUntis Credentials aus .env
const WEBUNTIS_SERVER   = process.env.WEBUNTIS_SERVER;
const WEBUNTIS_SCHOOL   = process.env.WEBUNTIS_SCHOOL;
const WEBUNTIS_USER     = process.env.WEBUNTIS_USER;
const WEBUNTIS_PASSWORD = process.env.WEBUNTIS_PASSWORD;

if (!WEBUNTIS_SERVER || !WEBUNTIS_SCHOOL || !WEBUNTIS_USER || !WEBUNTIS_PASSWORD) {
  console.error('Bitte alle WebUntis-Umgebungsvariablen setzen: WEBUNTIS_SERVER, WEBUNTIS_SCHOOL, WEBUNTIS_USER, WEBUNTIS_PASSWORD');
  process.exit(1);
}

// Optional: Mapping von Kurzcodes auf lesbare Namen
const subjectMap = {
  'eng_LK_5': 'Englisch LK',
  'mat_GK_11': 'Mathematik GK',
  // weitere Abkürzungen hier ergänzen
};

app.get('/calendar.ics', async (req, res) => {
  try {
    const untis = new WebUntis(WEBUNTIS_SCHOOL, WEBUNTIS_USER, WEBUNTIS_PASSWORD, WEBUNTIS_SERVER);
    await untis.login();

    const startDate = DateTime.now().minus({ months: 2 }).toJSDate();
    const endDate   = DateTime.now().plus({ months: 2 }).toJSDate();

    const timetable = await untis.getOwnTimetableForRange(startDate, endDate);

    if (!timetable.length) {
      return res.status(200).send('Keine Stunden in diesem Zeitraum gefunden.');
    }

    // Lessons zu ICS Events konvertieren
    const events = timetable
      .filter(lesson => lesson.code !== 'cancelled')
      .map(lesson => {
        const dateStr = String(lesson.date).padStart(8, '0');
        const year = parseInt(dateStr.slice(0, 4));
        const month = parseInt(dateStr.slice(4, 6));
        const day = parseInt(dateStr.slice(6, 8));

        const startHour = Math.floor(lesson.startTime / 100);
        const startMinute = lesson.startTime % 100;
        const endHour = Math.floor(lesson.endTime / 100);
        const endMinute = lesson.endTime % 100;

        // Fächer korrekt bestimmen
        const subjects = (lesson.su || [])
          .map(sub => subjectMap[sub.name] || sub.longname || sub.name || 'Stunde')
          .join(', ');

        const rooms = lesson.ro ? lesson.ro.map(r => r.name).join(', ') : 'Kein Raum angegeben';
        const teachers = lesson.te ? lesson.te.map(t => t.longname).join(', ') : 'Kein Lehrer angegeben';
        const inf = lesson.info ? `\n\nInfo: ${lesson.info}` : '';
        const fullinfo = `Lehrer: ${teachers}${inf}`;

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

    // Events zusammenführen
    const mergedEvents = [];
    let current = events[0];
    for (let i = 1; i < events.length; i++) {
      const next = events[i];

      const currentEndMillis = DateTime.fromObject({
        year: current.end[0], month: current.end[1], day: current.end[2],
        hour: current.end[3], minute: current.end[4]
      }).toMillis();

      const nextStartMillis = DateTime.fromObject({
        year: next.start[0], month: next.start[1], day: next.start[2],
        hour: next.start[3], minute: next.start[4]
      }).toMillis();

      if (
        current.title === next.title &&
        current.location === next.location &&
        current.description === next.description &&
        currentEndMillis === nextStartMillis
      ) {
        current.end = next.end;
      } else {
        mergedEvents.push(current);
        current = next;
      }
    }
    if (current) mergedEvents.push(current);

    // ICS-Datei erstellen
    createEvents(mergedEvents, (error, value) => {
      if (error) {
        console.error('Fehler beim Erstellen der ICS:', error);
        return res.status(500).send('Fehler beim Erstellen der ICS.');
      }
      res.setHeader('Content-Disposition', 'attachment; filename="timetable.ics"');
      res.setHeader('Content-Type', 'text/calendar');
      res.send(value);
    });
  } catch (error) {
    console.error('Fehler beim Abrufen des Stundenplans:', error);
    res.status(500).send('Fehler beim Abrufen des Stundenplans.');
  }
});

// Root leitet auf /calendar.ics weiter
app.get('/', (req, res) => {
  res.redirect('/calendar.ics');
});

app.listen(port, () => {
  console.log(`ICSUntis läuft auf Port ${port}`);
});
