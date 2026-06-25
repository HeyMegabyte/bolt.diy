import { TestBed } from '@angular/core/testing';
import { DataPledgeComponent } from './data-pledge.component';

function setup() {
  TestBed.configureTestingModule({ imports: [DataPledgeComponent] });
  const fixture = TestBed.createComponent(DataPledgeComponent);
  fixture.detectChanges();
  return fixture;
}

describe('DataPledgeComponent (AN40 — analytics privacy pledge)', () => {
  it('renders the three anti-surveillance pledges', () => {
    const fixture = setup();
    const c = fixture.componentInstance;
    expect(c.pledges.length).toBe(3);
    const el = fixture.nativeElement as HTMLElement;
    const root = el.querySelector('[data-testid="data-pledge"]');
    expect(root).toBeTruthy();
    const items = el.querySelectorAll('[data-testid="data-pledge-item"]');
    expect(items.length).toBe(3);
    const text = (root?.textContent ?? '').toLowerCase();
    expect(text).toContain('never sold');
    expect(text).toContain('cookie');
    expect(text).toContain('anonym');
  });

  it('is a region landmark with an accessible label', () => {
    const el = setup().nativeElement as HTMLElement;
    const root = el.querySelector('[data-testid="data-pledge"]');
    expect(root?.getAttribute('role')).toBe('note');
    expect(root?.getAttribute('aria-label')?.toLowerCase()).toContain('privacy');
  });
});
