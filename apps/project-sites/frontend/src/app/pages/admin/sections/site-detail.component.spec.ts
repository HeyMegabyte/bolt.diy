import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ActivatedRoute, provideRouter } from '@angular/router';
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
    expect(post).toHaveBeenCalledWith('/sites/s1/snapshots/snap-9/rollback', {});
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
