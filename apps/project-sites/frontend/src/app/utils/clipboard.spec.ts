import { copyToClipboard } from './clipboard';

describe('copyToClipboard (best-effort, never rejects)', () => {
  it('returns true when the clipboard write succeeds', async () => {
    const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await expectAsync(copyToClipboard('hello')).toBeResolvedTo(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('returns false (never throws) when the clipboard rejects — e.g. headless / denied', async () => {
    const writeText = jasmine
      .createSpy('writeText')
      .and.rejectWith(new DOMException('Write permission denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    // The key guarantee: it resolves to false rather than rejecting (no unhandled rejection).
    await expectAsync(copyToClipboard('x')).toBeResolvedTo(false);
  });
});
