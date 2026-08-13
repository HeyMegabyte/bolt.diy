import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

/** `GET /api/referral/code` response. */
interface ReferralCodeResponse {
  code: string;
  referral_url: string;
  clicks: number;
  conversions: number;
}

/**
 * Refer-a-friend card — the client for the `referral_loop` feature. Shows the
 * org's referral link with a one-click copy plus click/conversion counters, on
 * the /admin getting-started hub.
 *
 * @remarks
 * The API IS the flag gate: `GET /api/referral/code` returns 404 when the
 * `referral_loop` flag is off → the widget renders nothing. It also self-hides
 * when the org has no site yet (the worker returns an empty code), so a brand-new
 * account stays clean.
 *
 * @example
 * <app-referral-card />
 */
@Component({
  selector: 'app-referral-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <section class="rc" role="region" aria-labelledby="rc-heading" data-testid="referral-widget">
        <header class="rc-head">
          <div>
            <p class="rc-eyebrow">Grow with rewards</p>
            <h2 id="rc-heading" class="rc-title">Refer a friend</h2>
          </div>
          <div class="rc-stats">
            <span class="rc-stat"><span class="rc-num" data-testid="referral-clicks">{{ data()!.clicks }}</span><span class="rc-lbl">clicks</span></span>
            <span class="rc-stat"><span class="rc-num" data-testid="referral-conversions">{{ data()!.conversions }}</span><span class="rc-lbl">signups</span></span>
          </div>
        </header>
        <p class="rc-copy">Share your link — when a friend builds a site, you both win.</p>
        <div class="rc-linkrow">
          <input
            class="rc-url"
            type="text"
            readonly
            [value]="data()!.referral_url"
            data-testid="referral-url"
            aria-label="Your referral link"
            (focus)="selectAll($event)"
          />
          <button type="button" class="rc-copy-btn" (click)="copy()" data-testid="referral-copy" [attr.aria-label]="copied() ? 'Link copied' : 'Copy referral link'">
            {{ copied() ? 'Copied ✓' : 'Copy link' }}
          </button>
        </div>
        <p class="rc-code">Code: <strong data-testid="referral-code">{{ data()!.code }}</strong></p>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .rc {
      margin: 0 0 1.25rem; padding: 1.25rem 1.4rem;
      border: 1px solid color-mix(in oklch, var(--ps-violet, #7c3aed) 22%, transparent);
      border-radius: var(--ps-radius-xl, 22px);
      background:
        radial-gradient(120% 140% at 100% 0%, color-mix(in oklch, var(--ps-violet, #7c3aed) 10%, transparent), transparent 60%),
        rgba(255,255,255,0.015);
    }
    .rc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
    .rc-eyebrow { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #a78bfa; margin: 0 0 0.25rem; }
    .rc-title { font-size: 1.05rem; font-weight: 700; margin: 0; color: var(--ps-ink, #f4f4ff); }
    .rc-stats { display: flex; gap: 1.1rem; }
    .rc-stat { display: flex; flex-direction: column; align-items: flex-end; line-height: 1; }
    .rc-num { font-size: 1.25rem; font-weight: 800; font-variant-numeric: tabular-nums; color: #a78bfa; }
    .rc-lbl { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.45); margin-top: 3px; }
    .rc-copy { font-size: 0.84rem; color: rgba(255,255,255,0.6); margin: 0 0 0.9rem; max-width: 52ch; }
    .rc-linkrow { display: flex; gap: 0.5rem; margin-bottom: 0.7rem; flex-wrap: wrap; }
    .rc-url {
      flex: 1 1 240px; min-width: 0; padding: 0.55rem 0.8rem; border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.28);
      color: var(--ps-ink, #f4f4ff); font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.78rem;
      overflow: hidden; text-overflow: ellipsis;
    }
    .rc-url:focus-visible { outline: 2px solid #a78bfa; outline-offset: 1px; }
    .rc-copy-btn {
      flex-shrink: 0; padding: 0.55rem 1.1rem; border-radius: 12px; border: 0; cursor: pointer;
      font-size: 0.82rem; font-weight: 700; color: #0b0416;
      background: linear-gradient(135deg, #a78bfa, #7c3aed);
      transition: filter 0.16s ease, transform 0.16s ease;
    }
    .rc-copy-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .rc-copy-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .rc-copy-btn { transition: none; } .rc-copy-btn:hover { transform: none; } }
    .rc-code { font-size: 0.72rem; color: rgba(255,255,255,0.45); margin: 0; }
    .rc-code strong { color: #a78bfa; font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.04em; }
  `],
})
export class ReferralCardComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly data = signal<ReferralCodeResponse | null>(null);
  readonly copied = signal(false);

  /** Show only when we have a real (non-empty) referral code. */
  readonly visible = computed(() => {
    const d = this.data();
    return !!d && !!d.code && !!d.referral_url;
  });

  ngOnInit(): void {
    // `silent: true` — a 404 (flag off) is expected, never a user-facing toast.
    this.api.get<ReferralCodeResponse>('/referral/code', undefined, { silent: true }).subscribe({
      next: (res) => this.data.set(res),
      error: () => this.data.set(null),
    });
  }

  /** Copy the referral URL to the clipboard, with a transient "Copied" state. */
  copy(): void {
    const url = this.data()?.referral_url;
    if (!url) return;
    const done = () => this.copied.set(true);
    try {
      navigator.clipboard?.writeText(url).then(done).catch(done);
    } catch {
      done();
    }
  }

  /** Select the whole URL on focus so a manual copy is one keystroke. */
  selectAll(ev: FocusEvent): void {
    (ev.target as HTMLInputElement | null)?.select();
  }
}
