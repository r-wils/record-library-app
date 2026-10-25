import { HttpClient, HttpEvent, HttpEventType } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, map } from 'rxjs';

export interface PlayerRecord {
  rfid: string;
  file: string;
  artist: string;
  title: string;
  facts: string[];
}

export interface Status {
  pi: { ok: boolean; error?: string };
  mqtt: boolean;
  host: string;
  lastScan: Scan | null;
}

export interface Scan {
  uid: string;
  at: string;
}

export interface RecordForm {
  rfid: string;
  artist: string;
  title: string;
  fact: string;
  file: File | null;
}

// Upload progress in % while saving, then the saved record.
export type SaveEvent = { progress: number } | { record: PlayerRecord };

@Injectable({ providedIn: 'root' })
export class LibraryService {
  private http = inject(HttpClient);

  // Filled by the live connection to the backend (Server-Sent Events)
  readonly mqttConnected = signal(false);
  readonly lastScan = signal<Scan | null>(null);

  constructor() {
    const events = new EventSource('/api/events');
    events.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === 'status') this.mqttConnected.set(event.mqtt);
      if (event.type === 'rfid') this.lastScan.set({ uid: event.uid, at: event.at });
    };
    events.onerror = () => this.mqttConnected.set(false);
  }

  getStatus(): Observable<Status> {
    return this.http.get<Status>('/api/status');
  }

  getRecords(): Observable<PlayerRecord[]> {
    return this.http.get<PlayerRecord[]>('/api/records');
  }

  save(form: RecordForm, existing: boolean): Observable<SaveEvent> {
    const body = new FormData();
    body.append('rfid', form.rfid);
    body.append('artist', form.artist);
    body.append('title', form.title);
    body.append('fact', form.fact);
    if (form.file) body.append('file', form.file);

    const request = existing
      ? this.http.put<PlayerRecord>(`/api/records/${form.rfid}`, body, { reportProgress: true, observe: 'events' })
      : this.http.post<PlayerRecord>('/api/records', body, { reportProgress: true, observe: 'events' });

    return request.pipe(map((event: HttpEvent<PlayerRecord>) => {
      if (event.type === HttpEventType.UploadProgress) {
        return { progress: Math.round((100 * event.loaded) / (event.total || event.loaded || 1)) };
      }
      if (event.type === HttpEventType.Response) return { record: event.body as PlayerRecord };
      return { progress: 0 };
    }));
  }

  delete(rfid: string): Observable<void> {
    return this.http.delete<void>(`/api/records/${rfid}`);
  }
}
