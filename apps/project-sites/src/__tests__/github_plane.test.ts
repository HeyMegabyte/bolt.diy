import {
  extractPlaneRefs,
  buildCommitNote,
  extractGithubRefs,
  type CommitRef,
} from '../services/github_plane.js';

describe('extractPlaneRefs (PL19 — Plane refs from commit messages)', () => {
  it('extracts a single keyword-linked Plane ref', () => {
    const commit: CommitRef = {
      sha: 'abc123',
      message: 'fixes PL19-42',
      repo: 'my/repo',
    };
    const refs = extractPlaneRefs(commit);
    expect(refs).toEqual([{ projectId: 'PL19', issueId: '42' }]);
  });

  it('extracts multiple Plane refs from one message', () => {
    const commit: CommitRef = {
      sha: 'abc123',
      message: 'fixes PL19-42, closes PL19-43, refs PL19-7',
      repo: 'my/repo',
    };
    const refs = extractPlaneRefs(commit);
    expect(refs).toEqual([
      { projectId: 'PL19', issueId: '42' },
      { projectId: 'PL19', issueId: '43' },
      { projectId: 'PL19', issueId: '7' },
    ]);
  });

  it('extracts bracket-wrapped Plane refs', () => {
    const commit: CommitRef = {
      sha: 'def456',
      message: '[PL19-7] add login page',
      repo: 'my/repo',
    };
    const refs = extractPlaneRefs(commit);
    expect(refs).toEqual([{ projectId: 'PL19', issueId: '7' }]);
  });

  it('extracts Plane refs from multi-line messages', () => {
    const commit: CommitRef = {
      sha: '789ghi',
      message: 'feat(billing): add invoice download\n\ncloses PL19-88',
      repo: 'my/repo',
    };
    const refs = extractPlaneRefs(commit);
    expect(refs).toEqual([{ projectId: 'PL19', issueId: '88' }]);
  });

  it('handles various linking keywords', () => {
    const commit: CommitRef = {
      sha: 'aaabbb',
      message: 'Resolves ABC-1\nClosed DEF-2\nReference GHI-3\nRe JKL-4',
      repo: 'x/y',
    };
    const refs = extractPlaneRefs(commit);
    expect(refs).toHaveLength(4);
    expect(refs[0]).toEqual({ projectId: 'ABC', issueId: '1' });
    expect(refs[1]).toEqual({ projectId: 'DEF', issueId: '2' });
    expect(refs[2]).toEqual({ projectId: 'GHI', issueId: '3' });
    expect(refs[3]).toEqual({ projectId: 'JKL', issueId: '4' });
  });

  it('deduplicates repeated Plane refs', () => {
    const commit: CommitRef = {
      sha: 'zzz',
      message: 'fixes PL19-42\n\nrefs PL19-42',
      repo: 'r',
    };
    const refs = extractPlaneRefs(commit);
    expect(refs).toHaveLength(1);
  });

  it('returns empty array for a message with no Plane refs', () => {
    const commit: CommitRef = {
      sha: 'noref',
      message: 'chore: bump deps',
      repo: 'my/repo',
    };
    expect(extractPlaneRefs(commit)).toEqual([]);
  });

  it('returns empty array for an empty message', () => {
    const commit: CommitRef = {
      sha: 'empty',
      message: '',
      repo: 'r',
    };
    expect(extractPlaneRefs(commit)).toEqual([]);
  });

  it('returns empty array for a nullish message', () => {
    const commit: CommitRef = {
      sha: 'null',
      message: null as unknown as string,
      repo: 'r',
    };
    expect(extractPlaneRefs(commit)).toEqual([]);
  });

  it('does not match non-Plane numeric patterns like issue #42 alone', () => {
    const commit: CommitRef = {
      sha: 'noplan',
      message: 'fixes issue #42 in main',
      repo: 'r',
    };
    expect(extractPlaneRefs(commit)).toEqual([]);
  });

  it('does not match version-like patterns such as v1.2.3', () => {
    const commit: CommitRef = {
      sha: 'vers',
      message: 'bump to v1.2.3',
      repo: 'r',
    };
    expect(extractPlaneRefs(commit)).toEqual([]);
  });
});

describe('buildCommitNote (PL19 — commit note for Plane issue comments)', () => {
  it('builds a note with short SHA, repo, and message', () => {
    const commit: CommitRef = {
      sha: 'abc123def456',
      message: 'fixes PL19-42',
      repo: 'my/repo',
    };
    const note = buildCommitNote(commit);
    expect(note).toBe('**Commit:** abc123d\n**Repo:** my/repo\n\nfixes PL19-42');
  });

  it('handles a short SHA exactly 7 chars', () => {
    const commit: CommitRef = {
      sha: 'abcdef1',
      message: 'initial',
      repo: 'r',
    };
    expect(buildCommitNote(commit)).toBe('**Commit:** abcdef1\n**Repo:** r\n\ninitial');
  });

  it('handles a SHA shorter than 7 chars', () => {
    const commit: CommitRef = {
      sha: 'ab',
      message: 'tiny',
      repo: 'r',
    };
    expect(buildCommitNote(commit)).toContain('**Commit:** ab');
  });

  it('handles an empty SHA', () => {
    const commit: CommitRef = {
      sha: '',
      message: 'empty sha',
      repo: 'r',
    };
    expect(buildCommitNote(commit)).toContain('**Commit:** ');
  });

  it('handles nullish fields safely', () => {
    const commit: CommitRef = {
      sha: null as unknown as string,
      message: null as unknown as string,
      repo: null as unknown as string,
    };
    const note = buildCommitNote(commit);
    expect(note).toContain('**Commit:** ');
    expect(note).toContain('**Repo:** ');
  });
});

describe('extractGithubRefs (PL19 — GitHub PR refs from Plane issue bodies)', () => {
  it('extracts full GitHub PR URLs', () => {
    const body = 'See https://github.com/foo/bar/pull/42 for details.';
    const refs = extractGithubRefs(body);
    expect(refs).toEqual([{ owner: 'foo', repo: 'bar', number: 42 }]);
  });

  it('extracts full URLs without protocol', () => {
    const body = 'PR at github.com/foo/bar/pull/42';
    const refs = extractGithubRefs(body);
    expect(refs).toEqual([{ owner: 'foo', repo: 'bar', number: 42 }]);
  });

  it('extracts short-form owner/repo#PR refs', () => {
    const body = 'Related: foo/bar#7';
    const refs = extractGithubRefs(body);
    expect(refs).toEqual([{ owner: 'foo', repo: 'bar', number: 7 }]);
  });

  it('extracts multiple refs of both forms', () => {
    const body = 'PR: https://github.com/foo/bar/pull/42\nSee also foo/bar#7 and baz/qux#100';
    const refs = extractGithubRefs(body);
    expect(refs).toEqual([
      { owner: 'foo', repo: 'bar', number: 42 },
      { owner: 'foo', repo: 'bar', number: 7 },
      { owner: 'baz', repo: 'qux', number: 100 },
    ]);
  });

  it('deduplicates identical refs', () => {
    const body = 'PR: https://github.com/a/b/pull/1\nAlso a/b#1';
    const refs = extractGithubRefs(body);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({ owner: 'a', repo: 'b', number: 1 });
  });

  it('returns empty array for a body with no refs', () => {
    expect(extractGithubRefs('Nothing here.')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(extractGithubRefs('')).toEqual([]);
  });

  it('returns empty array for nullish body', () => {
    expect(extractGithubRefs(null as unknown as string)).toEqual([]);
  });

  it('handles repo names with dots and hyphens', () => {
    const body = 'See my-org/my.repo#42';
    const refs = extractGithubRefs(body);
    expect(refs).toEqual([{ owner: 'my-org', repo: 'my.repo', number: 42 }]);
  });

  it('ignores a bare #N without owner/repo prefix', () => {
    const body = 'Fixes #42 in the main branch';
    const refs = extractGithubRefs(body);
    expect(refs).toEqual([]);
  });
});
