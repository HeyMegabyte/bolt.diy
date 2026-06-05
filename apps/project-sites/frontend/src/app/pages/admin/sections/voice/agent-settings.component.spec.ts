import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { VoiceAgentSettingsComponent } from './agent-settings.component';
import { ApiService } from '../../../../services/api.service';
import { ToastService } from '../../../../services/toast.service';
import { AdminStateService } from '../../admin-state.service';

/**
 * The voice Agent-settings tab's passive loads (agent-settings + meta-prompt) used
 * non-{silent} gets that degrade gracefully to DEFAULTS — so ApiService's generic
 * "Can't reach the server" toast fired ON TOP of the graceful fallback whenever
 * voice was un-provisioned (a scary toast for a form that just shows defaults).
 * Both reads are now {silent}; the same fix applies to the sibling voice tabs'
 * passive list-loads (numbers / conversations / share / test-console / mcps).
 */
describe('VoiceAgentSettingsComponent (passive loads are {silent})', () => {
  let get: jasmine.Spy;
  function make(): VoiceAgentSettingsComponent {
    get = jasmine.createSpy('get').and.returnValue(of({ data: {} }));
    TestBed.configureTestingModule({
      imports: [VoiceAgentSettingsComponent],
      providers: [
        { provide: ApiService, useValue: { get, put: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    TestBed.overrideComponent(VoiceAgentSettingsComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(VoiceAgentSettingsComponent).componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('reload() fetches agent-settings {silent} (degrades to DEFAULTS, no generic toast)', () => {
    const c = make();
    get.calls.reset();
    c.reload();
    expect(get).toHaveBeenCalledWith('/voice/agent-settings?siteId=s1', undefined, { silent: true });
  });

  it('loadMeta() fetches the meta-prompt {silent}', () => {
    const c = make();
    get.calls.reset();
    c.loadMeta();
    expect(get).toHaveBeenCalledWith('/voice/meta-prompt', undefined, { silent: true });
  });
});

/**
 * save() PUT must be {silent} too: the handler owns a specific 'Save failed'
 * toast, so a non-silent PUT double-fired ApiService's generic toast over it.
 */
describe('VoiceAgentSettingsComponent (save PUT is {silent} — no double-toast)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('save() PUTs /voice/agent-settings with {silent:true}', () => {
    const put = jasmine.createSpy('put').and.returnValue(of({ data: {} }));
    TestBed.configureTestingModule({
      imports: [VoiceAgentSettingsComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: {} }), put } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    TestBed.overrideComponent(VoiceAgentSettingsComponent, { set: { template: '<div></div>', imports: [] } });
    const c = TestBed.createComponent(VoiceAgentSettingsComponent).componentInstance;
    c.save();
    expect(put).toHaveBeenCalled();
    expect(put.calls.mostRecent().args[0]).toBe('/voice/agent-settings');
    expect(put.calls.mostRecent().args[2]).withContext('mutation silenced so the own toast is sole').toEqual({ silent: true });
  });
});

/**
 * A {silent} load that degrades to DEFAULTS is fine for an UN-PROVISIONED org (404),
 * but a real failure (500/network) used to ALSO silently show defaults — and Save
 * would then overwrite the user's real saved settings with those defaults. Now a
 * non-404 failure flags loadError (which gates Save); 404 stays graceful.
 */
describe('VoiceAgentSettingsComponent (a failed load can no longer be saved over real settings)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function makeWith(getSpy: jasmine.Spy): VoiceAgentSettingsComponent {
    TestBed.configureTestingModule({
      imports: [VoiceAgentSettingsComponent],
      providers: [
        { provide: ApiService, useValue: { get: getSpy, put: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    TestBed.overrideComponent(VoiceAgentSettingsComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(VoiceAgentSettingsComponent).componentInstance;
  }

  it('flags loadError on a non-404 failure (so Save is blocked, not silently defaulted)', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 })));
    const c = makeWith(get);
    c.reload(); // the siteEffect normally drives this; call it directly like the sibling specs
    expect(c.loadError()).withContext('a real load failure surfaces an error so Save can be gated').toBeTruthy();
  });

  it('stays graceful on a 404 (un-provisioned org) — defaults, no loadError', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 404 })));
    const c = makeWith(get);
    c.reload();
    expect(c.loadError()).withContext('un-provisioned org degrades to defaults silently').toBeNull();
  });
});
