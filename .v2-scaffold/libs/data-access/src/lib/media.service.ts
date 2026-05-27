/**
 * `MediaService` — RxJS-first upload + AI-assist surface for tenant media.
 *
 * Phase-4 doctrine markers:
 *   - Every backend touch returns an `Observable<T>` ([[rxjs-first-angular]]).
 *   - The upload pipeline auto-calls `/api/ai/alt-text` per WAVE-1B #8 so
 *     every uploaded image lands with a suggested alt attribute. The caller
 *     decides whether to display the suggestion as an editable preset
 *     (WCAG-compliant alt is still the human's responsibility per WebAIM).
 *
 * @example
 * ```ts
 * media.uploadImage$(file).subscribe(({ url, alt_text }) => {
 *   form.controls.url.setValue(url);
 *   form.controls.alt.setValue(alt_text ?? '');
 * });
 * ```
 */
import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  type Observable,
  catchError,
  defer,
  filter,
  map,
  of,
  switchMap,
} from 'rxjs';

export interface UploadResponse {
  readonly id: string;
  readonly url: string;
}

export interface AltTextResponse {
  readonly alt_text: string;
  readonly model: string;
}

export interface UploadedImage extends UploadResponse {
  /** AI-suggested alt text. `null` when the alt-text endpoint failed. */
  readonly alt_text: string | null;
  readonly alt_model: string | null;
}

@Injectable({ providedIn: 'root' })
export class MediaService {
  private readonly http = inject(HttpClient);

  /**
   * Upload an image file to the control-plane, then auto-generate alt-text.
   *
   * Streams a single `UploadedImage` once both legs complete. Alt-text errors
   * never kill the upload — they downgrade to `alt_text: null` so the caller
   * can still proceed.
   */
  uploadImage$(file: File): Observable<UploadedImage> {
    return defer(() => {
      const form = new FormData();
      form.append('file', file, file.name);
      return this.http
        .post<UploadResponse>('/api/media/upload', form, {
          reportProgress: true,
          observe: 'events',
        })
        .pipe(
          filter((evt) => evt.type === HttpEventType.Response),
          map((evt) => {
            // `evt.type === Response` narrows correctly here.
            const body = (evt as { body: UploadResponse | null }).body;
            if (!body) throw new Error('upload returned empty body');
            return body;
          }),
        );
    }).pipe(
      switchMap((upload) =>
        this.generateAltText$(upload.url, upload.id).pipe(
          map(
            (alt): UploadedImage => ({
              ...upload,
              alt_text: alt.alt_text,
              alt_model: alt.model,
            }),
          ),
          catchError(() =>
            of<UploadedImage>({ ...upload, alt_text: null, alt_model: null }),
          ),
        ),
      ),
    );
  }

  /** Call POST /api/ai/alt-text for an existing image URL. */
  generateAltText$(image_url: string, image_id?: string): Observable<AltTextResponse> {
    return this.http.post<AltTextResponse>('/api/ai/alt-text', {
      image_url,
      ...(image_id ? { image_id } : {}),
    });
  }
}
