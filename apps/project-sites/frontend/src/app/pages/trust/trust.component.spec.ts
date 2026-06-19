import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TrustComponent } from './trust.component';
import { MetaService } from '../../services/meta.service';

describe('TrustComponent', () => {
  const setMeta = jasmine.createSpy('setMeta');
  const setJsonLd = jasmine.createSpy('setJsonLd');

  function make() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TrustComponent],
      providers: [
        provideRouter([]),
        { provide: MetaService, useValue: { setMeta, setJsonLd } },
      ],
    });
    const f = TestBed.createComponent(TrustComponent);
    f.detectChanges();
    return f;
  }

  beforeEach(() => {
    setMeta.calls.reset();
    setJsonLd.calls.reset();
  });

  it('renders the security headline', () => {
    const el = make().nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('protect');
  });

  it('renders all eight shipped proof-point pillars', () => {
    const el = make().nativeElement as HTMLElement;
    expect(el.querySelectorAll('.trust-card').length).toBe(8);
  });

  it('surfaces the no-client-secrets scan as a real proof point', () => {
    const el = make().nativeElement as HTMLElement;
    expect(el.textContent).toContain('No secrets in the browser');
    expect(el.textContent).toContain('A–F readiness grade');
  });

  it('is candid that SOC 2 is on the roadmap, NOT certified', () => {
    const el = make().nativeElement as HTMLElement;
    const roadmap = el.querySelector('.trust-roadmap')?.textContent ?? '';
    expect(roadmap).toContain('SOC 2');
    expect(roadmap).toContain('not yet certified');
    // Never claim certification anywhere on the page.
    expect((el.textContent ?? '').toLowerCase()).not.toContain('soc 2 certified');
  });

  it('links to security.txt for vulnerability reports', () => {
    const el = make().nativeElement as HTMLElement;
    const link = el.querySelector('a[href="/.well-known/security.txt"]');
    expect(link).toBeTruthy();
  });

  it('sets per-route meta + JSON-LD on init', () => {
    make();
    expect(setMeta).toHaveBeenCalled();
    expect(setJsonLd).toHaveBeenCalled();
    const arg = setMeta.calls.mostRecent().args[0] as { canonical?: string };
    expect(arg.canonical).toBe('https://projectsites.dev/trust');
  });
});
