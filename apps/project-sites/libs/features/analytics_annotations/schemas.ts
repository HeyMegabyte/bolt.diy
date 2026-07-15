import { z } from 'zod';
export const CreateAnnotationSchema = z.object({ siteId: z.string().uuid(), date: z.string(), note: z.string().min(1).max(500), category: z.enum(['deploy','marketing','incident','other']).default('other') }).strict();
export const AnnotationSchema = z.object({ id: z.string().uuid(), siteId: z.string().uuid(), date: z.string(), note: z.string(), category: z.string(), createdAt: z.string() });
