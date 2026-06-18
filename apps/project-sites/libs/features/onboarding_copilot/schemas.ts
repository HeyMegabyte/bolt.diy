import { z } from 'zod';

/** A single step in the onboarding activation checklist. */
export const ChecklistStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  cta_url: z.string(),
  cta_label: z.string(),
  /** True on the first step that is not yet done — the recommended next action. */
  next: z.boolean(),
});

export type ChecklistStep = z.infer<typeof ChecklistStepSchema>;

/** GET /api/onboarding/checklist response. */
export const ChecklistResponseSchema = z.object({
  dismissed: z.boolean(),
  complete: z.boolean(),
  steps: z.array(ChecklistStepSchema),
});

export type ChecklistResponse = z.infer<typeof ChecklistResponseSchema>;

/** POST /api/onboarding/dismiss response. */
export const DismissResponseSchema = z.object({
  dismissed: z.boolean(),
});

export type DismissResponse = z.infer<typeof DismissResponseSchema>;
