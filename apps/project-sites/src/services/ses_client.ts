/**
 * @module services/ses_client
 *
 * @description
 * Pure SES email-send request shapes + template rendering for transactional
 * emails. Builds the JSON body shape the SES v2 `SendEmail` endpoint expects
 * (`FromEmailAddress / Destination / Content.Simple`) without any I/O or
 * runtime dependencies — callers pass the result through the SigV4 signer +
 * fetch in the real provider.
 *
 * @see platform/aws-sigv4.ts
 * @see platform/email.ts
 */

/** Composite recipients for a v2 outbound-email request. */
export interface SesSendRequest {
  readonly to: string[];
  readonly subject: string;
  readonly bodyHtml: string;
  readonly bodyText: string;
  readonly from?: string;
  readonly replyTo?: string[];
}

/** Input shape for {@link buildSesRequest}. Single-string `to` is allowed for ergonomics. */
export interface BuildSesOpts {
  readonly to: string;
  readonly subject: string;
  readonly bodyHtml: string;
  readonly bodyText: string;
  readonly from?: string;
}

/** Hard limits from Amazon SES v2 — validate against these before sending. */
export const SES_LIMITS: Readonly<{
  maxBodyBytes: number;
  maxRecipients: number;
  maxSubjectChars: number;
}> = Object.freeze({
  maxBodyBytes: 10_000_000,
  maxRecipients: 50,
  maxSubjectChars: 998,
});

/**
 * Build a structured SES send request from ergonomic call-site options.
 * Wraps a single `to` address into an array; no validation (callers run
 * {@link validateSesRequest} before sending).
 *
 * @param opts - Single-recipient convenience input
 * @returns A `SesSendRequest` ready for SES v2 body serialisation
 *
 * @example
 * const req = buildSesRequest({
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   bodyHtml: '<p>Hi</p>',
 *   bodyText: 'Hi',
 *   from: 'noreply@example.com',
 * });
 * // req.to === ['user@example.com']
 */
export function buildSesRequest(opts: BuildSesOpts): SesSendRequest {
  return {
    bodyHtml: opts.bodyHtml,
    bodyText: opts.bodyText,
    from: opts.from,
    subject: opts.subject,
    to: [opts.to],
  };
}

/**
 * Validate a `SesSendRequest` against SES limits and basic well-formedness
 * rules. Returns `{ valid, errors }` — never throws.
 *
 * - `to` must be non-empty and each address must look like an email
 * - `subject` must be 1–998 chars
 * - `bodyHtml` and `bodyText` must be non-empty
 * - Total body bytes (JSON string length) must not exceed `SES_LIMITS.maxBodyBytes`
 * - Recipient count must not exceed `SES_LIMITS.maxRecipients`
 *
 * @param req - The request to validate
 * @returns Validation result with a list of human-readable error messages
 *
 * @example
 * const { valid, errors } = validateSesRequest(req);
 * if (!valid) { console.warn('SES validation failed', errors); }
 */
export function validateSesRequest(req: SesSendRequest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // --- to (recipients) ---
  if (!Array.isArray(req.to) || req.to.length === 0) {
    errors.push('At least one recipient (to) is required');
  } else if (req.to.length > SES_LIMITS.maxRecipients) {
    errors.push(`Recipient count exceeds limit of ${SES_LIMITS.maxRecipients}`);
  } else {
    for (let i = 0; i < req.to.length; i++) {
      if (typeof req.to[i] !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.to[i])) {
        errors.push(`Recipient "${req.to[i]}" is not a valid email address`);
      }
    }
  }

  // --- subject ---
  if (!req.subject) {
    errors.push('Subject is required');
  } else if (req.subject.length > SES_LIMITS.maxSubjectChars) {
    errors.push(
      `Subject exceeds maximum length of ${SES_LIMITS.maxSubjectChars} characters ` +
        `(got ${req.subject.length})`,
    );
  }

  // --- body ---
  if (!req.bodyHtml) {
    errors.push('HTML body is required');
  }
  if (!req.bodyText) {
    errors.push('Text body is required');
  }

  // --- total body size ---
  const bodySize = new TextEncoder().encode(
    JSON.stringify({
      bodyHtml: req.bodyHtml,
      bodyText: req.bodyText,
      subject: req.subject,
      to: req.to,
    }),
  ).length;
  if (bodySize > SES_LIMITS.maxBodyBytes) {
    errors.push(
      `Total body size exceeds limit of ${SES_LIMITS.maxBodyBytes} bytes (got ${bodySize})`,
    );
  }

  return { errors, valid: errors.length === 0 };
}

/**
 * Render the JSON request body for the SES v2 `SendEmail` endpoint.
 * Composes `FromEmailAddress`, `Destination`, and `Content.Simple` including
 * optional `ReplyToAddresses`.
 *
 * @param req - The validated SES send request
 * @returns A JSON-serialisable object ready to POST to `/v2/email/outbound-emails`
 *
 * @example
 * const body = renderSesBody(req);
 * // fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
 */
export function renderSesBody(req: SesSendRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    Content: {
      Simple: {
        Body: {
          Html: { Charset: 'UTF-8', Data: req.bodyHtml },
          Text: { Charset: 'UTF-8', Data: req.bodyText },
        },
        Subject: { Charset: 'UTF-8', Data: req.subject },
      },
    },
    Destination: {
      ToAddresses: req.to,
    },
    FromEmailAddress: req.from,
  };

  if (req.replyTo && req.replyTo.length > 0) {
    body.ReplyToAddresses = req.replyTo;
  }

  return body;
}

/**
 * Render a simple HTML wrapper around a plain-text body for email clients
 * that render the HTML part. Wraps the text in `<p>` tags inside a minimal
 * document shell.
 *
 * @param text - The plain text content
 * @returns An HTML string suitable for `bodyHtml`
 *
 * @example
 * const html = textToHtmlBody('Welcome to our service!');
 * // "<!DOCTYPE html><html><body><p>Welcome to our service!</p></body></html>"
 */
export function textToHtmlBody(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html><html><body><p>${escaped.replace(/\n\n/g, '</p><p>')}</p></body></html>`;
}
