import { handleContactForm } from '../services/contact.js';
import { AppError } from '@project-sites/shared';

const mockEnv = {
  ENVIRONMENT: 'staging',
  RESEND_API_KEY: 'test-resend-key',
  SENDGRID_API_KEY: 'test-sendgrid-key',
} as any;

const originalFetch = global.fetch;
const mockFetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ id: 'mock-msg-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Valid submission
// ---------------------------------------------------------------------------
describe('handleContactForm – valid submission', () => {
  const validInput = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+1234567890',
    message: 'Hello, I have a question about your services.',
  };

  it('sends two emails (notification + confirmation)', async () => {
    await handleContactForm(mockEnv, validInput);

    // Two fetch calls: one for notification, one for confirmation
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call: notification to team
    const firstCallUrl = mockFetch.mock.calls[0][0];
    expect(firstCallUrl).toBe('https://api.resend.com/emails');
    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(firstBody.to).toEqual(['hey@megabyte.space']);
    expect(firstBody.subject).toContain('Jane Doe');
    expect(firstBody.reply_to).toBe('jane@example.com');

    // Second call: confirmation to user
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(secondBody.to).toEqual(['jane@example.com']);
    expect(secondBody.subject).toContain('received your message');
  });

  it('works without a phone number', async () => {
    const input = { name: 'Bob', email: 'bob@test.com', message: 'This is my test message.' };
    await handleContactForm(mockEnv, input);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('HTML-escapes user input in email body', async () => {
    const input = {
      name: 'Test <b>User</b>',
      email: 'test@example.com',
      message: 'Hello & goodbye "friend"',
    };
    await handleContactForm(mockEnv, input);

    const notificationBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(notificationBody.html).toContain('&lt;b&gt;User&lt;/b&gt;');
    expect(notificationBody.html).toContain('&amp; goodbye &quot;friend&quot;');
  });
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------
describe('handleContactForm – validation', () => {
  it('rejects missing name', async () => {
    await expect(
      handleContactForm(mockEnv, { email: 'a@b.com', message: 'Long enough message' }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects empty name', async () => {
    await expect(
      handleContactForm(mockEnv, { name: '', email: 'a@b.com', message: 'Long enough message' }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects invalid email', async () => {
    await expect(
      handleContactForm(mockEnv, { name: 'Bob', email: 'not-an-email', message: 'Long enough message' }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects missing email', async () => {
    await expect(
      handleContactForm(mockEnv, { name: 'Bob', message: 'Long enough message' }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects missing message', async () => {
    await expect(
      handleContactForm(mockEnv, { name: 'Bob', email: 'a@b.com' }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects short message (< 10 chars)', async () => {
    await expect(
      handleContactForm(mockEnv, { name: 'Bob', email: 'a@b.com', message: 'Short' }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects script tags in name', async () => {
    await expect(
      handleContactForm(mockEnv, {
        name: '<script>alert("xss")</script>',
        email: 'a@b.com',
        message: 'A normal message here.',
      }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects script tags in message', async () => {
    await expect(
      handleContactForm(mockEnv, {
        name: 'Bob',
        email: 'a@b.com',
        message: 'Hello <script>alert("xss")</script> world',
      }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects javascript: in message', async () => {
    await expect(
      handleContactForm(mockEnv, {
        name: 'Bob',
        email: 'a@b.com',
        message: 'Check this link: javascript:alert(1)',
      }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects name that is too long (> 200 chars)', async () => {
    await expect(
      handleContactForm(mockEnv, {
        name: 'A'.repeat(201),
        email: 'a@b.com',
        message: 'A normal message here.',
      }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects phone that is too long (> 20 chars)', async () => {
    await expect(
      handleContactForm(mockEnv, {
        name: 'Bob',
        email: 'a@b.com',
        phone: '1'.repeat(21),
        message: 'A normal message here.',
      }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Email provider errors
// ---------------------------------------------------------------------------
describe('handleContactForm – email providers', () => {
  it('falls back to SendGrid when Resend fails', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('error', { status: 500 }))   // Resend fails (notification)
      .mockResolvedValueOnce(new Response('', { status: 202 }))        // SendGrid succeeds (notification)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'x' }), { status: 200 }));  // Resend succeeds (confirmation)

    await handleContactForm(mockEnv, {
      name: 'Jane',
      email: 'jane@test.com',
      message: 'Testing fallback behavior.',
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(mockFetch.mock.calls[1][0]).toBe('https://api.sendgrid.com/v3/mail/send');
  });

  it('throws when no email provider is configured', async () => {
    const noEmailEnv = { ENVIRONMENT: 'staging' } as any;

    await expect(
      handleContactForm(noEmailEnv, {
        name: 'Bob',
        email: 'bob@test.com',
        message: 'Testing no provider configured.',
      }),
    ).rejects.toThrow('Email delivery is not configured');
  });

  it('throws when both providers fail', async () => {
    mockFetch.mockResolvedValue(new Response('error', { status: 500 }));

    await expect(
      handleContactForm(mockEnv, {
        name: 'Bob',
        email: 'bob@test.com',
        message: 'Testing both providers failing.',
      }),
    ).rejects.toThrow();
  });
});
