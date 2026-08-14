import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MultiStepFormComponent, FormStep } from './multi-step-form.component';

/**
 * The kit form declares required fields (visual `*` + `[required]`) but had NO
 * enforcement (no <form>, buttons are type=button) — next()/submit() advanced
 * regardless, so a business intake form silently accepted empty required fields.
 * These specs lock the required-field GATE + the a11y error surfacing.
 */
describe('MultiStepFormComponent (required-field validation)', () => {
  let fixture: ComponentFixture<MultiStepFormComponent>;
  let comp: MultiStepFormComponent;

  const STEPS: FormStep[] = [
    {
      title: 'Contact',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'note', label: 'Note', type: 'textarea' },
      ],
    },
    {
      title: 'Details',
      fields: [{ key: 'email', label: 'Email', type: 'email', required: true }],
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MultiStepFormComponent] }).compileComponents();
    fixture = TestBed.createComponent(MultiStepFormComponent);
    comp = fixture.componentInstance;
    comp.steps = STEPS;
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  it('blocks next() when a required field is empty — stays on the step + flags the field', () => {
    comp.next();
    expect(comp.stepIndex).withContext('did not advance past an empty required field').toBe(0);
    expect(comp.errors.has('name')).toBeTrue();
    expect(comp.announcement).toContain('required');
  });

  it('renders aria-invalid + a role=alert message for the invalid field', () => {
    comp.next();
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#skf-name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const alert = fixture.nativeElement.querySelector('#skf-err-name');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('required');
  });

  it('advances when the required field is filled', () => {
    comp.formData['name'] = 'Vito';
    comp.next();
    expect(comp.stepIndex).toBe(1);
    expect(comp.errors.size).toBe(0);
    expect(comp.announcement).toContain('Step 2 of 2');
  });

  it('clears a field error as soon as the user edits it (ngModelChange)', () => {
    comp.next();
    expect(comp.errors.has('name')).toBeTrue();
    comp.clearError('name');
    expect(comp.errors.has('name')).toBeFalse();
  });

  it('an optional-only step (whitespace note) still gates on the required name', () => {
    comp.formData['note'] = '   ';
    comp.next();
    expect(comp.stepIndex).toBe(0); // blank whitespace name still blocks
    expect(comp.errors.has('name')).toBeTrue();
  });

  it('does NOT emit formSubmit while a required field is empty; emits once valid', () => {
    const emitted: Array<Record<string, string>> = [];
    comp.formSubmit.subscribe((v) => emitted.push(v));
    comp.formData['name'] = 'Vito';
    comp.next(); // → step 2 (email required)

    comp.submit();
    expect(emitted.length).withContext('blocked while email is empty').toBe(0);
    expect(comp.errors.has('email')).toBeTrue();

    comp.formData['email'] = 'v@example.com';
    comp.submit();
    expect(emitted).toEqual([{ name: 'Vito', email: 'v@example.com' }]);
  });

  it('prev() clears pending errors and steps back', () => {
    comp.formData['name'] = 'Vito';
    comp.next();
    comp.submit(); // flags email
    expect(comp.errors.has('email')).toBeTrue();
    comp.prev();
    expect(comp.stepIndex).toBe(0);
    expect(comp.errors.size).toBe(0);
  });
});
