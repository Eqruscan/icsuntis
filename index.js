import express from 'express';
import { createEvents } from 'ics';
import { WebUntis } from 'webuntis';

const app = express();
const port = process.env.PORT || 3979;

// 🔧 Mapping-Tabelle für schönere Fachnamen
const subjectMap = {
    "eng_LK_5": "Englisch LK",
    "mathe_GK_3": "Mathematik GK",
    "bio_LK_2": "Biologie LK",
    // ➕ hier weitere Kürzel eintragen
};

app.get('/', async (req, res) => {
    try {
        const { server, school, username, password } = req.query;

        if (!server || !school || !username || !password) {
            return res.status(400).send('Fehlende Zugangsdaten: Bitte server, school, username und password angeben.');
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

                // 👇 Mapping anwenden
                const subjects = lesson.su
                    .map(subject =>
                        subjectMap[subject.name] || subject.longname || subject.name
                    )
                    .join(', ');

                const rooms = lesson.ro ? lesson.ro.map(room => room.name).join(', ') : 'Kein Raum angegeben';
                const teachers = lesson.te ? lesson.te.map(teacher => teacher.longname).join(', ') : 'Kein Lehrer angegeben';

                const inf = lesson.info ? `\n\nInfo: ${lesson.info || ''}` : '';
                const fullinfo = `Lehrer: ${teachers}${inf}`;

                return {
                    start: [year, month, day, startHour, startMinute],
                    end: [year, month, day, endHour, endMinute],
                    title: subjects || 'Stunde',
                    location: rooms,
                    description: fullinfo,
                };
            });

        createEvents(events, (error, value) => {
            if (error) {
                console.error(error);
                res.status(500).send('Fehler beim Erstellen des Kalenders.');
                return;
            }

            res.setHeader('Content-Disposition', 'attachment; filename="timetable.ics"');
            res.setHeader('Content-Type', 'text/calendar');
            res.send(value);
        });
    } catch (error) {
        console.error('Fehler beim Laden des Stundenplans:', error);
        res.status(500).send('Fehler beim Laden des Stundenplans.');
    }
});

app.listen(port, () => {
    console.log(`ICSUntis läuft auf http://localhost:${port}`);
});
