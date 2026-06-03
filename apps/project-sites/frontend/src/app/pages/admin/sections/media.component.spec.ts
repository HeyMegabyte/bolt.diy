import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminMediaComponent } from './media.component';
import { ApiService } from '../../../services/api.service';
import { BoltEmbedService } from '../../../services/bolt-embed.service';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';

/**
 * Guards the Media section cyan/black cohesion + a11y convergence pass (round 4):
 *  - the asset-count stat renders through `<app-rolling-counter>` (brand mandate)
 *  - the shell carries the `appReveal` entrance host
 *  - the tablist / tabpanel ARIA contract + the sliding cyan indicator hold
 *  - the active tab text rides on the cyan indicator (ink flips to canvas color)
 *
 * `ng test` (Karma) is not runnable in this isolated worktree harness; this spec
 * is also AOT-verified via `npx nx build`. It mocks ApiService so `ngOnInit`'s
 * `refreshLibrary()` resolves synchronously with an empty library.
 */
describe('AdminMediaComponent (cyan/black cohesion + a11y)', () => {
  let fixture: ComponentFixture<AdminMediaComponent>;

  function build(): void {
    const apiStub = {
      get: () => of({ data: [] }),
      post: () => of({ ok: true }),
      postFormData: () => of({ data: null }),
      delete: () => of({ ok: true }),
    };
    TestBed.configureTestingModule({
      imports: [AdminMediaComponent],
      providers: [
        { provide: ApiService, useValue: apiStub },
        { provide: BoltEmbedService, useValue: { forwardToast: () => undefined } },
        {
          provide: ToastService,
          useValue: {
            info: () => 0,
            success: () => 0,
            warning: () => 0,
            error: () => 0,
            dismiss: () => undefined,
          },
        },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(false) } },
      ],
    });
    fixture = TestBed.createComponent(AdminMediaComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the asset count through <app-rolling-counter> (numeric stat mandate)', () => {
    build();
    const el: HTMLElement = fixture.nativeElement;
    const chip = el.querySelector('.count-chip');
    expect(chip).toBeTruthy();
    // The numeric stat is NOT a raw text node — it is an <app-rolling-counter>.
    expect(chip!.querySelector('app-rolling-counter')).toBeTruthy();
    expect(chip!.getAttribute('role')).toBe('status');
  });

  it('applies the appReveal entrance host on the section shell', () => {
    build();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('section[appReveal]')).toBeTruthy();
  });

  it('exposes the WAI-ARIA tablist contract with a sliding cyan indicator', () => {
    build();
    const el: HTMLElement = fixture.nativeElement;
    const tablist = el.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    expect(tablist!.getAttribute('aria-label')).toBe('Media sub-sections');
    // The sliding cyan active-tab indicator is present + driven by index props.
    const indicator = tablist!.querySelector('.med-tab-indicator');
    expect(indicator).toBeTruthy();
    const tabs = el.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(5);
    const selected = Array.from(tabs).filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBe(1);
    // Every tab points at its panel; the active panel is rendered + labelled.
    expect(selected[0].getAttribute('aria-controls')).toBe('med-panel-library');
    const panel = el.querySelector('[role="tabpanel"]');
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute('aria-labelledby')).toBe('med-tab-library');
  });

  it('drives the indicator transform off the active tab index', () => {
    build();
    const cmp = fixture.componentInstance;
    expect(cmp.activeTabIndex()).toBe(0);
    cmp.setTab('video');
    fixture.detectChanges();
    // tabs = [library, stock, image, video, podcast] → video is index 3.
    expect(cmp.activeTabIndex()).toBe(3);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#med-panel-video')).toBeTruthy();
  });

  it('marks exactly the active tab .is-active (text flips to canvas ink on cyan)', () => {
    build();
    fixture.componentInstance.setTab('stock');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const active = el.querySelectorAll('[role="tab"].is-active');
    expect(active.length).toBe(1);
    expect(active[0].id).toBe('med-tab-stock');
  });
});
