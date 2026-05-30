/**
 * @module libs/features/multimodal_intake/handlers
 * @description Hono routes for Multimodal Intake (idea #18).
 *
 * | Method | Path                    | Purpose                                  |
 * | ------ | ----------------------- | ---------------------------------------- |
 * | POST   | /api/sites/:id/intake   | Photo+voice intake → intent + prefill    |
 *
 * 404s when the `multimodal_intake` flag is off (never 403 — don't leak
 * feature existence) per [[feature-flags]]. This route is public-by-design:
 * a visitor on a generated site's `/book` page hits it with no auth, so the
 * flag check is keyed on the site, and uploaded media stays org-scoped.
 *
 * Accepts EITHER JSON `{ photoR2Key?, audioR2Key?, photoUrl?, note? }` OR a
 * multipart body with `photo` / `audio` file parts (uploaded to the site
 * org's media prefix, then processed). The 256KB global payload limit is
 * lifted for this route's multipart path by the same exemption the media
 * upload route uses (see src/index.ts mount order).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { uploadAsset } from '../../../src/services/media.js';
import { processIntake, FLAG_KEY } from './service.js';
import { ExtractIntentInputSchema, IntakeResponseSchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const multimodalIntake = new Hono<AppContext>();

const notFound = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

/** Uploaded-file shape from `formData()` — duck-typed (Workers lib lacks a `File` global type). */
interface UploadedFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Narrow a FormData entry to a non-empty uploaded file. */
function isUploadedFile(entry: unknown): entry is UploadedFile {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as UploadedFile).arrayBuffer === 'function' &&
    typeof (entry as UploadedFile).size === 'number' &&
    (entry as UploadedFile).size > 0
  );
}

/** Resolve the owning org id for a site (null when not found). */
async function orgIdForSite(env: Env, siteId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL LIMIT 1')
    .bind(siteId)
    .first<{ org_id: string }>()
    .catch(() => null);
  return row?.org_id ?? null;
}

multimodalIntake.post('/api/sites/:id/intake', async (c) => {
  const siteId = c.req.param('id');

  // Flag gate keyed on the site (the visitor is unauthenticated).
  const on = await isFlagOn(c.env, FLAG_KEY, { siteId });
  if (!on) return notFound(c);

  const orgId = await orgIdForSite(c.env, siteId);
  if (!orgId) return notFound(c);

  let photoR2Key: string | undefined;
  let audioR2Key: string | undefined;
  let photoUrl: string | undefined;
  let note: string | undefined;

  const contentType = c.req.header('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    // Multipart path — store the uploaded files in the org media prefix.
    const form = await c.req.formData();
    note = (form.get('note') as string | null)?.toString() || undefined;

    const photo = form.get('photo');
    if (isUploadedFile(photo)) {
      const asset = await uploadAsset(c.env, {
        orgId,
        name: photo.name || 'intake-photo',
        mime: photo.type || 'image/jpeg',
        bytes: await photo.arrayBuffer(),
        kind: 'image',
        source: 'uploaded',
        sourceProvider: 'multimodal_intake',
      });
      photoR2Key = asset.r2_key;
      photoUrl = `/api/media/assets/${asset.id}/raw`;
    }

    const audio = form.get('audio');
    if (isUploadedFile(audio)) {
      const asset = await uploadAsset(c.env, {
        orgId,
        name: audio.name || 'intake-voice',
        mime: audio.type || 'audio/webm',
        bytes: await audio.arrayBuffer(),
        kind: 'audio',
        source: 'uploaded',
        sourceProvider: 'multimodal_intake',
      });
      audioR2Key = asset.r2_key;
    }
  } else {
    // JSON path — caller passes already-uploaded R2 keys.
    const body = await c.req.json().catch(() => ({}));
    const parsed = ExtractIntentInputSchema.safeParse({ siteId, ...body });
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid intake body' } },
        400,
      );
    }
    photoR2Key = parsed.data.photoR2Key;
    audioR2Key = parsed.data.audioR2Key;
    note = parsed.data.note;
    photoUrl = (body as { photoUrl?: string }).photoUrl;
  }

  const { submission, leadId, bookingId } = await processIntake(c.env, {
    siteId,
    photoR2Key,
    audioR2Key,
    photoUrl,
    note,
  });

  return c.json(IntakeResponseSchema.parse({ ok: true, submission, leadId, bookingId }));
});

export default multimodalIntake;
