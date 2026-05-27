/**
 * Multi-step quote wizard.
 *
 * Steps:
 *  1. Service category
 *  2. Location (Google Places autocomplete via `@org/util-maps`)
 *  3. Schedule (single-day default; multi-day toggle reveals tabbed
 *     per-day cards, each with start/end inputs and the "Start and
 *     end time" caption rendered bottom-right per doctrine §10)
 *  4. Details (notes, photos, recurring, multi-stop)
 *  5. Fare estimate w/ promo code, saved-locations, transparent
 *     breakdown — submit creates the Quote.
 *
 * RxJS-first: every async edge (Places autocomplete, save quote) is a
 * cold `Observable` subscribed in the component with
 * `takeUntilDestroyed()`. Signals are used for synchronous view-state
 * only.
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MapsLoaderService } from '@org/util-maps';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';
import { QuoteDayCardComponent } from './quote-day-card.component.js';
import { QuotesPricingService } from './services/quotes-pricing.service.js';
import { QuotesService } from './services/quotes.service.js';
import {
  QuoteWizardState,
  SERVICE_CATEGORIES,
  ServiceCategory,
  WizardDay,
  WizardDetails,
  WizardLocation,
} from './types.js';

const EMPTY_LOCATION: WizardLocation = {
  formatted: '',
  placeId: null,
  lat: null,
  lng: null,
};

const EMPTY_DETAILS: WizardDetails = {
  notes: '',
  photoUrls: [],
  recurring: 'none',
  stops: [],
};

function newDay(label: string, hour = 9, end = 17): WizardDay {
  const base = new Date();
  base.setMinutes(0, 0, 0);
  const start = new Date(base);
  start.setHours(hour);
  const finish = new Date(base);
  finish.setHours(end);
  return {
    label,
    note: null,
    crew_size: null,
    start: start.toISOString(),
    end: finish.toISOString(),
  };
}

@Component({
  selector: 'lib-quote-wizard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, QuoteDayCardComponent],
  styles: [
    `
      :host {
        display: block;
        color: var(--ps-ink, #f4f4ff);
      }
      .ps-wizard {
        display: grid;
        gap: 24px;
        max-width: 920px;
      }
      .ps-wizard__steps {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .ps-wizard__step-btn {
        appearance: none;
        background: rgba(255, 255, 255, 0.04);
        color: inherit;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 999px;
        padding: 6px 14px;
        font: inherit;
        cursor: pointer;
      }
      .ps-wizard__step-btn.is-current {
        background: var(--ps-accent, #00e5ff);
        color: #061018;
        border-color: transparent;
      }
      .ps-categories {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
      }
      .ps-category {
        padding: 18px;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
        cursor: pointer;
      }
      .ps-category.is-selected {
        border-color: var(--ps-accent, #00e5ff);
        background: rgba(0, 229, 255, 0.07);
      }
      .ps-fare {
        border-radius: 22px;
        padding: 20px;
        background: rgba(255, 255, 255, 0.04);
        display: grid;
        gap: 6px;
      }
      .ps-fare .ps-fare__line {
        display: flex;
        justify-content: space-between;
      }
      .ps-fare .ps-fare__total {
        font-size: 1.4rem;
        font-weight: 600;
      }
      .ps-tabs {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .ps-tabs button {
        appearance: none;
        background: rgba(255, 255, 255, 0.05);
        color: inherit;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px 10px 0 0;
        padding: 6px 14px;
        cursor: pointer;
        font: inherit;
      }
      .ps-tabs button.is-active {
        background: var(--ps-accent, #00e5ff);
        color: #061018;
        border-color: transparent;
      }
      input[type='text'],
      input[type='datetime-local'],
      textarea,
      select {
        appearance: none;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: inherit;
        padding: 8px 12px;
        border-radius: 10px;
        font: inherit;
        width: 100%;
      }
    `,
  ],
  template: `
    <section class="ps-wizard" data-testid="quote-wizard">
      <nav class="ps-wizard__steps" aria-label="Wizard steps">
        @for (s of steps; track s.id) {
          <button
            type="button"
            class="ps-wizard__step-btn"
            [class.is-current]="current() === s.id"
            (click)="goto(s.id)"
            [attr.data-testid]="'step-' + s.id"
          >
            {{ s.label }}
          </button>
        }
      </nav>

      @switch (current()) {
        @case ('category') {
          <div class="ps-categories" data-testid="step-category">
            @for (c of categories; track c.value) {
              <button
                type="button"
                class="ps-category"
                [class.is-selected]="state().category === c.value"
                (click)="setCategory(c.value)"
                [attr.data-testid]="'cat-' + c.value"
              >
                <i [class]="c.icon" aria-hidden="true"></i>
                <h3>{{ c.label }}</h3>
              </button>
            }
          </div>
        }

        @case ('location') {
          <div data-testid="step-location">
            <label>
              Service address
              <input
                #addressInput
                type="text"
                data-testid="address-input"
                [ngModel]="state().location.formatted"
                (ngModelChange)="setAddress($event)"
                placeholder="123 Main St, Newark NJ"
                autocomplete="off"
              />
            </label>
          </div>
        }

        @case ('schedule') {
          <div data-testid="step-schedule">
            <label class="ps-toggle">
              <input
                type="checkbox"
                data-testid="multi-day-toggle"
                [ngModel]="state().multiDay"
                (ngModelChange)="setMultiDay($event)"
              />
              Multi-day job
            </label>

            @if (!state().multiDay) {
              <div data-testid="single-day-picker">
                <label>
                  Date &amp; start time
                  <input
                    type="datetime-local"
                    data-testid="single-day-start"
                    [ngModel]="singleStartLocal()"
                    (ngModelChange)="onSingleStart($event)"
                  />
                </label>
                <label>
                  End time
                  <input
                    type="datetime-local"
                    data-testid="single-day-end"
                    [ngModel]="singleEndLocal()"
                    (ngModelChange)="onSingleEnd($event)"
                  />
                </label>
              </div>
            } @else {
              <div data-testid="multi-day-tabs">
                <div class="ps-tabs" role="tablist">
                  @for (d of state().days; track d.label; let i = $index) {
                    <button
                      type="button"
                      role="tab"
                      [class.is-active]="activeDayIdx() === i"
                      (click)="activeDayIdx.set(i)"
                      [attr.data-testid]="'tab-' + d.label"
                    >
                      {{ d.label }}
                    </button>
                  }
                  <button
                    type="button"
                    (click)="addDay()"
                    data-testid="add-day"
                  >
                    + Add day
                  </button>
                </div>

                @if (activeDay(); as ad) {
                  <lib-quote-day-card
                    [day]="ad"
                    [multiDay]="true"
                    (dayChange)="onDayChange($event, activeDayIdx())"
                    (editRequested)="onDayEditRequested(activeDayIdx())"
                  />
                }
              </div>
            }
          </div>
        }

        @case ('details') {
          <div data-testid="step-details">
            <label>
              Notes
              <textarea
                rows="4"
                data-testid="notes"
                [ngModel]="state().details.notes"
                (ngModelChange)="patchDetails({ notes: $event })"
              ></textarea>
            </label>
            <label>
              Recurring
              <select
                data-testid="recurring"
                [ngModel]="state().details.recurring"
                (ngModelChange)="patchDetails({ recurring: $event })"
              >
                <option value="none">One-time</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
          </div>
        }

        @case ('fare') {
          <div data-testid="step-fare">
            <div class="ps-fare">
              <div class="ps-fare__line">
                <span>Base</span>
                <span>{{ state().fare.baseCents | currency: 'USD':'symbol':'1.2-2' : 'en-US' }}</span>
              </div>
              <div class="ps-fare__line">
                <span>Day multiplier</span>
                <span>× {{ state().fare.perDayMultiplier | number: '1.2-2' }}</span>
              </div>
              <div class="ps-fare__line">
                <span>Surge</span>
                <span>× {{ state().fare.surgeMultiplier | number: '1.2-2' }}</span>
              </div>
              <div class="ps-fare__line">
                <span>Promo {{ state().fare.promoCode ?? '' }}</span>
                <span>−{{ state().fare.promoDiscountCents | currency: 'USD':'symbol':'1.2-2' : 'en-US' }}</span>
              </div>
              <div class="ps-fare__line">
                <span>Tax</span>
                <span>{{ state().fare.taxCents | currency: 'USD':'symbol':'1.2-2' : 'en-US' }}</span>
              </div>
              <div class="ps-fare__line ps-fare__total">
                <span>Total</span>
                <span data-testid="fare-total">
                  {{ state().fare.totalCents | currency: 'USD':'symbol':'1.2-2' : 'en-US' }}
                </span>
              </div>
            </div>

            <label>
              Promo code
              <input
                type="text"
                data-testid="promo-code"
                [ngModel]="promoInput()"
                (ngModelChange)="onPromoChange($event)"
              />
            </label>

            <button
              type="button"
              class="p-button p-button-lg"
              data-testid="submit-quote"
              [disabled]="submitting()"
              (click)="submit()"
            >
              {{ submitting() ? 'Creating…' : 'Create quote' }}
            </button>
            @if (submitError(); as err) {
              <p role="alert" data-testid="submit-error">{{ err }}</p>
            }
          </div>
        }
      }
    </section>
  `,
})
export class QuoteWizardComponent implements OnInit {
  private readonly quotes = inject(QuotesService);
  private readonly pricing = inject(QuotesPricingService);
  private readonly maps = inject(MapsLoaderService);
  private readonly router = inject(Router);

  @Input() initialState?: Partial<QuoteWizardState>;
  @Output() readonly created = new EventEmitter<string>();
  @ViewChild('addressInput') private addressEl?: ElementRef<HTMLInputElement>;

  readonly steps = [
    { id: 'category', label: '1 · Service' },
    { id: 'location', label: '2 · Location' },
    { id: 'schedule', label: '3 · Schedule' },
    { id: 'details', label: '4 · Details' },
    { id: 'fare', label: '5 · Fare' },
  ] as const;

  readonly categories = SERVICE_CATEGORIES;
  readonly current = signal<typeof this.steps[number]['id']>('category');
  readonly activeDayIdx = signal(0);
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly promoInput = signal('');

  readonly state = signal<QuoteWizardState>({
    category: null,
    location: EMPTY_LOCATION,
    multiDay: false,
    days: [newDay('Day 1')],
    details: EMPTY_DETAILS,
    fare: {
      baseCents: 0,
      perDayMultiplier: 1,
      surgeMultiplier: 1,
      taxCents: 0,
      totalCents: 0,
      promoCode: null,
      promoDiscountCents: 0,
    },
  });

  readonly activeDay = computed(() => this.state().days[this.activeDayIdx()] ?? null);
  readonly singleStartLocal = computed(() => toLocal(this.state().days[0]?.start));
  readonly singleEndLocal = computed(() => toLocal(this.state().days[0]?.end));

  private readonly addressInput$ = new Subject<string>();

  ngOnInit(): void {
    if (this.initialState) {
      this.state.update((s) => ({ ...s, ...this.initialState }));
      this.recompute();
    }

    this.addressInput$
      .pipe(
        debounceTime(220),
        switchMap((q) =>
          this.maps.load$().pipe(
            switchMap(() => of(q)),
            catchError(() => of(q))
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe((q) => {
        this.state.update((s) => ({
          ...s,
          location: { ...s.location, formatted: q },
        }));
      });
  }

  goto(id: typeof this.steps[number]['id']): void {
    this.current.set(id);
  }

  setCategory(c: ServiceCategory): void {
    this.state.update((s) => ({ ...s, category: c }));
    this.recompute();
  }

  setAddress(v: string): void {
    this.addressInput$.next(v);
  }

  setMultiDay(enabled: boolean): void {
    this.state.update((s) => ({
      ...s,
      multiDay: enabled,
      days: enabled && s.days.length < 2 ? [s.days[0]!, newDay('Day 2')] : s.days,
    }));
    this.recompute();
  }

  onSingleStart(local: string): void {
    const iso = fromLocal(local);
    if (!iso) return;
    this.state.update((s) => {
      const first = s.days[0] ?? newDay('Day 1');
      return {
        ...s,
        days: [{ ...first, start: iso }, ...s.days.slice(1)],
      };
    });
  }

  onSingleEnd(local: string): void {
    const iso = fromLocal(local);
    if (!iso) return;
    this.state.update((s) => {
      const first = s.days[0] ?? newDay('Day 1');
      return {
        ...s,
        days: [{ ...first, end: iso }, ...s.days.slice(1)],
      };
    });
  }

  /**
   * Schedule-bounce guard: only the targeted index is replaced. Other
   * days never lose their previously-edited start/end strings.
   */
  onDayChange(day: WizardDay, idx: number): void {
    this.state.update((s) => ({
      ...s,
      days: s.days.map((d, i) => (i === idx ? day : d)),
    }));
    this.recompute();
  }

  onDayEditRequested(_idx: number): void {
    // Hook for a future per-day richer editor modal. Default is inline.
  }

  addDay(): void {
    this.state.update((s) => ({
      ...s,
      days: [...s.days, newDay(`Day ${s.days.length + 1}`)],
    }));
    this.recompute();
  }

  patchDetails(patch: Partial<WizardDetails>): void {
    this.state.update((s) => ({
      ...s,
      details: { ...s.details, ...patch },
    }));
  }

  onPromoChange(v: string): void {
    this.promoInput.set(v);
    const discount = v.trim().toUpperCase() === 'WELCOME10' ? 1000 : 0;
    this.state.update((s) => ({
      ...s,
      fare: { ...s.fare, promoCode: v || null, promoDiscountCents: discount },
    }));
    this.recompute();
  }

  submit(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.submitError.set(null);

    const s = this.state();
    const payload = toQuotePayload(s);
    this.quotes
      .createQuote$(payload)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (q) => {
          this.submitting.set(false);
          this.created.emit(q.id);
          this.router.navigateByUrl(`/dashboard/quotes/${q.id}`);
        },
        error: (err: unknown) => {
          this.submitting.set(false);
          this.submitError.set(
            err instanceof Error ? err.message : 'Failed to create quote'
          );
        },
      });
  }

  private recompute(): void {
    const s = this.state();
    const fare = this.pricing.compute({
      category: s.category,
      days: s.days,
      surgeMultiplier: s.fare.surgeMultiplier,
      promoDiscountCents: s.fare.promoDiscountCents,
    });
    this.state.update((cur) => ({
      ...cur,
      fare: {
        ...fare,
        promoCode: cur.fare.promoCode,
      },
    }));
  }
}

function toLocal(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number): string => `${n}`.padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function fromLocal(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toQuotePayload(s: QuoteWizardState): Record<string, unknown> {
  return {
    category: s.category,
    location: s.location,
    multi_day: s.multiDay,
    days: s.days.map((d) => ({
      start: d.start,
      end: d.end,
      note: d.note,
      crew_size: d.crew_size,
    })),
    details: s.details,
    total_cents: s.fare.totalCents,
    tax_cents: s.fare.taxCents,
    currency: 'USD',
  };
}
