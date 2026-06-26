import { TestBed } from '@angular/core/testing';
import { EventTypeBreakdownComponent } from './event-type-breakdown.component';

function setup(items: { type: string; count: number }[]) {
  TestBed.configureTestingModule({ imports: [EventTypeBreakdownComponent] });
  const fixture = TestBed.createComponent(EventTypeBreakdownComponent);
  fixture.componentRef.setInput('items', items);
  fixture.detectChanges();
  return fixture;
}

describe('EventTypeBreakdownComponent (analytics events-by-type, data already on the wire)', () => {
  it('maps raw event_type to a human label', () => {
    const c = setup([]).componentInstance;
    expect(c.label('pageview')).toBe('Page views');
    expect(c.label('conversion')).toBe('Conversions');
    expect(c.label('cta_click')).toBe('CTA clicks');
    expect(c.label('form_submit')).toBe('Form submissions');
    expect(c.label('click')).toBe('Clicks');
    // unknown types title-case + de-underscore as a sensible fallback
    expect(c.label('newsletter_signup')).toBe('Newsletter signup');
  });

  it('renders one labelled row per event type with its count', () => {
    const fixture = setup([
      { type: 'pageview', count: 120 },
      { type: 'cta_click', count: 14 },
      { type: 'conversion', count: 3 },
    ]);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="oa-event-types"]')).toBeTruthy();
    const rows = el.querySelectorAll('[data-testid="oa-event-type-row"]');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('Page views');
    expect(rows[0].textContent).toContain('120');
    expect(rows[1].textContent).toContain('CTA clicks');
  });

  it('renders nothing when there are no events', () => {
    const el = setup([]).nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="oa-event-types"]')).toBeNull();
  });
});
