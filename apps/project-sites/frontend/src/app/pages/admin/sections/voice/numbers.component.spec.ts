import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError, Subject } from 'rxjs';
import { VoiceNumbersComponent } from './numbers.component';
import { ApiService } from '../../../../services/api.service';
import { ToastService } from '../../../../services/toast.service';
import { ConfirmService } from '../../../../services/confirm.service';
import { AdminStateService } from '../../admin-state.service';

/**
 * First coverage for the voice number purchase/release flow. The buy + release
 * actions move money / give up a live number — both must go through the BRANDED
 * cyan ConfirmService (not the old native window.confirm), and must NOT hit the
 * API when the user cancels. overrideComponent strips the template so the
 * site-load effect doesn't auto-fire; methods are driven directly.
 */
function make(confirmResult = true): {
  c: VoiceNumbersComponent;
  api: { get: jasmine.Spy; post: jasmine.Spy; delete: jasmine.Spy };
  confirmSpy: jasmine.Spy;
} {
  const api = {
    get: jasmine.createSpy('get').and.returnValue(of({ data: [] })),
    post: jasmine.createSpy('post').and.returnValue(of({ data: {} })),
    delete: jasmine.createSpy('delete').and.returnValue(of(undefined)),
  };
  const confirmSpy = jasmine.createSpy('confirm').and.resolveTo(confirmResult);
  TestBed.configureTestingModule({
    imports: [VoiceNumbersComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success: () => 0, error: () => 0, info: () => 0 } },
      { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      { provide: ConfirmService, useValue: { confirm: confirmSpy } },
    ],
  });
  TestBed.overrideComponent(VoiceNumbersComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(VoiceNumbersComponent).componentInstance, api, confirmSpy };
}

describe('VoiceNumbersComponent (purchase + release confirmation)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('confirmBuy confirms with danger:true then POSTs the purchase', async () => {
    const { c, api, confirmSpy } = make(true);
    await c.confirmBuy({ phone_number: '+18558522267', monthly_cost_usd: 1.15 } as never);
    expect(confirmSpy).toHaveBeenCalled();
    expect((confirmSpy.calls.mostRecent().args[0] as { danger?: boolean }).danger).toBeTrue();
    expect(api.post).toHaveBeenCalledWith('/voice/numbers/purchase', { siteId: 's1', phoneNumber: '+18558522267' }, { silent: true });
  });

  it('confirmBuy does NOT POST when the buy confirm is cancelled', async () => {
    const { c, api, confirmSpy } = make(false);
    await c.confirmBuy({ phone_number: '+18558522267', monthly_cost_usd: 1.15 } as never);
    expect(confirmSpy).toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('release confirms (danger) then DELETEs; cancel → no DELETE', async () => {
    const ok = make(true);
    await ok.c.release({ id: 'n1', phone_number: '+18558522267' } as never);
    expect(ok.confirmSpy).toHaveBeenCalled();
    expect((ok.confirmSpy.calls.mostRecent().args[0] as { danger?: boolean }).danger).toBeTrue();
    expect(ok.api.delete).toHaveBeenCalledWith('/voice/numbers/n1', { silent: true });

    TestBed.resetTestingModule();
    const no = make(false);
    await no.c.release({ id: 'n1', phone_number: '+18558522267' } as never);
    expect(no.api.delete).not.toHaveBeenCalled();
  });

  // Buy CHARGES MONEY + Release is DESTRUCTIVE — both must be double-submit-safe.
  it('confirmBuy does NOT double-POST while a purchase is in flight (no double charge)', async () => {
    const { c, api } = make(true);
    api.post.and.returnValue(new Subject()); // stays pending → buy guard stays held
    const cand = { phone_number: '+18558522267', monthly_cost_usd: 1.15 } as never;
    await c.confirmBuy(cand);
    await c.confirmBuy(cand);
    expect(api.post).withContext('a second buy while the first is in flight must not fire').toHaveBeenCalledTimes(1);
  });

  it('confirmBuy clears the buy guard on error so a retry can fire (no stuck guard)', async () => {
    const { c, api } = make(true);
    api.post.and.returnValues(throwError(() => ({ status: 500 })), of({ data: {} }));
    const cand = { phone_number: '+18558522267', monthly_cost_usd: 1.15 } as never;
    await c.confirmBuy(cand);
    await c.confirmBuy(cand);
    expect(api.post).withContext('a failed buy must not block the retry').toHaveBeenCalledTimes(2);
  });

  it('release does NOT double-DELETE the same number while in flight', async () => {
    const { c, api } = make(true);
    api.delete.and.returnValue(new Subject());
    const n = { id: 'n1', phone_number: '+18558522267' } as never;
    await c.release(n);
    await c.release(n);
    expect(api.delete).withContext('a second release of the same number must not fire').toHaveBeenCalledTimes(1);
  });

  it('release clears the guard on error so a retry can fire', async () => {
    const { c, api } = make(true);
    api.delete.and.returnValues(throwError(() => ({ status: 500 })), of(undefined));
    const n = { id: 'n1', phone_number: '+18558522267' } as never;
    await c.release(n);
    await c.release(n);
    expect(api.delete).toHaveBeenCalledTimes(2);
  });

  it('loadNumbers failure sets loadError (not a fake empty + $0.00 spend)', () => {
    const { c, api } = make();
    api.get.and.returnValue(throwError(() => ({ status: 500 })));
    c.loadNumbers();
    expect(c.loadError()).toContain('did not respond');
    expect(c.loading()).toBeFalse();
  });

  it('a transient load failure PRESERVES already-loaded numbers (no wipe → no false $0 spend)', () => {
    const { c, api } = make();
    api.get.and.returnValue(of({ data: [{ id: 'n1', monthly_cost_usd: 1.15 }, { id: 'n2', monthly_cost_usd: 2 }] }));
    c.loadNumbers();
    expect(c.numbers().length).toBe(2);
    api.get.and.returnValue(throwError(() => ({ status: 503 })));
    c.loadNumbers();
    expect(c.numbers().length).withContext('numbers survive a transient failure').toBe(2);
    expect(c.loadError()).toBeTruthy();
  });

  // The vanity match is bolded with <b> (injected via [innerHTML]); the cockpit
  // styles those cyan via `:host ::ng-deep .vanity-display b` (was a dead
  // `:global(b)` rule → browser default, off-brand). Confirm the <b> markup the
  // rule targets is actually produced.
  it('vanityHtml wraps the vanity match in <b> for the cyan highlight to style', () => {
    const { c } = make();
    // (855) 522-6700 — last7 "5226700" contains LABOR's digit-map "52267".
    const html = c.vanityHtml('+18555226700', 'LABOR');
    expect(html).toContain('<b>L</b>');
    expect(html).toContain('<b>R</b>');
    // No vanity arg → plain number, no stray <b>.
    expect(c.vanityHtml('+18555226700')).not.toContain('<b>');
  });
});

/**
 * The "No matches" hint gated on `query` only, so an AREA-CODE-ONLY search
 * that returned nothing showed a silent blank (no guidance). `searchAttempted()`
 * fires for a word OR an area-code search so the empty-results hint always shows.
 */
describe('VoiceNumbersComponent (area-code-only search shows the no-results hint)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('searchAttempted() is true for a word search', () => {
    const { c } = make();
    c.query = 'FIT'; c.areaCode = '';
    expect(c.searchAttempted()).toBeTrue();
  });

  it('searchAttempted() is true for an AREA-CODE-ONLY search (the fix — no word typed)', () => {
    const { c } = make();
    c.query = ''; c.areaCode = '415';
    expect(c.searchAttempted()).withContext('area-only search still counts as a search').toBeTrue();
  });

  it('searchAttempted() is false when neither a word nor an area code is set', () => {
    const { c } = make();
    c.query = '   '; c.areaCode = '';
    expect(c.searchAttempted()).toBeFalse();
  });
});
