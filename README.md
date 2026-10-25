# Record Library

Koppel RFID-plaatjes aan muziek op de **Smart Record Player**
([iot-smart-record-player](https://github.com/maarten-wils/iot-smart-record-player)).

De app draait in Docker op een laptop of pc in hetzelfde netwerk als de Pi.
Je hebt hem alleen nodig om plaatjes toe te voegen of aan te passen: alles wordt
op de Pi bewaard, en daarna werkt de speler volledig zonder de app.

## Hoe het werkt

```
 laptop (Docker)                        Raspberry Pi 5                 Pico 2 W
 ┌──────────────────────┐   SFTP   ┌──────────────────────────┐        ┌────────┐
 │ Angular  ── Express ─┼─────────▶│ audio/*.mp3              │        │ RC522  │
 │                      │          │ audio/library.json       │        │ RFID   │
 │                      │   MQTT   │ Mosquitto ◀──────────────┼────────┤        │
 │       live tags ◀────┼──────────┤ record_player.py         │  MQTT  └────────┘
 └──────────────────────┘          └──────────────────────────┘
```

1. Leg een plaatje op de lezer, met de arm op de rust. De Pico stuurt de RFID-code
   over MQTT, de app toont ze meteen.
2. Een nieuwe code opent vanzelf het formulier: kies een audiobestand op je laptop
   en vul artiest en titel in.
3. **Opslaan op de Pi** kopieert het bestand via SSH naar `audio/` op de Pi en
   werkt `audio/library.json` bij.
4. De speler merkt binnen 2 seconden dat de lijst veranderd is. Leg het plaatje
   opnieuw op en het speelt, zonder herstart.

`audio/` staat in de `.gitignore` van de speler-repo, dus je muziek en je
bibliotheek komen nooit in git. Zolang `library.json` leeg is of niet bestaat,
speelt de Pi gewoon de platen uit `records.json`.

## Wat je nodig hebt

- Docker Desktop (of Docker + Compose) op je laptop.
- Een Pi met SSH aan, Mosquitto (draait al voor de Pico) en de speler-repo met
  RFID-ondersteuning (de `library.json`-aanpassing in `record_player.py`).
- Laptop en Pi op hetzelfde netwerk.

## Starten

```bash
git clone https://github.com/r-wils/record-library-app.git
cd record-library-app
cp .env.example .env      # vul PI_HOST, PI_USER en PI_PASSWORD in
docker compose up --build
```

Open daarna **http://localhost:3000**. Stoppen: `Ctrl+C` (of `docker compose down`).

Tips:

- Gebruik bij `PI_HOST` liefst het IP-adres van de Pi (bv. `192.168.1.42`).
  Namen zoals `raspberrypi.local` werken niet altijd vanuit een Docker-container.
- `PI_USER` is de gebruiker die eigenaar is van de speler-repo op de Pi.
- Liever een SSH-sleutel dan een wachtwoord? Zet `PI_KEY_FILE=/ssh/id_ed25519` in
  `.env` en haal de `volumes`-regels in `docker-compose.yml` uit commentaar.

## Testen zonder Pico

`tools/pi_rfid_bridge.py` leest tags met een RC522 die rechtstreeks op de Pi
zit en stuurt ze over MQTT door, net zoals de Pico. Een sticker geeft dezelfde
code als op de Pico, dus koppelingen blijven later geldig. Bedrading en uitleg
staan bovenaan in het script. Zonder lezer kan het ook met een nep-scan op de Pi:

```bash
mosquitto_pub -h localhost -t recordplayer/rfid -m a1b2c3d4
```

## Formaat van `library.json`

Hetzelfde als `records.json` van de speler, met een `rfid`-veld erbij:

```json
[
  {
    "rfid": "a1b2c3d4",
    "file": "audio/one-more-time.mp3",
    "artist": "Daft Punk",
    "title": "One More Time",
    "facts": ["optioneel weetje, gebruikt als de AI niet werkt"]
  }
]
```

Ondersteunde bestanden: `.mp3`, `.ogg`, `.wav`, `.flac` (max. 50 MB per bestand).

## Zonder Docker ontwikkelen

```bash
cd server && npm install && npm run dev        # API op :3000, leest ../.env
cd web && npm install && npx ng build --watch  # frontend in web/dist, geserveerd door de API
```

## Opbouw

```
server/src/index.js   Express: REST-API, live tags (Server-Sent Events), serveert de frontend
server/src/pi.js      alles wat via SFTP op de Pi leest/schrijft (library.json, audio)
server/src/rfid.js    luistert op MQTT naar recordplayer/rfid
server/src/config.js  instellingen uit .env
web/src/app/          Angular (standalone component + signals)
```

| Methode | Pad | Wat |
| --- | --- | --- |
| GET | `/api/status` | Pi en MQTT bereikbaar? laatste scan |
| GET | `/api/records` | alle plaatjes op de Pi |
| POST | `/api/records` | nieuw plaatje (multipart: `rfid`, `artist`, `title`, `fact`, `file`) |
| PUT | `/api/records/:rfid` | plaatje aanpassen (`file` optioneel) |
| DELETE | `/api/records/:rfid` | plaatje en zijn audiobestand verwijderen |
| GET | `/api/events` | live RFID-scans (Server-Sent Events) |

Een audiobestand wordt alleen verwijderd als geen enkel ander plaatje en geen
record in `records.json` het nog gebruikt.
