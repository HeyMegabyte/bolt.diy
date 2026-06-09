/**
 * @module components/i18n-translate
 *
 * Tester for the i18n_localization feature — translates text into a target
 * language via /api/sites/:id/i18n/translate (Workers AI m2m100) and shows the
 * result with the correct text direction (RTL-aware). Self-contained + graceful
 * (404 = flag off, null = provisioning).
 */

import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../services/api.service';

interface TranslateResponse { translated: string | null; dir?: 'ltr' | 'rtl'; notes?: string }

const LOCALES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'es', label: 'Spanish' }, { code: 'fr', label: 'French' }, { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' }, { code: 'it', label: 'Italian' }, { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' }, { code: 'ko', label: 'Korean' }, { code: 'hi', label: 'Hindi' },
  { code: 'ar', label: 'Arabic (RTL)' }, { code: 'he', label: 'Hebrew (RTL)' }, { code: 'ru', label: 'Russian' },
  { code: 'vi', label: 'Vietnamese' }, { code: 'tl', label: 'Tagalog' },
];

@Component({
  selector: 'app-i18n-translate',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="it" aria-label="Translation tester">
      <h3 class="it-h">Translate a snippet</h3>
      <p class="it-sub">Preview the AI translation + text direction this feature applies to your pages.</p>
      <form class="it-form" (ngSubmit)="translate()">
        <textarea class="it-text" name="text" rows="2" [(ngModel)]="text" [disabled]="running()"
                  placeholder="Text to translate…" aria-label="Text to translate" data-testid="it-text"></textarea>
        <div class="it-row">
          <select class="it-sel" name="target" [(ngModel)]="target" [disabled]="running()" aria-label="Target language">
            @for (l of locales; track l.code) { <option [value]="l.code">{{ l.label }}</option> }
          </select>
          <button class="it-btn" type="submit" [disabled]="running() || text.trim().length < 1" data-testid="it-go">
            {{ running() ? 'Translating…' : 'Translate ✦' }}
          </button>
        </div>
      </form>

      @if (error(); as e) { <p class="it-note" role="status">{{ e }}</p> }
      @if (result(); as r) {
        @if (r.translated) {
          <div class="it-out" [attr.dir]="r.dir || 'ltr'" data-testid="it-out">{{ r.translated }}</div>
        } @else {
          <p class="it-note">{{ r.notes || 'No translation available.' }}</p>
        }
      }
    </section>
  `,
  styles: [`
    .it { background: color-mix(in oklch, var(--ps-bg, #060610) 55%, transparent); border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent); border-radius: 16px; padding: 1.1rem 1.25rem; color: var(--ps-ink, #f4f4ff); }
    .it-h { margin: 0; font-size: 1.05rem; }
    .it-sub { font-size: .8rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent); margin: .4rem 0 .7rem; }
    .it-form { display: flex; flex-direction: column; gap: .5rem; }
    .it-text { width: 100%; box-sizing: border-box; background: color-mix(in oklch, var(--ps-bg, #060610) 60%, transparent); color: inherit; border: 1px solid color-mix(in oklch, currentColor 20%, transparent); border-radius: 8px; padding: .5rem .7rem; font: inherit; font-size: .85rem; resize: vertical; }
    .it-text:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 1px; }
    .it-row { display: flex; gap: .5rem; flex-wrap: wrap; }
    .it-sel { flex: 1; min-width: 8rem; background: color-mix(in oklch, var(--ps-bg, #060610) 60%, transparent); color: inherit; border: 1px solid color-mix(in oklch, currentColor 20%, transparent); border-radius: 8px; padding: .45rem .6rem; font: inherit; font-size: .82rem; }
    .it-sel:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 1px; }
    .it-btn { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); border: 0; border-radius: 8px; padding: .45rem .9rem; font: inherit; font-weight: 700; font-size: .82rem; cursor: pointer; transition: filter .333s ease; }
    .it-btn:hover:not(:disabled) { filter: brightness(1.08); } .it-btn:disabled { opacity: .5; cursor: not-allowed; }
    .it-btn:focus-visible { outline: 2px solid var(--ps-ink, #f4f4ff); outline-offset: 2px; }
    .it-note { font-size: .82rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent); margin: .6rem 0 0; }
    .it-out { margin: .75rem 0 0; padding: .75rem .9rem; border-radius: 10px; line-height: 1.6; font-size: .9rem;
      background: color-mix(in oklch, var(--ps-accent, #00e5ff) 6%, transparent); border-left: 3px solid var(--ps-accent, #00e5ff); }
    .it-out[dir="rtl"] { border-left: 0; border-right: 3px solid var(--ps-accent, #00e5ff); text-align: right; }
  `],
})
export class I18nTranslateComponent {
  private readonly api = inject(ApiService);

  readonly siteId = input.required<string>();
  readonly locales = LOCALES;

  text = '';
  target = 'es';
  readonly running = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<TranslateResponse | null>(null);

  async translate(): Promise<void> {
    const body = this.text.trim();
    if (this.running() || body.length < 1) return;
    this.error.set(null);
    this.result.set(null);
    this.running.set(true);
    try {
      const res = await firstValueFrom(
        this.api.post<TranslateResponse>(`/sites/${encodeURIComponent(this.siteId())}/i18n/translate`, { text: body, target: this.target }, { silent: true }),
      );
      this.result.set(res ?? { translated: null });
    } catch (e) {
      const status = (e as { status?: number })?.status;
      this.error.set(status === 404 ? 'Languages isn’t enabled for this site yet.' : 'Couldn’t translate. Try again.');
    } finally {
      this.running.set(false);
    }
  }
}
