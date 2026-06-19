import { TestBed } from '@angular/core/testing';
import { IntegrationHelpComponent, type IntegrationHelpRow } from './integration-help.component';

describe('IntegrationHelpComponent', () => {
  function make(rows: readonly IntegrationHelpRow[], subject = 'Stripe', testid = 'mcp-help-stripe') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [IntegrationHelpComponent] });
    const f = TestBed.createComponent(IntegrationHelpComponent);
    f.componentRef.setInput('rows', rows);
    f.componentRef.setInput('subject', subject);
    f.componentRef.setInput('testid', testid);
    f.detectChanges();
    return f;
  }

  it('renders nothing when there are no rows', () => {
    const f = make([]);
    expect(f.nativeElement.querySelector('details')).toBeFalsy();
  });

  it('renders a disclosure with the testid + the supplied rows', () => {
    const f = make(
      [
        { k: 'Account', v: 'A Stripe account.' },
        { k: 'Your data', v: 'Encrypted at rest (AES-GCM).' },
      ],
      'Stripe',
      'mcp-help-stripe',
    );
    const details = f.nativeElement.querySelector('[data-testid="mcp-help-stripe"]');
    expect(details).toBeTruthy();
    expect(details.tagName.toLowerCase()).toBe('details');
    const text = details.textContent ?? '';
    expect(text).toContain('What does connecting do?');
    expect(text).toContain('A Stripe account.');
    expect(text).toContain('Encrypted at rest (AES-GCM).');
  });

  it('labels the summary with the subject for screen readers', () => {
    const f = make([{ k: 'Account', v: 'x' }], 'Mastodon', 'social-help-mastodon');
    const summary = f.nativeElement.querySelector('summary');
    expect(summary.getAttribute('aria-label')).toContain('Mastodon');
  });
});
