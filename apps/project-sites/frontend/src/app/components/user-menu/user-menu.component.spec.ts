import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { UserMenuComponent } from './user-menu.component';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';

/**
 * a11y coverage for the admin-shell account menu. Locks the 2026-06-04 fix: the
 * trigger was a mouse-only clickable <div> (no tabindex/keydown/button) — keyboard
 * users could not open it (WCAG 2.1.1). It is now a real <button> with
 * aria-haspopup + aria-expanded; the dropdown is a sibling (not nested in a button).
 */
describe('UserMenuComponent (a11y: keyboard-operable trigger)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render() {
    TestBed.configureTestingModule({
      imports: [UserMenuComponent],
      providers: [
        { provide: AuthService, useValue: { email: () => 'test@megabyte.space', isLoggedIn: () => true, logout: () => undefined } },
        { provide: ApiService, useValue: { get: () => of({ data: {} }), post: () => of({}) } },
        { provide: Router, useValue: { navigate: () => undefined, navigateByUrl: () => undefined, events: of() } },
      ],
    });
    const fx = TestBed.createComponent(UserMenuComponent);
    fx.detectChanges();
    return fx;
  }

  it('the trigger is a real <button> with aria-haspopup + aria-expanded that tracks menuOpen()', () => {
    const fx = render();
    const el = fx.nativeElement as HTMLElement;
    const trigger = el.querySelector('.user-menu-trigger');
    expect(trigger?.tagName.toLowerCase())
      .withContext('keyboard-operable button, not a mouse-only click div')
      .toBe('button');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger?.getAttribute('aria-expanded')).withContext('closed initially').toBe('false');

    fx.componentInstance.menuOpen.set(true);
    fx.detectChanges();
    expect(el.querySelector('.user-menu-trigger')?.getAttribute('aria-expanded'))
      .withContext('aria-expanded flips when open')
      .toBe('true');
    expect(el.querySelector('.dropdown')).withContext('dropdown renders + is a sibling of the trigger').toBeTruthy();
    // the dropdown must NOT be nested inside the button (invalid + breaks SR)
    expect(el.querySelector('.user-menu-trigger .dropdown')).toBeNull();
  });
});
