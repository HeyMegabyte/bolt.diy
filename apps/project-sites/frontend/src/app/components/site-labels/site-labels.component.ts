import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AdminStateService } from '../../pages/admin/admin-state.service';

/** One tag, mirrors the worker `TagResponse` shape. */
interface Tag {
  id: string;
  orgId: string;
  name: string;
  color: string;
  emoji: string | null;
  siteCount: number;
  createdAt: string;
}

const COLORS = ['blue', 'violet', 'green', 'amber', 'rose', 'cyan', 'orange', 'pink'] as const;
type Color = (typeof COLORS)[number];

/** Named hue → display hex for the pill (subset of the worker's TAG_COLORS). */
const HEX: Record<string, string> = {
  blue: '#60a5fa', violet: '#a78bfa', green: '#34d399', amber: '#fbbf24',
  rose: '#fb7185', cyan: '#22d3ee', orange: '#fb923c', pink: '#f472b6',
  red: '#f87171', teal: '#2dd4bf', indigo: '#818cf8', purple: '#c084fc',
  slate: '#94a3b8', gray: '#9ca3af', sky: '#38bdf8', emerald: '#34d399',
  lime: '#a3e635', yellow: '#facc15', fuchsia: '#e879f9', zinc: '#a1a1aa',
  neutral: '#a3a3a3', stone: '#a8a29e',
};

/**
 * Site labels — the client for the `site_tags` feature. Lets an owner label the
 * selected site with coloured tags (create + assign + remove) from Snapshots.
 *
 * @remarks
 * Reacts to `AdminStateService.selectedSite()`. The API IS the flag gate — a 404
 * on the site-tags list means the feature is off, so the panel stays hidden.
 * "Add label" creates an org tag AND assigns it to the site in one step; the pill
 * ✕ deletes the tag (which also removes its assignments).
 *
 * @example
 * <app-site-labels />
 */
@Component({
  selector: 'app-site-labels',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (visible()) {
      <section class="sl" role="region" aria-labelledby="sl-heading" data-testid="site-labels">
        <header class="sl-head">
          <h2 id="sl-heading" class="sl-title">Site labels</h2>
          <span class="sl-count">{{ tags().length }}</span>
        </header>

        @if (tags().length === 0) {
          <p class="sl-empty" data-testid="site-labels-empty">No labels yet — add one to organise this site.</p>
        } @else {
          <ul class="sl-pills">
            @for (t of tags(); track t.id) {
              <li class="sl-pill" data-testid="site-label-pill" [attr.data-name]="t.name" [style.--pill]="hex(t.color)">
                @if (t.emoji) { <span class="sl-emoji" aria-hidden="true">{{ t.emoji }}</span> }
                <span class="sl-name">{{ t.name }}</span>
                <button class="sl-x" type="button" (click)="remove(t)" [attr.aria-label]="'Remove label ' + t.name" data-testid="site-label-remove">✕</button>
              </li>
            }
          </ul>
        }

        <form class="sl-form" (ngSubmit)="add()">
          <input
            class="sl-input"
            type="text"
            name="label"
            [(ngModel)]="draftName"
            placeholder="New label — e.g. “client:acme”"
            maxlength="48"
            aria-label="Label name"
            data-testid="site-label-input"
          />
          <select class="sl-color" name="color" [(ngModel)]="draftColor" aria-label="Label colour" data-testid="site-label-color">
            @for (c of colors; track c) { <option [value]="c">{{ c }}</option> }
          </select>
          <button class="sl-add" type="submit" [disabled]="!draftName.trim() || busy()" data-testid="site-label-add">
            {{ busy() ? 'Adding…' : 'Add label' }}
          </button>
        </form>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .sl { margin: 0 0 1.25rem; padding: 1.1rem 1.3rem; border: 1px solid rgba(255,255,255,0.08); border-radius: var(--ps-radius-xl, 22px); background: rgba(255,255,255,0.015); }
    .sl-head { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.8rem; }
    .sl-title { font-size: 0.95rem; font-weight: 700; margin: 0; color: var(--ps-ink, #f4f4ff); }
    .sl-count { font-size: 0.66rem; font-weight: 700; padding: 1px 8px; border-radius: 999px; color: var(--ps-accent, #00e5ff); background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent); }
    .sl-empty { font-size: 0.8rem; color: rgba(255,255,255,0.45); margin: 0 0 0.8rem; }
    .sl-pills { list-style: none; margin: 0 0 0.9rem; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .sl-pill { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.28rem 0.35rem 0.28rem 0.7rem; border-radius: 999px; font-size: 0.78rem; font-weight: 600; color: var(--pill, #60a5fa); border: 1px solid color-mix(in oklch, var(--pill, #60a5fa) 40%, transparent); background: color-mix(in oklch, var(--pill, #60a5fa) 12%, transparent); }
    .sl-emoji { font-size: 0.85rem; }
    .sl-name { color: var(--ps-ink, #f4f4ff); }
    .sl-x { background: transparent; border: 0; color: var(--pill, #60a5fa); cursor: pointer; font-size: 0.7rem; line-height: 1; padding: 3px 5px; border-radius: 999px; }
    .sl-x:hover { background: color-mix(in oklch, var(--pill, #60a5fa) 22%, transparent); }
    .sl-x:focus-visible { outline: 2px solid var(--pill, #60a5fa); outline-offset: 1px; }
    .sl-form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .sl-input { flex: 1 1 200px; min-width: 0; padding: 0.5rem 0.75rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.28); color: var(--ps-ink, #f4f4ff); font-size: 0.82rem; }
    .sl-input:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 1px; }
    .sl-color { padding: 0.5rem 0.6rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.28); color: var(--ps-ink, #f4f4ff); font-size: 0.78rem; text-transform: capitalize; }
    .sl-add { flex-shrink: 0; padding: 0.5rem 1rem; border-radius: 10px; border: 0; cursor: pointer; font-size: 0.8rem; font-weight: 700; color: #041016; background: var(--ps-accent, #00e5ff); transition: filter 0.16s ease; }
    .sl-add:hover:not(:disabled) { filter: brightness(1.08); }
    .sl-add:disabled { opacity: 0.5; cursor: default; }
    .sl-add:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  `],
})
export class SiteLabelsComponent {
  private readonly api = inject(ApiService);
  private readonly state = inject(AdminStateService);

  readonly colors = COLORS;
  draftName = '';
  draftColor: Color = 'blue';

  private readonly tagsSig = signal<Tag[]>([]);
  private readonly loaded = signal(false);
  readonly busy = signal(false);
  private siteId: string | null = null;

  readonly tags = computed(() => this.tagsSig());
  readonly visible = computed(() => this.loaded() && !!this.siteId);

  constructor() {
    effect(() => {
      const id = this.state.selectedSite()?.id ?? null;
      if (id === this.siteId) return;
      this.siteId = id;
      this.loaded.set(false);
      this.tagsSig.set([]);
      if (id) this.load(id);
    });
  }

  hex(color: string): string {
    return HEX[color] ?? '#60a5fa';
  }

  private load(siteId: string): void {
    this.api.get<{ data: Tag[] }>(`/sites/${siteId}/tags`, undefined, { silent: true }).subscribe({
      next: (res) => {
        this.tagsSig.set(Array.isArray(res?.data) ? res.data : []);
        this.loaded.set(true);
      },
      error: () => this.loaded.set(false),
    });
  }

  /** Create an org tag AND assign it to the current site in one step. */
  add(): void {
    const name = this.draftName.trim();
    const siteId = this.siteId;
    if (!name || !siteId || this.busy()) return;
    this.busy.set(true);
    this.api.post<Tag>('/site-tags', { name, color: this.draftColor }, { silent: true }).subscribe({
      next: (tag) => {
        const ids = [...this.tags().map((t) => t.id), tag.id];
        this.api.put(`/sites/${siteId}/tags`, { tagIds: ids }, { silent: true }).subscribe({
          next: () => {
            this.draftName = '';
            this.busy.set(false);
            this.load(siteId);
          },
          error: () => this.busy.set(false),
        });
      },
      error: () => this.busy.set(false),
    });
  }

  /** Remove a label — deletes the tag (which also clears its site assignments). */
  remove(t: Tag): void {
    this.tagsSig.update((cur) => cur.filter((x) => x.id !== t.id));
    this.api.delete(`/site-tags/${t.id}`, { silent: true }).subscribe({ next: () => {}, error: () => {} });
  }
}
