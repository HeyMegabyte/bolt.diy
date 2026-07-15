import { z } from 'zod';

export const OnboardingStepSchema = z.object({
  key: z.string(),
  label: z.string(),
  completed: z.boolean(),
  detail: z.string().nullable(),
});
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;

export const OnboardingProgressSchema = z.object({
  steps: z.array(OnboardingStepSchema),
  completed: z.number().int(),
  total: z.number().int(),
  pct: z.number().min(0).max(100),
});
export type OnboardingProgress = z.infer<typeof OnboardingProgressSchema>;
