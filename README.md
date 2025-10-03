### Steg 1: Skapa LXC-containern

1. **Ladda ner en mall:**
- I ditt Proxmox-gränssnitt, gå till din lokala lagring (oftast `local (pve)`).
- Välj "CT Templates" och klicka på "Templates".
- Sök efter och ladda ner en mall för **Debian** eller **Ubuntu**. `debian-12-standard` är ett utmärkt och lättviktigt val.

2. **Skapa containern:**
- Klicka på "Create CT" uppe i högra hörnet.
- **General:** Ge den ett Hostname (t.ex. `high-hand-server`) och ange ett lösenord för `root`-användaren.
- **Template:** Välj den Debian/Ubuntu-mall du just laddade ner.
- **Disks:** 8 GB är mer än tillräckligt för detta projekt.
- **CPU:** 1 kärna räcker gott och väl.
- **Memory:** 512 MB RAM är en bra startpunkt.
- **Network:** Välj antingen DHCP för att få en IP-adress automatiskt från din router (enklast) eller konfigurera en statisk IP om du föredrar det.
- **DNS:** Låt stå som standard.
- **Confirm:** Granska och slutför skapandet.

3. **Starta containern:**
- Hitta din nya container i listan till vänster, välj den och klicka på "Start".
___
### Steg 2: Grundläggande Konfiguration

1. **Öppna konsolen:**
- Med din container vald, klicka på ">_ Console" för att öppna en terminal.

2. **Logga in:**
- Användarnamn: `root`
- Lösenord: Det du valde när du skapade containern.

3. **Uppdatera systemet:**
- Kör följande kommandon för att se till att allt är uppdaterat:
```
apt update
apt upgrade -y
```
___
### Steg 3: Installera Node.js

Vi installerar en modern LTS-version (Long Term Support) av Node.js.

1. **Installera `curl` (om det inte redan finns):**
```
apt install curl -y
```

2. **Ladda ner och kör installationsskriptet för Node.js 18.x:**
```
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
```

3. **Installera Node.js och npm:**
```
apt install -y nodejs
```

4. **Verifiera installationen:**
- Kontrollera att du får tillbaka versionsnummer när du kör:
```
node -v
npm -v
```
___
### Steg 4: Överför applikationsfilerna

Du behöver kopiera `high-hand-app`-mappen från din dator till LXC-containern.
(För Windows-användare: Ett program som_ [_WinSCP_](https://winscp.net/ "null") kan användas för att göra detta via ett grafiskt gränssnitt).
___
### Steg 5: Kör Applikationen och gör den permanent

Nu finns filerna i `/root/high-hand-app/` i din container.
Vi ska nu installera appens beroenden och starta den med en processhanterare som ser till att den alltid körs.

1. **Gå till mappen i LXC-konsolen:**
```
cd /root/high-hand-app/
```

2. **Installera appens beroenden:**
```
npm install
```

3. **Installera PM2 (en processhanterare för Node.js):**
 - Vi installerar den globalt så den kan användas överallt.
```
npm install pm2 -g
```

4. **Starta servern med PM2:**
- Detta startar servern och ser till att den startas om automatiskt om den skulle krascha.
```
pm2 start server.js --name "high-hand-server"
```

5. **Sätt upp PM2 att starta vid omstart av containern:**
- Kör följande kommando:
```
pm2 startup
```
- Spara den nuvarande processlistan så den återställs vid omstart:
```
pm2 save
```
___
### Klart!

Servern är nu igång och kommer att starta automatiskt varje gång din LXC-container startar.
Du kan kontrollera statusen för din app när som helst med kommandot `pm2 status`.

Du når nu din applikation på:

- **Display-sidan:** `http://<LXC_IP_ADRESS>:3000/display.html`
- **Admin-sidan:** `http://<LXC_IP_ADRESS>:3000/admin.html`