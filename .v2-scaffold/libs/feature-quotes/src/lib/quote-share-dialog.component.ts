/**
 * Share-link generator dialog. Emits a signed URL, copies it to
 * clipboard on demand, renders a QR for cross-device handoff.
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QuotesService, ShareLink } from './services/quotes.service.js';

@Component({
  selector: 'lib-quote-share-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  styles: [
    `
      :host {
        display: block;
        color: var(--ps-ink, #f4f4ff);
      }
      .ps-share {
        padding: 18px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.04);
        display: grid;
        gap: 12px;
        max-width: 460px;
      }
      .ps-share__row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      input[readonly] {
        flex: 1;
        appearance: none;
        background: rgba(255, 255, 255, 0.05);
        color: inherit;
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 8px 10px;
        border-radius: 10px;
        font: inherit;
      }
      img.ps-share__qr {
        width: 160px;
        height: 160px;
        background: white;
        padding: 8px;
        border-radius: 12px;
      }
    `,
  ],
  template: `
    <section class="ps-share" data-testid="quote-share-dialog">
      <h3>Share this quote</h3>
      @if (link(); as l) {
        <div class="ps-share__row">
          <input
            type="text"
            readonly
            [value]="l.url"
            data-testid="share-url"
          />
          <button
            type="button"
            (click)="copy(l.url)"
            data-testid="share-copy"
          >
            {{ copied() ? 'Copied ✓' : 'Copy' }}
          </button>
        </div>
        @if (l.qr_data_url) {
          <img class="ps-share__qr" [src]="l.qr_data_url" alt="QR for quote share link" />
        }
        <small>Signed until {{ l.signed_until | date: 'medium' }}</small>
      } @else if (loading()) {
        <p>Generating link…</p>
      } @else if (error(); as e) {
        <p role="alert">{{ e }}</p>
      }
      <button type="button" (click)="close.emit()" data-testid="share-close">
        Close
      </button>
    </section>
  `,
})
export class QuoteShareDialogComponent {
  private readonly quotes = inject(QuotesService);

  @Input({ required: true }) quoteId!: string;
  @Output() readonly close = new EventEmitter<void>();

  readonly link = signal<ShareLink | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly copied = signal(false);

  ngOnInit(): void {
    this.quotes
      .shareQuote$(this.quoteId)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (l) => {
          this.link.set(l);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(
            err instanceof Error ? err.message : 'Could not generate link'
          );
          this.loading.set(false);
        },
      });
  }

  async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      this.copied.set(false);
    }
  }
}
