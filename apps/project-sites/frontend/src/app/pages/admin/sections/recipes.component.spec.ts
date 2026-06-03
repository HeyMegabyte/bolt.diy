import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AdminRecipesComponent } from './recipes.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

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

  function build(site: { id: string } | null): void {
    get = jasmine.createSpy('get').and.returnValue(
      of({ ok: true, recipes: [{ id: 'r1', name: 'Lead alert', enabled: true, trigger: { type: 'form.submitted' }, actions: [{ type: 'send_email' }] }] }),
    );
    post = jasmine.createSpy('post').and.returnValue(of({ ok: true, id: 'r2' }));
    del = jasmine.createSpy('delete').and.returnValue(of({ ok: true }));
    TestBed.configureTestingModule({
      imports: [AdminRecipesComponent],
      providers: [
        { provide: ApiService, useValue: { get, post, delete: del } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
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
    expect(get).toHaveBeenCalledWith('/sites/s1/recipes');
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

  it('deletes a recipe and reloads', () => {
    build({ id: 's1' });
    (q('[data-testid="recipes-delete"]') as HTMLButtonElement).click();
    expect(del).toHaveBeenCalledWith('/sites/s1/recipes/r1');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('surfaces a not-available error', () => {
    build({ id: 's1' });
    get.and.returnValue(throwError(() => ({ error: {} })));
    fixture.componentInstance.load();
    fixture.detectChanges();
    expect(q('[data-testid="recipes-error"]')).not.toBeNull();
  });
});
