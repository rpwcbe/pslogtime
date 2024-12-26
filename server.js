const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = 3000;

// Initialize the database
let db = new sqlite3.Database('./employee_logs.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the employee_logs database.');

        // Create table if it does not exist
        db.run(`CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            date TEXT,
            checkInTime TEXT,
            checkOutTime TEXT,
            workingHours REAL,
            monthName TEXT,
            daysInMonth INTEGER
        )`, (err) => {
            if (err) {
                console.error('Error creating table:', err.message);
            }
        });
    }
});

app.use(bodyParser.json());

// Helper function to get month name
function getMonthName(date) {
    const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    return monthNames[new Date(date).getMonth()];
}

// Helper function to get number of days an employee worked in a month
function getDaysInMonth(name, monthName) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT COUNT(DISTINCT date) AS days FROM logs WHERE name = ? AND monthName = ?`;
        db.get(sql, [name, monthName], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row ? row.days : 0);
            }
        });
    });
}

// Serve the frontend interface
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to get today's login/logout information
app.get('/today-logs', (req, res) => {
    const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
    const sql = 'SELECT name, checkInTime, checkOutTime FROM logs WHERE date = ?';
    db.all(sql, [today], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Endpoint to log in/out times
app.post('/log', async (req, res) => {
    const { name, action, timestamp } = req.body;
    const date = new Date(timestamp).toISOString().split('T')[0]; // Ensure date is in YYYY-MM-DD format
    const monthName = getMonthName(date);

    // Check if the employee has already logged in today
    const sql = `SELECT * FROM logs WHERE name = ? AND date = ?`;
    db.get(sql, [name, date], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (row) {
            if (action === 'in') {
                // If the employee has already logged in today, prevent further logging in
                return res.status(400).json({ message: "You have already logged in today." });
            } else if (action === 'out' && !row.checkOutTime) {
                // Allow logging out if there's a corresponding log-in and no log-out yet
                db.run(`UPDATE logs SET checkOutTime = ?, workingHours = (julianday(?) - julianday(checkInTime)) * 24 WHERE id = ?`, [timestamp, timestamp, row.id], async function(err) {
                    if (err) {
                        return console.log(err.message);
                    }
                    const daysInMonth = await getDaysInMonth(name, monthName);
                    db.run(`UPDATE logs SET daysInMonth = ? WHERE name = ? AND monthName = ?`, [daysInMonth, name, monthName]);
                    res.json({ id: this.changes, name, action, timestamp, date, monthName, daysInMonth });
                });
            } else {
                return res.status(400).json({ message: "You have already logged in and out today." });
            }
        } else {
            if (action === 'in') {
                db.run(`INSERT INTO logs (name, date, checkInTime, monthName) VALUES (?, ?, ?, ?)`, [name, date, timestamp, monthName], async function(err) {
                    if (err) {
                        return console.log(err.message);
                    }
                    const daysInMonth = await getDaysInMonth(name, monthName);
                    db.run(`UPDATE logs SET daysInMonth = ? WHERE name = ? AND monthName = ?`, [daysInMonth, name, monthName]);
                    res.json({ id: this.lastID, name, action, timestamp, date, monthName, daysInMonth });
                });
            } else {
                return res.status(400).json({ message: "You need to log in before you can log out." });
            }
        }
    });
});

// Endpoint to display logs in a table format
app.get('/logs', (req, res) => {
    const sql = 'SELECT name, date, checkInTime, checkOutTime, workingHours, monthName, daysInMonth FROM logs ORDER BY checkInTime DESC';
    db.all(sql, [], (err, rows) => {
        if (err) {
            throw err;
        }

        // Generate HTML table
        let table = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Employee Logs</title>
            <style>
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
                table, th, td {
                    border: 1px solid black;
                }
                th, td {
                    padding: 8px;
                    text-align: left;
                }
                th {
                    background-color: #f2f2f2;
                }
            </style>
        </head>
        <body>
            <h1>Employee Logs</h1>
            <table>
                <tr>
                    <th>Name</th>
                    <th>Date</th>
                    <th>Check-In Time</th>
                    <th>Check-Out Time</th>
                    <th>Working Hours</th>
                    <th>Month</th>
                    <th>Days in Month</th>
                </tr>
        `;

        rows.forEach(row => {
            // Extract only the time part from the datetime string
            const checkInTime = row.checkInTime ? new Date(row.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const checkOutTime = row.checkOutTime ? new Date(row.checkOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const workingHours = row.workingHours ? row.workingHours.toFixed(2) : '';

            table += `
                <tr>
                    <td>${row.name}</td>
                    <td>${row.date}</td>
                    <td>${checkInTime}</td>
                    <td>${checkOutTime}</td>
                    <td>${workingHours}</td>
                    <td>${row.monthName}</td>
                    <td>${row.daysInMonth}</td>
                </tr>
            `;
        });

        table += `
            </table>
        </body>
        </html>
        `;

        res.send(table);
    });
});

// Endpoint to clear logs
app.post('/clear-logs', (req, res) => {
    const sql = 'DELETE FROM logs';
    db.run(sql, function(err) {
        if (err) {
            return console.log(err.message);
        }
        res.json({ message: 'Logs cleared successfully', changes: this.changes });
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});