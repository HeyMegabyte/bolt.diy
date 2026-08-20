import { TestBed, ComponentFixture } from '@angular/core/testing';
import { of } from 'rxjs';
import { SocialCalendarComponent } from './social-calendar.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

/**
 * First coverage for the extracted calendar pane. The parent's social spec
 * covered the calendar via the god component; after the split this owns:
 *  - 42-cell grid + month navigation (calPrev/calNext/calToday)
 *  - postsOnDay mapping + event-chip brand color
 *  - drag-drop PATCH (reschedule) + the rescheduled output
 */
function make(posts: unknown[] = [], platforms: unknown[] = []): {
  c: SocialCalendarComponent;
  patch: jasmine.Spy;
  toast: { success: jasmine.Spy; error: jasmine.Spy };
  fx: ComponentFixture<SocialCalendarComponent>;
} {
  const patch = jasmine.createSpy('patch').and.returnValue(of({}));
  const toast = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };
  TestBed.configureTestingModule({
    imports: [SocialCalendarComponent],
    providers: [
      { provide: ApiService, useValue: { patch } },
      { provide: ToastService, useValue: toast },
    ],
  });
  const fx = TestBed.createComponent(SocialCalendarComponent);
  fx.componentRef.setInput('posts', posts);
  fx.componentRef.setInput('platforms', platforms);
  fx.detectChanges();
  return { c: fx.componentInstance, patch, toast, fx };
}

describe('SocialCalendarComponent (extracted from the social god component)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders a 42-cell grid with the weekday headers', () => {
    const { fx } = make();
    expect(fx.nativeElement.querySelectorAll('.cal-cell').length).toBe(42);
    expect(fx.nativeElement.querySelectorAll('.cal-dh').length).toBe(7);
  });

  it('calPrev/calNext/calToday move the month cursor', () => {
    const { c } = make();
    const before = c.calLabel();
    c.calPrev();
    expect(c.calLabel()).not.toBe(before);
    c.calToday();
    // today's label is deterministic for the current month
    const now = new Date();
    expect(c.calLabel()).toBe(now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
    c.calNext();
    expect(c.calLabel()).not.toBe(before);
  });

  it('postsOnDay maps posts to their scheduled/published day', () => {
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date();
    const todayIso = iso(today);
    const { c } = make([
      { id: 'p1', content: 'today post', platforms: ['x'], scheduled_at: todayIso + 'T10:00:00Z' },
      { id: 'p2', content: 'yesterday post', platforms: ['x'], scheduled_at: '2000-01-01T10:00:00Z' },
    ]);
    expect(c.postsOnDay(todayIso).map((p) => p.id)).toEqual(['p1']);
  });

  it('defColor returns the platform color or the accent fallback', () => {
    const { c } = make([], [{ id: 'x', color: '#abc123' }]);
    expect(c.defColor('x')).toBe('#abc123');
    expect(c.defColor('unknown')).toBe('var(--ps-accent, #00e5ff)');
  });

  it('onCalDrop PATCHes the new day and emits rescheduled', () => {
    const iso = '2026-09-01';
    const { c, patch } = make(
      [{ id: 'p1', content: 'x', platforms: ['x'], scheduled_at: '2026-08-20T10:00:00Z' }],
    );
    const emitted = jasmine.createSpy('rescheduled');
    c.rescheduled.subscribe(emitted);
    c.onCalEventDrag({ dataTransfer: { setData: () => {} } } as unknown as DragEvent, {
      id: 'p1',
      content: 'x',
      platforms: ['x'],
      scheduled_at: '2026-08-20T10:00:00Z',
    });
    c.onCalDrop({ preventDefault: () => {}, dataTransfer: { getData: () => 'p1' } } as unknown as DragEvent, iso);
    expect(patch).toHaveBeenCalledWith('/social/posts/p1', { scheduled_at: '2026-09-01T10:00:00.000Z' }, { silent: true });
    expect(emitted).toHaveBeenCalled();
  });

  it('onCalDrop is a no-op for a post without a scheduled_at', () => {
    const { c, patch } = make([{ id: 'p1', content: 'x', platforms: ['x'] }]);
    c.onCalDrop({ preventDefault: () => {}, dataTransfer: { getData: () => 'p1' } } as unknown as DragEvent, '2026-09-01');
    expect(patch).not.toHaveBeenCalled();
  });
});
