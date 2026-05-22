import { Component, inject, signal, type OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-admin-accept-invite',
  standalone: true,
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4">
      <section class="card max-w-xl mx-auto text-center">
        @if (state() === 'verifying') {
          <h2 class="text-base font-semibold text-white m-0">Verifying invite…</h2>
          <p class="text-[0.78rem] text-text-secondary mt-2">Checking the token from your email.</p>
        } @else if (state() === 'success') {
          <div class="text-2xl">✓</div>
          <h2 class="text-base font-semibold text-emerald-300 m-0 mt-2">Joined</h2>
          <p class="text-[0.78rem] text-text-secondary mt-1">Redirecting to admin…</p>
        } @else {
          <div class="text-2xl">⚠</div>
          <h2 class="text-base font-semibold text-amber-300 m-0 mt-2">Couldn't accept invite</h2>
          <p class="text-[0.78rem] text-text-secondary mt-1">{{ message() }}</p>
          <button class="btn-primary mt-3" (click)="goAdmin()" title="Back to admin home">Go to admin</button>
        }
      </section>
    </div>
  `,
  styles: [`
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 2rem; margin-top: 4rem; }
    .btn-primary { padding: 0.5rem 1rem; border-radius: 8px; background: rgba(0,229,255,0.12); color: #00E5FF; font-weight: 600; border: 1px solid rgba(0,229,255,0.35); cursor: pointer; font-size: 0.78rem; }
  `],
})
export class AdminAcceptInviteComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  state = signal<'verifying' | 'success' | 'error'>('verifying');
  message = signal('');

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) { this.state.set('error'); this.message.set('Missing token in URL.'); return; }
    this.api.post<{ data: { joined: boolean; role: string } }>('/team/invites/accept', { token }).subscribe({
      next: (r) => {
        this.state.set('success');
        this.toast.success(`Joined as ${r.data?.role ?? 'member'}`);
        setTimeout(() => this.router.navigateByUrl('/admin'), 1200);
      },
      error: (err) => {
        this.state.set('error');
        this.message.set(err?.error?.error?.message || 'Invite could not be accepted.');
      },
    });
  }
  goAdmin(): void { this.router.navigateByUrl('/admin'); }
}
