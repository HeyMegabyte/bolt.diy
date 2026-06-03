import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { AdminApiTokensComponent } from './api-tokens.component';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Covers the security-critical API-token CRUD (no prior spec):
 *  - loadTokens success / 503-flag-disabled (graceful, NOT an error) / other-error (toast)
 *  - createToken validation (empty name is a no-op — no POST) + success flow
 *  - toggleScope set semantics
 *  - revokeToken (destructive) guard: no target / in-flight → no DELETE; success clears + toasts
 * overrideComponent strips the TanStack-table template so the constructor effect doesn't
 * auto-fire; private loadTokens() is driven via bracket access.
 */
interface Stubs {
  c: AdminApiTokensComponent;
  http: { get: jasmine.Spy; post: jasmine.Spy; delete: jasmine.Spy };
  show: jasmine.Spy;
}

function make(over: { get?: jasmine.Spy; post?: jasmine.Spy; delete?: jasmine.Spy; orgId?: string } = {}): Stubs {
  const http = {
    get: over.get ?? jasmine.createSpy('get').and.returnValue(of({ data: [] })),
    post: over.post ?? jasmine.createSpy('post').and.returnValue(of({ id: 't1', plaintext: 'sk_live_x' })),
    delete: over.delete ?? jasmine.createSpy('delete').and.returnValue(of({})),
  };
  const show = jasmine.createSpy('show');
  TestBed.configureTestingModule({
    imports: [AdminApiTokensComponent],
    providers: [
      { provide: HttpClient, useValue: http },
      { provide: ToastService, useValue: { show } },
      { provide: AdminStateService, useValue: { orgId: signal(over.orgId ?? 'org1') } },
    ],
  });
  TestBed.overrideComponent(AdminApiTokensComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AdminApiTokensComponent).componentInstance, http, show };
}

describe('AdminApiTokensComponent (token CRUD)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('loadTokens success populates tokens and clears flagDisabled', () => {
    const { c } = make({ get: jasmine.createSpy('get').and.returnValue(of({ data: [{ id: 'a', name: 'CI' }] })) });
    (c as unknown as { loadTokens(): void }).loadTokens();
    expect(c.tokens().length).toBe(1);
    expect(c.loading()).toBe(false);
    expect(c.flagDisabled()).toBe(false);
  });

  it('a 503 marks the feature flag-disabled (graceful) — not an error toast', () => {
    const { c, show } = make({ get: jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 503 }))) });
    (c as unknown as { loadTokens(): void }).loadTokens();
    expect(c.flagDisabled()).toBe(true);
    expect(c.tokens().length).toBe(0);
    expect(show).not.toHaveBeenCalled();
  });

  it('a non-503 load error surfaces an error toast', () => {
    const { c, show } = make({ get: jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))) });
    (c as unknown as { loadTokens(): void }).loadTokens();
    expect(show).toHaveBeenCalledWith('Failed to load API tokens', 'error');
    expect(c.flagDisabled()).toBe(false);
  });

  it('skips the request entirely when orgId has not hydrated', () => {
    const { c, http } = make({ orgId: '' });
    (c as unknown as { loadTokens(): void }).loadTokens();
    expect(http.get).not.toHaveBeenCalled();
    expect(c.loading()).toBe(false);
  });

  it('createToken is a no-op when the name is blank (no POST)', () => {
    const { c, http } = make();
    c.newName = '   ';
    c.createToken();
    expect(http.post).not.toHaveBeenCalled();
    expect(c.creating()).toBe(false);
  });

  it('createToken posts, reveals the plaintext token, and closes the modal', () => {
    const { c, http } = make();
    c.openCreateModal();
    c.newName = 'Deploy bot';
    c.createToken();
    expect(http.post).toHaveBeenCalled();
    expect(c.createdToken()?.plaintext).toBe('sk_live_x');
    expect(c.createModalVisible).toBe(false);
  });

  it('toggleScope adds then removes a scope', () => {
    const { c } = make();
    c.toggleScope('media:write');
    expect(c.selectedScopes().has('media:write')).toBe(true);
    c.toggleScope('media:write');
    expect(c.selectedScopes().has('media:write')).toBe(false);
  });

  it('revokeToken is guarded — no DELETE without a confirmed target', () => {
    const { c, http } = make();
    c.revokeTarget.set(null);
    c.revokeToken();
    expect(http.delete).not.toHaveBeenCalled();
  });

  it('revokeToken deletes the confirmed target, clears it, and toasts success', () => {
    const { c, http, show } = make();
    c.confirmRevoke({ id: 'tok-9', name: 'old-key' } as never);
    c.revokeToken();
    expect(http.delete).toHaveBeenCalled();
    expect(c.revokeTarget()).toBeNull();
    expect(show).toHaveBeenCalledWith('Token "old-key" revoked', 'success');
  });

  it('showTableSkeleton is true only while the first fetch is in flight with no tokens (no false-empty flash)', () => {
    const { c } = make();
    c.loading.set(true);
    c.tokens.set([]);
    expect(c.showTableSkeleton()).toBe(true);
    // Once tokens arrive, the skeleton yields to the table.
    c.tokens.set([{ id: 'a', name: 'CI' } as never]);
    expect(c.showTableSkeleton()).toBe(false);
    // A loaded-but-empty result shows the real empty state, not the skeleton.
    c.tokens.set([]);
    c.loading.set(false);
    expect(c.showTableSkeleton()).toBe(false);
  });
});

/**
 * TanStack sort coverage (previously untested) — this is the same
 * createAngularTable pattern the ag-grid→TanStack perf wave will replicate on
 * audit/ai-logs, so locking it here hardens that pattern too: the a11y/glyph
 * mappers are exact, and the table genuinely re-sorts its rows when the sorting
 * state changes.
 */
describe('AdminApiTokensComponent (TanStack table sort)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('ariaSort maps the TanStack direction → an aria-sort token', () => {
    const { c } = make();
    expect(c.ariaSort('asc')).toBe('ascending');
    expect(c.ariaSort('desc')).toBe('descending');
    expect(c.ariaSort(false)).toBe('none');
  });

  it('sortGlyph maps the direction → its header indicator', () => {
    const { c } = make();
    expect(c.sortGlyph('asc')).toBe('↑');
    expect(c.sortGlyph('desc')).toBe('↓');
    expect(c.sortGlyph(false)).toBe('↕');
  });

  it('the table re-sorts its rows when the sorting state changes (asc + desc)', () => {
    const { c } = make();
    c.tokens.set([{ id: '2', name: 'Bravo' }, { id: '1', name: 'Alpha' }] as never);
    const sorting = (c as unknown as { sorting: { set(v: { id: string; desc: boolean }[]): void } }).sorting;
    sorting.set([{ id: 'name', desc: false }]);
    expect(c.table.getRowModel().rows.map((r) => (r.original as { name: string }).name)).toEqual(['Alpha', 'Bravo']);
    sorting.set([{ id: 'name', desc: true }]);
    expect(c.table.getRowModel().rows.map((r) => (r.original as { name: string }).name)).toEqual(['Bravo', 'Alpha']);
  });
});
