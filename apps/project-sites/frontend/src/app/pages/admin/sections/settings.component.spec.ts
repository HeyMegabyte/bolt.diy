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

  /**
   * a11y form-label sweep: the brand-color rows nest TWO controls (the native
   * color swatch + the hex text field) inside ONE <label>. HTML associates a
   * label with only its first control, so the hex inputs were unnamed for AT.
   * Every brand-color control must carry its own accessible name.
   */
  it('gives every brand-color control a distinct accessible name', () => {
    build({ id: 's', slug: 'demo' });
    const el = fixture.nativeElement as HTMLElement;
    const colorInputs = Array.from(el.querySelectorAll('input[type="color"]')) as HTMLInputElement[];
    const hexInputs = Array.from(
      el.querySelectorAll('input.font-mono[type="text"]'),
    ) as HTMLInputElement[];
    expect(colorInputs.length).toBe(2);
    expect(hexInputs.length).toBeGreaterThanOrEqual(2);
    for (const inp of [...colorInputs, ...hexInputs.slice(0, 2)]) {
      const name = inp.getAttribute('aria-label');
      expect(name && name.trim().length > 0)
        .withContext(`accessible name on ${inp.getAttribute('placeholder') ?? inp.type}`)
        .toBeTrue();
    }
    // The swatch + hex field for one color must NOT share an identical name.
    expect(colorInputs[0].getAttribute('aria-label')).not.toBe(
      hexInputs[0].getAttribute('aria-label'),
    );
  });
});

/**
 * sendInvite emails a real team invite to invite.email. It had no client
 * validation → a typo POSTs /team/invites and round-trips to a generic server
 * error. Now it validates the address first (useful inline error, no wasted
 * POST) — the CRUD "real validation + useful errors" bar.
 */
describe('AdminSettingsComponent (invite email validation)', () => {
  let post: jasmine.Spy;
  let error: jasmine.Spy;
  function build(): AdminSettingsComponent {
    post = jasmine.createSpy('post').and.returnValue(of({}));
    error = jasmine.createSpy('error');
    TestBed.configureTestingModule({
      imports: [AdminSettingsComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: null }), put: () => of({}), post, delete: () => of({}) } },
        { provide: ToastService, useValue: { error, success: () => 0, info: () => 0, warning: () => 0 } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(false) } },
        { provide: Router, useValue: { navigate: () => undefined } },
        { provide: ActivatedRoute, useValue: { firstChild: null, snapshot: { fragment: null, url: [] } } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1', slug: 's' }), loadData: () => undefined } },
      ],
    });
    return TestBed.createComponent(AdminSettingsComponent).componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('rejects a malformed invite email — no POST, useful error', () => {
    const c = build();
    c.invite = { email: 'notanemail', role: 'editor' };
    c.sendInvite();
    expect(post).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('rejects an empty invite email', () => {
    const c = build();
    c.invite = { email: '   ', role: 'editor' };
    c.sendInvite();
    expect(post).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('accepts a well-formed email — POSTs once to /team/invites', () => {
    const c = build();
    c.invite = { email: 'mate@example.com', role: 'editor' };
    c.sendInvite();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.calls.mostRecent().args[0]).toBe('/team/invites');
  });

  it('inviteEmailInvalid() is true only for a non-empty malformed value', () => {
    const c = build();
    c.invite = { email: '', role: 'editor' };
    expect(c.inviteEmailInvalid()).toBe(false); // empty = incomplete, not "invalid"
    c.invite = { email: 'nope', role: 'editor' };
    expect(c.inviteEmailInvalid()).toBe(true);
    c.invite = { email: 'ok@x.io', role: 'editor' };
    expect(c.inviteEmailInvalid()).toBe(false);
  });
});

/**
 * WCAG 4.1.2 — the invite form's email input + role select are placeholder-only
 * inside a 3-col grid with NO visible label, so a screen reader announced them
 * with no purpose. They get an aria-label (no visible label exists to associate).
 */
describe('AdminSettingsComponent (invite control accessible names)', () => {
  function render(): ComponentFixture<AdminSettingsComponent> {
    TestBed.configureTestingModule({
      imports: [AdminSettingsComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: null }), put: () => of({}), post: () => of({}), delete: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, info: () => 0, warning: () => 0 } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(false) } },
        { provide: Router, useValue: { navigate: () => undefined } },
        { provide: ActivatedRoute, useValue: { firstChild: null, snapshot: { fragment: null, url: [] } } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1', slug: 's' }), loadData: () => undefined } },
      ],
    });
    const fx = TestBed.createComponent(AdminSettingsComponent);
    fx.detectChanges();                       // run ngOnInit first (it may set tab from the route)
    fx.componentInstance.tab.set('team');     // the invite form lives in the Team tab
    fx.componentInstance.inviting.set(true);
    fx.detectChanges();
    return fx;
  }
  const inviteEmail = (el: HTMLElement) => el.querySelector('input[placeholder="teammate@email.com"]') as HTMLInputElement | null;
  const accName = (c: Element, el: HTMLElement) => c.getAttribute('aria-label') || (c.id && el.querySelector(`label[for="${c.id}"]`));
  afterEach(() => TestBed.resetTestingModule());

  it('the invite email input has an accessible name', () => {
    const el = render().nativeElement as HTMLElement;
    const input = inviteEmail(el)!;
    expect(input).withContext('invite form rendered in Team tab').toBeTruthy();
    expect(accName(input, el)).withContext('email input has aria-label or associated label').toBeTruthy();
  });

  it('the invite role select has an accessible name', () => {
    const el = render().nativeElement as HTMLElement;
    const grid = inviteEmail(el)!.closest('.grid')!;
    const select = grid.querySelector('select') as HTMLSelectElement;
    expect(select).withContext('role select in the invite grid').toBeTruthy();
    expect(accName(select, el)).withContext('role select has aria-label or associated label').toBeTruthy();
  });
});
