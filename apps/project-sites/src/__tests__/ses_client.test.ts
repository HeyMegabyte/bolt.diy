import {
  buildSesRequest,
  validateSesRequest,
  renderSesBody,
  textToHtmlBody,
  SES_LIMITS,
  type SesSendRequest,
} from '../services/ses_client.js';

describe('buildSesRequest', () => {
  it('wraps a single to-string into an array', () => {
    const r = buildSesRequest({ to: 'a@b.com', subject: 'S', bodyHtml: '<p>H</p>', bodyText: 'H' });
    expect(r.to).toEqual(['a@b.com']);
    expect(r.subject).toBe('S');
    expect(r.bodyHtml).toBe('<p>H</p>');
    expect(r.bodyText).toBe('H');
  });

  it('passes through the optional from address', () => {
    const r = buildSesRequest({
      to: 'a@b.com',
      subject: 'S',
      bodyHtml: '<p>H</p>',
      bodyText: 'H',
      from: 'noreply@x.com',
    });
    expect(r.from).toBe('noreply@x.com');
  });

  it('omits from when not provided', () => {
    const r = buildSesRequest({ to: 'a@b.com', subject: 'S', bodyHtml: '<p>H</p>', bodyText: 'H' });
    expect(r.from).toBeUndefined();
  });
});

describe('validateSesRequest', () => {
  const validReq: SesSendRequest = {
    to: ['user@example.com'],
    subject: 'Welcome!',
    bodyHtml: '<p>Hello</p>',
    bodyText: 'Hello',
    from: 'noreply@example.com',
  };

  it('passes a valid request', () => {
    const { valid, errors } = validateSesRequest(validReq);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('fails on empty recipient list', () => {
    const { valid, errors } = validateSesRequest({ ...validReq, to: [] });
    expect(valid).toBe(false);
    expect(errors).toContain('At least one recipient (to) is required');
  });

  it('fails on null/undefined to (treated as falsy array check)', () => {
    const { valid, errors } = validateSesRequest({
      ...validReq,
      to: null as unknown as string[],
    });
    expect(valid).toBe(false);
    expect(errors).toContain('At least one recipient (to) is required');
  });

  it('fails on invalid email addresses in to', () => {
    const { valid, errors } = validateSesRequest({ ...validReq, to: ['not-an-email'] });
    expect(valid).toBe(false);
    expect(errors).toContain('Recipient "not-an-email" is not a valid email address');
  });

  it('fails if recipient count exceeds SES_LIMITS.maxRecipients', () => {
    const to = Array.from({ length: SES_LIMITS.maxRecipients + 1 }, (_, i) => `u${i}@x.com`);
    const { valid, errors } = validateSesRequest({ ...validReq, to });
    expect(valid).toBe(false);
    expect(errors).toContain(`Recipient count exceeds limit of ${SES_LIMITS.maxRecipients}`);
  });

  it('fails on empty subject', () => {
    const { valid, errors } = validateSesRequest({ ...validReq, subject: '' });
    expect(valid).toBe(false);
    expect(errors).toContain('Subject is required');
  });

  it('fails on subject exceeding 998 chars', () => {
    const subject = 'x'.repeat(SES_LIMITS.maxSubjectChars + 1);
    const { valid, errors } = validateSesRequest({ ...validReq, subject });
    expect(valid).toBe(false);
    expect(errors).toContain(
      `Subject exceeds maximum length of ${SES_LIMITS.maxSubjectChars} characters ` +
        `(got ${subject.length})`,
    );
  });

  it('fails on empty bodyHtml', () => {
    const { valid, errors } = validateSesRequest({ ...validReq, bodyHtml: '' });
    expect(valid).toBe(false);
    expect(errors).toContain('HTML body is required');
  });

  it('fails on empty bodyText', () => {
    const { valid, errors } = validateSesRequest({ ...validReq, bodyText: '' });
    expect(valid).toBe(false);
    expect(errors).toContain('Text body is required');
  });

  it('fails on total body exceeding maxBodyBytes', () => {
    const bodyHtml = '<p>' + 'x'.repeat(SES_LIMITS.maxBodyBytes + 1) + '</p>';
    const bodyText = 'x'.repeat(SES_LIMITS.maxBodyBytes + 1);
    const { valid, errors } = validateSesRequest({ ...validReq, bodyHtml, bodyText });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.startsWith('Total body size exceeds limit'))).toBe(true);
  });

  it('collects multiple errors at once', () => {
    const { valid, errors } = validateSesRequest({
      to: [],
      subject: '',
      bodyHtml: '',
      bodyText: '',
    });
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors).toContain('At least one recipient (to) is required');
    expect(errors).toContain('Subject is required');
    expect(errors).toContain('HTML body is required');
    expect(errors).toContain('Text body is required');
  });
});

describe('renderSesBody', () => {
  const req: SesSendRequest = {
    to: ['user@example.com'],
    subject: 'Welcome!',
    bodyHtml: '<p>Hello</p>',
    bodyText: 'Hello',
    from: 'noreply@example.com',
  };

  it('renders the SES v2 JSON body', () => {
    const body = renderSesBody(req);
    expect(body.FromEmailAddress).toBe('noreply@example.com');
    expect(body.Destination).toEqual({ ToAddresses: ['user@example.com'] });
    expect(body.Content.Simple.Subject).toEqual({ Data: 'Welcome!', Charset: 'UTF-8' });
    expect(body.Content.Simple.Body.Html).toEqual({ Data: '<p>Hello</p>', Charset: 'UTF-8' });
    expect(body.Content.Simple.Body.Text).toEqual({ Data: 'Hello', Charset: 'UTF-8' });
  });

  it('includes ReplyToAddresses when replyTo is set', () => {
    const body = renderSesBody({ ...req, replyTo: ['support@example.com'] });
    expect(body.ReplyToAddresses).toEqual(['support@example.com']);
  });

  it('omits ReplyToAddresses when replyTo is empty', () => {
    const body = renderSesBody({ ...req, replyTo: [] });
    expect(body.ReplyToAddresses).toBeUndefined();
  });

  it('omits ReplyToAddresses when replyTo is undefined', () => {
    const body = renderSesBody(req);
    expect(body.ReplyToAddresses).toBeUndefined();
  });
});

describe('textToHtmlBody', () => {
  it('wraps text in minimal HTML', () => {
    const html = textToHtmlBody('Hello world');
    expect(html).toBe('<!DOCTYPE html><html><body><p>Hello world</p></body></html>');
  });

  it('splits double-newlines into paragraphs', () => {
    const html = textToHtmlBody('First paragraph.\n\nSecond paragraph.');
    expect(html).toBe(
      '<!DOCTYPE html><html><body><p>First paragraph.</p><p>Second paragraph.</p></body></html>',
    );
  });

  it('escapes HTML special characters', () => {
    const html = textToHtmlBody('Hello <World> & "friends"');
    expect(html).toContain('Hello &lt;World&gt; &amp; "friends"');
  });
});

describe('SES_LIMITS', () => {
  it('exports the expected constants', () => {
    expect(SES_LIMITS.maxRecipients).toBe(50);
    expect(SES_LIMITS.maxSubjectChars).toBe(998);
    expect(SES_LIMITS.maxBodyBytes).toBe(10_000_000);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SES_LIMITS)).toBe(true);
  });
});
