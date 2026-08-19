import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import {
  VoiceAgentSettingsComponent,
  mapVoiceRowToSettings,
  settingsToVoicePayload,
} from './agent-settings.component';
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
    // Worker Zod (agentSettingsBody) requires `siteId` (camelCase) — `site_id` 400d every save.
    expect((put.calls.mostRecent().args[1] as Record<string, unknown>)['siteId']).withContext('sends siteId, not site_id').toBe('s1');
    expect('site_id' in (put.calls.mostRecent().args[1] as Record<string, unknown>)).withContext('never the old site_id key').toBe(false);
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

/**
 * Field-name contract (regression for the 2026-08-18 silent-drop class): the
 * worker's `agentSettingsBody` Zod + `voice_agent_settings` D1 columns use
 * `voice_voice_id` / `voice_model` / `business_hours_json`. The legacy FE keys
 * `voice_id` / `llm_model` / `business_hours` (object) were silently STRIPPED
 * by the schema — so EVERY save NULLED the chosen voice + LLM model and
 * business hours never persisted. The mapping helpers are the single seam;
 * a legacy key resurfacing in the payload = RED.
 */
describe('VoiceAgentSettingsComponent (worker field-name contract — no silent drops)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function makeBare(): VoiceAgentSettingsComponent {
    TestBed.configureTestingModule({
      imports: [VoiceAgentSettingsComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: {} }), put: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    TestBed.overrideComponent(VoiceAgentSettingsComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(VoiceAgentSettingsComponent).componentInstance;
  }

  it('mapVoiceRowToSettings maps the raw D1 row (snake keys, INT 0/1 booleans, business_hours_json)', () => {
    const s = mapVoiceRowToSettings({
      voice_system_prompt: 'greet',
      sms_system_prompt: 'sms greet',
      voice_voice_id: 'bella',
      voice_model: 'claude-opus-4-7',
      sms_model: 'claude-haiku-4-5',
      recording_enabled: 0,
      video_browse_enabled: 1,
      business_hours_json: '{"start":"08:00","end":"16:00","tz":"UTC"}',
    });
    expect(s.voice_voice_id).withContext('row voice_voice_id → settings.voice_voice_id').toBe('bella');
    expect(s.voice_model).withContext('row voice_model → settings.voice_model').toBe('claude-opus-4-7');
    expect(s.recording_enabled).withContext('INT 0 → false').toBe(false);
    expect(s.video_browse_enabled).withContext('INT 1 → true').toBe(true);
    expect(s.business_hours_enabled).withContext('non-null business_hours_json enables the hours UI').toBe(true);
    expect(s.business_hours).toEqual({ start: '08:00', end: '16:00', tz: 'UTC' });
  });

  it('mapVoiceRowToSettings degrades to defaults on a missing row or corrupt hours JSON', () => {
    const missing = mapVoiceRowToSettings(null);
    expect(missing.business_hours_enabled).withContext('no row → hours off').toBe(false);
    expect(missing.voice_voice_id).withContext('no row → default voice').toBeDefined();
    const corrupt = mapVoiceRowToSettings({ business_hours_json: '{not-json', voice_voice_id: null });
    expect(corrupt.business_hours_enabled).withContext('corrupt JSON → hours off, never throws').toBe(false);
    expect(corrupt.voice_voice_id).withContext('null column → default voice').toBeDefined();
  });

  it('settingsToVoicePayload sends worker field names and NEVER the legacy voice_id/llm_model keys', () => {
    const c = makeBare();
    const payload = settingsToVoicePayload('s1', c.settings);
    expect(payload['voice_voice_id']).withContext('worker wants voice_voice_id').toBeDefined();
    expect(payload['voice_model']).withContext('worker wants voice_model').toBeDefined();
    expect(payload['business_hours_json']).withContext('worker wants business_hours_json').toBeNull();
    expect('voice_id' in payload).withContext('legacy voice_id key must never return').toBe(false);
    expect('llm_model' in payload).withContext('legacy llm_model key must never return').toBe(false);
    expect('voice_provider' in payload).withContext('dead provider control must never return').toBe(false);
    expect('sms_signature' in payload).withContext('dead SMS controls must never return').toBe(false);
    expect(payload['siteId']).withContext('siteId stays camelCase (Zod requires it)').toBe('s1');
  });

  it('settingsToVoicePayload serializes business_hours_json (string) when enabled, null when disabled', () => {
    const c = makeBare();
    c.settings.business_hours_enabled = true;
    c.settings.business_hours = { start: '09:30', end: '17:45', tz: 'America/New_York' };
    const on = settingsToVoicePayload('s1', c.settings);
    expect(on['business_hours_json']).toEqual(JSON.stringify({ start: '09:30', end: '17:45', tz: 'America/New_York' }));
    c.settings.business_hours_enabled = false;
    const off = settingsToVoicePayload('s1', c.settings);
    expect(off['business_hours_json']).withContext('disabled hours → null column').toBeNull();
  });

  it('reload() hydrates through the row mapper (voice_voice_id lands in settings)', () => {
    const get = jasmine.createSpy('get').and.returnValue(
      of({
        settings: {
          voice_voice_id: 'antoni',
          voice_model: 'claude-sonnet-4-6',
          recording_enabled: 1,
          business_hours_json: '{"start":"07:00","end":"15:00","tz":"America/New_York"}',
        },
      }),
    );
    TestBed.configureTestingModule({
      imports: [VoiceAgentSettingsComponent],
      providers: [
        { provide: ApiService, useValue: { get, put: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    TestBed.overrideComponent(VoiceAgentSettingsComponent, { set: { template: '<div></div>', imports: [] } });
    const c = TestBed.createComponent(VoiceAgentSettingsComponent).componentInstance;
    c.reload();
    expect(c.settings.voice_voice_id).withContext('saved voice surfaces after reload (was: blank forever)').toBe('antoni');
    expect(c.settings.voice_model).withContext('saved voice model surfaces after reload').toBe('claude-sonnet-4-6');
    expect(c.settings.business_hours_enabled).withContext('saved hours re-enable the hours UI').toBe(true);
  });
});
