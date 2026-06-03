import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { AdminSettingsComponent } from './settings.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Convergence r23 cohesion guard for the Settings section.
 *
 * Locks the cyan/black overview stat strip (rolling counters reflect live
 * connection/team state), the tablist a11y contract (role + aria-selected),
 * and the reveal-on-mount animation that every tab shares.
 */
describe('AdminSettingsComponent (cyan/black cohesion + a11y)', () => {
  let fixture: ComponentFixture<AdminSettingsComponent>;
  let selectedSite: WritableSignal<{ id: string; slug: string; business_name?: string } | null>;

  function build(initial: { id: string; slug: string } | null): void {
    selectedSite = signal(initial);
    TestBed.configureTestingModule({
      imports: [AdminSettingsComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            get: jasmine.createSpy('get').and.returnValue(of({ data: null })),
            put: jasmine.createSpy('put').and.returnValue(of({})),
            post: jasmine.createSpy('post').and.returnValue(of({})),
            delete: jasmine.createSpy('delete').and.returnValue(of({})),
          },
        },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success'), info: jasmine.createSpy('info'), warning: jasmine.createSpy('warning') } },
        { provide: ConfirmService, useValue: { confirm: jasmine.createSpy('confirm').and.resolveTo(false) } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        { provide: ActivatedRoute, useValue: { firstChild: null, snapshot: { fragment: null, url: [] } } },
        { provide: AdminStateService, useValue: { selectedSite, loadData: () => undefined } },
      ],
    });
    fixture = TestBed.createComponent(AdminSettingsComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders three rolling-counter stat cells in the overview strip', () => {
    build({ id: 's', slug: 'demo' });
    const el = fixture.nativeElement as HTMLElement;
    const cells = el.querySelectorAll('.stat-strip .stat-cell');
    expect(cells.length).toBe(3);
    expect(el.querySelectorAll('.stat-strip app-rolling-counter').length).toBe(3);
  });

  it('marks the overview strip as a labelled group for AT users', () => {
    build({ id: 's', slug: 'demo' });
    const strip = (fixture.nativeElement as HTMLElement).querySelector('.stat-strip');
    expect(strip?.getAttribute('role')).toBe('group');
    expect(strip?.getAttribute('aria-label')).toBe('Settings overview');
  });

  it('exposes the tabs as a tablist with one selected tab', () => {
    build({ id: 's', slug: 'demo' });
    const el = fixture.nativeElement as HTMLElement;
    const nav = el.querySelector('nav[role="tablist"]');
    expect(nav).toBeTruthy();
    const tabs = el.querySelectorAll('button[role="tab"]');
    expect(tabs.length).toBe(6);
    const selected = Array.from(tabs).filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBe(1);
  });

  it('navigates within the SPA (fragment route) when switching tabs — no full reload', () => {
    build({ id: 's', slug: 'demo' });
    const router = TestBed.inject(Router) as unknown as { navigate: jasmine.Spy };
    fixture.componentInstance.setTab('mcp');
    expect(router.navigate).toHaveBeenCalledWith([], { fragment: 'mcp', replaceUrl: true });
    expect(fixture.componentInstance.tab()).toBe('mcp');
  });
});
