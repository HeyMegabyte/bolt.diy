import { TestBed } from '@angular/core/testing';
import { EventsTableComponent, type EventRow } from './events-table.component';

function mkEvents(n: number, type = 'pageview'): EventRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    eventType: type,
    userId: i % 2 === 0 ? `user-${i}` : null,
    timestamp: 1_700_000_000_000 + i * 1000,
    status: i % 3 === 0 ? 'ingested' : 'delivered',
  }));
}

function setup(events: EventRow[]) {
  TestBed.configureTestingModule({ imports: [EventsTableComponent] });
  const fixture = TestBed.createComponent(EventsTableComponent);
  fixture.componentRef.setInput('events', events);
  fixture.detectChanges();
  return fixture;
}

describe('EventsTableComponent (AN55 — Live Events filter/search/paginate)', () => {
  it('paginates: shows pageSize rows on page 1 and a "Page 1 of N" indicator', () => {
    const fixture = setup(mkEvents(60));
    const c = fixture.componentInstance;
    expect(c.pageSize).toBe(25);
    expect(c.paged().length).toBe(25);
    expect(c.totalPages()).toBe(3); // ceil(60/25)
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('[data-testid="et-row"]');
    expect(rows.length).toBe(25);
    expect(el.querySelector('[data-testid="et-page"]')?.textContent).toContain('1 of 3');
  });

  it('next()/prev() move the window and clamp at the ends', () => {
    const c = setup(mkEvents(60)).componentInstance;
    expect(c.paged()[0].id).toBe('e0');
    c.next();
    expect(c.paged()[0].id).toBe('e25');
    c.next();
    expect(c.paged()[0].id).toBe('e50');
    expect(c.paged().length).toBe(10); // last page remainder
    c.next(); // clamp — no 4th page
    expect(c.paged()[0].id).toBe('e50');
    c.prev();
    c.prev();
    c.prev(); // clamp at 0
    expect(c.paged()[0].id).toBe('e0');
  });

  it('search filters across eventType / userId / status and resets to page 1', () => {
    const events = [
      ...mkEvents(30, 'pageview'),
      { id: 'click1', eventType: 'cta_click', userId: 'vip-7', timestamp: 1, status: 'delivered' },
    ];
    const c = setup(events).componentInstance;
    c.next(); // move off page 1
    expect(c.page()).toBe(1);
    c.setQuery('vip');
    expect(c.page()).toBe(0); // reset on query change
    expect(c.filtered().length).toBe(1);
    expect(c.filtered()[0].id).toBe('click1');
    c.setQuery('cta_click');
    expect(c.filtered()[0].eventType).toBe('cta_click');
  });

  it('type filter narrows to a single eventType; types() lists the distinct set', () => {
    const events = [...mkEvents(5, 'pageview'), ...mkEvents(3, 'form_submit')];
    const c = setup(events).componentInstance;
    expect(new Set(c.types())).toEqual(new Set(['form_submit', 'pageview']));
    c.setType('form_submit');
    expect(c.filtered().every((e) => e.eventType === 'form_submit')).toBe(true);
    expect(c.filtered().length).toBe(3);
    c.setType('all');
    expect(c.filtered().length).toBe(8);
  });

  it('toCsv(): exports the FILTERED rows with a header, CSV-escaping special chars (AN42)', () => {
    const events = [
      { id: 'a', eventType: 'pageview', userId: 'u1', timestamp: 1_700_000_000_000, status: 'ingested' },
      { id: 'b', eventType: 'cta_click', userId: 'has,comma', timestamp: 1_700_000_001_000, status: 'de"liver' },
    ];
    const c = setup(events).componentInstance;
    const csv = c.toCsv();
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Type,When,User,Status,Timestamp');
    expect(lines.length).toBe(3); // header + 2 rows
    expect(lines[1]).toContain('pageview');
    expect(lines[1]).toContain('u1');
    // comma + quote fields are quoted/escaped
    expect(lines[2]).toContain('"has,comma"');
    expect(lines[2]).toContain('"de""liver"');
    // a filter narrows the export too
    c.setQuery('cta_click');
    const csv2 = c.toCsv();
    expect(csv2.trim().split('\n').length).toBe(2); // header + 1 filtered row
  });

  it('renders a no-match notice when filters exclude everything', () => {
    const fixture = setup(mkEvents(10));
    const c = fixture.componentInstance;
    c.setQuery('zzz-nothing');
    fixture.detectChanges();
    expect(c.filtered().length).toBe(0);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="et-nomatch"]')).toBeTruthy();
    expect(el.querySelectorAll('[data-testid="et-row"]').length).toBe(0);
  });
});
