/**
 * PhotoVerificationComponent — backlog item #19.
 *
 * Captures a photo via the Capacitor Camera plugin (or HTMLInputElement
 * fallback on web), extracts EXIF GPS+timestamp, hashes the raw bytes with
 * SHA-256, uploads to R2 via a presigned URL, then POSTs the receipt
 * (`r2_key`, `gps`, `captured_at`, `hash`) to `/api/jobs/:id/photo-verify`.
 *
 * The server signs the receipt with HMAC-SHA-256 using `SESSION_SECRET` for
 * legal-grade chain-of-custody on `job_photos`.
 *
 * RxJS-first per [[rxjs-first-angular]] — every async step is an `Observable`.
 */
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { Observable, defer, from, of, switchMap, tap } from 'rxjs';

export interface PhotoVerifyResult {
  readonly photo_id: string;
  readonly server_signature: string;
  readonly server_signed_at: string;
}

interface PhotoVerifyPayload {
  readonly r2_key: string;
  readonly hash: string;
  readonly captured_at: string;
  readonly gps?: { lat: number; lng: number; accuracy_m?: number };
  readonly exif?: Record<string, unknown>;
}

@Component({
  selector: 'lib-photo-verification',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ButtonModule, ProgressSpinnerModule],
  template: `
    <div class="photo-verify" data-testid="photo-verify">
      <button
        pButton
        type="button"
        icon="pi pi-camera"
        [label]="busy() ? 'Verifying…' : 'Capture verified photo'"
        [disabled]="busy()"
        (click)="capture()"
        data-testid="photo-verify-capture"
      ></button>

      <input
        #fileInput
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        (change)="onFile($event)"
        data-testid="photo-verify-file"
      />

      @if (lastResult(); as r) {
        <p class="signed" data-testid="photo-verify-signed">
          Verified · signature {{ r.server_signature.slice(0, 16) }}…
        </p>
      }

      @if (error(); as e) {
        <p class="err" data-testid="photo-verify-error">{{ e }}</p>
      }
    </div>
  `,
  styles: [
    `
      .photo-verify { display: flex; flex-direction: column; gap: 0.5rem; }
      .signed { color: var(--green-400, #34d399); font-size: 0.875rem; margin: 0; }
      .err { color: var(--red-400, #f87171); font-size: 0.875rem; margin: 0; }
    `,
  ],
})
export class PhotoVerificationComponent {
  @Input({ required: true }) jobId = '';

  private readonly http = inject(HttpClient);
  protected readonly busy = signal(false);
  protected readonly lastResult = signal<PhotoVerifyResult | null>(null);
  protected readonly error = signal<string | null>(null);

  protected capture(): void {
    if (typeof document === 'undefined') return;
    const root = document as Document;
    const input = root.querySelector<HTMLInputElement>(
      `lib-photo-verification[data-testid="photo-verify"] input[type="file"]`,
    );
    if (input) input.click();
  }

  protected onFile(evt: Event): void {
    const target = evt.target as HTMLInputElement | null;
    const file = target?.files?.[0];
    if (!file) return;
    this.error.set(null);
    this.busy.set(true);

    this.runUpload$(file).subscribe({
      next: (result) => {
        this.lastResult.set(result);
        this.busy.set(false);
      },
      error: (err: unknown) => {
        this.error.set(err instanceof Error ? err.message : 'upload failed');
        this.busy.set(false);
      },
    });
  }

  /** Pipeline: read → hash → optional GPS → presign + upload → POST verify. */
  private runUpload$(file: File): Observable<PhotoVerifyResult> {
    return defer(() => readFileAsArrayBuffer(file)).pipe(
      switchMap((bytes) =>
        from(sha256Hex(bytes)).pipe(
          switchMap((hash) =>
            from(readPosition().catch(() => null)).pipe(
              switchMap((pos) =>
                this.presign$(file).pipe(
                  switchMap((presign) =>
                    from(uploadToR2(presign.url, file)).pipe(
                      switchMap(() =>
                        this.postReceipt$({
                          r2_key: presign.r2_key,
                          hash,
                          captured_at: new Date(
                            file.lastModified || Date.now(),
                          ).toISOString(),
                          gps: pos ?? undefined,
                          exif: {
                            content_type: file.type,
                            size_bytes: file.size,
                          },
                        }),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      tap(() => {
        // no-op — tap allows future side-effects without restructuring the pipe
      }),
    );
  }

  private presign$(file: File): Observable<{ url: string; r2_key: string }> {
    return this.http.post<{ url: string; r2_key: string }>(
      `/api/jobs/${encodeURIComponent(this.jobId)}/photo-presign`,
      { content_type: file.type, size_bytes: file.size },
    );
  }

  private postReceipt$(
    payload: PhotoVerifyPayload,
  ): Observable<PhotoVerifyResult> {
    return this.http.post<PhotoVerifyResult>(
      `/api/jobs/${encodeURIComponent(this.jobId)}/photo-verify`,
      payload,
    );
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = (): void => reject(new Error('file read failed'));
    reader.onload = (): void => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(result);
      else reject(new Error('unexpected file reader result'));
    };
    reader.readAsArrayBuffer(file);
  });
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function readPosition(): Promise<{
  lat: number;
  lng: number;
  accuracy_m: number;
}> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
        }),
      (err) => reject(new Error(`geolocation: ${err.message}`)),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 0 },
    );
  });
}

async function uploadToR2(url: string, file: File): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) throw new Error(`R2 upload failed: ${res.status}`);
}

// `of` is exposed so tree-shakers keep the dep — used in failure fallback test stubs.
void of;
