/**
 * InputDialogComponent — Jasmine/Karma unit tests.
 *
 * @remarks
 * The project uses Karma + Jasmine (`ng test`) — no Vitest/Jest. These tests
 * exercise the component's validation + submit logic in isolation by providing a
 * stub `DialogRef` and `DIALOG_DATA` (the real CDK overlay isn't needed to verify
 * the value/error/canSubmit/submit behaviour). The shared overlay a11y
 * (focus-trap + Esc + restore) is covered live by `e2e/admin-confirm-dialog.e2e.ts`
 * since both dialogs render through the same `DialogShellComponent` + CDK overlay.
 */
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { InputDialogComponent, type InputDialogData } from './input-dialog.component';

function setup(data: InputDialogData) {
  const closeSpy = jasmine.createSpy('close');
  TestBed.configureTestingModule({
    imports: [InputDialogComponent],
    providers: [
      { provide: DIALOG_DATA, useValue: data },
      { provide: DialogRef, useValue: { close: closeSpy } },
    ],
  });
  const fixture = TestBed.createComponent(InputDialogComponent);
  return { component: fixture.componentInstance, closeSpy };
}

describe('InputDialogComponent', () => {
  it('seeds the value from initialValue', () => {
    const { component } = setup({ title: 'T', initialValue: 'hello' });
    expect(component.value()).toBe('hello');
  });

  it('treats empty input as not-submittable but shows no error', () => {
    const { component } = setup({ title: 'T' });
    expect(component.value()).toBe('');
    expect(component.error()).toBeNull();
    expect(component.canSubmit()).toBe(false);
  });

  it('surfaces the validator error and blocks submit on invalid input', () => {
    const { component, closeSpy } = setup({
      title: 'Bind hostname',
      validate: (v) => (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? null : 'Enter a valid hostname'),
    });
    component.value.set('not a hostname');
    expect(component.error()).toBe('Enter a valid hostname');
    expect(component.canSubmit()).toBe(false);
    component.submit();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('allows submit on valid input and closes with the trimmed value', () => {
    const { component, closeSpy } = setup({
      title: 'Bind hostname',
      validate: (v) => (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? null : 'Enter a valid hostname'),
    });
    component.value.set('  shop.example.com  ');
    expect(component.error()).toBeNull();
    expect(component.canSubmit()).toBe(true);
    component.submit();
    expect(closeSpy).toHaveBeenCalledOnceWith('shop.example.com');
  });

  it('with no validator, any non-empty value is submittable', () => {
    const { component, closeSpy } = setup({ title: 'Name this view' });
    component.value.set('My view');
    expect(component.canSubmit()).toBe(true);
    component.submit();
    expect(closeSpy).toHaveBeenCalledOnceWith('My view');
  });
});
