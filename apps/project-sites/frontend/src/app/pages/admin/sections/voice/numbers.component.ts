/**
 * Voice → Numbers tab.
 *
 * @remarks
 * Live Twilio number search (area code + word/digits), vanity-letter mapping
 * (E.164 "+18558522267" rendered as "(855) 82L-ABOR" with bolded matches), AI
 * suggestion chips for vanity words, and a capped-at-3 purchase flow.
 *
 * Endpoint contract (worker-owned, sibling agent):
 *   GET  /api/voice/numbers?siteId=…              → { data: PurchasedNumber[] }
 *   GET  /api/voice/search?siteId=…&q=…&area=…    → { data: NumberCandidate[] }
 *   GET  /api/voice/vanity-suggestions?siteId=…   → { data: VanitySuggestion[] }
 *   POST /api/voice/numbers (body { phone_number })
 *   DELETE /api/voice/numbers/:id                 → release
 *
 * @example
 * ```html
 * <app-voice-numbers />
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialog } from '@angular/cdk/dialog';
import { AdminStateService } from '../../admin-state.service';
import { ApiService } from '../../../../services/api.service';
import { ToastService } from '../../../../services/toast.service';
import { RevealOnScrollDirective } from '../../../../animations/reveal-on-scroll.directive';
import { RollingCounterComponent } from '../../../../components/rolling-counter/rolling-counter.component';
import { EmptyStateComponent } from '../../empty-state.component';
import { HlmInputDirective } from '../../../../ui';

interface PurchasedNumber {
  id: string;
  phone_number: string;
  friendly_name?: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
  monthly_cost_usd: number;
  purchased_at: string;
}

interface NumberCandidate {
  phone_number: string;
  locality?: string;
  region?: string;
  iso_country: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
  monthly_cost_usd: number;
  vanity_match?: string;
}

interface VanitySuggestion {
  word: string;
  digits: string;
  rationale: string;
  score: number;
}

const MAX_NUMBERS = 3;
const LETTER_TO_DIGIT: Readonly<Record<string, string>> = Object.freeze({
  A: '2', B: '2', C: '2', D: '3', E: '3', F: '3', G: '4', H: '4', I: '4',
  J: '5', K: '5', L: '5', M: '6', N: '6', O: '6', P: '7', Q: '7', R: '7',
  S: '7', T: '8', U: '8', V: '8', W: '9', X: '9', Y: '9', Z: '9',
});

@Component({
  selector: 'app-voice-numbers',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RevealOnScrollDirective, RollingCounterComponent, EmptyStateComponent, HlmInputDirective],
  template: `
    <section class="space-y-6" psReveal>
      <!-- Your numbers -->
      <article class="card" psReveal>
        <header class="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div>
            <div class="kicker">Phone numbers</div>
            <h3 class="section-h text-base font-bold text-white m-0 mt-1 flex items-center gap-2">
              Your numbers
              <span class="header-pill" aria-live="polite">
                <app-rolling-counter [value]="numbers().length" />
                <span aria-hidden="true">/</span>
                <app-rolling-counter [value]="MAX" />
              </span>
            </h3>
            <p class="muted-help m-0 mt-1">Up to {{ MAX }} numbers per site. Release one to free a slot.</p>
          </div>
          <div class="flex items-center gap-2 text-[0.7rem] text-text-secondary">
            <span>Monthly spend</span>
            <strong class="text-white"><app-rolling-counter prefix="$" [value]="monthlySpend()" [decimals]="2" /></strong>
          </div>
        </header>

        @if (loading() && numbers().length === 0) {
          <div class="space-y-2" aria-busy="true">
            <div class="skel h-12 rounded-md"></div>
            <div class="skel h-12 rounded-md"></div>
          </div>
        } @else if (numbers().length === 0) {
          <app-empty-state
            icon="📞"
            title="No numbers yet"
            body="Pick a vanity word below — your AI agent picks up the moment a caller dials."
          />
        } @else {
          <ul class="grid gap-2" role="list">
            @for (n of numbers(); track n.id) {
              <li class="num-row" role="listitem">
                <div class="min-w-0 flex-1">
                  <div class="vanity-display" [innerHTML]="vanityHtml(n.phone_number, n.friendly_name)"></div>
                  <div class="num-meta">
                    @if (n.capabilities.voice) { <span class="cap-chip">Voice</span> }
                    @if (n.capabilities.sms)   { <span class="cap-chip">SMS</span> }
                    @if (n.capabilities.mms)   { <span class="cap-chip">MMS</span> }
                    <span class="cost-chip">\${{ n.monthly_cost_usd.toFixed(2) }}/mo</span>
                  </div>
                </div>
                <button class="btn-ghost text-xs"
                        type="button"
                        (click)="copy(n.phone_number)"
                        [attr.aria-label]="'Copy ' + n.phone_number">Copy</button>
                <button class="btn-danger-ghost"
                        type="button"
                        (click)="release(n)"
                        [attr.aria-label]="'Release ' + n.phone_number">Release</button>
              </li>
            }
          </ul>
        }
      </article>

      <!-- Search -->
      <article class="card" psReveal>
        <header class="mb-3">
          <div class="kicker">Find a number</div>
          <h3 class="section-h text-base font-bold text-white m-0 mt-1">Vanity + area-code search</h3>
          <p class="muted-help m-0 mt-1">Type letters or digits. "LABOR" matches "5227", "MOVE" matches "6683".</p>
        </header>

        <div class="search-row">
          <label class="flex-1 min-w-0">
            <span class="sr-only">Search query</span>
            <input hlmInput class="w-full font-mono min-h-[44px]"
                   type="text"
                   [(ngModel)]="query"
                   (ngModelChange)="onQueryChange($event)"
                   placeholder='Try "MOVE", "82LABOR", "BRICK"'
                   aria-label="Vanity word or digits"
                   data-testid="voice-search-q" />
          </label>
          <label class="w-[120px]">
            <span class="sr-only">Area code</span>
            <input hlmInput class="w-full font-mono min-h-[44px]"
                   type="text"
                   inputmode="numeric"
                   maxlength="3"
                   [(ngModel)]="areaCode"
                   (ngModelChange)="onQueryChange(query)"
                   placeholder="855"
                   aria-label="Area code" />
          </label>
        </div>

        @if (cappedNotice()) {
          <p class="notice notice-amber mt-3" role="status">
            <strong>You're at the {{ MAX }}-number cap.</strong>
            Release a number above before purchasing another.
          </p>
        }

        @if (searching()) {
          <div class="grid gap-2 mt-3" aria-busy="true">
            @for (i of [0,1,2,3]; track i) {
              <div class="skel h-14 rounded-md"></div>
            }
          </div>
        } @else if (searchResults().length > 0) {
          <ul role="listbox" aria-label="Available numbers" class="grid gap-2 mt-3">
            @for (c of searchResults(); track c.phone_number; let idx = $index) {
              <li role="option" [attr.aria-selected]="false"
                  class="result-row"
                  tabindex="0"
                  (keydown)="onResultKey($event, idx, c)">
                <div class="min-w-0 flex-1">
                  <div class="vanity-display" [innerHTML]="vanityHtml(c.phone_number, c.vanity_match)"></div>
                  <div class="num-meta">
                    @if (c.locality) { <span>{{ c.locality }}, {{ c.region }}</span> }
                    @if (c.capabilities.voice) { <span class="cap-chip">Voice</span> }
                    @if (c.capabilities.sms)   { <span class="cap-chip">SMS</span> }
                    <span class="cost-chip">\${{ c.monthly_cost_usd.toFixed(2) }}/mo</span>
                  </div>
                </div>
                <button class="btn-primary"
                        type="button"
                        [disabled]="capped()"
                        (click)="confirmBuy(c)"
                        [attr.aria-label]="'Buy ' + c.phone_number">Buy</button>
              </li>
            }
          </ul>
        } @else if (query.trim().length > 0 && !searching()) {
          <p class="muted-help mt-3">No matches — try a shorter word or a different area code.</p>
        }
      </article>

      <!-- AI suggestions -->
      <article class="card" psReveal>
        <header class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <div class="kicker">AI</div>
            <h3 class="section-h text-base font-bold text-white m-0 mt-1">Suggested vanity words</h3>
            <p class="muted-help m-0 mt-1">Ranked by memorability + relevance to your business.</p>
          </div>
          <button class="btn-ghost text-xs" type="button" (click)="loadSuggestions(true)">Regenerate</button>
        </header>

        @if (suggestionsLoading()) {
          <div class="flex flex-wrap gap-2" aria-busy="true">
            @for (i of [0,1,2,3,4,5,6,7,8,9,10,11]; track i) {
              <span class="skel h-7 w-24 rounded-full"></span>
            }
          </div>
        } @else if (suggestions().length === 0) {
          <p class="muted-help">No suggestions yet — click Regenerate.</p>
        } @else {
          <div class="flex flex-wrap gap-2">
            @for (s of suggestions(); track s.word) {
              <button class="vanity-chip"
                      type="button"
                      [title]="s.rationale"
                      (click)="useSuggestion(s)"
                      (mouseenter)="speak(s.word)">
                <span class="font-bold">{{ s.word }}</span>
                <span class="text-text-secondary opacity-70 ml-1">→ {{ s.digits }}</span>
              </button>
            }
          </div>
        }
      </article>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .kicker { font: 700 0.62rem/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ps-accent, #00E5FF); opacity: 0.85; }
    .section-h { font-family: 'Sora', system-ui, sans-serif; letter-spacing: -0.02em; }
    .muted-help { font-size: 0.72rem; color: rgba(255,255,255,0.6); line-height: 1.5; }
    .card {
      background: var(--ps-surface-1, rgba(13,13,40,0.62));
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: var(--ps-radius-lg, 14px);
      padding: 1.2rem;
    }
    .search-row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
    /* .input-field removed — both search/area-code inputs now use hlmInput
       (mono + 44px tap target preserved via font-mono min-h-[44px] Tailwind). */

    .num-row, .result-row {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.7rem 0.85rem;
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: var(--ps-radius-sm, 10px);
      background: rgba(255,255,255,0.02);
      min-height: 56px;
      transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
    }
    .result-row { cursor: pointer; }
    .result-row:hover, .result-row:focus-visible {
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 36%, transparent);
      background: rgba(0,229,255,0.04);
      transform: translateY(-1px);
      outline: none;
    }
    .vanity-display {
      font: 700 1.05rem 'Sora', system-ui, sans-serif;
      letter-spacing: -0.01em;
      color: var(--ps-ink, #fff);
    }
    .vanity-display :global(b) { color: var(--ps-accent, #00E5FF); }
    .num-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; font-size: 0.66rem; color: rgba(255,255,255,0.6); align-items: center; }
    .cap-chip, .cost-chip {
      padding: 2px 7px; border-radius: 999px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      font: 600 0.62rem 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.06em;
    }
    .cost-chip { color: #a7f3d0; border-color: rgba(52,211,153,0.32); background: rgba(52,211,153,0.08); }

    .vanity-chip {
      padding: 0.45rem 0.85rem;
      border-radius: 999px;
      background: rgba(0,229,255,0.08);
      border: 1px solid rgba(0,229,255,0.24);
      color: var(--ps-ink, #fff);
      font: 500 0.74rem 'JetBrains Mono', ui-monospace, monospace;
      cursor: pointer;
      min-height: 36px;
      transition: transform 160ms ease, background 160ms ease, border-color 160ms ease;
    }
    .vanity-chip:hover { background: rgba(0,229,255,0.16); transform: translateY(-1px); border-color: rgba(0,229,255,0.5); }
    .vanity-chip:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }

    .header-pill {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 10px; border-radius: 999px;
      background: rgba(0,229,255,0.10);
      border: 1px solid rgba(0,229,255,0.32);
      color: var(--ps-accent, #00E5FF);
      font: 600 0.66rem 'JetBrains Mono', ui-monospace, monospace;
    }
    .notice { border-radius: var(--ps-radius-sm, 8px); padding: 0.7rem 0.9rem; font-size: 0.76rem; }
    .notice-amber { background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.32); color: #fde68a; }
    .notice-amber strong { color: #fcd34d; }

    .btn-primary, .btn-ghost, .btn-danger-ghost {
      min-height: 36px; padding: 0.45rem 0.85rem; border-radius: var(--ps-radius-sm, 8px);
      font-weight: 600; cursor: pointer; border: 1px solid transparent;
      transition: background 140ms ease, transform 140ms ease, border-color 140ms ease;
    }
    .btn-primary { background: rgba(0,229,255,0.14); color: var(--ps-accent, #00E5FF); border-color: rgba(0,229,255,0.36); font-size: 0.74rem; }
    .btn-primary:hover:not(:disabled) { background: rgba(0,229,255,0.22); transform: translateY(-1px); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-ghost { background: rgba(255,255,255,0.04); color: #fff; border-color: rgba(255,255,255,0.1); font-size: 0.72rem; }
    .btn-ghost:hover { background: rgba(255,255,255,0.09); }
    .btn-danger-ghost { background: transparent; color: #fca5a5; border-color: rgba(248,113,113,0.28); font-size: 0.7rem; }
    .btn-danger-ghost:hover { background: rgba(248,113,113,0.14); color: #fecaca; }
    button:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }

    .skel { background: rgba(255,255,255,0.04); border-radius: 6px; position: relative; overflow: hidden; }
    .skel::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent); background-size: 200% 100%; animation: shine 1.6s linear infinite; }
    @keyframes shine { from { background-position: 200% 0; } to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) {
      .skel::after, .result-row, .num-row, .vanity-chip, .btn-primary, .btn-ghost, .btn-danger-ghost {
        animation: none !important; transition: none !important; transform: none !important;
      }
    }

    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  `],
})
export class VoiceNumbersComponent implements OnInit, OnDestroy {
  readonly state = inject(AdminStateService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(Dialog);

  readonly MAX = MAX_NUMBERS;

  numbers = signal<PurchasedNumber[]>([]);
  loading = signal(true);
  query = '';
  areaCode = '';
  searching = signal(false);
  searchResults = signal<NumberCandidate[]>([]);
  suggestions = signal<VanitySuggestion[]>([]);
  suggestionsLoading = signal(false);
  cappedNotice = signal(false);

  capped = computed(() => this.numbers().length >= MAX_NUMBERS);
  monthlySpend = computed(() =>
    this.numbers().reduce((sum, n) => sum + (n.monthly_cost_usd || 0), 0),
  );

  private debounceTimer?: ReturnType<typeof setTimeout>;
  private abortCtrl?: AbortController;

  /** Reload on site switch. */
  private readonly siteEffect = effect(() => {
    const site = this.state.selectedSite();
    if (!site) return;
    this.loadNumbers();
    this.loadSuggestions(false);
  });

  ngOnInit(): void {
    // Initial loads run via the effect.
  }

  ngOnDestroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.abortCtrl?.abort();
  }

  loadNumbers(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.loading.set(true);
    this.api.get<{ data: PurchasedNumber[] }>(`/voice/numbers?siteId=${site.id}`).subscribe({
      next: (r) => { this.numbers.set(r.data ?? []); this.loading.set(false); },
      error: () => { this.loading.set(false); this.numbers.set([]); },
    });
  }

  loadSuggestions(force: boolean): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.suggestionsLoading.set(true);
    const url = `/voice/vanity-suggestions?siteId=${site.id}${force ? '&refresh=1' : ''}`;
    this.api.get<{ data: VanitySuggestion[] }>(url).subscribe({
      next: (r) => { this.suggestions.set((r.data ?? []).slice(0, 12)); this.suggestionsLoading.set(false); },
      error: () => { this.suggestions.set([]); this.suggestionsLoading.set(false); },
    });
  }

  onQueryChange(q: string): void {
    this.query = q;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (!q.trim() && !this.areaCode.trim()) {
      this.searchResults.set([]);
      return;
    }
    this.debounceTimer = setTimeout(() => this.runSearch(), 300);
  }

  private runSearch(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.abortCtrl?.abort();
    this.abortCtrl = new AbortController();
    this.searching.set(true);
    const params: Record<string, string> = { siteId: site.id };
    if (this.query.trim()) params['q'] = this.query.trim().toUpperCase();
    if (this.areaCode.trim()) params['area'] = this.areaCode.trim();
    this.api.get<{ data: NumberCandidate[] }>('/voice/search', params).subscribe({
      next: (r) => { this.searchResults.set((r.data ?? []).slice(0, 20)); this.searching.set(false); },
      error: () => { this.searchResults.set([]); this.searching.set(false); },
    });
  }

  useSuggestion(s: VanitySuggestion): void {
    this.query = s.word;
    this.onQueryChange(s.word);
  }

  /**
   * Open a confirmation dialog and POST the purchase.
   * @param c Candidate to buy.
   */
  async confirmBuy(c: NumberCandidate): Promise<void> {
    if (this.capped()) {
      this.cappedNotice.set(true);
      return;
    }
    const { DialogShellComponent } = await import('../../../../components/dialog-shell/dialog-shell.component');
    const ref = this.dialog.open(DialogShellComponent, { panelClass: 'cdk-overlay-transparent' });
    // Auto-close + handle via a wrapper toast for now — the dialog-shell ng-content body
    // can't host arbitrary buy logic inline, so we fall back to a confirm-like flow.
    ref.closed.subscribe(() => { /* user closed without choosing */ });
    // Show a confirmation toast with action so this works without a custom dialog body.
    ref.close();
    const ok = window.confirm(`Buy ${this.format(c.phone_number)} for $${c.monthly_cost_usd.toFixed(2)}/mo?`);
    if (!ok) return;
    // Worker route is POST /api/voice/numbers/purchase with a camelCase body
    // ({ siteId, phoneNumber }) per purchaseBody in routes/voice.ts. The old
    // call hit bare /voice/numbers (no such route → SPA HTML) with snake_case
    // keys (would 400 even if the path matched) — the Buy button never worked.
    this.api.post<{ data: PurchasedNumber }>(`/voice/numbers/purchase`, {
      siteId: this.state.selectedSite()?.id,
      phoneNumber: c.phone_number,
    }).subscribe({
      next: () => {
        this.toast.success(`${this.format(c.phone_number)} added`);
        this.searchResults.set([]);
        this.query = '';
        this.loadNumbers();
      },
      error: () => this.toast.error('Purchase failed — check Twilio funds + permissions'),
    });
  }

  release(n: PurchasedNumber): void {
    const ok = window.confirm(`Release ${this.format(n.phone_number)}? Inbound calls + texts will stop immediately.`);
    if (!ok) return;
    this.api.delete<void>(`/voice/numbers/${n.id}`).subscribe({
      next: () => { this.toast.success('Number released'); this.loadNumbers(); },
      error: () => this.toast.error('Failed to release number'),
    });
  }

  copy(num: string): void {
    navigator.clipboard.writeText(num).then(
      () => this.toast.success(`Copied ${this.format(num)}`),
      () => this.toast.error('Copy failed'),
    );
  }

  /**
   * Speak a vanity word aloud via Web Speech API on hover. Best-effort —
   * skipped silently if the browser doesn't support speech synthesis.
   * @example speak('LABOR')
   */
  speak(word: string): void {
    try {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const optIn = (() => { try { return localStorage.getItem('voice.speak.optin') === 'true'; } catch { return false; } })();
      if (!optIn) return;
      const u = new SpeechSynthesisUtterance(word.toLowerCase());
      u.volume = 0.6; u.rate = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  // ── Formatting helpers ────────────────────────────────────────────

  /** Format an E.164 number as "(NPA) NXX-XXXX" for human display. */
  format(e164: string): string {
    const d = e164.replace(/[^\d]/g, '').replace(/^1/, '');
    if (d.length !== 10) return e164;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }

  /**
   * Render a phone number with vanity letters bolded.
   * For "+18558522267" with vanity_match "LABOR" we render
   * "(855) 82L-ABOR" with L, A, B, O, R bolded.
   */
  vanityHtml(e164: string, vanity?: string): string {
    const d = e164.replace(/[^\d]/g, '').replace(/^1/, '');
    if (d.length !== 10) return this.escape(e164);
    const word = (vanity || '').toUpperCase().replace(/[^A-Z]/g, '');
    // Map letters → digits, find first contiguous match in the last 7 digits.
    const last7 = d.slice(3);
    let startIdx = -1;
    if (word.length >= 2) {
      const wordDigits = [...word].map((ch) => LETTER_TO_DIGIT[ch] ?? ch).join('');
      const idx = last7.indexOf(wordDigits);
      if (idx !== -1) startIdx = idx;
    }
    const parts: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dgt = last7[i];
      if (startIdx !== -1 && i >= startIdx && i < startIdx + word.length) {
        parts.push(`<b>${this.escape(word[i - startIdx])}</b>`);
      } else {
        parts.push(this.escape(dgt));
      }
    }
    // Insert dash between position 3 and 4 of last7.
    const styled = `${parts.slice(0, 3).join('')}-${parts.slice(3).join('')}`;
    return `(${d.slice(0, 3)}) ${styled}`;
  }

  private escape(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  }

  // ── Keyboard nav on result rows ───────────────────────────────────

  onResultKey(ev: KeyboardEvent, idx: number, c: NumberCandidate): void {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); void this.confirmBuy(c); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const rows = (ev.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="option"]');
      if (!rows) return;
      const next = ev.key === 'ArrowDown' ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx - 1);
      rows[next]?.focus();
    }
  }
}
