/**
 * Pulse Social — AI campaign generator at `/admin/social/campaign`.
 *
 * Front end for `POST /api/social/campaign`: pick a length (7/14/30 days),
 * cadence, the business signals that shape copy (services, reviews, photos,
 * offers, area), and the target accounts → the worker plans a dated,
 * archetype-rotated campaign and drops `draft` posts the user reviews on the
 * main Social page. Pure standalone Angular + signals.
 */
import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../../services/api.service';
import { RevealDirective } from '../../../directives/reveal.directive';
import { SkeletonComponent, ErrorCardComponent } from '../../../components/states';

interface SocialAccount {
  id: string;
  platform: string;
  handle?: string | null;
  display_name?: string | null;
}

interface CampaignDraft {
  id: string;
  date: string;
  post_type: string;
}

interface CampaignResult {
  length: number;
  slot_count: number;
  drafts_created: number;
  drafts: CampaignDraft[];
}

@Component({
  selector: 'app-social-campaign',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, RevealDirective, SkeletonComponent, ErrorCardComponent],
  template: `
    <section class="page" appReveal data-testid="social-campaign-section">
      <header class="page-hd">
        <div>
          <h1>AI campaign generator</h1>
          <p class="sub">Generate a month of varied posts from your business — review the drafts, then publish.</p>
        </div>
        <a routerLink="/admin/social" class="ghost">← Back to Social</a>
      </header>

      <div class="grid">
        <!-- ── Form ── -->
        <form class="card" (ngSubmit)="generate()" data-testid="campaign-form">
          <h2>Campaign brief</h2>

          <label class="field">
            <span>Business name <em>required</em></span>
            <input type="text" [ngModel]="businessName()" (ngModelChange)="businessName.set($event)" name="business" placeholder="Vito's Mens Salon"
              [attr.aria-invalid]="businessName().trim().length === 0" data-testid="campaign-business" />
          </label>

          <label class="field">
            <span>Services <em>comma-separated</em></span>
            <input type="text" [ngModel]="servicesText()" (ngModelChange)="servicesText.set($event)" name="services" placeholder="Haircut, Beard Trim, Hot Towel Shave" />
          </label>

          <label class="field">
            <span>Area / neighborhood</span>
            <input type="text" [ngModel]="areaName()" (ngModelChange)="areaName.set($event)" name="area" placeholder="Lake Hiawatha, NJ" />
          </label>

          <fieldset class="row">
            <legend>Length</legend>
            @for (l of lengths; track l) {
              <button type="button" [class.active]="length() === l" (click)="length.set(l)"
                [attr.data-testid]="'campaign-len-' + l">{{ l }}d</button>
            }
          </fieldset>

          <label class="field">
            <span>Posts per week — {{ postsPerWeek() }}</span>
            <input type="range" min="1" max="7" [ngModel]="postsPerWeek()" (ngModelChange)="postsPerWeek.set(+$event)" name="ppw" />
          </label>

          <fieldset class="toggles">
            <legend>What we can draw on</legend>
            <label><input type="checkbox" [ngModel]="hasReviews()" (ngModelChange)="hasReviews.set($event)" name="rev" /> Customer reviews</label>
            <label><input type="checkbox" [ngModel]="hasPhotos()" (ngModelChange)="hasPhotos.set($event)" name="pho" /> Before/after photos</label>
            <label><input type="checkbox" [ngModel]="hasOffers()" (ngModelChange)="hasOffers.set($event)" name="off" /> A current offer</label>
          </fieldset>

          <fieldset class="accounts">
            <legend>Target accounts <em>required</em></legend>
            @if (loadingAccounts()) {
              <app-skeleton variant="text" [rows]="3" label="Loading accounts" />
            } @else if (accounts().length === 0) {
              <p class="empty">No connected accounts. <a routerLink="/admin/social">Connect one →</a></p>
            } @else {
              @for (a of accounts(); track a.id) {
                <label class="acct">
                  <input type="checkbox" [checked]="selected().has(a.id)" (change)="toggleAccount(a.id)" />
                  <span class="platform">{{ a.platform }}</span>
                  <span class="handle">{{ a.handle || a.display_name || a.id }}</span>
                </label>
              }
            }
          </fieldset>

          <button type="submit" class="primary" [disabled]="!canGenerate()" data-testid="campaign-generate">
            {{ generating() ? 'Generating…' : 'Generate campaign' }}
          </button>
        </form>

        <!-- ── Result ── -->
        <div class="card result" data-testid="campaign-result">
          <h2>Result</h2>
          @if (generating()) {
            <app-skeleton variant="table" [rows]="6" [columns]="2" label="Generating campaign" />
          } @else if (error()) {
            <app-error-card title="Couldn't generate the campaign" [message]="error()"
              hint="The AI service didn't respond. Check your connected accounts and try again."
              (retry)="generate()" />
          } @else if (result(); as r) {
            <p class="lede">Created <strong>{{ r.drafts_created }}</strong> draft posts across
              <strong>{{ r.length }}</strong> days.
              <a routerLink="/admin/social">Review &amp; schedule →</a></p>
            <table>
              <thead><tr><th scope="col">Date</th><th scope="col">Post type</th></tr></thead>
              <tbody>
                @for (d of r.drafts; track d.id) {
                  <tr><td>{{ d.date }}</td><td>{{ prettyType(d.post_type) }}</td></tr>
                }
              </tbody>
            </table>
          } @else {
            <p class="hint">Fill in the brief and hit <em>Generate</em>. Every post lands as a draft you approve before it publishes — nothing goes out automatically.</p>
          }
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; padding: 24px; color: var(--ps-ink, #f4f4ff); }
      .page-hd { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px; flex-wrap: wrap; gap: 16px; }
      h1 { font-family: 'Sora', system-ui, sans-serif; font-size: 1.6rem; margin: 0; }
      .sub { opacity: 0.7; margin: 4px 0 0; font-size: 0.92rem; }
      .ghost { color: var(--ps-accent, #00e5ff); text-decoration: none; font-size: 0.85rem; }
      .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; }
      @media (max-width: 880px) { .grid { grid-template-columns: 1fr; } }
      .card { padding: 18px 20px; border-radius: 14px; background: rgba(8, 8, 32, 0.55); border: 1px solid rgba(0, 229, 255, 0.12); }
      h2 { font-family: 'Sora', system-ui, sans-serif; font-size: 1.1rem; margin: 0 0 14px; }
      .field { display: block; margin-bottom: 14px; }
      .field > span { display: block; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.6; margin-bottom: 5px; }
      .field em { text-transform: none; letter-spacing: 0; opacity: 0.6; font-style: italic; }
      input[type='text'], input[type='range'] { width: 100%; box-sizing: border-box; }
      input[type='text'] { padding: 9px 11px; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(0, 229, 255, 0.18); border-radius: 8px; color: var(--ps-ink, #f4f4ff); font-size: 0.9rem; }
      input[type='text'][aria-invalid='true'] { border-color: rgba(255, 90, 110, 0.55); }
      fieldset { border: none; padding: 0; margin: 0 0 14px; }
      legend { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.6; margin-bottom: 7px; padding: 0; }
      .row { display: flex; gap: 6px; }
      .row button {
        padding: 7px 14px; background: rgba(0, 229, 255, 0.06); border: 1px solid rgba(0, 229, 255, 0.12);
        color: var(--ps-ink, #f4f4ff); border-radius: 8px; cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 0.8rem;
      }
      .row button.active { background: rgba(0, 229, 255, 0.2); border-color: rgba(0, 229, 255, 0.5); }
      .toggles label, .accounts .acct { display: flex; align-items: center; gap: 8px; font-size: 0.88rem; padding: 4px 0; }
      .accounts .platform { text-transform: capitalize; font-weight: 600; }
      .accounts .handle { opacity: 0.65; font-size: 0.82rem; }
      .empty, .hint { opacity: 0.6; font-size: 0.88rem; }
      .empty a, .hint a, .lede a { color: var(--ps-accent, #00e5ff); }
      button.primary {
        width: 100%; margin-top: 6px; padding: 11px; border-radius: 10px; cursor: pointer;
        background: rgba(0, 229, 255, 0.18); border: 1px solid rgba(0, 229, 255, 0.5);
        color: var(--ps-ink, #f4f4ff); font-family: 'Sora', system-ui, sans-serif; font-size: 0.95rem;
      }
      button.primary:disabled { opacity: 0.45; cursor: not-allowed; }
      .lede { font-size: 0.95rem; margin: 0 0 14px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); font-size: 0.88rem; font-weight: 400; }
      thead th { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.55; }
    `,
  ],
})
export class AdminSocialCampaignComponent implements OnInit {
  private api = inject(ApiService);

  readonly lengths = [7, 14, 30] as const;

  businessName = signal('');
  servicesText = signal('');
  areaName = signal('');
  length = signal<7 | 14 | 30>(30);
  postsPerWeek = signal(4);
  hasReviews = signal(false);
  hasPhotos = signal(false);
  hasOffers = signal(false);

  accounts = signal<SocialAccount[]>([]);
  selected = signal<Set<string>>(new Set<string>());
  loadingAccounts = signal(true);

  generating = signal(false);
  error = signal('');
  result = signal<CampaignResult | null>(null);

  /** Gate the submit: business name + ≥1 account + not already running (double-submit guard). */
  canGenerate = computed(
    () => this.businessName().trim().length > 0 && this.selected().size > 0 && !this.generating(),
  );

  ngOnInit(): void {
    this.api.get<{ data: SocialAccount[] }>(`/social/accounts`, undefined, { silent: true }).subscribe({
      next: (res) => {
        this.accounts.set(Array.isArray(res?.data) ? res.data : []);
        this.loadingAccounts.set(false);
      },
      error: () => {
        this.accounts.set([]);
        this.loadingAccounts.set(false);
      },
    });

    // Pre-fill the required brief fields from the org's site so the user
    // doesn't retype them (never overwrites anything they've already typed).
    this.api
      .get<{ data: { business_name?: string; area_name?: string } }>(`/social/campaign/prefill`, undefined, { silent: true })
      .subscribe({
        next: (res) => {
          const p = res?.data;
          if (p?.business_name && !this.businessName()) this.businessName.set(p.business_name);
          if (p?.area_name && !this.areaName()) this.areaName.set(p.area_name);
        },
        error: () => {
          /* prefill is best-effort — the form still works without it */
        },
      });
  }

  toggleAccount(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
  }

  /** Human-readable archetype label. */
  prettyType(t: string): string {
    return t
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  generate(): void {
    if (!this.canGenerate()) return;
    this.generating.set(true);
    this.error.set('');
    this.result.set(null);

    const services = this.servicesText()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const area = this.areaName().trim();

    const body = {
      spec: {
        length: this.length(),
        start_date: new Date().toISOString().slice(0, 10),
        posts_per_week: this.postsPerWeek(),
        account_ids: [...this.selected()],
      },
      signals: {
        business_name: this.businessName().trim(),
        services,
        has_reviews: this.hasReviews(),
        has_photos: this.hasPhotos(),
        has_offers: this.hasOffers(),
        ...(area ? { area_name: area } : {}),
      },
    };

    this.api.post<{ data: CampaignResult }>(`/social/campaign`, body).subscribe({
      next: (res) => {
        this.result.set(res.data);
        this.generating.set(false);
      },
      error: () => {
        this.error.set('Could not generate the campaign — please try again.');
        this.generating.set(false);
      },
    });
  }
}
