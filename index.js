import e from 'express';
import express from 'express';
import { createEvents } from 'ics';
import { WebUntis } from 'webuntis';

const app = express();
const port = 3000;

app.get('/', async (req, res) => {
    try {
        // Lese Verbindungsinformationen aus den URL-Parametern
        const { server, school, username, password } = req.query;
        
        if (!server & !school & !username & !password) {
            return res.redirect('https://github.com/tschuerti/icsuntis');
        }

        if (!server || !school || !username || !password) {
            return res.status(400).send('Fehlende Verbindungsdaten: Bitte server, school, username und password angeben.');
        }

        // Erstelle eine neue Instanz von WebUntis mit den dynamischen Daten
        const untis = new WebUntis(school, username, password, server);

        await untis.login();

        // Berechne das Startdatum (zwei Monate zurück) und Enddatum (zwei Monate vorwärts)
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 2);
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 2);

        const timetable = await untis.getOwnTimetableForRange(startDate, endDate);

        // Struktur für .ics Events
        const events = timetable
            .filter(lesson => lesson.code !== 'cancelled')  // Filter für entfallene Stunden
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

        // Erstellen der .ics-Datei
        createEvents(events, (error, value) => {
            if (error) {
                console.error(error);
                res.status(500).send('Fehler bei der Kalendererstellung.');
                return;
            }

            // .ics-Datei bereitstellen
            res.setHeader('Content-Disposition', 'attachment; filename="Stundenplan.ics"');
            res.setHeader('Content-Type', 'text/calendar');
            res.send(value);
        });
    } catch (error) {
        console.error('Fehler beim Abrufen des Stundenplans:', error);
        res.status(500).send('Fehler beim Abrufen des Stundenplans.');
    }
});

app.listen(port, () => {
    console.log(`Server läuft auf http://localhost:${port}`);
});
