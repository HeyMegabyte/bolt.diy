/**
 * Regression guard for the fire-80 transient-build-error auto-restart.
 *
 * When the container REPORTS a terminal `error` whose message matches a TRANSIENT
 * "produced no usable output" signature, the workflow re-runs the build on a fresh DO
 * (bounded by MAX_RESTARTS) instead of failing the site — closing the 2nd transient
 * class (`claude_exit=1`/0-files) that the FIRE-79 npm-install retry did not cover.
 * This locks the classifier: transient → retry, deterministic → fail fast.
 */
import { isTransientBuildError } from '../workflows/site-generation.js';

describe('isTransientBuildError — which container errors auto-restart', () => {
  it('matches the claude_exit / 0-files orchestrator crash (class #2)', () => {
    expect(
      isTransientBuildError('R2 upload failed or uploaded 0 files. claude_exit=1 upload_result={}'),
    ).toBe(true);
    expect(isTransientBuildError('Build failed: uploaded 0 files. claude_exit=1')).toBe(true);
  });

  it('matches npm install/build flakes (class #1, survived the in-container retry)', () => {
    expect(isTransientBuildError('npm install failed after retry code=null: ...')).toBe(true);
    expect(isTransientBuildError('npm build failed code=1: Type error ...')).toBe(true);
    expect(isTransientBuildError('npm build failed or produced no dist/ files — unknown')).toBe(true);
  });

  it('does NOT match deterministic failures a re-run would reproduce (fail fast)', () => {
    expect(isTransientBuildError('validate-build: meta.title_length has 3 blockers')).toBe(false);
    expect(isTransientBuildError('build_validation failed: banned slop word "world-class"')).toBe(false);
    expect(isTransientBuildError('timeout')).toBe(false);
    // eviction is handled by the unknown-job restart path, not this transient-error branch
    expect(isTransientBuildError('Container DO evicted before build completed (job state lost)')).toBe(
      false,
    );
  });

  it('handles null / undefined / empty safely', () => {
    expect(isTransientBuildError(null)).toBe(false);
    expect(isTransientBuildError(undefined)).toBe(false);
    expect(isTransientBuildError('')).toBe(false);
  });

  it('is case-insensitive (container messages vary in casing)', () => {
    expect(isTransientBuildError('CLAUDE_EXIT=1')).toBe(true);
    expect(isTransientBuildError('Uploaded 0 Files')).toBe(true);
  });
});
