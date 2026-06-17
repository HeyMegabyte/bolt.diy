import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FeatureDossierComponent } from './feature-dossier.component';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import type { DossierModel } from './dossier.model';

/**
 * §17 ticket: the `/admin/site-features` "Spec ↗" full-screen modal must behave
 * like a proper takeover dialog — Esc closes, focus is trapped, it carries the
 * dialog role/aria, AND it locks background page scroll while open (a
 * `position:fixed inset:0` takeover otherwise lets the page behind scroll, so a
 * trackpad swipe at the dossier's scroll boundary bleeds to the admin page
 * underneath). This spec locks all four; the scroll-lock assertion is the RED
 * driver (the dossier never touched `document.body.style.overflow`).
 */
const MODEL: DossierModel = {
  kind: 'Feature',
  key: 'ai_concierge_widget',
  name: 'AI Concierge Widget',
  summary: 'A site-embedded concierge that answers visitor questions.',
  checklist: ['Answers FAQs', 'Escalates to email'],
  e2eTests: ['e2e/ai_concierge_widget/widget.spec.ts'],
  stage: 'beta',
  rolloutPercent: 25,
  requiredPlan: 'pro',
};

describe('FeatureDossierComponent (§17 spec-sheet takeover modal)', () => {
  let fixture: ComponentFixture<FeatureDossierComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FeatureDossierComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ApiService, useValue: { post: () => ({ subscribe() {} }), get: () => ({ subscribe() {} }) } },
        { provide: ToastService, useValue: { success() {}, error() {} } },
      ],
    });
    fixture = TestBed.createComponent(FeatureDossierComponent);
  });

  afterEach(() => {
    // Guard the global side effect can't leak between specs.
    document.body.style.overflow = '';
    TestBed.resetTestingModule();
  });

  function open(): HTMLElement {
    fixture.componentRef.setInput('model', MODEL);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders nothing when closed and locks no scroll', () => {
    fixture.componentRef.setInput('model', MODEL);
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="feature-dossier"]')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('is a focus-trapped dialog with the right aria when open', () => {
    const host = open();
    const root = host.querySelector('[data-testid="feature-dossier"]') as HTMLElement | null;
    expect(root).withContext('dossier renders when open').not.toBeNull();
    expect(root?.getAttribute('role')).toBe('dialog');
    expect(root?.getAttribute('aria-modal')).toBe('true');
    // cdkTrapFocus keeps Tab inside the takeover.
    expect(root?.hasAttribute('cdkTrapFocus')).withContext('focus is trapped').toBeTrue();
  });

  it('locks background page scroll while open, restores it on close', () => {
    open();
    expect(document.body.style.overflow).withContext('body scroll locked while open').toBe('hidden');
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    expect(document.body.style.overflow).withContext('body scroll restored on close').not.toBe('hidden');
  });

  it('Escape emits closed when open', () => {
    open();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => (closed += 1));
    fixture.componentInstance.onEscape();
    expect(closed).toBe(1);
  });

  it('restores body scroll on destroy (never leaves the page frozen)', () => {
    open();
    expect(document.body.style.overflow).toBe('hidden');
    fixture.destroy();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
