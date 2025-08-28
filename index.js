import express from 'express';
import { createEvents } from 'ics';
import { WebUntis } from 'webuntis';

const app = express();
const port = process.env.PORT || 3979;

app.get('/calendar.ics', async (req, res) => {
  try {
    const { server, school, username, password } = req.query;

    // Fallback auf Environment Variables, falls nicht in Query
    const WEBUNTIS_SERVER = server || process.env.WEBUNTIS_SERVER;
    const WEBUNTIS_SCHOOL = school || process.env.WEBUNTIS_SCHOOL;
    const WEBUNTIS_USER = username || process.env.WEBUNTIS_USER;
    const WEBUNTIS_PASSWORD = password || process.env.WEBUNTIS_PASSWORD;

    if (!WEBUNTIS_SERVER || !WEBUNTIS_SCHOOL || !WEBUNTIS_USER || !WEBUNTIS_PASSWORD) {
      return res.status(400).send('Missing WebUntis credentials in environment variables.');
    }

    const untis = new WebUntis(WEBUNTIS_SCHOOL, WEBUNTIS_USER, WEBUNTIS_PASSWORD, WEBUNTIS_SERVER);
    await untis.login();

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 2);
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 2);

    const timetable = await untis.getOwnTimetableForRange(startDate, endDate);

    const events = timetable
      .filter(lesson => lesson.code !== 'cancelled')
      .map(lesson => {
        const dateStr = lesson.date.toString();
        const year = parseInt(dateStr.slice(0, 4));
        const month = parseInt(dateStr.slice(4, 6));
        const day = parseInt(dateStr.slice(6, 8));

        const startHour = Math.floor(lesson.startTime / 100);
        const startMinute = lesson.startTime % 100;
        const endHour = Math.floor(lesson.endTime / 100);
        const endMinute = lesson.endTime % 100;

        const subjects = lesson.su.map(sub => sub.longname).join(', ') || 'Stunde';
        const rooms = lesson.ro ? lesson.ro.map(r => r.name).join(', ') : 'No room specified';
        const teachers = lesson.te ? lesson.te.map(t => t.longname).join(', ') : 'No teacher specified';
        const inf = lesson.info ? `\n\nInfo: ${lesson.info || ''}` : '';
        const fullinfo = `Teacher: ${teachers}${inf}`;

        // Korrekte lokale Zeit für ICS
        const startDateObj = new Date(year, month - 1, day, startHour, startMinute);
        const endDateObj = new Date(year, month - 1, day, endHour, endMinute);

        return {
          start: [startDateObj.getFullYear(), startDateObj.getMonth() + 1, startDateObj.getDate(), startDateObj.getHours(), startDateObj.getMinutes()],
          end: [endDateObj.getFullYear(), endDateObj.getMonth() + 1, endDateObj.getDate(), endDateObj.getHours(), endDateObj.getMinutes()],
          title: subjects,
          location: rooms,
          description: fullinfo
        };
      });

    // Merge aufeinanderfolgende Events mit gleichen Daten
    const mergedEvents = [];
    for (let i = 0; i < events.length; i++) {
      const current = events[i];
      const next = events[i + 1];
      if (next &&
          current.title === next.title &&
          current.location === next.location &&
          current.description === next.description &&
          current.start[0] === next.start[0] &&
          current.start[1] === next.start[1] &&
          current.start[2] === next.start[2]
      ) {
        mergedEvents.push({ ...current, end: next.end });
        i++;
      } else {
        mergedEvents.push(current);
      }
    }

    // ICS erzeugen ohne timezone-Option
    createEvents(mergedEvents, (error, value) => {
      if (error) {
        console.error('Error during calendar creation:', error);
        return res.status(500).send('Error during calendar creation.');
      }
      res.setHeader('Content-Disposition', 'attachment; filename="timetable.ics"');
      res.setHeader('Content-Type', 'text/calendar');
      res.send(value);
    });

  } catch (error) {
    console.error('Error when retrieving the timetable:', error);
    res.status(500).send('Error when retrieving the timetable.');
  }
});

app.listen(port, () => {
  console.log(`ICSUntis running on port ${port}`);
});
