/**
 * Spec: `InviteDialogComponent` accepts a batch of email/role rows,
 * validates every email, and dispatches one POST `/api/team/invite` per
 * email (not a single bulk request).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { InviteDialogComponent } from '../lib/invite-dialog/invite-dialog.component';
import { TeamService } from '@org/data-access';

describe('InviteDialogComponent', () => {
  let fixture: ComponentFixture<InviteDialogComponent>;
  let component: InviteDialogComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InviteDialogComponent],
      providers: [
        TeamService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InviteDialogComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('renders one default row', () => {
    const form = fixture.nativeElement as HTMLElement;
    expect(form.querySelectorAll('[data-testid^="invite-email-"]').length).toBe(1);
  });

  it('adds another invite row when "Add another" clicked', () => {
    const addBtn = fixture.nativeElement.querySelector(
      '[data-testid="invite-add-row"]',
    ) as HTMLButtonElement;
    addBtn.click();
    fixture.detectChanges();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid^="invite-email-"]',
    );
    expect(rows.length).toBe(2);
  });

  it('blocks submit when an email is invalid', () => {
    // Default row email is empty (invalid).
    const submitSpy = vi.fn();
    component.closed.subscribe(submitSpy);
    const submit = fixture.nativeElement.querySelector(
      '[data-testid="invite-submit"]',
    ) as HTMLButtonElement;
    submit.click();
    fixture.detectChanges();
    httpMock.expectNone('/api/team/invite');
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('calls POST /api/team/invite once per email on submit', () => {
    // Two valid rows.
    component['rows'].at(0).patchValue({ email: 'one@example.com', role: 'admin' });
    component['addRow']();
    component['rows']
      .at(1)
      .patchValue({ email: 'two@example.com', role: 'member' });
    fixture.detectChanges();

    const closedSpy = vi.fn();
    component.closed.subscribe(closedSpy);

    component['submit']();

    const reqs = httpMock.match('/api/team/invite');
    expect(reqs.length).toBe(2);
    expect(reqs[0].request.method).toBe('POST');
    expect(reqs[0].request.body).toEqual({
      email: 'one@example.com',
      role: 'admin',
    });
    expect(reqs[1].request.body).toEqual({
      email: 'two@example.com',
      role: 'member',
    });

    reqs.forEach((r, i) =>
      r.flush({
        invite_id: `inv_${i}`,
        email: r.request.body.email as string,
        status: 'sent',
      }),
    );
    expect(closedSpy).toHaveBeenCalledWith(true);
  });

  it('lowercases + trims emails before send', () => {
    component['rows'].at(0).patchValue({
      email: '  MixedCase@Example.COM ',
      role: 'viewer',
    });
    fixture.detectChanges();

    component['submit']();

    const req = httpMock.expectOne('/api/team/invite');
    expect(req.request.body.email).toBe('mixedcase@example.com');
    req.flush({ invite_id: 'inv_x', email: 'mixedcase@example.com', status: 'sent' });
  });
});
