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

// Add a map to store client types
const clientTypes = new Map();

// Sökväg till våra "databas"-filer
const dbFilePath = path.join(__dirname, 'data', 'db.json');
const playersDbPath = path.join(__dirname, 'data', 'players.json');
const settingsDbPath = path.join(__dirname, 'data', 'settings.json');

// Start-data ifall filer är tomma eller inte finns
let currentHighHand = {};
let currentSettings = {};

// --- DATABAS-FUNKTIONER ---

// Sparar den nuvarande datan till db.json
async function saveDataToFile() {
    try {
        await fs.promises.writeFile(dbFilePath, JSON.stringify(currentHighHand, null, 2), 'utf8');
        console.log('Data sparades till db.json');
    } catch (error) {
        console.error('Kunde inte spara till db.json:', error);
    }
}

// Läser data från db.json när servern startar
async function readDataFromFile() {
    try {
        if (fs.existsSync(dbFilePath)) {
            const data = await fs.promises.readFile(dbFilePath, 'utf8');
            currentHighHand = JSON.parse(data);
        } else {
            // Skapa en standard high-hand om filen inte finns
            currentHighHand = { playerName: "VÄSTANFORS POKER KLUBB", participantCount: 0, cards: Array(5).fill({ rank: "N/A", suit: "N/A" }), backgroundImage: "/images/backgrounds/room.jpg", updatedAt: new Date().toISOString() };
            await saveDataToFile();
        }
    } catch (error) {
        console.error('Kunde inte läsa från db.json:', error);
    }
}

// --- SETTINGS-FUNKTIONER ---
async function readSettingsFromFile() {
    try {
        if (fs.existsSync(settingsDbPath)) {
            const data = await fs.promises.readFile(settingsDbPath, 'utf8');
            currentSettings = JSON.parse(data);
            // Ensure structure is correct
            if (!currentSettings.large || !currentSettings.small) {
                throw new Error('Invalid settings format');
            }
        } else {
            // Default settings for both large and small screens
            currentSettings = {
                large: { titleFontSize: 6, participantCountFontSize: 4, handNameFontSize: 5, playerNameFontSize: 6, cardSize: 18 },
                small: { titleFontSize: 4, participantCountFontSize: 3, handNameFontSize: 4, playerNameFontSize: 5, cardSize: 15 }
            };
            await saveSettingsToFile();
        }
    } catch (error) {
        console.error('Kunde inte läsa från settings.json, återställer till standard:', error);
        // Fallback to default if file is corrupt or has wrong format
        currentSettings = {
            large: { titleFontSize: 6, participantCountFontSize: 4, handNameFontSize: 5, playerNameFontSize: 6, cardSize: 18 },
            small: { titleFontSize: 4, participantCountFontSize: 3, handNameFontSize: 4, playerNameFontSize: 5, cardSize: 15 }
        };
        await saveSettingsToFile();
    }
}

async function saveSettingsToFile() {
    try {
        await fs.promises.writeFile(settingsDbPath, JSON.stringify(currentSettings, null, 2), 'utf8');
    } catch (error) {
        console.error('Kunde inte spara till settings.json:', error);
    }
}


// --- PLAYER-FUNKTIONER ---

// Läser spelare från players.json
async function readPlayersFromFile() {
    try {
        if (fs.existsSync(playersDbPath)) {
            const data = await fs.promises.readFile(playersDbPath, 'utf8');
            return JSON.parse(data);
        }
        return []; // Returnera en tom array om filen inte finns
    } catch (error) {
        console.error('Kunde inte läsa från players.json:', error);
        return [];
    }
}

// Sparar spelare till players.json
async function savePlayersToFile(players) {
    try {
        await fs.promises.writeFile(playersDbPath, JSON.stringify(players, null, 2), 'utf8');
    } catch (error) {
        console.error('Kunde inte spara till players.json:', error);
    }
}

// Läs in datan när servern startar
(async () => {
    await readDataFromFile();
    await readSettingsFromFile();
})();

// --- WEBSERVER & API ---

// Serverar statiska filer från 'public'-mappen
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- API Endpoint to get the current state ---
app.get('/api/state', (req, res) => {
    // Use the correct variable 'dbFilePath'
    fs.readFile(dbFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading database file for state:', err);
            return res.status(500).json({ error: 'Could not read database file.' });
        }
        try {
            const db = JSON.parse(data);
            // The db.json file contains the high hand object directly.
            res.json(db || {});
        } catch (parseErr) {
            console.error('Error parsing database file for state:', parseErr);
            res.status(500).json({ error: 'Could not parse database file.' });
        }
    });
});

// API-endpoint för att hämta listan på spelare
app.get('/api/players', async (req, res) => {
    const players = await readPlayersFromFile();
    res.json(players);
});

// API-endpoint för att lägga till en ny spelare
app.post('/api/players', async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ message: 'Spelarnamn saknas eller är ogiltigt.' });
    }

    const trimmedName = name.trim();
    const players = await readPlayersFromFile();

    // Kontrollera om spelaren redan finns (skiftlägesokänsligt)
    if (!players.some(p => p.toLowerCase() === trimmedName.toLowerCase())) {
        players.push(trimmedName);
        await savePlayersToFile(players);
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
app.post('/api/settings/:type', async (req, res) => {
    const { type } = req.params; // 'large' or 'small'
    const newSettings = req.body;

    if (type !== 'large' && type !== 'small') {
        return res.status(400).json({ message: 'Invalid settings type' });
    }

    // Validering och sanering kan läggas till här
    currentSettings[type] = { ...currentSettings[type], ...newSettings };
    await saveSettingsToFile();

    // Skicka uppdaterade inställningar till relevanta display-klienter
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && clientTypes.get(client) === type) {
            client.send(JSON.stringify({ type: 'settingsUpdate', payload: currentSettings[type] }));
        }
    });

    res.status(200).json({ message: `Inställningar för ${type} uppdaterade`, settings: currentSettings[type] });
});


// API-endpoint för att hämta listan på bakgrundsbilder
app.get('/api/backgrounds', async (req, res) => {
    const backgroundsPath = path.join(__dirname, 'public/images/backgrounds');
    try {
        if (fs.existsSync(backgroundsPath)) {
            const files = await fs.promises.readdir(backgroundsPath);
            const jpgFiles = files.filter(file => file.toLowerCase().endsWith('.jpg'));
            res.json(jpgFiles);
        } else {
            // Skapa mappen om den inte finns
            await fs.promises.mkdir(backgroundsPath, { recursive: true });
            res.json([]);
        }
    } catch (error) {
        console.error("Fel vid läsning av bakgrundsmappen:", error);
        res.status(500).json({ error: "Internt serverfel" });
    }
});


// --- WEBSOCKET-SERVER ---
wss.on('connection', (ws) => {
    // console.log('En klient kopplade upp sig.');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            // Handle client type registration
            if (data.type === 'register') {
                const clientType = data.payload.screenType; // 'large' or 'small'
                if (clientType === 'large' || clientType === 'small') {
                    clientTypes.set(ws, clientType);
                    // console.log(`Klient registrerad som: ${clientType}`);
                    
                    // Send initial state for that type
                    const initialState = {
                        type: 'initialState',
                        payload: {
                            highHand: currentHighHand,
                            settings: currentSettings[clientType]
                        }
                    };
                    ws.send(JSON.stringify(initialState));
                }
                return; // Stop processing after registration
            }

            // Uppdatera currentHighHand med den nya datan från admin
            currentHighHand = data;
            await saveDataToFile(); // Spara till db.json

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
        // console.log('En klient kopplade från.');
        clientTypes.delete(ws); // Clean up client type on disconnect
    });
});

// Starta servern
server.listen(port, '0.0.0.0', () => {
//   console.log(`Servern körs på http://<din-lokala-ip>:${port}`);
});

