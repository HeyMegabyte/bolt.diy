import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AdminRecipesComponent } from './recipes.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';
import { ConfirmService } from '../../../services/confirm.service';

/**
 * Guards the Automation Builder (#11) admin section: empty state w/o site, list
 * renders, create posts a {name, trigger, actions, enabled} recipe, delete
 * calls the API + reloads.
 */
describe('AdminRecipesComponent', () => {
  let fixture: ComponentFixture<AdminRecipesComponent>;
  let host: HTMLElement;
  let get: jasmine.Spy;
  let post: jasmine.Spy;
  let del: jasmine.Spy;
  let confirmSpy: jasmine.Spy;

  function build(site: { id: string } | null, confirmResult = true): void {
    get = jasmine.createSpy('get').and.returnValue(
      of({ ok: true, recipes: [{ id: 'r1', name: 'Lead alert', enabled: true, trigger: { type: 'form.submitted' }, actions: [{ type: 'send_email' }] }] }),
    );
    post = jasmine.createSpy('post').and.returnValue(of({ ok: true, id: 'r2' }));
    del = jasmine.createSpy('delete').and.returnValue(of({ ok: true }));
    confirmSpy = jasmine.createSpy('confirm').and.resolveTo(confirmResult);
    TestBed.configureTestingModule({
      imports: [AdminRecipesComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get, post, delete: del } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: ConfirmService, useValue: { confirm: confirmSpy } },
        { provide: AdminStateService, useValue: { selectedSite: () => site } },
      ],
    });
    fixture = TestBed.createComponent(AdminRecipesComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  const q = (sel: string): HTMLElement | null => host.querySelector(sel);
  const all = (sel: string): HTMLElement[] => Array.from(host.querySelectorAll(sel));
  afterEach(() => TestBed.resetTestingModule());

  // The recipe name is truncated (.truncate); it must carry a hover title so a
  // long name is readable when clipped (truncate-without-title sweep).
  it('gives the truncated recipe name a hover title', () => {
    build({ id: 's1' });
    const nameEl = all('span.truncate').find((s) => s.textContent?.trim() === 'Lead alert');
    expect(nameEl).withContext('recipe name span').toBeTruthy();
    expect(nameEl!.getAttribute('title')).toBe('Lead alert');
  });

  // The per-row Delete button shows the compact text "Delete" (cockpit density),
  // but its ACCESSIBLE NAME must name the recipe — a screen-reader user tabbing
  // a list of destructive buttons otherwise hears "Delete, Delete, Delete" with
  // no idea WHICH automation each one removes (named-destructive-action a11y).
  it('gives the per-row Delete button an accessible name that names the recipe', () => {
    build({ id: 's1' });
    const del = q('[data-testid="recipes-delete"]') as HTMLButtonElement;
    expect(del).withContext('delete button present').not.toBeNull();
    // Visible text stays compact; the accessible name carries the recipe identity.
    expect(del.textContent?.trim()).toBe('Delete');
    expect(del.getAttribute('aria-label')).withContext('aria-label names the recipe').toBe('Delete automation “Lead alert”');
  });

  it('shows the empty state with no selected site', () => {
    build(null);
    expect(q('[data-testid="recipes-empty"]')).not.toBeNull();
    expect(q('[data-testid="recipes-create-btn"]')).toBeNull();
  });

  it('lists the site recipes', () => {
    build({ id: 's1' });
    // Silent: the component owns its inline "Automations are not available"
    // error, so the read must not trigger ApiService's generic network toast.
    expect(get).toHaveBeenCalledWith('/sites/s1/recipes', undefined, { silent: true });
    expect(all('[data-testid="recipes-row"]').length).toBe(1);
  });

  it('creates a recipe with name + trigger + action + config + enabled', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.nameModel.set('Email on new lead');
    c.triggerModel.set('form.submitted');
    c.actionModel.set('send_email');
    c.cfgPrimary.set('owner@example.com');
    c.cfgSecondary.set('New lead');
    c.enabledModel.set(true);
    fixture.detectChanges(); // let the canSubmit()-gated button enable
    (q('[data-testid="recipes-create-btn"]') as HTMLButtonElement).click();

    expect(post).toHaveBeenCalledWith('/sites/s1/recipes', {
      name: 'Email on new lead',
      enabled: true,
      trigger: { type: 'form.submitted' },
      actions: [{ type: 'send_email', config: { to: 'owner@example.com', subject: 'New lead' } }],
    });
  });

  it('omits an empty optional config (notify message)', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.nameModel.set('Notify on publish');
    c.triggerModel.set('site.published');
    c.actionModel.set('notify'); // message optional → empty config
    fixture.detectChanges(); // let the canSubmit()-gated button enable
    (q('[data-testid="recipes-create-btn"]') as HTMLButtonElement).click();

    expect(post).toHaveBeenCalledWith('/sites/s1/recipes', {
      name: 'Notify on publish',
      enabled: true,
      trigger: { type: 'site.published' },
      actions: [{ type: 'notify', config: {} }],
    });
  });

  it('blocks a create with no name', () => {
    build({ id: 's1' });
    fixture.componentInstance.nameModel.set('   ');
    (q('[data-testid="recipes-create-btn"]') as HTMLButtonElement).click();
    expect(post).not.toHaveBeenCalled();
  });

  it('blocks a create when a required config field is empty', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.nameModel.set('Email on lead');
    c.actionModel.set('send_email'); // requires a recipient
    c.cfgPrimary.set('');
    (q('[data-testid="recipes-create-btn"]') as HTMLButtonElement).click();
    expect(post).not.toHaveBeenCalled();
  });

  it('deletes a recipe after confirmation and reloads', async () => {
    build({ id: 's1' }); // confirm resolves true
    await fixture.componentInstance.remove('r1', 'Lead alert');
    expect(confirmSpy).toHaveBeenCalled(); // destructive action is confirmed first
    expect(del).toHaveBeenCalledWith('/sites/s1/recipes/r1', { silent: true }); // {silent}: own error toast, no generic double-toast
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does NOT delete when the confirm is cancelled', async () => {
    build({ id: 's1' }, false); // operator cancels
    await fixture.componentInstance.remove('r1', 'Lead alert');
    expect(confirmSpy).toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('surfaces a not-available error', () => {
    build({ id: 's1' });
    get.and.returnValue(throwError(() => ({ error: {} })));
    fixture.componentInstance.load();
    fixture.detectChanges();
    expect(q('[data-testid="recipes-error"]')).not.toBeNull();
  });

  // ── Action-typed config validation (security/reliability) ─────────────────
  // The webhook action's URL is called server-side when the recipe fires
  // (SSRF-adjacent); the send_email recipient is delivered to. Both must be
  // validated client-side before the POST, with a useful toast — never a junk
  // value silently saved into an automation that no-ops or calls the wrong host.
  const toastErrSpy = (): jasmine.Spy => TestBed.inject(ToastService).error as jasmine.Spy;

  it('blocks a webhook recipe whose URL is not https — toasts + no POST', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.nameModel.set('Ping my server');
    c.actionModel.set('webhook');
    c.cfgPrimary.set('http://hooks.example.com/x'); // non-https
    c.create();
    expect(post).not.toHaveBeenCalled();
    expect(toastErrSpy()).toHaveBeenCalled();
  });

  it('blocks a webhook recipe whose URL is junk / internal host', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.nameModel.set('Ping');
    c.actionModel.set('webhook');
    c.cfgPrimary.set('https://localhost'); // no-dot internal host
    c.create();
    expect(post).not.toHaveBeenCalled();
    expect(toastErrSpy()).toHaveBeenCalled();
  });

  it('blocks a send_email recipe whose recipient is not a valid email', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.nameModel.set('Email me');
    c.actionModel.set('send_email');
    c.cfgPrimary.set('notanemail');
    c.create();
    expect(post).not.toHaveBeenCalled();
    expect(toastErrSpy()).toHaveBeenCalled();
  });

  it('accepts a webhook recipe with a valid https URL — POSTs once', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.nameModel.set('Ping my server');
    c.actionModel.set('webhook');
    c.cfgPrimary.set('https://hooks.yourapp.com/projectsites');
    c.create();
    expect(post).toHaveBeenCalledTimes(1);
    const [, body] = post.calls.mostRecent().args as [string, { actions: { type: string; config: { url: string } }[] }];
    expect(body.actions[0].type).toBe('webhook');
    expect(body.actions[0].config.url).toBe('https://hooks.yourapp.com/projectsites');
  });

  it('configInvalid() reflects the selected action type (URL vs email)', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.actionModel.set('webhook');
    c.cfgPrimary.set('http://x');
    expect(c.configInvalid()).toBe(true);
    c.cfgPrimary.set('https://hooks.app.com/x');
    expect(c.configInvalid()).toBe(false);
    c.actionModel.set('send_email');
    c.cfgPrimary.set('bad');
    expect(c.configInvalid()).toBe(true);
    c.cfgPrimary.set('owner@example.com');
    expect(c.configInvalid()).toBe(false);
    c.cfgPrimary.set(''); // empty → incomplete, not "invalid"
    expect(c.configInvalid()).toBe(false);
  });

  it('canSubmit() gates the button per action type', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.nameModel.set('R');
    c.actionModel.set('webhook');
    c.cfgPrimary.set('ftp://x');
    expect(c.canSubmit()).toBe(false);
    c.cfgPrimary.set('https://hooks.app.com/x');
    expect(c.canSubmit()).toBe(true);
    c.nameModel.set('   '); // no name → blocked even with valid URL
    expect(c.canSubmit()).toBe(false);
  });

  it('renders the trigger + action selects through Spartan hlmSelect (cohesion, no hand-rolled control)', () => {
    build({ id: 's1' });
    expect(all('select[hlmSelect]').length).toBe(2);
    expect(q('select[data-testid="recipes-trigger"][hlmSelect]')).not.toBeNull();
    expect(q('select[data-testid="recipes-action"][hlmSelect]')).not.toBeNull();
    // The hand-rolled control border class is gone (Spartan owns the chrome).
    expect(q('[data-testid="recipes-trigger"]')?.className ?? '').not.toContain('border-white/[0.12]');
  });

  it('renders the enabled checkbox through Spartan hlmCheckbox (cyan accent + focus ring)', () => {
    build({ id: 's1' });
    const boxes = all('input[type=checkbox][hlmCheckbox]');
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => !b.className.includes('accent-primary'))).toBeTrue();
  });

  it('renders a shimmering skeleton (not bare "Loading…" text) while loading', () => {
    build({ id: 's1' });
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();
    expect(q('app-skeleton')).withContext('uses the reusable skeleton primitive').not.toBeNull();
    expect(host.textContent ?? '').not.toContain('Loading recipes…');
  });

  it('renders the rich app-empty-state (not bare text) when there are no automations', () => {
    build({ id: 's1' });
    fixture.componentInstance.recipes.set([]);
    fixture.detectChanges();
    expect(q('app-empty-state')).withContext('uses the reusable empty-state primitive').not.toBeNull();
  });

  // A transient load failure leaves recipes() === [] (it never loaded) — but that
  // is UNKNOWN, not empty. Showing the "No automations yet" empty state UNDER the
  // error card is a contradiction (the error card already conveys "couldn't load").
  it('does NOT show the "no automations" empty state when the list failed to load (error card only)', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.loadError.set('Could not load automations — retry.');
    c.recipes.set([]);
    fixture.detectChanges();
    expect(q('[data-testid="recipes-error"]')).withContext('error card present').not.toBeNull();
    expect(host.textContent ?? '').not.toContain('No automations yet');
    expect(q('app-empty-state')).withContext('no empty-state under a load error').toBeNull();
  });

  // When automations are flag-gated off for the site (404 → flagDisabled), the
  // Add-recipe form must not be a dead mutation: the button is disabled +
  // create() no-ops (the POST would 404).
  it('disables Add recipe + no-ops create() when automations are not available (flag-gated)', async () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.flagDisabled.set(true);
    // a fully-valid form otherwise — only the not-available gate should block it
    c.nameModel.set('Email me on new lead');
    fixture.detectChanges();
    // ngModel propagates [disabled] in a microtask — let it settle before reading.
    await fixture.whenStable();
    fixture.detectChanges();

    const btn = q('[data-testid="recipes-create-btn"]') as HTMLButtonElement;
    expect(btn.disabled).withContext('Add recipe locked when not available').toBeTrue();

    // The WHOLE form must read as inert, not just the submit — an editable form
    // above a "not available" banner invites input it can never accept. Every
    // control is disabled so the unavailable state is honest end-to-end.
    expect((q('[data-testid="recipes-name"]') as HTMLInputElement).disabled).withContext('name input').toBeTrue();
    expect((q('[data-testid="recipes-trigger"]') as HTMLSelectElement).disabled).withContext('trigger select').toBeTrue();
    expect((q('[data-testid="recipes-action"]') as HTMLSelectElement).disabled).withContext('action select').toBeTrue();
    expect((q('[data-testid="recipes-cfg-primary"]') as HTMLInputElement).disabled).withContext('config input').toBeTrue();

    // The flag-gate notice renders BEFORE the form (top-down honesty), so a user
    // reads "not available" first rather than after filling the form.
    const gateEl = q('[data-testid="recipes-flag-gate"]');
    const formEl = q('[data-testid="recipes-name"]');
    expect(gateEl).withContext('flag-gate notice present').not.toBeNull();
    expect(gateEl!.compareDocumentPosition(formEl!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .withContext('flag-gate notice precedes the form').toBeTruthy();

    post.calls.reset();
    c.create();
    expect(post).withContext('no dead POST to the flag-gated route').not.toHaveBeenCalled();
  });
});

import { provideRouter } from '@angular/router';

/**
 * Load-error 404-vs-transient distinction (canonical pattern). A 404 means the
 * automation_builder flag is OFF → calm flag-gate notice with a Feature Flags
 * link (NOT alarming red), form locked. A non-404 is a transient failure →
 * <app-error-card> with Retry + a copyable request_id, form locked. Previously
 * ANY error showed "not available" (a transient 500 masqueraded as permanently off).
 */
describe('AdminRecipesComponent (load-error 404 flag-gate vs transient)', () => {
  function setup(err: unknown) {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => err));
    TestBed.configureTestingModule({
      imports: [AdminRecipesComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get, post: () => of({}), delete: () => of({}) } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: AdminStateService, useValue: { selectedSite: () => ({ id: 's1' }) } },
      ],
    });
    const f = TestBed.createComponent(AdminRecipesComponent);
    f.detectChanges();
    return f;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('404 → flagDisabled (calm Feature-Flags notice, NOT a transient error card), form locked', () => {
    const f = setup({ status: 404 });
    const c = f.componentInstance;
    expect(c.flagDisabled()).toBeTrue();
    expect(c.loadError()).toBeNull();
    expect(c.formLocked()).toBeTrue();
    const host = f.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="recipes-flag-gate"] a[routerLink="/admin/feature-flags"]'))
      .withContext('flag-gate links to Feature Flags').not.toBeNull();
    expect(host.querySelector('[data-testid="recipes-error"]')).withContext('no transient error card on a 404').toBeNull();
  });

  it('non-404 → transient loadError + captured request_id (app-error-card with retry), form locked', () => {
    const f = setup({ status: 500, error: { error: { request_id: 'req_rcp9' } } });
    const c = f.componentInstance;
    expect(c.flagDisabled()).toBeFalse();
    expect(c.loadError()).toContain('Could not load');
    expect(c.loadErrorRef()).toBe('req_rcp9');
    expect(c.formLocked()).toBeTrue();
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="recipes-error"]'))
      .withContext('transient error card renders').not.toBeNull();
  });
});

describe('AdminRecipesComponent (webhook public-host URL validation)', () => {
  let fx: import('@angular/core/testing').ComponentFixture<AdminRecipesComponent>;
  afterEach(() => TestBed.resetTestingModule());

  function mk(): AdminRecipesComponent {
    TestBed.configureTestingModule({
      imports: [AdminRecipesComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ ok: true, recipes: [] }), post: () => of({ ok: true }), delete: () => of({ ok: true }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: AdminStateService, useValue: { selectedSite: () => ({ id: 's1' }) } },
      ],
    });
    fx = TestBed.createComponent(AdminRecipesComponent);
    fx.detectChanges();
    return fx.componentInstance;
  }

  it('flags private / link-local / metadata IP webhook URLs invalid (the "public hostname" promise)', () => {
    const c = mk();
    c.actionModel.set('webhook');
    for (const url of [
      'https://127.0.0.1/h', 'https://10.0.0.1/h', 'https://192.168.0.1/h',
      'https://172.20.1.1/h', 'https://169.254.169.254/meta', 'https://api.internal/h',
    ]) {
      c.cfgPrimary.set(url);
      expect(c.configInvalid()).withContext(url).toBeTrue();
    }
    c.cfgPrimary.set('https://hooks.example.com/projectsites');
    expect(c.configInvalid()).withContext('public host valid').toBeFalse();
  });
});
