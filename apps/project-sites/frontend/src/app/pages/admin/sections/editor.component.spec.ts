import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { AdminEditorComponent } from './editor.component';
import { AdminStateService } from '../admin-state.service';
import { BoltEmbedService } from '../../../services/bolt-embed.service';
import { ApiService } from '../../../services/api.service';

/**
 * First coverage for the Editor route shell — the live `/admin/editor` host.
 * The bolt.diy iframe lives in AdminComponent; this thin component only owns
 * the 3-state machine + the Cmd+K dispatch:
 *   1. no site selected      → welcome empty state + onboarding checklist
 *   2. site + !editorReady    → cinematic "Booting your AI editor" veil
 *   3. site + editorReady     → neither (the persistent iframe shows through)
 * Plus openPalette() must dispatch a Meta+K keydown so the quick-find button
 * opens the command palette.
 */
describe('AdminEditorComponent (route shell state machine)', () => {
  let fixture: ComponentFixture<AdminEditorComponent>;
  let host: HTMLElement;
  let selectedSite: WritableSignal<{ id: string } | null>;
  let editorReady: WritableSignal<boolean>;

  function build(site: { id: string } | null, ready: boolean): void {
    selectedSite = signal<{ id: string } | null>(site);
    editorReady = signal<boolean>(ready);
    TestBed.configureTestingModule({
      imports: [AdminEditorComponent],
      providers: [
        { provide: AdminStateService, useValue: { selectedSite, newSite: jasmine.createSpy('newSite') } },
        { provide: BoltEmbedService, useValue: { editorReady, loadingStage: signal('Booting bolt.diy') } },
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl') } },
        { provide: ApiService, useValue: {} },
      ],
    });
    fixture = TestBed.createComponent(AdminEditorComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  afterEach(() => { try { localStorage.clear(); } catch { /* */ } TestBed.resetTestingModule(); });

  it('shows the welcome empty state (no veil) when no site is selected', () => {
    build(null, false);
    expect(host.querySelector('.empty-state-pretty')).withContext('welcome state').not.toBeNull();
    expect(host.textContent ?? '').toContain('Welcome to your admin');
    expect(host.querySelector('app-onboarding-checklist')).not.toBeNull();
    expect(host.querySelector('.ed-veil')).withContext('no booting veil without a site').toBeNull();
  });

  it('shows the cinematic booting veil (not the welcome) when a site is selected but the editor is not ready', () => {
    build({ id: 's1' }, false);
    expect(host.querySelector('.ed-veil')).withContext('booting veil').not.toBeNull();
    expect(host.textContent ?? '').toContain('Booting your AI editor');
    expect(host.querySelector('.empty-state-pretty')).withContext('welcome hidden once a site exists').toBeNull();
  });

  it('shows neither veil nor welcome once the editor is ready (the persistent iframe shows through)', () => {
    build({ id: 's1' }, true);
    expect(host.querySelector('.ed-veil')).toBeNull();
    expect(host.querySelector('.empty-state-pretty')).toBeNull();
  });

  it('openPalette() dispatches a Meta+K keydown so quick-find opens the command palette', () => {
    build(null, false);
    let captured: KeyboardEvent | null = null;
    const handler = (e: Event): void => { captured = e as KeyboardEvent; };
    document.addEventListener('keydown', handler);
    try {
      fixture.componentInstance.openPalette();
    } finally {
      document.removeEventListener('keydown', handler);
    }
    expect(captured).withContext('a keydown was dispatched').not.toBeNull();
    expect(captured!.key).toBe('k');
    expect(captured!.metaKey).toBeTrue();
  });
});
