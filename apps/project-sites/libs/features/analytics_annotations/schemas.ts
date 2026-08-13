import { z } from 'zod';
// Site ids are internal identifiers (not guaranteed uuid across all seed/import
// paths); ownership is enforced in the service via `WHERE id=? AND org_id=?`, so
// validate as a bounded non-empty string rather than a strict uuid (which wrongly
// 500'd creates for legitimate non-uuid site ids).
export const CreateAnnotationSchema = z.object({ siteId: z.string().min(1).max(64), date: z.string().min(1).max(32), note: z.string().min(1).max(500), category: z.enum(['deploy','marketing','incident','other']).default('other') }).strict();
export const AnnotationSchema = z.object({ id: z.string().min(1), siteId: z.string().min(1).max(64), date: z.string(), note: z.string(), category: z.string(), createdAt: z.string() });
