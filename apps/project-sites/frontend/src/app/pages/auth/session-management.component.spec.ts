import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionManagementComponent } from './session-management.component';
import { AuthApiService, type AuthSession } from './auth-api.service';

describe('SessionManagementComponent', () => {
  const listSessions = jasmine.createSpy('listSessions');
  const revokeSession = jasmine.createSpy('revokeSession');
  const revokeOtherSessions = jasmine.createSpy('revokeOtherSessions');

  const rows: AuthSession[] = [
    { id: '1', token: 'tok-a', ipAddress: '1.1.1.1', userAgent: 'Chrome / macOS', createdAt: '2026-06-01T00:00:00Z' },
    { id: '2', token: 'tok-b', ipAddress: '2.2.2.2', userAgent: 'Safari / iOS', createdAt: '2026-06-02T00:00:00Z' },
  ];

  async function make() {
    TestBed.configureTestingModule({
      imports: [SessionManagementComponent],
      providers: [
        {
          provide: AuthApiService,
          useValue: { listSessions, revokeSession, revokeOtherSessions },
        },
        provideRouter([]),
      ],
    });
    const f = TestBed.createComponent(SessionManagementComponent);
    f.detectChanges(); // triggers ngOnInit → load()
    await f.componentInstance.load();
    f.detectChanges();
    return f;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    listSessions.calls.reset();
    revokeSession.calls.reset();
    revokeOtherSessions.calls.reset();
    listSessions.and.resolveTo({ ok: true, data: rows.slice() });
    revokeSession.and.resolveTo({ ok: true, data: {} });
    revokeOtherSessions.and.resolveTo({ ok: true, data: {} });
  });

  it('renders a row per active session with IP + created', async () => {
    const f = await make();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="session-management"]')).toBeTruthy();
    expect(el.querySelectorAll('[data-testid="session-row"]').length).toBe(2);
    expect(el.querySelector('[data-testid="session-ip"]')?.textContent).toContain('1.1.1.1');
  });

  it('revokes a single session and drops it from the list', async () => {
    const f = await make();
    await f.componentInstance.revoke(rows[0]);
    f.detectChanges();
    expect(revokeSession).toHaveBeenCalledWith({ token: 'tok-a' });
    expect(f.componentInstance.sessions().length).toBe(1);
    expect(f.componentInstance.sessions()[0].token).toBe('tok-b');
  });

  it('guards a second revoke while one is in flight', async () => {
    const f = await make();
    let resolve!: (v: unknown) => void;
    revokeSession.and.returnValue(new Promise((r) => (resolve = r)));
    const first = f.componentInstance.revoke(rows[0]);
    expect(f.componentInstance.isRevoking('tok-a')).toBe(true);
    await f.componentInstance.revoke(rows[0]); // re-entry no-ops
    expect(revokeSession).toHaveBeenCalledTimes(1);
    resolve({ ok: true, data: {} });
    await first;
  });

  it('signs out everywhere then reloads', async () => {
    const f = await make();
    listSessions.calls.reset();
    await f.componentInstance.signOutEverywhere();
    expect(revokeOtherSessions).toHaveBeenCalled();
    expect(listSessions).toHaveBeenCalled();
  });

  it('shows an error when loading sessions fails', async () => {
    listSessions.and.resolveTo({ ok: false, error: 'Not signed in.' });
    const f = await make();
    expect(f.componentInstance.error()).toBe('Not signed in.');
    expect(f.nativeElement.querySelector('[data-testid="sessions-error"]')).toBeTruthy();
  });
});
