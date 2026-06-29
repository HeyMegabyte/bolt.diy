/**
 * @module services/preference_center
 * @description LM14 (#294): per-channel notification preferences mapped to
 * psnotify. Pure zero-I/O schema + defaults + validation, so the preference
 * form and Listmonk subscribe/unsubscribe consume one typed contract.
 *
 * Never throws — validation returns string arrays.
 *
 * @packageDocumentation
 */

/** Notification delivery channels. */
export type NotificationChannel = 'email' | 'push' | 'in_app' | 'sms';

/** Event types that trigger notifications. */
export type PreferenceKey =
  | 'build_complete'
  | 'build_failed'
  | 'first_lead'
  | 'weekly_digest'
  | 'billing'
  | 'product_updates'
  | 'domain_events'
  | 'security_alerts';

/** One channel's on/off state within a set of preferences. */
export interface ChannelPrefs {
  readonly email: boolean;
  readonly push: boolean;
  readonly in_app: boolean;
  readonly sms: boolean;
}

/**
 * A complete preference set for one user/org. Overrides allow per-event-type
 * fine-tuning on top of the global channel defaults.
 */
export interface PreferenceSet {
  /** Global channel defaults applied to all notification types. */
  readonly channels: ChannelPrefs;
  /**
   * Per-event-type overrides. Keys absent from this map inherit the global
   * channel defaults verbatim. Each override may supply a partial set of
   * channels — unspecified channels fall through to the global default.
   */
  readonly overrides: Readonly<Partial<Record<PreferenceKey, Partial<ChannelPrefs>>>>;
}

/** All known notification channels, in display order. */
export const ALL_CHANNELS: readonly NotificationChannel[] = [
  'email',
  'push',
  'in_app',
  'sms',
] as const;

/** All known preference keys, in display order. */
export const ALL_PREFERENCE_KEYS: readonly PreferenceKey[] = [
  'build_complete',
  'build_failed',
  'first_lead',
  'weekly_digest',
  'billing',
  'product_updates',
  'domain_events',
  'security_alerts',
] as const;

/**
 * Default preference set: email, push, and in-app enabled; SMS opt-in (off);
 * no per-event-type overrides.
 */
export const DEFAULTS: PreferenceSet = {
  channels: { email: true, in_app: true, push: true, sms: false },
  overrides: {},
} as const;

/**
 * Resolve the effective channel prefs for a given notification key. Overrides
 * on top of the global channel defaults: if the override specifies a channel,
 * that value wins; otherwise the global default is carried through.
 *
 * Pure + deterministic; never throws.
 *
 * @param prefs - The full preference set (global defaults + overrides).
 * @param key - Which notification type to resolve for.
 * @returns The merged {@link ChannelPrefs} for this key.
 *
 * @example
 * const p = resolvePrefs(userPrefs, 'build_complete');
 * // → { email: true, push: true, in_app: true, sms: false }
 *
 * @example
 * const custom: PreferenceSet = {
 *   channels: { email: true, push: true, in_app: true, sms: false },
 *   overrides: { build_complete: { sms: true } },
 * };
 * resolvePrefs(custom, 'build_complete');
 * // → { email: true, push: true, in_app: true, sms: true }
 */
export function resolvePrefs(prefs: PreferenceSet, key: PreferenceKey): ChannelPrefs {
  const override = prefs.overrides[key];
  if (!override) {
    // Fast path — no override for this key, return defaults unchanged.
    return { ...prefs.channels };
  }
  return {
    email: override.email ?? prefs.channels.email,
    in_app: override.in_app ?? prefs.channels.in_app,
    push: override.push ?? prefs.channels.push,
    sms: override.sms ?? prefs.channels.sms,
  };
}

/**
 * Validate an unknown value as a {@link PreferenceSet}. Returns a flat array
 * of human-readable error strings; an empty array means the input is valid.
 *
 * Checks performed:
 * - `input` is a non-null object
 * - `channels` is present and an object
 * - every expected channel has a boolean value
 * - no unexpected channel keys
 * - `overrides` is present and an object
 * - every override key is a valid PreferenceKey
 * - every override value is an object with only boolean channel keys
 *
 * @param input - The raw value to validate.
 * @returns Zero or more error strings. Empty = valid.
 *
 * @example
 * validatePrefs(null);
 * // → ['input must be a non-null object']
 *
 * @example
 * validatePrefs({ channels: { email: true, push: true, in_app: true, sms: false }, overrides: {} });
 * // → []
 *
 * @example
 * validatePrefs({ channels: { email: 'yes' }, overrides: {} });
 * // → ['channels.email must be a boolean']
 */
export function validatePrefs(input: unknown): string[] {
  const errors: string[] = [];

  if (input === null || input === undefined || typeof input !== 'object') {
    errors.push('input must be a non-null object');
    return errors;
  }

  const obj = input as Record<string, unknown>;

  // --- channels ---
  if (!obj.channels || typeof obj.channels !== 'object') {
    errors.push('channels must be an object');
  } else {
    const ch = obj.channels as Record<string, unknown>;

    // Check expected channel keys.
    for (const key of ALL_CHANNELS) {
      if (typeof ch[key] !== 'boolean') {
        errors.push(`channels.${key} must be a boolean`);
      }
    }

    // Reject unexpected keys.
    for (const key of Object.keys(ch)) {
      if (!(ALL_CHANNELS as readonly string[]).includes(key)) {
        errors.push(`channels has unexpected key "${key}"`);
      }
    }
  }

  // --- overrides ---
  if (!obj.overrides || typeof obj.overrides !== 'object') {
    errors.push('overrides must be an object');
  } else {
    const ov = obj.overrides as Record<string, unknown>;

    for (const key of Object.keys(ov)) {
      // Every override key must be a valid PreferenceKey.
      if (!(ALL_PREFERENCE_KEYS as readonly string[]).includes(key)) {
        errors.push(`overrides has unrecognized key "${key}"`);
        continue; // skip value checks for unrecognized keys
      }

      const val = ov[key];
      if (val === null || val === undefined || typeof val !== 'object') {
        errors.push(`overrides.${key} must be an object`);
        continue;
      }

      const overrideObj = val as Record<string, unknown>;

      // Every value in the override object must be a boolean channel key.
      for (const channel of Object.keys(overrideObj)) {
        if (!(ALL_CHANNELS as readonly string[]).includes(channel)) {
          errors.push(`overrides.${key} has unexpected channel "${channel}"`);
        } else if (typeof overrideObj[channel] !== 'boolean') {
          errors.push(`overrides.${key}.${channel} must be a boolean`);
        }
      }
    }
  }

  return errors;
}
