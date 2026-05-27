/**
 * `SettingsService` — RxJS-first wrapper for user + workspace settings.
 *
 * Backs every tab in `SettingsShellComponent`. Each method is small,
 * typed by Zod (re-using `@org/domain` where possible), and idempotent
 * where the backend permits (PATCH semantics on profile + prefs).
 *
 * Spec coverage: `feature-settings/__tests__/settings-tabs.spec.ts`.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, map, of, tap } from 'rxjs';
import { z } from 'zod';
import { UserSchema, type User } from '@org/domain';

/** Display + locale prefs that ride with the user record. */
export const DisplayPrefsSchema = z
  .object({
    timezone: z.string().min(1),
    locale: z.string().min(2),
    week_starts_on: z.enum(['sunday', 'monday']),
    measurement_system: z.enum(['metric', 'imperial']),
  })
  .strict();
export type DisplayPrefs = z.infer<typeof DisplayPrefsSchema>;

export const ProfilePatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    email: z.email().optional(),
    avatar_url: z.url().nullable().optional(),
    display: DisplayPrefsSchema.partial().optional(),
  })
  .strict();
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

export const NotificationChannelSchema = z.enum([
  'email',
  'sms',
  'in_app',
  'web_push',
] as const);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NotificationEventSchema = z.enum([
  'booking_created',
  'booking_updated',
  'booking_cancelled',
  'quote_accepted',
  'job_assigned',
  'job_completed',
  'invoice_paid',
  'invoice_failed',
  'site_published',
  'site_build_failed',
  'team_invite_accepted',
  'security_alert',
  'system_announcement',
] as const);
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;

export const NotificationPrefsSchema = z
  .object({
    per_event: z.record(
      NotificationEventSchema,
      z
        .object({
          email: z.boolean(),
          sms: z.boolean(),
          in_app: z.boolean(),
          web_push: z.boolean(),
        })
        .strict(),
    ),
    /** Doctrine §21: super-admin shadow inbox (brian@megabyte.space copy). */
    shadow_to_operator: z.boolean(),
  })
  .strict();
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

export const AppearancePrefsSchema = z
  .object({
    theme: z.enum(['dark', 'light', 'system']),
    accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'invalid hex'),
    reduce_motion: z.boolean(),
    high_contrast: z.boolean(),
  })
  .strict();
export type AppearancePrefs = z.infer<typeof AppearancePrefsSchema>;

export const WorkspacePatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'invalid slug')
      .optional(),
    logo_url: z.url().nullable().optional(),
  })
  .strict();
export type WorkspacePatch = z.infer<typeof WorkspacePatchSchema>;

export interface SecuritySettings {
  readonly idle_timeout_minutes: number;
  readonly require_passkey_for_admin: boolean;
  readonly require_totp_for_super_admin: boolean;
}

export interface DataExportTicket {
  readonly export_id: string;
  readonly status: 'queued' | 'processing' | 'ready' | 'failed';
  readonly download_url_later: string;
  readonly expires_at: string;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);

  // ── Profile ─────────────────────────────────────────────────────────
  getProfile$(): Observable<User> {
    return this.http
      .get<{ user: User }>('/api/settings/profile')
      .pipe(map((r) => UserSchema.parse(r.user)));
  }

  updateProfile$(patch: ProfilePatch): Observable<User> {
    const body = ProfilePatchSchema.parse(patch);
    return this.http
      .patch<{ user: User }>('/api/settings/profile', body)
      .pipe(map((r) => UserSchema.parse(r.user)));
  }

  // ── Notifications ──────────────────────────────────────────────────
  getNotificationPrefs$(): Observable<NotificationPrefs> {
    return this.http
      .get<NotificationPrefs>('/api/settings/notifications')
      .pipe(map((r) => NotificationPrefsSchema.parse(r)));
  }

  updateNotificationPrefs$(
    patch: Partial<NotificationPrefs>,
  ): Observable<NotificationPrefs> {
    return this.http
      .patch<NotificationPrefs>('/api/settings/notifications', patch)
      .pipe(map((r) => NotificationPrefsSchema.parse(r)));
  }

  // ── Appearance ─────────────────────────────────────────────────────
  getAppearance$(): Observable<AppearancePrefs> {
    return this.http
      .get<AppearancePrefs>('/api/settings/appearance')
      .pipe(map((r) => AppearancePrefsSchema.parse(r)));
  }

  setAppearance$(prefs: AppearancePrefs): Observable<AppearancePrefs> {
    const body = AppearancePrefsSchema.parse(prefs);
    return this.http
      .put<AppearancePrefs>('/api/settings/appearance', body)
      .pipe(map((r) => AppearancePrefsSchema.parse(r)));
  }

  // ── Workspace ──────────────────────────────────────────────────────
  updateWorkspace$(patch: WorkspacePatch): Observable<void> {
    const body = WorkspacePatchSchema.parse(patch);
    return this.http
      .patch<void>('/api/settings/workspace', body)
      .pipe(tap(() => undefined));
  }

  // ── Security ───────────────────────────────────────────────────────
  getSecurity$(): Observable<SecuritySettings> {
    return this.http.get<SecuritySettings>('/api/settings/security');
  }

  updateSecurity$(
    patch: Partial<SecuritySettings>,
  ): Observable<SecuritySettings> {
    return this.http.patch<SecuritySettings>('/api/settings/security', patch);
  }

  // ── Danger zone ────────────────────────────────────────────────────
  /** Generates an async export job; UI polls `export_id` for completion. */
  exportData$(): Observable<DataExportTicket> {
    return this.http.post<DataExportTicket>('/api/settings/export', {});
  }

  /**
   * Permanently delete the workspace. `slug_confirmation` must equal the
   * workspace slug exactly — typed-confirm UX enforces it client-side
   * AND the server re-validates.
   */
  deleteWorkspace$(slug_confirmation: string): Observable<void> {
    if (!slug_confirmation) return of(undefined);
    return this.http
      .post<void>('/api/settings/workspace/delete', { slug_confirmation })
      .pipe(tap(() => undefined));
  }

  transferOwnership$(new_owner_id: string): Observable<void> {
    return this.http
      .post<void>('/api/settings/workspace/transfer', { new_owner_id })
      .pipe(tap(() => undefined));
  }
}
