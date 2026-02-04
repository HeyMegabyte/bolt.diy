/**
 * Authentication schemas
 */
import { z } from 'zod';
import { uuidSchema, emailSchema, phoneSchema, timestampsSchema } from './base.js';
import { AUTH } from '../constants/index.js';

// ============================================================================
// MAGIC LINK
// ============================================================================

export const magicLinkSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  token: z.string().length(AUTH.MAGIC_LINK_TOKEN_LENGTH),
  expires_at: z.string().datetime(),
  used_at: z.string().datetime().nullable().optional(),
  ip_address: z.string().nullable().optional(),
  user_agent: z.string().max(500).nullable().optional(),
  ...timestampsSchema.shape,
});

export const createMagicLinkInputSchema = z.object({
  email: emailSchema,
});

export const verifyMagicLinkInputSchema = z.object({
  token: z.string().min(1),
});

// ============================================================================
// PHONE OTP
// ============================================================================

export const phoneOtpSchema = z.object({
  id: uuidSchema,
  phone: phoneSchema,
  code_hash: z.string(),
  expires_at: z.string().datetime(),
  attempts: z.number().int().nonnegative().default(0),
  verified_at: z.string().datetime().nullable().optional(),
  ip_address: z.string().nullable().optional(),
  ...timestampsSchema.shape,
});

export const createPhoneOtpInputSchema = z.object({
  phone: phoneSchema,
});

export const verifyPhoneOtpInputSchema = z.object({
  phone: phoneSchema,
  code: z
    .string()
    .length(AUTH.OTP_CODE_LENGTH)
    .regex(/^\d+$/, 'OTP must be numeric'),
});

// ============================================================================
// SESSION
// ============================================================================

export const sessionSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  token_hash: z.string(),
  expires_at: z.string().datetime(),
  revoked_at: z.string().datetime().nullable().optional(),
  ip_address: z.string().nullable().optional(),
  user_agent: z.string().max(500).nullable().optional(),
  device_name: z.string().max(100).nullable().optional(),
  last_active_at: z.string().datetime().nullable().optional(),
  ...timestampsSchema.shape,
});

export const createSessionInputSchema = z.object({
  user_id: uuidSchema,
  ip_address: z.string().optional(),
  user_agent: z.string().max(500).optional(),
  device_name: z.string().max(100).optional(),
});

// ============================================================================
// GOOGLE OAUTH STATE
// ============================================================================

export const oauthStateSchema = z.object({
  id: uuidSchema,
  state: z.string(),
  nonce: z.string(),
  redirect_uri: z.string().url(),
  code_verifier: z.string(),
  expires_at: z.string().datetime(),
  used_at: z.string().datetime().nullable().optional(),
  ...timestampsSchema.shape,
});

export const googleCallbackInputSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const googleTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  id_token: z.string().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

export const googleUserInfoSchema = z.object({
  id: z.string(),
  email: emailSchema,
  verified_email: z.boolean().optional(),
  name: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  picture: z.string().url().optional(),
  locale: z.string().optional(),
});

// ============================================================================
// AUTH RESPONSE
// ============================================================================

export const authResponseSchema = z.object({
  session_token: z.string(),
  expires_at: z.string().datetime(),
  user: z.object({
    id: uuidSchema,
    email: emailSchema,
    phone: phoneSchema.nullable().optional(),
    display_name: z.string().nullable().optional(),
    avatar_url: z.string().url().nullable().optional(),
  }),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type MagicLink = z.infer<typeof magicLinkSchema>;
export type CreateMagicLinkInput = z.infer<typeof createMagicLinkInputSchema>;
export type VerifyMagicLinkInput = z.infer<typeof verifyMagicLinkInputSchema>;
export type PhoneOtp = z.infer<typeof phoneOtpSchema>;
export type CreatePhoneOtpInput = z.infer<typeof createPhoneOtpInputSchema>;
export type VerifyPhoneOtpInput = z.infer<typeof verifyPhoneOtpInputSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type OAuthState = z.infer<typeof oauthStateSchema>;
export type GoogleCallbackInput = z.infer<typeof googleCallbackInputSchema>;
export type GoogleTokenResponse = z.infer<typeof googleTokenResponseSchema>;
export type GoogleUserInfo = z.infer<typeof googleUserInfoSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
