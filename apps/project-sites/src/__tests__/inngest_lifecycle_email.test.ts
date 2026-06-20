/**
 * Inngest plane (§13) — the lifecycle-email durable function + its testable step
 * body. `runLifecycleEmail` reads env from the ALS context and routes through
 * the email seam; the function is registered with the correct trigger so the
 * §13 plane drains `job/email.requested`.
 */
import {
  runLifecycleEmail,
  lifecycleEmail,
  inngestFunctions,
} from '../inngest/functions.js';
import { runWithRequestEnv, InngestEnvError } from '../inngest/request-env.js';
import { EmailEventError } from '../inngest/handlers.js';
import type { Env } from '../types/env.js';
import type { EmailProvider, EmailResult, SendEmailInput } from '../platform/email.js';

const env = {} as Env;

/** A fake transactional rail that records what it was asked to send. */
class RecordingProvider implements EmailProvider {
  public last: SendEmailInput | null = null;
  async sendTransactional(input: SendEmailInput): Promise<EmailResult> {
    this.last = input;
    return { id: 'evt-1', accepted: true };
  }
}

describe('runLifecycleEmail', () => {
  it('reads env from the ALS context and sends the transactional email', async () => {
    const rail = new RecordingProvider();
    const out = await runWithRequestEnv(env, () =>
      runLifecycleEmail(
        {
          payload: { to: 'a@b.com', subject: 'Hi', html: '<p>x</p>', kind: 'receipt' },
          _ctx: { idempotencyKey: 'idem-1' },
        },
        { transactional: rail },
      ),
    );
    expect(out).toEqual({ sent: true, id: 'evt-1', accepted: true });
    expect(rail.last).toMatchObject({
      kind: 'receipt',
      to: 'a@b.com',
      subject: 'Hi',
      idempotencyKey: 'idem-1',
    });
  });

  it('throws EmailEventError when the payload is incomplete', async () => {
    await expect(
      runWithRequestEnv(env, () =>
        runLifecycleEmail({ payload: { to: 'a@b.com' } }, { transactional: new RecordingProvider() }),
      ),
    ).rejects.toBeInstanceOf(EmailEventError);
  });

  it('throws InngestEnvError when run without the serve env wrapper', async () => {
    await expect(
      runLifecycleEmail({ payload: { to: 'a@b.com', subject: 's', html: 'h' } }),
    ).rejects.toBeInstanceOf(InngestEnvError);
  });
});

describe('inngest function registration', () => {
  it('registers lifecycleEmail on the job/email.requested trigger', () => {
    // served to the self-hosted server alongside siteGenerationCompleted
    expect(inngestFunctions).toContain(lifecycleEmail);
    // id + trigger are the contract the server keys function registration on
    const fn = lifecycleEmail as unknown as {
      id(): string;
      getConfigTriggers(): Array<{ event?: string }>;
    };
    expect(fn.id()).toBe('lifecycle-email');
    expect(fn.getConfigTriggers().map((t) => t.event)).toContain('job/email.requested');
  });
});
