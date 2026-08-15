import { redactBuildLogSecrets, toBuildLogLine } from './waiting.component';
import type { LogEntry } from '../../services/api.service';

describe('redactBuildLogSecrets', () => {
  it('redacts an ANTHROPIC_AUTH_TOKEN=sk-... leak', () => {
    const out = redactBuildLogSecrets('ANTHROPIC_AUTH_TOKEN=sk-ant-should-be-redacted');
    expect(out).not.toContain('sk-ant-should-be-redacted');
    expect(out).toContain('REDACTED');
  });

  it('redacts a bare sk- key, an AWS AKIA key, and a Bearer token', () => {
    expect(redactBuildLogSecrets('key sk-abcdef123456 done')).not.toContain('sk-abcdef123456');
    expect(redactBuildLogSecrets('AKIAIOSFODNN7EXAMPLE')).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(redactBuildLogSecrets('Authorization: Bearer abcDEF123456xyz')).not.toContain(
      'abcDEF123456xyz',
    );
  });

  it('redacts a PostHog phc_ and a Resend re_ key', () => {
    expect(redactBuildLogSecrets('phc_0123456789abcdefghij')).not.toContain(
      'phc_0123456789abcdefghij',
    );
    expect(redactBuildLogSecrets('re_abcdef123456')).not.toContain('re_abcdef123456');
  });

  it('leaves ordinary build output untouched', () => {
    const clean = 'validator-fixer: 0 blockers remaining';
    expect(redactBuildLogSecrets(clean)).toBe(clean);
  });
});

describe('toBuildLogLine', () => {
  function entry(over: Partial<LogEntry>): LogEntry {
    return { id: 'x', action: 'container.stdout', created_at: '2026-08-15T03:00:00Z', ...over };
  }

  it('prefers the raw metadata_json.message as the line text', () => {
    const line = toBuildLogLine(
      entry({ metadata_json: JSON.stringify({ message: 'building → dist' }) }),
    );
    expect(line.text).toBe('building → dist');
  });

  it('falls back to a human label for a known pipeline action when no message', () => {
    const line = toBuildLogLine(
      entry({ action: 'workflow.step.upload_started', metadata_json: undefined }),
    );
    expect(line.text.length).toBeGreaterThan(0);
    expect(line.kind).toBe('phase');
  });

  it('classifies an error action as kind=error', () => {
    expect(toBuildLogLine(entry({ action: 'workflow.step.generation_failed' })).kind).toBe('error');
  });

  it('redacts secrets inside the rendered line', () => {
    const line = toBuildLogLine(
      entry({ metadata_json: JSON.stringify({ message: 'sk-ant-leak-abcdef123456' }) }),
    );
    expect(line.text).not.toContain('sk-ant-leak-abcdef123456');
  });

  it('survives non-JSON metadata without throwing', () => {
    expect(() => toBuildLogLine(entry({ metadata_json: 'not-json{' }))).not.toThrow();
  });
});
