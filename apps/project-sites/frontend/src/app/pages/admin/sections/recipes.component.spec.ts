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

  // When automations are flag-gated off for the site (error() = the 'not
  // available' 404), the Add-recipe form must not be a dead mutation: the button
  // is disabled + create() no-ops (the POST would 404).
  it('disables Add recipe + no-ops create() when automations are not available (flag-gated)', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.error.set('Automations are not available for this site.');
    // a fully-valid form otherwise — only the not-available gate should block it
    c.nameModel.set('Email me on new lead');
    fixture.detectChanges();

    const btn = q('[data-testid="recipes-create-btn"]') as HTMLButtonElement;
    expect(btn.disabled).withContext('Add recipe locked when not available').toBeTrue();

    post.calls.reset();
    c.create();
    expect(post).withContext('no dead POST to the flag-gated route').not.toHaveBeenCalled();
  });
});
