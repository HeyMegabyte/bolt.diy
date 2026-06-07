import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { SiteMcpServerComponent } from './site-mcp-server.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';

/**
 * First coverage for the per-site MCP server (security-critical token CRUD — untested):
 *  - admin token/tool CRUD routes through ApiService (carries the auth bearer — the
 *    section used to use raw HttpClient with NO Authorization header → every call
 *    401'd → the section was non-functional. Regression-guarded below.)
 *  - loadTokens/loadTools error gating (sets *Error, not a silent empty)
 *  - mintToken reveals the raw token once + reloads
 *  - revokeToken optimistically drops the row + clears the in-flight marker
 *  - runPlayground rejects invalid JSON args before firing a request (input validation)
 *  - totalCallsToday sums only today's usage
 * overrideComponent strips the template so ngOnInit doesn't auto-fire; methods driven directly.
 * The admin /api/* calls use `api` (bearer + 401-handling); the public `/{slug}/mcp`
 * playground call stays on raw `http`.
 */
function make(over: { get?: jasmine.Spy; post?: jasmine.Spy; del?: jasmine.Spy; confirmResult?: boolean } = {}): {
  c: SiteMcpServerComponent;
  api: { get: jasmine.Spy; post: jasmine.Spy; delete: jasmine.Spy };
  http: { get: jasmine.Spy; post: jasmine.Spy; delete: jasmine.Spy };
  toast: { error: jasmine.Spy; success: jasmine.Spy };
  confirmSpy: jasmine.Spy;
} {
  const api = {
    get: over.get ?? jasmine.createSpy('apiGet').and.returnValue(of({ tokens: [], tools: [], usage: [] })),
    post: over.post ?? jasmine.createSpy('apiPost').and.returnValue(of({ id: 't1', token: 'mcp_raw_secret' })),
    delete: over.del ?? jasmine.createSpy('apiDelete').and.returnValue(of({})),
  };
  // raw HttpClient is used ONLY by the public-endpoint playground call now.
  const http = {
    get: jasmine.createSpy('httpGet').and.returnValue(of({})),
    post: jasmine.createSpy('httpPost').and.returnValue(of({ ok: true })),
    delete: jasmine.createSpy('httpDelete').and.returnValue(of({})),
  };
  const toast = { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') };
  const confirmSpy = jasmine.createSpy('confirm').and.resolveTo(over.confirmResult ?? true);
  TestBed.configureTestingModule({
    imports: [SiteMcpServerComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: http },
      { provide: ToastService, useValue: toast },
      { provide: ConfirmService, useValue: { confirm: confirmSpy } },
      { provide: ActivatedRoute, useValue: { snapshot: { params: { id: 's1' } }, parent: { snapshot: { params: { id: 's1' } } } } },
    ],
  });
  TestBed.overrideComponent(SiteMcpServerComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(SiteMcpServerComponent).componentInstance, api, http, toast, confirmSpy };
}

/**
 * Full-render guard for the header "calls today" pill (lying-UI / premature-stat
 * class): the stats grid already shows "—" when the tools feed fails, but the
 * prominent header pill rendered totalCallsToday() raw → a confident "0 calls
 * today" next to a "Couldn't load tools" card. The pill must mirror the grid:
 * "…" while loading, "—" when unknown, the real rolling count only once loaded.
 */
describe('SiteMcpServerComponent (header calls-today pill — no false "0")', () => {
  afterEach(() => TestBed.resetTestingModule());

  function renderFull(): import('@angular/core/testing').ComponentFixture<SiteMcpServerComponent> {
    TestBed.configureTestingModule({
      imports: [SiteMcpServerComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ tokens: [], tools: [], usage: [] }), post: () => of({}), delete: () => of({}) } },
        { provide: HttpClient, useValue: { get: () => of({}), post: () => of({}), delete: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { params: { id: 's1' } }, parent: { snapshot: { params: { id: 's1' } } } } },
      ],
    });
    return TestBed.createComponent(SiteMcpServerComponent);
  }

  it('shows "—" (not a false "0 calls today") when the tools feed failed', () => {
    const f = renderFull();
    f.detectChanges(); // ngOnInit fires the (mock-success) loads first
    f.componentInstance.toolsLoading.set(false); // then simulate the failed-feed state
    f.componentInstance.toolsError.set('The MCP tool registry did not respond.');
    f.componentInstance.tools.set([]);
    f.detectChanges();
    const pill = (f.nativeElement as HTMLElement).querySelector('.header-pill') as HTMLElement;
    expect(pill).withContext('header pill renders').not.toBeNull();
    expect(pill.textContent ?? '').withContext('unknown → em dash, not a fabricated count').toContain('—');
    expect(pill.textContent ?? '').withContext('must NOT claim a definitive 0').not.toContain('0 calls today');
    expect(pill.querySelector('app-rolling-counter')).withContext('no rolling count when the value is unknown').toBeNull();
  });

  it('shows the real rolling count once loaded (no error, not loading)', () => {
    const f = renderFull();
    f.detectChanges();
    f.componentInstance.toolsLoading.set(false);
    f.componentInstance.toolsError.set(null);
    f.componentInstance.tools.set([{ name: 'read', description: 'd' } as never]);
    f.detectChanges();
    const pill = (f.nativeElement as HTMLElement).querySelector('.header-pill') as HTMLElement;
    expect(pill.querySelector('app-rolling-counter')).withContext('loaded → the real rolling counter').not.toBeNull();
    expect(pill.textContent ?? '').not.toContain('—');
  });
});

describe('SiteMcpServerComponent (MCP token CRUD + playground)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('admin token CRUD routes through ApiService (auth bearer), NEVER raw HttpClient (the 401 bug)', () => {
    const { c, api, http } = make();
    c.ngOnInit(); // resolves siteId + fires loadTokens/loadTools/loadUsage
    // The 5 admin /api calls go through ApiService (which injects the bearer +
    // 401-handling) at the de-/api-prefixed path. Raw http must NOT be used for them.
    expect(api.get).toHaveBeenCalledWith('/sites/s1/mcp/tokens', undefined, { silent: true });
    expect(api.get).toHaveBeenCalledWith('/sites/s1/mcp/tools', undefined, { silent: true });
    expect(http.get).not.toHaveBeenCalled(); // was the bug: raw http.get → no Authorization → 401
  });

  it('loadTokens success populates tokens and clears error', () => {
    const c = make({ get: jasmine.createSpy('get').and.returnValue(of({ tokens: [{ id: 'a' }] })) }).c;
    c.loadTokens();
    expect(c.tokens().length).toBe(1);
    expect(c.tokensError()).toBeNull();
    expect(c.tokensLoading()).toBe(false);
  });

  it('loadTokens failure sets tokensError (not a silent empty list)', () => {
    const c = make({ get: jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))) }).c;
    c.loadTokens();
    expect(c.tokensError()).toContain('did not respond');
    expect(c.tokensLoading()).toBe(false);
  });

  it('loadTools failure sets toolsError', () => {
    const c = make({ get: jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))) }).c;
    c.loadTools();
    expect(c.toolsError()).toContain('did not respond');
    expect(c.toolsLoading()).toBe(false);
  });

  it('mintToken reveals the raw token once and clears the minting flag', () => {
    const c = make().c;
    c.mintToken();
    expect(c.newTokenRaw()).toBe('mcp_raw_secret');
    expect(c.minting()).toBe(false);
  });

  it('mintToken posts the user-entered label (trimmed) so revoke rows are distinguishable', () => {
    const { c, api } = make();
    c.ngOnInit(); // resolves siteId='s1' from the route (fires get only; post stays clean)
    c.newTokenLabel = '  Cursor laptop  ';
    c.mintToken();
    expect(api.post).toHaveBeenCalledWith('/sites/s1/mcp/tokens', { label: 'Cursor laptop' }, { silent: true });
    expect(c.newTokenLabel).toBe(''); // input clears after mint
  });

  it('mintToken falls back to a unique auto-label when the field is blank (never another "Default")', () => {
    const { c, api } = make();
    c.ngOnInit();
    c.tokens.set([{ id: 'a' } as never, { id: 'b' } as never]); // 2 existing
    c.newTokenLabel = '   ';
    c.mintToken();
    expect(api.post).toHaveBeenCalledWith('/sites/s1/mcp/tokens', { label: 'Token 3' }, { silent: true });
  });

  it('revokeToken (after confirm) optimistically removes the row and clears the in-flight marker', async () => {
    const { c, confirmSpy } = make();
    c.tokens.set([{ id: 'keep' } as never, { id: 'gone' } as never]);
    await c.revokeToken('gone');
    expect(confirmSpy).toHaveBeenCalled(); // destructive token revoke is confirmed first
    expect(c.tokens().map((t) => t.id)).toEqual(['keep']);
    expect(c.revoking()).toBeNull();
  });

  it('revokeToken does NOT delete when the confirm is cancelled', async () => {
    const { c, api, confirmSpy } = make({ confirmResult: false });
    c.tokens.set([{ id: 'keep' } as never, { id: 'gone' } as never]);
    await c.revokeToken('gone');
    expect(confirmSpy).toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
    expect(c.tokens().map((t) => t.id)).toEqual(['keep', 'gone']); // nothing removed
  });

  it('runPlayground rejects invalid JSON arguments before firing a request', async () => {
    const { c, http, toast } = make();
    c.openPlayground({ name: 'echo' } as never);
    c.playgroundArgs = '{ not json';
    await c.runPlayground();
    expect(toast.error).toHaveBeenCalledWith('Invalid JSON arguments');
    expect(http.post).not.toHaveBeenCalled();
    expect(c.playgroundRunning()).toBe(false);
  });

  it('runPlayground confirms before running a mutating CRUD tool (verify destructive actions)', async () => {
    const { c, http, confirmSpy } = make();
    c.ngOnInit();
    c.openPlayground({ name: 'delete_page' } as never);
    c.playgroundArgs = '{"slug":"home"}';
    await c.runPlayground();
    expect(confirmSpy).toHaveBeenCalled(); // destructive write is gated
    expect(http.post).toHaveBeenCalled(); // confirmed → fires
  });

  it('runPlayground does NOT fire a mutating tool when the confirm is cancelled', async () => {
    const { c, http, confirmSpy } = make({ confirmResult: false });
    c.ngOnInit();
    c.openPlayground({ name: 'update_content' } as never);
    c.playgroundArgs = '{}';
    await c.runPlayground();
    expect(confirmSpy).toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
    expect(c.playgroundRunning()).toBe(false);
  });

  it('runPlayground runs a read-only tool with NO confirm prompt', async () => {
    const { c, http, confirmSpy } = make();
    c.ngOnInit();
    c.openPlayground({ name: 'get_page' } as never);
    c.playgroundArgs = '{}';
    await c.runPlayground();
    expect(confirmSpy).not.toHaveBeenCalled(); // read tools run straight through
    expect(http.post).toHaveBeenCalled();
  });

  it('totalCallsToday sums only today’s usage rows', () => {
    const c = make().c;
    const today = new Date().toISOString().slice(0, 10);
    c.usage.set([
      { day: today, call_count: 3 } as never,
      { day: today, call_count: 4 } as never,
      { day: '2000-01-01', call_count: 99 } as never,
    ]);
    expect(c.totalCallsToday()).toBe(7);
  });
});
