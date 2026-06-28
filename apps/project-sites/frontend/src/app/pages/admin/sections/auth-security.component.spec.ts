import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AuthSecurityComponent } from './auth-security.component';
import { ApiService, type AuditLogRow } from '../../../services/api.service';

function row(over: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: Math.random().toString(36).slice(2),
    action: 'auth.session.created',
    message: null,
    actor_id: 'user_a',
    created_at: '2026-06-25T12:00:00.000Z',
    ...over,
  };
}

function setup(value = of({ data: sampleRows() })) {
  const get = jasmine.createSpy('get').and.returnValue(value);
  TestBed.configureTestingModule({
    imports: [AuthSecurityComponent],
    providers: [provideRouter([]), { provide: ApiService, useValue: { get } }],
  });
  const fixture: ComponentFixture<AuthSecurityComponent> =
    TestBed.createComponent(AuthSecurityComponent);
  fixture.detectChanges(); // ngOnInit → load
  return { fixture, get };
}

/** 4 sign-ins (2 distinct actors) + 1 anomaly → 25% anomaly rate. */
function sampleRows(): AuditLogRow[] {
  return [
    row({ action: 'auth.session.created', actor_id: 'user_a' }),
    row({ action: 'auth.session.created', actor_id: 'user_a' }),
    row({ action: 'auth.session.created', actor_id: 'user_b' }),
    row({ action: 'auth.session.created', actor_id: 'user_b' }),
    row({
      action: 'auth.anomaly.detected',
      actor_id: 'user_b',
      message: 'Sign-in from new_ip and new_device',
    }),
    row({ action: 'site.created', actor_id: 'user_c' }), // non-auth → filtered out
  ];
}

function text(fixture: ComponentFixture<unknown>, sel: string): string | null {
  return fixture.nativeElement.querySelector(sel)?.textContent?.trim() ?? null;
}

describe('AuthSecurityComponent', () => {
  it('fetches audit logs (limit 500, silent) and filters to auth.* rows', () => {
    const { get } = setup();
    expect(get).toHaveBeenCalledWith('/audit-logs', { limit: '500' }, { silent: true });
  });

  it('renders the metric cards', () => {
    const { fixture } = setup();
    expect(fixture.nativeElement.querySelector('[data-testid="auth-security-metrics"]')).not.toBeNull();
    expect(text(fixture, '[data-testid="metric-signins"]')).toContain('4');
    expect(text(fixture, '[data-testid="metric-anomalies"]')).toContain('1');
    expect(text(fixture, '[data-testid="metric-actors"]')).toContain('2');
  });

  it('computes the anomaly rate correctly (1 anomaly / 4 sign-ins = 25%)', () => {
    const { fixture } = setup();
    expect(text(fixture, '[data-testid="metric-anomaly-rate"]')).toContain('25%');
  });

  it('breaks down anomaly reasons parsed from the message text', () => {
    const { fixture } = setup();
    const section = fixture.nativeElement.querySelector('[data-testid="auth-security-reasons"]');
    expect(section).not.toBeNull();
    expect(section.textContent).toContain('New IP address');
    expect(section.textContent).toContain('New device');
  });

  it('lists the suspicious sign-ins', () => {
    const { fixture } = setup();
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="auth-suspicious-row"]');
    expect(rows.length).toBe(1);
    expect(fixture.nativeElement.querySelector('[data-testid="auth-suspicious"]').textContent).toContain('user_b');
  });

  it('shows the calm empty state when there are no auth.* rows', () => {
    const { fixture } = setup(of({ data: [row({ action: 'site.created', actor_id: 'x' })] }));
    expect(fixture.nativeElement.querySelector('[data-testid="auth-security-empty"]')).not.toBeNull();
    expect(text(fixture, '[data-testid="auth-security-empty"]')).toContain('Better Auth cutover');
    expect(fixture.nativeElement.querySelector('[data-testid="auth-security-metrics"]')).toBeNull();
  });

  it('shows the empty state (never an error) when the response has no rows', () => {
    const { fixture } = setup(of({ data: [] }));
    expect(fixture.nativeElement.querySelector('[data-testid="auth-security-empty"]')).not.toBeNull();
  });

  it('renders an error card with Retry on fetch failure', () => {
    const { fixture } = setup(throwError(() => new Error('boom')));
    expect(fixture.nativeElement.querySelector('[data-testid="auth-security-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="auth-security-retry"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="auth-security-metrics"]')).toBeNull();
  });
});
