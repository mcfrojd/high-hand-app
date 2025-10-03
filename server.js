const fs = require('fs');
const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const http = require('http');

const app = express();
const port = 3000;

app.use(express.json()); // Middleware to parse JSON bodies

const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

// Sökväg till våra "databas"-filer
const dbFilePath = path.join(__dirname, 'data', 'db.json');
const playersDbPath = path.join(__dirname, 'data', 'players.json');

// Start-data ifall db.json är tom eller inte finns
let currentHighHand = {
    playerName: '',
    cards: [],
    backgroundImage: '',
    participantCount: 0
};

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
            const parsedData = JSON.parse(data);
            // Slå ihop standardvärden med den sparade datan
            currentHighHand = { ...currentHighHand, ...parsedData };
            console.log('Data laddades från db.json:', currentHighHand);
        }
    } catch (error) {
        console.error('Kunde inte läsa från db.json:', error);
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


// --- WEBSOCKET-LOGIK ---

wss.on('connection', (ws) => {
    console.log('En ny klient anslöt.');

    // Skicka den nuvarande sparade handen till den nya klienten
    if (currentHighHand) {
        ws.send(JSON.stringify(currentHighHand));
    }

    // Hantera meddelanden från klienter (admin-panelen)
    ws.on('message', (message) => {
        console.log('Tog emot meddelande -> %s', message);
        
        try {
            const highHandData = JSON.parse(message);
            
            // Spara den nya datan i minnet
            currentHighHand = highHandData;
            
            // Spara den nya datan till filen
            saveDataToFile();

            // Skicka ut (broadcast) den uppdaterade datan till ALLA anslutna klienter
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(currentHighHand));
                }
            });
        } catch (error) {
            console.error('Kunde inte tolka meddelandet som JSON:', error);
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

