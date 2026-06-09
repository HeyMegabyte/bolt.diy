/**
 * @module components/site-concierge
 *
 * "Ask my site" tester for the ai_concierge_widget feature — posts a question to
 * `POST /api/sites/:id/concierge` and renders the grounded answer + its sources.
 * Self-contained + graceful: 404 = flag off, null answer = AI/RAG provisioning.
 */

import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../services/api.service';

interface Source { title: string; kind: string; score: number }
interface ConciergeResponse { answer: string | null; sources?: Source[]; notes?: string }

@Component({
  selector: 'app-site-concierge',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sc" aria-label="Ask my site">
      <h3 class="sc-h">Ask your site</h3>
      <p class="sc-sub">Test the AI concierge — it answers from your site's own content, grounded, never invented.</p>
      <form class="sc-form" (ngSubmit)="ask()">
        <input class="sc-input" type="text" name="q" [(ngModel)]="q" [disabled]="running()"
               placeholder="e.g. What are your hours?" aria-label="Question for the AI concierge"
               autocomplete="off" data-testid="concierge-input" />
        <button class="sc-btn" type="submit" [disabled]="running() || q().trim().length < 2" data-testid="concierge-ask">
          {{ running() ? 'Asking…' : 'Ask ✦' }}
        </button>
      </form>

      @if (error(); as e) { <p class="sc-note" role="status">{{ e }}</p> }

      @if (result(); as r) {
        @if (r.answer) {
          <div class="sc-answer" data-testid="concierge-answer">{{ r.answer }}</div>
          @if (r.sources?.length) {
            <div class="sc-sources" aria-label="Sources">
              <span class="sc-sources-h">Grounded in:</span>
              @for (s of r.sources; track s.title) {
                <span class="sc-src" [attr.title]="s.kind + ' · ' + (s.score * 100 | number: '1.0-0') + '% match'">{{ s.title }}</span>
              }
            </div>
          }
        } @else {
          <p class="sc-note">{{ r.notes || 'No answer available yet.' }}</p>
        }
      }
    </section>
  `,
  styles: [`
    .sc { background: color-mix(in oklch, var(--ps-bg, #060610) 55%, transparent); border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent); border-radius: 16px; padding: 1.1rem 1.25rem; color: var(--ps-ink, #f4f4ff); }
    .sc-h { margin: 0; font-size: 1.05rem; }
    .sc-sub { font-size: .8rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent); margin: .4rem 0 .75rem; }
    .sc-form { display: flex; gap: .5rem; flex-wrap: wrap; }
    .sc-input { flex: 1; min-width: 12rem; background: color-mix(in oklch, var(--ps-bg, #060610) 60%, transparent); color: inherit; border: 1px solid color-mix(in oklch, currentColor 20%, transparent); border-radius: 8px; padding: .5rem .7rem; font: inherit; font-size: .85rem; }
    .sc-input:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 1px; }
    .sc-btn { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); border: 0; border-radius: 8px; padding: .5rem .9rem; font: inherit; font-weight: 700; font-size: .82rem; cursor: pointer; transition: filter .333s ease; }
    .sc-btn:hover:not(:disabled) { filter: brightness(1.08); }
    .sc-btn:disabled { opacity: .5; cursor: not-allowed; }
    .sc-btn:focus-visible { outline: 2px solid var(--ps-ink, #f4f4ff); outline-offset: 2px; }
    .sc-note { font-size: .82rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent); margin: .6rem 0 0; }
    .sc-answer { margin: .75rem 0 0; padding: .75rem .9rem; border-radius: 10px; line-height: 1.55; font-size: .9rem;
      background: color-mix(in oklch, var(--ps-accent, #00e5ff) 6%, transparent); border-left: 3px solid var(--ps-accent, #00e5ff); white-space: pre-wrap; }
    .sc-sources { margin-top: .6rem; display: flex; gap: .4rem; flex-wrap: wrap; align-items: center; }
    .sc-sources-h { font-size: .68rem; text-transform: uppercase; letter-spacing: .05em; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent); }
    .sc-src { font-size: .72rem; padding: .15rem .55rem; border-radius: 999px; background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent); color: var(--ps-accent, #00e5ff); border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 24%, transparent); }
  `],
})
export class SiteConciergeComponent {
  private readonly api = inject(ApiService);

  readonly siteId = input.required<string>();

  readonly q = signal('');
  readonly running = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<ConciergeResponse | null>(null);

  async ask(): Promise<void> {
    const question = this.q().trim();
    if (this.running() || question.length < 2) return;
    this.error.set(null);
    this.result.set(null);
    this.running.set(true);
    try {
      const res = await firstValueFrom(
        this.api.post<ConciergeResponse>(`/sites/${encodeURIComponent(this.siteId())}/concierge`, { q: question }, { silent: true }),
      );
      this.result.set(res ?? { answer: null });
    } catch (e) {
      const status = (e as { status?: number })?.status;
      this.error.set(status === 404 ? 'The AI concierge isn’t enabled for this site yet.' : 'Couldn’t get an answer. Try again.');
    } finally {
      this.running.set(false);
    }
  }
}
