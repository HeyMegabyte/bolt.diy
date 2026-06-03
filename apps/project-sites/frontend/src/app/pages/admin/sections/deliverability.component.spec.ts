import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AdminDeliverabilityComponent } from './deliverability.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Guards the Email Deliverability (#12) surface: empty state with no selected
 * site, Check calls GET /sites/:id/deliverability (+ optional domain), and the
 * report (score + SPF/DKIM/DMARC + fixes) renders. Locks the read-only contract.
 */
describe('AdminDeliverabilityComponent', () => {
  let fixture: ComponentFixture<AdminDeliverabilityComponent>;
  let host: HTMLElement;
  let get: jasmine.Spy;
  let selectedSite: () => { id: string; name: string; slug: string } | null;

  const REPORT = {
    ok: true,
    report: {
      domain: 'example.com',
      spf: { present: true, record: 'v=spf1 -all' },
      dmarc: { present: true, record: 'v=DMARC1; p=reject', policy: 'reject' },
      dkim: { present: false, selectorsChecked: ['google'], foundSelectors: [] },
      score: 70,
      recommendations: ['Publish a DKIM key.'],
    },
  };

  function build(site: { id: string; name: string; slug: string } | null): void {
    selectedSite = () => site;
    get = jasmine.createSpy('get').and.returnValue(of(REPORT));
    TestBed.configureTestingModule({
      imports: [AdminDeliverabilityComponent],
      providers: [
        { provide: ApiService, useValue: { get } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    fixture = TestBed.createComponent(AdminDeliverabilityComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  const q = (sel: string): HTMLElement | null => host.querySelector(sel);
  const all = (sel: string): HTMLElement[] => Array.from(host.querySelectorAll(sel));

  afterEach(() => TestBed.resetTestingModule());

  it('shows the empty state when no site is selected', () => {
    build(null);
    expect(q('[data-testid="deliverability-empty"]')).not.toBeNull();
    expect(q('[data-testid="deliverability-check-btn"]')).toBeNull();
  });

  it('checks the selected site and renders the report', () => {
    build({ id: 'site1', name: 'Acme', slug: 'acme' });
    (q('[data-testid="deliverability-check-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(get).toHaveBeenCalledTimes(1);
    expect(get.calls.mostRecent().args[0]).toBe('/sites/site1/deliverability');
    expect(q('[data-testid="deliverability-result"]')).not.toBeNull();
    expect(fixture.componentInstance.report()?.score).toBe(70);
    expect(all('[data-testid="deliverability-rec-row"]').length).toBe(1);
  });

  it('passes a domain override as a query param when set', () => {
    build({ id: 'site1', name: 'Acme', slug: 'acme' });
    fixture.componentInstance.domainModel.set('mail.acme.com');
    (q('[data-testid="deliverability-check-btn"]') as HTMLButtonElement).click();
    expect(get.calls.mostRecent().args[1]).toEqual({ domain: 'mail.acme.com' });
  });

  it('surfaces a 404 / not-available error gracefully', () => {
    build({ id: 'site1', name: 'Acme', slug: 'acme' });
    get.and.returnValue(throwError(() => ({ error: { error: { message: 'Not found' } } })));
    (q('[data-testid="deliverability-check-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(q('[data-testid="deliverability-error"]')).not.toBeNull();
  });

  it('a 404 shows the "not available for this site" feature-gate message', () => {
    build({ id: 'site1', name: 'Acme', slug: 'acme' });
    get.and.returnValue(throwError(() => ({ status: 404 })));
    fixture.componentInstance.check();
    expect(fixture.componentInstance.error()).toContain('not available for this site');
  });

  it('a transient failure (no server message) says "try again" — NOT a permanent "not available"', () => {
    build({ id: 'site1', name: 'Acme', slug: 'acme' });
    get.and.returnValue(throwError(() => ({ status: 500 })));
    fixture.componentInstance.check();
    const e = fixture.componentInstance.error() ?? '';
    expect(e).withContext('transient errors must invite a retry, not read as a permanent gate').toContain('try again');
    expect(e).not.toContain('not available for this site');
  });

  it('colors the score by band', () => {
    build({ id: 'site1', name: 'Acme', slug: 'acme' });
    const c = fixture.componentInstance;
    expect(c.scoreClass(90)).toBe('text-primary');
    expect(c.scoreClass(50)).toBe('text-amber-300');
    expect(c.scoreClass(10)).toBe('text-red-400');
  });

  it('renders the cyan score meter as an aria progressbar filled to the score', () => {
    build({ id: 'site1', name: 'Acme', slug: 'acme' });
    (q('[data-testid="deliverability-check-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const bar = q('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('aria-valuenow')).toBe('70');
    const fill = q('[data-testid="deliverability-meter"]') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe('70%');
  });

  it('conveys record status with a symbol + text, not color alone (WCAG 1.4.1)', () => {
    build({ id: 'site1', name: 'Acme', slug: 'acme' });
    (q('[data-testid="deliverability-check-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // SPF present → ✓ Configured; DKIM absent → ! Not found
    expect(q('[data-testid="deliverability-spf"]')?.textContent).toContain('✓');
    expect(q('[data-testid="deliverability-dkim"]')?.textContent).toContain('!');
    expect(q('[data-testid="deliverability-dkim"]')?.textContent).toContain('Not found');
  });

  it('associates the domain label with its input for screen readers', () => {
    build({ id: 'site1', name: 'Acme', slug: 'acme' });
    const input = q('[data-testid="deliverability-domain"]') as HTMLInputElement;
    expect(input.id).toBe('deliverability-domain');
    expect(q('label[for="deliverability-domain"]')).not.toBeNull();
  });
});
