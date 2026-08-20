import { TestBed, ComponentFixture } from '@angular/core/testing';
import { of } from 'rxjs';
import { SocialAutoPilotDialogComponent, type AutoPilotSavedPayload } from './social-auto-pilot-dialog.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

/**
 * First coverage for the extracted Auto-Pilot dialog. The parent's social
 * spec covered this via the god component; after the split this owns:
 *  - draft seeding from the inputs (prompt/cadence/networks)
 *  - toggleNetwork add/remove + preview-network fallback
 *  - resetToDefault
 *  - previewPost POST + save POST → saved output (the PARENT applies it)
 */
function make(opts: {
  prompt?: string;
  cadence?: number;
  networks?: string[];
  defaultPrompt?: string;
  platforms?: unknown[];
} = {}): {
  c: SocialAutoPilotDialogComponent;
  post: jasmine.Spy;
  toast: { success: jasmine.Spy; error: jasmine.Spy };
  fx: ComponentFixture<SocialAutoPilotDialogComponent>;
} {
  const post = jasmine.createSpy('post').and.returnValue(of({}));
  const toast = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };
  TestBed.configureTestingModule({
    imports: [SocialAutoPilotDialogComponent],
    providers: [
      { provide: ApiService, useValue: { post } },
      { provide: ToastService, useValue: toast },
    ],
  });
  const fx = TestBed.createComponent(SocialAutoPilotDialogComponent);
  fx.componentRef.setInput('prompt', opts.prompt ?? 'live prompt');
  fx.componentRef.setInput('cadenceHours', opts.cadence ?? 24);
  fx.componentRef.setInput('targetNetworks', opts.networks ?? ['twitter']);
  fx.componentRef.setInput('defaultPrompt', opts.defaultPrompt ?? 'default prompt');
  fx.componentRef.setInput('platforms', opts.platforms ?? [
    { id: 'twitter', label: 'X', color: '#000', glyph: 'M0 0' },
    { id: 'linkedin', label: 'LinkedIn', color: '#0a66c2', glyph: 'M1 1' },
  ]);
  fx.detectChanges();
  return { c: fx.componentInstance, post, toast, fx };
}

describe('SocialAutoPilotDialogComponent (extracted from the social god component)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('seeds its drafts from the inputs on init', () => {
    const { c } = make({ prompt: 'live prompt', cadence: 48, networks: ['twitter', 'linkedin'] });
    expect(c.promptDraft()).toBe('live prompt');
    expect(c.cadenceDraft()).toBe(48);
    expect(c.networksDraft()).toEqual(['twitter', 'linkedin']);
    expect(c.previewNetwork()).toBe('twitter');
  });

  it('toggleNetwork adds then removes, and the preview network falls back to the first remaining', () => {
    const { c } = make({ networks: ['twitter', 'linkedin'] });
    c.toggleNetwork('mastodon');
    expect(c.networksDraft()).toContain('mastodon');
    c.toggleNetwork('mastodon');
    expect(c.networksDraft()).not.toContain('mastodon');
    // remove the preview network → fallback to the first remaining
    c.toggleNetwork('twitter');
    expect(c.previewNetwork()).toBe('linkedin');
  });

  it('resetToDefault restores the default prompt', () => {
    const { c } = make({ prompt: 'live prompt', defaultPrompt: 'the default' });
    c.promptDraft.set('edited');
    c.resetToDefault();
    expect(c.promptDraft()).toBe('the default');
  });

  it('save POSTs the drafts and emits the server config', () => {
    const payload: AutoPilotSavedPayload = { prompt: 'saved', cadence_hours: 12, target_networks: ['twitter'] };
    const post = jasmine.createSpy('post').and.returnValue(of({ data: payload }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SocialAutoPilotDialogComponent],
      providers: [
        { provide: ApiService, useValue: { post } },
        { provide: ToastService, useValue: { success: jasmine.createSpy('s'), error: jasmine.createSpy('e') } },
      ],
    });
    const fx = TestBed.createComponent(SocialAutoPilotDialogComponent);
    fx.componentRef.setInput('prompt', 'x');
    fx.componentRef.setInput('cadenceHours', 24);
    fx.componentRef.setInput('targetNetworks', []);
    fx.componentRef.setInput('defaultPrompt', 'x');
    fx.componentRef.setInput('platforms', []);
    fx.detectChanges();
    const c = fx.componentInstance;
    const emitted = jasmine.createSpy('saved');
    c.saved.subscribe(emitted);
    c.promptDraft.set('my draft');
    c.cadenceDraft.set(12);
    c.save();
    expect(post).toHaveBeenCalledWith('/social/auto-pilot/config', {
      prompt: 'my draft',
      cadence_hours: 12,
      target_networks: [],
    });
    expect(emitted).toHaveBeenCalledWith(payload);
  });

  it('save is a no-op while a save is in flight', () => {
    const { c, post } = make();
    c.save();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('previewPost POSTs the preview and sets the text', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: { text: 'sample post', mediaSuggestion: 'kitchen.jpg' } }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SocialAutoPilotDialogComponent],
      providers: [
        { provide: ApiService, useValue: { post } },
        { provide: ToastService, useValue: { success: jasmine.createSpy('s'), error: jasmine.createSpy('e') } },
      ],
    });
    const fx = TestBed.createComponent(SocialAutoPilotDialogComponent);
    fx.componentRef.setInput('prompt', 'x');
    fx.componentRef.setInput('cadenceHours', 24);
    fx.componentRef.setInput('targetNetworks', ['twitter']);
    fx.componentRef.setInput('defaultPrompt', 'x');
    fx.componentRef.setInput('platforms', [{ id: 'twitter', label: 'X', color: '#000', glyph: 'M0 0' }]);
    fx.detectChanges();
    const c = fx.componentInstance;
    c.promptDraft.set('preview me');
    c.previewPost();
    expect(post).toHaveBeenCalledWith('/social/auto-pilot/preview', { network: 'twitter', prompt: 'preview me' });
    expect(c.previewText()).toBe('sample post');
    expect(c.previewMedia()).toBe('kitchen.jpg');
  });
});
