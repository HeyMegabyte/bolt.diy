/**
 * `@org/auth` — every auth surface in the v2 admin.
 *
 * Components:
 *  - {@link LoginPageComponent}
 *  - {@link PasskeyEnrollComponent}
 *  - {@link PasskeyListComponent}
 *  - {@link TotpEnrollComponent}
 *  - {@link SessionsListComponent}
 *
 * Services (RxJS-first):
 *  - {@link AuthService}, {@link OAuthService}, {@link MagicLinkService},
 *    {@link VoiceOtpService}, {@link PasskeyService}, {@link TotpService},
 *    {@link SessionsService}, {@link RoleService}, {@link TenantService}.
 *
 * Guards:
 *  - {@link authGuard}, {@link capabilityGuard}, {@link superAdminGuard}.
 *
 * HTTP interceptors:
 *  - {@link authInterceptor}, {@link viewAsInterceptor}, {@link tenantInterceptor}.
 */

// Components
export { LoginPageComponent } from './lib/login-page/login-page.component.js';
export { PasskeyEnrollComponent } from './lib/passkey-enroll/passkey-enroll.component.js';
export {
  PasskeyListComponent,
  type PasskeyRow,
} from './lib/passkey-list/passkey-list.component.js';
export { TotpEnrollComponent } from './lib/totp-enroll/totp-enroll.component.js';
export { SessionsListComponent } from './lib/sessions-list/sessions-list.component.js';

// Services
export { AuthService } from './lib/services/auth.service.js';
export {
  OAuthService,
  type OAuthProvider,
  type OAuthStartResponse,
} from './lib/services/oauth.service.js';
export {
  MagicLinkService,
  type MagicLinkRequestResponse,
} from './lib/services/magic-link.service.js';
export {
  VoiceOtpService,
  type VoiceOtpStartResponse,
} from './lib/services/voice-otp.service.js';
export {
  PasskeyService,
  type PasskeyEnrollResult,
} from './lib/services/passkey.service.js';
export {
  TotpService,
  type TotpEnrollChallenge,
  type TotpVerifyResponse,
} from './lib/services/totp.service.js';
export { SessionsService } from './lib/services/sessions.service.js';
export { RoleService } from './lib/services/role.service.js';
export { TenantService } from './lib/services/tenant.service.js';

// Guards
export { authGuard } from './lib/guards/auth.guard.js';
export { capabilityGuard } from './lib/guards/capability.guard.js';
export { superAdminGuard } from './lib/guards/super-admin.guard.js';

// Interceptors
export { authInterceptor } from './lib/interceptors/auth.interceptor.js';
export { viewAsInterceptor } from './lib/interceptors/view-as.interceptor.js';
export { tenantInterceptor } from './lib/interceptors/tenant.interceptor.js';
export { offlineInterceptor } from './lib/interceptors/offline.interceptor.js';
