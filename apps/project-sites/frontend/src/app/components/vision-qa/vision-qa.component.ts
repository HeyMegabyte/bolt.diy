/**
 * @module components/vision-qa
 *
 * On-demand AI vision critique of a live URL — calls the editor_vision_qa
 * backend (`POST /api/vision-qa`), which screenshots the page via Cloudflare
 * Browser Rendering and scores it 1-10 with a Workers AI vision model. Renders
 * the overall score + worst-first fix findings. Self-contained + graceful: a
 * 404 means the flag is off; a null score means the Browser binding isn't live.
 */

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../services/api.service';

interface Finding { axis: string; value: number; suggestion: string }
interface VisionScore { overall: number | null; notes?: string }
interface VisionResponse { score: VisionScore | null; findings?: Finding[]; notes?: string }

@Component({
  selector: 'app-vision-qa',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="vq" aria-label="AI vision critique">
      <header class="vq-head">
        <h3>AI vision critique</h3>
        <button type="button" class="vq-btn" (click)="run()" [disabled]="running()"
                [attr.aria-label]="'Run AI vision critique of ' + url()">
          {{ running() ? 'Scoring…' : 'Run vision QA ✦' }}
        </button>
      </header>
      <p class="vq-sub">Screenshots <code>{{ url() }}</code> on Cloudflare and scores its design 1-10.</p>

      @if (error(); as e) { <p class="vq-note" role="status">{{ e }}</p> }

      @if (result(); as r) {
        @if (r.score?.overall != null) {
          <div class="vq-score" [attr.data-band]="band(r.score!.overall!)">
            <span class="vq-num">{{ r.score!.overall }}</span><span class="vq-den">/10</span>
            <span class="vq-band">{{ bandLabel(r.score!.overall!) }}</span>
          </div>
          @if (r.findings?.length) {
            <ul class="vq-findings" aria-label="Fix suggestions">
              @for (f of r.findings; track f.axis) {
                <li><span class="vq-axis">{{ f.axis }}</span><span class="vq-val">{{ f.value }}/10</span><span class="vq-fix">{{ f.suggestion }}</span></li>
              }
            </ul>
          } @else {
            <p class="vq-note">No weak spots — every dimension scored 7+. ✓</p>
          }
        } @else {
          <p class="vq-note">{{ r.notes || r.score?.notes || 'Vision scoring is unavailable right now.' }}</p>
        }
      }
    </section>
  `,
  styles: [`
    .vq { background: color-mix(in oklch, var(--ps-bg, #060610) 55%, transparent); border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent); border-radius: 16px; padding: 1.1rem 1.25rem; color: var(--ps-ink, #f4f4ff); }
    .vq-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    .vq-head h3 { margin: 0; font-size: 1.05rem; }
    .vq-btn { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); border: 0; border-radius: 8px; padding: .5rem .9rem; font: inherit; font-weight: 700; font-size: .82rem; cursor: pointer; transition: filter .333s ease; }
    .vq-btn:hover:not(:disabled) { filter: brightness(1.08); }
    .vq-btn:disabled { opacity: .5; cursor: not-allowed; }
    .vq-btn:focus-visible { outline: 2px solid var(--ps-ink, #f4f4ff); outline-offset: 2px; }
    .vq-sub { font-size: .8rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent); margin: .5rem 0; }
    .vq-sub code { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: .74rem; color: color-mix(in oklch, var(--ps-accent, #00e5ff) 85%, var(--ps-ink, #f4f4ff)); word-break: break-all; }
    .vq-note { font-size: .82rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent); margin: .5rem 0 0; }
    .vq-score { display: flex; align-items: baseline; gap: .4rem; margin: .5rem 0; }
    .vq-num { font: 700 2rem/1 'JetBrains Mono', ui-monospace, monospace; }
    .vq-den { font-size: .9rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent); }
    .vq-band { margin-left: .6rem; font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: .15rem .55rem; border-radius: 999px; }
    .vq-score[data-band="good"] .vq-num, .vq-score[data-band="good"] .vq-band { color: #4ade80; }
    .vq-score[data-band="good"] .vq-band { background: color-mix(in oklch, #4ade80 18%, transparent); }
    .vq-score[data-band="ok"] .vq-num, .vq-score[data-band="ok"] .vq-band { color: #fbbf24; }
    .vq-score[data-band="ok"] .vq-band { background: color-mix(in oklch, #fbbf24 20%, transparent); }
    .vq-score[data-band="poor"] .vq-num, .vq-score[data-band="poor"] .vq-band { color: #f87171; }
    .vq-score[data-band="poor"] .vq-band { background: color-mix(in oklch, #f87171 20%, transparent); }
    .vq-findings { list-style: none; margin: .4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; }
    .vq-findings li { display: flex; align-items: baseline; gap: .5rem; font-size: .82rem; flex-wrap: wrap; }
    .vq-axis { text-transform: capitalize; font-weight: 600; min-width: 7rem; }
    .vq-val { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: .74rem; color: #f87171; }
    .vq-fix { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 78%, transparent); flex: 1; min-width: 12rem; }
  `],
})
export class VisionQaComponent {
  private readonly api = inject(ApiService);

  readonly url = input.required<string>();

  readonly running = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<VisionResponse | null>(null);

  readonly band = (n: number): 'good' | 'ok' | 'poor' => (n >= 8 ? 'good' : n >= 6 ? 'ok' : 'poor');
  bandLabel(n: number): string { return n >= 8 ? 'Looks great' : n >= 6 ? 'Decent' : 'Needs work'; }

  async run(): Promise<void> {
    if (this.running()) return;
    this.error.set(null);
    this.result.set(null);
    this.running.set(true);
    try {
      const res = await firstValueFrom(this.api.post<VisionResponse>('/vision-qa', { url: this.url() }, { silent: true }));
      this.result.set(res ?? { score: null });
    } catch (e) {
      const status = (e as { status?: number })?.status;
      this.error.set(
        status === 404
          ? 'AI vision critique isn’t enabled for this site yet.'
          : 'Couldn’t run the critique. Try again in a moment.',
      );
    } finally {
      this.running.set(false);
    }
  }
}
