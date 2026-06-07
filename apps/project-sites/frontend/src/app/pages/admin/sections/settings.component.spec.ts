import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
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

  it('generalEmailsInvalid flags a malformed contact/reply email (empty optional = valid); save() no-ops + toasts when invalid', () => {
    build({ id: 's', slug: 'demo' });
    const c = fixture.componentInstance;
    c.settings.contact_email = '';
    c.settings.reply_email = '';
    expect(c.generalEmailsInvalid()).withContext('empty optional emails are valid').toBeFalse();
    c.settings.contact_email = 'not-an-email';
    expect(c.generalEmailsInvalid()).withContext('malformed contact email → invalid').toBeTrue();
    const api = TestBed.inject(ApiService) as unknown as { put: jasmine.Spy };
    const toast = TestBed.inject(ToastService) as unknown as { error: jasmine.Spy };
    c.save();
    expect(api.put).withContext('no PUT with an invalid email — real validation, not a silent garbage save').not.toHaveBeenCalled();
    expect(toast.error).withContext('useful inline error').toHaveBeenCalled();
  });

  it('does not show a premature "0" count (or announce it) while connections/team load', () => {
    build({ id: 's', slug: 'demo' });
    // Initial loads in-flight: the two list-derived stats have no resolved data yet.
    fixture.componentInstance.loadingConnections.set(true);
    fixture.componentInstance.loadingTeam.set(true);
    fixture.componentInstance.connections.set([]);
    fixture.componentInstance.members.set([]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // Only the STATIC "available integrations" stat shows a count; the two
    // list-derived stats show a loading placeholder, not a definitive "0".
    expect(el.querySelectorAll('.stat-strip app-rolling-counter').length).withContext('list-derived counts withheld while loading').toBe(1);
    const labels = Array.from(el.querySelectorAll('.stat-strip .stat-val')).map((s) => s.getAttribute('aria-label') ?? '');
    expect(labels.some((l) => l.includes('0 connected MCPs'))).withContext('no false "0 connected MCPs" SR announcement').toBeFalse();
    expect(labels.some((l) => l.includes('0 team members'))).withContext('no false "0 team members" SR announcement').toBeFalse();
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

  it('associates the active panel with its tab (APG: role=tabpanel + aria-labelledby ↔ tab id + aria-controls)', () => {
    build({ id: 's', slug: 'demo' }); // default tab = general
    const el = fixture.nativeElement as HTMLElement;
    const panel = el.querySelector('[role="tabpanel"]');
    expect(panel).withContext('active panel exposes role=tabpanel').toBeTruthy();
    expect(panel!.id).toBe('settings-panel');
    expect(panel!.getAttribute('aria-labelledby')).withContext('panel labelled by the active tab').toBe('settings-tab-general');
    const labelTab = el.querySelector('#settings-tab-general');
    expect(labelTab).withContext('aria-labelledby resolves to a real tab').toBeTruthy();
    expect(labelTab!.getAttribute('role')).toBe('tab');
    expect(labelTab!.getAttribute('aria-controls')).withContext('tab points back at its panel').toBe('settings-panel');
  });

  it('the settings tablist is keyboard-navigable — ArrowRight moves focus to the next tab (hlmTablist APG roving)', () => {
    build({ id: 's', slug: 'demo' });
    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host); // focus() + document.activeElement need the el in the doc
    try {
      const nav = host.querySelector('nav[role="tablist"]')!;
      const tabs = Array.from(nav.querySelectorAll('button[role="tab"]')) as HTMLButtonElement[];
      expect(tabs.length).withContext('multiple settings tabs').toBeGreaterThan(1);
      tabs[0].focus();
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(document.activeElement)
        .withContext('ArrowRight moves focus to the next tab (APG roving tabindex)').toBe(tabs[1]);
    } finally {
      host.remove();
    }
  });

  it('revokeInvite confirms (danger) before deleting the invite; cancel → no DELETE', async () => {
    build({ id: 's', slug: 'demo' });
    const c = fixture.componentInstance;
    const api = TestBed.inject(ApiService) as unknown as { delete: jasmine.Spy };
    const confirm = TestBed.inject(ConfirmService) as unknown as { confirm: jasmine.Spy };
    // confirm resolves false by default → cancelled
    await c.revokeInvite({ id: 'inv1', email: 'x@y.com' } as never);
    expect(confirm.confirm).withContext('a destructive revoke must confirm first').toHaveBeenCalled();
    expect((confirm.confirm.calls.mostRecent().args[0] as { danger?: boolean }).danger).withContext('red destructive modal').toBeTrue();
    expect(api.delete).withContext('no DELETE when cancelled').not.toHaveBeenCalled();
    // confirmed → deletes the invite
    confirm.confirm.and.resolveTo(true);
    await c.revokeInvite({ id: 'inv1', email: 'x@y.com' } as never);
    expect(api.delete).toHaveBeenCalledWith('/team/invites/inv1');
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

/**
 * submitPaste() POSTs an MCP paste-key (connects an integration). It had no
 * in-flight guard + the Save button had no [disabled], so rapid clicks fired
 * duplicate connect POSTs during the request window. pasteSaving() now guards
 * the handler + disables the button.
 */
describe('AdminSettingsComponent (paste-key connect is double-submit-safe)', () => {
  function build(post: jasmine.Spy): AdminSettingsComponent {
    TestBed.configureTestingModule({
      imports: [AdminSettingsComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: null }), put: () => of({}), post, delete: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, info: () => 0, warning: () => 0 } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(false) } },
        { provide: Router, useValue: { navigate: () => undefined } },
        { provide: ActivatedRoute, useValue: { firstChild: null, snapshot: { fragment: null, url: [] } } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1', slug: 'demo' }), loadData: () => undefined } },
      ],
    });
    const c = TestBed.createComponent(AdminSettingsComponent).componentInstance;
    c.pastedKey = 'sk-test-123';
    return c;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('fires only ONE POST while the first paste-connect is in flight', () => {
    const inflight = new Subject<unknown>(); // never completes → request stays pending
    const post = jasmine.createSpy('post').and.returnValue(inflight.asObservable());
    const c = build(post);
    c.submitPaste('stripe');
    c.submitPaste('stripe'); // second rapid click while the first is pending
    expect(post).toHaveBeenCalledTimes(1);
    expect(c.pasteSaving()).withContext('in-flight flag set').toBeTrue();
  });

  it('clears the in-flight flag after the POST resolves (re-submittable)', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({}));
    const c = build(post);
    c.submitPaste('stripe');
    expect(c.pasteSaving()).toBeFalse(); // synchronous of({}) completed
  });
});

import { NEVER } from 'rxjs';
import { ConfirmService as ConfirmService2 } from '../../../services/confirm.service';
import { Router as Router2, ActivatedRoute as ActivatedRoute2 } from '@angular/router';

/**
 * WCAG 4.1.3 (Status Messages) + 1.3.1 — the 2FA toggle on the Team tab is the
 * most security-sensitive control in this section and persists ASYNCHRONOUSLY
 * (no Save button). While the PUT is in flight the only feedback was a visual
 * "saving…" span (no aria-live) and the checkbox carried no aria-busy, so a
 * screen-reader user toggling "Require 2FA" got ZERO signal that a network save
 * was running. The control now exposes aria-busy and the status text is an
 * aria-live polite region. Mirrors the feature-flags refresh button pattern.
 */
describe('AdminSettingsComponent (2FA toggle async-save is announced to AT)', () => {
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
    fx.detectChanges();                    // ngOnInit may set the tab from the route
    fx.componentInstance.tab.set('team');  // the 2FA toggle lives in the Team tab
    fx.detectChanges();
    return fx;
  }
  const toggle = (el: HTMLElement) =>
    el.querySelector('[data-testid="team-2fa-toggle"]') as HTMLInputElement | null;
  afterEach(() => TestBed.resetTestingModule());

  it('reflects savingSecurity() on the 2FA checkbox via aria-busy', () => {
    const fx = render();
    const el = fx.nativeElement as HTMLElement;
    const cb = toggle(el)!;
    expect(cb).withContext('2FA toggle rendered in Team tab').toBeTruthy();
    // Idle: no in-flight save → not busy.
    expect(cb.getAttribute('aria-busy')).withContext('not busy at rest').not.toBe('true');
    // In-flight save → busy announced to AT.
    fx.componentInstance.savingSecurity.set(true);
    fx.detectChanges();
    expect(cb.getAttribute('aria-busy'))
      .withContext('aria-busy=true while the 2FA PUT is in flight').toBe('true');
  });

  it('announces the in-flight save via an aria-live region (not a silent visual hint)', () => {
    const fx = render();
    fx.componentInstance.savingSecurity.set(true);
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    const live = Array.from(el.querySelectorAll('[aria-live]')).find(
      (n) => /saving/i.test(n.textContent ?? ''),
    );
    expect(live).withContext('"saving…" status is an aria-live region').toBeTruthy();
    expect(live!.getAttribute('aria-live')).toBe('polite');
  });
});

/**
 * MCP-connection disconnect is toast-armed (7s action, re-clickable mid-async).
 * A second disconnect of the same connection while one is in flight must NOT
 * fire a duplicate DELETE.
 */
describe('AdminSettingsComponent (disconnect in-flight guard)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('ignores a re-entrant disconnect of the same connection while one is in flight', () => {
    const del = jasmine.createSpy('delete').and.returnValue(NEVER);
    TestBed.configureTestingModule({
      imports: [AdminSettingsComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: null }), put: () => of({}), post: () => of({}), delete: del } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, info: () => 0, warning: () => 0 } },
        { provide: ConfirmService2, useValue: { confirm: () => Promise.resolve(false) } },
        { provide: Router2, useValue: { navigate: () => 0 } },
        { provide: ActivatedRoute2, useValue: { firstChild: null, snapshot: { fragment: null, url: [] } } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1', slug: 'a' }), loadData: () => undefined } },
      ],
    });
    const c = TestBed.createComponent(AdminSettingsComponent).componentInstance;
    const pd = (c as unknown as { performDisconnect: (conn: unknown, siteId: string) => void }).performDisconnect.bind(c);
    pd({ id: 'conn9', provider: 'stripe' }, 's1');
    pd({ id: 'conn9', provider: 'stripe' }, 's1');
    expect(del).withContext('no duplicate DELETE').toHaveBeenCalledTimes(1);
    expect((c as unknown as { isDisconnecting: (id: string) => boolean }).isDisconnecting('conn9')).toBeTrue();
  });
});
