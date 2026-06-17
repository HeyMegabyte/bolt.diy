/**
 * @module pages/oauth-consent
 * @description OAuth 2.1 consent screen — the one UI piece of the MCP one-click
 * connect flow. An MCP client (Claude Code) opens the browser to
 * `/oauth/authorize`, the worker 302s here with the OAuth params. This page
 * shows the consent, and on "Allow" calls `POST /api/oauth/authorize` (Bearer
 * from the signed-in session) which mints a single-use code; we then redirect
 * the browser to the client's `redirect_uri?code=…&state=…`. The worker
 * re-validates everything (client, exact redirect_uri, scopes, PKCE) — this page
 * is intentionally thin.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

interface ConsentParams {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string | null;
  code_challenge: string;
  code_challenge_method: string;
}

const SCOPE_LABELS: Record<string, { title: string; detail: string }> = {
  'sites:read': { title: 'View your sites', detail: 'List sites, read build status, logs, snapshots & research' },
  'sites:write': { title: 'Create, deploy & manage sites', detail: 'Create sites, deploy files, connect custom domains' },
};

@Component({
  selector: 'app-oauth-consent',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="oc-wrap">
      <section class="oc-card" role="dialog" aria-modal="true" aria-labelledby="oc-title">
        @if (paramError()) {
          <h1 id="oc-title" class="oc-title">Invalid authorization request</h1>
          <p class="oc-sub">This link is missing required OAuth parameters. Start the connection again from your editor.</p>
        } @else {
          <div class="oc-logo" aria-hidden="true">
            <img src="/logo-header-icon.png" alt="" width="44" height="44" />
          </div>
          <h1 id="oc-title" class="oc-title">Connect to projectsites.dev</h1>
          <p class="oc-sub">
            <strong>{{ appLabel() }}</strong> is requesting access to your account
            <span class="oc-acct">({{ email() }})</span>.
          </p>

          <ul class="oc-scopes" aria-label="Requested permissions">
            @for (s of scopeList(); track s.key) {
              <li class="oc-scope">
                <span class="oc-check" aria-hidden="true">✓</span>
                <span>
                  <span class="oc-scope-title">{{ s.title }}</span>
                  <span class="oc-scope-detail">{{ s.detail }}</span>
                </span>
              </li>
            }
          </ul>

          @if (errorMsg()) {
            <p class="oc-err" role="alert">{{ errorMsg() }}</p>
          }

          <div class="oc-actions">
            <button type="button" class="oc-btn oc-btn--ghost" (click)="deny()" [disabled]="busy()">Deny</button>
            <button type="button" class="oc-btn oc-btn--primary" (click)="allow()" [disabled]="busy()">
              {{ busy() ? 'Connecting…' : 'Allow access' }}
            </button>
          </div>

          <p class="oc-foot">
            You'll be redirected to <span class="oc-host">{{ redirectHost() }}</span>. Only allow editors you trust.
          </p>
        }
      </section>
    </main>
  `,
  styles: [`
    :host { display: block; min-height: 100dvh; background: #0a0a1a; color: #f4f4ff; }
    .oc-wrap { display: grid; place-items: center; min-height: 100dvh; padding: 1.5rem; }
    .oc-card {
      width: 100%; max-width: 440px; background: #11111f; border: 1px solid rgba(100, 255, 218, 0.14);
      border-radius: 18px; padding: 2rem; box-shadow: 0 24px 60px rgba(0,0,0,0.5);
      animation: oc-in 380ms cubic-bezier(0.22,0.9,0.3,1) both;
    }
    @keyframes oc-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .oc-card { animation: none; } }
    .oc-logo { display: grid; place-items: center; width: 64px; height: 64px; margin: 0 auto 1rem;
      border-radius: 16px; background: rgba(100,255,218,0.08); border: 1px solid rgba(100,255,218,0.18); }
    .oc-title { font-size: 1.4rem; font-weight: 700; text-align: center; margin: 0 0 0.5rem; }
    .oc-sub { text-align: center; color: #aab; font-size: 0.95rem; line-height: 1.5; margin: 0 0 1.5rem; }
    .oc-acct { color: #64ffda; }
    .oc-scopes { list-style: none; margin: 0 0 1.25rem; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
    .oc-scope { display: flex; gap: 0.7rem; align-items: flex-start; background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 0.7rem 0.85rem; }
    .oc-check { color: #64ffda; font-weight: 800; line-height: 1.4; }
    .oc-scope-title { display: block; font-weight: 600; font-size: 0.92rem; }
    .oc-scope-detail { display: block; color: #889; font-size: 0.8rem; margin-top: 0.1rem; }
    .oc-err { color: #ff8a8a; font-size: 0.85rem; text-align: center; margin: 0 0 1rem; }
    .oc-actions { display: grid; grid-template-columns: 1fr 1.4fr; gap: 0.75rem; margin-bottom: 1rem; }
    .oc-btn { padding: 0.8rem 1rem; border-radius: 999px; font-weight: 600; font-size: 0.95rem; cursor: pointer;
      transition: all 0.333s; border: 1px solid transparent; }
    .oc-btn:disabled { opacity: 0.6; cursor: default; }
    .oc-btn--ghost { background: transparent; border-color: rgba(255,255,255,0.16); color: #ccd; }
    .oc-btn--ghost:hover:not(:disabled) { border-color: rgba(255,255,255,0.32); }
    .oc-btn--primary { background: #64ffda; color: #06121a; }
    .oc-btn--primary:hover:not(:disabled) { box-shadow: 0 8px 22px rgba(100,255,218,0.3); transform: translateY(-1px); }
    .oc-btn:focus-visible { outline: 2px solid #64ffda; outline-offset: 2px; }
    .oc-foot { text-align: center; color: #667; font-size: 0.78rem; line-height: 1.5; margin: 0; }
    .oc-host { color: #aab; }
  `],
})
export class OauthConsentComponent {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly busy = signal(false);
  readonly errorMsg = signal('');
  readonly email = this.auth.email;

  private readonly params: ConsentParams | null = this.readParams();
  readonly paramError = computed(() => this.params === null);

  readonly appLabel = computed(() => {
    const id = this.params?.client_id ?? '';
    // client_id is an opaque token; show a friendly generic label rather than the raw id.
    return id ? 'An MCP application' : 'An application';
  });

  readonly redirectHost = computed(() => {
    try {
      return new URL(this.params?.redirect_uri ?? '').host;
    } catch {
      return 'the application';
    }
  });

  readonly scopeList = computed(() => {
    const scopes = (this.params?.scope ?? '').split(' ').filter(Boolean);
    const list = scopes.length ? scopes : ['sites:read'];
    return list.map((key) => ({ key, ...(SCOPE_LABELS[key] ?? { title: key, detail: key }) }));
  });

  constructor() {
    // Require a signed-in session — bounce to sign-in, returning here afterward.
    if (!this.paramError() && !this.auth.isLoggedIn()) {
      const here = window.location.pathname + window.location.search;
      window.location.href = `/signin?returnUrl=${encodeURIComponent(here)}`;
    }
  }

  private readParams(): ConsentParams | null {
    const q = this.route.snapshot.queryParamMap;
    const client_id = q.get('client_id');
    const redirect_uri = q.get('redirect_uri');
    const code_challenge = q.get('code_challenge');
    if (!client_id || !redirect_uri || !code_challenge) return null;
    return {
      client_id,
      redirect_uri,
      code_challenge,
      scope: q.get('scope') ?? 'sites:read',
      state: q.get('state'),
      code_challenge_method: q.get('code_challenge_method') ?? 'S256',
    };
  }

  allow(): void {
    if (this.busy() || !this.params) return;
    this.busy.set(true);
    this.errorMsg.set('');
    this.api
      .post<{ redirect_uri: string }>('/oauth/authorize', {
        client_id: this.params.client_id,
        redirect_uri: this.params.redirect_uri,
        scope: this.params.scope,
        state: this.params.state ?? undefined,
        code_challenge: this.params.code_challenge,
        code_challenge_method: this.params.code_challenge_method,
        response_type: 'code',
      }, { silent: true })
      .subscribe({
        next: (res) => {
          // Hand control back to the editor's loopback redirect with the code.
          window.location.href = res.redirect_uri;
        },
        error: () => {
          this.busy.set(false);
          this.errorMsg.set('Could not authorize this application. The request may be invalid or expired — start again from your editor.');
        },
      });
  }

  deny(): void {
    if (!this.params) return;
    const sep = this.params.redirect_uri.includes('?') ? '&' : '?';
    const state = this.params.state ? `&state=${encodeURIComponent(this.params.state)}` : '';
    window.location.href = `${this.params.redirect_uri}${sep}error=access_denied${state}`;
  }
}
