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
            <div class="view-toggle" role="tablist" aria-label="Result view">
              <button type="button" role="tab" [class.active]="view() === 'calendar'" (click)="view.set('calendar')" data-testid="campaign-view-calendar">Calendar</button>
              <button type="button" role="tab" [class.active]="view() === 'list'" (click)="view.set('list')" data-testid="campaign-view-list">List</button>
            </div>

            @if (view() === 'calendar') {
              <div class="cal" data-testid="campaign-calendar">
                <div class="cal-hd">
                  @for (w of weekdayLabels; track w) { <span>{{ w }}</span> }
                </div>
                <div class="cal-grid">
                  @for (cell of calendarDays(); track cell.iso) {
                    <div class="cal-day" [class.out]="!cell.inRange" [attr.title]="cell.iso">
                      <span class="dnum">{{ cell.dayNum }}</span>
                      @for (p of cell.posts; track p.id) {
                        <span class="chip" [attr.title]="prettyType(p.post_type)">{{ shortType(p.post_type) }}</span>
                      }
                    </div>
                  }
                </div>
              </div>
            } @else {
              <table>
                <thead><tr><th scope="col">Date</th><th scope="col">Post type</th></tr></thead>
                <tbody>
                  @for (d of r.drafts; track d.id) {
                    <tr><td>{{ d.date }}</td><td>{{ prettyType(d.post_type) }}</td></tr>
                  }
                </tbody>
              </table>
            }
            @if (scheduledCount() === null) {
              <button
                type="button"
                class="primary schedule-all"
                [disabled]="scheduling()"
                (click)="scheduleAll()"
                data-testid="campaign-schedule-all"
              >
                {{ scheduling() ? 'Scheduling…' : 'Schedule all ' + r.drafts_created + ' posts' }}
              </button>
            } @else {
              <p class="scheduled-ok" data-testid="campaign-scheduled-ok">
                ✓ Scheduled {{ scheduledCount() }} posts — they'll publish on their dates.
              </p>
            }
            @if (scheduleError()) {
              <p class="sched-err">{{ scheduleError() }}</p>
            }
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
      .schedule-all { margin-top: 14px; }
      .scheduled-ok { color: var(--ps-accent, #00e5ff); font-size: 0.9rem; margin-top: 14px; }
      .sched-err { color: #ff7a8a; font-size: 0.85rem; margin-top: 8px; }
      .view-toggle { display: flex; gap: 4px; margin: 4px 0 14px; }
      .view-toggle button { padding: 5px 12px; background: rgba(0, 229, 255, 0.06); border: 1px solid rgba(0, 229, 255, 0.12); color: var(--ps-ink, #f4f4ff); border-radius: 8px; cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; }
      .view-toggle button.active { background: rgba(0, 229, 255, 0.2); border-color: rgba(0, 229, 255, 0.5); }
      .cal-hd { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 4px; }
      .cal-hd span { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.5; text-align: center; }
      .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
      .cal-day { min-height: 52px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.06); background: rgba(255, 255, 255, 0.02); padding: 3px 4px; display: flex; flex-direction: column; gap: 2px; }
      .cal-day.out { opacity: 0.3; }
      .cal-day .dnum { font-size: 0.66rem; opacity: 0.55; font-family: 'JetBrains Mono', monospace; }
      .cal-day .chip { font-size: 0.6rem; background: rgba(0, 229, 255, 0.16); border: 1px solid rgba(0, 229, 255, 0.3); border-radius: 5px; padding: 1px 4px; line-height: 1.3; }
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

  scheduling = signal(false);
  scheduledCount = signal<number | null>(null);
  scheduleError = signal('');

  view = signal<'calendar' | 'list'>('calendar');
  readonly weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

  /** Week-aligned (Sun-start) day grid for the campaign, with posts bucketed per day. */
  calendarDays = computed(() => {
    const r = this.result();
    if (!r || r.drafts.length === 0) return [];
    const isos = r.drafts.map((d) => d.date).sort();
    const firstIso = isos[0];
    const lastIso = isos[isos.length - 1];
    const byDate = new Map<string, CampaignDraft[]>();
    for (const d of r.drafts) {
      const arr = byDate.get(d.date) ?? [];
      arr.push(d);
      byDate.set(d.date, arr);
    }
    const DAY = 86_400_000;
    const start = new Date(`${firstIso}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // back to Sunday
    const end = new Date(`${lastIso}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay())); // forward to Saturday
    const days: { iso: string; dayNum: number; inRange: boolean; posts: CampaignDraft[] }[] = [];
    for (let t = start.getTime(); t <= end.getTime(); t += DAY) {
      const dt = new Date(t);
      const iso = dt.toISOString().slice(0, 10);
      days.push({
        iso,
        dayNum: dt.getUTCDate(),
        inRange: iso >= firstIso && iso <= lastIso,
        posts: byDate.get(iso) ?? [],
      });
    }
    return days;
  });

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
      .get<{
        data: { business_name?: string; area_name?: string; services?: string[]; has_photos?: boolean };
      }>(`/social/campaign/prefill`, undefined, { silent: true })
      .subscribe({
        next: (res) => {
          const p = res?.data;
          if (p?.business_name && !this.businessName()) this.businessName.set(p.business_name);
          if (p?.area_name && !this.areaName()) this.areaName.set(p.area_name);
          if (Array.isArray(p?.services) && p.services.length > 0 && !this.servicesText()) {
            this.servicesText.set(p.services.join(', '));
          }
          if (p?.has_photos) this.hasPhotos.set(true);
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

  /** Compact archetype label for calendar chips (first segment, capitalized). */
  shortType(t: string): string {
    const first = t.split('_')[0] ?? t;
    return first.charAt(0).toUpperCase() + first.slice(1);
  }

  generate(): void {
    if (!this.canGenerate()) return;
    this.generating.set(true);
    this.error.set('');
    this.result.set(null);
    this.scheduledCount.set(null);
    this.scheduleError.set('');

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

  /** Flip every generated draft to `scheduled` in one action — they publish on their dates. */
  scheduleAll(): void {
    const r = this.result();
    if (!r || this.scheduling()) return;
    const post_ids = r.drafts.map((d) => d.id);
    if (post_ids.length === 0) return;
    this.scheduling.set(true);
    this.scheduleError.set('');
    this.api.post<{ data: { scheduled: number } }>(`/social/campaign/schedule`, { post_ids }).subscribe({
      next: (res) => {
        this.scheduledCount.set(res?.data?.scheduled ?? post_ids.length);
        this.scheduling.set(false);
      },
      error: () => {
        this.scheduleError.set('Could not schedule the campaign — please try again.');
        this.scheduling.set(false);
      },
    });
  }
}
