import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { of } from 'rxjs';
import { AdminDomainsComponent } from './domains.component';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';

/**
 * Guards the Domains section cyan/black cohesion + a11y convergence pass (round 4):
 *  - connected-domain stats render through `<app-rolling-counter>` (numeric-stat mandate)
 *  - the three surfaces keep their `appReveal` entrance hosts
 *  - the transfer-out modal honours the WAI-ARIA dialog contract
 *    (role=dialog + aria-modal + aria-labelledby + focus-trap)
 *  - the no-site guard renders an accessible empty state
 *  - `verifiedCount` derives the live-domain tally for the stat chip
 */
describe('AdminDomainsComponent (cyan/black cohesion + a11y)', () => {
  let fixture: ComponentFixture<AdminDomainsComponent>;
  let selectedSite: WritableSignal<{ id: string; slug: string } | null>;

  interface HostnameRow {
    id: string;
    hostname: string;
    type: string;
    status: string;
    ssl_status: string;
    is_primary: number;
  }

  function build(
    initial: { id: string; slug: string } | null,
    hostnames: HostnameRow[] = [],
  ): void {
    selectedSite = signal(initial);
    const api = {
      get: () => of({ data: hostnames }),
      post: () => of({ data: {} }),
      put: () => of({ data: {} }),
      delete: () => of({ data: {} }),
    };
    const toast = { success: () => undefined, error: () => undefined };
    const confirmSvc = { confirm: () => Promise.resolve(true) };

    TestBed.configureTestingModule({
      imports: [AdminDomainsComponent],
      providers: [
        { provide: AdminStateService, useValue: { selectedSite } },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: ConfirmService, useValue: confirmSvc },
      ],
    });
    fixture = TestBed.createComponent(AdminDomainsComponent);
    fixture.detectChanges();
  }

  function row(over: Partial<HostnameRow> = {}): HostnameRow {
    return {
      id: 'h1',
      hostname: 'example.com',
      type: 'custom_cname',
      status: 'active',
      ssl_status: 'active',
      is_primary: 0,
      ...over,
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the connected-domain count through <app-rolling-counter> (numeric-stat mandate)', () => {
    build({ id: 's1', slug: 'vito' }, [row({ id: 'a' }), row({ id: 'b', status: 'pending' })]);
    const el: HTMLElement = fixture.nativeElement;
    const chip = el.querySelector('.count-chip');
    expect(chip).toBeTruthy();
    // Numeric stats are NOT raw text nodes — they flow through the rolling counter.
    expect(chip!.querySelector('app-rolling-counter')).toBeTruthy();
  });

  it('keeps the three appReveal entrance hosts when a site is selected', () => {
    build({ id: 's1', slug: 'vito' }, [row()]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('[appReveal]').length).toBeGreaterThanOrEqual(3);
  });

  it('derives connectedCount + verifiedCount from the hostname list', () => {
    build({ id: 's1', slug: 'vito' }, [
      row({ id: 'a', status: 'active' }),
      row({ id: 'b', status: 'pending_validation' }),
      row({ id: 'c', status: 'verification_failed' }),
    ]);
    const cmp = fixture.componentInstance;
    expect(cmp.connectedCount()).toBe(3);
    // Only the 'active' row maps to the 'verified' tone.
    expect(cmp.verifiedCount()).toBe(1);
  });

  it('renders an accessible empty state when no site is selected', () => {
    build(null);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-empty-state')).toBeTruthy();
    // No stat chip when there is no site/hostnames.
    expect(el.querySelector('.count-chip')).toBeNull();
  });

  it('exposes the WAI-ARIA dialog contract on the transfer-out modal', () => {
    build({ id: 's1', slug: 'vito' }, [row({ type: 'custom_cname' })]);
    const cmp = fixture.componentInstance;
    cmp.openTransferModal(row({ type: 'custom_cname' }) as never);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const panel = el.querySelector('[data-testid="transfer-modal"] [role="dialog"]');
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute('aria-modal')).toBe('true');
    expect(panel!.getAttribute('aria-labelledby')).toBe('transfer-modal-title');
    // The labelling target exists and names the dialog.
    expect(el.querySelector('#transfer-modal-title')).toBeTruthy();
    // Close control is explicitly labelled for screen readers.
    expect(el.querySelector('.modal-close')?.getAttribute('aria-label')).toBe('Close dialog');
  });

  it('closeTransferModal clears modal state', () => {
    build({ id: 's1', slug: 'vito' }, [row()]);
    const cmp = fixture.componentInstance;
    cmp.openTransferModal(row() as never);
    expect(cmp.transferModal()).not.toBeNull();
    cmp.closeTransferModal();
    expect(cmp.transferModal()).toBeNull();
  });

  it('maps hostname statuses to the four perceptual tones', () => {
    build({ id: 's1', slug: 'vito' });
    const cmp = fixture.componentInstance;
    expect(cmp.statusTone('active')).toBe('verified');
    expect(cmp.statusTone('pending_validation')).toBe('pending');
    expect(cmp.statusTone('verification_failed')).toBe('error');
    expect(cmp.statusTone('weird')).toBe('neutral');
  });
});
