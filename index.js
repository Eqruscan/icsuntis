import express from 'express';
import { createEvents } from 'ics';
import { WebUntis } from 'webuntis';

const app = express();
const port = process.env.PORT || 3979;

// Mapping-Tabelle für Fachnamen
const subjectMap = {
    "eng_LK_5": "Englisch LK",
    "mathe_GK_3": "Mathematik GK",
    "bio_LK_2": "Biologie LK",
    // weitere hier ergänzen
};

// 🔑 Login-Daten über Render Environment Variables
const server = process.env.WEBUNTIS_SERVER;
const school = process.env.WEBUNTIS_SCHOOL;
const username = process.env.WEBUNTIS_USERNAME;
const password = process.env.WEBUNTIS_PASSWORD;

if (!server || !school || !username || !password) {
    console.error("❌ Fehlende WebUntis Zugangsdaten in den Environment Variables!");
}

async function generateCalendar() {
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

            // Mapping anwenden
            const subjects = lesson.su
                .map(subject => subjectMap[subject.name] || subject.longname || subject.name)
                .join(', ');

            const rooms = lesson.ro ? lesson.ro.map(room => room.name).join(', ') : 'Kein Raum';
            const teachers = lesson.te ? lesson.te.map(teacher => teacher.longname).join(', ') : 'Unbekannt';

            return {
                start: [year, month, day, startHour, startMinute],
                end: [year, month, day, endHour, endMinute],
                title: subjects || 'Stunde',
                location: rooms,
                description: `Lehrer: ${teachers}${lesson.info ? `\nInfo: ${lesson.info}` : ''}`,
            };
        });

    return new Promise((resolve, reject) => {
        createEvents(events, (error, value) => {
            if (error) reject(error);
            else resolve(value);
        });
    });
}

// 📌 Route: Kalender-Datei
app.get('/calendar.ics', async (req, res) => {
    try {
        const icsFile = await generateCalendar();
        res.setHeader('Content-Disposition', 'attachment; filename="timetable.ics"');
        res.setHeader('Content-Type', 'text/calendar');
        res.send(icsFile);
    } catch (error) {
        console.error(error);
        res.status(500).send("Fehler beim Erstellen des Kalenders.");
    }
});

// 📌 Route: Startseite → zeigt den Abo-Link
app.get('/', (req, res) => {
    const baseUrl = `https://${req.get('host')}`;
    const icsUrl = `${baseUrl}/calendar.ics`;
    res.send(`<h1>Dein Kalender-Link</h1><p>🔗 <a href="${icsUrl}">${icsUrl}</a></p>`);
});

app.listen(port, () => {
    console.log(`ICSUntis läuft auf http://localhost:${port}`);
});
