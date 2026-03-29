const fs = require('fs');
const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// Läs .env utan externa beroenden
(function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx < 1) continue;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!(key in process.env)) process.env[key] = val;
    }
})();

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
const logFilePath = path.join(__dirname, 'data', 'highhand_log.csv');

// Start-data ifall filer är tomma eller inte finns
let currentHighHand = {};
let currentSettings = {};

// --- LOGG-FUNKTIONER ---

function escapeCsvField(field) {
    if (field === null || field === undefined) return '';
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

async function appendToLog(data) {
    try {
        const isReset = data.reset === true;
        const datetime = new Date().toISOString();
        const type = isReset ? 'reset' : 'hand';
        const participantCount = isReset ? '' : (data.participantCount ?? '');
        const handName = isReset ? '' : escapeCsvField(data.handName ?? '');
        const playerName = isReset ? '' : escapeCsvField(data.playerName ?? '');

        const cards = isReset ? ['', '', '', '', ''] : (data.cards ?? []).slice(0, 5).map(c => {
            if (!c || c.rank === 'N/A' || c.suit === 'N/A') return '';
            return `${c.rank}${c.suit}`;
        });
        while (cards.length < 5) cards.push('');

        const row = `${datetime},${type},${participantCount},${handName},${playerName},${cards.join(',')}\n`;

        if (!fs.existsSync(logFilePath)) {
            await fs.promises.writeFile(logFilePath, 'datetime,type,participantCount,handName,playerName,card1,card2,card3,card4,card5\n', 'utf8');
        }
        await fs.promises.appendFile(logFilePath, row, 'utf8');
    } catch (error) {
        console.error('Kunde inte skriva till loggfilen:', error);
    }
}

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

// --- VPK PUSH-FUNKTION ---

let vpkToken = null;

function httpRequest(method, urlStr, headers, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlStr);
        const isHttps = parsed.protocol === 'https:';
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method,
            headers
        };
        const req = (isHttps ? https : http).request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function authenticateVpk() {
    const body = JSON.stringify({ identity: process.env.VPK_PB_EMAIL, password: process.env.VPK_PB_PASSWORD });
    const res = await httpRequest('POST', `${process.env.VPK_PB_URL}/collections/users/auth-with-password`, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
    }, body);
    const json = JSON.parse(res.body);
    if (!json.token) throw new Error(`VPK auth failed: ${res.body}`);
    vpkToken = json.token;
}

async function pushToVpk(data) {
    try {
        const { VPK_PB_URL, VPK_PB_EMAIL, VPK_PB_PASSWORD, VPK_HIGH_HAND_RECORD_ID } = process.env;
        if (!VPK_PB_URL || !VPK_PB_EMAIL || !VPK_PB_PASSWORD || !VPK_HIGH_HAND_RECORD_ID) return;

        if (!vpkToken) await authenticateVpk();

        const payload = data.reset
            ? { reset: true, source_updated_at: new Date().toISOString() }
            : {
                player_name: data.playerName ?? '',
                hand_name: data.handName ?? '',
                cards: JSON.stringify(data.cards ?? []),
                participant_count: data.participantCount ?? 0,
                is_final_submit: data.isFinalSubmit ?? false,
                source_updated_at: new Date().toISOString(),
                reset: false
            };

        const body = JSON.stringify(payload);
        const patchUrl = `${VPK_PB_URL}/collections/high_hand/records/${VPK_HIGH_HAND_RECORD_ID}`;
        const res = await httpRequest('PATCH', patchUrl, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Authorization': `Bearer ${vpkToken}`
        }, body);

        if (res.status === 401) {
            // Token expired — re-authenticate once and retry
            vpkToken = null;
            await authenticateVpk();
            const res2 = await httpRequest('PATCH', patchUrl, {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'Authorization': `Bearer ${vpkToken}`
            }, body);
            if (res2.status < 200 || res2.status >= 300) {
                console.error(`VPK push misslyckades (${res2.status}): ${res2.body}`);
            }
        } else if (res.status < 200 || res.status >= 300) {
            console.error(`VPK push misslyckades (${res.status}): ${res.body}`);
        }
    } catch (err) {
        console.error('VPK push fel:', err.message);
    }
}

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


// API-endpoint för att hämta loggfilen
app.get('/api/log', (req, res) => {
    if (fs.existsSync(logFilePath)) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.sendFile(logFilePath);
    } else {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send('datetime,type,participantCount,handName,playerName\n');
    }
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
            if (data.isFinalSubmit || data.reset) await appendToLog(data); // Logga till CSV

            // Skicka den uppdaterade high-hand-datan till alla anslutna klienter
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'handUpdate', payload: currentHighHand }));
                }
            });

            // Pusha till VPK-appen (asynkront, blockerar inte)
            pushToVpk(data);
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

