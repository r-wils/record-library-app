// Listens on the Pi's MQTT broker for RFID tags sent by the Pico.
// Every scan is passed on to the browser (Server-Sent Events, see index.js).

import mqtt from 'mqtt';
import { config } from './config.js';
import { normalizeUid } from './pi.js';

const listeners = new Set();

export const rfidState = {
  connected: false,
  lastScan: null,   // { uid, at }
};

function notify(event) {
  for (const send of listeners) send(event);
}

export function onEvent(send) {
  listeners.add(send);
  return () => listeners.delete(send);
}

export function startRfidListener() {
  const client = mqtt.connect(config.mqttUrl, {
    clientId: `record-library-app-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 3000,
    connectTimeout: 5000,
  });

  client.on('connect', () => {
    console.log(`[mqtt] connected to ${config.mqttUrl}`);
    rfidState.connected = true;
    client.subscribe(config.rfidTopic);
    notify({ type: 'status', mqtt: true });
  });

  client.on('close', () => {
    if (rfidState.connected) console.log('[mqtt] disconnected');
    rfidState.connected = false;
    notify({ type: 'status', mqtt: false });
  });

  client.on('error', (error) => console.log(`[mqtt] ${error.message}`));

  client.on('message', (topic, payload) => {
    const uid = normalizeUid(payload.toString());
    if (!uid) return;
    console.log(`[mqtt] RFID ${uid}`);
    rfidState.lastScan = { uid, at: new Date().toISOString() };
    notify({ type: 'rfid', ...rfidState.lastScan });
  });

  return client;
}
