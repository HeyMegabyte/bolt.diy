import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FlagAuditTimelineComponent, type AuditEntry } from './audit-timeline.component';

/**
 * First coverage for the shared per-flag audit timeline (rendered by BOTH
 * control-plane layers). Locks: row-per-entry, the empty state, the optional
 * reason line, and the relative-time formatter (an audit feed reads better as
 * "2h ago" than a raw absolute date — the absolute stays on hover + in the
 * <time datetime> attr).
 */
describe('FlagAuditTimelineComponent', () => {
  let fixture: ComponentFixture<FlagAuditTimelineComponent>;
  let component: FlagAuditTimelineComponent;

  function entry(over: Partial<AuditEntry> = {}): AuditEntry {
    return {
      id: over.id ?? 'e1',
      actor: over.actor ?? 'brian@megabyte.space',
      action: over.action ?? 'rollout_update',
      summary: over.summary ?? 'rollout 0% → 25%',
      created_at: over.created_at ?? '2026-06-07T10:00:00.000Z',
      reason: over.reason ?? null,
    };
  }

  function build(entries: AuditEntry[]): void {
    TestBed.configureTestingModule({ imports: [FlagAuditTimelineComponent] });
    fixture = TestBed.createComponent(FlagAuditTimelineComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('entries', entries);
    fixture.detectChanges();
  }
  afterEach(() => TestBed.resetTestingModule());

  it('renders one row per entry with summary + actor + action', () => {
    build([entry({ id: 'a', summary: 'enabled globally', actor: 'sam@acme.com' })]);
    const host = fixture.nativeElement as HTMLElement;
    const rows = host.querySelectorAll('.at-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('enabled globally');
    expect(rows[0].textContent).toContain('sam@acme.com');
  });

  it('shows the empty state when there are no entries', () => {
    build([]);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.at-row')).toBeNull();
    const empty = host.querySelector('.at-empty');
    expect(empty?.getAttribute('role')).toBe('status');
    expect(empty?.textContent).toContain('No changes recorded');
  });

  it('renders the reason line when a reason is present', () => {
    build([entry({ id: 'r', reason: 'emergency kill — checkout broke' })]);
    expect((fixture.nativeElement as HTMLElement).querySelector('.at-reason')?.textContent)
      .toContain('emergency kill — checkout broke');
  });

  it('omits the reason line when there is no reason', () => {
    build([entry({ id: 'n', reason: null })]);
    expect((fixture.nativeElement as HTMLElement).querySelector('.at-reason')).toBeNull();
  });

  it('relTime buckets recent timestamps and degrades to a date for old ones', () => {
    build([]);
    const now = Date.UTC(2026, 5, 7, 12, 0, 0);
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(component.relTime(ago(10_000), now)).toBe('just now');
    expect(component.relTime(ago(5 * 60_000), now)).toBe('5m ago');
    expect(component.relTime(ago(3 * 3_600_000), now)).toBe('3h ago');
    expect(component.relTime(ago(2 * 86_400_000), now)).toBe('2d ago');
    expect(component.relTime('not-a-date', now)).withContext('invalid date → empty, never NaN').toBe('');
  });

  it('the <time> shows relative text + carries the absolute as a title and datetime attr', () => {
    const iso = new Date(Date.now() - 2 * 3_600_000).toISOString();
    build([entry({ id: 't', created_at: iso })]);
    const time = (fixture.nativeElement as HTMLElement).querySelector('time') as HTMLTimeElement;
    expect(time.getAttribute('datetime')).toBe(iso);
    expect(time.getAttribute('title')).withContext('absolute timestamp on hover').toBeTruthy();
    expect(time.textContent).withContext('relative text in the cell').toContain('h ago');
  });
});
