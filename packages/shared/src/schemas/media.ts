/**
 * @module schemas/media
 * @description Zod schemas for the Media Library — tus-resumable uploads,
 * EXIF-scrubbed assets, AI alt-text + tags, AVIF/WebP/JPEG variants, optional
 * pgvector embeddings, and dedup-by-sha256 multi-tenant ledger.
 *
 * | Schema                       | Purpose                                          |
 * | ---------------------------- | ------------------------------------------------ |
 * | `mediaItemSchema`            | Row shape returned by `GET /api/media/:id`       |
 * | `mediaListQuerySchema`       | Query params for `GET /api/media`                |
 * | `mediaListResponseSchema`    | Paginated list envelope                          |
 * | `mediaInitUploadSchema`      | Body for `POST /api/media/upload/init`           |
 * | `mediaInitUploadResponseSchema` | Tus session created                           |
 * | `mediaCompleteResponseSchema`| Body returned by `POST /upload/:id/complete`     |
 * | `mediaRegenerateAltSchema`   | Body for `POST /api/media/:id/regenerate-alt`    |
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { uuidSchema, paginationSchema } from './base.js';

/**
 * MIME types accepted by the media upload pipeline. The wildcard groups
 * (image/*, video/*, audio/*) are expanded to the canonical browser-served
 * subset; rare formats are added only when the codec is web-safe.
 */
export const ACCEPTED_MEDIA_MIME = [
  // Image
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/svg+xml',
  // Video
  'video/mp4',
  'video/webm',
  'video/quicktime',
  // Audio
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  // Documents / archives
  'application/pdf',
  'application/zip',
] as const;

export const acceptedMediaMimeSchema = z.enum(ACCEPTED_MEDIA_MIME);

/** Hard cap per file — R2 multipart upload upper bound. */
export const MAX_MEDIA_FILE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

/** Tus PATCH chunk upper bound — keeps Worker CPU + memory well under limits. */
export const MAX_TUS_CHUNK_BYTES = 16 * 1024 * 1024; // 16 MiB

/**
 * Per-MIME web-rendered variant URLs (signed R2 / CF Images delivery URLs).
 * `jpeg` is the universal legacy fallback; `webp` is the broad-support layer;
 * `avif` is the LCP-priority primary served via `<picture>` source order.
 */
export const mediaVariantsSchema = z.object({
  avif: z.string().url().nullable(),
  webp: z.string().url().nullable(),
  jpeg: z.string().url().nullable(),
  cf_images_id: z.string().nullable(),
});
export type MediaVariants = z.infer<typeof mediaVariantsSchema>;

export const mediaItemSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  slug: z.string().min(1).max(120),
  original_filename: z.string().min(1).max(255),
  mime_type: z.string().min(3).max(120),
  size_bytes: z.number().int().nonnegative(),
  r2_key: z.string().min(1),
  sha256: z.string().length(64),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  exif_scrubbed_at: z.string().datetime().nullable(),
  alt_text: z.string().max(500).nullable(),
  ai_tags: z.array(z.string().min(1).max(60)).max(40),
  has_embedding: z.boolean(),
  variants: mediaVariantsSchema.nullable(),
  uploaded_by: uuidSchema.nullable(),
  uploaded_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable(),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;

export const mediaListQuerySchema = paginationSchema.extend({
  q: z.string().max(200).optional(),
  tag: z.string().max(60).optional(),
  mime_prefix: z.enum(['image', 'video', 'audio', 'application']).optional(),
});
export type MediaListQuery = z.infer<typeof mediaListQuerySchema>;

export const mediaListResponseSchema = z.object({
  data: z.array(mediaItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
});
export type MediaListResponse = z.infer<typeof mediaListResponseSchema>;

export const mediaInitUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  size_bytes: z.number().int().positive().max(MAX_MEDIA_FILE_BYTES),
  mime_type: acceptedMediaMimeSchema,
  /** Caller-supplied SHA-256 enables dedup short-circuit on init. Optional. */
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'sha256 must be 64 lowercase hex chars')
    .optional(),
});
export type MediaInitUpload = z.infer<typeof mediaInitUploadSchema>;

export const mediaInitUploadResponseSchema = z.object({
  upload_id: uuidSchema,
  /** Path the client PATCHes chunks to. */
  upload_url: z.string().min(1),
  /** If a row already existed with the same sha256 → the existing media item. */
  deduped: mediaItemSchema.nullable(),
  /** Tus protocol version negotiated for this session. */
  tus_version: z.literal('1.0.0'),
  /** Server-side absolute chunk cap (informational; client should chunk under this). */
  max_chunk_bytes: z.number().int().positive(),
  expires_at: z.string().datetime(),
});
export type MediaInitUploadResponse = z.infer<typeof mediaInitUploadResponseSchema>;

export const mediaCompleteResponseSchema = z.object({
  data: mediaItemSchema,
});
export type MediaCompleteResponse = z.infer<typeof mediaCompleteResponseSchema>;

export const mediaRegenerateAltSchema = z.object({
  /** Optional model override; defaults to llama-3.2-11b-vision-instruct. */
  model: z.enum(['workers-ai-vision', 'openai-gpt-4o']).optional(),
});
export type MediaRegenerateAlt = z.infer<typeof mediaRegenerateAltSchema>;
