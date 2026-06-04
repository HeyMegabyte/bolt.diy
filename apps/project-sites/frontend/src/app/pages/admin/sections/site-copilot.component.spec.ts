import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { AdminSiteCopilotComponent } from './site-copilot.component';

/**
 * Guards the copilot-sessions load-error gating (first coverage): a non-404
 * loadSessions failure used to just stop loading → the "No sessions yet" empty
 * state showed (masquerade). Now a non-404 error sets loadError + a Retry row;
 * a 404 stays the honest flag-disabled state; success/retry clear it.
 * overrideComponent strips the template; loadSessions() is driven directly.
 */
function make(get: jasmine.Spy): AdminSiteCopilotComponent {
  TestBed.configureTestingModule({
    imports: [AdminSiteCopilotComponent],
    providers: [{ provide: HttpClient, useValue: { get, put: () => of({ ok: true }) } }],
  });
  TestBed.overrideComponent(AdminSiteCopilotComponent, { set: { template: '<div></div>', imports: [] } });
  const c = TestBed.createComponent(AdminSiteCopilotComponent).componentInstance;
  c.siteId = 's1';
  return c;
}

describe('AdminSiteCopilotComponent (sessions load-error gating)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success populates sessions and clears loadError', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ sessions: [{ id: 'a' }], distribution: [] })));
    c.loadSessions();
    expect(c.loadError()).toBeNull();
    expect(c.sessions().length).toBe(1);
    expect(c.loading()).toBe(false);
  });

  it('a 404 marks the feature flag-disabled WITHOUT a loadError (honest state, not a masquerade)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 404 }))));
    c.loadSessions();
    expect(c.flagEnabled()).toBe(false);
    expect(c.loadError()).toBeNull();
    expect(c.loading()).toBe(false);
  });

  it('a non-404 error sets a persistent loadError (not a fake empty)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    c.loadSessions();
    expect(c.loadError()).toContain('Could not load');
    expect(c.loading()).toBe(false);
  });

  it('retry after an error clears the prior loadError', () => {
    const get = jasmine.createSpy('get').and.returnValues(
      throwError(() => ({ status: 500 })),
      of({ sessions: [], distribution: [] }),
    );
    const c = make(get);
    c.loadSessions();
    expect(c.loadError()).not.toBeNull();
    c.loadSessions();
    expect(c.loadError()).toBeNull();
  });
});

/**
 * toggleEnabled must NOT be a moot mutation when multimodal_copilot is flag-off.
 * The enable toggle sits in the header (always rendered), but when the flag is
 * off (flagEnabled=false → gate notice shown) the per-site config route 404s, so
 * a toggle there is contradictory + dead. The template disables it; the handler
 * also no-ops + reverts the native checkbox defensively.
 */
function makeToggle(put: jasmine.Spy): AdminSiteCopilotComponent {
  TestBed.configureTestingModule({
    imports: [AdminSiteCopilotComponent],
    providers: [{ provide: HttpClient, useValue: { get: () => of({ sessions: [], distribution: [] }), put } }],
  });
  TestBed.overrideComponent(AdminSiteCopilotComponent, { set: { template: '<div></div>', imports: [] } });
  const c = TestBed.createComponent(AdminSiteCopilotComponent).componentInstance;
  c.siteId = 's1';
  return c;
}

describe('AdminSiteCopilotComponent (enable toggle gated by the feature flag)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('toggleEnabled is a no-op when the flag is off — no PUT to a gated route + reverts the checkbox', () => {
    const put = jasmine.createSpy('put').and.returnValue(of({ ok: true }));
    const c = makeToggle(put);
    c.flagEnabled.set(false);
    c.enabled.set(false);
    const input = { checked: true } as HTMLInputElement; // user just flipped it on
    c.toggleEnabled({ target: input } as unknown as Event);
    expect(put).withContext('no PUT when the feature is flag-disabled').not.toHaveBeenCalled();
    expect(input.checked).withContext('native checkbox reverts to the real state').toBe(false);
  });

  it('toggleEnabled PUTs the config when the flag is on', () => {
    const put = jasmine.createSpy('put').and.returnValue(of({ ok: true }));
    const c = makeToggle(put);
    c.flagEnabled.set(true);
    c.toggleEnabled({ target: { checked: true } as HTMLInputElement } as unknown as Event);
    expect(put).toHaveBeenCalledWith('/api/sites/s1/copilot/config', { enabled: true });
    expect(c.enabled()).toBe(true);
  });
});
