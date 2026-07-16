import { parseQuery } from '../service.js';

describe('parseQuery', () => {
  it('matches "how many sites"', () => { expect(parseQuery('how many sites do I have').sql).toContain('COUNT(*)'); expect(parseQuery('how many sites do I have').explanation).toContain('active sites'); });
  it('matches "how many builds"', () => { expect(parseQuery('how many builds').sql).toContain('workflow_jobs'); });
  it('matches "builds this month"', () => { expect(parseQuery('builds this month').sql).toContain("start of month"); });
  it('matches "most active site"', () => { expect(parseQuery('most active site').sql).toContain('GROUP BY'); });
  it('matches "sites by status"', () => { expect(parseQuery('sites by status').sql).toContain('GROUP BY status'); });
  it('matches "recent builds"', () => { expect(parseQuery('recent builds').sql).toContain('LIMIT 10'); });
  it('matches "how many members"', () => { expect(parseQuery('how many members').sql).toContain('memberships'); });
  it('returns hint for unknown question', () => { const r = parseQuery('what is the meaning of life'); expect(r.sql).toContain('hint'); expect(r.explanation).toContain('recognize'); });
  it('returns the original question', () => { expect(parseQuery('how many sites').question).toBe('how many sites'); });
});
