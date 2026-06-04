import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { SiteMcpServerComponent } from './site-mcp-server.component';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';

/**
 * First coverage for the per-site MCP server (security-critical token CRUD — untested):
 *  - loadTokens/loadTools error gating (sets *Error, not a silent empty)
 *  - mintToken reveals the raw token once + reloads
 *  - revokeToken optimistically drops the row + clears the in-flight marker
 *  - runPlayground rejects invalid JSON args before firing a request (input validation)
 *  - totalCallsToday sums only today's usage
 * overrideComponent strips the template so ngOnInit doesn't auto-fire; methods driven directly.
 */
function make(over: { get?: jasmine.Spy; post?: jasmine.Spy; del?: jasmine.Spy; confirmResult?: boolean } = {}): {
  c: SiteMcpServerComponent;
  http: { get: jasmine.Spy; post: jasmine.Spy; delete: jasmine.Spy };
  toast: { error: jasmine.Spy; success: jasmine.Spy };
  confirmSpy: jasmine.Spy;
} {
  const http = {
    get: over.get ?? jasmine.createSpy('get').and.returnValue(of({ tokens: [], tools: [], usage: [] })),
    post: over.post ?? jasmine.createSpy('post').and.returnValue(of({ id: 't1', token: 'mcp_raw_secret' })),
    delete: over.del ?? jasmine.createSpy('delete').and.returnValue(of({})),
  };
  const toast = { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') };
  const confirmSpy = jasmine.createSpy('confirm').and.resolveTo(over.confirmResult ?? true);
  TestBed.configureTestingModule({
    imports: [SiteMcpServerComponent],
    providers: [
      { provide: HttpClient, useValue: http },
      { provide: ToastService, useValue: toast },
      { provide: ConfirmService, useValue: { confirm: confirmSpy } },
      { provide: ActivatedRoute, useValue: { snapshot: { params: { id: 's1' } }, parent: { snapshot: { params: { id: 's1' } } } } },
    ],
  });
  TestBed.overrideComponent(SiteMcpServerComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(SiteMcpServerComponent).componentInstance, http, toast, confirmSpy };
}

describe('SiteMcpServerComponent (MCP token CRUD + playground)', () => {
  afterEach(() => TestBed.resetTestingModule());

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
    const { c, http } = make();
    c.ngOnInit(); // resolves siteId='s1' from the route (fires get only; post stays clean)
    c.newTokenLabel = '  Cursor laptop  ';
    c.mintToken();
    expect(http.post).toHaveBeenCalledWith('/api/sites/s1/mcp/tokens', { label: 'Cursor laptop' });
    expect(c.newTokenLabel).toBe(''); // input clears after mint
  });

  it('mintToken falls back to a unique auto-label when the field is blank (never another "Default")', () => {
    const { c, http } = make();
    c.ngOnInit();
    c.tokens.set([{ id: 'a' } as never, { id: 'b' } as never]); // 2 existing
    c.newTokenLabel = '   ';
    c.mintToken();
    expect(http.post).toHaveBeenCalledWith('/api/sites/s1/mcp/tokens', { label: 'Token 3' });
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
    const { c, http, confirmSpy } = make({ confirmResult: false });
    c.tokens.set([{ id: 'keep' } as never, { id: 'gone' } as never]);
    await c.revokeToken('gone');
    expect(confirmSpy).toHaveBeenCalled();
    expect(http.delete).not.toHaveBeenCalled();
    expect(c.tokens().map((t) => t.id)).toEqual(['keep', 'gone']); // nothing removed
  });

  it('runPlayground rejects invalid JSON arguments before firing a request', () => {
    const { c, http, toast } = make();
    c.openPlayground({ name: 'echo' } as never);
    c.playgroundArgs = '{ not json';
    c.runPlayground();
    expect(toast.error).toHaveBeenCalledWith('Invalid JSON arguments');
    expect(http.post).not.toHaveBeenCalled();
    expect(c.playgroundRunning()).toBe(false);
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
