import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GalleryLightboxComponent } from './gallery-lightbox.component';

/**
 * A11y focus-management coverage for the lightbox modal (WCAG 2.4.3 Focus Order +
 * 2.1.2 No Keyboard Trap — inverse: focus stays WITHIN the modal). The fixture is
 * attached to document.body so `.focus()` / `document.activeElement` behave for real.
 */
describe('GalleryLightboxComponent (a11y focus management)', () => {
  let fixture: ComponentFixture<GalleryLightboxComponent>;
  let comp: GalleryLightboxComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [GalleryLightboxComponent] }).compileComponents();
    fixture = TestBed.createComponent(GalleryLightboxComponent);
    comp = fixture.componentInstance;
    comp.images = [
      { src: 'a.jpg', alt: 'A' },
      { src: 'b.jpg', alt: 'B' },
      { src: 'c.jpg', alt: 'C' },
    ];
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  const dialogButtons = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[role="dialog"] button'));

  it('restores focus to the trigger element when the lightbox closes', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    comp.open(0);
    fixture.detectChanges();
    comp.close();

    expect(comp.activeIndex).toBeNull();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('moves focus into the dialog (close button) after opening', async () => {
    comp.open(1);
    fixture.detectChanges();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const closeBtn = fixture.nativeElement.querySelector('button[aria-label="Close image viewer"]');
    expect(document.activeElement).toBe(closeBtn);
  });

  it('traps Tab within the dialog — wraps last→first and first→last', () => {
    comp.open(0);
    fixture.detectChanges();
    const buttons = dialogButtons();
    const first = buttons[0];
    const last = buttons[buttons.length - 1];

    last.focus();
    comp.onKey(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(document.activeElement).toBe(first);

    first.focus();
    comp.onKey(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
    expect(document.activeElement).toBe(last);
  });

  it('pulls stray focus back into the dialog on Tab', () => {
    comp.open(0);
    fixture.detectChanges();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    comp.onKey(new KeyboardEvent('keydown', { key: 'Tab' }));

    expect(document.activeElement).toBe(dialogButtons()[0]);
    outside.remove();
  });

  it('Escape closes the lightbox and restores focus', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    comp.open(2);
    fixture.detectChanges();

    comp.onKey(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(comp.activeIndex).toBeNull();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
