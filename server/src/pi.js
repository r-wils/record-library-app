// Everything that reads or writes files on the Raspberry Pi, over SFTP.
//
// The library is a JSON list in <repo>/audio/library.json, in the same format
// as records.json of the record player, plus an "rfid" field per record:
//   { "rfid": "a1b2c3d4", "file": "audio/song.mp3", "artist": "...", "title": "...", "facts": [] }
//
// The audio/ folder is in .gitignore of the player repo, so the library and
// the songs never end up in git.

import path from 'node:path';
import SftpClient from 'ssh2-sftp-client';
import { config, paths } from './config.js';

// One connection per operation: simple and survives a rebooting Pi.
async function withSftp(work) {
  const sftp = new SftpClient();
  try {
    await sftp.connect(config.pi);
    return await work(sftp);
  } finally {
    await sftp.end().catch(() => {});
  }
}

// Writes are done one after the other, so two saves never mix up the file.
let queue = Promise.resolve();
function serial(work) {
  const result = queue.then(work, work);
  queue = result.catch(() => {});
  return result;
}

async function readJson(sftp, file) {
  if (!(await sftp.exists(file))) return null;
  const buffer = await sftp.get(file);
  return JSON.parse(buffer.toString('utf8'));
}

async function writeLibrary(sftp, records) {
  // Write to a temporary file first and then rename it, so the player
  // never reads a half-written library.
  const tmp = `${paths.library}.tmp`;
  await sftp.put(Buffer.from(JSON.stringify(records, null, 2) + '\n'), tmp);
  try {
    await sftp.posixRename(tmp, paths.library);
  } catch {
    if (await sftp.exists(paths.library)) await sftp.delete(paths.library);
    await sftp.rename(tmp, paths.library);
  }
}

// "My Song (live).mp3" -> "my-song-live.mp3"
function safeName(original) {
  const ext = path.extname(original).toLowerCase();
  const base = path.basename(original, path.extname(original))
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song';
  return { base, ext };
}

async function uniqueAudioPath(sftp, originalName) {
  const { base, ext } = safeName(originalName);
  let name = `${base}${ext}`;
  for (let i = 2; await sftp.exists(`${paths.audioDir}/${name}`); i++) {
    name = `${base}-${i}${ext}`;
  }
  return name;
}

// A file may only be deleted when no record (library or repo records.json) still uses it.
async function deleteFileIfUnused(sftp, file, library) {
  if (!file || !file.startsWith('audio/')) return;
  const repoRecords = (await readJson(sftp, paths.repoRecords).catch(() => null)) || [];
  const used = [...library, ...repoRecords].some((record) => record.file === file);
  const fullPath = `${config.repoDir}/${file}`;
  if (!used && (await sftp.exists(fullPath))) await sftp.delete(fullPath);
}

function cleanRecord(rfid, fields, file) {
  const fact = (fields.fact || '').trim();
  return {
    rfid,
    file,
    artist: (fields.artist || '').trim(),
    title: (fields.title || '').trim(),
    facts: fact ? [fact] : [],
  };
}

export function normalizeUid(uid) {
  return String(uid || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
}

// ---------- used by the API ----------

export async function checkPi() {
  return withSftp(async (sftp) => {
    if (!(await sftp.exists(config.repoDir))) {
      throw new Error(`folder ${config.repoDir} not found on the Pi (check PI_REPO_DIR)`);
    }
    return true;
  });
}

export async function getLibrary() {
  return withSftp(async (sftp) => (await readJson(sftp, paths.library)) || []);
}

export function addRecord(fields, upload) {
  return serial(() => withSftp(async (sftp) => {
    const rfid = normalizeUid(fields.rfid);
    const library = (await readJson(sftp, paths.library)) || [];
    if (library.some((record) => record.rfid === rfid)) {
      throw Object.assign(new Error('this RFID tag is already linked'), { status: 409 });
    }

    if (!(await sftp.exists(paths.audioDir))) await sftp.mkdir(paths.audioDir, true);
    const name = await uniqueAudioPath(sftp, upload.originalname);
    await sftp.put(upload.buffer, `${paths.audioDir}/${name}`);

    const record = cleanRecord(rfid, fields, `audio/${name}`);
    library.push(record);
    await writeLibrary(sftp, library);
    return record;
  }));
}

export function updateRecord(rfid, fields, upload) {
  return serial(() => withSftp(async (sftp) => {
    const library = (await readJson(sftp, paths.library)) || [];
    const index = library.findIndex((record) => record.rfid === rfid);
    if (index < 0) throw Object.assign(new Error('record not found'), { status: 404 });

    const oldFile = library[index].file;
    let file = oldFile;
    if (upload) {
      const name = await uniqueAudioPath(sftp, upload.originalname);
      await sftp.put(upload.buffer, `${paths.audioDir}/${name}`);
      file = `audio/${name}`;
    }

    library[index] = cleanRecord(rfid, fields, file);
    await writeLibrary(sftp, library);
    if (file !== oldFile) await deleteFileIfUnused(sftp, oldFile, library);
    return library[index];
  }));
}

export function deleteRecord(rfid) {
  return serial(() => withSftp(async (sftp) => {
    const library = (await readJson(sftp, paths.library)) || [];
    const record = library.find((item) => item.rfid === rfid);
    if (!record) throw Object.assign(new Error('record not found'), { status: 404 });

    const remaining = library.filter((item) => item.rfid !== rfid);
    await writeLibrary(sftp, remaining);
    await deleteFileIfUnused(sftp, record.file, remaining);
  }));
}
