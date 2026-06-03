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
