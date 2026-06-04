import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
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
