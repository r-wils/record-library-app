// Record Library: link RFID mini records to audio files on the Smart Record Player.
//
// Runs on a laptop/PC in the same network as the Pi. It only talks to the Pi
// while it runs; afterwards the Pi works on its own with audio/library.json.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { config } from './config.js';
import { addRecord, checkPi, deleteRecord, getLibrary, normalizeUid, updateRecord } from './pi.js';
import { onEvent, rfidState, startRfidListener } from './rfid.js';

const AUDIO_TYPES = ['.mp3', '.ogg', '.wav', '.flac'];

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  fileFilter: (req, file, done) => {
    const ok = AUDIO_TYPES.includes(path.extname(file.originalname).toLowerCase());
    done(ok ? null : Object.assign(new Error(`only ${AUDIO_TYPES.join(', ')} files`), { status: 400 }), ok);
  },
});

function validate(fields, { needUid }) {
  if (needUid && normalizeUid(fields.rfid).length < 8) return 'RFID code is missing or too short';
  if (!fields.artist?.trim()) return 'artist is required';
  if (!fields.title?.trim()) return 'title is required';
  return null;
}

// ---------- API ----------

app.get('/api/status', async (req, res) => {
  let pi = { ok: true };
  try {
    await checkPi();
  } catch (error) {
    pi = { ok: false, error: error.message };
  }
  res.json({ pi, mqtt: rfidState.connected, lastScan: rfidState.lastScan, host: config.pi.host });
});

app.get('/api/records', async (req, res) => {
  res.json(await getLibrary());
});

app.post('/api/records', upload.single('file'), async (req, res) => {
  const problem = validate(req.body, { needUid: true }) || (!req.file && 'choose an audio file');
  if (problem) return res.status(400).json({ error: problem });
  res.status(201).json(await addRecord(req.body, req.file));
});

app.put('/api/records/:rfid', upload.single('file'), async (req, res) => {
  const problem = validate(req.body, { needUid: false });
  if (problem) return res.status(400).json({ error: problem });
  res.json(await updateRecord(req.params.rfid, req.body, req.file));
});

app.delete('/api/records/:rfid', async (req, res) => {
  await deleteRecord(req.params.rfid);
  res.status(204).end();
});

// Live RFID scans and MQTT status for the browser (Server-Sent Events).
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ type: 'status', mqtt: rfidState.connected });
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
  const stop = onEvent(send);
  req.on('close', () => {
    clearInterval(keepAlive);
    stop();
  });
});

// Errors (Pi unreachable, upload too large, ...) as JSON for the frontend.
app.use((error, req, res, next) => {
  const status = error.status || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 502);
  console.log(`[api] ${req.method} ${req.path}: ${error.message}`);
  res.status(status).json({ error: error.message });
});

// ---------- Angular frontend ----------

const webDir = process.env.WEB_DIR
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist/web/browser');
app.use(express.static(webDir));
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(webDir, 'index.html')));

startRfidListener();
app.listen(config.port, () => {
  console.log(`Record Library running on http://localhost:${config.port} (Pi: ${config.pi.host})`);
});
