/**
 * @module schemas/contact
 * @description Zod validation schema for the contact form.
 */

import { z } from 'zod';
import { emailSchema } from './base.js';

/**
 * Validates incoming contact form submissions.
 *
 * | Field   | Required | Constraints                          |
 * | ------- | -------- | ------------------------------------ |
 * | name    | Yes      | 1-200 chars, no script tags          |
 * | email   | Yes      | Valid email, max 254, lowercased     |
 * | phone   | No       | Max 20 chars                         |
 * | message | Yes      | 10-5000 chars, no script tags        |
 */
export const contactFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(200, 'Name is too long (max 200 characters)')
    .refine((val) => !/<script[\s>]/i.test(val), 'Invalid characters in name'),
  email: emailSchema,
  // `.nullish()` (not `.optional()`): a contact form commonly sends `phone: null`
  // for an empty optional field (`input.value || null`) — `.optional()` alone
  // rejects null and 400s the ENTIRE submission, losing the visitor's message.
  // Every downstream consumer already null-guards (`body.phone ?? null`, truthy
  // checks). See [[optional-field-form-sends-null-schema-rejects]].
  phone: z.string().max(20, 'Phone number is too long').nullish(),
  message: z
    .string()
    .min(10, 'Message must be at least 10 characters')
    .max(5000, 'Message is too long (max 5000 characters)')
    .refine((val) => !/<script[\s>]/i.test(val) && !/javascript:/i.test(val), 'Invalid characters in message'),
});

/** Inferred TypeScript type for a validated contact form submission. */
export type ContactForm = z.infer<typeof contactFormSchema>;
