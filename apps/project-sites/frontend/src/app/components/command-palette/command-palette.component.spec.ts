import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { CommandPaletteComponent } from './command-palette.component';
import { FeatureFlagService } from '../../services/feature-flag.service';

/**
 * a11y coverage for the Cmd+K command palette — locks the APG combobox/listbox
 * wiring added 2026-06-04 so screen readers announce the highlighted command as
 * the user arrows: the input is role=combobox + aria-controls the listbox +
 * aria-activedescendant the active option (which carries the matching id).
 */
describe('CommandPaletteComponent (a11y: combobox + aria-activedescendant)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(): { el: HTMLElement; cmp: CommandPaletteComponent } {
    TestBed.configureTestingModule({
      imports: [CommandPaletteComponent],
      providers: [
        provideNoopAnimations(),
        { provide: Router, useValue: { navigate: () => undefined, navigateByUrl: () => undefined, events: of() } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
      ],
    });
    const fx = TestBed.createComponent(CommandPaletteComponent);
    fx.detectChanges();
    return { el: fx.nativeElement as HTMLElement, cmp: fx.componentInstance };
  }

  it('the input is a combobox wired to the listbox', () => {
    const { el } = render();
    const input = el.querySelector('[data-testid="command-palette-input"]')!;
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-controls')).toBe('ps-palette-listbox');
    expect(el.querySelector('#ps-palette-listbox')?.getAttribute('role'))
      .withContext('aria-controls target exists + is the listbox')
      .toBe('listbox');
  });

  it('aria-activedescendant points at the active option, which carries the matching id', () => {
    const { el, cmp } = render();
    expect(cmp.flatItems().length).withContext('the catalog renders options').toBeGreaterThan(0);
    const input = el.querySelector('[data-testid="command-palette-input"]')!;
    const adId = input.getAttribute('aria-activedescendant');
    expect(adId).withContext('input names the active option').toBe('ps-palette-opt-0'); // activeIndex defaults to 0
    const activeOpt = el.querySelector('#' + adId);
    expect(activeOpt?.getAttribute('role')).toBe('option');
    expect(activeOpt?.getAttribute('aria-selected')).toBe('true');
  });
});
