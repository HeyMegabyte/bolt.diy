import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { AdminSnapshotsDiffComponent } from './snapshots-diff.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * First coverage for the snapshot-diff viewer (untested) + the Retry added this round:
 *  - load() guards: no site / missing from|to ids → a clear error (no fetch)
 *  - load() success populates the diff + clears error
 *  - load() failure sets the error message + toasts (Retry recovers)
 * overrideComponent strips the diff template; load() is driven directly.
 */
function make(get: jasmine.Spy, siteId: string | null = 's1'): {
  c: AdminSnapshotsDiffComponent;
  toast: { error: jasmine.Spy };
} {
  const toast = { error: jasmine.createSpy('error'), success: () => 0 };
  TestBed.configureTestingModule({
    imports: [AdminSnapshotsDiffComponent],
    providers: [
      { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }) } },
      { provide: ApiService, useValue: { get } },
      { provide: ToastService, useValue: toast },
      { provide: AdminStateService, useValue: { selectedSite: signal(siteId ? { id: siteId } : null) } },
    ],
  });
  TestBed.overrideComponent(AdminSnapshotsDiffComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AdminSnapshotsDiffComponent).componentInstance, toast };
}

describe('AdminSnapshotsDiffComponent (diff load + guards)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('errors (no fetch) when no site is selected', async () => {
    const get = jasmine.createSpy('get');
    const { c } = make(get, null);
    c.fromId.set('a'); c.toId.set('b');
    await c.load();
    expect(c.error()).toContain('No site selected');
    expect(get).not.toHaveBeenCalled();
  });

  it('errors (no fetch) when from/to ids are missing', async () => {
    const get = jasmine.createSpy('get');
    const { c } = make(get);
    c.fromId.set(''); c.toId.set('');
    await c.load();
    expect(c.error()).toContain('required in the URL');
    expect(get).not.toHaveBeenCalled();
  });

  it('success populates the diff and clears the error', async () => {
    const get = jasmine.createSpy('get').and.returnValue(of({ added: [], removed: [], modified: [] }));
    const { c } = make(get);
    c.fromId.set('a'); c.toId.set('b');
    await c.load();
    expect(c.diff()).not.toBeNull();
    expect(c.error()).toBeNull();
    expect(c.loading()).toBe(false);
  });

  it('a fetch failure sets the inline error banner ONLY (read is {silent}, no toast on top); Retry then recovers', async () => {
    const get = jasmine.createSpy('get').and.returnValues(
      throwError(() => new Error('boom')),
      of({ added: [], removed: [], modified: [] }),
    );
    const { c, toast } = make(get);
    c.fromId.set('a'); c.toId.set('b');
    await c.load();
    // error() is now the raw cause ('boom') — the <app-error-card> title carries
    // the "Couldn't load the diff" headline, so the message isn't doubled.
    expect(c.error()).toBe('boom');
    // card is the UX; the read is {silent} so the generic toast can't fire and
    // the component no longer toasts on top of its own banner.
    expect(toast.error).not.toHaveBeenCalled();
    expect(get.calls.first().args[2]).toEqual({ silent: true });
    expect(c.loading()).toBe(false);
    // Retry path (the button added this round)
    await c.load();
    expect(c.error()).toBeNull();
    expect(c.diff()).not.toBeNull();
  });

  it('captures the worker request_id for the <app-error-card> support reference, and resets it on a clean reload', async () => {
    const get = jasmine.createSpy('get').and.returnValues(
      throwError(() => ({ error: { error: { request_id: 'req-snap-9' } } })),
      of({ added: [], removed: [], modified: [] }),
    );
    const { c } = make(get);
    c.fromId.set('a'); c.toId.set('b');
    await c.load();
    expect(c.error()).not.toBeNull();
    expect(c.loadErrorRef()).toBe('req-snap-9'); // surfaced as the card's copyable ref
    // A successful reload clears both the error and the stale reference.
    await c.load();
    expect(c.error()).toBeNull();
    expect(c.loadErrorRef()).toBe('');
  });
});

/**
 * The "Computing diff…" loading state was a bare <div> — visible text but no
 * live region, so screen-reader users got no announcement while the diff
 * computed. This full-render block (template NOT stripped) locks the announced
 * + cyan-spinner loading card.
 */
describe('AdminSnapshotsDiffComponent (loading state is announced)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the loading card with role=status + aria-busy (announced to AT)', () => {
    TestBed.configureTestingModule({
      imports: [AdminSnapshotsDiffComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }) } },
        { provide: ApiService, useValue: { get: () => of({ added: [], removed: [], modified: [] }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    const fx = TestBed.createComponent(AdminSnapshotsDiffComponent);
    fx.detectChanges();
    fx.componentInstance.loading.set(true);
    fx.detectChanges();
    const card = (fx.nativeElement as HTMLElement).querySelector('[data-testid="snapshots-diff-loading"]');
    expect(card).withContext('announced loading card').not.toBeNull();
    expect(card?.getAttribute('role')).toBe('status');
    expect(card?.getAttribute('aria-busy')).toBe('true');
    expect(card?.textContent).toContain('Computing diff');
  });
});

describe('AdminSnapshotsDiffComponent (diff stat counts roll — cinematic-ui)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders Added/Removed/Modified as app-rolling-counter, not static text nodes', () => {
    TestBed.configureTestingModule({
      imports: [AdminSnapshotsDiffComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }) } },
        { provide: ApiService, useValue: { get: () => of({ added: [], removed: [], modified: [] }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    const fx = TestBed.createComponent(AdminSnapshotsDiffComponent);
    fx.detectChanges();
    fx.componentInstance.diff.set({
      from: { name: 'A' },
      to: { name: 'B' },
      added: [{ path: 'a.html' }],
      removed: [],
      modified: [{ path: 'b.html', hunks: [] }],
      summary: null,
    } as never);
    fx.componentInstance.loading.set(false);
    fx.componentInstance.error.set(null);
    fx.detectChanges();
    // the three prominent text-2xl diff counts are a cockpit stat row → must roll.
    const counters = (fx.nativeElement as HTMLElement).querySelectorAll('.grid-cols-3 app-rolling-counter');
    expect(counters.length).withContext('Added/Removed/Modified counts each roll via app-rolling-counter').toBe(3);
  });
});

/**
 * WCAG 1.4.1 Use of Color — the diff conveys added / removed / context by the
 * green / red / grey tint ALONE. A screen-reader user (or anyone who can't
 * distinguish the tints) gets no cue which lines changed how. Each hunk span
 * must carry a NON-COLOR alternative: a per-line aria-label ('Added line' /
 * 'Removed line' / 'Unchanged line') + a visible +/−/space gutter glyph, and
 * the scrollable <pre> must be a labelled region (mirrors seo.component's
 * role=region + the KPI role=group pattern).
 */
describe('AdminSnapshotsDiffComponent (diff a11y — non-color cue, WCAG 1.4.1)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function renderWithModified() {
    TestBed.configureTestingModule({
      imports: [AdminSnapshotsDiffComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }) } },
        { provide: ApiService, useValue: { get: () => of({ added: [], removed: [], modified: [] }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    const fx = TestBed.createComponent(AdminSnapshotsDiffComponent);
    fx.detectChanges();
    fx.componentInstance.diff.set({
      from: { name: 'A' },
      to: { name: 'B' },
      added: [],
      removed: [],
      modified: [{
        path: 'index.html',
        before: '',
        after: '',
        truncated: false,
        hunks: [
          { added: true, removed: false, value: 'new line\n' },
          { added: false, removed: true, value: 'gone line\n' },
          { added: false, removed: false, value: 'kept line\n' },
        ],
      }],
      summary: null,
    } as never);
    fx.componentInstance.loading.set(false);
    fx.componentInstance.error.set(null);
    fx.detectChanges();
    return fx;
  }

  it('labels each diff hunk with a non-color status (Added / Removed / Unchanged line)', () => {
    const fx = renderWithModified();
    const host = fx.nativeElement as HTMLElement;
    const add = host.querySelector('.diff-add');
    const rem = host.querySelector('.diff-rem');
    const ctx = host.querySelector('.diff-ctx');
    expect(add?.getAttribute('aria-label')).withContext('added hunk announces status').toBe('Added line');
    expect(rem?.getAttribute('aria-label')).withContext('removed hunk announces status').toBe('Removed line');
    expect(ctx?.getAttribute('aria-label')).withContext('context hunk announces status').toBe('Unchanged line');
  });

  it('carries a data-gutter +/−/space glyph per hunk so the cue survives without color', () => {
    const fx = renderWithModified();
    const host = fx.nativeElement as HTMLElement;
    expect(host.querySelector('.diff-add')?.getAttribute('data-gutter')).toBe('+');
    expect(host.querySelector('.diff-rem')?.getAttribute('data-gutter')).toBe('−');
    expect(host.querySelector('.diff-ctx')?.getAttribute('data-gutter')).toBe(' ');
  });

  it('wraps the scrollable diff in a labelled region (role=region + aria-label)', () => {
    const fx = renderWithModified();
    const host = fx.nativeElement as HTMLElement;
    const pre = host.querySelector('pre[role="region"]');
    expect(pre).withContext('diff <pre> is a labelled scroll region').not.toBeNull();
    expect(pre?.getAttribute('aria-label')).toContain('index.html');
  });
});

/**
 * WCAG 1.4.1 — the Added / Removed / Modified KPI stat row distinguishes the
 * three categories by tint (emerald / red / amber) alone. Each card needs a
 * role=group + aria-label so the count carries its category to AT, mirroring
 * seo.component's role=group stat pattern + analytics.component's KPI groups.
 */
describe('AdminSnapshotsDiffComponent (KPI stat row groups — WCAG 1.4.1)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('marks each stat card as a labelled group naming its category + count', () => {
    TestBed.configureTestingModule({
      imports: [AdminSnapshotsDiffComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }) } },
        { provide: ApiService, useValue: { get: () => of({ added: [], removed: [], modified: [] }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    const fx = TestBed.createComponent(AdminSnapshotsDiffComponent);
    fx.detectChanges();
    fx.componentInstance.diff.set({
      from: { name: 'A' },
      to: { name: 'B' },
      added: [{ path: 'a.html' }, { path: 'c.html' }],
      removed: [{ path: 'b.html' }],
      modified: [],
      summary: null,
    } as never);
    fx.componentInstance.loading.set(false);
    fx.componentInstance.error.set(null);
    fx.detectChanges();
    const groups = (fx.nativeElement as HTMLElement).querySelectorAll('.grid-cols-3 [role="group"]');
    expect(groups.length).withContext('three labelled KPI groups').toBe(3);
    const labels = Array.from(groups).map((g) => g.getAttribute('aria-label'));
    expect(labels).toContain('2 files added');
    expect(labels).toContain('1 file removed');
    expect(labels).toContain('0 files modified');
  });
});

/**
 * Cross-site result hygiene: the diff is for `?from&to` snapshot ids of the
 * SELECTED site. Switching sites (sidebar) must drop the stale diff and
 * re-evaluate — site A's snapshot diff can never sit under site B's header.
 */
describe('AdminSnapshotsDiffComponent (clears + reloads on site switch)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('drops the stale diff and reloads for the new site when the selection changes', async () => {
    const selectedSite = signal<{ id: string } | null>({ id: 's1' });
    const get = jasmine.createSpy('get').and.returnValue(of({ added: [], removed: [], modified: [] }));
    TestBed.configureTestingModule({
      imports: [AdminSnapshotsDiffComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: (k: string) => (k === 'from' ? 'A' : k === 'to' ? 'B' : null) }) } },
        { provide: ApiService, useValue: { get } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    const fx = TestBed.createComponent(AdminSnapshotsDiffComponent);
    fx.detectChanges();
    await fx.whenStable();
    const c = fx.componentInstance;
    expect(get.calls.mostRecent().args[0]).toBe('/sites/s1/snapshots/diff');
    expect(c.diff()).withContext('s1 diff present').not.toBeNull();
    get.calls.reset();

    // Operator switches site in the sidebar.
    selectedSite.set({ id: 's2' });
    fx.detectChanges(); // flush the effect
    expect(c.diff()).withContext('stale s1 diff dropped immediately').toBeNull();
    await fx.whenStable();
    expect(get).withContext('re-evaluated for the new site').toHaveBeenCalled();
    expect(get.calls.mostRecent().args[0]).toBe('/sites/s2/snapshots/diff');
  });
});
