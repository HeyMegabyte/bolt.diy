/**
 * @module routes/conversational_edits
 * @description Hono routes for the **conversational_editing** feature module.
 *
 * Natural-language site editing with reversible changesets. Every handler is
 * gated on the `conversational_editing` feature flag — when off, returns 404
 * (never 403; never leak feature existence).
 *
 * Mount path: `/api/conversational-edits`
 *
 * | Method | Path                              | Purpose                              |
 * | ------ | --------------------------------- | ------------------------------------ |
 * | POST   | `/:siteId/intent`                 | Extract edit intent preview (no apply)|
 * | POST   | `/:siteId/apply`                  | Create a changeset from prompt+files  |
 * | POST   | `/:siteId/revert/:changesetId`    | Forward-only revert (new changeset)   |
 * | GET    | `/:siteId/history`                | Ordered changeset history             |
 * | GET    | `/changesets/:changesetId/diff`   | Per-file before/after diff            |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { extractEditIntent } from '../services/edit_intent_extractor.js';
import {
  createChangeset,
  getChangesetDiff,
  getHistory,
  revertChangeset,
} from '../services/changeset_service.js';
import {
  ApplyChangesetRequestSchema,
  ExtractIntentRequestSchema,
  RevertChangesetRequestSchema,
} from '../../libs/features/conversational_editing/feature.schemas.js';

const FLAG_KEY = 'conversational_editing';

const conversationalEdits = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Standard 404 when the flag is off — does not leak feature existence. */
function flagDisabled(message = 'Not found') {
  return { error: { code: 'NOT_FOUND', message } } as const;
}

// ─── Extract intent preview (no apply) ─────────────────────────────────

conversationalEdits.post('/:siteId/intent', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { siteId } = c.req.param();
  const on = await isFlagOn(c.env, FLAG_KEY, { siteId, orgId: c.get('orgId'), userId });
  if (!on) return c.json(flagDisabled(), 404);

  const body = await c.req.json().catch(() => ({}));
  const parsed = ExtractIntentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: parsed.error.issues[0]?.message ?? 'Invalid request' } },
      400,
    );
  }

  try {
    const intent = await extractEditIntent(c.env, {
      prompt: parsed.data.prompt,
      fileList: parsed.data.fileList,
    });
    return c.json({ intent });
  } catch (err) {
    return c.json(
      {
        error: {
          code: 'AI_GENERATION_ERROR',
          message: err instanceof Error ? err.message : 'Failed to extract edit intent',
        },
      },
      502,
    );
  }
});

// ─── Apply (create changeset) ──────────────────────────────────────────

conversationalEdits.post('/:siteId/apply', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { siteId } = c.req.param();
  const on = await isFlagOn(c.env, FLAG_KEY, { siteId, orgId: c.get('orgId'), userId });
  if (!on) return c.json(flagDisabled(), 404);

  const body = await c.req.json().catch(() => ({}));
  const parsed = ApplyChangesetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: parsed.error.issues[0]?.message ?? 'Invalid request' } },
      400,
    );
  }

  const changesetId = await createChangeset(c.env, {
    siteId,
    chatId: parsed.data.chatId ?? null,
    userId,
    prompt: parsed.data.prompt,
    files: parsed.data.files,
  });

  return c.json({ ok: true, changesetId, status: 'applied' }, 201);
});

// ─── Revert (forward-only new changeset) ───────────────────────────────

conversationalEdits.post('/:siteId/revert/:changesetId', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { siteId, changesetId } = c.req.param();
  const on = await isFlagOn(c.env, FLAG_KEY, { siteId, orgId: c.get('orgId'), userId });
  if (!on) return c.json(flagDisabled(), 404);

  const body = await c.req.json().catch(() => ({}));
  const parsed = RevertChangesetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: parsed.error.issues[0]?.message ?? 'Invalid request' } },
      400,
    );
  }

  try {
    const revertId = await revertChangeset(c.env, {
      siteId,
      changesetId,
      userId,
      reason: parsed.data.reason,
    });
    return c.json({ ok: true, revertChangesetId: revertId, status: 'reverted' }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Revert failed';
    const code = message.startsWith('Changeset not found') ? 'NOT_FOUND' : 'BAD_REQUEST';
    return c.json({ error: { code, message } }, code === 'NOT_FOUND' ? 404 : 400);
  }
});

// ─── History ───────────────────────────────────────────────────────────

conversationalEdits.get('/:siteId/history', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { siteId } = c.req.param();
  const on = await isFlagOn(c.env, FLAG_KEY, { siteId, orgId: c.get('orgId'), userId });
  if (!on) return c.json(flagDisabled(), 404);

  const changesets = await getHistory(c.env, siteId);
  return c.json({ changesets, total: changesets.length });
});

// ─── Diff ───────────────────────────────────────────────────────────────

conversationalEdits.get('/changesets/:changesetId/diff', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { changesetId } = c.req.param();
  const diff = await getChangesetDiff(c.env, changesetId);
  if (!diff) return c.json({ error: { code: 'NOT_FOUND', message: 'Changeset not found' } }, 404);

  const on = await isFlagOn(c.env, FLAG_KEY, {
    siteId: diff.changeset.siteId,
    orgId: c.get('orgId'),
    userId,
  });
  if (!on) return c.json(flagDisabled(), 404);

  return c.json(diff);
});

export { conversationalEdits };
