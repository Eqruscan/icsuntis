import express from 'express';
import { createEvents } from 'ics';
import { WebUntis } from 'webuntis';

const app = express();
const port = 3979;

// Route für iCal-Datei
app.get('/calendar.ics', async (req, res) => {
    try {
        // WebUntis-Zugang über Environment Variables (sicherer)
        const server = process.env.WEBUNTIS_SERVER;
        const school = process.env.WEBUNTIS_SCHOOL;
        const username = process.env.WEBUNTIS_USER;
        const password = process.env.WEBUNTIS_PASSWORD;

        if (!server || !school || !username || !password) {
            return res.status(400).send('Missing WebUntis credentials in environment variables.');
        }

        const untis = new WebUntis(school, username, password, server);
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

                const subjects = lesson.su.map(subject => subject.longname).join(', ');
                const rooms = lesson.ro ? lesson.ro.map(room => room.name).join(', ') : 'No room specified';
                const teachers = lesson.te ? lesson.te.map(teacher => teacher.longname).join(', ') : 'No teacher specified';

                const inf = lesson.info ? `\n\nInfo: ${lesson.info || ''}` : '';
                const fullinfo = `Teacher: ${teachers}${inf}`;

                return {
                    start: [year, month, day, startHour, startMinute],
                    end: [year, month, day, endHour, endMinute],
                    title: subjects || 'Stunde',
                    location: rooms,
                    description: fullinfo,
                    startInputType: 'local',
                    endInputType: 'local',
                    startOutputType: 'local',
                    endOutputType: 'local'
                };
            });

        const mergedEvents = [];
        for (let i = 0; i < events.length; i++) {
            const currentEvent = events[i];
            const nextEvent = events[i + 1];

            if (
                nextEvent &&
                currentEvent.title === nextEvent.title &&
                currentEvent.location === nextEvent.location &&
                currentEvent.description === nextEvent.description &&
                currentEvent.start[0] === nextEvent.start[0] &&
                currentEvent.start[1] === nextEvent.start[1] &&
                currentEvent.start[2] === nextEvent.start[2]
            ) {
                mergedEvents.push({
                    ...currentEvent,
                    end: nextEvent.end
                });
                i++;
            } else {
                mergedEvents.push(currentEvent);
            }
        }

        createEvents(mergedEvents, { timezone: 'Europe/Berlin' }, (error, value) => {
            if (error) {
                console.error(error);
                res.status(500).send('Error during calendar creation.');
                return;
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

// Optional: Root-Route für Info
app.get('/', (req, res) => {
    res.send('ICSUntis läuft – iCal-Link: <a href="/calendar.ics">/calendar.ics</a>');
});

app.listen(port, () => {
    console.log(`ICSUntis running on http://localhost:${port}`);
});
