const fs = require('fs');
const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const http = require('http');

const app = express();
const port = 80;

app.use(express.json()); // Middleware to parse JSON bodies

const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

// Sökväg till våra "databas"-filer
const dbFilePath = path.join(__dirname, 'data', 'db.json');
const playersDbPath = path.join(__dirname, 'data', 'players.json');
const settingsDbPath = path.join(__dirname, 'data', 'settings.json');

// Start-data ifall filer är tomma eller inte finns
let currentHighHand = {};
let currentSettings = {};

// --- DATABAS-FUNKTIONER ---

// Sparar den nuvarande datan till db.json
function saveDataToFile() {
    try {
        fs.writeFileSync(dbFilePath, JSON.stringify(currentHighHand, null, 2), 'utf8');
        console.log('Data sparades till db.json');
    } catch (error) {
        console.error('Kunde inte spara till db.json:', error);
    }
}

// Läser data från db.json när servern startar
function readDataFromFile() {
    try {
        if (fs.existsSync(dbFilePath)) {
            const data = fs.readFileSync(dbFilePath, 'utf8');
            currentHighHand = JSON.parse(data);
        } else {
            // Skapa en standard high-hand om filen inte finns
            currentHighHand = { playerName: "VÄSTANFORS POKER KLUBB", participantCount: 0, cards: Array(5).fill({ rank: "N/A", suit: "N/A" }), backgroundImage: "/images/backgrounds/room.jpg", updatedAt: new Date().toISOString() };
            saveDataToFile();
        }
    } catch (error) {
        console.error('Kunde inte läsa från db.json:', error);
    }
}

// --- SETTINGS-FUNKTIONER ---
function readSettingsFromFile() {
    try {
        if (fs.existsSync(settingsDbPath)) {
            const data = fs.readFileSync(settingsDbPath, 'utf8');
            currentSettings = JSON.parse(data);
        } else {
            currentSettings = { titleFontSize: 6, participantCountFontSize: 4, handNameFontSize: 5, playerNameFontSize: 6, cardSize: 18 };
            saveSettingsToFile();
        }
    } catch (error) {
        console.error('Kunde inte läsa från settings.json:', error);
    }
}

function saveSettingsToFile() {
    try {
        fs.writeFileSync(settingsDbPath, JSON.stringify(currentSettings, null, 2), 'utf8');
    } catch (error) {
        console.error('Kunde inte spara till settings.json:', error);
    }
}


// --- PLAYER-FUNKTIONER ---

// Läser spelare från players.json
function readPlayersFromFile() {
    try {
        if (fs.existsSync(playersDbPath)) {
            const data = fs.readFileSync(playersDbPath, 'utf8');
            return JSON.parse(data);
        }
        return []; // Returnera en tom array om filen inte finns
    } catch (error) {
        console.error('Kunde inte läsa från players.json:', error);
        return [];
    }
}

// Sparar spelare till players.json
function savePlayersToFile(players) {
    try {
        fs.writeFileSync(playersDbPath, JSON.stringify(players, null, 2), 'utf8');
    } catch (error) {
        console.error('Kunde inte spara till players.json:', error);
    }
}

// Läs in datan när servern startar
readDataFromFile();
readSettingsFromFile();

// --- WEBSERVER & API ---

// Serverar statiska filer från 'public'-mappen
app.use(express.static(path.join(__dirname, 'public')));

// API-endpoint för att hämta listan på spelare
app.get('/api/players', (req, res) => {
    const players = readPlayersFromFile();
    res.json(players);
});

// API-endpoint för att lägga till en ny spelare
app.post('/api/players', (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ message: 'Spelarnamn saknas eller är ogiltigt.' });
    }

    const trimmedName = name.trim();
    const players = readPlayersFromFile();

    // Kontrollera om spelaren redan finns (skiftlägesokänsligt)
    if (!players.some(p => p.toLowerCase() === trimmedName.toLowerCase())) {
        players.push(trimmedName);
        savePlayersToFile(players);
        console.log(`Spelare tillagd: ${trimmedName}`);
        res.status(201).json({ message: 'Spelare tillagd', name: trimmedName });
    } else {
        res.status(200).json({ message: 'Spelare finns redan' });
    }
});

// API-endpoint för att hämta inställningar
app.get('/api/settings', (req, res) => {
    res.json(currentSettings);
});

// API-endpoint för att uppdatera inställningar
app.post('/api/settings', (req, res) => {
    const newSettings = req.body;
    // Validering och sanering kan läggas till här
    currentSettings = { ...currentSettings, ...newSettings };
    saveSettingsToFile();

    // Skicka uppdaterade inställningar till alla anslutna display-klienter
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'settingsUpdate', payload: currentSettings }));
        }
    });

    res.status(200).json({ message: 'Inställningar uppdaterade', settings: currentSettings });
});


// API-endpoint för att hämta listan på bakgrundsbilder
app.get('/api/backgrounds', (req, res) => {
    const backgroundsPath = path.join(__dirname, 'public/images/backgrounds');
    try {
        if (fs.existsSync(backgroundsPath)) {
            const files = fs.readdirSync(backgroundsPath);
            const jpgFiles = files.filter(file => file.toLowerCase().endsWith('.jpg'));
            res.json(jpgFiles);
        } else {
            // Skapa mappen om den inte finns
            fs.mkdirSync(backgroundsPath, { recursive: true });
            res.json([]);
        }
    } catch (error) {
        console.error("Fel vid läsning av bakgrundsmappen:", error);
        res.status(500).json({ error: "Internt serverfel" });
    }
});


// --- WEBSOCKET-SERVER ---
wss.on('connection', (ws) => {
    console.log('En klient kopplade upp sig.');
    // Skicka aktuell status (både high hand och inställningar) till den nya klienten
    const initialState = {
        type: 'initialState',
        payload: {
            highHand: currentHighHand,
            settings: currentSettings
        }
    };
    ws.send(JSON.stringify(initialState));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // Uppdatera currentHighHand med den nya datan
            currentHighHand = data;
            saveDataToFile(); // Spara till db.json

            // Skicka den uppdaterade high-hand-datan till alla anslutna klienter
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'handUpdate', payload: currentHighHand }));
                }
            });
        } catch (error) {
            console.error('Fel vid hantering av meddelande:', error);
        }
    });

    ws.on('close', () => {
        console.log('En klient kopplade från.');
    });
});

// Starta servern
server.listen(port, '0.0.0.0', () => {
  console.log(`Servern körs på http://<din-lokala-ip>:${port}`);
});

