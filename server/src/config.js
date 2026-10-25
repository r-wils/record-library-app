// All settings come from environment variables (.env, see .env.example).

import fs from 'node:fs';

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name} in .env (see .env.example)`);
    process.exit(1);
  }
  return value;
}

const keyFile = process.env.PI_KEY_FILE;

export const config = {
  port: Number(process.env.PORT || 3000),

  // SSH/SFTP connection to the Raspberry Pi
  pi: {
    host: required('PI_HOST'),
    port: Number(process.env.PI_SSH_PORT || 22),
    username: required('PI_USER'),
    password: process.env.PI_PASSWORD || undefined,
    privateKey: keyFile && fs.existsSync(keyFile) ? fs.readFileSync(keyFile) : undefined,
    readyTimeout: 8000,
  },

  // Repo folder on the Pi. A relative path starts in the Pi user's home folder.
  repoDir: (process.env.PI_REPO_DIR || 'iot-smart-record-player').replace(/\/+$/, ''),

  // MQTT broker on the Pi (Mosquitto), same broker the Pico uses
  mqttUrl: process.env.MQTT_URL || `mqtt://${process.env.PI_HOST}:${process.env.MQTT_PORT || 1883}`,
  rfidTopic: process.env.RFID_TOPIC || 'recordplayer/rfid',

  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 50),
};

export const paths = {
  audioDir: `${config.repoDir}/audio`,
  library: `${config.repoDir}/audio/library.json`,
  repoRecords: `${config.repoDir}/records.json`,
};

if (!config.pi.password && !config.pi.privateKey) {
  console.error('Set PI_PASSWORD or PI_KEY_FILE in .env');
  process.exit(1);
}
