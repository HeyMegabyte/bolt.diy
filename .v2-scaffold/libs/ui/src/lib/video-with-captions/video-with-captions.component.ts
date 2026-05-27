/**
 * VideoWithCaptionsComponent — wraps a native `<video>` and auto-fetches a
 * Whisper-generated WebVTT caption track on mount.
 *
 * Calls `POST /api/ai/transcribe { audio_url }` on first render of a new
 * `videoUrl`. The worker is idempotent (KV + D1 keyed on SHA-256 of the URL)
 * so a second mount is a cheap cache hit.
 *
 * @example
 * ```html
 * <lib-video-with-captions
 *   [videoUrl]="'https://cdn.projectsites.dev/clips/welcome.mp4'"
 *   [poster]="'https://cdn.projectsites.dev/clips/welcome.jpg'"
 * />
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Input,
  OnChanges,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, catchError, of, retry, timer } from 'rxjs';

export interface TranscribeResult {
  readonly vtt_url: string;
  readonly language: string | null;
  readonly cached: boolean;
}

@Component({
  selector: 'lib-video-with-captions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <figure class="vwc" data-testid="video-with-captions">
      <video
        #player
        controls
        preload="metadata"
        playsinline
        [src]="videoUrl"
        [poster]="poster ?? null"
        [attr.aria-label]="ariaLabel ?? 'Video player with captions'"
      >
        @if (vttUrl(); as src) {
          <track
            kind="captions"
            [attr.src]="src"
            [attr.srclang]="language() ?? 'en'"
            label="Auto-generated captions"
            default
          />
        }
      </video>
      @if (status() === 'loading') {
        <figcaption class="vwc__status" role="status" data-testid="captions-loading">
          Generating captions…
        </figcaption>
      } @else if (status() === 'error') {
        <figcaption class="vwc__status vwc__status--err" role="alert" data-testid="captions-error">
          Captions unavailable.
        </figcaption>
      }
    </figure>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
      .vwc {
        margin: 0;
        position: relative;
        display: grid;
        gap: 6px;
      }
      .vwc video {
        width: 100%;
        height: auto;
        border-radius: 14px;
        background: #000;
      }
      .vwc__status {
        font-size: 0.85rem;
        color: var(--ps-ink, #f4f4ff);
        opacity: 0.7;
      }
      .vwc__status--err {
        color: #ff7676;
        opacity: 0.95;
      }
    `,
  ],
})
export class VideoWithCaptionsComponent implements OnChanges {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  /** Source video URL — must also be reachable by the worker for transcription. */
  @Input({ required: true }) videoUrl!: string;
  @Input() poster?: string;
  @Input() ariaLabel?: string;
  /**
   * Override the transcribe endpoint when the app is mounted under a non-default
   * API origin (e.g., during E2E tests against a staging worker).
   */
  @Input() transcribeEndpoint = '/api/ai/transcribe';

  protected readonly vttUrl = signal<string | null>(null);
  protected readonly language = signal<string | null>(null);
  protected readonly status = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');

  /** Reactive readiness for templates that want to react to caption arrival. */
  readonly captionsReady = computed(() => this.status() === 'ready');

  ngOnChanges(changes: SimpleChanges): void {
    const vid = changes['videoUrl'];
    if (vid && typeof this.videoUrl === 'string' && this.videoUrl.length > 0) {
      this.loadCaptions(this.videoUrl);
    }
  }

  private loadCaptions(url: string): void {
    this.status.set('loading');
    this.vttUrl.set(null);
    this.transcribe$(url)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) {
          this.status.set('error');
          return;
        }
        this.vttUrl.set(res.vtt_url);
        this.language.set(res.language);
        this.status.set('ready');
      });
  }

  private transcribe$(audioUrl: string): Observable<TranscribeResult | null> {
    return this.http
      .post<TranscribeResult>(this.transcribeEndpoint, { audio_url: audioUrl })
      .pipe(
        retry({
          count: 2,
          delay: (_err, attempt) => timer(Math.min(2 ** attempt * 250, 4000)),
        }),
        catchError(() => of(null)),
      );
  }
}
