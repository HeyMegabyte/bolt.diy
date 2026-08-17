import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AdminStateService } from '../../pages/admin/admin-state.service';

/** One annotation, mirrors the worker shape. */
interface Annotation {
  id: string;
  siteId: string;
  date: string;
  note: string;
  category: string;
  createdAt: string;
}

const CATEGORIES = ['deploy', 'marketing', 'incident', 'other'] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * Timeline notes — the client for the `analytics_annotations` feature. Lets an
 * owner annotate their site's timeline (deploys / campaigns / incidents) from the
 * Snapshots surface, with add + delete.
 *
 * @remarks
 * Reacts to `AdminStateService.selectedSite()`. The API IS the flag gate — a 404
 * on the list means the feature is off, so the panel stays hidden.
 *
 * @example
 * <app-timeline-notes />
 */
@Component({
  selector: 'app-timeline-notes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (visible()) {
      <section class="tn" role="region" aria-labelledby="tn-heading" data-testid="timeline-notes">
        <header class="tn-head">
          <h2 id="tn-heading" class="tn-title">Timeline notes</h2>
          <span class="tn-count">{{ entries().length }}</span>
        </header>

        <form class="tn-form" (ngSubmit)="add()">
          <input
            class="tn-input"
            type="text"
            name="note"
            [(ngModel)]="draftNote"
            placeholder="Mark an event — e.g. “Launched summer campaign”"
            maxlength="200"
            aria-label="Note"
            data-testid="timeline-note-input"
          />
          <select class="tn-cat" name="category" [(ngModel)]="draftCategory" aria-label="Category" data-testid="timeline-note-category">
            @for (c of categories; track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
          <button class="tn-add" type="submit" [disabled]="!draftNote.trim() || busy()" data-testid="timeline-note-add">
            {{ busy() ? 'Adding…' : 'Add note' }}
          </button>
        </form>

        @if (entries().length === 0) {
          <p class="tn-empty" data-testid="timeline-notes-empty">No notes yet — add a marker for a deploy, campaign, or incident.</p>
        } @else {
          <ul class="tn-list">
            @for (a of entries(); track a.id) {
              <li class="tn-item" data-testid="timeline-note-item" [attr.data-id]="a.id">
                <span class="tn-chip" [class]="'tn-chip--' + a.category">{{ a.category }}</span>
                <span class="tn-date">{{ a.date }}</span>
                <span class="tn-note">{{ a.note }}</span>
                <button class="tn-del" type="button" (click)="remove(a)" [attr.aria-label]="'Delete note: ' + a.note" data-testid="timeline-note-delete">✕</button>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .tn { margin: 0 0 1.25rem; padding: 1.1rem 1.3rem; border: 1px solid rgba(255,255,255,0.08); border-radius: var(--ps-radius-xl, 22px); background: rgba(255,255,255,0.015); }
    .tn-head { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.8rem; }
    .tn-title { font-size: 0.95rem; font-weight: 700; margin: 0; color: var(--ps-ink, #f4f4ff); }
    .tn-count { font-size: 0.66rem; font-weight: 700; padding: 1px 8px; border-radius: 999px; color: var(--ps-accent, #00e5ff); background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent); }
    .tn-form { display: flex; gap: 0.5rem; margin-bottom: 0.9rem; flex-wrap: wrap; }
    .tn-input { flex: 1 1 220px; min-width: 0; padding: 0.5rem 0.75rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.28); color: var(--ps-ink, #f4f4ff); font-size: 0.82rem; }
    .tn-input:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 1px; }
    .tn-cat { padding: 0.5rem 0.6rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.28); color: var(--ps-ink, #f4f4ff); font-size: 0.78rem; text-transform: capitalize; }
    .tn-add { flex-shrink: 0; padding: 0.5rem 1rem; border-radius: 10px; border: 0; cursor: pointer; font-size: 0.8rem; font-weight: 700; color: #041016; background: var(--ps-accent, #00e5ff); transition: filter 0.16s ease; }
    .tn-add:hover:not(:disabled) { filter: brightness(1.08); }
    .tn-add:disabled { opacity: 0.5; cursor: default; }
    .tn-add:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .tn-empty { font-size: 0.8rem; color: rgba(255,255,255,0.7); margin: 0; }
    .tn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
    .tn-item { display: flex; align-items: center; gap: 0.6rem; padding: 0.4rem 0; border-top: 1px solid rgba(255,255,255,0.04); min-width: 0; }
    .tn-item:first-child { border-top: 0; }
    .tn-chip { flex-shrink: 0; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 999px; }
    .tn-chip--deploy { color: #34d399; background: color-mix(in oklch, #34d399 14%, transparent); }
    .tn-chip--marketing { color: #a78bfa; background: color-mix(in oklch, #a78bfa 16%, transparent); }
    .tn-chip--incident { color: #f87171; background: color-mix(in oklch, #f87171 14%, transparent); }
    .tn-chip--other { color: var(--ps-accent, #00e5ff); background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent); }
    .tn-date { flex-shrink: 0; font-size: 0.7rem; color: rgba(255,255,255,0.72); font-variant-numeric: tabular-nums; }
    .tn-note { flex: 1; min-width: 0; font-size: 0.82rem; color: var(--ps-ink, #f4f4ff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tn-del { flex-shrink: 0; background: transparent; border: 0; color: rgba(255,255,255,0.6); cursor: pointer; font-size: 0.8rem; padding: 2px 6px; border-radius: 6px; }
    .tn-del:hover { color: #f87171; }
    .tn-del:focus-visible { outline: 2px solid #f87171; outline-offset: 1px; }
  `],
})
export class TimelineNotesComponent {
  private readonly api = inject(ApiService);
  private readonly state = inject(AdminStateService);

  readonly categories = CATEGORIES;
  draftNote = '';
  draftCategory: Category = 'other';

  private readonly entriesSig = signal<Annotation[]>([]);
  private readonly loaded = signal(false);
  readonly busy = signal(false);
  private siteId: string | null = null;

  readonly entries = computed(() => this.entriesSig());
  /** Show once the list loads (200 = flag on) for a selected site. */
  readonly visible = computed(() => this.loaded() && !!this.siteId);

  constructor() {
    effect(() => {
      const id = this.state.selectedSite()?.id ?? null;
      if (id === this.siteId) return;
      this.siteId = id;
      this.loaded.set(false);
      this.entriesSig.set([]);
      if (id) this.load(id);
    });
  }

  private load(siteId: string): void {
    this.api.get<{ data: Annotation[] }>(`/sites/${siteId}/annotations`, undefined, { silent: true }).subscribe({
      next: (res) => {
        this.entriesSig.set(Array.isArray(res?.data) ? res.data : []);
        this.loaded.set(true);
      },
      error: () => this.loaded.set(false),
    });
  }

  /** Today as YYYY-MM-DD for the annotation date. */
  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  add(): void {
    const note = this.draftNote.trim();
    const siteId = this.siteId;
    if (!note || !siteId || this.busy()) return;
    this.busy.set(true);
    const body = { siteId, date: this.today(), note, category: this.draftCategory };
    this.api.post<{ id: string }>(`/sites/${siteId}/annotations`, body, { silent: true }).subscribe({
      next: (res) => {
        // Optimistically prepend the created note so the timeline updates instantly.
        if (res?.id) {
          this.entriesSig.update((cur) => [
            { id: res.id, siteId, date: body.date, note, category: body.category, createdAt: body.date },
            ...cur,
          ]);
        }
        this.draftNote = '';
        this.busy.set(false);
      },
      error: () => this.busy.set(false),
    });
  }

  remove(a: Annotation): void {
    // Optimistic removal; the DELETE route is site-agnostic (`/api/annotations/:id`).
    this.entriesSig.update((cur) => cur.filter((x) => x.id !== a.id));
    this.api.delete(`/annotations/${a.id}`, { silent: true }).subscribe({ next: () => {}, error: () => {} });
  }
}
