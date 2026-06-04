import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminFormsComponent } from './forms.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';
import { provideRouter } from '@angular/router';

/**
 * Convergence r17 — cyan/black cohesion + a11y guard for the Forms section.
 *
 * Locks three contracts:
 *  1. Site-reactive load — on a deep-link the selected site resolves AFTER
 *     mount, so the constructor effect (not ngOnInit-once) must fire
 *     reload + loadSettings + loadMcp the instant selectedSite() resolves.
 *  2. The submissions count pill renders an <app-rolling-counter> (cinematic
 *     stat mandate) and the table rows are keyboard-openable (role=button +
 *     tabindex + keydown handler) for WCAG 2.1.1 / 2.4.7.
 *  3. Test-scenario pills + the manual-edit guard behave correctly.
 */
describe('AdminFormsComponent (cohesion + a11y, convergence r17)', () => {
  let fixture: ComponentFixture<AdminFormsComponent>;
  let component: AdminFormsComponent;
  let selectedSite: WritableSignal<{ id: string } | null>;
  let get: jasmine.Spy;
  let put: jasmine.Spy;

  function build(initial: { id: string } | null): void {
    try {
      localStorage.removeItem('ps_form_prompt_mcps');
      localStorage.removeItem('ps_forms_view');
    } catch {
      /* private mode — ignore */
    }
    selectedSite = signal<{ id: string } | null>(initial);
    get = jasmine.createSpy('get').and.callFake((url: string) => {
      if (url.includes('/ai-settings')) {
        return of({ data: { form_router_prompt: '', form_router_prompt_default: '', reply_email: '' } });
      }
      if (url.includes('/mcp/connections')) {
        return of({ data: { connections: [] } });
      }
      if (url.includes('/form-submissions')) {
        return of({ data: [] });
      }
      return of({ data: [] });
    });
    put = jasmine.createSpy('put').and.returnValue(of({}));
    TestBed.configureTestingModule({
      imports: [AdminFormsComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            get,
            put,
            post: jasmine.createSpy('post').and.returnValue(of({ data: {} })),
          },
        },
        {
          provide: ToastService,
          useValue: {
            error: jasmine.createSpy('error'),
            success: jasmine.createSpy('success'),
          },
        },
        { provide: AdminStateService, useValue: { selectedSite } },
        // routerLinks in the template need ActivatedRoute (added by a later worktree); provide a no-op router.
        provideRouter([]),
      ],
    });
    fixture = TestBed.createComponent(AdminFormsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit + first effect flush
  }

  afterEach(() => {
    fixture?.destroy(); // clears the auto-poll setInterval via ngOnDestroy
    TestBed.resetTestingModule();
  });

  it('does NOT fetch anything on mount when no site is selected (deep-link)', () => {
    build(null);
    expect(get).not.toHaveBeenCalled();
  });

  it('fires reload + loadSettings + loadMcp the instant the site resolves', () => {
    build(null);
    selectedSite.set({ id: 'site-1' });
    fixture.detectChanges();
    const urls = get.calls.allArgs().map((a) => a[0] as string);
    expect(urls.some((u) => u.includes('/form-submissions'))).toBe(true);
    expect(urls.some((u) => u.includes('/ai-settings'))).toBe(true);
    expect(urls.some((u) => u.includes('/mcp/connections'))).toBe(true);
  });

  it('does not re-load when the same site id is set again (guarded effect)', () => {
    build({ id: 'site-1' });
    const callsAfterMount = get.calls.count();
    selectedSite.set({ id: 'site-1' });
    fixture.detectChanges();
    expect(get.calls.count()).toBe(callsAfterMount);
  });

  it('renders the submissions count as an <app-rolling-counter> when submissions exist', () => {
    build({ id: 'site-1' });
    component.submissions.set([
      { id: 's1', form_name: 'newsletter', email: 'a@b.c', fields: {}, status: 'received', origin_url: null, ip_address: null, created_at: new Date().toISOString() },
    ]);
    fixture.detectChanges();
    const counter = fixture.nativeElement.querySelector('.header-pill app-rolling-counter');
    expect(counter).withContext('count pill must use the cinematic rolling-counter').toBeTruthy();
  });

  it('renders keyboard-openable submission rows (role=button + tabindex)', () => {
    build({ id: 'site-1' });
    component.submissions.set([
      { id: 's1', form_name: 'contact', email: null, fields: {}, status: 'received', origin_url: null, ip_address: null, created_at: new Date().toISOString() },
    ]);
    fixture.detectChanges();
    const row: HTMLElement | null = fixture.nativeElement.querySelector('.submission-row');
    expect(row).toBeTruthy();
    expect(row!.getAttribute('role')).toBe('button');
    expect(row!.getAttribute('tabindex')).toBe('0');
    expect(row!.getAttribute('aria-label')).toContain('contact');
  });

  it('countView returns 0 for an empty inbox and counts a matching view', () => {
    build({ id: 'site-1' });
    expect(component.countView('all')).toBe(0);
    component.submissions.set([
      { id: 's1', form_name: 'newsletter-signup', email: 'a@b.c', fields: {}, status: 'received', origin_url: null, ip_address: null, created_at: new Date().toISOString() },
    ]);
    expect(component.countView('newsletter')).toBe(1);
    expect(component.countView('with-email')).toBe(1);
  });

  it('applyTestScenario loads a sample + sets the active scenario', () => {
    build({ id: 'site-1' });
    component.applyTestScenario('contact');
    expect(component.activeScenario()).toBe('contact');
    expect(component.testInput.form_name).toBe('contact');
    expect(component.testInput.fields_json).toContain('submission');
  });

  it('onTestInputEdited clears the active scenario on a manual edit', () => {
    build({ id: 'site-1' });
    component.activeScenario.set('contact');
    component.onTestInputEdited();
    expect(component.activeScenario()).toBeNull();
  });

  it('togglePromptMcp toggles + persists the per-prompt MCP allow-list', () => {
    build({ id: 'site-1' });
    expect(component.isMcpEnabled('stripe')).toBe(false);
    component.togglePromptMcp('stripe');
    expect(component.isMcpEnabled('stripe')).toBe(true);
    expect(put).toHaveBeenCalled();
    component.togglePromptMcp('stripe');
    expect(component.isMcpEnabled('stripe')).toBe(false);
  });
});

/**
 * Guards the submissions load-error gating: a failed `/form-submissions` fetch
 * toasted but then fell through to the "No submissions yet" empty state — a
 * masquerade. Now a non-silent reload() sets a persistent loadError + Retry card;
 * a silent background poll keeps any loaded list and never raises the error.
 * overrideComponent strips the template so the constructor effect doesn't auto-fire.
 */
describe('AdminFormsComponent (submissions load-error gating)', () => {
  function makeErroring(get: jasmine.Spy): { c: AdminFormsComponent; toastErr: jasmine.Spy } {
    const toastErr = jasmine.createSpy('error');
    TestBed.configureTestingModule({
      imports: [AdminFormsComponent],
      providers: [
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
        { provide: ApiService, useValue: { get, post: () => of({}), put: () => of({}), delete: () => of({}) } },
        { provide: ToastService, useValue: { error: toastErr, success: () => undefined } },
        provideRouter([]),
      ],
    });
    TestBed.overrideComponent(AdminFormsComponent, { set: { template: '<div></div>', imports: [] } });
    return { c: TestBed.createComponent(AdminFormsComponent).componentInstance, toastErr };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('success populates submissions and leaves loadError null', () => {
    const { c } = makeErroring(jasmine.createSpy('get').and.returnValue(of({ data: [{ id: 'm1' }] })));
    c.reload();
    expect(c.loadError()).toBeNull();
    expect(c.submissions().length).toBe(1);
    expect(c.loading()).toBe(false);
  });

  it('a non-silent load error sets a persistent loadError banner ONLY — no toast (the read is {silent}, own toast dropped)', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 })));
    const { c, toastErr } = makeErroring(get);
    c.reload();
    expect(c.loadError()).toContain('Could not load');
    expect(c.submissions().length).toBe(0);
    // the inline banner is the persistent UX; no transient toast on top, and the
    // read is {silent} so the generic ApiService toast can't fire either.
    expect(toastErr).not.toHaveBeenCalled();
    const call = get.calls.allArgs().find((a) => String(a[0]).includes('/form-submissions'));
    expect(call?.[2]).toEqual({ silent: true });
  });

  it('a SILENT poll failure does not raise loadError or toast', () => {
    const { c, toastErr } = makeErroring(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    c.reload({ silent: true });
    expect(c.loadError()).toBeNull();
    expect(toastErr).not.toHaveBeenCalled();
  });

  it('retry after an error clears the prior loadError', () => {
    const get = jasmine.createSpy('get').and.returnValues(throwError(() => ({ status: 500 })), of({ data: [] }));
    const { c } = makeErroring(get);
    c.reload();
    expect(c.loadError()).not.toBeNull();
    c.reload();
    expect(c.loadError()).toBeNull();
  });
});

/**
 * WCAG 4.1.2 — the "test a submission" panel inputs (form_name / email /
 * fields-JSON) are placeholder-only with no visible <label>, so a screen
 * reader announced them with no purpose. Add aria-label.
 */
describe('AdminFormsComponent (test-panel accessible names)', () => {
  function render() {
    TestBed.configureTestingModule({
      imports: [AdminFormsComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [] }), put: () => of({}), post: () => of({ data: {} }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AdminFormsComponent);
    fx.detectChanges();
    fx.componentInstance.testOpen.set(true);
    fx.detectChanges();
    return fx.nativeElement as HTMLElement;
  }
  const named = (el: HTMLElement, sel: string): boolean => {
    const c = el.querySelector(sel);
    return !!c && !!(c.getAttribute('aria-label') || (c.id && el.querySelector(`label[for="${c.id}"]`)));
  };
  afterEach(() => TestBed.resetTestingModule());

  it('form_name / email / fields inputs have accessible names', () => {
    const el = render();
    expect(named(el, 'input[placeholder^="form_name"]')).withContext('form_name').toBeTrue();
    expect(named(el, 'input[type="email"]')).withContext('email').toBeTrue();
    expect(named(el, 'textarea[placeholder^="Other fields"]')).withContext('fields json').toBeTrue();
  });
});

describe('AdminFormsComponent (submission-cap honesty)', () => {
  let fixture: ComponentFixture<AdminFormsComponent>;
  function render(n: number): HTMLElement {
    const selectedSite = signal<{ id: string } | null>({ id: 's1' });
    const get = jasmine.createSpy('get').and.callFake((url: string) =>
      url.includes('/form-submissions') ? of({ data: [] }) : of({ data: {} }));
    TestBed.configureTestingModule({
      imports: [AdminFormsComponent],
      providers: [
        { provide: ApiService, useValue: { get, post: () => of({ data: {} }), put: () => of({ data: {} }), delete: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, warning: () => 0, info: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite } },
        provideRouter([]),
      ],
    });
    fixture = TestBed.createComponent(AdminFormsComponent);
    fixture.detectChanges();
    fixture.componentInstance.loading.set(false);
    fixture.componentInstance.submissions.set(Array.from({ length: n }, (_, i) => ({ id: 'x' + i, status: 'new', fields: {}, created_at: '' } as never)));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  afterEach(() => { try { localStorage.clear(); } catch { /* */ } TestBed.resetTestingModule(); });

  it('shows the "latest 200" note when the inbox hits the server cap (silent-truncation honesty)', () => {
    const host = render(200);
    expect(host.querySelector('[data-testid="forms-cap-note"]')?.textContent).withContext('user must know older submissions exist').toContain('latest 200');
  });

  it('does NOT show the cap note below the cap', () => {
    const host = render(12);
    expect(host.querySelector('[data-testid="forms-cap-note"]')).toBeNull();
  });
});
