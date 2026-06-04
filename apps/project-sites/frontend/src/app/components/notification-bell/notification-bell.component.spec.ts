import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { NotificationBellComponent } from './notification-bell.component';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

/**
 * a11y coverage for the notification bell dropdown. Locks the 2026-06-04 fix:
 * items were mouse-only clickable <div role="menuitem"> inside a role="menu"
 * with NO arrow-key nav (broken APG menu + WCAG 2.1.1 keyboard failure). Now
 * they are real, Tab-focusable <button>s and the broken menu role is gone.
 */
describe('NotificationBellComponent (a11y: keyboard-operable notification list)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(): HTMLElement {
    TestBed.configureTestingModule({
      imports: [NotificationBellComponent],
      providers: [
        // isLoggedIn=false → ngOnInit returns early (no polling / network)
        { provide: AuthService, useValue: { isLoggedIn: () => false } },
        { provide: ApiService, useValue: { get: () => of({ data: [] }), patch: () => of({}), post: () => of({}) } },
        { provide: Router, useValue: { navigate: () => undefined, navigateByUrl: () => undefined, events: of() } },
      ],
    });
    const fx = TestBed.createComponent(NotificationBellComponent);
    fx.componentInstance.notifications.set([
      { id: 'n1', type: 'info', title: 'Build done', message: 'Site published', read: 0, created_at: '2026-01-01T00:00:00Z' } as never,
    ]);
    fx.componentInstance.isOpen.set(true);
    fx.detectChanges();
    return fx.nativeElement as HTMLElement;
  }

  it('drops the broken menu role + renders items as keyboard-operable <button>s', () => {
    const el = render();
    expect(el.querySelector('[role="menu"]')).withContext('no incomplete (arrow-nav-less) menu pattern').toBeNull();
    expect(el.querySelector('[role="menuitem"]')).withContext('no orphan menuitems').toBeNull();
    const item = el.querySelector('.notification-item');
    expect(item).withContext('the notification renders').toBeTruthy();
    expect(item?.tagName.toLowerCase())
      .withContext('items are real <button>s — Tab-focusable + Enter/Space-activatable')
      .toBe('button');
  });
});
