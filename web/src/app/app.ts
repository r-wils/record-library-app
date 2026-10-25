import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { LibraryService, PlayerRecord, RecordForm, Status } from './library.service';

const EMPTY_FORM: RecordForm = { rfid: '', artist: '', title: '', fact: '', file: null };

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private library = inject(LibraryService);

  protected readonly status = signal<Status | null>(null);
  protected readonly records = signal<PlayerRecord[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly notice = signal('');

  // Form state: null = closed, 'new' = new mini record, 'edit' = existing record
  protected readonly mode = signal<'new' | 'edit' | null>(null);
  protected readonly form = signal<RecordForm>({ ...EMPTY_FORM });
  protected readonly progress = signal<number | null>(null);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly mqttConnected = this.library.mqttConnected;
  protected readonly lastScan = this.library.lastScan;

  // The record that belongs to the last scanned tag, if it is already linked
  protected readonly scannedRecord = computed(() => {
    const scan = this.lastScan();
    return scan ? this.records().find((record) => record.rfid === scan.uid) ?? null : null;
  });

  // A scan only updates "Laatst gescand"; the form opens with its buttons.
  constructor() {
    this.refresh();
  }

  private clearFileInput(): void {
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
  }

  protected refresh(): void {
    this.loading.set(true);
    this.library.getStatus().subscribe({
      next: (status) => {
        this.status.set(status);
        // Show a scan from before the page was opened.
        if (status.lastScan && !this.lastScan()) this.lastScan.set(status.lastScan);
      },
      error: (error) => this.showError(error),
    });
    this.library.getRecords().subscribe({
      next: (records) => {
        this.records.set(records);
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        this.showError(error);
      },
    });
  }

  protected startNew(rfid = ''): void {
    this.form.set({ ...EMPTY_FORM, rfid });
    this.clearFileInput();
    this.mode.set('new');
    this.notice.set('');
  }

  protected edit(record: PlayerRecord): void {
    this.form.set({
      rfid: record.rfid,
      artist: record.artist,
      title: record.title,
      fact: record.facts[0] ?? '',
      file: null,
    });
    this.clearFileInput();
    this.mode.set('edit');
    this.notice.set('');
  }

  protected cancel(): void {
    this.mode.set(null);
    this.progress.set(null);
  }

  protected setField(field: 'rfid' | 'artist' | 'title' | 'fact', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.form.update((form) => ({ ...form, [field]: value }));
  }

  protected setFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.form.update((form) => {
      // Fill in the title from the file name when it is still empty.
      const title = form.title || (file ? file.name.replace(/\.[^.]+$/, '') : '');
      return { ...form, file, title };
    });
  }

  protected save(): void {
    const editing = this.mode() === 'edit';
    this.error.set('');
    this.progress.set(0);

    this.library.save(this.form(), editing).subscribe({
      next: (event) => {
        if ('progress' in event) {
          this.progress.set(event.progress);
          return;
        }
        this.notice.set(`Opgeslagen op de Pi: ${event.record.artist} - ${event.record.title}`);
        this.mode.set(null);
        this.progress.set(null);
        this.refresh();
      },
      error: (error) => {
        this.progress.set(null);
        this.showError(error);
      },
    });
  }

  protected remove(record: PlayerRecord): void {
    if (!window.confirm(`"${record.artist} - ${record.title}" verwijderen van de Pi?`)) return;
    this.library.delete(record.rfid).subscribe({
      next: () => {
        this.notice.set(`Verwijderd: ${record.artist} - ${record.title}`);
        if (this.form().rfid === record.rfid) this.cancel();
        this.refresh();
      },
      error: (error) => this.showError(error),
    });
  }

  protected fileName(path: string): string {
    return path.split('/').pop() ?? path;
  }

  private showError(error: HttpErrorResponse): void {
    this.error.set(error.error?.error ?? error.message);
  }
}
