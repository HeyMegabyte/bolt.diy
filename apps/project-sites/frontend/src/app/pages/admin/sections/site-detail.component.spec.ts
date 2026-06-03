import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { AdminSiteDetailComponent } from './site-detail.component';
import { ApiService } from '../../../services/api.service';

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
    const { c } = make(jasmine.createSpy('post').and.returnValue(throwError(() => ({ error: { error: { message: 'writes are not allowed' } } }))));
    c.sqlQuery.set('DELETE FROM sites');
    c.runSql();
    expect(c.sqlError()).toContain('not allowed');
    expect(c.sqlRunning()).toBe(false);
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
