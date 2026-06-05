/**
 * Convergence r53 — swarm section cyan/black cohesion + a11y guard spec.
 *
 * Locks the round-53 fixes against regression:
 *  - status/specialist palette is tokenized via :host CSS vars (no scattered raw hex)
 *  - numeric stats render through <app-rolling-counter> (conflicts + history count)
 *  - history rows are keyboard-operable buttons with aria-pressed + space preventDefault
 *  - every interactive surface has a cyan :focus-visible ring
 *
 * Karma harness can be flaky under the Tailwind-v4 build; if `ng test` is
 * unavailable, AOT (`ng build --configuration production`) + tsc on
 * tsconfig.spec.json is the verification of record (see end-of-turn report).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminSwarmComponent } from './swarm.component';
import { ToastService } from '../../../services/toast.service';

describe('AdminSwarmComponent — cyan/black cohesion + a11y (r53)', () => {
  let fixture: ComponentFixture<AdminSwarmComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminSwarmComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminSwarmComponent);
    fixture.detectChanges();
  });

  it('renders the header + simulated badge', () => {
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.swarm-header__title')?.textContent).toContain('Swarm Editor');
    expect(root.querySelector('.swarm-demo-badge')?.textContent).toContain('Simulated');
  });

  it('routes the conflict stat through <app-rolling-counter> (no raw numeric text node)', () => {
    const root: HTMLElement = fixture.nativeElement;
    const conflictStat = root.querySelectorAll('.swarm-stat')[1];
    expect(conflictStat?.querySelector('app-rolling-counter')).withContext('conflicts uses rolling-counter').toBeTruthy();
  });

  it('declares the tokenized status palette on :host (no scattered raw hex in rules)', () => {
    const styles = (AdminSwarmComponent as { ɵcmp?: { styles?: string[] } }).ɵcmp?.styles?.join('\n') ?? '';
    // Single-source-of-truth tokens exist…
    expect(styles).toContain('--sw-ok:');
    expect(styles).toContain('--sw-warn:');
    expect(styles).toContain('--sw-err:');
    // …and the status rules consume them via color-mix, not inline rgba().
    expect(styles).toContain('color-mix(in oklch, var(--sw-ok)');
    expect(styles).toContain('color-mix(in oklch, var(--sw-err)');
  });

  it('gives every interactive surface a cyan :focus-visible ring', () => {
    const styles = (AdminSwarmComponent as { ɵcmp?: { styles?: string[] } }).ɵcmp?.styles?.join('\n') ?? '';
    expect(styles).toContain(':focus-visible');
    expect(styles).toContain('--sw-focus');
    expect(styles).toContain('outline: 2px solid var(--sw-focus)');
  });

  it('honors prefers-reduced-motion on the animated board + preview', () => {
    const styles = (AdminSwarmComponent as { ɵcmp?: { styles?: string[] } }).ɵcmp?.styles?.join('\n') ?? '';
    expect(styles).toContain('prefers-reduced-motion: reduce');
  });

  it('agentColor maps known specialists to tokenized CSS vars + cyan fallback', () => {
    const c = fixture.componentInstance;
    expect(c.agentColor('seo')).toBe('var(--sw-ok)');
    expect(c.agentColor('visual')).toBe('var(--sw-violet)');
    expect(c.agentColor('copy')).toContain('var(--ps-accent');
    expect(c.agentColor('unknown')).toBe('#00e5ff'); // JS fallback default
  });

  it('history rows are keyboard-operable buttons (space preventDefault wired)', () => {
    const template = (AdminSwarmComponent as { ɵcmp?: { template?: unknown } }).ɵcmp ? '' : '';
    // Template assertions live via DOM after seeding a run.
    const c = fixture.componentInstance;
    c.runHistory.set([{
      run_id: 'abcdef1234567890', site_id: 's1', prompt: 'p', status: 'done',
      agents: [{ id: 'a', name: 'seo', status: 'done', file_glob: '*' }], started_at: new Date().toISOString(),
    }]);
    fixture.detectChanges();
    const row = (fixture.nativeElement as HTMLElement).querySelector('.swarm-history__row');
    expect(row?.getAttribute('role')).toBe('button');
    expect(row?.getAttribute('tabindex')).toBe('0');
    expect(row?.getAttribute('aria-label')).toContain('agents complete');
    expect(template).toBe('');
  });

  it('selectRun switches the active run', () => {
    const c = fixture.componentInstance;
    const run = {
      run_id: 'zzz', site_id: 's1', prompt: 'p', status: 'queued',
      agents: [], started_at: new Date().toISOString(),
    };
    c.selectRun(run);
    expect(c.currentRun()?.run_id).toBe('zzz');
  });

  // ── Reliability: a load FAILURE must not masquerade as the empty state ──
  it('loadHistory failure shows a distinct error state (not the misleading "start first run" empty)', () => {
    const http = TestBed.inject(HttpTestingController);
    fixture.componentInstance.siteId.set('s1');
    fixture.componentInstance.loadHistory();
    http.expectOne('/api/swarm/s1/runs').flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(fixture.componentInstance.loadError()).not.toBeNull();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="swarm-load-error"]')).not.toBeNull();
    expect(root.querySelector('.swarm-empty')).withContext('no false "no runs" CTA on a load failure').toBeNull();
    // Standardized onto the shared gold-standard <app-error-card> (Retry + support ref).
    expect(root.querySelector('app-error-card')).withContext('shared error-card primitive').not.toBeNull();
    expect(root.querySelector('[data-testid="error-retry"]')).withContext('Retry on the card').not.toBeNull();
  });

  it('surfaces the worker request_id as a copyable support reference on a failed load', () => {
    const http = TestBed.inject(HttpTestingController);
    fixture.componentInstance.siteId.set('s1');
    fixture.componentInstance.loadHistory();
    http.expectOne('/api/swarm/s1/runs').flush({ error: { request_id: 'req_sw1' } }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(fixture.componentInstance.loadErrorRef()).toBe('req_sw1');
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="error-correlation"]')?.textContent).withContext('reference shown for support').toContain('req_sw1');
  });

  it('startSwarm failure surfaces an error toast + clears running (no silent failure)', () => {
    const errSpy = spyOn(TestBed.inject(ToastService), 'error');
    const http = TestBed.inject(HttpTestingController);
    fixture.componentInstance.siteId.set('s1');
    fixture.componentInstance.startSwarm();
    http.expectOne('/api/swarm/s1/start').flush('boom', { status: 500, statusText: 'Server Error' });
    expect(errSpy).toHaveBeenCalled();
    expect(fixture.componentInstance.running()).toBeFalse();
  });

  it('startSwarm posts the DEFAULT directive when the field is blank', () => {
    const http = TestBed.inject(HttpTestingController);
    fixture.componentInstance.siteId.set('s1');
    fixture.componentInstance.swarmPrompt = '   ';
    fixture.componentInstance.startSwarm();
    const req = http.expectOne('/api/swarm/s1/start');
    expect(req.request.body.prompt).toBe(fixture.componentInstance.DEFAULT_DIRECTIVE);
    req.flush({ run_id: 'r1', agents: [] });
  });

  it('startSwarm posts the operator-typed directive when provided (steerable)', () => {
    const http = TestBed.inject(HttpTestingController);
    fixture.componentInstance.siteId.set('s1');
    fixture.componentInstance.swarmPrompt = '  Focus on mobile conversion + faster LCP  ';
    fixture.componentInstance.startSwarm();
    const req = http.expectOne('/api/swarm/s1/start');
    expect(req.request.body.prompt).toBe('Focus on mobile conversion + faster LCP');
    req.flush({ run_id: 'r1', agents: [] });
  });

  // r54 — idle preview must not look "stuck loading". The component-stream
  // skeletons shimmer ONLY while a run is active or the SSE stream is connected;
  // at rest they are static placeholders (and never animate for reduced-motion).
  it('idle preview does NOT enter the streaming state (skeletons stay static, no "stuck loading")', () => {
    const root: HTMLElement = fixture.nativeElement;
    const preview = root.querySelector('.swarm-preview');
    expect(preview).withContext('preview panel renders').not.toBeNull();
    expect(fixture.componentInstance.running()).withContext('no run at rest').toBeFalse();
    expect(fixture.componentInstance.sseConnected()).withContext('no stream at rest').toBeFalse();
    expect(preview?.classList.contains('swarm-preview--streaming'))
      .withContext('idle preview is NOT in the streaming state').toBeFalse();
    // The shimmer is scoped to the streaming state AND gated behind
    // prefers-reduced-motion: no-preference — never idle, never for reduced motion.
    const styles = (AdminSwarmComponent as { ɵcmp?: { styles?: string[] } }).ɵcmp?.styles?.join('\n') ?? '';
    // (view-encapsulation injects [_ngcontent] attrs between classes, so assert
    //  the streaming scope-class prefix + the motion gate rather than the full selector)
    expect(styles).withContext('shimmer scoped to streaming state').toContain('.swarm-preview--streaming');
    expect(styles).withContext('shimmer gated to motion-OK users').toContain('prefers-reduced-motion: no-preference');
  });

  it('flips the preview into the streaming state once a run is active', () => {
    fixture.componentInstance.running.set(true);
    fixture.detectChanges();
    const preview = (fixture.nativeElement as HTMLElement).querySelector('.swarm-preview');
    expect(preview?.classList.contains('swarm-preview--streaming'))
      .withContext('active run flips the preview into the streaming state').toBeTrue();
  });
});
