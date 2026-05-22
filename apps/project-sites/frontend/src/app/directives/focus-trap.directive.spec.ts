/**
 * Focus-trap directive — Jasmine/Karma unit tests.
 *
 * @remarks
 * The project uses Karma + Jasmine (see angular.json/package.json — no Vitest
 * or Jest is configured). Tests run with `ng test`. The suite exercises the
 * directive against a real DOM (Karma-launched Chromium) to validate the
 * cycle/restore behaviour without mocking the focus model.
 */
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FocusTrapDirective } from './focus-trap.directive';

@Component({
  standalone: true,
  imports: [FocusTrapDirective],
  template: `
    <button #outer id="outer" type="button">Outer trigger</button>
    @if (open()) {
      <div id="trap" [focusTrap]="open()">
        <button id="first" type="button">First</button>
        <input id="middle" type="text" />
        <button id="last" type="button">Last</button>
      </div>
    }
  `,
})
class HostComponent {
  open = signal(false);
}

function dispatchTab(target: Element, shift: boolean): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }),
  );
}

describe('FocusTrapDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.body.removeChild(fixture.nativeElement);
  });

  it('does not trap focus while inactive', () => {
    const outer = fixture.nativeElement.querySelector('#outer') as HTMLButtonElement;
    outer.focus();
    expect(document.activeElement).toBe(outer);
  });

  it('moves focus to the first focusable child when activated', async () => {
    const outer = fixture.nativeElement.querySelector('#outer') as HTMLButtonElement;
    outer.focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await Promise.resolve(); // microtask queue for queueMicrotask focus
    const first = fixture.nativeElement.querySelector('#first') as HTMLButtonElement;
    expect(document.activeElement).toBe(first);
  });

  it('wraps Tab from the last element back to the first', async () => {
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await Promise.resolve();
    const last = fixture.nativeElement.querySelector('#last') as HTMLButtonElement;
    const first = fixture.nativeElement.querySelector('#first') as HTMLButtonElement;
    last.focus();
    dispatchTab(last, false);
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first element back to the last', async () => {
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await Promise.resolve();
    const first = fixture.nativeElement.querySelector('#first') as HTMLButtonElement;
    const last = fixture.nativeElement.querySelector('#last') as HTMLButtonElement;
    first.focus();
    dispatchTab(first, true);
    expect(document.activeElement).toBe(last);
  });

  it('restores focus to the previously focused element on deactivation', async () => {
    const outer = fixture.nativeElement.querySelector('#outer') as HTMLButtonElement;
    outer.focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(outer);
  });
});
