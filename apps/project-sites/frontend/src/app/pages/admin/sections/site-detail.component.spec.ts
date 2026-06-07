import { TestBed } from '@angular/core/testing';
import { of, throwError, Subject } from 'rxjs';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { AdminSiteDetailComponent } from './site-detail.component';
import { ApiService } from '../../../services/api.service';
import { ConfirmService } from '../../../services/confirm.service';
import { ToastService } from '../../../services/toast.service';

/**
 * First coverage for the Site Detail tabs surface (untested):
 *  - filteredLogs() filters by level + search
 *  - setTab() switches the active tab
 *  - runSql(): blank query is a no-op (no POST); a result populates sqlResult + clears error;
 *    a failure sets sqlError (read-only D1 console — server enforces read-only, client surfaces errors)
 * overrideComponent strips the template so the log-tail/snapshot effects don't auto-fire;
 * the route paramMap stub drives the initial site id.
 */
function make(post = jasmine.createSpy('post').and.returnValue(of({ ok: true, columns: ['id'], rows: [{ id: 1 }], duration_ms: 5 }))): {
  c: AdminSiteDetailComponent;
  post: jasmine.Spy;
} {
  const api = { get: jasmine.createSpy('get').and.returnValue(of({ site: { id: 'site-1', slug: 's', name: 'S' } })), post };
  TestBed.configureTestingModule({
    imports: [AdminSiteDetailComponent],
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => 'site-1' }), queryParamMap: of({ get: () => null }) } },
    ],
  });
  TestBed.overrideComponent(AdminSiteDetailComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AdminSiteDetailComponent).componentInstance, post };
}

describe('AdminSiteDetailComponent (tabs + logs + SQL console)', () => {
  afterEach(() => { try { localStorage.clear(); } catch { /* */ } TestBed.resetTestingModule(); });

  it('filteredLogs applies the level filter and the search query', () => {
    const { c } = make();
    c.logs.set([
      { ts: 1, level: 'info', message: 'started build' },
      { ts: 2, level: 'error', message: 'build FAILED' },
      { ts: 3, level: 'info', message: 'served page' },
    ] as never);
    c.logLevel.set('error');
    expect(c.filteredLogs().length).toBe(1);
    c.logLevel.set('all');
    c.logSearch.set('build');
    expect(c.filteredLogs().map((r) => r.message)).toEqual(['started build', 'build FAILED']);
  });

  // The logs @empty message must be filter-aware: never claim "No logs yet"
  // while logs exist but a level/search filter hides them all.
  it('logsEmptyText says "no match" when a filter hides existing logs, "no logs yet" when truly empty', () => {
    const { c } = make();
    c.logs.set([]); c.logLevel.set('all'); c.logSearch.set('');
    expect(c.logsEmptyText()).withContext('truly empty').toContain('No logs yet');
    c.logs.set([{ ts: 1, level: 'info', message: 'served page' }] as never);
    c.logLevel.set('error'); // no error rows → filtered to zero, but logs exist
    expect(c.logsEmptyText()).withContext('level filter hides all → no-match').toContain('No logs match');
    c.logLevel.set('all'); c.logSearch.set('zzz-no-such-line');
    expect(c.logsEmptyText()).withContext('search hides all → no-match').toContain('No logs match');
    c.logSearch.set('');
    expect(c.logsEmptyText()).withContext('back to no filter → no-logs-yet copy').toContain('No logs yet');
  });

  it('setTab switches the active tab', () => {
    const { c } = make();
    expect(c.tab()).toBe('logs');
    c.setTab('sql');
    expect(c.tab()).toBe('sql');
  });

  it('runSql is a no-op on a blank query (no POST)', () => {
    const { c, post } = make();
    c.sqlQuery.set('   ');
    c.runSql();
    expect(post).not.toHaveBeenCalled();
  });

  it('runSql posts the query and populates the result, clearing error + running', () => {
    const { c, post } = make();
    c.sqlQuery.set('SELECT * FROM sites');
    c.runSql();
    expect(post).toHaveBeenCalled();
    expect(post.calls.mostRecent().args[0]).toContain('/sql/exec');
    expect(c.sqlResult()?.rows.length).toBe(1);
    expect(c.sqlError()).toBeNull();
    expect(c.sqlRunning()).toBe(false);
  });

  // The Run button had no [disabled] + runSql had no in-flight guard, so a slow
  // query let repeated clicks pile up concurrent /sql/exec POSTs (wasteful +
  // flickering results). sqlRunning() now guards re-entry.
  it('runSql fires only ONE POST while a query is in flight (no pile-up)', () => {
    const inflight = new Subject<unknown>(); // never completes → stays running
    const post = jasmine.createSpy('post').and.returnValue(inflight.asObservable());
    const { c } = make(post);
    c.sqlQuery.set('SELECT * FROM sites');
    c.runSql();
    c.runSql(); // second click while the first is still running
    expect(post).toHaveBeenCalledTimes(1);
    expect(c.sqlRunning()).toBeTrue();
  });

  it('runSql surfaces a query error without throwing (server read-only/validation errors)', () => {
    // Uses a SELECT (passes the client read-only guard) that the SERVER rejects,
    // so this still covers the server-error surface path.
    const { c } = make(jasmine.createSpy('post').and.returnValue(throwError(() => ({ error: { error: { message: 'no such table: ghost' } } }))));
    c.sqlQuery.set('SELECT * FROM ghost');
    c.runSql();
    expect(c.sqlError()).toContain('no such table');
    expect(c.sqlRunning()).toBe(false);
  });

  // Client-side read-only guard: a leading write/DDL keyword is blocked BEFORE the
  // POST — instant clear feedback + no wasted round-trip (the server is still the
  // real boundary). Defense-in-depth on a power-tool that could tempt a DROP.
  it('runSql BLOCKS a leading write statement client-side (no POST, clear read-only error)', () => {
    const { c, post } = make();
    for (const q of ['DELETE FROM sites', 'drop table users', '  UPDATE sites SET x=1', '-- note\nINSERT INTO t VALUES(1)']) {
      c.sqlError.set(null);
      c.sqlQuery.set(q);
      c.runSql();
      expect(post).withContext(`must not POST a write query: ${q}`).not.toHaveBeenCalled();
      expect(c.sqlError()).withContext(`read-only message for: ${q}`).toContain('read-only');
    }
  });

  it('runSql ALLOWS read queries (SELECT / WITH / EXPLAIN) through to the server', () => {
    for (const q of ['SELECT 1', 'with t as (select 1) select * from t', 'EXPLAIN QUERY PLAN SELECT 1']) {
      const { c, post } = make();
      c.sqlQuery.set(q);
      c.runSql();
      expect(post).withContext(`read query must POST: ${q}`).toHaveBeenCalled();
      TestBed.resetTestingModule();
    }
  });

  it('a SELECT with the word "update" inside it is NOT a false positive', () => {
    const { c, post } = make();
    c.sqlQuery.set("SELECT * FROM sites WHERE note = 'please update later'");
    c.runSql();
    expect(post).withContext('only the LEADING keyword gates — inner text is fine').toHaveBeenCalled();
    expect(c.sqlError()).toBeNull();
  });

  // ── Rollback must NOT claim a false success on failure (lying-UI guard) ──
  it('confirmRollback shows the rolled-back version + no error on success', () => {
    const okPost = jasmine.createSpy('post').and.returnValue(of({ ok: true, snapshot_name: 'v3' }));
    const { c } = make(okPost);
    c.pendingRollback.set({ id: 'snap-1', snapshot_name: 'v3' } as never);
    c.confirmRollback();
    expect(c.rollbackResult()).toBe('v3');
    expect(c.rollbackError()).toBeNull();
    expect(c.pendingRollback()).toBeNull();
    // {silent}: the inline rollback-error panel is the sole failure surface — no
    // generic ApiService double-toast over it.
    expect(okPost.calls.mostRecent().args[2]).toEqual({ silent: true });
  });

  it('confirmRollback surfaces an error + does NOT claim success when the rollback fails', () => {
    const failPost = jasmine
      .createSpy('post')
      .and.returnValue(throwError(() => ({ error: { error: { message: 'rollback boom' } } })));
    const { c } = make(failPost);
    c.pendingRollback.set({ id: 'snap-1', snapshot_name: 'v3' } as never);
    c.confirmRollback();
    expect(c.rollbackResult()).withContext('no false success message').toBeNull();
    expect(c.rollbackError()).toContain('boom');
    expect(c.pendingRollback()).withContext('dialog closed').toBeNull();
  });
});

describe('AdminSiteDetailComponent (cinematic entrance — matches sibling sections)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('the root section animates in on first paint (animate-fade-in), like every other admin section', () => {
    const api = { get: jasmine.createSpy('get').and.returnValue(of({ site: { id: 'site-1', slug: 's', name: 'S' }, columns: [], rows: [], logs: [], snapshots: [] })), post: jasmine.createSpy('post').and.returnValue(of({ ok: true })) };
    TestBed.configureTestingModule({
      imports: [AdminSiteDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => 'site-1' }), queryParamMap: of({ get: () => null }) } },
      ],
    });
    const f = TestBed.createComponent(AdminSiteDetailComponent);
    f.detectChanges();
    const root = (f.nativeElement as HTMLElement).querySelector('.site-detail');
    expect(root).withContext('site-detail root renders').not.toBeNull();
    expect(root!.classList.contains('animate-fade-in')).withContext('root must animate in (opacity-only, reduced-motion-safe) like sibling sections').toBe(true);
  });

  // The Logs + Snapshots tab empties used bare muted text; the cockpit standard
  // for a sub-panel empty is the cyan-glyph <app-mini-empty> primitive.
  function renderEmpty(): import('@angular/core/testing').ComponentFixture<AdminSiteDetailComponent> {
    const api = { get: jasmine.createSpy('get').and.returnValue(of({ site: { id: 'site-1', slug: 's', name: 'S' }, columns: [], rows: [], logs: [], snapshots: [] })), post: jasmine.createSpy('post').and.returnValue(of({ ok: true })) };
    TestBed.configureTestingModule({
      imports: [AdminSiteDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => 'site-1' }), queryParamMap: of({ get: () => null }) } },
      ],
    });
    const f = TestBed.createComponent(AdminSiteDetailComponent);
    f.detectChanges();
    return f;
  }

  it('the Logs tab empty uses the cyan-glyph <app-mini-empty> (not bare muted text)', () => {
    const f = renderEmpty();
    const tail = (f.nativeElement as HTMLElement).querySelector('[data-testid="site-logs-tail"]');
    expect(tail?.querySelector('app-mini-empty')).withContext('cyan-glyph empty primitive in the Logs tab').not.toBeNull();
    expect(tail?.querySelector('p.muted')).withContext('no bare muted "No logs yet." text').toBeNull();
  });

  it('the Snapshots tab empty uses the cyan-glyph <app-mini-empty>', () => {
    const f = renderEmpty();
    f.componentInstance.setTab('snapshots');
    f.detectChanges();
    const list = (f.nativeElement as HTMLElement).querySelector('[data-testid="site-snapshots-list"]');
    expect(list?.querySelector('app-mini-empty')).withContext('cyan-glyph empty primitive in the Snapshots tab').not.toBeNull();
  });

  it('never renders a bare ".projectsites.dev" subtitle when the site fails to resolve (falls back to the URL slug)', () => {
    // GET /sites/:id can 200 with { site: null } (id not fully resolvable) — site()
    // stays null and the header used to show a broken bare ".projectsites.dev".
    const api = { get: jasmine.createSpy('get').and.returnValue(of({ site: null })), post: jasmine.createSpy('post').and.returnValue(of({ ok: true })) };
    TestBed.configureTestingModule({
      imports: [AdminSiteDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => 'site-1' }), queryParamMap: of({ get: () => null }) } },
      ],
    });
    const f = TestBed.createComponent(AdminSiteDetailComponent);
    f.detectChanges();
    const sub = (f.nativeElement as HTMLElement).querySelector('.site-detail__subtitle');
    expect(sub).not.toBeNull();
    const txt = (sub!.textContent ?? '').trim();
    expect(txt).withContext('subtitle must not be a bare orphaned TLD').not.toBe('.projectsites.dev');
    expect(txt).withContext('falls back to the URL slug so the host is meaningful').toContain('site-1');
  });

  // The h1 must identify WHICH site you're viewing. A site whose record has an
  // empty name used to render the generic literal "Site" (indistinguishable from
  // a failed load) — now it falls back to the slug, which is meaningful context.
  function renderWithSite(site: unknown): HTMLElement {
    TestBed.resetTestingModule();
    const api = { get: jasmine.createSpy('get').and.returnValue(of({ site })), post: jasmine.createSpy('post').and.returnValue(of({ ok: true })) };
    TestBed.configureTestingModule({
      imports: [AdminSiteDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => 'e2e-site-1' }), queryParamMap: of({ get: () => null }) } },
      ],
    });
    const f = TestBed.createComponent(AdminSiteDetailComponent);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('h1 shows the site business name when present', () => {
    const el = renderWithSite({ id: 'e2e-site-1', slug: 'urban-fitness', name: 'Urban Fitness Co' });
    expect(el.querySelector('.site-detail__title')?.textContent?.trim()).toBe('Urban Fitness Co');
  });

  it('h1 falls back to the slug (not the generic "Site") when the name is empty', () => {
    const el = renderWithSite({ id: 'e2e-site-1', slug: 'urban-fitness', name: '' });
    const h1 = el.querySelector('.site-detail__title')?.textContent?.trim();
    expect(h1).withContext('a nameless site shows its slug, not an uninformative "Site"').toBe('urban-fitness');
    expect(h1).not.toBe('Site');
  });
});

/**
 * Disconnecting an integration is destructive (re-OAuth needed to restore). It
 * used a bespoke inline confirm <div> (custom modal — drift per the
 * one-dialog-primitive rule, no focus-trap/Esc/accessible-name). Now it routes
 * through the shared ConfirmService (branded CDK dialog) and the DELETE is
 * {silent} so a failure shows ONLY the specific 'Could not disconnect' toast.
 */
describe('AdminSiteDetailComponent (integration disconnect — confirm-gated via ConfirmService)', () => {
  function build(confirmResult: boolean, del = jasmine.createSpy('delete').and.returnValue(of({ ok: true }))): {
    c: AdminSiteDetailComponent; del: jasmine.Spy; confirm: jasmine.Spy; toastErr: jasmine.Spy;
  } {
    const confirm = jasmine.createSpy('confirm').and.resolveTo(confirmResult);
    const toastErr = jasmine.createSpy('error');
    TestBed.configureTestingModule({
      imports: [AdminSiteDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ site: { id: 's1', slug: 's', name: 'S' } }), post: () => of({}), delete: del } },
        { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => 's1' }), queryParamMap: of({ get: () => null }) } },
        { provide: ConfirmService, useValue: { confirm } },
        { provide: ToastService, useValue: { error: toastErr, success: () => 0, info: () => 0, warning: () => 0 } },
      ],
    });
    TestBed.overrideComponent(AdminSiteDetailComponent, { set: { template: '<div></div>', imports: [] } });
    return { c: TestBed.createComponent(AdminSiteDetailComponent).componentInstance, del, confirm, toastErr };
  }
  const PROV = { key: 'mailchimp', name: 'Mailchimp', status: 'connected' } as never;
  afterEach(() => TestBed.resetTestingModule());

  it('does NOT disconnect when the confirm is cancelled (no DELETE)', async () => {
    const { c, del, confirm } = build(false);
    await c.onDisconnect(PROV);
    expect(confirm).toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('disconnects via the shared ConfirmService — DELETE is {silent} (no generic double-toast)', async () => {
    const { c, del, confirm } = build(true);
    await c.onDisconnect(PROV);
    expect(confirm).toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith('/sites/s1/integrations/mailchimp', { silent: true });
  });

  it('a failed disconnect surfaces the specific error + does NOT optimistically flip the chip', async () => {
    const { c, toastErr } = build(true, jasmine.createSpy('delete').and.returnValue(throwError(() => ({ status: 500 }))));
    c.integrations.set([{ key: 'mailchimp', name: 'Mailchimp', status: 'connected' } as never]);
    await c.onDisconnect(PROV);
    expect(toastErr).toHaveBeenCalled();
    expect(c.integrations()[0].status).withContext('no lying optimistic flip on failure').toBe('connected');
  });
});

/**
 * Snapshot rollback OVERWRITES the live production site — the single most
 * destructive admin action. It used a bespoke inline confirm <div> (custom-modal
 * drift; and it lost its styling when the shared .confirm-dialog CSS was removed).
 * Now onRollbackClick gates through the shared ConfirmService (branded danger
 * dialog) before confirmRollback() fires the POST. The existing confirmRollback()
 * specs above still pass (they call it directly — the POST path is unchanged).
 */
describe('AdminSiteDetailComponent (snapshot rollback — confirm-gated, most destructive)', () => {
  function build(confirmResult: boolean): { c: AdminSiteDetailComponent; post: jasmine.Spy; confirm: jasmine.Spy } {
    const post = jasmine.createSpy('post').and.returnValue(of({ ok: true, snapshot_name: 'v3' }));
    const confirm = jasmine.createSpy('confirm').and.resolveTo(confirmResult);
    TestBed.configureTestingModule({
      imports: [AdminSiteDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ site: { id: 's1', slug: 's', name: 'S' } }), post, delete: () => of({}) } },
        { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => 's1' }), queryParamMap: of({ get: () => null }) } },
        { provide: ConfirmService, useValue: { confirm } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, info: () => 0, warning: () => 0 } },
      ],
    });
    TestBed.overrideComponent(AdminSiteDetailComponent, { set: { template: '<div></div>', imports: [] } });
    return { c: TestBed.createComponent(AdminSiteDetailComponent).componentInstance, post, confirm };
  }
  const SNAP = { id: 'snap-9', snapshot_name: 'launch-v3' } as never;
  afterEach(() => TestBed.resetTestingModule());

  it('does NOT roll back when the confirm is cancelled (no POST, no pending state left dangling)', async () => {
    const { c, post, confirm } = build(false);
    await c.onRollbackClick(SNAP);
    expect(confirm).toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(c.pendingRollback()).toBeNull();
  });

  it('rolls back via ConfirmService — POST fires to the rollback endpoint on confirm', async () => {
    const { c, post, confirm } = build(true);
    await c.onRollbackClick(SNAP);
    expect(confirm).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/sites/s1/snapshots/snap-9/rollback', {}, { silent: true });
    expect(c.rollbackResult()).toBe('v3');
  });
});

describe('AdminSiteDetailComponent (SQL starter queries)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('useSqlStarter fills the editor + runs the query (read-only POST to /sql/exec)', () => {
    const { c, post } = make();
    c.useSqlStarter("SELECT name FROM sqlite_master WHERE type='table'");
    expect(c.sqlQuery()).toContain('sqlite_master');
    expect(post).toHaveBeenCalledWith('/sites/site-1/sql/exec', { query: "SELECT name FROM sqlite_master WHERE type='table'" });
  });

  it('every starter query is read-only (passes the WRITE_LEAD client guard → fires a POST, no sqlError)', () => {
    const { c, post } = make();
    for (const st of c.sqlStarters) {
      post.calls.reset();
      c.sqlError.set('stale');
      c.useSqlStarter(st.query);
      expect(post).withContext(`${st.label} should be read-only + run`).toHaveBeenCalled();
      expect(c.sqlError()).withContext(`${st.label} must not trip the read-only guard`).toBeNull();
    }
  });
});

describe('AdminSiteDetailComponent (SQL result Copy JSON)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('copySqlResult writes the rows as JSON to the clipboard + flips the copied flag', async () => {
    const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { c } = make();
    const rows = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
    c.copySqlResult({ columns: ['id', 'name'], rows, duration_ms: 3 });
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(rows, null, 2));
    await Promise.resolve();
    expect(c.sqlCopied()).toBeTrue();
  });
});

describe('AdminSiteDetailComponent (SQL result row cap — perf)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('cappedRows renders at most sqlRenderCap rows (full data stays in the result for Copy JSON)', () => {
    const { c } = make();
    const big = Array.from({ length: 500 }, (_, i) => ({ id: i }));
    const r = { columns: ['id'], rows: big, duration_ms: 1 };
    expect(c.sqlRenderCap).toBe(200);
    expect(c.cappedRows(r).length).toBe(200);
    expect(r.rows.length).withContext('underlying result untouched — Copy JSON exports all').toBe(500);
  });

  it('cappedRows returns all rows when under the cap', () => {
    const { c } = make();
    const r = { columns: ['id'], rows: [{ id: 1 }, { id: 2 }], duration_ms: 1 };
    expect(c.cappedRows(r).length).toBe(2);
  });
});

describe('AdminSiteDetailComponent (paste-key save — no silent failure)', () => {
  function build(post: jasmine.Spy): { c: AdminSiteDetailComponent; toastErr: jasmine.Spy; toastOk: jasmine.Spy } {
    const toastErr = jasmine.createSpy('error');
    const toastOk = jasmine.createSpy('success');
    TestBed.configureTestingModule({
      imports: [AdminSiteDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ site: { id: 's1', slug: 's', name: 'S' }, providers: [] }), post, delete: () => of({}) } },
        { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => 's1' }), queryParamMap: of({ get: () => null }) } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: ToastService, useValue: { error: toastErr, success: toastOk, info: () => 0, warning: () => 0 } },
      ],
    });
    TestBed.overrideComponent(AdminSiteDetailComponent, { set: { template: '<div></div>', imports: [] } });
    return { c: TestBed.createComponent(AdminSiteDetailComponent).componentInstance, toastErr, toastOk };
  }
  const PROV = { key: 'mailchimp', name: 'Mailchimp', status: 'disconnected' } as never;
  afterEach(() => TestBed.resetTestingModule());

  it('on a FAILED key save: keeps the form open, keeps the typed key, toasts a specific error (no silent close)', () => {
    const { c, toastErr } = build(jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 400 }))));
    c.pasteKeyOpen.set('mailchimp');
    c.pasteKeyValue.set('bad-key');
    c.submitPasteKey(PROV);
    expect(toastErr).toHaveBeenCalled();
    expect(c.pasteKeyOpen()).withContext('form stays open so the user can fix + retry').toBe('mailchimp');
    expect(c.pasteKeyValue()).withContext('typed key preserved').toBe('bad-key');
    expect(c.pasteKeySaving()).toBeFalse();
  });

  it('on a SUCCESSFUL save: closes the form, clears the key, toasts success', () => {
    const { c, toastOk } = build(jasmine.createSpy('post').and.returnValue(of({ ok: true })));
    c.pasteKeyOpen.set('mailchimp');
    c.pasteKeyValue.set('good-key');
    c.submitPasteKey(PROV);
    expect(toastOk).toHaveBeenCalledWith('Connected Mailchimp');
    expect(c.pasteKeyOpen()).toBeNull();
    expect(c.pasteKeyValue()).toBe('');
  });

  it('posts {silent:true} (its own toasts are the sole feedback) + guards double-submit', () => {
    const gate = new Subject<unknown>();
    const post = jasmine.createSpy('post').and.returnValue(gate);
    const { c } = build(post);
    c.pasteKeyValue.set('k');
    c.submitPasteKey(PROV);
    expect(post).toHaveBeenCalledWith('/mcp/mailchimp/paste', { api_key: 'k', site_id: 's1' }, { silent: true });
    c.submitPasteKey(PROV); // second click while in-flight
    expect(post).withContext('double-submit guarded').toHaveBeenCalledTimes(1);
  });
});

/**
 * Stale-route fake-empty guard — a STALE worker route can return a parseable
 * but shapeless 200 (SPA/marketing HTML, or `{}`). ApiService's 2xx→404 remap
 * only fires on an UNPARSEABLE body, so a shapeless 200 reaches the SUCCESS path.
 * The list-set handlers must guard `Array.isArray(...)` so a shapeless 200
 * degrades honestly (visible error / keep the fallback catalog) instead of
 * fake-emptying the list or crashing the @for on a non-array.
 */
describe('AdminSiteDetailComponent (stale-route shapeless 200 — no fake-empty / no crash)', () => {
  afterEach(() => { try { localStorage.clear(); } catch { /* */ } TestBed.resetTestingModule(); });

  function buildWithGet(getRes: unknown): AdminSiteDetailComponent {
    const api = {
      get: jasmine.createSpy('get').and.returnValue(of(getRes)),
      post: jasmine.createSpy('post').and.returnValue(of({ ok: true })),
      delete: () => of({}),
    };
    TestBed.configureTestingModule({
      imports: [AdminSiteDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => 'site-1' }), queryParamMap: of({ get: () => null }) } },
      ],
    });
    TestBed.overrideComponent(AdminSiteDetailComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(AdminSiteDetailComponent).componentInstance;
  }

  it('loadSnapshots: a shapeless 200 ({} — no snapshots array) sets a visible error and keeps the list a safe empty array (no crash, no fake "no snapshots yet")', () => {
    const c = buildWithGet({}); // stale route → parseable but no `snapshots`
    (c as unknown as { loadSnapshots: (id: string) => void }).loadSnapshots('site-1');
    expect(Array.isArray(c.snapshots())).withContext('list is always an array — @for never iterates a non-array').toBeTrue();
    expect(c.snapshots().length).toBe(0);
    expect(c.snapshotsError()).withContext('shapeless 200 surfaces an honest error, not a silent fake-empty').toBeTruthy();
  });

  it('loadSnapshots: a NON-ARRAY snapshots value (e.g. HTML coerced to a string) never reaches the signal (no @for crash)', () => {
    const c = buildWithGet({ snapshots: '<html>not an array</html>' });
    (c as unknown as { loadSnapshots: (id: string) => void }).loadSnapshots('site-1');
    expect(Array.isArray(c.snapshots())).toBeTrue();
    expect(c.snapshots().length).toBe(0);
    expect(c.snapshotsError()).toBeTruthy();
  });

  it('loadSnapshots: a real array clears any prior error and populates the list', () => {
    const c = buildWithGet({ snapshots: [{ id: 's1', snapshot_name: 'v1', kind: 'initial', created_at: 'x' }] });
    c.snapshotsError.set('stale error');
    (c as unknown as { loadSnapshots: (id: string) => void }).loadSnapshots('site-1');
    expect(c.snapshots().length).toBe(1);
    expect(c.snapshotsError()).withContext('a healthy load clears the prior error').toBeNull();
  });

  it('loadIntegrations: a NON-ARRAY providers value never reaches the @for — falls back to the default catalog', () => {
    const c = buildWithGet({ providers: 'not-an-array' }); // truthy `.length` would have slipped a string into the list
    (c as unknown as { loadIntegrations: (id: string) => void }).loadIntegrations('site-1');
    expect(Array.isArray(c.integrations())).toBeTrue();
    expect(c.integrations().length).withContext('falls back to the default provider catalog, not a coerced string').toBeGreaterThan(0);
    expect(c.integrations().every((p) => typeof p.key === 'string')).toBeTrue();
  });
});

/**
 * Rollback double-submit guard — onRollbackClick is async (awaits the confirm
 * dialog). The most destructive admin action must not let a rapid double-click
 * open TWO confirm dialogs (and risk firing two overwrites).
 */
describe('AdminSiteDetailComponent (rollback double-submit guard)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('a second Rollback click while the confirm is still pending opens only ONE dialog', async () => {
    let resolveConfirm!: (v: boolean) => void;
    const confirm = jasmine.createSpy('confirm').and.callFake(
      () => new Promise<boolean>((res) => { resolveConfirm = res; }),
    );
    const post = jasmine.createSpy('post').and.returnValue(of({ ok: true, snapshot_name: 'v3' }));
    TestBed.configureTestingModule({
      imports: [AdminSiteDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ site: { id: 's1', slug: 's', name: 'S' } }), post, delete: () => of({}) } },
        { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => 's1' }), queryParamMap: of({ get: () => null }) } },
        { provide: ConfirmService, useValue: { confirm } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, info: () => 0, warning: () => 0 } },
      ],
    });
    TestBed.overrideComponent(AdminSiteDetailComponent, { set: { template: '<div></div>', imports: [] } });
    const c = TestBed.createComponent(AdminSiteDetailComponent).componentInstance;
    const SNAP = { id: 'snap-9', snapshot_name: 'launch-v3' } as never;

    const p1 = c.onRollbackClick(SNAP);
    c.onRollbackClick(SNAP); // second click while the first confirm is still open
    expect(confirm).withContext('only one confirm dialog despite two rapid clicks').toHaveBeenCalledTimes(1);
    resolveConfirm(true);
    await p1;
    expect(post).toHaveBeenCalledTimes(1);
  });
});

/**
 * Deep-linkable tabs — a `?tab=sql` URL opens that tab (bookmarkable/shareable),
 * and clicking a tab reflects it in the URL (replaceUrl, merge — SPA, no reload).
 */
describe('AdminSiteDetailComponent (deep-linkable tabs)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function makeWithTab(tabParam: string | null): { c: AdminSiteDetailComponent; nav: jasmine.Spy } {
    const api = {
      get: jasmine.createSpy('get').and.returnValue(of({ site: { id: 'site-1', slug: 's', name: 'S' } })),
      post: jasmine.createSpy('post').and.returnValue(of({ ok: true })),
    };
    TestBed.configureTestingModule({
      imports: [AdminSiteDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => 'site-1' }), queryParamMap: of({ get: (k: string) => (k === 'tab' ? tabParam : null) }) } },
      ],
    });
    TestBed.overrideComponent(AdminSiteDetailComponent, { set: { template: '<div></div>', imports: [] } });
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const c = TestBed.createComponent(AdminSiteDetailComponent).componentInstance;
    return { c, nav };
  }

  it('opens the tab named in ?tab= (deep-link / bookmark)', () => {
    expect(makeWithTab('sql').c.tab()).toBe('sql');
  });

  it('ignores an unknown ?tab= value (falls back to the default logs tab)', () => {
    expect(makeWithTab('bogus').c.tab()).toBe('logs');
  });

  it('setTab reflects the tab in the URL (bookmarkable: replaceUrl + merge)', () => {
    const { c, nav } = makeWithTab(null);
    c.setTab('integrations');
    expect(c.tab()).toBe('integrations');
    expect(nav).toHaveBeenCalled();
    const opts = nav.calls.mostRecent().args[1] as { queryParams: unknown; replaceUrl: boolean; queryParamsHandling: string };
    expect(opts.queryParams).toEqual({ tab: 'integrations' });
    expect(opts.replaceUrl).toBeTrue();
    expect(opts.queryParamsHandling).toBe('merge');
  });
});
