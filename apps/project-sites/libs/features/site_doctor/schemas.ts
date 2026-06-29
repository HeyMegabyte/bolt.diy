/**
 * @module libs/features/site_doctor/schemas
 * @description Zod schemas for the Site Doctor feature module.
 *
 * Site Doctor is the OWNER-facing health report: an A–F grade plus prioritized,
 * plain-English, one-tap fixes. It translates the existing production-readiness
 * signals into language a non-technical owner acts on. Generous-free: the free
 * plan sees the top issue; the rest are locked behind a paid power-up.
 *
 * Voice: sharp & professional — concise, confident, results-focused.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** Caller plan tier — drives the free/paid issue lock. */
export const PlanTierSchema = z.enum(['free', 'starter', 'pro']);
export type PlanTier = z.infer<typeof PlanTierSchema>;

/** Letter grade an owner sees. */
export const GradeSchema = z.enum(['A', 'B', 'C', 'D', 'F']);
export type Grade = z.infer<typeof GradeSchema>;

/** Severity of a single issue, highest first. */
export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export type Severity = z.infer<typeof SeveritySchema>;

/** A structural readiness signal the report consumes (decoupled from readiness module). */
export const SignalSchema = z
  .object({
    name: z.string().min(1),
    pass: z.boolean(),
    weight: z.number().int().nonnegative(),
  })
  .strict();
export type Signal = z.infer<typeof SignalSchema>;

/** One owner-facing issue with a concrete fix. */
export const SiteDoctorIssueSchema = z
  .object({
    id: z.string().min(1),
    severity: SeveritySchema,
    /** Short, plain-English problem statement. */
    title: z.string().min(1),
    /** The concrete, one-line fix to take. */
    fix: z.string().min(1),
    /** True when this issue is hidden behind a paid power-up (free plan). */
    locked: z.boolean(),
  })
  .strict();
export type SiteDoctorIssue = z.infer<typeof SiteDoctorIssueSchema>;

/** The full owner-facing report. */
export const SiteDoctorReportSchema = z
  .object({
    grade: GradeSchema,
    /** 0-100 health score derived from passed signal weight. */
    score: z.number().int().min(0).max(100),
    /** One-line, sharp summary of where the site stands. */
    summary: z.string().min(1),
    /** Prioritized issues (highest severity first). Locked ones omit nothing but flag `locked`. */
    issues: z.array(SiteDoctorIssueSchema),
    /** How many issues are locked behind a paid plan (free tier upsell hook). */
    locked_count: z.number().int().nonnegative(),
  })
  .strict();
export type SiteDoctorReport = z.infer<typeof SiteDoctorReportSchema>;
